// Port THUẦN (không DOM/import) từ public/grid-clipboard.js — clipboard cho lưới Excel báo giá.
// RFC-4180 parse/serialize (ô nhiều dòng không vỡ) + parse số VN/US an toàn (1,000,000→1000000,
// không còn lỗi 1.000×) + dựng lại nguyên bảng báo giá app xuất ra. PHẢI khớp bản SPA.

export function parseClipboardTSV(text: string | null): string[][] {
  if (text == null) return [[""]];
  text = String(text).replace(/^\uFEFF/, ""); // strip BOM (escape thay ký tự trần — lint no-irregular-whitespace)
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let started = false;
  const end = text.length;
  for (let i = 0; i < end; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; continue; } inQuotes = false; continue; }
      field += ch; continue;
    }
    if (ch === '"' && field === "") { inQuotes = true; started = true; continue; }
    if (ch === "\t") { row.push(field); field = ""; started = true; continue; }
    if (ch === "\r") { row.push(field); rows.push(row); row = []; field = ""; started = false; if (text[i + 1] === "\n") i++; continue; }
    if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; started = false; continue; }
    field += ch; started = true;
  }
  if (field !== "" || row.length > 0 || started) { row.push(field); rows.push(row); }
  if (rows.length > 1) { const last = rows[rows.length - 1]; if (last.length === 1 && last[0] === "") rows.pop(); }
  return rows.length ? rows : [[""]];
}

