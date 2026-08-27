#!/usr/bin/env bash
# ============================================================================
# verify-local.sh — CHẠY TOÀN BỘ CỔNG KIỂM NGAY TRÊN MÁY NÀY.
#
#   bash scripts/verify-local.sh          # chạy hết
#   bash scripts/verify-local.sh --nhanh  # bỏ qua TEST WEB + BUILD WEB (vòng lặp sửa nhanh).
#                                         # Build BACKEND vẫn chạy ở [2b] — bước test [4/13] phụ
#                                         # thuộc dist/, bỏ nó là cổng kiểm mã của lần build trước.
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

# ══ CHỐT CHẶN: KHÔNG BAO GIỜ CHẠY LÊN HẠ TẦNG THẬT ══════════════════════════════════
# Mấy dòng `: "${VAR:=...}"` ở trên chỉ đặt mặc định KHI BIẾN CHƯA CÓ. Ai đang export
# DATABASE_URL của production trong shell (chuyện thường ngày: vừa chạy `prisma studio`, vừa soi
# một truy vấn, vừa deploy) rồi gõ `npm run verify` sẽ chạy TOÀN BỘ những thứ sau lên production:
#   · `prisma migrate deploy`          — thao tác schema THẬT
#   · 165 file test                    — tạo/xoá bản ghi, nhiều file gọi deleteMany
#   · `hangDoi.obliterate({force:true})` (tests/hq3-*) — XOÁ SẠCH hàng đợi xuất file
# Không có bước nào hỏi lại. Đây là mất dữ liệu, không phải bất tiện.
#
# Nên: đòi hạ tầng phải TRÔNG NHƯ hạ tầng test. Hai điều kiện độc lập cho CSDL (máy chủ cục bộ VÀ
# tên CSDL có chữ "test"), vì mỗi cái một mình đều hụt:
#   · chỉ kiểm host → tunnel SSH tới prod qua 127.0.0.1 lọt;
#   · chỉ kiểm tên  → một CSDL tên "quanly_test" trên máy chủ prod lọt.
#
# Cửa thoát có CHỦ Ý: VERIFY_CHO_PHEP_HA_TANG_LA=1. Ai thật sự cần (chạy trong container CI riêng
# với DB tên khác) thì gõ tường minh — và họ đã phải đọc tới đây để biết tên biến.
la_may_cuc_bo() {
  case "$1" in
    *@127.0.0.1:*|*@localhost:*|*@\[::1\]:*|*//127.0.0.1:*|*//localhost:*|*//\[::1\]:*) return 0 ;;
    *) return 1 ;;
  esac
}
if [ "${VERIFY_CHO_PHEP_HA_TANG_LA:-0}" != "1" ]; then
  loi=""
  la_may_cuc_bo "$DATABASE_URL" || loi="$loi\n  · DATABASE_URL KHÔNG trỏ tới máy cục bộ"
  case "$DATABASE_URL" in *test*) : ;; *) loi="$loi\n  · DATABASE_URL không có chữ \"test\" — bộ test sẽ GHI VÀ XOÁ trên CSDL này" ;; esac
  la_may_cuc_bo "$REDIS_URL" || loi="$loi\n  · REDIS_URL KHÔNG trỏ tới máy cục bộ (bộ test gọi obliterate — xoá sạch hàng đợi)"
  la_may_cuc_bo "$S3_ENDPOINT" || loi="$loi\n  · S3_ENDPOINT KHÔNG trỏ tới máy cục bộ"
  case "$S3_BUCKET" in *test*) : ;; *) loi="$loi\n  · S3_BUCKET không có chữ \"test\"" ;; esac
  if [ -n "$loi" ]; then
    printf '\n\033[31m╔══ DỪNG: hạ tầng KHÔNG trông như hạ tầng test ══╗\033[0m\n'
    printf '\033[31m%b\033[0m\n' "$loi"
    printf '\nLượt chạy này sẽ `prisma migrate deploy`, chạy 165 file test có ghi/xoá, và
