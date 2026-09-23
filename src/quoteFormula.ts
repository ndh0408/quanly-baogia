// Mang CÔNG THỨC người dùng TỰ GÕ trong editor (QuoteItem.formulas) RA file Excel.
//
// Bối cảnh: editor cho gõ công thức kiểu Excel vào ô Số Lượng / Đơn Giá / Số Ngày
// (vd "=1000000*8%", "=G3*1,1", "=SUM(H3:H8)"). Trước đây export CHỈ ghi con số đã
// tính — khách mở file bấm vào ô không thấy "=…". Module này dịch công thức editor
// sang công thức Excel thật để xuất ra.
//
// HAI hệ toạ độ KHÁC nhau phải khớp:
//   • Cột:  editor đánh A,B,C… theo thứ tự HIỂN THỊ (_stt=A, name=B, [detail], unit,
//           quantity, [days], unitPrice, _amount, notes) — KHÁC cột Excel của template
//           (vd GN: quantity=F, unitPrice=G, amount=H). Dịch qua TÊN FIELD trung gian.
//   • Hàng: editor ref dùng (chỉ số item + 1); Excel dùng hàng thật (firstRow + slot),
//           có chèn hàng nhóm ở giữa. Dịch qua slotRows.
//
// AN TOÀN LÀ TRÊN HẾT (báo giá = tiền của khách): mọi công thức dịch xong đều được
// TỰ KIỂM (đánh giá lại bằng bộ eval port từ frontend, so với giá trị đã lưu). Bất cứ
// nghi ngờ nào (hàm lạ, ref ngoài bảng, ref trỏ vào hàng nhóm/chữ, kết quả lệch) →
// QUAY VỀ ghi số như cũ. Vì vậy thay đổi này CHỈ tốt hơn, không bao giờ làm hỏng export.

// Hàm Excel có tên + ngữ nghĩa khớp 1:1 với bộ eval của editor → an toàn để xuất.
// CEILING/FLOOR bị LOẠI: editor coi là ceil/floor 1 đối số, còn Excel BẮT BUỘC có
// đối số "significance" → xuất ra sẽ lỗi ô. Công thức như vậy quay về ghi số.
const SAFE_FNS = new Set(["SUM", "PRODUCT", "AVERAGE", "MIN", "MAX", "ROUND", "ROUNDUP", "ROUNDDOWN", "INT", "ABS"]);
// TRUNC(number,digits) và ROUNDDOWN(number,digits) cùng cắt phần dư về phía 0. File báo giá cũ
// dùng TRUNC rất nhiều, còn editor chuẩn hoá về ROUNDDOWN để chỉ giữ một cách viết.
const FN_ALIAS: Record<string, string> = { AVG: "AVERAGE", TRUNC: "ROUNDDOWN" };

// Trần TỔNG số ref mà MỘT công thức được phép bung ra. Một trang lưu tối đa 1000 dòng
// (sheetSchema trong src/validators.ts) nên 20.000 đã là 20 lần dư cho mọi báo giá thật; vượt trần
// nghĩa là công thức rác hoặc cố ý phá, và cách xử lý an toàn của module này luôn là "ghi con số".
//
// PHẢI LÀ TRẦN TÍCH LUỸ, KHÔNG PHẢI TRẦN THEO TỪNG DẢI. Bản vá đầu chỉ kiểm `r1 - r0` bên trong
// mỗi dải, nên "=SUM(G1:G20001,G1:G20001,…)" lặp 199 lần — dài đúng 1995 ký tự, LỌT trần 2000 ký
// tự của `formulas` trong validators.ts — vẫn bung ~4.000.000 đối tượng (đo được 1265 ms / 430 MB
// heap cho MỘT ô). Mỗi lần xuất file gọi cellFormula cho TỪNG item × từng trường số, nên chi phí
// đó nhân lên hàng nghìn lần; worker xuất hết hạn 30 s rồi rơi về chạy NỘI TUYẾN trên luồng chính.
const MAX_REF_ROWS = 20_000;

/** 0→"A", 1→"B", …, 25→"Z", 26→"AA". Cột editor (giống groupLetter ở frontend). */
export function colLetter(n: number) {
  let s = "", x = n + 1;
  while (x > 0) { const m = (x - 1) % 26; s = String.fromCharCode(65 + m) + s; x = Math.floor((x - 1) / 26); }
  return s;
}

// ===== Bộ eval công thức editor — PORT TRUNG THÀNH từ public/js/editor.js =====
// CHỈ dùng để TỰ KIỂM: công thức dịch xong có còn cho ra đúng giá trị đã lưu không.
// Phải giữ khớp với frontend; có test ghim. (Nếu lệch → tự kiểm trượt → ghi số: an toàn.)
function evalArith(input: string) {
  // Khoảng trắng kẹp giữa hai phần của số ("1 000 000", "100, 0") = lỗi, y hệt web (L28): Excel đọc
  // dấu cách giữa hai toán hạng là toán tử giao vùng, tệp chứa nó KHÔNG mở được.
  if (/[\d.,]\s+[\d.,]/.test(String(input))) return null;
  const s = String(input).replace(/,/g, ".").replace(/\s+/g, "");
  if (!s || !/^[-+*/().0-9]+$/.test(s)) return null;
  let pos = 0;
  const peek = () => s[pos];
  function expr(): number | null {
    let v = term();
    while (peek() === "+" || peek() === "-") { const op = s[pos++]; const r = term(); if (v === null || r === null) return null; v = op === "+" ? v + r : v - r; }
    return v;
  }
  function term(): number | null {
    let v = factor();
    while (peek() === "*" || peek() === "/") { const op = s[pos++]; const r = factor(); if (v === null || r === null) return null; v = op === "*" ? v * r : v / r; }
    return v;
  }
  function factor(): number | null {
    if (peek() === "(") { pos++; const v = expr(); if (peek() !== ")") return null; pos++; return v; }
    if (peek() === "-") { pos++; const v = factor(); return v === null ? null : -v; }
    if (peek() === "+") { pos++; return factor(); }
    let num = "";
    while (pos < s.length && /[0-9.]/.test(s[pos])) num += s[pos++];
    if (!num || isNaN(Number(num))) return null;
    return Number(num);
  }
  const result = expr();
  if (pos !== s.length || result === null || !isFinite(result)) return null;
  return result;
}