export function tsvEscapeField(v: unknown): string {
  const s = String(v == null ? "" : v);
  return /[\t\n\r"]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
export const cellsToTSV = (matrix: string[][]) => matrix.map((row) => row.map(tsvEscapeField).join("\t")).join("\r\n");
const htmlEsc = (s: unknown) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export function cellsToHTML(matrix: string[][]): string {
  let out = "<table>";
  for (const row of matrix) { out += "<tr>"; for (const cell of row) out += "<td>" + htmlEsc(cell).replace(/\r\n|\r|\n/g, "<br>") + "</td>"; out += "</tr>"; }
  return out + "</table>";
}

// Số âm kiểu KẾ TOÁN: Excel để định dạng Accounting hiện "(1.500.000)" thay vì "-1.500.000". Bộ lọc
// ký tự bên dưới bỏ ngoặc nên trước đây số âm bị dán ra DƯƠNG — dòng giảm giá (đơn giá âm) thành
// dòng cộng thêm, tổng lệch gấp đôi khoản giảm. Nhận ra ngoặc bao TRỌN giá trị thì đảo dấu.
// Phần TRONG ngoặc phải là SỐ thuần (chữ số, dấu tách, ký hiệu tiền, %): "(Tạm tính) 500.000 (chưa VAT)"
// cũng mở "(" đóng ")" nhưng là hai chú thích — bản trước đọc thành −500.000, hạng mục thành khoản TRỪ
// mà không cảnh báo (soát toàn diện đợt 3). PHẢI khớp bản port ở src/excelImport.ts.
const AM_KE_TOAN = /^\((.*)\)$/;
const SO_TRONG_NGOAC = /^[\s\d.,%-]*\d[\s\d.,%-]*$/;
const tachNgoacKeToan = (s: string): { s: string; am: boolean } => {
  const t = String(s).trim().replace(/\s*[₫đ$]$|^[₫đ$]\s*/gi, "").trim();
  const m = AM_KE_TOAN.exec(t);
  return m && SO_TRONG_NGOAC.test(m[1].replace(/vnđ|vnd|usd|[₫đ$]/gi, "")) ? { s: m[1], am: true } : { s: String(s), am: false };
};

// PHẦN TRĂM (soát toàn diện L15): Excel/Sheets chép ô định dạng % dưới dạng CHỮ "10%" (giá trị gốc
// 0,1). Bộ lọc ký tự của các hàm đọc số bỏ "%" nên "10%" dán vào SL/Đơn giá thành 10 — dòng "Phí quản
// lý 10% × 50.000.000" ra 500.000.000. Chỉ nhận "%" đứng CUỐI một chuỗi toàn số ("12,5%", "(10%)"):
// "10% VAT" vẫn đọc như cũ. Nhánh công thức vốn đã hiểu "=10%" là 0,1 — nay hai đường nhất quán.
const PHAN_TRAM = /^-?[\d.,\s]*\d[\d.,\s]*%$/;
const boPhanTram = (s: string): string | null => { const t = String(s ?? "").trim(); return PHAN_TRAM.test(t) ? t.slice(0, -1) : null; };
const chia100 = (n: number) => Number((n / 100).toPrecision(12));   // 12,5 / 100 không kéo theo đuôi dấu phẩy động
/** Ô là một số phần trăm ("10%", "(12,5%)") — nơi gọi cần biết để giữ đủ số lẻ (xem GridTable pasteCellVal). */
export const laPhanTram = (s: string) => boPhanTram(tachNgoacKeToan(String(s ?? "")).s) != null;

// CHỮ SỐ DÍNH SAU CHỮ CÁI (soát toàn diện đợt 3, L17): bộ lọc ký tự [^\d.,-] của các hàm đọc số bỏ
// CHỮ nhưng GIỮ chữ số của cụm "m2", "3m5W", "2x3" rồi ghép vào số — ô "m2" lệch cột rơi vào SL đọc 2,
// SL "12 m2" đọc 122, giá "95.000đ/m2" đọc 95,0002. Cụm có chữ cái ĐỨNG TRƯỚC chữ số là tên / đơn vị /
// kích thước, không phải số → bỏ CẢ cụm trước khi lọc ("12m2" = 0: không đoán). Chữ đứng SAU số
// ("95.000đ", "1.5kg", "10bộ") vẫn là đơn vị, số giữ nguyên. PHẢI khớp bản port ở src/excelImport.ts.
const boCumChuSo = (s: string) => String(s ?? "").replace(/[\p{L}\d.,]+/gu, (m) => (/\p{L}[.,]?\d/u.test(m) ? " " : m));

// "1.000.000" / "1,000,000" → 1000000 ; "12,5" → 12.5 ; "1.234,56" → 1234.56 ; "1.234" → 1234 (nghìn VN).
// "(1.500.000)" → -1500000 (âm kiểu kế toán). "10%" → 0,1.
export function parseLooseNumber(s: string): number {
  const kt = tachNgoacKeToan(s);
  if (kt.am) { const n = parseLooseNumber(kt.s); return n ? -Math.abs(n) : 0; }
  const pt = boPhanTram(s); if (pt != null) return chia100(parseLooseNumber(pt));
  s = boCumChuSo(s).trim().replace(/[^\d.,-]/g, "");
  if (!s || s === "-") return 0;
  if (s.includes(",") && s.includes(".")) {
    s = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (s.includes(",")) {
    const p = s.split(",");
    s = (p.length === 2 && p[1].length <= 2) ? p[0] + "." + p[1] : s.replace(/,/g, "");
  } else if ((s.match(/\./g) || []).length > 1) {
    s = s.replace(/\./g, "");
  } else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, "");
  }
  return Number(s) || 0;
}

// Riêng cột SỐ LƯỢNG / SỐ NGÀY: là SỐ ĐO NHỎ (vd 13.524 m2). 1 dấu "." hoặc "," → THẬP PHÂN
// (KHÔNG đoán "nghìn" như parseLooseNumber); NHIỀU dấu → ngăn nghìn. Tránh "13.524"→13524.
export function parseLooseDecimal(s: string): number {
  const kt = tachNgoacKeToan(s);
  if (kt.am) { const n = parseLooseDecimal(kt.s); return n ? -Math.abs(n) : 0; }
  const pt = boPhanTram(s); if (pt != null) return chia100(parseLooseDecimal(pt));
  let str = boCumChuSo(s).trim().replace(/[^\d.,-]/g, "");
  if (!str || str === "-") return 0;
  const neg = str.startsWith("-"); str = str.replace(/-/g, "");
  const dots = (str.match(/\./g) || []).length, commas = (str.match(/,/g) || []).length;
  if (dots && commas) {
    str = str.lastIndexOf(",") > str.lastIndexOf(".") ? str.replace(/\./g, "").replace(",", ".") : str.replace(/,/g, "");
  } else if (dots + commas > 1) {
    str = str.replace(/[.,]/g, "");   // nhiều dấu cùng loại (1.234.567 / 1,234,567) = ngăn nghìn
  } else {
    str = str.replace(",", ".");      // đúng 1 dấu = thập phân
  }
  const n = Number(str) || 0;
  return neg ? -n : n;
}

// ── SUY QUY ƯỚC SỐ TỪ CẢ KHỐI DÁN (nguồn NGOÀI) ────────────────────────────────────────────────
// Một ô "1.500" đứng riêng thì mơ hồ: Excel máy locale VN hiện 1500 cái là "1.500" (dấu nghìn), còn
// máy locale US hiện 1,5 m² là "1.5". parseLooseDecimal chọn "thập phân" cho cột SL/Ngày (tránh
// 2,675 m² thành 2675) — nhưng thế là SL 1.500 cái dán từ Excel VN bị HỤT 1000 lần. Cả khối dán
// thì thường có ô KHÔNG mơ hồ để đọc ra máy nguồn dùng quy ước nào:
//   · VN ("." nghìn, "," thập phân): ô dạng 1.500.000 (≥ 2 nhóm nghìn bằng "."), hoặc có cả hai dấu
//     mà "," đứng SAU cùng (1.234,5).
//   · US ("," nghìn, "." thập phân): 1,500,000, hoặc "." đứng sau "," (1,234.5).
//   · Cột TIỀN (Đơn giá / Thành tiền, nếu nơi gọi cho biết): tiền VND không có 3 số lẻ, nên ở cột
//     này ngay cả MỘT nhóm "250.000" cũng đã là dấu nghìn VN ("250,000" là US).
// Không có tín hiệu, hoặc tín hiệu hai phía mâu thuẫn → null: nơi gọi giữ cách đọc cũ.
export type QuyUocSo = "vn" | "us";
export function suyQuyUocSo(matrix: string[][], laCotTien?: (c: number) => boolean): QuyUocSo | null {
  let vn = false, us = false;
  for (const row of matrix) {
    row.forEach((raw, c) => {
      const v0 = String(raw ?? "").trim();
      if (!v0 || v0.startsWith("=")) return;
      const s = tachNgoacKeToan(v0).s.replace(/[\s₫đ$]/gi, "").replace(/^-/, "");
      if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return;
      const d = s.lastIndexOf("."), p = s.lastIndexOf(",");
      if (d >= 0 && p >= 0) { if (p > d) vn = true; else us = true; return; }
      if (/^\d{1,3}(\.\d{3}){2,}$/.test(s)) { vn = true; return; }
      if (/^\d{1,3}(,\d{3}){2,}$/.test(s)) { us = true; return; }
      if (laCotTien?.(c)) {
        if (/^\d{1,3}\.\d{3}$/.test(s)) vn = true;
        else if (/^\d{1,3},\d{3}$/.test(s)) us = true;
      }
    });
  }
  return vn === us ? null : vn ? "vn" : "us";
}

// Quy ước suy từ KHỐI chỉ đúng cho ô có khuôn của nó. Khối lẫn quy ước là chuyện thường ở bảng gõ
// tay (Word/Zalo/email): người Việt viết SL "13.5" mà vẫn ghi giá "250.000". Ô "13.5" không thể là
// số có dấu nghìn VN (nhóm sau dấu chỉ 1 chữ số) — áp quy ước "vn" cho nó là bỏ "." rồi đọc 135,
// phóng Thành tiền 10 lần mà không ai hay (soát chéo grid#7). Ô lệch khuôn → nơi gọi đọc theo cột.
// "2.675" thì khớp khuôn nghìn VN nên vẫn theo khối (2675): đánh đổi đã chọn ở GRID-01 — khối có
// giá "250.000" là khối từ máy locale VN, nơi "2.675" đúng là hai nghìn sáu trăm bảy lăm.
// Phần CHỮ SỐ + DẤU của một ô (bỏ ngoặc kế toán, ký hiệu tiền, chữ, dấu trừ đầu) — đúng phần mà
// parseTheoQuyUoc / parseLooseDecimal thật sự đọc, để khuôn được kiểm trên chính thứ sẽ được đọc.
const loiSo = (s: string) => boCumChuSo(tachNgoacKeToan(String(s ?? "").trim()).s).trim().replace(/[^\d.,-]/g, "").replace(/^-/, "");
export function khopQuyUoc(s: string, qu: QuyUocSo): boolean {
  const t = loiSo(s);
  return qu === "vn"
    ? /^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t) || /^\d+(,\d+)?$/.test(t)
    : /^\d{1,3}(,\d{3})+(\.\d+)?$/.test(t) || /^\d+(\.\d+)?$/.test(t);
}

