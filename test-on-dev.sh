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
      # ── CHUẨN BỊ: mỗi bước tự báo, KHÔNG nối bằng && ─────────────────────────
      # Trước đây cả khối là một chuỗi \`a && b && c && npm run test:run\`, nên một bước hỏng ở
      # giữa làm vitest KHÔNG chạy mà mã thoát vẫn có thể là 0 — cổng báo XANH trong khi không
      # kiểm gì. Đã xảy ra thật (2026-09-01). Nay từng bước tự báo, và có chốt \`test -s\` để một
      # lượt không-chạy-được không bao giờ đi qua thành công.
      #
      # Danh sách dưới đây là thứ bộ test ĐÒI ngoài node. Thiếu cái nào là file đỏ mà KHÔNG phải
      # lỗi code — đo được đúng 14 file: pg_dump · bash · redis nghe ở CHÍNH localhost (hai bài
      # hàng đợi tự đặt REDIS_URL=redis://127.0.0.1:6379/<db> để không đụng Redis thật của dev) ·
      # phông DejaVu · dist/ · public/app2/ · helm · git (tests/xg-doc-numbers đếm số liệu
      # tài liệu bằng `git ls-files`; thiếu git thì nó chết ở bước collect, không phải đỏ một bài) ·
      # findutils (scripts/backup/backup-objects.sh dùng `find -printf` của GNU; busybox không có
      # cờ đó nên script ngã — máy chủ thật chạy GNU findutils 4.10 nên đây thuần là chuyện container).
      set -u
      apk add --no-cache openssl libc6-compat bash postgresql16-client redis font-dejavu curl tar git findutils >/dev/null 2>&1 || { echo HONG_apk_add; exit 90; }
      redis-server --daemonize yes --save \"\" --appendonly no >/dev/null 2>&1 || echo CANH_BAO_khong_bat_duoc_redis_cuc_bo

      # helm: chỉ cần binary — các bài chỉ chạy helm lint / helm template, không cần cluster.
      if curl -fsSL -m 90 https://get.helm.sh/helm-v3.16.3-linux-amd64.tar.gz -o /tmp/h.tgz 2>/dev/null; then
        tar xzf /tmp/h.tgz -C /tmp 2>/dev/null && install -m 0755 /tmp/linux-amd64/helm /usr/local/bin/helm 2>/dev/null
      fi
      command -v helm >/dev/null || echo CANH_BAO_khong_co_helm_cac_bai_helm_se_do

      # Phông cho PDF: image production chép DejaVuSerif thành fonts/Times.ttf (Dockerfile), bộ
      # test phải thấy ĐÚNG phông đó thì con số bố cục mới là con số thật.
      mkdir -p fonts
      cp /usr/share/fonts/dejavu/DejaVuSerif.ttf        fonts/Times.ttf        2>/dev/null
      cp /usr/share/fonts/dejavu/DejaVuSerif-Bold.ttf   fonts/Times-Bold.ttf   2>/dev/null
      cp /usr/share/fonts/dejavu/DejaVuSerif-Italic.ttf fonts/Times-Italic.ttf 2>/dev/null

      npm ci >/dev/null 2>&1                    || { echo HONG_npm_ci; exit 91; }
      npx prisma generate >/dev/null 2>&1       || { echo HONG_prisma_generate; exit 92; }
      npx prisma migrate deploy >/dev/null 2>&1 || { echo HONG_prisma_migrate; exit 93; }
      # dist/: bốn bài PII chạy node dist/tools/piiRotate.js ở tiến trình riêng, và một bài đòi
      # dist/ MỚI HƠN src/ — nếu không, chúng kiểm bản biên dịch của lần trước và xanh giả.
      npm run build >/dev/null 2>&1             || { echo HONG_npm_run_build; exit 94; }
      # public/app2/: bộ test dựng app THẬT rồi gọi GET /; không có bản build giao diện thì route
      # SPA trả 404 và các bài phục vụ tĩnh đỏ oan.
      ( cd web && npm ci >/dev/null 2>&1 && npm run build >/dev/null 2>&1 ) || { echo HONG_build_web; exit 95; }

      npm run test:run > /tmp/quanly-vitest.log 2>&1
      code=\$?
      # Chốt: log rỗng nghĩa là vitest chưa từng chạy — không được đi qua thành công.
      test -s /tmp/quanly-vitest.log || { echo HONG_vitest_khong_chay_log_rong; code=96; }

      echo ===== FILE DO =====
      grep -a \"FAIL \" /tmp/quanly-vitest.log | sed \"s/ > .*//\" | sort -u
      echo ===== LY DO =====
      grep -aE \"AssertionError|Error:|ENOENT|not found|Cannot find|ECONNREFUSED\" /tmp/quanly-vitest.log | sed \"s/^ *//\" | cut -c1-160 | sort -u | head -12
      echo ===== TONG KET =====
      grep -aE \"Test Files|^ +Tests \" /tmp/quanly-vitest.log | tail -4
      echo ===== EXIT=\$code =====

      # Thư mục mã nguồn được mount THẲNG từ VM (không phải bản sao) — mọi thứ vừa dựng phải dọn,
      # nếu không lần deploy sau ship nhầm artefact của bộ test.
      rm -rf node_modules web/node_modules dist public/app2 fonts/Times.ttf fonts/Times-Bold.ttf fonts/Times-Italic.ttf 2>/dev/null
      exit \$code
    "
  rc=$?

  echo "▶ [3/3] dọn DB test"
  docker exec quanly-postgres psql -U "$PGUSER" -d "$PGUSER" -c "DROP DATABASE IF EXISTS quanly_test;" >/dev/null 2>&1
  exit $rc
'
echo "✅ xong (exit $?)"
