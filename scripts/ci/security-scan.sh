#!/usr/bin/env bash
# ============================================================================
# security-scan.sh — BỐN CỔNG BẢO MẬT, CHẠY THẬT TRÊN MÁY NÀY.
#
#   bash scripts/ci/security-scan.sh              # chạy hết
#   bash scripts/ci/security-scan.sh --nhanh      # bỏ semgrep (chậm nhất)
#   npm run scan:secrets                          # chỉ gitleaks
#
# ── VÌ SAO CẦN ─────────────────────────────────────────────────────────────
# `.github/workflows/ci.yml` job `security` ĐÃ khai đủ bốn bước này từ lâu, với image ghim theo
# tag. Nhưng tài khoản GitHub của repo KHÔNG bật Actions — workflow đó CHƯA BAO GIỜ CHẠY. Một
# bước CI không chạy thì không phải cổng, chỉ là tài liệu.
# File này chạy ĐÚNG những lệnh đó, ngay tại đây, với CÙNG phiên bản image.
#
# ĐO ĐƯỢC ở lượt chạy đầu tiên: gitleaks báo 13 rò rỉ. Không cái nào là bí mật thật, nhưng
# `.gitleaks.toml` viết allowlist bằng cú pháp `[[allowlists]]` mà gitleaks v8.21.2 BỎ QUA — tức
# repo tưởng đã miễn trừ mà chưa. Xem đầu .gitleaks.toml.
#
# ── PHIÊN BẢN GHIM ─────────────────────────────────────────────────────────
# Ghim theo TAG, giống ci.yml: quét bảo mật chạy trên image đổi được dưới chân mình thì kết quả
# không lặp lại được, và một bản upstream hỏng làm đỏ cổng trên đúng những thay đổi không liên quan.
GITLEAKS=zricethezav/gitleaks:v8.21.2
TRIVY=aquasec/trivy:0.58.0
SEMGREP=semgrep/semgrep:1.97.0

set -uo pipefail
cd "$(dirname "$0")/../.."
GOC="$PWD"

NHANH=0
[ "${1:-}" = "--nhanh" ] && NHANH=1
CHI="${SCAN_CHI:-}"          # SCAN_CHI=secrets|deps|sast|sbom → chỉ chạy một bước

do=0
buoc() { printf '\n\033[1m▶ %s\033[0m\n' "$1"; }
ket()  { if [ "$1" -eq 0 ]; then printf '  \033[32m✓ %s\033[0m\n' "$2"; else printf '  \033[31m✗ %s\033[0m\n' "$2"; do=1; fi; }
chay_buoc() { [ -z "$CHI" ] || [ "$CHI" = "$1" ]; }

command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1 || {
  printf '\033[33m— docker không dùng được: bỏ qua [S1]-[S3], chỉ chạy SBOM\033[0m\n'
  CHI=sbom
}

# ── CA CỦA PROXY MITM ──────────────────────────────────────────────────────
# trivy tải CSDL lỗ hổng (~110MB) và semgrep tải ruleset qua HTTPS. Máy build nằm sau proxy
# chặn-và-ký-lại TLS thì cả hai trượt xác thực chứng chỉ. Gắn bó CA của máy đè lên bó của image.
# Không có proxy → mảng rỗng, không gắn gì.
CA_ARGS=()
CA="${SCAN_CA_BUNDLE:-/root/.ccr/ca-bundle.crt}"
if [ -f "$CA" ]; then
  CA_ARGS=(-v "$CA:/etc/ssl/certs/ca-certificates.crt:ro"
           -e SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt
           -e REQUESTS_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt)
fi

# Cache dùng lại giữa các lượt: CSDL lỗ hổng của trivy 110MB, tải lại mỗi lần thì không ai chạy cổng này.
CACHE="${SCAN_CACHE:-$HOME/.cache/quanly-scan}"
mkdir -p "$CACHE/trivy" "$CACHE/semgrep"