// LÀM TRÒN KIỂU EXCEL — y hệt web/src/lib/formula.ts (xem chú thích đầy đủ ở đó). Tóm tắt: chuẩn hoá
// toán hạng về 15 chữ số có nghĩa (3000*1,1 = 3300,0000000000005 → 3300), làm tròn TRỊ TUYỆT ĐỐI rồi
// trả dấu (ROUND(-52500;-3) = -53.000 như Excel, không phải -52.000), dịch dấu phẩy bằng số mũ thập
// phân. Bản cũ lệch Excel ở 1.323/3.010 ca đo bằng Excel thật; vì bước tự kiểm dùng CHÍNH bộ tính này
// nên tệp xuất ghi công thức kèm result sai, Excel (fullCalcOnLoad) mở ra số khác app/PDF.
const so15 = (x: number) => Number(x.toPrecision(15));
const dichThapPhan = (x: number, d: number) => { const [m, e] = String(x).split("e"); return Number(m + "e" + (Number(e || 0) + d)); };
function lamTronExcel(x: number, soChuSo: number, kieu: "tron" | "len" | "xuong"): number {
  const n = so15(x), d = Math.trunc(soChuSo);
  if (!isFinite(n) || !isFinite(d)) return NaN;
  const v = dichThapPhan(Math.abs(n), d);
  if (!isFinite(v)) return n;
  const r = kieu === "tron" ? Math.round(v) : kieu === "len" ? Math.ceil(v) : Math.floor(v);
  const kq = Math.sign(n) * dichThapPhan(r, -d);
  return kq === 0 ? 0 : kq;
}

const FORMULA_FNS: Record<string, (a: number[]) => number> = {
  SUM: (a) => a.reduce((x, y) => x + y, 0),
  PRODUCT: (a) => a.reduce((x, y) => x * y, 1),
  AVERAGE: (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0),
  AVG: (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0),
  MIN: (a) => (a.length ? Math.min(...a) : 0),
  MAX: (a) => (a.length ? Math.max(...a) : 0),
  ROUND: (a) => lamTronExcel(a[0] || 0, a[1] || 0, "tron"),
  ROUNDUP: (a) => lamTronExcel(a[0] || 0, a[1] || 0, "len"),
  ROUNDDOWN: (a) => lamTronExcel(a[0] || 0, a[1] || 0, "xuong"),
  INT: (a) => Math.floor(so15(a[0] || 0)),
  ABS: (a) => Math.abs(a[0] || 0),
  CEILING: (a) => Math.ceil(a[0] || 0),
  FLOOR: (a) => Math.floor(a[0] || 0),
};

/** Giải tham chiếu ô theo HỆ TOẠ ĐỘ EDITOR (cho bộ tự kiểm). */
type EditorRefs = {
  cell: (addr: string) => number;
  range: (a: string, b: string) => number[];
};

/**
 * DẤU PHẨY TÁCH ĐỐI SỐ KIỂU EXCEL TIẾNG ANH → ";" (quy ước của app). BẢN SAO của
 * web/src/lib/formula.ts — luật và lý do đầy đủ ghi ở đó; sửa quy tắc thì sửa CẢ HAI.
 *
 * Tóm tắt: chỉ xét "," trong danh sách đối số của một HÀM. "," không thể là thập phân (sát ô tham
 * chiếu / dấu âm / ngoặc) → ";" — kể cả khi công thức đã có ";" (L29: "=ROUND(SUM(F1,F2);-3)"). ","
 * giữa hai chữ số: công thức đã có ";" / hàm một đối số → thập phân; ROUND* chỉ một dấu phẩy "số,số"
 * → MƠ HỒ (L30, trừ "…,0)"); hàm nhiều đối số → thập phân trừ khi trông rõ là kiểu Anh (L34: phần sau
 * ≥ 4 chữ số / tận cùng 0 / đã có dấu phẩy khác bị đổi). Mơ hồ, hoặc "," / "." còn dính ô tham chiếu
 * ("=F1,5", "=F1.5") → null: bộ tự kiểm trả null → xuất Excel ghi SỐ, không ghi "G13.5" hay công thức
 * mang nghĩa khác số app đang hiện. Gọi SAU khi đã đổi "x" nhân thành "*".
 */
