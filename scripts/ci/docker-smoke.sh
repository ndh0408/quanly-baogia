#!/usr/bin/env bash
# ============================================================================
# docker-smoke.sh — DỰNG IMAGE PRODUCTION TỪ MÃ HIỆN TẠI, RỒI GIAO CHO smoke-image.sh CHẠY THẬT.
#
#   bash scripts/ci/docker-smoke.sh            # dựng + smoke
#   bash scripts/ci/docker-smoke.sh --chi-dung # chỉ dựng
#
# ── PHÂN VAI, ĐỂ KHÔNG CÓ HAI BẢN GẦN GIỐNG NHAU ───────────────────────────
# `scripts/ci/smoke-image.sh` đã tồn tại từ trước và là nơi DUY NHẤT chứa các khẳng định về image:
# nó tự dựng Postgres + Redis riêng trên một mạng docker riêng rồi chạy image thật trên đó. CI gọi
# nó ở ba chỗ (`.github/workflows/ci.yml`).
#
# Nó nhận image qua biến `IMAGE` và KHÔNG tự dựng. Thiếu đúng một mảnh: trên máy dev không có ai
# dựng image cả, nên trên thực tế nó chỉ chạy trong ci.yml — mà repo này KHÔNG dùng GitHub Actions
# (CI là verify-local.sh). File này lấp đúng mảnh đó và KHÔNG lặp lại bất kỳ khẳng định nào:
#
#   docker-smoke.sh  =  dựng image từ cây làm việc  →  IMAGE=… smoke-image.sh
#
# Thêm một khẳng định về image thì thêm vào smoke-image.sh, KHÔNG thêm vào đây — như vậy CI và máy
# dev luôn kiểm cùng một danh sách.
#
# ── PROXY MITM ─────────────────────────────────────────────────────────────
# Máy build nằm sau proxy chặn-và-ký-lại TLS thì `npm ci` / `apk add` TRONG container trượt xác
# thực chứng chỉ (đo được: "certificate verify failed"). Script tự dựng một ảnh nền có sẵn CA đó
# rồi truyền qua `--build-arg NODE_IMAGE`. CA KHÔNG nằm trong Dockerfile: nó là chuyện của MỘT máy
# build, không phải của image. Không có proxy thì nhánh này không chạy.
# ============================================================================
set -uo pipefail
cd "$(dirname "$0")/../.."

ANH="${SMOKE_IMAGE:-quanly:smoke}"
CHI_DUNG=0
[ "${1:-}" = "--chi-dung" ] && CHI_DUNG=1

buoc() { printf '\n\033[1m▶ %s\033[0m\n' "$1"; }

command -v docker >/dev/null 2>&1 || { printf '\033[31mDỪNG: không có docker trên máy này.\033[0m\n'; exit 1; }
docker info >/dev/null 2>&1 || { printf '\033[31mDỪNG: docker daemon không chạy (thử: dockerd &).\033[0m\n'; exit 1; }

# ── Ảnh nền: chèn CA của proxy MITM nếu máy này nằm sau một cái ─────────────
# ĐỌC từ chính Dockerfile, không chép cứng: bản trước ghi `NEN="node:22-alpine"` ở đây rồi TRUYỀN nó
# qua --build-arg — tức smoke dựng image trên một ảnh nền KHÁC ảnh mà Dockerfile (và production) dùng,
# và đổi ARG NODE_IMAGE trong Dockerfile không hề đổi thứ được smoke (audit 2026-09-22, DEP-04).
NEN="$(sed -n 's/^ARG NODE_IMAGE=//p' Dockerfile | head -1)"
[ -n "$NEN" ] || { printf '\033[31mDỪNG: không đọc được ARG NODE_IMAGE trong Dockerfile.\033[0m\n'; exit 1; }
CA="${SMOKE_CA_BUNDLE:-/root/.ccr/ca-bundle.crt}"
if [ -f "$CA" ]; then
  TAM="$(mktemp -d)"
  cp "$CA" "$TAM/ca.crt"
  # `apk` và `wget` của alpine đọc /etc/ssl/certs/ca-certificates.crt; Node đọc NODE_EXTRA_CA_CERTS.
  # NỐI THÊM chứ không thay, để CA công cộng vẫn còn.
  printf 'FROM %s\n' "$NEN" > "$TAM/Dockerfile"
  cat >> "$TAM/Dockerfile" <<'EOF'
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
if docker build --build-arg NODE_IMAGE="$NEN" -t "$ANH" . >/dev/null 2>&1; then
  printf '  \033[32m✓ docker build → %s\033[0m\n' "$ANH"