# ── [S1] BÍ MẬT TRONG MÃ VÀ TRONG LỊCH SỬ ──────────────────────────────────
if chay_buoc secrets; then
  # ── PHẢI CHẠY HAI LƯỢT. MỘT LƯỢT LÀ MỘT NỬA CỔNG. ────────────────────────
  # `detect` (mặc định) quét COMMIT, không quét cây làm việc. `detect --no-git` thì ngược lại.
  # ĐO ĐƯỢC: dán một khoá ngẫu nhiên vào tests/mfa.test.js mà CHƯA commit →
  #   · `detect`          → exit 0  (không thấy gì)
  #   · `detect --no-git` → exit 1  (thấy)
  # Chỉ chạy lượt lịch sử — đúng như ci.yml đang khai — nghĩa là cổng KHÔNG bắt được bí mật đang
  # nằm trong cây làm việc, tức đúng lúc còn kịp sửa trước khi commit. Cả hai lượt đều cần:
  #   · lượt lịch sử  : một bí mật đã commit rồi xoá vẫn đọc được vĩnh viễn — xoá ở HEAD KHÔNG
  #                     phải là đã xử lý;
  #   · lượt cây làm việc: bắt trước khi nó kịp thành lịch sử.
  buoc "[S1] Bí mật (gitleaks — HAI lượt: lịch sử git + cây làm việc)"
  docker run --rm -v "$GOC:/repo" "$GITLEAKS" \
    detect --source=/repo --redact --no-banner --exit-code 1 >/dev/null 2>&1
  ket $? "lịch sử git sạch (chi tiết: docker run --rm -v \"\$PWD:/repo\" $GITLEAKS detect --source=/repo --redact)"
  docker run --rm -v "$GOC:/repo" "$GITLEAKS" \
    detect --source=/repo --no-git --redact --no-banner --exit-code 1 >/dev/null 2>&1
  ket $? "cây làm việc sạch (kể cả thay đổi chưa commit)"
fi

# ── [S2] LỖ HỔNG PHỤ THUỘC + CẤU HÌNH SAI + BÍ MẬT TRONG CÂY LÀM VIỆC ──────
if chay_buoc deps; then
  buoc "[S2] Phụ thuộc + cấu hình hạ tầng (trivy fs)"
  # `--ignore-unfixed`: lỗ hổng CHƯA CÓ BẢN VÁ thì không có hành động nào để làm — gác nó chỉ tạo
  # một cổng đỏ không ai sửa được. `--trivyignores` phải khai TƯỜNG MINH: trivy KHÔNG tự nhặt
  # .trivyignore.yaml ở gốc repo (đã kiểm — thiếu cờ này thì miễn trừ vô tác dụng).
  docker run --rm "${CA_ARGS[@]}" -v "$GOC:/src" -v "$CACHE/trivy:/root/.cache/trivy" "$TRIVY" \
    fs --scanners vuln,secret,misconfig --severity HIGH,CRITICAL --ignore-unfixed \
       --ignorefile /src/.trivyignore.yaml --exit-code 1 --quiet /src >/tmp/trivy-out.$$ 2>&1
  ma=$?
  ket $ma "không lỗ hổng HIGH/CRITICAL có bản vá, không cấu hình sai"
  [ $ma -eq 0 ] || { sed -n '1,60p' /tmp/trivy-out.$$; }
  rm -f /tmp/trivy-out.$$
fi

