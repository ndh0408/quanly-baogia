#!/usr/bin/env bash
# ============================================================================
# docker-smoke.sh — DỰNG IMAGE PRODUCTION RỒI CHẠY THẬT, TRÊN MÁY NÀY.
#
#   bash scripts/ci/docker-smoke.sh            # dựng + chạy + kiểm
#   bash scripts/ci/docker-smoke.sh --chi-dung # chỉ dựng, bỏ phần chạy
#
# ── VÌ SAO CẦN ─────────────────────────────────────────────────────────────
# Mọi cổng khác trong repo này kiểm MÃ NGUỒN. Không cổng nào kiểm ARTIFACT ĐƯỢC TRIỂN KHAI.
# Khoảng trống đó đã từng nuốt những lỗi chỉ lộ ra lúc pod khởi động:
#   · Helm/k8s gọi `node src/server.js` — file KHÔNG tồn tại trong image (pod chết vòng lặp);
#   · `postinstall` gọi một script chưa được COPY vào → `npm ci` gãy nguyên lượt build;
#   · fonts/*.ttf bị .gitignore loại → PDF production MẤT DẤU TIẾNG VIỆT.
# Cả ba đều XANH ở mọi cổng đọc mã nguồn. Chỉ dựng image ra rồi chạy mới thấy.
#
# ── CHẠY BẰNG `--network host` ─────────────────────────────────────────────
# Postgres trên máy này chỉ nghe 127.0.0.1, container qua cầu docker không với tới được.
# `--network host` là cách gọn nhất để smoke dùng ĐÚNG hạ tầng mà bộ test vẫn dùng, thay vì
# dựng thêm một bộ Postgres/Redis thứ hai chỉ để chạy vài giây.
#
# ── PROXY MITM ─────────────────────────────────────────────────────────────
# Máy build nằm sau proxy chặn-và-ký-lại TLS thì `npm ci`/`apk add` TRONG container trượt xác
# thực chứng chỉ (đo được: "certificate verify failed"). Script tự dựng một ảnh nền có sẵn CA đó
# rồi truyền qua --build-arg NODE_IMAGE. CA KHÔNG nằm trong Dockerfile: nó là chuyện của MỘT máy
# build, không phải của image. Không có proxy thì nhánh này không chạy.
# ============================================================================
set -uo pipefail
cd "$(dirname "$0")/../.."

ANH="${SMOKE_IMAGE:-quanly:smoke}"
TEN="${SMOKE_CONTAINER:-quanly-smoke}"
CONG="${SMOKE_PORT:-31300}"
CHI_DUNG=0
[ "${1:-}" = "--chi-dung" ] && CHI_DUNG=1

do=0
buoc() { printf '\n\033[1m▶ %s\033[0m\n' "$1"; }
ket()  { if [ "$1" -eq 0 ]; then printf '  \033[32m✓ %s\033[0m\n' "$2"; else printf '  \033[31m✗ %s\033[0m\n' "$2"; do=1; fi; }

don_dep() { docker rm -f "$TEN" >/dev/null 2>&1 || true; }
trap don_dep EXIT

command -v docker >/dev/null 2>&1 || { printf '\033[31mDỪNG: không có docker trên máy này.\033[0m\n'; exit 1; }
docker info >/dev/null 2>&1 || { printf '\033[31mDỪNG: docker daemon không chạy (thử: dockerd &).\033[0m\n'; exit 1; }

# ── ẢNH NỀN: chèn CA của proxy MITM nếu máy này nằm sau một cái ─────────────
NEN="node:22-alpine"
CA="${SMOKE_CA_BUNDLE:-/root/.ccr/ca-bundle.crt}"
if [ -f "$CA" ]; then
  TAM="$(mktemp -d)"
  cp "$CA" "$TAM/ca.crt"
  # Cả `apk` lẫn `wget` của alpine đọc /etc/ssl/certs/ca-certificates.crt; Node đọc
  # NODE_EXTRA_CA_CERTS. Nối thêm chứ KHÔNG thay, để CA công cộng vẫn còn.
  cat > "$TAM/Dockerfile" <<'EOF'
FROM node:22-alpine
COPY ca.crt /usr/local/share/ca-certificates/agent-proxy.crt
RUN cat /usr/local/share/ca-certificates/agent-proxy.crt >> /etc/ssl/certs/ca-certificates.crt
ENV NODE_EXTRA_CA_CERTS=/usr/local/share/ca-certificates/agent-proxy.crt
EOF
  if docker build -q -t quanly-node-ca:local "$TAM" >/dev/null 2>&1; then
    NEN="quanly-node-ca:local"
    printf '  \033[33m— máy này có CA proxy, dùng ảnh nền quanly-node-ca:local\033[0m\n'
  fi
  rm -rf "$TAM"
fi

buoc "[D1] Dựng image production từ Dockerfile"
docker build --build-arg NODE_IMAGE="$NEN" -t "$ANH" . >/dev/null 2>&1
ket $? "docker build (nếu đỏ: chạy lại không có >/dev/null để xem log)"
[ "$do" -eq 0 ] || exit 1

