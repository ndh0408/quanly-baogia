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

echo "▶ CMD của image đúng là \`node dist/server.js\` (chung một artifact với Helm/k8s/compose)"
cmd=$(docker image inspect "$IMAGE" --format '{{join .Config.Cmd " "}}')
[ "$cmd" = "node dist/server.js" ] \
  || { echo "::error::CMD của image là \"$cmd\", không phải \"node dist/server.js\""; exit 1; }

echo "▶ bốn điểm vào đã biên dịch có mặt trong dist/"
docker exec "$APP" sh -c 'for f in dist/server.js dist/worker.js dist/exportWorker.js dist/importWorker.js; do test -f "$f" || exit 1; done' \
  || { echo "::error::image thiếu một trong bốn điểm vào dist/"; exit 1; }

echo "▶ SPA React (public/app2) NẰM TRONG image — đây là giao diện DUY NHẤT của hệ thống"
docker exec "$APP" sh -c 'test -f public/app2/index.html && ls public/app2/assets/*.js >/dev/null 2>&1' \
  || { echo "::error::image thiếu bản build của web/ — người dùng sẽ thấy màn hình trắng"; exit 1; }

echo "▶ SPA PHỤC VỤ ĐƯỢC qua HTTP, không chỉ nằm trong image"
# Nằm trong image mà express.static/route fallback sai thì vẫn là màn hình trắng. Đòi cả HTML lẫn
# đường dẫn bundle đã băm.
trang=$(docker exec "$APP" wget -q -O - http://127.0.0.1:3000/app2/ 2>/dev/null || true)
printf '%s' "$trang" | grep -qi '<div id="root"' \
  || { echo "::error::GET /app2/ không trả HTML của SPA"; exit 1; }
printf '%s' "$trang" | grep -q '/app2/assets/' \
  || { echo "::error::HTML của SPA không tham chiếu bundle đã băm — bản build hỏng"; exit 1; }

echo "▶ mẫu Excel (templates/) nằm trong image"
docker exec "$APP" sh -c 'ls templates/*.xls* >/dev/null 2>&1' \
  || { echo "::error::image thiếu templates/ — xuất Excel sẽ hỏng"; exit 1; }

echo "▶ prisma CLI còn trong image (compose/helm gọi \`migrate deploy\` lúc khởi động)"
docker exec "$APP" sh -c 'test -x node_modules/.bin/prisma' \
  || { echo "::error::--omit=dev đã loại mất prisma CLI — deploy sẽ chết ở bước migrate"; exit 1; }

echo "▶ KHÔNG có bộ đồ nghề test/lint trong image production"
# typescript và tsx CÓ mặt hợp lệ: `tsx` khai ở dependencies, `typescript` là phụ thuộc bắc cầu
# của prisma/@prisma/client. Chỉ soi những gói chỉ dùng lúc phát triển.
docker exec "$APP" sh -c 'for m in vitest eslint supertest prettier husky; do test -d "node_modules/$m" && exit 1; done; exit 0' \
  || { echo "::error::image production chứa bộ đồ nghề test/lint"; exit 1; }

echo "▶ LOG KHỞI ĐỘNG KHÔNG ĐƯỢC CÓ VẾT STACK"
# Từng có 15 vết "express-rate-limit: async error during store initialization" ở MỖI lần khởi động
# (rate-limit-redis bắn SCRIPT LOAD lúc ioredis chưa nối xong, mà kết nối đó cố ý không xếp hàng
# ngoại tuyến). Không hỏng chức năng, nhưng 157 dòng stack ở đầu log thì che mất lỗi thật.
# Vá ở src/rateLimit.ts (`rateLimitRedisSanSang`); chốt này giữ cho nó không quay lại.
log=$(docker logs "$APP" 2>&1)
nstack=$(printf '%s\n' "$log" | grep -cE '^[[:space:]]+at .+\(.*:[0-9]+:[0-9]+\)' || true)
if [ "$nstack" != "0" ]; then
  echo "::error::log khởi động có $nstack dòng stack-trace — một ngoại lệ đang bị in ra lúc boot"
  printf '%s\n' "$log" | grep -E '^[[:space:]]+at |Error' | head -12
  exit 1
fi

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