# ── [S3] SAST — ĐỌC LOGIC, KHÔNG CHỈ ĐỌC THƯ VIỆN ──────────────────────────
if chay_buoc sast && [ "$NHANH" -eq 0 ]; then
  buoc "[S3] SAST (semgrep OSS — 7 bộ luật)"
  # npm audit soi thư viện, gitleaks soi bí mật, trivy soi hạ tầng — KHÔNG ai đọc logic của mình.
  # Semgrep OSS chạy cục bộ, ruleset miễn phí, không cần tài khoản, không gửi mã ra ngoài
  # (--metrics=off). Chỉ gác ở mức ERROR: gác cả WARNING sẽ chặn merge vì gợi ý phong cách.
  #
  # `--json`: KHÔNG chỉ để lấy kết quả cho đẹp. Phần quan trọng nhất nằm ở mảng `errors` — xem
  # khối "LỖ THỦNG IM LẶNG" bên dưới.
  RA_SG="${SEMGREP_OUT:-/tmp/semgrep-$$.json}"
  docker run --rm "${CA_ARGS[@]}" -v "$GOC:/src" -v "$CACHE/semgrep:/root/.semgrep" -w /src "$SEMGREP" \
    semgrep scan \
      --config p/javascript --config p/typescript \
      --config p/nodejs --config p/expressjs --config p/react \
      --config p/secrets --config p/owasp-top-ten \
      --exclude node_modules --exclude _bmad --exclude _bmad-output \
      --exclude .claude --exclude public/app2 --exclude coverage --exclude dist \
      --metrics=off --json >"$RA_SG" 2>/dev/null

  node -e '
    const fs = require("fs");
    let d;
    try { d = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); }
    catch { console.error("semgrep không trả JSON hợp lệ — chạy tay để xem"); process.exit(2); }

    const ket = d.results || [];
    const loi = ket.filter((r) => (r.extra || {}).severity === "ERROR");
    console.log(`      quét ${(d.paths?.scanned || []).length} file, ${ket.length} phát hiện (${loi.length} mức ERROR)`);
    for (const r of loi.slice(0, 15)) {
      console.log(`      · ${r.path}:${r.start.line} ${String(r.check_id).split(".").pop()}`);
    }
    process.exit(loi.length ? 1 : 0);
  ' "$RA_SG"
  ket $? "0 phát hiện mức ERROR"

  # ── VÙNG MÙ IM LẶNG CỦA SEMGREP ──────────────────────────────────────────
  # Semgrep có thể phân tích DỞ DANG một file (parser của nó không nuốt được một đoạn cú pháp) và
  # vẫn kết thúc THÀNH CÔNG — nó chỉ ghi một dòng "Partially scanned: N files" lẫn trong phần tổng
  # kết, và `--json` thì chôn nó trong mảng `errors`. Không ai đọc tới đó.
  #
  # ĐÃ ĐO — VÀ KẾT QUẢ HẸP HƠN TÔI TƯỞNG BAN ĐẦU, nên ghi lại cho đúng:
  #   · Đặt một mẫu semgrep CHẮC CHẮN bắt (`new Function(req.query.body)`) vào src/quoteUtils.ts
  #     (file phân tích dở dang) → VẪN BÁO ĐỎ, đúng dòng.
  #   · Cùng mẫu đó đặt vào src/searchText.ts (file phân tích trọn) → cũng báo đỏ.
  #   ⇒ "dở dang" KHÔNG có nghĩa là cả file bị bỏ qua. Nó bỏ qua ĐÚNG VÙNG quanh chỗ không parse
  #     được. Vùng mù là CỤC BỘ, không phải toàn file. Đừng viết lại chú thích này thành
  #     "file đó không được quét" — đã đo là sai.
  #
  # Vẫn đáng gác, vì vùng mù cục bộ vẫn là vùng mù: luật không thể khớp thứ parser không dựng được
  # cây cú pháp. Ba file mã nguồn hiện có vùng mù, đều vì cú pháp TypeScript hiện đại mà parser của
  # semgrep 1.97 chưa hỗ trợ:
  #   · src/app.ts:470        — chú thích kiểu trong tham số arrow function
  #   · src/quoteUtils.ts:65  — toán tử `satisfies` (TS 4.9)
  #   · src/zodErrorMap.ts:14 — kiểu `import("zod").X`
  # KHÔNG viết lại mã ứng dụng cho vừa parser của công cụ quét — đó là để cái đuôi vẫy con chó.
  # Thay vào đó GHIM CON SỐ: file thứ tư xuất hiện là cổng đỏ, và người ta phải nhìn vào nó.
  #
  # Lỗi phân tích ở YAML của Helm (`{{ }}` không phải YAML hợp lệ) và ở script shell thì KHÔNG tính:
  # semgrep không phải công cụ cho Go template, đó là hạn chế đã biết chứ không phải hồi quy.
  BASE_DODANG="${SEMGREP_BASE_DODANG:-3}"
  node -e '
    const fs = require("fs");
    const d = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const base = Number(process.argv[2]);
    const nguon = new Set();
    let haTang = 0;
    for (const e of d.errors || []) {
      const p = e.path || (e.location || {}).path || "";
      if (/\.(ts|tsx|js|mjs|cjs)$/.test(p) && !p.startsWith(".github/")) nguon.add(p);
      else haTang++;
    }
    const ds = [...nguon].sort();
    console.log(`      ${ds.length} file MÃ NGUỒN phân tích dở dang (ngưỡng ghim: ${base}), ${haTang} lỗi ở YAML/shell (không tính)`);
    for (const p of ds) console.log(`      · ${p}`);
    if (ds.length > base) {
      console.error(`      → TĂNG so với ngưỡng. Vùng mù là CỤC BỘ (quanh chỗ không parse được), KHÔNG phải cả file — đã đo, xem chú thích trên. Vẫn đỏ vì luật không khớp được thứ parser không dựng nổi.`);
      console.error(`      → Cách vá ĐÚNG: tìm chỗ parser vấp rồi viết lại cho parse được (ca thật: \`<!--\` nguyên văn trong regex literal là token chú thích HTML của JS). Nâng SEMGREP_BASE_DODANG là cách CUỐI, và phải kèm lý do tại chỗ.`);
      process.exit(1);
    }
    if (ds.length < base) {
      console.error(`      → GIẢM còn ${ds.length}: hạ SEMGREP_BASE_DODANG trong scripts/ci/security-scan.sh xuống ${ds.length} để giữ chốt chặt.`);
      process.exit(1);
    }
    process.exit(0);
  ' "$RA_SG" "$BASE_DODANG"
  ket $? "số file mã nguồn semgrep không quét trọn KHÔNG tăng"
  [ -n "${SEMGREP_OUT:-}" ] || rm -f "$RA_SG"