const HAM_HAI_DOI_SO = /^ROUND(UP|DOWN)?$/;
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
        return { i, sau, soSo: soTruoc && /^\d/.test(sau) };
      });
      const chac = ds.filter((p) => !p.soSo), soSo = ds.filter((p) => p.soSo);
      for (const p of chac) { out[p.i] = ";"; daDoi = true; }
      if (!soSo.length || kieuViet || HAM_MOT_DOI_SO.test(k.fn)) return;
      if (HAM_HAI_DOI_SO.test(k.fn)) {
        if (chac.length) return;   // đã đủ dấu tách: phần còn lại là thập phân (thừa đối số thì chốt ở translateFormula)
        if (soSo.length === 1 && /^0+\s*\)/.test(soSo[0].sau)) { out[soSo[0].i] = ";"; daDoi = true; return; }
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
 * Rút gọn lời gọi hàm từ TRONG CÙNG ra — y hệt rutGonHam ở web/src/lib/formula.ts (xem chú thích ở
 * đó): đối số được phép có ngoặc thường ("ROUND(F1*(1+8%);0)", L31), tách đối số theo ";" ở tầng
 * ngoài cùng của lời gọi, ngoặc lệch → null.
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
      if (dong < 0) return null;
      const trong = s.slice(mo + 1, dong);
      if (/[A-Za-z]+\s*\(/.test(trong)) continue;
      chon = { dau: m.index, ten: m[1], trong, cuoi: dong };
      break;
    }
    if (!chon) return null;
    s = s.slice(0, chon.dau) + goiHam(chon.ten, chon.trong) + s.slice(chon.cuoi + 1);
  }
  return s;
}
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
  // Đối số KHÔNG đọc được → cả công thức lỗi (GRID-03), y hệt web: không lọc bỏ im lặng rồi tính
  // tiếp trên phần còn lại. Đối số rỗng ("SUM()") bỏ qua.
  let hong = false;
  const vals = doiSo.filter((a) => a.trim() !== "").map((a) => evalArith(a)).filter((v): v is number => { if (v === null || !isFinite(v)) { hong = true; return false; } return true; });
  if (hong) return "NaN";
  const r = fn(vals);
  // Bọc ngoặc như web (L37): "=2SUM(F2;F3)" không còn ghép thành 21.113.000 mà là lỗi.
  return (r === null || !isFinite(r)) ? "NaN" : "(" + String(r) + ")";
}

/** Đánh giá công thức editor (cú pháp ";" tách đối số, "," là dấu thập phân — dấu phẩy tách đối
 *  số kiểu Excel tiếng Anh được đổi trước bằng chuanHoaDauTachDoiSo). refs giải tham chiếu ô. */
export function evalEditorFormula(input: string, refs?: EditorRefs) {
  let s = String(input).trim().replace(/^=/, "");
  if (!s) return null;
  s = s.replace(/×/g, "*").replace(/(\d)\s*[xX]\s*(?=\d)/g, "$1*");   // TRƯỚC chuẩn hoá dấu phẩy (L30)
  const chuan = chuanHoaDauTachDoiSo(s);
  if (chuan === null) return null;
  s = chuan;
  if (refs) {
    s = s.replace(/(\$?[A-Za-z]+\$?\d+)\s*:\s*(\$?[A-Za-z]+\$?\d+)/g, (_m, a, b) => {
      const list = refs.range(a, b);
      return (list && list.length) ? list.join(";") : "0";
    });
    s = s.replace(/(?<![A-Za-z0-9_.$])(\$?[A-Za-z]+\$?\d+)/g, (_m, a) => {
      const v = refs.cell(a);
      return (v === null || v === undefined || isNaN(v)) ? "0" : String(v);
    });
  }
  s = s.replace(/(\d+(?:[.,]\d+)?)\s*%/g, (_m, n) => String(Number(n.replace(",", ".")) / 100));
  const rutGon = rutGonHam(s);
  if (rutGon === null) return null;
  return evalArith(rutGon);
}

/** Bộ toạ độ + kiểm hợp lệ để dịch công thức editor → Excel cho MỘT sheet. */
type FormulaContext = {
  colToField: Record<string, string>;             // cột editor (A,B,…) → tên field
  fieldToCol: Record<string, string | undefined>; // tên field → cột Excel (có thể thiếu)
  allowedRef: Set<string>;                         // field được phép tham chiếu
  rowToExcel: (editorRow: number) => number | null;
  rangeOk: (editorRow1: number, editorRow2: number) => boolean;
};

/**
 * Dịch MỘT công thức editor sang chuỗi công thức Excel (KHÔNG có dấu "=" đầu, hợp với
 * ExcelJS `{ formula }`), hoặc trả null nếu KHÔNG dịch được (gọi nơi dùng sẽ ghi số).
 *
 * ctx:
 *   colToField  : { "E": "quantity", … }  cột editor → tên field
 *   fieldToCol  : { "quantity": "F", "_amount": "H", … }  tên field → cột Excel
 *   allowedRef  : Set  field được phép tham chiếu (số/_amount; KHÔNG cho chữ/_stt)
 *   rowToExcel  : (editorRow:number) → excelRow:number | null   (null nếu hàng không hợp lệ)
 *   rangeOk     : (editorRow1, editorRow2) → bool   (Excel có liền mạch & toàn hàng item không)
 */