else
  printf '  \033[31m✗ docker build (chạy lại không có >/dev/null để xem log)\033[0m\n'
  exit 1
fi

[ "$CHI_DUNG" -eq 1 ] && { printf '\n(--chi-dung: bỏ phần chạy)\n'; exit 0; }

buoc "[D2] Giao cho scripts/ci/smoke-image.sh — mọi khẳng định về image nằm ở đó"
IMAGE="$ANH" bash scripts/ci/smoke-image.sh
ma=$?

# ── [D3] QUÉT LỖ HỔNG CỦA CHÍNH IMAGE (audit 2026-09-22, INFRA-11) ─────────────────────────
# Trước bước này, gói OS của alpine (openssl, musl, postgresql16-client…) và tầng nền Node KHÔNG được
# quét ở bất kỳ đường nào đang chạy: security-scan.sh chỉ `trivy fs` (cây làm việc), còn bước quét
# image chỉ nằm trong ci.yml — mà Actions không dùng. CVE ở base image trôi theo mỗi lần dựng.
#
# CỔNG CỨNG cho: gói OS + node_modules của ỨNG DỤNG (HIGH/CRITICAL có bản vá, trừ .trivyignore.yaml).
# CHỈ CẢNH BÁO cho npm ĐI KÈM ảnh node (usr/local/lib/node_modules/npm): đo 2026-09-23 trên
# node:24.21.0-alpine có 4 HIGH (brace-expansion, ip-address, tar) — nằm trong ảnh gốc, repo không
# vá được bằng mã; cách xử lý là nâng NODE_IMAGE khi node phát hành bản kèm npm đã vá. Không tách
# ra thì cổng đỏ thường trực vì thứ ngoài tầm tay, và cổng đỏ thường trực là cổng sẽ bị tắt.
if [ "$ma" -eq 0 ]; then
  buoc "[D3] Quét lỗ hổng image (trivy image — gói OS + phụ thuộc ứng dụng)"
  if command -v trivy >/dev/null 2>&1; then
    if trivy image --quiet --scanners vuln --severity HIGH,CRITICAL --ignore-unfixed \
         --ignorefile .trivyignore.yaml --skip-dirs usr/local/lib/node_modules/npm \
         --exit-code 1 "$ANH"; then
      printf '  \033[32m✓ không có HIGH/CRITICAL có bản vá trong gói OS + node_modules ứng dụng\033[0m\n'
    else
      printf '  \033[31m✗ image có lỗ hổng HIGH/CRITICAL có bản vá (bảng ở trên)\033[0m\n'
      ma=1
    fi
    n_npm="$(trivy image --quiet --scanners vuln --severity HIGH,CRITICAL --ignore-unfixed --format json "$ANH" 2>/dev/null \
      | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);let n=0;for(const r of j.Results||[])for(const v of r.Vulnerabilities||[])if(/usr\/local\/lib\/node_modules\/npm\//.test(v.PkgPath||""))n++;console.log(n)}catch{console.log("?")}})')"
    [ "$n_npm" = "0" ] || printf '  \033[33m⚠ npm đi kèm ảnh node có %s lỗ hổng HIGH/CRITICAL — nâng NODE_IMAGE khi có bản vá (xem chú thích [D3])\033[0m\n' "$n_npm"
  else
    printf '  \033[33m— trivy chưa cài trên máy này: bỏ qua quét image (cài: winget install AquaSecurity.Trivy)\033[0m\n'
  fi
fi

if [ "$ma" -eq 0 ]; then
  printf '\n\033[32m✅ SMOKE IMAGE XANH\033[0m\n'
else
  printf '\n\033[31m❌ SMOKE IMAGE ĐỎ\033[0m\n'
fi
exit "$ma"
