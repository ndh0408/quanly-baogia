// Port THUẦN máy tính công thức Excel từ public/js/editor.js (evalArith + evalFormula + FORMULA_FNS).
// Hỗ trợ số học + ( ) + × + phần trăm (8%→0.08) + hàm SUM/AVERAGE/AVG/PRODUCT/MIN/MAX/ROUND/
// ROUNDUP/ROUNDDOWN/INT/ABS/CEILING/FLOOR (CEILING/FLOOR có bội số như Excel). Tham số ngăn bởi ";"
// (Excel VN); "," = dấu thập phân.
// refs (chỉ lưới cấp): resolve "G3"/"H3:H8" về số. Vắng refs = hành vi cũ (export/test).

export type FormulaRefs = { cell: (a: string) => number; range: (a: string, b: string) => number[] | null };

export function evalArith(input: string | number): number | null {
  // Khoảng trắng KẸP GIỮA hai phần của một số ("1 000 000", "100, 0", "1 .5", hai ô dính nhau
  // "58000 57000") là LỖI cú pháp — Excel coi dấu cách giữa hai toán hạng là toán tử giao vùng. Bản cũ
  // xoá sạch khoảng trắng nên lưới vẫn ra số, ô không đỏ, còn tệp xuất chứa đúng chuỗi đó và Excel từ
  // chối mở CẢ tệp (L28). Khoảng trắng quanh toán tử/ngoặc vẫn được bỏ như cũ.
  if (/[\d.,]\s+[\d.,]/.test(String(input))) return null;
  const s = String(input).replace(/,/g, ".").replace(/\s+/g, "");
  if (!s || !/^[-+*/().0-9]+$/.test(s)) return null;
  let pos = 0;
  const peek = () => s[pos];
  // Mọi kết quả TRUNG GIAN phải hữu hạn (L36): bản cũ chỉ kiểm ở kết quả cuối, mà x/∞ = 0 là số hữu hạn
  // nên "=2/(1/0)" hay "=G3/(H3/D3)" với D3 = 0 ra 0, ô không đỏ — còn Excel ra #DIV/0! rồi lan xuống
  // Thành tiền, Tổng cộng, VAT. Chia 0 (±∞ hoặc 0/0 = NaN) hay tràn số ở bất cứ bước nào → lỗi.
  function expr(): number | null {
    let v = term();
    while (peek() === "+" || peek() === "-") { const op = s[pos++]; const r = term(); if (v === null || r === null) return null; v = op === "+" ? v + r : v - r; if (!isFinite(v)) return null; }
    return v;
  }
  function term(): number | null {
    let v = factor();
    while (peek() === "*" || peek() === "/") { const op = s[pos++]; const r = factor(); if (v === null || r === null) return null; v = op === "*" ? v * r : v / r; if (!isFinite(v)) return null; }
    return v;
  }
  function factor(): number | null {
    if (peek() === "(") { pos++; const v = expr(); if (peek() !== ")") return null; pos++; return v; }
    if (peek() === "-") { pos++; const v = factor(); return v === null ? null : -v; }
    if (peek() === "+") { pos++; return factor(); }
    let num = "";
    while (pos < s.length && /[0-9.]/.test(s[pos])) num += s[pos++];
    if (!num || !isFinite(Number(num))) return null;
    return Number(num);
  }
  const result = expr();
  if (pos !== s.length || result === null || !isFinite(result)) return null;
  return result;
}