export function translateFormula(raw: string | null | undefined, ctx: FormulaContext) {
  if (raw == null) return null;
  let s = String(raw).trim().replace(/^=/, "");
  if (!s) return null;
  // "×" và "x"/"X" giữa hai chữ số = nhân (giống editor) — TRƯỚC chuẩn hoá dấu phẩy, kẻo "2x1,5" có
  // "x1" bị coi là ô tham chiếu (L30).
  s = s.replace(/×/g, "*").replace(/(\d)\s*[xX]\s*(?=\d)/g, "$1*");
  // "," tách đối số kiểu Excel EN → ";" TRƯỚC khi "," bị đọc là thập phân. Mơ hồ → không dịch.
  const chuan = chuanHoaDauTachDoiSo(s);
  if (chuan === null) return null;
  s = chuan;

  // Đổi tham chiếu ô (đơn lẻ HOẶC dải) sang toạ độ Excel — quét 1 lượt để dải không
  // bị xử lý hai lần. Tên hàm (SUM…) không có chữ số đuôi nên KHÔNG bị bắt nhầm.
  let aborted = false;
  // ($?) hai bên: GIỮ NGUYÊN khoá tuyệt đối của người dùng khi ghi ra Excel — Excel hiểu $, và
  // trước đây chốt chặn ở dưới không cho ký tự $ nên cả công thức bị bỏ, ô chỉ còn số chết.
  const refRe = /(\$?)([A-Za-z]+)(\$?)(\d+)(?:\s*:\s*(\$?)([A-Za-z]+)(\$?)(\d+))?/g;
  s = s.replace(refRe, (m, cl1, c1, rl1, r1, cl2, c2, rl2, r2) => {
    if (aborted) return m;
    const a = mapRef(ctx, c1, r1);
    if (!a) { aborted = true; return m; }
    if (c2 && r2) {
      const b = mapRef(ctx, c2, r2);
      // Dải PHẢI cùng một cột Excel + liền mạch + toàn hàng item (không chèn nhóm).
      if (!b || a.col !== b.col || !ctx.rangeOk(Number(r1), Number(r2))) { aborted = true; return m; }
      return `${cl1}${a.col}${rl1}${a.row}:${cl2}${b.col}${rl2}${b.row}`;
    }
    return `${cl1}${a.col}${rl1}${a.row}`;
  });
  if (aborted) return null;

  // Số kiểu VN: dấu thập phân "," → "."; rồi dấu tách đối số ";" → "," (chuẩn công thức Excel).
  // (editor chỉ dùng ";" tách đối số nên mọi "," còn lại đều là thập phân.)
  s = s.replace(/,/g, ".").replace(/;/g, ",");
  // Dấu "." dính ô tham chiếu ("G13.5", "G13.G14") — Excel đọc là dải kiểu Lotus hoặc #NAME? (L29).
  // chuanHoaDauTachDoiSo đã chặn từ trước; chốt lại ở đây theo cú pháp để không phụ thuộc bộ tính.
  if (/[A-Za-z]\$?\d+\.|\.\$?[A-Za-z]+\$?\d/.test(s)) return null;

  // Tên hàm: đổi bí danh (AVG→AVERAGE) + chỉ cho phép hàm an toàn; gặp hàm lạ → null.
  let bad = false;
  s = s.replace(/([A-Za-z]+)\s*\(/g, (m, name) => {
    const mapped = FN_ALIAS[name.toUpperCase()] || name.toUpperCase();
    if (!SAFE_FNS.has(mapped)) { bad = true; return m; }
    return `${mapped}(`;
  });
  if (bad) return null;

  // Chốt chặn KHOẢNG TRẮNG (L28): dấu cách GIỮA hai toán hạng ("MAX(G13-100. 0)", "1 000 000*8%",
  // "G12 G13") là toán tử giao vùng của Excel → sai cú pháp → Excel KHÔNG MỞ ĐƯỢC cả tệp (đo bằng
  // Excel COM, kể cả chế độ sửa chữa). Gặp là ghi số. Khoảng trắng còn lại chỉ nằm cạnh toán tử/
  // ngoặc/dấu phẩy nên bỏ hết đi không đổi nghĩa — tệp không bao giờ mang khoảng trắng nào.
  if (/[A-Za-z0-9.)%]\s+[A-Za-z0-9.($]/.test(s)) return null;
  s = s.replace(/\s+/g, "");
  // Chốt chặn THIẾU TOÁN TỬ (L37): số / ")" / "%" đứng sát tên hàm, ô tham chiếu hay "(", hoặc ")" /
  // "%" đứng sát một số — "2SUM(…)", "SUM(…)SUM(…)", "2(G13)", "ROUND(G13,-3)5" — Excel không đọc được
  // (tệp phải "sửa chữa", công thức bị xoá). Trước đây lọt cả chốt ký tự lẫn soDoiSoHopLe, và bộ tự
  // kiểm cũng ghép số y như lưới nên khớp nhau.
  if (/[\d.)%][A-Za-z($]|[)%][\d.]/.test(s)) return null;

  // Chốt chặn: chỉ còn ký tự hợp lệ của công thức Excel.
  if (!/^[A-Za-z0-9.,:%+\-*/()$]+$/.test(s)) return null;   // $ = khoá tuyệt đối, hợp lệ trong Excel
  // Chốt chặn: SỐ ĐỐI SỐ đúng như Excel đòi. Excel gặp hàm sai số đối số thì coi cả công thức là
  // hỏng: lúc mở tệp báo "We found a problem… Removed Records: Formula" rồi XOÁ công thức. Đo được
  // ở production 2026-09-23: "=ROUND(E2*63000,-3)" (dấu phẩy kiểu Excel tiếng Anh) bị đọc thành
  // thập phân → ghi ra "ROUND(F13*63000.-3)" — ROUND chỉ còn MỘT đối số — và bước tự kiểm ở
  // cellFormula KHÔNG bắt được, vì bộ tính cũ cũng đọc sai y như vậy nên hai con số khớp nhau.
  // Chặn theo cú pháp thì không phụ thuộc bộ tính: sai số đối số → ghi số, tệp luôn mở sạch.
  if (!soDoiSoHopLe(s)) return null;
  return s;
}