'
    printf 'obliterate hàng đợi. Trên hạ tầng thật thì đó là MẤT DỮ LIỆU.\n\n'
    printf 'Nhiều khả năng shell của bạn đang còn export biến của môi trường khác. Kiểm:\n'
    printf '  env | grep -E "DATABASE_URL|REDIS_URL|S3_"\n\n'
    printf 'Cách chạy sạch:  env -u DATABASE_URL -u REDIS_URL -u S3_ENDPOINT -u S3_BUCKET npm run verify\n'
    printf 'Thật sự cố ý:    VERIFY_CHO_PHEP_HA_TANG_LA=1 npm run verify\n\n'
    exit 1
  fi
fi
# Chạy RIÊNG chốt trên rồi thoát — để tests/x4-verify-chan-ha-tang-that.test.js kiểm được cả hai
# chiều trong tích tắc, thay vì phải chạy trọn 4 phút cổng để biết chốt còn sống.
[ "${1:-}" = "--kiem-hatang" ] && { printf 'hạ tầng trông như hạ tầng test\n'; exit 0; }

do=0
buoc() { printf '\n\033[1m▶ %s\033[0m\n' "$1"; }
ket()  { if [ "$1" -eq 0 ]; then printf '  \033[32m✓ %s\033[0m\n' "$2"; else printf '  \033[31m✗ %s\033[0m\n' "$2"; do=1; fi; }

buoc "[0/13] Hạ tầng"
# ── KIỂM ĐÚNG MÁY CHỦ ĐANG ĐƯỢC CẤU HÌNH, KHÔNG PHẢI MÁY CHỦ MẶC ĐỊNH ──────
# Bản trước gọi `pg_isready -q` và `redis-cli ping` TRẦN. Cả hai lệnh đó dùng mặc định của CHÍNH
# CHÚNG (localhost:5432, localhost:6379), KHÔNG đọc DATABASE_URL/REDIS_URL. Nên nếu ai đó trỏ
# DATABASE_URL sang cổng 5433 (một instance Postgres thứ hai — chuyện thường khi thử phiên bản
# mới), bước này báo XANH cho instance 5432 rồi bước [1/13] chết vì không nối được 5433, kèm một
# thông báo của Prisma không hề nhắc tới hạ tầng.
# `node -e` để bóc host/port: URL kết nối có mật khẩu chứa ký tự đặc biệt, tách bằng sed là sai.
doc_url() { node -e 'const u=new URL(process.argv[1]);process.stdout.write((u.hostname||"127.0.0.1")+" "+(u.port||process.argv[2]))' "$1" "$2" 2>/dev/null; }
read -r PG_HOST PG_PORT <<<"$(doc_url "$DATABASE_URL" 5432)"
read -r RD_HOST RD_PORT <<<"$(doc_url "$REDIS_URL" 6379)"
# `--noproxy '*'`: máy dev đặt HTTPS_PROXY thì curl tới 127.0.0.1 trả 000 và ta chẩn đoán nhầm.
pg_isready -q -h "${PG_HOST:-127.0.0.1}" -p "${PG_PORT:-5432}" 2>/dev/null
ket $? "Postgres tại ${PG_HOST:-?}:${PG_PORT:-?} (nếu đỏ: pg_ctlcluster 16 main start)"
redis-cli -h "${RD_HOST:-127.0.0.1}" -p "${RD_PORT:-6379}" ping >/dev/null 2>&1
ket $? "Redis tại ${RD_HOST:-?}:${RD_PORT:-?} (nếu đỏ: redis-server --daemonize yes)"
curl -fsS --noproxy '*' -o /dev/null "$S3_ENDPOINT/minio/health/live" 2>/dev/null
ket $? "Kho object tại $S3_ENDPOINT (nếu đỏ: minio server /tmp/minio-data --address :9000)"
[ "$do" -eq 0 ] || { printf '\n\033[31mDỪNG: thiếu hạ tầng. Chạy tiếp cũng chỉ ra một dòng "skipped" trông như xanh.\033[0m\n'; exit 1; }