buoc "[D2] Bất biến của image (không cần chạy)"
# `docker inspect` đọc metadata; phần còn lại chạy `sh` một lượt trong image.
kq=$(docker image inspect "$ANH" --format '{{.Config.User}}|{{join .Config.Cmd " "}}|{{join .Config.Entrypoint " "}}')
[ "${kq%%|*}" = "app" ]
ket $? "chạy bằng user thường (app), không phải root — thật: ${kq%%|*}"
case "$kq" in *"|node dist/server.js|"*) true ;; *) false ;; esac
ket $? "CMD là \`node dist/server.js\` — cùng một artifact với Helm/k8s/compose"

docker run --rm --entrypoint sh "$ANH" -c '
  set -e
  for f in dist/server.js dist/worker.js dist/exportWorker.js dist/importWorker.js; do test -f "$f"; done
' >/dev/null 2>&1
ket $? "bốn điểm vào đã biên dịch có mặt trong dist/"

docker run --rm --entrypoint sh "$ANH" -c 'test -f public/app2/index.html && ls public/app2/assets/*.js >/dev/null 2>&1' >/dev/null 2>&1
ket $? "SPA React (public/app2) NẰM TRONG image — giao diện duy nhất của hệ thống"

docker run --rm --entrypoint sh "$ANH" -c 'test -f fonts/Times.ttf && test -f fonts/Times-Bold.ttf && test -f fonts/Times-Italic.ttf' >/dev/null 2>&1
ket $? "phông PDF có mặt (thiếu là PDF production MẤT DẤU tiếng Việt)"

docker run --rm --entrypoint sh "$ANH" -c 'ls templates/*.xls* >/dev/null 2>&1' >/dev/null 2>&1
ket $? "mẫu Excel (templates/) nằm trong image"

# `src/` lọt vào image nghĩa là ai đó lại nối runtime vào tsx — đúng thứ vừa gỡ bỏ.
docker run --rm --entrypoint sh "$ANH" -c '! test -d src' >/dev/null 2>&1
ket $? "KHÔNG có src/ trong image (runtime chạy dist/, không qua tsx)"

# typescript/tsx CÓ trong cây production một cách hợp lệ: `tsx` khai ở dependencies,
# `typescript` là phụ thuộc bắc cầu của prisma/@prisma/client. Chỉ soi bộ đồ nghề TEST.
docker run --rm --entrypoint sh "$ANH" -c '
  for m in vitest eslint supertest prettier husky; do test -d "node_modules/$m" && exit 1; done; exit 0
' >/dev/null 2>&1
ket $? "không có bộ đồ nghề test/lint trong image production"

# compose/helm/k8s đều chạy `prisma migrate deploy` lúc khởi động. `--omit=dev` mà loại mất
# prisma CLI thì hỏng CHỈ ở production, và chỉ lúc deploy.
docker run --rm --entrypoint sh "$ANH" -c 'test -x node_modules/.bin/prisma' >/dev/null 2>&1
ket $? "prisma CLI còn trong image (compose/helm gọi \`migrate deploy\` lúc khởi động)"

[ "$CHI_DUNG" -eq 1 ] && { printf '\n(--chi-dung: bỏ phần chạy)\n'; exit "$do"; }

# ── Phần chạy: cần hạ tầng test ────────────────────────────────────────────
: "${DATABASE_URL:=postgresql://quanly:quanly_pwd@127.0.0.1:5432/quanly_test?schema=public}"
: "${REDIS_URL:=redis://127.0.0.1:6379}"
: "${S3_ENDPOINT:=http://127.0.0.1:9000}"
: "${S3_ACCESS_KEY:=minioadmin}"
: "${S3_SECRET_KEY:=minioadmin}"
: "${S3_BUCKET:=quanly-test}"

buoc "[D3] Chạy container ở NODE_ENV=production"
don_dep
# NODE_ENV=production LÀ CHỦ Ý: src/config.ts có một loạt chốt chỉ bật ở production
# (SESSION_SECRET ≥32, JWT_SECRET riêng ≥32, APP_BASE_URL, MFA_ENC_KEY). Chạy smoke ở
# development thì không chốt nào được kiểm — mà đó đúng là những thứ làm deploy chết.
docker run -d --name "$TEN" --network host \
  -e NODE_ENV=production -e PORT="$CONG" \
  -e DATABASE_URL="$DATABASE_URL" -e REDIS_URL="$REDIS_URL" \
  -e S3_ENDPOINT="$S3_ENDPOINT" -e S3_ACCESS_KEY="$S3_ACCESS_KEY" \
  -e S3_SECRET_KEY="$S3_SECRET_KEY" -e S3_BUCKET="$S3_BUCKET" -e S3_FORCE_PATH_STYLE=true \
  -e SESSION_SECRET='smoke-session-secret-du-32-ky-tu-0123456789abcdef' \
  -e JWT_SECRET='smoke-jwt-secret-KHAC-session-du-32-ky-tu-9876543210' \
  -e MFA_ENC_KEY='smoke-mfa-key-16ky+' -e PII_ENC_KEY='smoke-pii-key-16ky+' \
  -e APP_BASE_URL="http://127.0.0.1:$CONG" \
  "$ANH" >/dev/null 2>&1