/** Số đối số Excel cho phép của từng hàm trong SAFE_FNS: [ít nhất, nhiều nhất]. */
const SO_DOI_SO: Record<string, [number, number]> = {
  ROUND: [2, 2], ROUNDUP: [2, 2], ROUNDDOWN: [2, 2], INT: [1, 1], ABS: [1, 1],
  SUM: [1, 255], PRODUCT: [1, 255], AVERAGE: [1, 255], MIN: [1, 255], MAX: [1, 255],
};
/** Đếm đối số từng lời gọi hàm trong công thức ĐÃ ở cú pháp Excel ("," tách đối số). */
export function soDoiSoHopLe(s: string): boolean {
  const khung: { fn: string | null; soDauPhay: number; rong: boolean }[] = [];
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "(") {
      const m = /([A-Za-z]+)\s*$/.exec(s.slice(0, i));
      khung.push({ fn: m ? m[1].toUpperCase() : null, soDauPhay: 0, rong: /^\s*\)/.test(s.slice(i + 1)) });
    } else if (ch === ")") {
      const k = khung.pop();
      if (!k) return false;                                   // ngoặc đóng thừa
      if (!k.fn) { if (k.soDauPhay) return false; continue; } // "(a,b)" không phải lời gọi hàm
      const gioiHan = SO_DOI_SO[k.fn];
      if (!gioiHan) continue;
      const n = k.rong ? 0 : k.soDauPhay + 1;
      if (n < gioiHan[0] || n > gioiHan[1]) return false;
    } else if (ch === "," ) {
      if (!khung.length) return false;                        // dấu phẩy ngoài mọi ngoặc
      khung[khung.length - 1].soDauPhay++;
    }
  }
  return khung.length === 0;                                  // ngoặc mở thiếu đóng
}

// ===== CHIỀU NGƯỢC: công thức Excel (file khách gửi lại) → công thức EDITOR =====
// Dùng khi NHẬP file Excel vào báo giá (src/excelImport.ts). Kết quả ở dạng CANONICAL — ref viết
// theo TÊN FIELD, không theo chữ cột: "{unitPrice:3}*{quantity:3}". Vì chữ cột của editor phụ
// thuộc mẫu ĐÍCH (có/không cột Chi Tiết, có/không Số Ngày), nên server trả canonical rồi web tự
// đổi sang chữ cột của lưới đang mở (lib/importApply.ts). Nạp sang mẫu khác cũng không lệch ô.
export type ExcelRefCtx = {
  /** Chữ cột Excel ("G") → tên field ("unitPrice"), null nếu cột đó không nằm trong bảng. */
  fieldOfCol: (colLetters: string) => string | null;
  /** Hàng Excel (13) → dòng editor 1-based (vị trí trong mảng items + 1), null nếu ngoài bảng. */
  rowToEditor: (excelRow: number) => number | null;
};

/** Ref canonical "{field:row}" — web đổi sang chữ cột của lưới đích. */
export const canonicalRef = (field: string, row: number) => `{${field}:${row}}`;

/**
 * Dịch MỘT công thức Excel đọc từ file sang dạng canonical của editor, hoặc null nếu không dịch
 * được (ref sang sheet khác, hàm lạ, ref ngoài bảng…). Nơi gọi khi đó chỉ giữ CON SỐ.
 * Lưu ý cú pháp: Excel dùng "," tách đối số + "." thập phân; editor dùng ";" tách đối số.
 */