/** Đọc số theo quy ước ĐÃ BIẾT của khối (xem suyQuyUocSo): bỏ dấu nghìn, đổi dấu thập phân thành ".".
 *  Lưới chỉ gọi cho ô đã qua khopQuyUoc — ô lệch khuôn mà đọc ép theo quy ước thì ra số sai cả chục lần.
 *  Bộ nhập Excel (src/excelImport.ts) gọi THẲNG, không qua khopQuyUoc, nên hàm tự giữ luật khuôn cho ca
 *  hay gặp nhất: đúng MỘT dấu nghìn mà nhóm sau nó không đủ 3 chữ số ("0.5", "1.5", "2.25" ở quy ước VN;
 *  "0,5" ở US) thì dấu đó là THẬP PHÂN, y như lưới đọc ô lệch khuôn. Bản trước bỏ mọi "." → SL "0.5"
 *  thành 5, tiền sai 10 lần (soát toàn diện đợt 3, L51). Nhóm đủ 3 chữ số ("1.500") vẫn là nghìn. */
export function parseTheoQuyUoc(s: string, qu: QuyUocSo): number {
  const kt = tachNgoacKeToan(s);
  if (kt.am) { const n = parseTheoQuyUoc(kt.s, qu); return n ? -Math.abs(n) : 0; }
  const pt = boPhanTram(s); if (pt != null) return chia100(parseTheoQuyUoc(pt, qu));
  let str = boCumChuSo(s).trim().replace(/[^\d.,-]/g, "");
  if (!str || str === "-") return 0;
  const nghin = qu === "vn" ? "." : ",", thapPhan = qu === "vn" ? "," : ".";
  const nhom = str.split(nghin);
  if (nhom.length === 2 && !str.includes(thapPhan) && nhom[1].length !== 3) str = nhom.join(".");
  else str = qu === "vn" ? str.replace(/\./g, "").replace(",", ".") : str.replace(/,/g, "");
  return Number(str) || 0;
}