ket $? "docker run"

san=1
for _ in $(seq 1 45); do
  if [ "$(curl -s --noproxy '*' -o /dev/null -w '%{http_code}' "http://127.0.0.1:$CONG/livez" 2>/dev/null)" = "200" ]; then san=0; break; fi
  # Container chết hẳn thì đừng đợi hết 45 giây mới báo.
  [ "$(docker inspect -f '{{.State.Running}}' "$TEN" 2>/dev/null)" = "true" ] || break
  sleep 1
done
ket "$san" "/livez trả 200"
if [ "$san" -ne 0 ]; then
  printf '\n\033[31m── log container ──\033[0m\n'; docker logs "$TEN" 2>&1 | tail -40
  exit 1
fi

buoc "[D4] Điểm cuối sức khoẻ + SPA"
[ "$(curl -s --noproxy '*' -o /dev/null -w '%{http_code}' "http://127.0.0.1:$CONG/readyz")" = "200" ]
ket $? "/readyz trả 200 (thật sự truy vấn được Postgres)"

# SPA phải PHỤC VỤ ĐƯỢC, không chỉ nằm trong image: một sai sót ở express.static là màn hình trắng.
trang=$(curl -s --noproxy '*' "http://127.0.0.1:$CONG/app2/" 2>/dev/null)
printf '%s' "$trang" | grep -qi '<div id="root"' && printf '%s' "$trang" | grep -q '/app2/assets/'
ket $? "GET /app2/ trả HTML của SPA kèm bundle đã hash"

buoc "[D5] Log khởi động KHÔNG được có vết stack"
# Chốt này khoá bản vá ở src/rateLimit.ts. Trước bản vá: 15 vết
# "express-rate-limit: async error during store initialization" mỗi lần khởi động, vì
# `store.init()` bắn `SCRIPT LOAD` lúc ioredis chưa nối xong. Không hỏng chức năng, nhưng
# 15 vết stack ở đầu log thì che mất lỗi thật — và ai đọc log tưởng rate-limit đang hỏng.
log=$(docker logs "$TEN" 2>&1)
n=$(printf '%s\n' "$log" | grep -c 'async error during store initialization')
[ "$n" -eq 0 ]
ket $? "không có lỗi khởi tạo kho rate-limit (thấy $n vết)"

# Bắt rộng hơn: BẤT KỲ dòng "    at ..." nào cũng là một ngoại lệ được in ra lúc khởi động.
nstack=$(printf '%s\n' "$log" | grep -cE '^[[:space:]]+at .+\(.*:[0-9]+:[0-9]+\)')
[ "$nstack" -eq 0 ]
ket $? "không có dòng stack-trace nào trong log khởi động (thấy $nstack)"
[ "$nstack" -eq 0 ] || printf '%s\n' "$log" | grep -E '^[[:space:]]+at |Error' | head -12

buoc "[D6] \`prisma migrate deploy\` chạy được TỪ TRONG image"
# Đây là lệnh mà compose/helm/k8s gọi lúc khởi động. Nếu `--omit=dev` loại mất prisma CLI hoặc
# prisma.config.ts không nạp được thì hỏng CHỈ ở production, CHỈ lúc deploy — không cổng nào khác thấy.
docker exec -e DATABASE_URL="$DATABASE_URL" "$TEN" node_modules/.bin/prisma migrate deploy >/dev/null 2>&1
ket $? "prisma migrate deploy"

buoc "[D7] Tiến trình worker khởi động được"
# Helm/k8s chạy `node dist/worker.js` trong MỘT deployment riêng, dùng CHÍNH image này.
# Nó chưa từng được chạy thử ở đâu — chỉ được `test -f`.
raw=$(docker exec -e NODE_ENV=production -e DATABASE_URL="$DATABASE_URL" -e REDIS_URL="$REDIS_URL" \
  -e SESSION_SECRET='smoke-session-secret-du-32-ky-tu-0123456789abcdef' \
  -e JWT_SECRET='smoke-jwt-secret-KHAC-session-du-32-ky-tu-9876543210' \
  -e MFA_ENC_KEY='smoke-mfa-key-16ky+' -e APP_BASE_URL="http://127.0.0.1:$CONG" \
  "$TEN" sh -c 'node dist/worker.js & p=$!; sleep 6; kill -0 $p 2>/dev/null && echo SONG || echo CHET; kill $p 2>/dev/null' 2>&1)
printf '%s' "$raw" | grep -q SONG
ket $? "node dist/worker.js còn sống sau 6 giây"
printf '%s' "$raw" | grep -q SONG || printf '%s\n' "$raw" | tail -15

if [ "$do" -eq 0 ]; then
  printf '\n\033[32m✅ SMOKE IMAGE XANH\033[0m\n'
else
  printf '\n\033[31m❌ SMOKE IMAGE ĐỎ\033[0m\n'
fi
exit "$do"