/**
 * LÀM TRÒN KIỂU EXCEL (ROUND / ROUNDUP / ROUNDDOWN / INT).
 *
 * Bản cũ tính thẳng Math.round/ceil/trunc(x * 10^d) trên double nên dính sai số dấu phẩy động:
 * 3000*1,1 = 3300,0000000000005 → ROUNDUP(…;-2) ra 3.400; 6000*1,15 = 6899,999999999999 →
 * ROUNDDOWN(…;-2) ra 6.800; 4,35*100 = 434,99999999999994 → INT ra 434. Excel ra 3.300 / 6.900 / 435
 * vì nó làm tròn toán hạng về 15 CHỮ SỐ CÓ NGHĨA trước. Thêm nữa Math.round đẩy nửa về phía +∞ nên
 * ROUND(-52500;-3) ra -52.000, Excel đi XA SỐ 0 → -53.000. Tệp xuất có fullCalcOnLoad nên Excel tính
 * lại khi mở: Thành tiền/Tổng trong Excel lệch app/PDF mà bước tự kiểm không bắt được (cùng bộ tính).
 *
 * Cách làm: chuẩn hoá về 15 chữ số, làm tròn TRỊ TUYỆT ĐỐI rồi trả dấu (ROUND nửa đi xa số 0,
 * ROUNDUP xa số 0, ROUNDDOWN về phía 0 — đúng Excel), và dịch dấu phẩy bằng số mũ thập phân ("e")
 * chứ không nhân 10^d. Số chữ số lẻ bị CẮT về số nguyên như Excel (ROUND(x;1,7) = ROUND(x;1)).
 * Đối chiếu Excel 16 thật qua COM: 3.010 ca (gồm CEILING/FLOOR) khớp hết, bản cũ lệch 1.323.
 * BẢN SAO: web/src/lib/formula.ts ↔ src/quoteFormula.ts — sửa thì sửa CẢ HAI.
 */
const so15 = (x: number) => Number(x.toPrecision(15));
/** x × 10^d bằng số mũ thập phân — không qua phép nhân double ("2.675e2" = 267,5 đúng tuyệt đối). */
const dichThapPhan = (x: number, d: number) => { const [m, e] = String(x).split("e"); return Number(m + "e" + (Number(e || 0) + d)); };
function lamTronExcel(x: number, soChuSo: number, kieu: "tron" | "len" | "xuong"): number {
  const n = so15(x), d = Math.trunc(soChuSo);
  if (!isFinite(n) || !isFinite(d)) return NaN;
  const v = dichThapPhan(Math.abs(n), d);
  if (!isFinite(v)) return n;   // số chữ số lẻ quá lớn: không còn gì để làm tròn
  const r = kieu === "tron" ? Math.round(v) : kieu === "len" ? Math.ceil(v) : Math.floor(v);
  const kq = Math.sign(n) * dichThapPhan(r, -d);
  return kq === 0 ? 0 : kq;     // không để lọt -0
}

/**
 * CEILING / FLOOR(số; bội số) KIỂU EXCEL. Bản cũ là Math.ceil/floor(a[0]) — BỎ QUA bội số, nên
 * "=CEILING(1234567;1000)" ra 1.234.567 (Excel 1.235.000) mà ô không đỏ (L32). Luật Excel (đo bằng
 * Excel 16 thật): bội số 0 → CEILING ra 0, FLOOR ra #DIV/0! (trừ số 0); số dương mà bội số âm →
 * #NUM!; số âm + bội số dương: CEILING về phía 0, FLOOR xa số 0; cả hai âm thì ngược lại — tức luôn
 * là bội × ceil/floor(số / bội). Thương chuẩn hoá 15 chữ số như lamTronExcel (3000*1,1 / 100 =
 * 33,000000000000004 → 33). Tích KHÔNG chuẩn hoá: Excel cũng trả 0,30000000000000004 cho CEILING(0,3;0,1).
 * Một đối số (app cũ cho phép): giữ nghĩa cũ = bội số 1, trùng Excel CEILING(x;1)/FLOOR(x;1) — công thức
 * đã lưu không đổi số; lúc xuất Excel thì thiếu đối số nên ghi số (SO_DOI_SO ở src/quoteFormula.ts).
 */
function boiSoExcel(a: number[], kieu: "len" | "xuong"): number {
  if (a.length < 1 || a.length > 2) return NaN;
  const x = a[0], boi = a.length === 2 ? a[1] : 1;
  if (boi === 0) return kieu === "len" || x === 0 ? 0 : NaN;
  if (x > 0 && boi < 0) return NaN;
  const q = so15(x / boi);
  const kq = (kieu === "len" ? Math.ceil(q) : Math.floor(q)) * boi;
  return kq === 0 ? 0 : kq;
}