// ── GIÁ TRỊ GỐC CỦA Ô TRONG text/html (soát chéo grid#8) ────────────────────────────────────────
// text/plain chỉ là chuỗi ô HIỆN ra ở máy nguồn: "1.500" từ Excel VN (1500 cái) và "1.500" từ Excel
// US (1,5 m²) giống hệt nhau, và ô đơn lẻ / cột SL không có tín hiệu nào để suyQuyUocSo bám vào. Phần
// text/html của cùng lần chép thì mang giá trị gốc của ô số:
//   · Excel: <td x:num="1500">1.500</td> — x:num TRỐNG khi chuỗi hiện trùng giá trị (không dùng được)
//   · Google Sheets: data-sheets-value="{"1":3,"3":1500}" (khoá 1 = kiểu, 3 = số); chép MỘT ô thì
//     Sheets gửi <span data-sheets-value=…> chứ không phải bảng
//   · LibreOffice Calc: sdval="1500"
// Trả ma trận giá trị gốc (null = ô không có) xếp theo hàng/cột như TSV — colspan/rowspan được giãn
// ra để cột khớp. Không có đúng MỘT bảng (và không phải ca một-ô của Sheets) → null: không đoán.
const THE_BANG = /<(\/?)(table|tr|td|th)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi;
const THE_BAT_KY = /<([a-z][\w:-]*)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi;
const THUOC_TINH = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
const THUC_THE: Record<string, string> = { quot: '"', "#34": '"', "#x22": '"', apos: "'", "#39": "'", "#x27": "'", lt: "<", gt: ">", amp: "&" };
const giaiMaHtml = (s: string) => s.replace(/&(quot|#34|#x22|apos|#39|#x27|lt|gt|amp);/gi, (m, k: string) => THUC_THE[k.toLowerCase()] ?? m);
function docThuocTinh(chuoi: string): Record<string, string | undefined> {
  const at: Record<string, string | undefined> = {};
  let m: RegExpExecArray | null; THUOC_TINH.lastIndex = 0;
  while ((m = THUOC_TINH.exec(chuoi))) { const v = m[2] ?? m[3] ?? m[4]; at[m[1].toLowerCase()] = v == null ? undefined : giaiMaHtml(v); }
  return at;
}
function giaTriGocCuaO(at: Record<string, string | undefined>): number | null {
  for (const k of ["x:num", "sdval"]) {
    const v = at[k]?.trim();
    if (v) { const n = Number(v); if (Number.isFinite(n)) return n; }
  }
  const gs = at["data-sheets-value"];
  if (gs) {
    try { const o = JSON.parse(gs) as Record<string, unknown>; if (o && o["1"] === 3 && typeof o["3"] === "number" && Number.isFinite(o["3"])) return o["3"]; } catch { /* không phải JSON → coi như không có */ }
  }
  return null;
}
export function giaTriGocTuHtml(html: string | null | undefined): (number | null)[][] | null {
  const h = String(html ?? "");
  if (!h.trim()) return null;
  const the = [...h.matchAll(THE_BANG)];
  const soBang = the.filter((m) => !m[1] && m[2].toLowerCase() === "table").length;
  if (soBang === 0) {
    // Google Sheets chép MỘT ô: <span data-sheets-value=…>. Đúng một phần tử mang giá trị gốc mới nhận.
    const coGoc = [...h.matchAll(THE_BAT_KY)].map((m) => docThuocTinh(m[2])).filter((at) => at["data-sheets-value"] != null);
    return coGoc.length === 1 ? [[giaTriGocCuaO(coGoc[0])]] : null;
  }
  if (soBang !== 1) return null;   // bảng lồng / nhiều bảng: không chắc ô nào ứng với ô TSV nào
  const out: (number | null)[][] = [];
  const chiem: boolean[][] = [];   // ô đã bị rowspan của hàng trên chiếm chỗ
  let r = -1, c = 0;
  for (const m of the) {
    if (m[1]) continue;
    const ten = m[2].toLowerCase();
    if (ten === "tr") { r++; c = 0; out[r] ??= []; continue; }
    if (ten !== "td" && ten !== "th") continue;
    if (r < 0) { r = 0; out[0] ??= []; }
    while (chiem[r]?.[c]) c++;
    const at = docThuocTinh(m[3]);
    const cs = Math.min(Math.max(parseInt(at.colspan ?? "1", 10) || 1, 1), 1000);
    const rs = Math.min(Math.max(parseInt(at.rowspan ?? "1", 10) || 1, 1), 1000);
    const v = giaTriGocCuaO(at);
    for (let dr = 0; dr < rs; dr++) {
      const rr = r + dr; out[rr] ??= []; chiem[rr] ??= [];
      for (let dc = 0; dc < cs; dc++) { out[rr][c + dc] = dr === 0 && dc === 0 ? v : null; chiem[rr][c + dc] = true; }
    }
    c += cs;
  }
  if (r < 0) return null;
  // Rowspan tràn quá hàng cuối không có hàng TSV tương ứng → cắt; lỗ thưa (mảng sparse) → null.
  return out.slice(0, r + 1).map((row) => Array.from(row, (v) => v ?? null));
}

// Quy ước của MỘT ô theo giá trị gốc: cách đọc nào (vn/us) của chuỗi HIỆN ra khớp giá trị gốc — sai
// lệch trong phạm vi làm tròn hiển thị — thì dùng quy ước đó. Chỉ PHÂN ĐỊNH, không thay chuỗi bằng giá
// trị gốc: ô "15%" (gốc 0,15) hay ô ngày (gốc là số seri) không khớp cách đọc nào → null, nơi gọi đọc
// như trước; ô hiện "2,68" mà gốc 2,675 vẫn ra đúng số người dùng nhìn thấy. Hai cách đọc cùng khớp
// (ô chỉ có chữ số) → null: không có gì cần phân định.
export function quyUocTheoGiaTriGoc(s: string, goc: number | null | undefined): QuyUocSo | null {
  if (goc == null || !Number.isFinite(goc)) return null;
  const t = loiSo(s);
  const khop = (qu: QuyUocSo) => {
    if (!khopQuyUoc(s, qu)) return false;
    const soLe = t.split(qu === "vn" ? "," : ".")[1]?.length ?? 0;
    return Math.abs(parseTheoQuyUoc(s, qu) - goc) <= 0.5 * 10 ** -soLe + 1e-9 * Math.max(1, Math.abs(goc));
  };
  const vn = khop("vn"), us = khop("us");
  return vn === us ? null : vn ? "vn" : "us";
}

// Ô SL/Ngày MƠ HỒ khi không còn gì để phân định: một dấu "." hoặc "," kèm đúng 3 chữ số ("1.500",
// "1,500", "13.524") — nghìn hay thập phân đều hợp lệ. Phần nguyên bắt đầu bằng 0 ("0,125") thì chắc
// chắn là thập phân. Nơi gọi dùng để CẢNH BÁO sau khi đọc thập phân, thay vì hụt tiền 1000 lần im lặng.
export function soMoHoNghin(s: string): boolean {
  return /^[1-9]\d{0,2}[.,]\d{3}$/.test(loiSo(s));
}

// ── KHỐI NGOÀI CÓ CỘT THÀNH TIỀN? (soát toàn diện L12) ────────────────────────────────────────
// Lưới và file Excel xuất ra đều hiện Thành Tiền GIỮA Đơn Giá và Ghi Chú, nhưng cột này không nhập
// được nên không nằm trong danh sách cột dán. Người dùng bôi Hạng Mục → Ghi Chú trên file báo giá rồi
// dán: ghép theo vị trí đẩy Thành Tiền vào Ghi Chú, Ghi Chú thật sang Ghi chú NỘI BỘ (không xuất Excel)
// hoặc mất hẳn. `roles` là vai trò từng cột của khối KHI COI một cột là "_amount". Chỉ nhận khi đa số
// hàng có số ở cột đó khớp SL × ĐG (× Ngày) — không chắc thì nơi gọi giữ ghép theo vị trí như cũ.
export function khopCotThanhTien(matrix: string[][], roles: string[], qu: QuyUocSo | null = null): boolean {
  const iA = roles.indexOf("_amount"), iQ = roles.indexOf("quantity"), iP = roles.indexOf("unitPrice"), iD = roles.indexOf("days");
  if (iA < 0 || iQ < 0 || iP < 0) return false;
  const soDo = (v: string) => (qu && khopQuyUoc(v, qu) ? parseTheoQuyUoc(v, qu) : parseLooseDecimal(v));
  const soTien = (v: string) => (qu && khopQuyUoc(v, qu) ? parseTheoQuyUoc(v, qu) : parseLooseNumber(v));
  const laSo = (v: string) => /\d/.test(v) && /^[-(]?[\d.,\s]+\)?\s*[₫đ$]?$/i.test(v.trim());
  let xet = 0, khop = 0;
  for (const row of matrix) {
    const a = String(row[iA] ?? "").trim(), q = String(row[iQ] ?? "").trim(), p = String(row[iP] ?? "").trim();
    const d = iD >= 0 ? String(row[iD] ?? "").trim() : "";
    if (!laSo(a)) continue;            // ô trống / chữ / công thức ở cột TT → hàng này không phân định được
    const tt = soTien(a); if (!tt) continue;
    xet++;
    if (!laSo(q) || !laSo(p) || (d && !laSo(d))) continue;
    const sl = soDo(q), gia = soTien(p), ngay = d ? soDo(d) || 1 : 1;
    // Thành Tiền của app nhân SL đã làm tròn 1 số lẻ (qtyRound) — nhận cả hai cách tính.
    const sl1 = Math.round(sl * 10) / 10;
    const lech = Math.max(2, Math.abs(tt) * 0.005);
    if (Math.abs(sl * ngay * gia - tt) <= lech || Math.abs(sl1 * ngay * gia - tt) <= lech) khop++;
  }
  return khop > 0 && khop * 2 > xet;
}

export type RebuiltItem = Record<string, unknown> & { kind: string; formulas?: Record<string, string> };
export function reconstructExportRows(matrix: string[][], roles: string[], numericRoles: Set<string>, numberSubs = false): RebuiltItem[] {
  const numSet = numericRoles instanceof Set ? numericRoles : new Set(["quantity", "unitPrice", "days"]);
  const idx = (role: string) => roles.indexOf(role);
  const sttI = idx("_stt"), nameI = idx("name"), unitI = idx("unit"), qtyI = idx("quantity"), priceI = idx("unitPrice");
  const cell = (row: string[], i: number) => (i >= 0 && i < row.length && row[i] != null ? String(row[i]) : "");
  // BANNER xuất ra có NHÓM CON đánh SỐ + KHÔNG ĐVT (vd "1  CGV Kim Cúc"). Nếu DATA có kiểu đó → nguồn là
  // banner → hàng STT-trống là MỤC (không phải nhóm con). Nếu KHÔNG có → nguồn là GN-không-ngày → hàng
  // STT-trống + có tên = NHÓM CON (vd "Chi phí vận chuyển"). Phân biệt để mỗi template hiểu đúng paste.
  // Quy ước số của CẢ khối (VN/US) — cột tiền là Đơn giá + Thành tiền. Suy được thì ô số KHỚP khuôn
  // của nó đọc theo nó; không suy được, hoặc ô lệch khuôn (SL "13.5" trong khối VN — xem khopQuyUoc),
  // thì giữ cách cũ (SL/Ngày thập phân, tiền đoán nghìn).
  const qu = suyQuyUocSo(matrix, (c) => roles[c] === "unitPrice" || roles[c] === "_amount");
  const soDo = (v: string) => (qu && khopQuyUoc(v, qu) ? parseTheoQuyUoc(v, qu) : parseLooseDecimal(v));
  const soTien = (v: string) => (qu && khopQuyUoc(v, qu) ? parseTheoQuyUoc(v, qu) : parseLooseNumber(v));
  const hasNumberedSub = matrix.some((r) => /^\d+$/.test(cell(r, sttI).trim()) && cell(r, nameI).trim() !== "" && cell(r, unitI).trim() === "" && cell(r, priceI).trim() !== "");
  const out: RebuiltItem[] = [];
  for (const row of matrix) {
    const stt = cell(row, sttI).trim();
    const name = cell(row, nameI);
    const hasItemData = cell(row, unitI).trim() !== "" || cell(row, qtyI).trim() !== "";
    const hasUnit = cell(row, unitI).trim() !== "";
    const priceRaw = cell(row, priceI).trim();
    const hasPrice = priceRaw !== "" && (priceRaw.startsWith("=") || parseLooseNumber(priceRaw) !== 0);
    let kind: string;
    if (/^[A-Za-z]{1,2}$/.test(stt)) kind = "section";
    else if (numberSubs && /^\d+$/.test(stt) && name.trim() !== "") kind = "subsection";   // BANNER (template đích=banner): nhóm con đánh SỐ
    else if (stt === "" && name.trim() === "" && (hasItemData || hasPrice)) kind = "sub";   // hàng con (nối, không tên)
    else if (stt === "" && name.trim() !== "" && !hasItemData && !hasPrice) kind = "info";   // dòng thông tin: STT trống + TÊN, KHÔNG đo/giá
    else if (!numberSubs && !hasNumberedSub && stt === "" && name.trim() !== "") kind = "subsection";   // GN KHÔNG NGÀY: nhóm con = STT TRỐNG + có TÊN (KỂ CẢ có ĐVT/giá, vd "Chi phí vận chuyển"). CHỈ khi data KHÔNG có nhóm-con-đánh-số (banner).
    else if (name.trim() !== "" && !hasUnit && hasPrice) kind = "subsection";   // NHÓM CON theo DATA: có TÊN + GIÁ nhưng KHÔNG ĐVT — bắt được dù dán vào template đích khác
    else kind = "item";
    const it: RebuiltItem = { kind };
    roles.forEach((role, i) => {
      if (!role || role === "_stt" || role === "_amount") return;
      const v = cell(row, i);
      if (numSet.has(role)) {
        if (v.trim().startsWith("=")) { (it.formulas || (it.formulas = {}))[role] = v.trim(); it[role] = 0; }
        else it[role] = (role === "quantity" || role === "days") ? soDo(v) : soTien(v);   // SL/Ngày = số đo → thập phân (khi không suy được quy ước)
        // SL phần trăm cần hơn 1 số lẻ ("12,5%" → 0,125) → cờ SL chính xác, như lưới (L15).
        if (role === "quantity" && laPhanTram(v)) { const a = Math.abs(Number(it[role]) || 0); if (Math.round(a * 10 + 1e-6) / 10 !== Math.round(a * 1e4 + 1e-8) / 1e4) it.quantityExact = true; }
      } else if (role === "detail" || role === "notes" || role === "name" || role === "label" || role === "internalNote") it[role] = v;
      else it[role] = v.trim();
    });
    if (kind === "section" || kind === "subsection") {
      it.unitPrice = 0;
      if (it.formulas) delete it.formulas.unitPrice;
      if (!(it.formulas && it.formulas.quantity)) it.quantity = soDo(cell(row, qtyI));
    }
    if (kind === "info") { it.unit = ""; it.quantity = 0; it.unitPrice = 0; delete it.formulas; }
    if (it.formulas && !Object.keys(it.formulas).length) delete it.formulas;
    out.push(it);
  }
  return out;
}

// Map cột THEO HÀNG TIÊU ĐỀ file Excel nguồn (STT|Hạng Mục|…) → dán đúng dù sheet đích khác
// template (vd nguồn KHÔNG ngày, đích CÓ ngày): cột "Đơn Giá" vẫn vào unitPrice, không lệch sang "Số Ngày".
const HEADER_ROLE: Record<string, string> = {
  "STT": "_stt", "HANG MUC": "name", "CHI TIET": "detail", "DVT": "unit",
  "SO LUONG": "quantity", "SO NGAY": "days", "DON GIA": "unitPrice",
  "THANH TIEN": "_amount", "GHI CHU": "notes", "NOTES": "notes", "GHI CHU NOI BO": "internalNote",
};
function normHdr(s: string): string {
  return String(s || "").replace(/\([^)]*\)/g, " ").replace(/[\r\n]+/g, " ")
    .normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d")
    .toUpperCase().replace(/[^A-Z ]/g, "").replace(/\s+/g, " ").trim();
}
export function isHeaderRow(row: string[] | undefined): boolean {
  return !!row && normHdr(row[0] || "") === "STT";
}
export function headerToRoles(row: string[]): string[] {
  return row.map((h) => HEADER_ROLE[normHdr(h)] || "");
}

export function looksLikeExportPaste(matrix: string[][], startCol: number, fieldCount: number): boolean {
  if (startCol !== 0 || !matrix.length) return false;
  const col0Ok = matrix.every((r) => { const c = (r[0] || "").trim(); return c === "" || /^[A-Za-z]{1,2}$/.test(c) || /^\d+$/.test(c); });
  if (!col0Ok) return false;
  const hasGroupLetter = matrix.some((r) => /^[A-Z]$/.test((r[0] || "").trim()));
  const maxCols = Math.max(...matrix.map((r) => r.length));
  // Hai tín hiệu mà khối app xuất ra LUÔN có (soát toàn diện L16): (1) ≥ 2 cột — bản xuất luôn có cột
  // STT và cột Hạng Mục; (2) có ít nhất một hàng mà STT TRỐNG hoặc là SỐ (hạng mục / nhóm con đánh số)
  // và các cột sau có dữ liệu. Thiếu chúng thì danh sách tên 1–2 chữ cái — cỡ áo "S⏎M⏎L⏎XL" dán từ
  // Zalo, khối "S ⇥ ⇥ cái ⇥ 10 ⇥ 50.000" — bị coi là bản xuất: cột 1 thành STT, mọi hàng thành NHÓM
  // rỗng tên, ĐVT/SL/ĐG lệch cột.
  // Ngoại lệ (phản biện L16): khối CHỈ gồm hàng nhóm ("A | Nhóm 1", "B | Nhóm 2") chép từ bản xuất thì
  // không có hàng nào như (2). Nhận nó khi MỌI hàng là chữ nhóm IN HOA kèm tên ở cột 2, và khối dài hơn
  // số cột nhập (cột STT thừa) — cỡ áo "S | Áo thun" hai cột không lọt, vì thiếu cột thừa.
  if (maxCols < 2) return false;
  const coHangMuc = matrix.some((r) => /^\d*$/.test((r[0] || "").trim()) && r.slice(1).some((c) => String(c ?? "").trim() !== ""));
  const chiHangNhom = maxCols > fieldCount && matrix.every((r) => /^[A-Z]{1,2}$/.test((r[0] || "").trim()) && String(r[1] ?? "").trim() !== "");
  if (!coHangMuc && !chiHangNhom) return false;
  // maxCols > fieldCount: có cột STT thừa (Windows giữ cột rỗng cuối). NHƯNG Excel cho Mac hay BỎ
  // cột rỗng cuối → maxCols == fieldCount; khi đó dựa vào: khối NHIỀU DÒNG + có chữ nhóm A/B (rất khó
  // trùng với dán dữ liệu thường) → vẫn coi là báo giá app xuất ra.
  return hasGroupLetter && (maxCols > fieldCount || matrix.length > 1);
}

// ===== TỰ DỊCH công thức Excel trong khối DÁN → toạ độ WEB (retarget) =====
// Ô paste chứa "=…" mang địa chỉ Ô THEO FILE EXCEL (vd "=G12*F12") — lệch hẳn hệ cột/hàng web.
// Chiến lược: (1) DÒ khối bắt đầu từ cột X0/hàng R0 nào của file nguồn (quét, chấm điểm theo số
// tham chiếu rơi gọn vào khối); (2) DỊCH từng ref sang (role, dòng-trong-khối); (3) TỰ KIỂM bằng
// cột THÀNH TIỀN của dòng đó trong khối (SL×ĐG≈TT). Khớp → tự sửa công thức theo địa chỉ web +
// điền giá trị. Không chắc → GIỮ công thức gốc + cờ _fxWarn (ô ĐỎ, người dùng sửa tay).
const RT_FNS: Record<string, (a: number[]) => number> = {
  SUM: (a) => a.reduce((x, y) => x + y, 0), PRODUCT: (a) => a.reduce((x, y) => x * y, 1),
  AVERAGE: (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0), AVG: (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0),
  MIN: (a) => (a.length ? Math.min(...a) : 0), MAX: (a) => (a.length ? Math.max(...a) : 0),
  ROUND: (a) => { const p = 10 ** (a[1] || 0); return Math.round((a[0] || 0) * p) / p; },
  ROUNDUP: (a) => { const p = 10 ** (a[1] || 0); return Math.ceil((a[0] || 0) * p) / p; },
  ROUNDDOWN: (a) => { const p = 10 ** (a[1] || 0); return Math.trunc((a[0] || 0) * p) / p; },
  INT: (a) => Math.floor(a[0] || 0), ABS: (a) => Math.abs(a[0] || 0),
};
function rtArith(input: string): number | null {
  const s = String(input).replace(/\s+/g, "");
  if (!s || !/^[-+*/().0-9]+$/.test(s)) return null;
  let pos = 0;
  const peek = () => s[pos];
  const fac = (): number | null => {
    if (peek() === "(") { pos++; const v = expr(); if (peek() !== ")") return null; pos++; return v; }
    if (peek() === "-") { pos++; const v = fac(); return v === null ? null : -v; }
    if (peek() === "+") { pos++; return fac(); }
    let num = ""; while (pos < s.length && /[0-9.]/.test(s[pos])) num += s[pos++];
    return num && !isNaN(Number(num)) ? Number(num) : null;
  };
  const term = (): number | null => { let v = fac(); while (peek() === "*" || peek() === "/") { const op = s[pos++]; const r = fac(); if (v === null || r === null) return null; v = op === "*" ? v * r : v / r; } return v; };
  const expr = (): number | null => { let v = term(); while (peek() === "+" || peek() === "-") { const op = s[pos++]; const r = term(); if (v === null || r === null) return null; v = op === "+" ? v + r : v - r; } return v; };
  const r = expr();
  return pos === s.length && r !== null && isFinite(r) ? r : null;
}
// Đánh giá công thức đã thay ref bằng SỐ (còn hàm SUM/ROUND…, "%", ";" đối số, "," thập phân).
function rtEval(input: string): number | null {
  let s = String(input).trim().replace(/^=/, "").replace(/×/g, "*").replace(/(\d)\s*[xX]\s*(?=\d)/g, "$1*");
  s = s.replace(/(\d+(?:[.,]\d+)?)\s*%/g, (_m, nn) => String(Number(String(nn).replace(",", ".")) / 100));
  s = s.replace(/,/g, ".");
  let guard = 0;
  while (/[A-Za-z]+\s*\(/.test(s)) {
    if (guard++ > 60) return null;
    let changed = false;
    s = s.replace(/([A-Za-z]+)\s*\(([^()]*)\)/, (_m, name, args) => {
      changed = true;
      const fn = RT_FNS[String(name).toUpperCase()];
      if (!fn) return "NaN";
      const vals = String(args).split(";").map((a) => rtArith(a)).filter((v): v is number => v !== null && isFinite(v));
      const r = fn(vals);
      return r == null || !isFinite(r) ? "NaN" : String(r);
    });
    if (!changed) return null;
  }
  return rtArith(s);
}
const rtColIdx = (L: string) => { let nn = 0; for (const ch of L.toUpperCase()) nn = nn * 26 + (ch.charCodeAt(0) - 64); return nn - 1; };

export type RetargetOpts = {
  webLetter: (role: string) => string | null;   // role → chữ cột WEB của lưới đích (quantity/unitPrice/days/_amount)
  baseRow: number;                              // hàng web (0-based) của dòng ĐẦU khối sau khi dán
};
export function retargetPastedFormulas(built: RebuiltItem[], matrix: string[][], roles: string[], opts: RetargetOpts) {
  const n = built.length;
  const amtI = roles.indexOf("_amount"), dayI = roles.indexOf("days");
  const NUMOK = new Set(["quantity", "unitPrice", "days", "_amount"]);
  const cellRaw = (k: number, i: number) => (i >= 0 && matrix[k] && matrix[k][i] != null ? String(matrix[k][i]) : "");
  // Giá trị 1 ô của KHỐI theo (role, dòng k) — _amount đọc từ matrix; ô công thức → NaN (chưa biết).
  const valOf = (role: string, k: number): number => {
    const it = built[k];
    if (!it || it.kind === "info") return NaN;
    if (role === "_amount") { const s = cellRaw(k, amtI).trim(); return s && !s.startsWith("=") ? parseLooseNumber(s) : NaN; }
    if (it.formulas && it.formulas[role] != null) return NaN;
    const v = (it as Record<string, unknown>)[role];
    return v == null ? NaN : Number(v);
  };
  // Gom mọi ref (đơn + dải) của mọi công thức trong khối.
  // \$? : ref tuyệt đối của Excel ($G$12). Bỏ qua khoá khi dò/dịch — nếu không khớp được thì cả
  // công thức trôi qua mà KHÔNG dịch toạ độ và KHÔNG bị đánh dấu đỏ, tức tính theo hàng của lưới
  // web → sai tiền âm thầm.
  const refRe = /\$?([A-Za-z]+)\$?(\d+)(?:\s*:\s*\$?([A-Za-z]+)\$?(\d+))?/g;
  const allRefs: { col: number; row: number }[] = [];
  const fxList: { k: number; f: string; raw: string }[] = [];
  built.forEach((it, k) => {
    if (!it.formulas) return;
    for (const f in it.formulas) {
      const raw = String(it.formulas[f] || "");
      if (!/\$?[A-Za-z]+\$?\d+/.test(raw)) continue;   // không tham chiếu ô → số học thuần, giữ nguyên vẫn đúng
      fxList.push({ k, f, raw });
      let m: RegExpExecArray | null; refRe.lastIndex = 0;
      while ((m = refRe.exec(raw))) {
        allRefs.push({ col: rtColIdx(m[1]), row: +m[2] });
        if (m[3] && m[4]) allRefs.push({ col: rtColIdx(m[3]), row: +m[4] });
      }
    }
  });
  if (!fxList.length) return;
  const markWarn = (k: number, f: string) => { const it = built[k] as RebuiltItem & { _fxWarn?: Record<string, boolean> }; (it._fxWarn || (it._fxWarn = {}))[f] = true; };
  // DÒ (X0, R0): cột/hàng Excel ĐẦU của khối — chấm điểm theo số ref rơi gọn vào khối + đúng cột số.
  let best: { x0: number; r0: number; score: number }[] = [];
  for (let x0 = 0; x0 <= 6; x0++) {
    for (let r0 = 1; r0 <= 500; r0++) {
      let score = 0;
      for (const rf of allRefs) {
        const role = roles[rf.col - x0];
        if (role && NUMOK.has(role) && rf.row - r0 >= 0 && rf.row - r0 < n) score++;
      }
      if (score > 0) {
        if (!best.length || score > best[0].score) best = [{ x0, r0, score }];
        else if (score === best[0].score) best.push({ x0, r0, score });
      }
    }
  }
  const tryFit = (x0: number, r0: number, apply: boolean): { ok: number; dist: number } => {
    let okCount = 0, dist = 0;
    for (const { k, f, raw } of fxList) {
      // Dịch ref → địa chỉ WEB; fail ref nào → bỏ ô này (đánh đỏ khi apply).
      let good = true;
      const rendered = raw.replace(/^=/, "").replace(/\$?([A-Za-z]+)\$?(\d+)(?:\s*:\s*\$?([A-Za-z]+)\$?(\d+))?/g, (mm, c1, r1, c2, r2) => {
        if (!good) return mm;
        const roleA = roles[rtColIdx(c1) - x0]; const ka = +r1 - r0;
        if (!roleA || !NUMOK.has(roleA) || ka < 0 || ka >= n) { good = false; return mm; }
        const La = opts.webLetter(roleA); if (!La) { good = false; return mm; }
        if (c2 && r2) {
          const roleB = roles[rtColIdx(c2) - x0]; const kb = +r2 - r0;
          if (roleB !== roleA || kb < 0 || kb >= n) { good = false; return mm; }
          return La + (opts.baseRow + Math.min(ka, kb) + 1) + ":" + La + (opts.baseRow + Math.max(ka, kb) + 1);
        }
        return La + (opts.baseRow + ka + 1);
      });
      if (!good) { if (apply) markWarn(k, f); continue; }
      // Eval theo giá trị KHỐI: thay ref bằng SỐ.
      let evalable = true;
      const numeric = raw.replace(/^=/, "").replace(/\$?([A-Za-z]+)\$?(\d+)(?:\s*:\s*\$?([A-Za-z]+)\$?(\d+))?/g, (mm, c1, r1, c2, r2) => {
        if (!evalable) return mm;
        const roleA = roles[rtColIdx(c1) - x0]; const ka = +r1 - r0;
        if (c2 && r2) {
          const kb = +r2 - r0; const vals: number[] = [];
          for (let kk = Math.min(ka, kb); kk <= Math.max(ka, kb); kk++) { const v = valOf(roleA, kk); if (!isFinite(v)) { evalable = false; return mm; } vals.push(v); }
          return vals.join(";");
        }
        const v = valOf(roleA, ka); if (!isFinite(v)) { evalable = false; return mm; }
        return String(v);
      });
      const fxVal = evalable ? rtEval(numeric) : null;
      if (fxVal == null || !isFinite(fxVal)) { if (apply) markWarn(k, f); continue; }
      // TỰ KIỂM bằng THÀNH TIỀN dòng k của khối: fx là 1 vế của SL×(Ngày×)ĐG.
      const amtS = cellRaw(k, amtI).trim();
      const amt = amtS && !amtS.startsWith("=") ? parseLooseNumber(amtS) : NaN;
      const qty = f === "quantity" ? fxVal : valOf("quantity", k);
      const price = f === "unitPrice" ? fxVal : valOf("unitPrice", k);
      const days = dayI >= 0 ? (f === "days" ? fxVal : (valOf("days", k) || 1)) : 1;
      if (!isFinite(amt) || amt === 0 || !isFinite(qty) || !isFinite(price)) { if (apply) markWarn(k, f); continue; }
      const qR = (() => { const t = Math.round(Math.abs(qty) * 10 + 1e-6) / 10; return qty < 0 ? -t : t; })();   // SL làm tròn 1 số như app
      const predicted = Math.round(qR * (isFinite(days) ? days : 1) * price);
      if (Math.abs(predicted - amt) > Math.max(2, Math.abs(amt) * 0.005)) { if (apply) markWarn(k, f); continue; }
      okCount++;
      // Khoảng cách ref → dòng chứa công thức: tie-break khi dữ liệu TUẦN HOÀN khiến nhiều (X0,R0)
      // cùng verify OK — công thức thật luôn tham chiếu hàng GẦN nó, chọn diễn giải gần nhất.
      { let mD: RegExpExecArray | null; refRe.lastIndex = 0; while ((mD = refRe.exec(raw))) { dist += Math.abs((+mD[2] - r0) - k); if (mD[4]) dist += Math.abs((+mD[4] - r0) - k); } }
      if (apply) {
        const it = built[k] as RebuiltItem & Record<string, unknown>;
        (it.formulas as Record<string, string>)[f] = "=" + rendered;
        it[f] = fxVal;
      }
    }
    return { ok: okCount, dist };
  };
  // Chọn ứng viên (X0,R0): verify PASS nhiều nhất → tie-break tổng-khoảng-cách-ref NHỎ nhất
  // (ưu tiên X0=1 — app xuất từ cột B). Quét tối đa 12 ứng viên điểm cao.
  best.sort((a, b) => ((a.x0 === 1 ? -1 : 0) - (b.x0 === 1 ? -1 : 0)) || a.r0 - b.r0);
  let win: { x0: number; r0: number } | null = null, winOk = -1, winDist = Infinity;
  for (const c of best.slice(0, 12)) {
    const { ok, dist } = tryFit(c.x0, c.r0, false);
    if (ok > winOk || (ok === winOk && dist < winDist)) { winOk = ok; winDist = dist; win = c; }
  }
  if (win && winOk > 0) tryFit(win.x0, win.r0, true);
  else for (const { k, f } of fxList) markWarn(k, f);   // không khớp được gì → giữ công thức gốc + ô ĐỎ hết
}

// ── DỊCH THAM CHIẾU khi COPY/DÁN hoặc FILL trong chính lưới (nếp Excel) ─────────────────────────
// Excel: copy "=G3*E3" ở hàng 3 dán xuống hàng 7 → "=G7*E7"; dán sang phải 1 cột → cột cũng dời.
// Dấu $ khoá: $E3 khoá CỘT, E$3 khoá HÀNG, $E$3 khoá cả hai. Dải A1:B5 dịch cả hai đầu.
// Dịch ra ngoài bảng (hàng < 1 hoặc > maxRow, cột ra khỏi sơ đồ) → Excel trả #REF!; ở đây trả
// null để nơi gọi biết mà giữ công thức gốc + đánh dấu ô đỏ, thay vì âm thầm tính sai.
//
// letters: mảng chữ cái cột theo THỨ TỰ sơ đồ địa chỉ của lưới (ADDR), vd ["A","B","C",…].
// dRow/dCol: số hàng/cột dời đi. maxRow: số hàng hiện có (1-based, để chặn vượt biên).
export function shiftFormulaRefs(fx: string, dRow: number, dCol: number, letters: string[], maxRow?: number): string | null {
  const raw = String(fx || "");
  if (!raw.trim().startsWith("=")) return raw;          // không phải công thức → nguyên văn
  if (!dRow && !dCol) return raw;                        // dán tại chỗ → khỏi đụng
  const idxOf = (L: string) => letters.indexOf(String(L).toUpperCase());
  let bad = false;
  // ($?)(chữ)($?)(số) — bắt cả 2 đầu của dải "A1:B5" trong một lần khớp.
  const RE = /(\$?)([A-Za-z]+)(\$?)(\d+)/g;
  const out = raw.replace(RE, (m: string, cLock: string, col: string, rLock: string, row: string) => {
    if (bad) return m;
    // Cột: chỉ dời khi KHÔNG có $ trước chữ cái.
    let ci = idxOf(col);
    if (ci < 0) { bad = true; return m; }                // chữ cái không thuộc sơ đồ cột của lưới
    if (!cLock && dCol) {
      ci += dCol;
      if (ci < 0 || ci >= letters.length) { bad = true; return m; }
    }
    // Hàng: chỉ dời khi KHÔNG có $ trước số.
    let r = parseInt(row, 10);
    if (!rLock && dRow) {
      r += dRow;
      if (r < 1 || (maxRow && r > maxRow)) { bad = true; return m; }
    }
    return cLock + letters[ci] + rLock + r;
  });
  return bad ? null : out;
}

// ── CHÈN / XOÁ HÀNG: dịch tham chiếu như Excel ────────────────────────────────────────────────
// Excel: chèn 1 hàng trên hàng 5 thì mọi "=E5" thành "=E6"; xoá hàng 5 thì "=E5" thành #REF! còn
// "=E9" thành "=E8". Khoá $ KHÔNG bảo vệ khỏi việc này ($E$5 vẫn dịch) — $ chỉ chặn dịch khi
// copy/dán. Không làm bước này thì chèn/xoá hàng khiến công thức lặng lẽ trỏ sang hạng mục khác.
//
// at: số hàng (1-based) nơi chèn/xoá. delta: +n = chèn n hàng TRƯỚC hàng at; -n = xoá n hàng từ at.
// Trả null khi công thức trỏ vào chính hàng bị xoá (tương đương #REF!) → nơi gọi giữ công thức cũ
// và đánh dấu ô đỏ để người dùng thấy mà sửa, thay vì để nó âm thầm tính ra 0.
export function adjustRefsForRowEdit(fx: string, at: number, delta: number): string | null {
  const raw = String(fx || "");
  if (!raw.trim().startsWith("=") || !delta) return raw;
  let broken = false;
  const out = raw.replace(/(\$?)([A-Za-z]+)(\$?)(\d+)/g, (m: string, cLock: string, col: string, rLock: string, rowS: string) => {
    let r = parseInt(rowS, 10);
    if (delta > 0) {
      if (r >= at) r += delta;
    } else {
      const n = -delta;
      if (r >= at && r < at + n) { broken = true; return m; }   // trỏ vào hàng vừa bị xoá
      if (r >= at + n) r -= n;
    }
    return cLock + col + rLock + r;
  });
  return broken ? null : out;
}
