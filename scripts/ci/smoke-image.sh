#!/usr/bin/env bash
# smoke-image.sh — chạy THẬT image vừa dựng và kiểm nó boot được, trước khi coi bản build là dùng được.
#
# Trước đây CI dựng image xong là đẩy thẳng lên registry. Một image không boot được (thiếu file
# entrypoint, thiếu tài nguyên, sai quyền) vẫn lên registry và chỉ vỡ khi deploy vào production.
set -euo pipefail

: "${IMAGE:?cần biến IMAGE (repo@sha256:... hoặc repo:tag)}"

NET=quanly-smoke-net
PG=quanly-smoke-pg
RD=quanly-smoke-redis
APP=quanly-smoke-app
WRK=quanly-smoke-worker

cleanup() {
  docker logs "$APP" 2>&1 | tail -40 || true
  docker rm -f "$APP" "$WRK" "$PG" "$RD" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker network create "$NET" >/dev/null

docker run -d --name "$PG" --network "$NET" \
  -e POSTGRES_USER=quanly -e POSTGRES_PASSWORD=smoke -e POSTGRES_DB=quanly \
  --health-cmd "pg_isready -U quanly -d quanly" --health-interval 3s --health-retries 20 \
  postgres:16-alpine >/dev/null

docker run -d --name "$RD" --network "$NET" redis:7-alpine >/dev/null

echo "▶ chờ Postgres sẵn sàng"
for i in $(seq 1 40); do
  [ "$(docker inspect -f '{{.State.Health.Status}}' "$PG")" = healthy ] && break
  sleep 2
done

ENVS=(
  -e NODE_ENV=production
  -e PORT=3000
  -e DATABASE_URL="postgresql://quanly:smoke@${PG}:5432/quanly?schema=public"
  -e REDIS_URL="redis://${RD}:6379"
  -e SESSION_SECRET=smoke-session-secret-long-enough-for-the-validator
  -e JWT_SECRET=smoke-jwt-secret-different-from-session-and-long-enough
  -e MFA_ENC_KEY=smoke-mfa-encryption-key-for-ci-only
  -e APP_BASE_URL=http://localhost:3000
)

echo "▶ migrate schema bằng CHÍNH image (chứng minh prisma CLI có trong image production)"
docker run --rm --network "$NET" "${ENVS[@]}" "$IMAGE" npx prisma migrate deploy

echo "▶ khởi động app bằng CMD mặc định của image"
docker run -d --name "$APP" --network "$NET" "${ENVS[@]}" "$IMAGE" >/dev/null

echo "▶ chờ /livez"
ok=0
for i in $(seq 1 45); do
  if docker exec "$APP" wget -q -O - http://127.0.0.1:3000/livez 2>/dev/null | grep -q '"ok":true'; then ok=1; break; fi
  docker inspect -f '{{.State.Running}}' "$APP" | grep -q true || { echo "::error::container app đã thoát"; exit 1; }
  sleep 2
done
[ "$ok" = 1 ] || { echo "::error::/livez không phản hồi trong image"; exit 1; }

echo "▶ /readyz (chạm DB thật)"
docker exec "$APP" wget -q -O - http://127.0.0.1:3000/readyz | grep -q '"ok":true' \
  || { echo "::error::/readyz thất bại trong image"; exit 1; }

echo "▶ PHÔNG CHỮ PDF có trong image (thiếu là PDF mất dấu tiếng Việt, im lặng)"
docker exec "$APP" sh -c 'test -f fonts/Times.ttf && test -f fonts/Times-Bold.ttf' \
  || { echo "::error::image thiếu phông Unicode — PDF sẽ mất dấu tiếng Việt"; exit 1; }

echo "▶ image KHÔNG được chứa mã nguồn .ts (chỉ artifact đã biên dịch)"
docker exec "$APP" sh -c '[ ! -d src ]' \
  || { echo "::error::image vẫn chứa src/ — bề mặt image phình và runtime dễ chạy nhầm mã chưa biên dịch"; exit 1; }

echo "▶ container chạy bằng người dùng KHÔNG phải root"
uid=$(docker exec "$APP" id -u)
[ "$uid" != "0" ] || { echo "::error::container chạy bằng root"; exit 1; }

echo "▶ worker khởi động được từ cùng image"
docker run -d --name "$WRK" --network "$NET" "${ENVS[@]}" -e WORKER_MODE=true \
  "$IMAGE" node dist/worker.js >/dev/null
sleep 12
docker logs "$WRK" 2>&1 | grep -q 'worker registered' \
  || { echo "::error::worker không đăng ký được hàng đợi"; docker logs "$WRK" 2>&1 | tail -30; exit 1; }

echo "✅ smoke test image PASS"