const FORMULA_FNS: Record<string, (a: number[]) => number> = {
  SUM: (a) => a.reduce((x, y) => x + y, 0),
  PRODUCT: (a) => a.reduce((x, y) => x * y, 1),
  AVERAGE: (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0),
  AVG: (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0),
  MIN: (a) => (a.length ? Math.min(...a) : 0),
  MAX: (a) => (a.length ? Math.max(...a) : 0),
  // Hàm MỘT giá trị nhận đúng số đối số của nó; thừa (thường do DẢI ô bị bung: "=ABS(F1:F3)" → ABS(a;b;c))
  // → lỗi như Excel #VALUE!, không lặng lẽ lấy a[0]. ROUND* một đối số là cách viết cũ app vẫn nhận.
  ROUND: (a) => (a.length < 1 || a.length > 2 ? NaN : lamTronExcel(a[0], a[1] || 0, "tron")),
  ROUNDUP: (a) => (a.length < 1 || a.length > 2 ? NaN : lamTronExcel(a[0], a[1] || 0, "len")),
  ROUNDDOWN: (a) => (a.length < 1 || a.length > 2 ? NaN : lamTronExcel(a[0], a[1] || 0, "xuong")),
  INT: (a) => (a.length !== 1 ? NaN : Math.floor(so15(a[0]))),
  ABS: (a) => (a.length !== 1 ? NaN : Math.abs(a[0])),
  CEILING: (a) => boiSoExcel(a, "len"),
  FLOOR: (a) => boiSoExcel(a, "xuong"),
};

/**
 * DẤU PHẨY TÁCH ĐỐI SỐ KIỂU EXCEL TIẾNG ANH → ";" (quy ước của app).
 *
 * App theo Excel tiếng Việt: ";" tách đối số, "," là dấu thập phân. Nhưng người dùng chép công
 * thức từ Excel tiếng Anh: "=ROUND(E2*63000,-3)" bị đọc thành ROUND(E2*63000.-3) = 554.397 thay
 * vì 554.000, rồi lúc xuất Excel bước tự kiểm thấy lệch nên BỎ công thức, chỉ ghi số (người dùng
 * báo 2026-09-23, production quote #47).
 *
 * Chỉ xét dấu phẩy nằm NGAY TRONG danh sách đối số của một HÀM ("," ngoài hàm — "=E3*1,5" — vẫn là
 * thập phân). Mỗi dấu phẩy thuộc một trong hai loại:
 *   • KHÔNG THỂ là dấu thập phân (sát ô tham chiếu / dấu âm / ngoặc / chữ: "E2,E3", ",-3") → đổi
 *     thành ";". Kể cả khi công thức ĐÃ có ";" (L29): "=ROUND(SUM(F1,F2);-3)" trước đây bị bỏ qua cả
 *     công thức, "F1,F2" thành số 58000,57 → lưới 58.000 còn Excel (đọc "G13.G14" là dải) 115.000.
 *   • Kẹp giữa HAI CHỮ SỐ ("1,5") — có thể là số 1,5 (kiểu Việt) hoặc hai đối số (kiểu Anh):
 *       - công thức đã có ";" → kiểu Việt chắc chắn → thập phân;
 *       - hàm MỘT đối số (INT/ABS) → chỉ có thể là thập phân;
 *       - hàm HAI đối số (ROUND/ROUNDUP/ROUNDDOWN/CEILING/FLOOR): đã có đúng một dấu tách chắc chắn
 *         ("ROUND(E2*1,1,-3)") → thập phân; ROUND* "…,0)" → tách (hai cách đọc cùng ra một số); còn lại
 *         ("ROUND(F1*0,5)") là MƠ HỒ THẬT (L30): app cũ nhận ROUND một đối số nên công thức ĐÃ LƯU
 *         kiểu này mang nghĩa ROUND(F1*0,5) = 525.000; đọc theo Excel tiếng Anh lại là ROUND(F1*0;5)
 *         = 0 — lưới ghi đè số đã lưu thành 0 mà không báo. Không chọn thay người dùng: trả null;
 *       - hàm NHIỀU đối số (SUM/MIN/MAX/…): giữ thập phân như quy ước Việt, TRỪ khi trông rõ là kiểu
 *         Anh (L34): phần sau có từ 4 chữ số hoặc tận cùng bằng 0 ("MIN(F2*1000,500000)",
 *         "PRODUCT(-500000,20%)"), hoặc công thức đã có dấu phẩy khác vừa được đổi thành ";". Khi đó
 *         cũng là mơ hồ → null. Bản cũ đọc "MIN(F2*1000,500000)" thành F2*1000,5 → 1.050.525.000.
 *         "=SUM(1,2)" vì thế là 1,2 — CÓ CHỦ ĐÍCH: mơ hồ thật với SUM(1;2) kiểu Anh, nhưng đổi đi là
 *         hỏng ca Việt hợp lệ "SUM(1,5)" = 1,5 (chốt bằng test ở tests/ct-dau-phay-mo-ho.test.js).
 *   • Công thức đã có ";" mà "," đứng ĐẦU một số (sau toán tử / "(" / ";": "ROUND(F1*,5;0)") → thập
 *     phân viết tắt 0,5 như ngoài hàm ("=F1*,5"), không phải dấu tách (soát toàn diện đợt 3 — bản sửa
 *     L29 đổi nó thành ";" nên công thức từng tính đúng ra null).
 * null = "công thức không đọc được": lưới tô ĐỎ khi gõ, còn công thức ĐÃ LƯU thì recomputeAll giữ
 * nguyên số đang có, lúc xuất Excel ghi số — không bao giờ âm thầm ra một con số khác.
 *
 * Sau cùng: dấu "," / "." còn DÍNH ô tham chiếu ("=F1,5", "=F1.5", "(F1,F2)") → null. Bước thay tham
 * chiếu sẽ biến nó thành "58000,5" (một con số ghép), còn tệp Excel mang "G13.5" → #NAME? (L29).
 * Đổi "x" nhân ("2x1,5") thành "*" TRƯỚC khi gọi hàm này, kẻo "x1" bị coi là ô tham chiếu (L30).
 * BẢN SAO: web/src/lib/formula.ts ↔ src/quoteFormula.ts — sửa quy tắc thì sửa CẢ HAI.
 */
