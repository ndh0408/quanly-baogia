// THÀNH TIỀN MỘT DÒNG — nhân CHÍNH XÁC rồi làm tròn nửa-lên về số nguyên (XLSX-06).
//
// ── VÌ SAO KHÔNG `Math.round(q * p)` ─────────────────────────────────────────
// Nguồn sự thật của tiền là src/money.ts (Prisma.Decimal, ROUND_HALF_UP). excel.ts, pdf.ts và
// excelImport.ts từng tự nhân bằng double rồi Math.round — mỗi nơi một thứ tự nhân — nên lệch 1đ
// khi giá không phải bội số 10. ĐÃ ĐO: 4.482/1.980.000 tổ hợp (SL 1 số lẻ × giá 1..20000) ra khác
// Decimal; ví dụ giá 15 × SL 4,1: double cho 61,4999… → 61, Decimal cho 61,5 → 62. PDF, số cache
// trong ô Excel và bảng xem trước khi nhập vì thế có thể nói khác con số đã LƯU.
//
// ── VÌ SAO KHÔNG IMPORT money.ts ─────────────────────────────────────────────
// money.ts kéo @prisma/client vào — excelImport.ts chạy trong worker thread nhập Excel có trần heap
// riêng, không đáng nạp cả client Prisma chỉ để nhân ba số. Ở đây nhân trên BigInt theo biểu diễn
// thập phân của từng số — ĐÚNG cách `new Decimal(number)` đọc số (qua chuỗi thập phân ngắn nhất),
// nên kết quả trùng money.ts từng đồng. Làm tròn nửa-lên theo độ lớn (âm: -2,5 → -3) như ROUND_HALF_UP.

/** Số → [phần nguyên đã bỏ dấu phẩy (BigInt, có dấu), số chữ số thập phân]. */
function tach(x: number): [bigint, number] {
  if (!Number.isFinite(x) || x === 0) return [0n, 0];
  let s = String(x);
  if (/e/i.test(s)) {
    // Dạng mũ (rất nhỏ/rất lớn) — hiếm với tiền; quy về thập phân thường.
    s = Math.abs(x) < 1 ? x.toFixed(20).replace(/0+$/, "").replace(/\.$/, "") : BigInt(Math.round(x)).toString();
  }
  const am = s.startsWith("-");
  if (am) s = s.slice(1);
  const [nguyen, le = ""] = s.split(".");
  const m = BigInt(nguyen + le || "0");
  return [am ? -m : m, le.length];
}

/** Tích các thừa số, làm tròn nửa-lên (ROUND_HALF_UP) về số nguyên — khớp src/money.ts. */
export function nhanLamTronDong(...thuaSo: number[]): number {
  let m = 1n;
  let thapPhan = 0;
  for (const x of thuaSo) {
    const [a, b] = tach(Number(x) || 0);
    m *= a;
    thapPhan += b;
  }
  if (thapPhan === 0) return Number(m) || 0;
  const chia = 10n ** BigInt(thapPhan);
  const am = m < 0n;
  const tri = am ? -m : m;
  let thuong = tri / chia;
  if ((tri % chia) * 2n >= chia) thuong += 1n;
  return Number(am ? -thuong : thuong) || 0;   // `|| 0`: không trả -0
}