# ── CÂY PHỤ THUỘC PHẢI KHỚP LOCKFILE ──────────────────────────────────────
# Không cổng nào từng kiểm chuyện này. Sửa `package.json` mà quên `npm install` thì lockfile lệch,
# và MỌI bước sau chạy trên bộ thư viện KHÁC với bộ mà `npm ci` sẽ cài trên máy khác / trong Docker
# — tức cổng xanh nói về một cây phụ thuộc không ai khác có.
# `npm ci --dry-run` làm đúng phép so đó mà KHÔNG xoá node_modules (npm ci thật xoá sạch rồi cài
# lại, mất hàng chục giây mỗi lượt verify — một cổng chậm là một cổng bị bỏ chạy).
buoc "[0b/13] Cây phụ thuộc khớp package-lock.json"
npm ci --dry-run >/dev/null 2>&1;                                   ket $? "npm ci --dry-run (nếu đỏ: chạy \`npm install\` để đồng bộ lockfile)"

buoc "[1/13] Prisma client + migrate"
npx prisma generate >/dev/null 2>&1;                                ket $? "prisma generate"
npx prisma migrate deploy >/dev/null 2>&1;                          ket $? "prisma migrate deploy"

# ── BÀI ĐO PHẢI CHẠY RIÊNG, VÀ PHẢI CHẠY TRƯỚC ─────────────────────────────
# tests/b2-update-quote-no-image-read.test.js có 2 bài đọc `pg_statio_all_tables` — bộ đếm TOÀN
# CSDL, không phải của riêng một bài. Chạy song song với 161 file khác thì bài khác cũng đụng cùng
# bảng và con số nhảy → đỏ vì lý do sai. Nên chúng nằm sau cờ DO_TOAST_MEASURE=1.
# Không có CI thì một bài opt-in là một bài KHÔNG BAO GIỜ CHẠY Ở ĐÂU — nên chạy ngay ở đây.
#
# VỊ TRÍ LÀ CÓ CHỦ Ý: TRƯỚC bước [4/13], không phải sau. Đặt sau bộ đầy đủ thì vẫn đỏ (đã thử):
# Postgres dồn thống kê theo lô, nên hoạt động của 161 file vừa chạy còn đang chảy về
# pg_statio_all_tables trong lúc bài này đo. Chạy ở đây, ngay sau `migrate deploy`, CSDL còn yên.
# ĐỪNG chuyển xuống dưới cho "gọn nhóm test" — đó đúng là cách làm nó đỏ lại.
buoc "[1b/13] Bài đo TOAST (chạy riêng, CSDL còn yên)"
# HAI LỆNH RIÊNG, KHÔNG GỘP MỘT LỆNH. Cả hai file đều đọc ảnh hạng mục của CHÍNH bảng QuoteItem;
# gộp lại thì vitest chạy chúng SONG SONG và chúng tự nhiễu nhau — đúng nguồn nhiễu mà cờ này sinh
# ra để tránh. ĐÃ THỬ: gộp một lệnh → db3 đỏ với "TOAST nhảy 3637 block" (ngưỡng 100).
# ── BỎ QUA ÂM THẦM Ở ĐÂY LÀ MẤT SẠCH Ý NGHĨA CỦA BƯỚC NÀY ─────────────────
# Hai bài đo nằm sau `it.runIf(DO_TOAST)`. Nếu cờ không tới nơi — ai đó sửa dòng lệnh, hoặc biến
# bị nuốt bởi một lớp bọc — thì vitest BỎ QUA chúng và THOÁT 0, còn bước này in ✓.
# ĐO ĐƯỢC: chạy đúng file này KHÔNG có cờ → "5 passed, 2 skipped", exit 0.
# Nên đừng chỉ tin mã thoát: đọc báo cáo JSON và đòi KHÔNG bài nào bị bỏ qua.
do_toast() {
  local file="$1" nhan="$2" bc; bc="$(mktemp)"
  DO_TOAST_MEASURE=1 npx vitest run "$file" --reporter=json --outputFile="$bc"
  local ma=$?
  if [ $ma -eq 0 ]; then
    node -e '
      // `readFileSync` + JSON.parse, KHÔNG `require`: file báo cáo do `mktemp` tạo không có đuôi
      // .json và `require` từ chối nạp nó ("Cannot find module").
      const d = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
      const b = d.testResults.flatMap((r) => r.assertionResults);
      const boQua = b.filter((t) => t.status === "skipped");
      const dat = b.filter((t) => t.status === "passed");
      if (boQua.length) {
        console.error(`  ${boQua.length}/${b.length} bài BỊ BỎ QUA — cờ DO_TOAST_MEASURE không tới nơi:`);
        for (const t of boQua) console.error(`    · ${t.title}`);
        process.exit(1);
      }
      if (dat.length === 0) { console.error("  KHÔNG bài nào chạy"); process.exit(1); }
    ' "$bc" || ma=1
  fi
  rm -f "$bc"
  ket $ma "$nhan"
}
do_toast tests/b2-update-quote-no-image-read.test.js "vitest đo TOAST — b2 (không bài nào bị bỏ qua)"
do_toast tests/db3-snapshot-no-images.test.js       "vitest đo TOAST — db3 (không bài nào bị bỏ qua)"

