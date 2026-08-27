#!/usr/bin/env bash
# test-on-dev.sh — chạy TRỌN bộ test backend (unit + integration) trên hạ tầng Docker của
# DEV/STAGING. Con số test CỐ Ý không ghi ở đây: nó trôi mỗi lượt và một con số cũ trong
# tiêu đề chỉ làm người đọc tin nhầm — `npm run verify` in ra số thật mỗi lần chạy.
#
# ⚠️ CI TRÊN GITHUB KHÔNG CHẠY (tài khoản không bật Actions). Nên .github/workflows/ci.yml là
# TÀI LIỆU về những cổng cần chạy, KHÔNG phải thứ đang chạy. Cổng thật sự chạy chỉ có hai:
#   · `npm run verify`  — chạy TẤT CẢ ngay trên máy đang ngồi (scripts/verify-local.sh)
#   · file này          — chạy trên hạ tầng Docker của VM dev, khi máy local không có Postgres/Redis/MinIO
#
#   bash test-on-dev.sh            # mặc định SSH staging-ts (= dev.gianguyen.cloud VM)
#   SSH=staging-ts bash test-on-dev.sh
#
# Cách hoạt động: SSH vào VM dev → tạo DB test RIÊNG (quanly_test, không đụng data dev) →
# chạy 1 container node:22 trên ĐÚNG mạng + ĐÚNG Postgres + Redis của dev + code đã ship (git
# archive ở $DIR) → npm ci + prisma migrate + vitest (REQUIRE_DB_TESTS=1) → dọn sạch.
# KHÔNG hardcode bí mật: lấy mật khẩu Postgres + REDIS_URL ĐỘNG từ container đang chạy.
set -uo pipefail
SSH="${SSH:-staging-ts}"
DIR=/opt/stacks/quanly/quanly
echo "▶ Chạy test trên Docker dev qua [$SSH] ..."

ssh "$SSH" '
  set -uo pipefail
  DIR=/opt/stacks/quanly/quanly
  PGUSER=$(docker exec quanly-postgres printenv POSTGRES_USER 2>/dev/null || echo quanly)
  PGPASS=$(docker exec quanly-postgres printenv POSTGRES_PASSWORD)
  REDIS=$(docker exec quanly-app printenv REDIS_URL)
  # Nạp KHO OBJECT + KHOÁ PII của DEV vào bộ test. Thiếu chúng thì test đụng lưu trữ lặng lẽ đi
  # nhánh "chưa cấu hình" (503) và test PII chạy ở chế độ không-mã-hoá — xanh mà không kiểm gì.
  # Dùng BUCKET RIÊNG (quanly-test) để không đụng dữ liệu DEV.
  S3EP=$(docker exec quanly-app printenv S3_ENDPOINT 2>/dev/null || echo "")
  S3AK=$(docker exec quanly-app printenv S3_ACCESS_KEY 2>/dev/null || echo "")
  S3SK=$(docker exec quanly-app printenv S3_SECRET_KEY 2>/dev/null || echo "")
  PIIK=$(docker exec quanly-app printenv PII_ENC_KEY 2>/dev/null || echo "")
  NET=$(docker inspect quanly-postgres -f "{{range \$k,\$v := .NetworkSettings.Networks}}{{\$k}}{{end}}")

  # Bucket RIÊNG cho bộ test. Không tạo sẵn thì mọi test đụng lưu trữ đỏ vì "NoSuchBucket" — và
  # tệ hơn, dễ bị hiểu nhầm là lỗi ứng dụng. Tạo trước, dọn nội dung sau mỗi lượt chạy.
  if [ -n "$S3EP" ]; then
    docker run --rm --network "$NET" --entrypoint sh minio/mc:latest -c "
      mc alias set t $S3EP $S3AK $S3SK >/dev/null 2>&1 &&
      mc mb -p t/quanly-test >/dev/null 2>&1;
      mc anonymous set none t/quanly-test >/dev/null 2>&1; true" >/dev/null 2>&1
  fi
  echo "▶ [1/3] tạo DB test sạch (quanly_test)"
  docker exec quanly-postgres psql -U "$PGUSER" -d "$PGUSER" -c "DROP DATABASE IF EXISTS quanly_test;" >/dev/null 2>&1
  docker exec quanly-postgres psql -U "$PGUSER" -d "$PGUSER" -c "CREATE DATABASE quanly_test;" >/dev/null 2>&1

  echo "▶ [2/3] cài deps + migrate + chạy test (container node:22 trên mạng $NET)"
  docker run --rm --network "$NET" -v "$DIR":/app -w /app \
    -e DATABASE_URL="postgresql://$PGUSER:$PGPASS@quanly-postgres:5432/quanly_test?schema=public" \
    -e REDIS_URL="$REDIS" \
    -e SESSION_SECRET="ondev-test-secret-needs-to-be-at-least-32-characters-long-ok" \
    -e NODE_ENV="test" -e REQUIRE_DB_TESTS="1" \
    -e S3_ENDPOINT="$S3EP" -e S3_ACCESS_KEY="$S3AK" -e S3_SECRET_KEY="$S3SK" \
    -e S3_BUCKET="quanly-test" -e S3_REGION="us-east-1" -e S3_FORCE_PATH_STYLE="true" \
    -e PII_ENC_KEY="$PIIK" \
    -e APP_BASE_URL="http://localhost:3000" -e PORT="3000" \
    node:22-alpine sh -c "
      apk add --no-cache openssl libc6-compat >/dev/null 2>&1 &&
      npm ci >/dev/null 2>&1 &&
      npx prisma generate >/dev/null 2>&1 &&
      npx prisma migrate deploy >/dev/null 2>&1 &&
      npm run test:run > /tmp/quanly-vitest.log 2>&1
      code=\$?
      tail -20 /tmp/quanly-vitest.log 2>/dev/null || true
      rm -rf node_modules 2>/dev/null
      exit \$code
    "
  rc=$?

  echo "▶ [3/3] dọn DB test"
  docker exec quanly-postgres psql -U "$PGUSER" -d "$PGUSER" -c "DROP DATABASE IF EXISTS quanly_test;" >/dev/null 2>&1
  exit $rc
'
echo "✅ xong (exit $?)"