const HAM_HAI_DOI_SO = /^(ROUND(UP|DOWN)?|CEILING|FLOOR)$/;   // Excel bắt buộc đúng hai đối số
const HAM_MOT_DOI_SO = /^(INT|ABS)$/;
export function chuanHoaDauTachDoiSo(s: string): string | null {
  let kq = s;
  if (s.includes(",")) {
    const kieuViet = s.includes(";");
    const out = s.split("");
    const khung: { fn: string | null; phay: number[] }[] = [];
    let moHo = false, daDoi = false;
    const nghiNgo: string[] = [];   // phần sau các dấu phẩy "số,số" trong hàm nhiều đối số
    const quyet = (k: { fn: string | null; phay: number[] }) => {
      if (!k.fn || !k.phay.length) return;
      const ds = k.phay.map((i) => {
        const truoc = s.slice(0, i).replace(/\s+$/, ""), sau = s.slice(i + 1).replace(/^\s+/, "");
        const soTruoc = /\d$/.test(truoc) && !/[A-Za-z]\$?\d+$/.test(truoc);   // chữ số KHÔNG thuộc ô tham chiếu
        // Kiểu Việt: "," đứng ĐẦU một số (sau toán tử / "(" / ";") là thập phân viết tắt — ",5" = 0,5.
        const dauSoViet = kieuViet && /(^|[-+*/(;])$/.test(truoc);
        return { i, sau, soSo: (soTruoc || dauSoViet) && /^\d/.test(sau) };
      });
      const chac = ds.filter((p) => !p.soSo), soSo = ds.filter((p) => p.soSo);
      for (const p of chac) { out[p.i] = ";"; daDoi = true; }
      if (!soSo.length || kieuViet || HAM_MOT_DOI_SO.test(k.fn)) return;
      if (HAM_HAI_DOI_SO.test(k.fn)) {
        if (chac.length) return;   // đã đủ dấu tách: phần còn lại là thập phân (thừa đối số thì chốt ở translateFormula)
        if (soSo.length === 1 && k.fn.startsWith("ROUND") && /^0+\s*\)/.test(soSo[0].sau)) { out[soSo[0].i] = ";"; daDoi = true; return; }
        moHo = true;
        return;
      }
      for (const p of soSo) nghiNgo.push(p.sau);
    };
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch === "(") { const m = /([A-Za-z]+)\s*$/.exec(s.slice(0, i)); khung.push({ fn: m ? m[1].toUpperCase() : null, phay: [] }); }
      else if (ch === ")") { const k = khung.pop(); if (k) quyet(k); }
      else if (ch === "," && khung.length) khung[khung.length - 1].phay.push(i);
    }
    for (const sau of nghiNgo) { const duoi = /^\d+/.exec(sau)![0]; if (daDoi || duoi.length >= 4 || duoi.endsWith("0")) moHo = true; }
    if (moHo) return null;
    kq = out.join("");
  }
  if (/[A-Za-z]\$?\d+\s*[.,]|[.,]\s*\$?[A-Za-z]+\$?\d/.test(kq)) return null;
  return kq;
}