buoc "[2/13] Typecheck"
npx tsc --noEmit -p tsconfig.json;                                  ket $? "tsc (backend)"
(cd web && npx tsc --noEmit -p tsconfig.json);                      ket $? "tsc (web)"

# ── BUILD PHẢI ĐỨNG TRƯỚC TEST ──────────────────────────────────────────────
# tests/pii-rotate-safety.test.js chạy `node dist/tools/piiRotate.js` — một artifact BIÊN DỊCH.
# Trước đây build nằm CHUNG với bước build web, tức SAU test: bộ test kiểm dist/ của LẦN CHẠY TRƯỚC.
# ĐO ĐƯỢC: xoá sạch src/tools/piiRotate.ts còn đúng `export {};` rồi chạy file test đó →
# 8/9 bài VẪN XANH (chỉ bài đọc thẳng mã nguồn là đỏ). Bốn bài chạy `node dist/...` không hề biết
# mã nguồn đã biến mất.
# Đây là hình dạng tệ nhất của lỗi ngầm: cổng nói XANH về một thứ nó không hề kiểm.
# `tsc -p tsconfig.build.json` mất vài giây — rẻ hơn nhiều so với một cổng nói dối.
# Chạy CẢ ở chế độ --nhanh, vì bước [4/13] luôn chạy và nó phụ thuộc dist/.
buoc "[2b/13] Build backend (dist/) — PHẢI trước test, xem chú thích"
# `build:clean` chứ không phải `build`: `tsc` GHI ĐÈ đầu ra nhưng KHÔNG XOÁ file mồ côi. Đổi tên
# hay gỡ một file trong src/ thì bản .js cũ nằm lại trong dist/ mãi mãi — và nó vẫn `import` được,
# nên một module đã bị xoá vẫn chạy được ở máy này trong khi Docker (build từ đầu) thì không có nó.
# Đó là cổng xanh cho một artifact chỉ tồn tại trên máy của một người.
npm run build:clean >/dev/null;                                     ket $? "build backend (dist/ dọn sạch trước khi dựng)"

buoc "[3/13] Lint + format"
npx eslint .;                                                       ket $? "eslint"
npx prettier --check "**/*.{json,css,yml,yaml}" >/dev/null;         ket $? "prettier"

buoc "[4/13] Test backend (REQUIRE_DB_TESTS=1 — bỏ qua = ĐỎ)"
npx vitest run;                                                     ket $? "vitest backend"

buoc "[5/13] EXPLAIN ANALYZE đường nóng (dựng 5.000 dòng thật rồi đo)"
# Cần dist/ (bước [2b]) vì nó nghe câu SQL của CHÍNH client ứng dụng — xem chú thích trong script.
# Vì sao là CỔNG chứ không phải báo cáo: truy vấn mất index không HỎNG, nó chỉ CHẬM DẦN theo số
# dòng, và không ai để ý cho tới lúc trang khách hàng mất vài giây. Cổng này bắt lúc mới 5.000 dòng
# thử, tức trước khi dữ liệu thật chạm tới đó. (Đã tìm ra một index thiếu thật: xem
# prisma/migrations/20260827140000_customer_sort_indexes.)
node scripts/db/explain-hot-paths.mjs >/dev/null;                   ket $? "explain-hot-paths (không quét tuần tự bảng lớn)"