export function excelFormulaToEditor(raw: string | null | undefined, ctx: ExcelRefCtx): string | null {
  if (raw == null) return null;
  let s = String(raw).trim().replace(/^=/, "").trim();
  if (!s || s.length > 500) return null;
  // Ref sang sheet khác ('Sheet 2'!G13 / Décor!G13) hoặc file ngoài ([1]DATA!A1) → không dịch được.
  if (/!/.test(s) || /\[\d*\]/.test(s) || /"/.test(s)) return null;
  // $ (khoá tuyệt đối) được NUỐT ở regex dưới rồi bỏ đi: dạng canonical ("{unitPrice:3}") không có
  // chỗ ghi khoá. Công thức vẫn tính đúng y nguyên; chỉ mất tính "khoá" nếu sau này người dùng
  // copy/dán ô đó trong lưới. Muốn giữ thì phải mở rộng canonical + lib/importApply.ts cùng lúc.
  let aborted = false;
  s = s.replace(/\$?([A-Za-z]+)\$?(\d+)(?:\s*:\s*\$?([A-Za-z]+)\$?(\d+))?/g, (m, c1, r1, c2, r2) => {
    if (aborted) return m;
    const f1 = ctx.fieldOfCol(String(c1).toUpperCase());
    const row1 = ctx.rowToEditor(Number(r1));
    if (!f1 || row1 == null) { aborted = true; return m; }
    if (c2 && r2) {
      const f2 = ctx.fieldOfCol(String(c2).toUpperCase());
      const row2 = ctx.rowToEditor(Number(r2));
      // Dải PHẢI cùng một cột (SUM(H13:H15)); dải ngang/lệch cột → bỏ.
      if (f2 !== f1 || row2 == null) { aborted = true; return m; }
      return `${canonicalRef(f1, Math.min(row1, row2))}:${canonicalRef(f1, Math.max(row1, row2))}`;
    }
    return canonicalRef(f1, row1);
  });
  if (aborted) return null;

  // Đối số: Excel "," → editor ";". (Số thập phân trong công thức Excel dùng "." nên "," còn lại
  // đều là dấu tách đối số. Ref đã thành {field:row} nên không dính dấu nào.)
  s = s.replace(/,/g, ";");

  // Tên hàm: chỉ nhận hàm editor hiểu ĐÚNG ngữ nghĩa; hàm lạ (IF/VLOOKUP/CEILING 2 đối số…) → bỏ,
  // ô đó giữ nguyên con số Excel đã tính (an toàn hơn là dịch sai tiền).
  let bad = false;
  s = s.replace(/([A-Za-z]+)\s*\(/g, (m, name) => {
    const mapped = FN_ALIAS[String(name).toUpperCase()] || String(name).toUpperCase();
    if (!SAFE_FNS.has(mapped)) { bad = true; return m; }
    return `${mapped}(`;
  });
  if (bad) return null;

  // Chốt chặn ký tự: chỉ còn số/toán tử/hàm/ref canonical.
  if (!/^[A-Za-z0-9.;:%+\-*/(){}_ ]+$/.test(s)) return null;
  return `=${s}`;
}

/** Bóc lớp ROUND(...,n) do CHÍNH app bọc lúc xuất (Số Lượng = ROUND(fx,1)) để lấy lại công thức gốc. */
export function unwrapRound(formula: string, digits: number): string {
  const s = String(formula).trim().replace(/^=/, "");
  const re = new RegExp(`^ROUND\\s*\\(([\\s\\S]*),\\s*${digits}\\s*\\)$`, "i");
  const m = re.exec(s);
  if (!m) return s;
  // Chỉ bóc khi phần trong ngoặc CÂN dấu ngoặc — tránh cắt nhầm "ROUND(a,1)+ROUND(b,1)".
  let depth = 0;
  for (const ch of m[1]) { if (ch === "(") depth++; else if (ch === ")") { depth--; if (depth < 0) return s; } }
  return depth === 0 ? m[1].trim() : s;
}

function mapRef(ctx: FormulaContext, colLetters: string, rowDigits: string) {
  const field = ctx.colToField[colLetters.toUpperCase()];
  if (!field || !ctx.allowedRef.has(field)) return null;   // ref chữ/_stt/cột không có → bỏ
  const col = ctx.fieldToCol[field];
  if (!col) return null;
  const row = ctx.rowToExcel(Number(rowDigits));
  if (row == null) return null;
  return { field, col, row };
}

/** Item báo giá theo HỆ TOẠ ĐỘ EDITOR (giá trị từ DB/JSON → có thể là số hoặc chuỗi). */
type EditorItem = {
  kind?: string;
  quantity?: number | string | null;
  quantityExact?: boolean | null;
  unitPrice?: number | string | null;
  days?: number | string | null;
  formulas?: Record<string, string | undefined>;
};

/**
 * Dựng "bộ dịch công thức" cho MỘT sheet khi xuất Excel. Khép kín toàn bộ logic toạ độ
 * + tự kiểm để excel.js chỉ cần gọi `cellFormula(raw, computedValue)`.
 *
 * Tham số (lấy từ fillSheetData):
 *   cols       : itemsCfg.columns (field → cột Excel) của template
 *   items      : mảng item theo ĐÚNG THỨ TỰ EDITOR đã đánh số ref (TRƯỚC khi lọc dòng
 *                "info" của template CLF) — nên ref người dùng (row = index+1) khớp tuyệt đối.
 *   rowToExcel : (editorIndex0 : number) → hàng Excel của item ĐÓ nếu là ô tham chiếu được
 *                (item/sub đã đặt chỗ), ngược lại null. Tra theo ĐỊA CHỈ ĐỐI TƯỢNG item nên
 *                không lệ thuộc việc lọc/đổi chỉ số (xem cách dựng ở excel.js).
 */
export function buildFormulaContext(
  { cols, items, rowToExcel }: {
    cols: Record<string, string | undefined>;            // field → cột Excel của template
    items: EditorItem[];                                 // item theo thứ tự editor (ref = index+1)
    rowToExcel: (editorIndex0: number) => number | null;
  },
) {
  const usesDays = !!cols.days;

  // Sơ đồ cột EDITOR (khớp ADDR_COLS): _stt, name, [detail], unit, quantity, [days],
  // unitPrice, _amount, notes. (internalNote là cột CUỐI, không xuất → không lệch chữ.)
  const editorFields = ["_stt", "name"];
  if (cols.detail) editorFields.push("detail");
  editorFields.push("unit", "quantity");
  if (usesDays) editorFields.push("days");
  editorFields.push("unitPrice", "_amount", "notes");

  const colToField: Record<string, string> = {};
  editorFields.forEach((f, i) => { colToField[colLetter(i)] = f; });
  const fieldToColIndex: Record<string, number> = {};
  editorFields.forEach((f, i) => { fieldToColIndex[f] = i; });

  const fieldToCol = { ...cols, _stt: cols.stt, _amount: cols.amount };
  // Cho tham chiếu ô NHẬP LIỆU (Số Lượng / Đơn Giá / Số Ngày) VÀ cột THÀNH TIỀN (_amount) —
  // web cho chọn ô Thành Tiền (vd "=G3*E3", "=SUM(H3:H8)") nên Excel phải xuất được y hệt.
  // VÒNG LẶP (formula ở SL/ĐG trỏ vào Thành Tiền của CHÍNH nó, trực tiếp hay gián tiếp) được
  // chặn bằng ĐỒ THỊ PHỤ THUỘC (hasCycle bên dưới) — chỉ chặn đúng công thức tạo vòng.
  const allowedRef = new Set(["quantity", "unitPrice", "days", "_amount"]);

  const ctx = {
    colToField, fieldToCol, allowedRef,
    rowToExcel: (n: number) => rowToExcel(n - 1),
    rangeOk: (n1: number, n2: number) => {
      const a = Math.min(n1, n2) - 1, b = Math.max(n1, n2) - 1;
      let prev: number | null = null;
      for (let k = a; k <= b; k++) {
        const r = rowToExcel(k);              // section/info/blank/ngoài-bảng trong dải → bỏ
        if (r == null) return false;
        if (prev != null && r !== prev + 1) return false;   // không liền mạch trong Excel → bỏ
        prev = r;
      }
      return true;
    },
  };

  // Giá trị 1 ô theo HỆ TOẠ ĐỘ EDITOR (để tự kiểm) — mô phỏng cellNumByAddr ở frontend.
  // Thành Tiền PHẢI khớp lineAmount của web: SL làm tròn 1 số (qtyRound) rồi × giá, tròn VNĐ —
  // nếu tính raw sẽ lệch với web + Excel (ô SL trong Excel đã ROUND(...,1)).
  const qtyRound1 = (x: unknown) => { const n = Number(x) || 0; const t = Math.round(Math.abs(n) * 10 + 1e-6) / 10; return n < 0 ? -t : t; };
  const qtyExact4 = (x: unknown) => { const n = Number(x) || 0; const t = Math.round(Math.abs(n) * 10_000 + 1e-8) / 10_000; return n < 0 ? -t : t; };
  const amountOf = (it: EditorItem | undefined) => {
    if (!it || it.kind === "section" || it.kind === "subsection" || it.kind === "info") return 0;
    const q = it.quantityExact ? qtyExact4(it.quantity) : qtyRound1(it.quantity), p = Number(it.unitPrice) || 0;
    return Math.round(usesDays ? q * (Number(it.days) || 1) * p : q * p);
  };
  const editorCellNum = (addr: string) => {
    const m = /^\$?([A-Za-z]+)\$?(\d+)$/.exec(String(addr).trim());
    if (!m) return 0;
    const field = colToField[m[1].toUpperCase()];
    const it = items[Number(m[2]) - 1];
    if (!field || !it) return 0;
    if (field === "_amount") return amountOf(it);
    // SỐ LƯỢNG: trả số ĐÃ LÀM TRÒN, khớp amountOf() ngay trên và khớp lưới web (GridTable cellNum,
    // editor.js cellNumByAddr). Trả số thô thì self-check ở dưới lệch quá dung sai → cellFormula
    // trả null → công thức sống của người dùng bị âm thầm bỏ khỏi file Excel, chỉ còn số chết.
    if (field === "quantity") return it.quantityExact ? qtyExact4(it.quantity) : qtyRound1(it.quantity);
    if (field === "unitPrice" || field === "days") return Number(it[field]) || 0;
    return 0;   // _stt / cột chữ: không nằm trong công thức xuất được (allowedRef đã chặn)
  };
  // Xem MAX_REF_ROWS: ngân sách ref còn lại cho LẦN DỊCH công thức đang chạy (cellFormula đặt lại).
  let evalBudget = MAX_REF_ROWS;
  const editorRefs: EditorRefs = {
    cell: editorCellNum,
    range: (a: string, b: string) => {
      const pa = /^\$?([A-Za-z]+)\$?(\d+)$/.exec(a), pb = /^\$?([A-Za-z]+)\$?(\d+)$/.exec(b);
      if (!pa || !pb) return [];
      const c0 = Math.min(fieldToColIndex[colToField[pa[1].toUpperCase()]] ?? 0, fieldToColIndex[colToField[pb[1].toUpperCase()]] ?? 0);
      const c1 = Math.max(fieldToColIndex[colToField[pa[1].toUpperCase()]] ?? 0, fieldToColIndex[colToField[pb[1].toUpperCase()]] ?? 0);
      const r0 = Math.min(Number(pa[2]), Number(pb[2])), r1 = Math.max(Number(pa[2]), Number(pb[2]));
      // Cùng trần với refsInFormula: bộ tự kiểm KHÔNG được là đường vòng để bung lại dải khổng lồ.
      // Trả [] → evalEditorFormula thay dải bằng "0", tự kiểm lệch → cellFormula ghi số (an toàn).
      if (r1 - r0 > MAX_REF_ROWS) return [];
      const out: number[] = [];
      // Ngân sách TÍCH LUỸ: một công thức có thể chứa nhiều dải, mỗi dải dưới trần nhưng cộng lại
      // vẫn nổ. `evalBudget` được cellFormula đặt lại trước mỗi lần dịch nên nó là trần CHO MỘT
      // công thức, không phải trần cho cả đời context.
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
        if (--evalBudget < 0) return [];
        out.push(editorCellNum(colLetter(c) + r));
      }
      return out;
    },
  };

  // ===== ĐỒ THỊ PHỤ THUỘC — chặn VÒNG LẶP khi cho ref cột Thành Tiền =====
  // Node (rowIdx0, field). Cạnh: công thức tại (r,f) → các ref của nó; riêng _amount(r) LUÔN
  // phụ thuộc quantity/unitPrice/days của CHÍNH hàng r (ô Excel Thành Tiền = ROUND(SL×ĐG)).
  // Trả null nghĩa là "dải ô lớn bất thường, không dựng nổi đồ thị" → nơi gọi coi như KHÔNG DỊCH
  // ĐƯỢC và ghi con số (mặc định an toàn sẵn có của module).
  //
  // VÌ SAO PHẢI CÓ TRẦN: hàm này bung dải "G1:G<n>" thành MỘT đối tượng cho TỪNG hàng, và nó chạy
  // ở dòng đầu tiên của cellFormula — tức TRƯỚC translateFormula, nơi duy nhất từ chối hàng ngoài
  // bảng. Chuỗi công thức do người dùng gõ và chỉ bị giới hạn ĐỘ DÀI (validators.ts), nên
  // "=SUM(G1:G9999999)" lưu được bình thường; không có trần thì mỗi lần ai đó xuất báo giá ấy là
  // một lần ngốn hàng GB heap (và `stack.push(...deps)` còn tràn luôn call stack).
  const refsInFormula = (raw: string): { row: number; field: string }[] | null => {
    const out: { row: number; field: string }[] = [];
    const re = /\$?([A-Za-z]+)\$?(\d+)(?:\s*:\s*\$?([A-Za-z]+)\$?(\d+))?/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(String(raw)))) {
      const f1 = colToField[m[1].toUpperCase()];
      if (m[3] && m[4]) {
        const f2 = colToField[m[3].toUpperCase()];
        const r0 = Math.min(+m[2], +m[4]) - 1, r1 = Math.max(+m[2], +m[4]) - 1;
        if (r1 - r0 > MAX_REF_ROWS) return null;   // thoát sớm: một dải đã vượt trần thì khỏi đếm
        for (let r = r0; r <= r1; r++) {
          // Trần TÍCH LUỸ trên TỔNG `out` — trần theo từng dải ở trên KHÔNG đủ, vì một công thức
          // 1995 ký tự chứa được 199 dải, mỗi dải 20.001 hàng (xem ghi chú ở MAX_REF_ROWS).
          if (out.length >= MAX_REF_ROWS) return null;
          if (f1) out.push({ row: r, field: f1 });
          if (f2 && f2 !== f1) out.push({ row: r, field: f2 });
        }
      } else if (f1) out.push({ row: +m[2] - 1, field: f1 });
    }
    return out;
  };
  const depsOf = (row: number, field: string): { row: number; field: string }[] | null => {
    if (field === "_amount") {
      const base = [{ row, field: "quantity" }, { row, field: "unitPrice" }];
      if (usesDays) base.push({ row, field: "days" });
      return base;
    }
    const raw = items[row]?.formulas?.[field];
    return raw ? refsInFormula(raw) : [];
  };
  const hasCycle = (row: number, field: string, raw: string) => {
    const start = `${row}|${field}`;
    const seen = new Set<string>();
    const stack = refsInFormula(raw);
    if (stack === null) return true;   // dải ô khổng lồ → không kết luận được → coi như vòng (ghi số)
    let guard = 0;
    while (stack.length) {
      if (guard++ > 5000) return true;   // đồ thị quá lớn/bất thường → coi như vòng (an toàn)
      const n = stack.pop()!;
      const key = `${n.row}|${n.field}`;
      if (key === start) return true;
      if (seen.has(key)) continue;
      seen.add(key);
      const deps = depsOf(n.row, n.field);
      if (deps === null) return true;   // hàng khác có công thức dải khổng lồ → dừng, đừng bung nó ra
      stack.push(...deps);
    }
    return false;
  };

  return {
    /**
     * Trả công thức Excel cho ô có công thức gốc `raw` nếu DỊCH ĐƯỢC và TỰ KIỂM khớp
     * computedValue; ngược lại null (nơi gọi ghi số như cũ). `self` (item đang ghi + field)
     * để chặn VÒNG khi công thức tham chiếu cột Thành Tiền — thiếu self thì ref _amount bị từ chối.
     */
    cellFormula(raw: string | null | undefined, computedValue: number, self?: { item: EditorItem; field: string }) {
      if (!raw) return null;
      evalBudget = MAX_REF_ROWS;   // ngân sách bung dải của bộ tự kiểm: mỗi công thức một suất
      const refs = refsInFormula(String(raw));
      if (refs === null) return null;   // dải ô khổng lồ → ghi số, KHÔNG bung ra bộ nhớ
      const usesAmount = /\$?[A-Za-z]+\$?\d+/.test(String(raw)) && refs.some((r) => r.field === "_amount");
      if (usesAmount) {
        const selfRow = self ? items.indexOf(self.item) : -1;
        if (selfRow < 0 || !self || hasCycle(selfRow, self.field, String(raw))) return null;   // vòng lặp / không rõ ô → ghi số
      }
      const ex = translateFormula(raw, ctx);
      if (!ex) return null;
      // Tự kiểm: công thức (theo hệ editor) phải cho ra đúng giá trị đã tính.
      const check = evalEditorFormula(raw, editorRefs);
      if (check == null || !isFinite(check)) return null;
      const target = Number(computedValue) || 0;
      if (Math.abs(check - target) > 1e-3 + 1e-6 * Math.max(Math.abs(check), Math.abs(target))) return null;
      return ex;
    },
    // Lộ ra cho test/soi.
    _ctx: ctx,
    _editorRefs: editorRefs,
    // Lộ ra để test ghim ĐÚNG bất biến "số ref bung ra bị chặn". Không dùng cellFormula được:
    // nó trả null cho dải ngoài bảng dù có trần hay không, nên xanh cả khi lỗ hổng còn nguyên.
    _refsInFormula: refsInFormula,
  };
}
