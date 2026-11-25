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
  return chiaLamTron(m, thapPhan);
}
/** m / 10^thapPhan làm tròn nửa-lên theo độ lớn (ROUND_HALF_UP). */
function chiaLamTron(m: bigint, thapPhan: number): number {
  if (thapPhan === 0) return Number(m) || 0;
  const chia = 10n ** BigInt(thapPhan);
  const am = m < 0n;
  const tri = am ? -m : m;
  let thuong = tri / chia;
  if ((tri % chia) * 2n >= chia) thuong += 1n;
  return Number(am ? -thuong : thuong) || 0;   // `|| 0`: không trả -0
}

// ── HỆ SỐ NHÓM LẺ: CỘNG THEO NHÓM RỒI NHÂN CHÍNH XÁC ────────────────────────────────────────
// computeQuoteTotals (src/money.ts) nhân Thành Tiền dòng với hệ số nhóm bằng Decimal rồi làm tròn MỘT lần ở mức sheet.
// PDF / Excel / bộ nạp Excel từng cộng `amt × mult` bằng double: nhóm SL 0,7 × 10.058.295 = 7.040.806,4999… → 7.040.806
// trong khi số LƯU là 7.040.807. Hệ số nhóm (SL đang hiện) có tối đa 4 số lẻ và tổng mỗi nhóm là số nguyên → cộng
// Σ tổng nhóm × (hệ số × 10^4) trên BigInt rồi chia là đúng phép Decimal. Lý do đầy đủ + danh sách nơi dùng: khối
// "HỆ SỐ NHÓM LẺ" ở shared/quote-math.ts. BẢN SAO của congTheoHeSoNhom / nhanHeSoNhom ở đó — sửa thì sửa CẢ.
const HE_SO_THANG = 10_000;
/** Σ (tổng Thành Tiền nguyên của nhóm × hệ số nhóm), làm tròn nửa-lên MỘT lần — khớp src/money.ts. `phan` = [tổng, hệ số]. */
export function congTheoHeSoNhom(phan: ReadonlyArray<readonly [number, number]>): number {
  let x = 0, nguyen = true;
  for (const [tong, heSo] of phan) { x += tong * heSo; if (!Number.isInteger(heSo)) nguyen = false; }
  if (nguyen) return Math.round(x) || 0;   // hệ số nguyên: tích và tổng đều nguyên, double đúng
  let s = 0n;
  for (const [tong, heSo] of phan) s += BigInt(Math.round(Number(tong) || 0)) * BigInt(Math.round((Number(heSo) || 0) * HE_SO_THANG));
  return chiaLamTron(s, 4);
}
/** Thành tiền MỘT nhóm CHƯA làm tròn (ô Excel Đơn giá nhóm × SL nhóm): double gần nhất với tích chính xác. */
export function nhanHeSoNhom(tong: number, heSo: number): number {
  const t = Number(tong) || 0, h = Number(heSo) || 0;
  const k = Math.round(h * HE_SO_THANG), tich = t * k;
  return Number.isInteger(t) && Math.abs(k - h * HE_SO_THANG) < 1e-6 && Number.isSafeInteger(tich) ? tich / HE_SO_THANG : t * h;
}