if [ "$NHANH" -eq 0 ]; then
  buoc "[6/13] Test web"
  (cd web && npx vitest run);                                       ket $? "vitest web"
  buoc "[7/13] Build web (backend đã dựng ở [2b])"
  (cd web && npx vite build >/dev/null);                            ket $? "build web"
  # NGAY SAU khi build, không để sang bước khác: file này export NODE_ENV=test cho cả lượt chạy, mà
  # Vite đọc đúng biến đó để quyết dev-hay-prod. Trước đợt này `npm run verify` đẻ ra bundle DEV rồi
  # đem đi smoke ở [11] — smoke xanh trên một bản không người dùng nào chạy, và <StrictMode> của bản
  # dev còn làm hỏng bàn giao bản nháp Wizard → trình soạn.
  node scripts/ci/check-web-bundle.mjs >/dev/null;                  ket $? "check-web-bundle (bundle là bản production)"
else
  buoc "[6-7/13] Bỏ qua test web + build WEB (--nhanh; build backend đã chạy ở [2b])"
fi

buoc "[8/13] Cổng số liệu / phân quyền"
node scripts/ci/endpoint-inventory.mjs --check >/dev/null;          ket $? "endpoint-inventory --check (khớp từng dòng ma trận)"
node scripts/ci/endpoint-inventory.mjs --check-guards >/dev/null;   ket $? "endpoint-inventory --check-guards"
node scripts/ci/repo-stats.mjs --check >/dev/null;                  ket $? "repo-stats --check (số liệu README)"
# Chú thích trỏ "file:dòng" trôi mỗi lần ai đó thêm dòng vào file ĐÍCH, và không có gì báo.
# Đã lặp lại nhiều vòng trong repo này — mỗi vòng rà tay một lượt, rồi chính lượt rà đó làm
# trôi tiếp. Cổng CỐ Ý HẸP: chỉ đỏ khi tham chiếu trỏ vào chỗ KHÔNG THỂ là đích (dòng trống /
# dấu đóng lẻ / quá cuối file). Phần mờ (trỏ vào dòng chú thích) chỉ được liệt kê, không làm
# đỏ — một cổng hay báo động giả sẽ bị người ta tắt, lúc đó còn tệ hơn không có cổng nào.
node scripts/ci/check-line-refs.mjs --check >/dev/null;            ket $? "check-line-refs (chú thích trỏ file:dòng)"
# Ranh giới tầng (routes → services → Prisma) — ADR 0001 khai nó, ADR 0008 giải thích vì sao khoá
# bằng cổng thay vì đổi cây thư mục. Thư mục là cách SẮP XẾP; thứ giữ ranh giới là phép kiểm chạy được.
node scripts/ci/check-architecture.mjs >/dev/null;                  ket $? "check-architecture (ranh giới tầng)"
# CHANGELOG.md sinh từ `git log`, không viết tay (§34: không ghi số liệu dễ trôi bằng tay). Cổng
# này bắt lúc nó lệch khỏi lịch sử — tức lúc ai đó sửa tay hoặc quên sinh lại sau khi commit.
node scripts/ci/gen-changelog.mjs --check >/dev/null;              ket $? "changelog khớp lịch sử git (sinh lại: npm run check:changelog)"