elif chay_buoc sast; then
  buoc "[S3] Bỏ qua SAST (--nhanh)"
fi

# ── [S4] SBOM ──────────────────────────────────────────────────────────────
if chay_buoc sbom; then
  buoc "[S4] SBOM (CycloneDX, chỉ phụ thuộc production)"
  # SBOM = danh sách MỌI thứ thật sự đi vào production. Khi một CVE mới nổ, câu hỏi đầu tiên là
  # "hệ thống có dùng gói đó không, bản nào" — không có SBOM thì phải dựng lại cây phụ thuộc của
  # đúng bản đã deploy, mà bản đó có thể đã bị ghi đè.
  # `npm sbom` có sẵn từ npm 10, không cần công cụ ngoài.
  RA="${SBOM_OUT:-$GOC/sbom.cdx.json}"
  npm sbom --sbom-format=cyclonedx --omit=dev > "$RA" 2>/dev/null
  ket $? "sinh $RA"
  if [ -s "$RA" ]; then
    n=$(node -e "const d=require('$RA');console.log((d.components||[]).length)" 2>/dev/null || echo 0)
    # Bảo hiểm: một SBOM rỗng/hỏng vẫn là JSON hợp lệ và vẫn "sinh thành công". Con số này chặn
    # chuyện đó — cây production hiện có hàng trăm gói, tụt xuống hai chữ số là có gì đó sai.
    [ "$n" -ge 100 ]
    ket $? "SBOM có $n thành phần (ngưỡng bảo hiểm: ≥ 100)"
    node -e "
      const d = require('$RA');
      if (d.bomFormat !== 'CycloneDX') { console.error('bomFormat =', d.bomFormat); process.exit(1); }
      const thieu = (d.components||[]).filter((c) => !c.version || !c.purl);
      if (thieu.length) { console.error('thiếu version/purl:', thieu.slice(0,5).map(c=>c.name).join(', ')); process.exit(1); }
    " 2>&1
    ket $? "định dạng CycloneDX hợp lệ, mọi thành phần có version + purl"
  fi
fi

if [ "$do" -eq 0 ]; then
  printf '\n\033[32m✅ CỔNG BẢO MẬT XANH\033[0m\n'
else
  printf '\n\033[31m❌ CỔNG BẢO MẬT ĐỎ\033[0m\n'
fi
exit "$do"
