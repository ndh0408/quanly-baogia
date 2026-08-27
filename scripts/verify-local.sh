#!/usr/bin/env bash
# ============================================================================
# verify-local.sh — CHẠY TOÀN BỘ CỔNG KIỂM NGAY TRÊN MÁY NÀY.
#
#   bash scripts/verify-local.sh          # chạy hết
#   bash scripts/verify-local.sh --nhanh  # bỏ qua build + test web (vòng lặp sửa nhanh)
#
# ── VÌ SAO TỒN TẠI ─────────────────────────────────────────────────────────
# CI trên GitHub KHÔNG chạy được (tài khoản không bật Actions). Nghĩa là mọi câu kiểu
# "cứ đẩy lên, CI sẽ bắt" đều SAI ở repo này: cổng duy nhất thật sự chạy là cổng bạn
# gõ tay. File này gom đúng những gì .github/workflows/ci.yml khai, để một lệnh là đủ.
#
# ── ĐIỂM KHÁC BIỆT QUAN TRỌNG SO VỚI `npm run test:run` ────────────────────
# Đặt REQUIRE_DB_TESTS=1. Không có nó, các bài đụng CSDL hoặc KHO OBJECT tự BỎ QUA khi
# thiếu hạ tầng — và một bài bỏ qua trông y hệt một bài xanh trong dòng tổng kết. Với
# REQUIRE_DB_TESTS=1 thì thiếu hạ tầng là ĐỎ kèm câu nói rõ thiếu cái gì.
# ============================================================================
set -uo pipefail
cd "$(dirname "$0")/.."

NHANH=0
[ "${1:-}" = "--nhanh" ] && NHANH=1

# ── Hạ tầng: BẮT BUỘC, không có thì dừng ngay chứ không chạy rồi bỏ qua âm thầm ──────
: "${DATABASE_URL:=postgresql://quanly:quanly_pwd@127.0.0.1:5432/quanly_test?schema=public}"
: "${REDIS_URL:=redis://127.0.0.1:6379}"
: "${S3_ENDPOINT:=http://127.0.0.1:9000}"
: "${S3_ACCESS_KEY:=minioadmin}"
: "${S3_SECRET_KEY:=minioadmin}"
: "${S3_BUCKET:=quanly-test}"
: "${S3_REGION:=us-east-1}"
: "${S3_FORCE_PATH_STYLE:=true}"
: "${SESSION_SECRET:=verify-local-secret-can-it-nhat-32-ky-tu-de-qua-zod}"
: "${PII_ENC_KEY:=verify-local-pii-key-16+}"
: "${NODE_ENV:=test}"
export DATABASE_URL REDIS_URL S3_ENDPOINT S3_ACCESS_KEY S3_SECRET_KEY S3_BUCKET S3_REGION \
       S3_FORCE_PATH_STYLE SESSION_SECRET PII_ENC_KEY NODE_ENV
export REQUIRE_DB_TESTS=1

do=0
buoc() { printf '\n\033[1m▶ %s\033[0m\n' "$1"; }
ket()  { if [ "$1" -eq 0 ]; then printf '  \033[32m✓ %s\033[0m\n' "$2"; else printf '  \033[31m✗ %s\033[0m\n' "$2"; do=1; fi; }

buoc "[0/9] Hạ tầng"
# `--noproxy '*'`: máy dev đặt HTTPS_PROXY thì curl tới 127.0.0.1 trả 000 và ta chẩn đoán nhầm.
pg_isready -q 2>/dev/null;                                          ket $? "Postgres (nếu đỏ: pg_ctlcluster 16 main start)"
redis-cli ping >/dev/null 2>&1;                                     ket $? "Redis (nếu đỏ: redis-server --daemonize yes)"
curl -fsS --noproxy '*' -o /dev/null "$S3_ENDPOINT/minio/health/live" 2>/dev/null
ket $? "Kho object tại $S3_ENDPOINT (nếu đỏ: minio server /tmp/minio-data --address :9000)"
[ "$do" -eq 0 ] || { printf '\n\033[31mDỪNG: thiếu hạ tầng. Chạy tiếp cũng chỉ ra một dòng "skipped" trông như xanh.\033[0m\n'; exit 1; }

buoc "[1/9] Prisma client + migrate"
npx prisma generate >/dev/null 2>&1;                                ket $? "prisma generate"
npx prisma migrate deploy >/dev/null 2>&1;                          ket $? "prisma migrate deploy"

buoc "[2/9] Typecheck"
npx tsc --noEmit -p tsconfig.json;                                  ket $? "tsc (backend)"
(cd web && npx tsc --noEmit -p tsconfig.json);                      ket $? "tsc (web)"

buoc "[3/9] Lint + format"
npx eslint .;                                                       ket $? "eslint"
npx prettier --check "**/*.{json,css,yml,yaml}" >/dev/null;         ket $? "prettier"

buoc "[4/9] Test backend (REQUIRE_DB_TESTS=1 — bỏ qua = ĐỎ)"
npx vitest run;                                                     ket $? "vitest backend"

if [ "$NHANH" -eq 0 ]; then
  buoc "[5/9] Test web"
  (cd web && npx vitest run);                                       ket $? "vitest web"
  buoc "[6/9] Build"
  npm run build >/dev/null;                                         ket $? "build backend (dist/)"
  (cd web && npx vite build >/dev/null);                            ket $? "build web"
else
  buoc "[5-6/9] Bỏ qua test web + build (--nhanh)"
fi

buoc "[7/9] Cổng số liệu / phân quyền"
node scripts/ci/endpoint-inventory.mjs --check >/dev/null;          ket $? "endpoint-inventory --check (khớp từng dòng ma trận)"
node scripts/ci/endpoint-inventory.mjs --check-guards >/dev/null;   ket $? "endpoint-inventory --check-guards"
node scripts/ci/repo-stats.mjs --check >/dev/null;                  ket $? "repo-stats --check (số liệu README)"

buoc "[8/9] Hạ tầng triển khai"
bash scripts/ci/check-runtime-command.sh >/dev/null;                ket $? "mọi đường triển khai dùng chung artifact dist/"
if command -v helm >/dev/null 2>&1; then
  helm lint infra/helm/quanly >/dev/null;                           ket $? "helm lint"
else
  printf '  \033[33m— helm không có trên máy này, bỏ qua helm lint\033[0m\n'
fi

buoc "[9/9] Phụ thuộc"
# KHÔNG dừng cả lượt vì cổng này: xem docs/REMAINING_RISKS.md — advisory GHSA-ggr8-5vv4-36mx
# đi theo `deepmerge-ts` mà MỌI bản prisma 7.x đều ghim, chỉ prisma 8 (còn RC) mới thoát.
if npm audit --omit=dev --audit-level=high >/dev/null 2>&1; then
  printf '  \033[32m✓ npm audit (production)\033[0m\n'
else
  printf '  \033[33m! npm audit (production) ĐỎ — đã biết, xem docs/REMAINING_RISKS.md\033[0m\n'
fi

if [ "$do" -eq 0 ]; then
  printf '\n\033[32m✅ TẤT CẢ CỔNG XANH\033[0m\n'
else
  printf '\n\033[31m❌ CÓ CỔNG ĐỎ — xem các dòng ✗ ở trên\033[0m\n'
fi
exit "$do"
