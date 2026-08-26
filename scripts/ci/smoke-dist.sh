#!/usr/bin/env bash
# smoke-dist.sh — chạy ĐÚNG artifact production (`node dist/server.js` + `node dist/worker.js`) và
# kiểm nó thật sự phục vụ được, TRƯỚC khi dựng image.
#
# VÌ SAO CÓ FILE NÀY: production từng chạy `node --import tsx src/server.js` trong khi Helm/k8s gọi
# `node src/server.js` — file đó không tồn tại, pod chết vòng lặp, và KHÔNG bước CI nào phát hiện vì
# chưa bao giờ có ai chạy thử lệnh khởi động thật. Chuyển sang dist/ còn thêm một lớp rủi ro nữa:
# mã tính đường dẫn tài nguyên bằng `__dirname/..` nên bố trí thư mục đầu ra sai là frontend tĩnh
# 404 sạch mà typecheck vẫn xanh. Cả hai lớp đó chỉ lộ ra khi CHẠY THẬT.
set -euo pipefail

PORT="${PORT:-3999}"
BASE="http://127.0.0.1:${PORT}"
LOG="$(mktemp)"
WLOG="$(mktemp)"
SRV_PID=""
WRK_PID=""

cleanup() {
  [ -n "$SRV_PID" ] && kill "$SRV_PID" 2>/dev/null || true
  [ -n "$WRK_PID" ] && kill "$WRK_PID" 2>/dev/null || true
}
trap cleanup EXIT

fail() {
  echo "::error::$*"
  echo "--- server log ---"; tail -50 "$LOG" || true
  echo "--- worker log ---"; tail -50 "$WLOG" || true
  exit 1
}

echo "▶ build artifact có mặt?"
for f in dist/server.js dist/worker.js dist/exportWorker.js; do
  # KHÔNG dùng dấu backtick trong chuỗi nháy kép: bash coi đó là thay-thế-lệnh và CHẠY THẬT
  # `npm run build` ngay giữa lúc đang báo lỗi.
  [ -f "$f" ] || fail "thiếu $f — 'npm run build' chưa chạy hoặc bố trí đầu ra đã đổi"
done

echo "▶ khởi động node dist/server.js (NODE_ENV=$NODE_ENV)"
node dist/server.js > "$LOG" 2>&1 &
SRV_PID=$!

for i in $(seq 1 40); do
  if curl -fsS "$BASE/livez" >/dev/null 2>&1; then break; fi
  kill -0 "$SRV_PID" 2>/dev/null || fail "server chết khi khởi động"
  sleep 1
done

echo "▶ /livez"
curl -fsS "$BASE/livez" | grep -q '"ok":true' || fail "/livez không trả ok"

echo "▶ /readyz (phải chạm được DB)"
curl -fsS "$BASE/readyz" | grep -q '"ok":true' || fail "/readyz thất bại — không kết nối được Postgres"

echo "▶ /api/health"
curl -fsS "$BASE/api/health" | grep -q '"ok":true' || fail "/api/health thất bại"

# Đường dẫn tài nguyên tĩnh: đây chính là thứ vỡ nếu rootDir/outDir đặt sai (dist/src/... thay vì
# dist/...) — server vẫn "khoẻ" nhưng cả frontend 404.
echo "▶ tài nguyên tĩnh phục vụ được từ dist/ (chứng minh __dirname/../public đúng)"
code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/style.css")
[ "$code" = "200" ] || fail "/style.css trả $code — đường dẫn tĩnh sai sau khi biên dịch"

echo "▶ /metrics phải đòi token khi METRICS_TOKEN đã đặt"
code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/metrics")
[ "$code" = "401" ] || fail "/metrics trả $code, đáng lẽ 401 khi không có token"
curl -fsS -H "Authorization: Bearer ${METRICS_TOKEN}" "$BASE/metrics" | grep -q '^# HELP' \
  || fail "/metrics có token vẫn không trả số liệu"

echo "▶ endpoint đăng nhập sống (401 với thông tin sai — KHÔNG phải 5xx)"
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' \
  -H "Origin: ${APP_BASE_URL}" -d '{"username":"khong-ton-tai","password":"sai"}' "$BASE/api/auth/login")
[ "$code" = "401" ] || fail "/api/auth/login trả $code, đáng lẽ 401"

echo "▶ khởi động node dist/worker.js"
WORKER_MODE=true node dist/worker.js > "$WLOG" 2>&1 &
WRK_PID=$!
for i in $(seq 1 25); do
  grep -q '"msg":"worker registered"' "$WLOG" && break
  kill -0 "$WRK_PID" 2>/dev/null || fail "worker chết khi khởi động"
  sleep 1
done
grep -q '"msg":"worker registered"' "$WLOG" || fail "worker không đăng ký được hàng đợi nào"

echo "▶ worker đóng êm khi nhận SIGTERM"
kill -TERM "$WRK_PID" 2>/dev/null || true
for i in $(seq 1 15); do
  kill -0 "$WRK_PID" 2>/dev/null || break
  sleep 1
done
kill -0 "$WRK_PID" 2>/dev/null && fail "worker không thoát sau SIGTERM (rolling update sẽ bị cắt ngang job)"
WRK_PID=""

echo "✅ smoke test artifact production PASS"