buoc "[9/13] Hạ tầng triển khai"
bash scripts/ci/check-runtime-command.sh >/dev/null;                ket $? "mọi đường triển khai dùng chung artifact dist/"
# §38: mọi script shell phải có `-u` + `pipefail`; bỏ `-e` thì phải khai kèm lý do.
# `pipefail` mới là thứ đắt giá: migration-rehearsal-inner.sh từng chạy
# `prisma migrate deploy | grep | tail` — mã thoát lấy từ `tail`, LUÔN 0, migration hỏng bị nuốt
# và bài diễn tập báo ĐẠT.
node scripts/ci/check-shell-strict.mjs --check >/dev/null;          ket $? "script shell bật chế độ nghiêm (chi tiết: npm run check:shell)"
if command -v helm >/dev/null 2>&1; then
  helm lint infra/helm/quanly >/dev/null;                           ket $? "helm lint (cú pháp + Chart.yaml)"
  # `helm lint` KHÔNG render template — nó không thấy được `node src/server.js` trong args, không
  # thấy `image.tag=latest`, không thấy secretKeyRef trỏ vào khoá không tồn tại. Bước dưới render
  # THẬT rồi soi bản render. Xem đầu scripts/ci/check-helm.mjs.
  node scripts/ci/check-helm.mjs >/dev/null 2>&1;                   ket $? "check-helm (render + 4 bất biến; chi tiết: npm run check:helm)"
else
  printf '  \033[33m— helm không có trên máy này, bỏ qua cổng chart\033[0m\n'
fi
# Quy tắc cảnh báo Prometheus: cú pháp, LOGIC (promtool test rules trên chuỗi số liệu giả), và
# tên metric có thật trong src/observability.ts. Lớp thứ hai là lớp duy nhất bắt được lỗi logic —
# đã kiểm ngược: rút gọn biểu thức SSE thành `sse_backplane_up == 0` thì `check rules` vẫn SUCCESS
# còn `test rules` ĐỎ. Không có promtool thì hai lớp đầu tự bỏ qua, lớp thứ ba vẫn chạy.
node scripts/ci/check-alerts.mjs >/dev/null 2>&1;                   ket $? "check-alerts (chi tiết: npm run check:alerts)"

buoc "[10/13] Phụ thuộc"
# CỔNG CỨNG. Trước đây chỉ là cảnh báo vì advisory GHSA-ggr8-5vv4-36mx đi theo `deepmerge-ts@7.1.5`
# mà `@prisma/config` GHIM CHÍNH XÁC, và `npm audit fix --force` thì tụt prisma về 6.12 (phá vỡ).
# Nay đóng bằng `overrides: { "deepmerge-ts": "^8.0.2" }` trong package.json. Lý do KHÔNG nằm trong
# package.json (npm từ chối khoá chú thích bên trong `overrides` — đã thử, lỗi "Override without
# name") mà ở docs/REMAINING_RISKS.md, mục "Ghim phụ thuộc bằng overrides".
#
# ⚠️ CỔNG NÀY KHÔNG BẮT ĐƯỢC VIỆC GỠ OVERRIDE. `npm audit` đọc cây ĐÃ CÀI, không đọc `overrides`.
# Gỡ dòng đó khỏi package.json mà chưa `npm install` thì ở đây vẫn xanh. Thứ bắt được là
# tests/x2-override-deepmerge.test.js, chạy ở bước [4/13].
npm audit --omit=dev --audit-level=high >/dev/null 2>&1;             ket $? "npm audit (production)"
# §37: phụ thuộc RUNTIME phải có người dùng. `tests/ch3-npm-manifest.test.js` đã gác chiều DEV;
# chiều runtime thì chưa có gì gác. Mỗi gói thừa là bề mặt tấn công thừa + một mục nữa trong SBOM.
node scripts/ci/check-deps.mjs --check >/dev/null;                  ket $? "phụ thuộc runtime đều có người dùng (chi tiết: npm run check:deps)"

