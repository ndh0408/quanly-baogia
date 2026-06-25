#!/usr/bin/env bash
# test-on-dev.sh — chạy TRỌN bộ test backend (unit + integration, 268 test) trên hạ tầng
# Docker của DEV/STAGING (vì CI GitHub đang khóa billing + Docker Desktop local không khởi được).
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
  NET=$(docker inspect quanly-postgres -f "{{range \$k,\$v := .NetworkSettings.Networks}}{{\$k}}{{end}}")

  echo "▶ [1/3] tạo DB test sạch (quanly_test)"
  docker exec quanly-postgres psql -U "$PGUSER" -d "$PGUSER" -c "DROP DATABASE IF EXISTS quanly_test;" >/dev/null 2>&1
  docker exec quanly-postgres psql -U "$PGUSER" -d "$PGUSER" -c "CREATE DATABASE quanly_test;" >/dev/null 2>&1

  echo "▶ [2/3] cài deps + migrate + chạy test (container node:22 trên mạng $NET)"
  docker run --rm --network "$NET" -v "$DIR":/app -w /app \
    -e DATABASE_URL="postgresql://$PGUSER:$PGPASS@quanly-postgres:5432/quanly_test?schema=public" \
    -e REDIS_URL="$REDIS" \
    -e SESSION_SECRET="ondev-test-secret-needs-to-be-at-least-32-characters-long-ok" \
    -e NODE_ENV="test" -e REQUIRE_DB_TESTS="1" \
    -e APP_BASE_URL="http://localhost:3000" -e PORT="3000" \
    node:22-alpine sh -c "
      apk add --no-cache openssl libc6-compat >/dev/null 2>&1 &&
      npm ci >/dev/null 2>&1 &&
      npx prisma generate >/dev/null 2>&1 &&
      npx prisma migrate deploy >/dev/null 2>&1 &&
      npm run test:run 2>&1 | tail -16
      code=\$?
      rm -rf node_modules 2>/dev/null
      exit \$code
    "
  rc=$?

  echo "▶ [3/3] dọn DB test"
  docker exec quanly-postgres psql -U "$PGUSER" -d "$PGUSER" -c "DROP DATABASE IF EXISTS quanly_test;" >/dev/null 2>&1
  exit $rc
'
echo "✅ xong (exit $?)"