/**
 * Thay từng lời gọi hàm bằng kết quả của nó, bắt đầu từ lời gọi TRONG CÙNG (không còn hàm con bên
 * trong). Đối số ĐƯỢC PHÉP có ngoặc tròn thường — "ROUND(F1*(1+8%);0)", "MAX((F2-F3);0)" — vì
 * evalArith tự tính ngoặc. Bản cũ dùng regex ([A-Za-z]+)\s*\(([^()]*)\) chỉ khớp lời gọi KHÔNG có
 * ngoặc nào bên trong, nên mẫu "giá × (1 + VAT)" trong hàm ra null: ô đỏ, đơn giá 0 (L31).
 * Đối số tách theo ";" ở TẦNG NGOÀI CÙNG của lời gọi; ";" nằm trong ngoặc thường ("SUM((1;2))") không
 * phải đối số hợp lệ của Excel → evalArith trả null → lỗi. Ngoặc lệch → null.
 * BẢN SAO: web/src/lib/formula.ts ↔ src/quoteFormula.ts — sửa thì sửa CẢ HAI.
 */
function rutGonHam(s: string): string | null {
  const reHam = /([A-Za-z]+)\s*\(/g;
  for (let guard = 0; /[A-Za-z]+\s*\(/.test(s); guard++) {
    if (guard > 100) return null;
    let chon: { dau: number; ten: string; trong: string; cuoi: number } | null = null;
    reHam.lastIndex = 0;
    for (let m = reHam.exec(s); m; m = reHam.exec(s)) {
      const mo = m.index + m[0].length - 1;
      let sau = 0, dong = -1;
      for (let k = mo; k < s.length; k++) { if (s[k] === "(") sau++; else if (s[k] === ")" && --sau === 0) { dong = k; break; } }
      if (dong < 0) return null;                              // thiếu ngoặc đóng
      const trong = s.slice(mo + 1, dong);
      if (/[A-Za-z]+\s*\(/.test(trong)) continue;             // còn hàm con → rút hàm con trước
      chon = { dau: m.index, ten: m[1], trong, cuoi: dong };
      break;
    }
    if (!chon) return null;
    s = s.slice(0, chon.dau) + goiHam(chon.ten, chon.trong) + s.slice(chon.cuoi + 1);
  }
  return s;
}
/** Hàm mà Excel BỎ QUA đối số rỗng (không coi là 0) — xem goiHam. BẢN SAO ở src/quoteFormula.ts. */
const HAM_BO_DOI_SO_RONG = new Set(["PRODUCT"]);
/** Kết quả MỘT lời gọi hàm (đối số đã là số/biểu thức số) dưới dạng chuỗi, lỗi → "NaN". */
function goiHam(ten: string, trong: string): string {
  const fn = FORMULA_FNS[ten.toUpperCase()];
  if (!fn) return "NaN";
  const doiSo: string[] = [];
  let sau = 0, dau = 0;
  for (let k = 0; k < trong.length; k++) {
    const c = trong[k];
    if (c === "(") sau++; else if (c === ")") sau--; else if (c === ";" && sau === 0) { doiSo.push(trong.slice(dau, k)); dau = k + 1; }
  }
  doiSo.push(trong.slice(dau));
  // Đối số KHÔNG đọc được (vd "123.45,2") → cả công thức lỗi, không lọc bỏ im lặng rồi tính tiếp
  // trên phần còn lại (GRID-03: =ROUND(G3,2) từng ra 0 mà ô không đỏ).
  // Đối số RỖNG giữa các dấu tách ("MIN(F1;)", "ROUND(;2)") là 0 như Excel. Bản trước BỎ nó: app ra
  // MIN = 58.000, AVERAGE = 58.000, ROUND(;2) = 2 trong khi Excel ra 0 / 29.000 / 0 — bộ tự kiểm máy chủ
  // bỏ y như vậy nên tệp vẫn ghi công thức và Excel tính ra số khác app / PDF (soát toàn diện đợt 3).
  // RIÊNG PRODUCT thì Excel BỎ QUA đối số rỗng (Excel 16 đo qua COM: PRODUCT(A1,) = A1, PRODUCT(A1,,A2) =
  // A1·A2), còn không sót số nào ("PRODUCT(;)") thì ra 0 — coi rỗng là 0 thì PRODUCT(F1;) ra 0 trong khi
  // tệp ghi "PRODUCT(G12,)" và Excel ra 58.000 (phản biện đợt 3, 7b).
  // Lời gọi không có đối số nào ("SUM()") giữ như cũ: danh sách rỗng.
  let hong = false;
  const khongDoiSo = doiSo.length === 1 && doiSo[0].trim() === "";
  let ds = khongDoiSo ? [] : doiSo;
  if (!khongDoiSo && HAM_BO_DOI_SO_RONG.has(ten.toUpperCase())) { const con = ds.filter((a) => a.trim() !== ""); ds = con.length ? con : ["0"]; }
  const vals = ds.map((a) => (a.trim() === "" ? 0 : evalArith(a))).filter((v): v is number => { if (v === null || !isFinite(v)) { hong = true; return false; } return true; });
  if (hong) return "NaN";
  const r = fn(vals);
  // BỌC NGOẶC (L37): trả chuỗi trần thì kết quả dính vào chữ số đứng cạnh — "=2SUM(F2;F3)" thành
  // "2"+"1113000" = 21.113.000, "=SUM(F2)SUM(F3)" thành 105.000.063.000, ô không đỏ. "(1113000)" đứng
  // sát "2" là lỗi cú pháp như Excel; biểu thức đúng ("2*(…)", "-(…)") không đổi nghĩa.
  return r === null || !isFinite(r) ? "NaN" : "(" + String(r) + ")";
}

/** Dải ô "F1:F3" ở vị trí `viTri` có đứng NGUYÊN làm một đối số không: trước là "(" / ";" / đầu chuỗi,
 *  sau là ")" / ";" / cuối chuỗi (bỏ qua khoảng trắng). BẢN SAO ở src/quoteFormula.ts. */
function daiNguyenDoiSo(ca: string, viTri: number, dai: number): boolean {
  const truoc = ca.slice(0, viTri).replace(/\s+$/, "").slice(-1), sau = ca.slice(viTri + dai).replace(/^\s+/, "").charAt(0);
  return (truoc === "" || truoc === "(" || truoc === ";") && (sau === "" || sau === ")" || sau === ";");
}
/** Trần TỔNG số ô mà MỘT lần evalFormula được bung ra qua mọi dải — CỘNG DỒN như evalBudget /
 *  MAX_REF_ROWS của bộ tự kiểm ở src/quoteFormula.ts. Bản trước kiểm TỪNG dải: "=SUM(F1:F20000;…)" 150
 *  dải vượt bảng (1.505 ký tự, lưu được) bung 3 triệu ô mỗi lần gọi (đo 809 ms), mà lưới gọi nhiều lượt
 *  mỗi phím gõ / mỗi lần tính lại → đứng hình cho mọi người mở báo giá đó (soát toàn diện đợt 3). */
const TRAN_O_BUNG = 20_000;
const soCot = (L: string) => { let n = 0; for (const ch of L.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };
const chuCot = (n: number) => { let s = "", x = n + 1; while (x > 0) { const m = (x - 1) % 26; s = String.fromCharCode(65 + m) + s; x = Math.floor((x - 1) / 26); } return s; };
/** Bung dải "F1:F50" thành từng ô qua refs.cell (cột A,B,C… liên tiếp như sơ đồ địa chỉ của lưới).
 *  null = dải vượt phần ngân sách còn lại (`tran`) → cả công thức lỗi, không bung hàng triệu ô ra bộ nhớ. */
function bungDai(a: string, b: string, refs: FormulaRefs, tran: number): number[] | null {
  const pa = /^\$?([A-Za-z]+)\$?(\d+)$/.exec(a), pb = /^\$?([A-Za-z]+)\$?(\d+)$/.exec(b);
  if (!pa || !pb) return [];
  const c0 = Math.min(soCot(pa[1]), soCot(pb[1])), c1 = Math.max(soCot(pa[1]), soCot(pb[1]));
  const r0 = Math.min(Number(pa[2]), Number(pb[2])), r1 = Math.max(Number(pa[2]), Number(pb[2]));
  if ((c1 - c0 + 1) * (r1 - r0 + 1) > tran) return null;
  const out: number[] = [];
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) { const v = refs.cell(chuCot(c) + r); out.push(v === null || v === undefined || isNaN(v) ? 0 : v); }
  return out;
}

export function evalFormula(input: string, refs?: FormulaRefs): number | null {
  let s = String(input).trim().replace(/^=/, "");
  if (!s) return null;
  // "x" nhân TRƯỚC chuẩn hoá dấu phẩy: "2x1,5" để sau thì "x1" bị coi là ô tham chiếu (L30).
  s = s.replace(/×/g, "*").replace(/(\d)\s*[xX]\s*(?=\d)/g, "$1*");
  const chuan = chuanHoaDauTachDoiSo(s);
  if (chuan === null) return null;   // dấu phẩy mơ hồ / dính ô tham chiếu → ô đỏ, không đoán
  s = chuan;
  if (refs) {
    // Dấu "," tách đối số ("=SUM(E1,E2)", "=ROUND(G3,2)") đã được chuanHoaDauTachDoiSo ở trên đổi
    // thành ";" — CÙNG một hàm với src/quoteFormula.ts, để bước tự kiểm lúc xuất Excel (so số máy chủ
    // với số web đã lưu) không lệch. Đừng thêm luật dấu phẩy riêng ở đây mà không thêm ở máy chủ.
    // $ chỉ có ý nghĩa lúc COPY/DÁN (khoá không cho dịch); khi TÍNH thì bỏ qua, y như Excel.
    let daiLoi = false;
    let nganSach = TRAN_O_BUNG;   // cộng dồn qua MỌI dải của công thức này (dải trong bảng lẫn dải phải bung)
    s = s.replace(/(\$?[A-Za-z]+\$?\d+)\s*:\s*(\$?[A-Za-z]+\$?\d+)/g, (m, a, b, viTri: number, ca: string) => {
      if (daiLoi) return "0";   // đã hỏng: khỏi giải tiếp các dải sau
      // Dải phải là NGUYÊN MỘT đối số (hoặc cả công thức): "SUM(F1:F3*2)" / "SUM(-F1:F3)" bung ra thành
      // SUM(a;b;c*2) — nghĩa khác hẳn, còn Excel ra #VALUE! (hoặc mảng) → tệp lệch app.
      if (!daiNguyenDoiSo(ca, viTri, m.length)) { daiLoi = true; return "0"; }
      // Bộ giải của lưới trả null khi MỘT đầu dải nằm ngoài bảng ("=SUM(F1:F50)" trên bảng 4 hàng) —
      // bản cũ thay cả dải bằng "0": mất cả tổng mà ô không đỏ, còn Excel / bộ tự kiểm máy chủ ra
      // 115.000 (L33). Khi đó bung dải qua refs.cell: ô ngoài bảng = 0 y như ô trống Excel và y như
      // tham chiếu ô đơn ("=F1+F9").
      const list = refs.range(a, b) ?? bungDai(a, b, refs, nganSach);
      if (list === null || (nganSach -= list.length) < 0) { daiLoi = true; return "0"; }
      return list.length ? list.join(";") : "0";
    });
    if (daiLoi) return null;
    s = s.replace(/(?<![A-Za-z0-9_.$])(\$?[A-Za-z]+\$?\d+)/g, (_m, a) => { const v = refs.cell(a); return v === null || v === undefined || isNaN(v) ? "0" : String(v); });
  }
  s = s.replace(/(\d+(?:[.,]\d+)?)\s*%/g, (_m, n) => String(Number(String(n).replace(",", ".")) / 100));
  const rutGon = rutGonHam(s);
  if (rutGon === null) return null;
  return evalArith(rutGon);
}
