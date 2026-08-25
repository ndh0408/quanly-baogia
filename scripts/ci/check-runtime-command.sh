#!/usr/bin/env bash
# check-runtime-command.sh — MỌI đường triển khai phải khởi động cùng MỘT artifact.
#
# Sự cố có thật đã sinh ra kiểm tra này: Dockerfile chạy `node --import tsx src/server.js`, còn
# Helm chart và infra/k8s/app.yaml chạy `node src/server.js`. File `src/server.js` KHÔNG TỒN TẠI
# (mã nguồn là .ts). Mọi pod k8s chết vòng lặp ngay lần deploy đầu, mà không một bước CI nào phát
# hiện — chart chưa từng được render, manifest chưa từng được đối chiếu với Dockerfile.
#
# Kiểm tra này rẻ và bắt đúng lớp lỗi đó: chặn mọi lệnh khởi động trỏ vào `src/`, và bắt buộc
# Dockerfile/compose/chart/manifest cùng gọi `dist/server.js` hoặc `dist/worker.js`.
set -euo pipefail

cd "$(dirname "$0")/../.."
fail=0
err() { echo "::error::$*"; fail=1; }

echo "▶ Dockerfile CMD trỏ dist/"
grep -qE '^CMD \["node", *"dist/server\.js"\]' Dockerfile \
  || err "Dockerfile CMD không phải [\"node\",\"dist/server.js\"]"

echo "▶ không còn nơi nào khởi động từ src/"
# Chỉ soi các file triển khai. `npm run dev` (tsx watch src/server.ts) là của môi trường phát triển,
# không nằm trong danh sách này.
DEPLOY_FILES=(
  Dockerfile
  docker-compose.yml docker-compose.staging.yml docker-compose.prod.yml
  infra/k8s/app.yaml infra/k8s/worker.yaml
  infra/helm/quanly/templates/app-deployment.yaml
  infra/helm/quanly/templates/worker-deployment.yaml
)
for f in "${DEPLOY_FILES[@]}"; do
  [ -f "$f" ] || continue
  # Bỏ dòng chú thích trước khi soi, để phần giải thích lịch sử ("bản trước gọi src/worker.js")
  # không tự làm đỏ chính kiểm tra này.
  if sed 's/#.*//' "$f" | grep -nE '(node|tsx)[^#]*src/(server|worker)\.(js|ts)' ; then
    err "$f vẫn khởi động từ src/ — production chạy artifact đã biên dịch trong dist/"
  fi
done

echo "▶ worker khởi động bằng dist/worker.js ở mọi nơi"
for f in docker-compose.staging.yml docker-compose.prod.yml \
         infra/k8s/worker.yaml infra/helm/quanly/templates/worker-deployment.yaml; do
  [ -f "$f" ] || continue
  grep -q 'dist/worker\.js' "$f" || err "$f không gọi dist/worker.js"
done

echo "▶ app khởi động bằng dist/server.js ở mọi manifest có khai lệnh"
for f in infra/k8s/app.yaml infra/helm/quanly/templates/app-deployment.yaml; do
  [ -f "$f" ] || continue
  grep -q 'dist/server\.js' "$f" || err "$f không gọi dist/server.js"
done

echo "▶ package.json start/worker trỏ dist/"
node -e '
  const p = require("./package.json");
  const bad = [];
  if (p.scripts.start !== "node dist/server.js") bad.push("start=" + p.scripts.start);
  if (p.scripts.worker !== "node dist/worker.js") bad.push("worker=" + p.scripts.worker);
  if (p.main !== "dist/server.js") bad.push("main=" + p.main);
  if (bad.length) { console.error("::error::package.json lệch: " + bad.join(", ")); process.exit(1); }
'

if [ "$fail" -ne 0 ]; then
  echo "::error::lệnh khởi động giữa các đường triển khai KHÔNG khớp nhau"
  exit 1
fi
echo "✅ mọi đường triển khai dùng chung một artifact"