# ── [11/13] ARTIFACT ĐƯỢC TRIỂN KHAI, KHÔNG PHẢI MÃ NGUỒN ──────────────────
# Chín bước trên đều kiểm MÃ NGUỒN. Không bước nào kiểm THỨ THẬT SỰ CHẠY Ở PRODUCTION.
# Khoảng trống đó đã nuốt những lỗi chỉ lộ ra lúc pod khởi động: Helm gọi `node src/server.js`
# (file không có trong image), `postinstall` gọi script chưa được COPY vào, fonts/*.ttf bị
# .gitignore loại nên PDF production mất dấu tiếng Việt. Cả ba đều XANH ở mọi cổng đọc mã nguồn.
#
# BỎ QUA Ở --nhanh: dựng image mất ~70 giây khi chưa có cache. Vòng lặp sửa nhanh không chịu nổi,
# mà một cổng chậm quá thì người ta ngừng chạy — lúc đó còn tệ hơn không có.
if [ "$NHANH" -eq 0 ]; then
  buoc "[11/13] Image production (dựng + chạy thật)"
  if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    bash scripts/ci/docker-smoke.sh >/dev/null 2>&1;                  ket $? "docker-smoke (chạy riêng để xem chi tiết: bash scripts/ci/docker-smoke.sh)"
  else
    printf '  \033[33m— docker không dùng được trên máy này, bỏ qua smoke image\033[0m\n'
  fi
else
  buoc "[11/13] Bỏ qua smoke image (--nhanh)"
fi

# ── [12/13] GIAO DIỆN THẬT TRONG TRÌNH DUYỆT THẬT ──────────────────────────
# 187 bài vitest của web/ chạy trên jsdom với component MOUNT LẺ — không bài nào nạp bundle ĐÃ
# BUILD qua Express thật. Bước này mở Chromium, đăng nhập, mở trình soạn, GÕ vào ô đơn giá và đòi
# Thành Tiền tính đúng; rồi chốt "không lỗi console, không request hỏng" suốt lượt chạy.
# Kiểm ngược đã đo: cộng 1 đồng vào `lineAmount` (shared/quote-math.ts) thì bước này ĐỎ.
#
# Phụ thuộc [7/13] (build web) nên phải đứng SAU nó, và bỏ qua ở --nhanh vì --nhanh không build web
# → sẽ kiểm bundle của lần build trước, đúng cái bẫy mà chú thích ở [2b] nói tới.
if [ "$NHANH" -eq 0 ]; then
  buoc "[12/13] Smoke giao diện (Chromium thật)"
  if node -e 'import("playwright").then(()=>process.exit(0),()=>process.exit(1))' 2>/dev/null; then
    node scripts/ci/ui-smoke.mjs >/dev/null 2>&1;                    ket $? "ui-smoke (chạy riêng để xem chi tiết: npm run smoke:ui)"
  else
    printf '  \033[33m— gói playwright chưa cài, bỏ qua smoke giao diện (npm ci)\033[0m\n'
  fi
else
  buoc "[12/13] Bỏ qua smoke giao diện (--nhanh)"
fi

# ── [13/13] BỐN CỔNG BẢO MẬT ────────────────────────────────────────────────
# `.github/workflows/ci.yml` job `security` đã khai đủ gitleaks + trivy + semgrep + SBOM từ lâu,
# nhưng tài khoản GitHub không bật Actions nên nó CHƯA BAO GIỜ CHẠY. Lượt chạy thật đầu tiên
# (2026-08-27) cho ra hai lỗi im lặng: `.gitleaks.toml` viết allowlist bằng cú pháp `[[allowlists]]`
# mà gitleaks v8.21.2 BỎ QUA, và `.trivyignore.yaml` ghi ID thiếu tiền tố `AVD-` nên miễn trừ vô
# tác dụng. Cả hai đều là "repo tưởng mình có chốt".
# Mất ~25 giây khi image và cache đã có sẵn.
if [ "$NHANH" -eq 0 ]; then
  buoc "[13/13] Bảo mật (gitleaks · trivy · semgrep · SBOM)"
  bash scripts/ci/security-scan.sh >/dev/null 2>&1;                 ket $? "security-scan (chi tiết: npm run scan)"
else
  buoc "[13/13] Bỏ qua cổng bảo mật (--nhanh)"
fi

if [ "$do" -eq 0 ]; then
  printf '\n\033[32m✅ TẤT CẢ CỔNG XANH\033[0m\n'
else
  printf '\n\033[31m❌ CÓ CỔNG ĐỎ — xem các dòng ✗ ở trên\033[0m\n'
fi
exit "$do"
