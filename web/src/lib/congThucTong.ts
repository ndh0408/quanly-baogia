// CÔNG THỨC CỦA KHỐI TỔNG (Tổng sheet · Discount · Tổng cộng · VAT · Thành tiền) và bảng "Tổng báo giá" — viết bằng
// THAM CHIẾU Ô như Excel, kèm diễn giải bằng số thật. Thuần (không DOM): phần tô ô nằm ở components/CongThucTong.tsx.
//
// Chủ repo 2026-10-07: "tôi nhấn vào tổng sheet nó chưa hiện các ô lên xem cộng như nào công thức ra sao, cả thành tiền
// nữa". Trước đây nút ƒ chỉ bật một toast "=SUM(Thành Tiền các hàng) = 20.746.077" — không chỉ ra ô nào.
//
// LUẬT CỘNG PHẢI LÀ LUẬT THẬT. Công thức Tổng sheet dưới đây đi đúng vòng lặp của M.sheetSubtotalGrouped (nguồn duy
// nhất, mirror src/money.ts) — bài kiểm congThucTong.test.ts tính lại công thức bằng chính evalFormula của lưới trên
// hàng trăm sheet sinh ngẫu nhiên và đòi ra đúng số đó:
//   · hàng "item" và "sub" (dòng con) đều tính Thành tiền RIÊNG; "info" (dòng thông tin) không tính;
//   · CHƯA bật "Hiện Thành Tiền nhóm" (groupSubtotal) → hàng nhóm / nhóm con chỉ là tiêu đề: cộng thẳng từng mục,
//     SL của nhóm KHÔNG nhân vào đâu cả;
//   · ĐÃ bật → mọi mục dưới một nhóm (hoặc nhóm con) nhân SL của CHÍNH nhóm đó (SL trống hoặc < 1 tính ×1); mục dưới
//     nhóm con nhân SL nhóm con, KHÔNG nhân thêm SL nhóm cha. Mục đứng trước nhóm đầu tiên nhân 1;
//   · mẫu đánh số nhóm con (numberSubsections): ô Thành tiền của nhóm CHA hiện cả phần nhóm con dồn lên, nhưng Tổng
//     sheet không lấy ô đó — chỉ lấy mục trực tiếp của nhóm cha × SL nhóm cha, cộng từng nhóm con. Trỏ vào ô nhóm cha
//     ở đây là đếm phần nhóm con hai lần (đúng lỗi của bản revealSheetTotal cũ trong GridTable).
import * as M from "./quoteMath";

export type PhanTuTong = { thamChieu: string; giaTri: number };
export type CongThucO = { congThuc: string; dienGiai: string; ghiChu: string[] };

const NF = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 });
/** Số kiểu Việt Nam (chấm nghìn, tối đa 2 số lẻ). `+ 0` bỏ "-0". */
export const soVN = (n: number) => NF.format((Number(n) || 0) + 0);
/** "1.000 + 2.000 − 500" — số âm đứng sau thì viết thành phép trừ, đọc như người ta tự cộng tay. */
export function noiCong(gt: number[], tran = 60): string {
  const hien = gt.slice(0, tran).map((v, i) => (i === 0 ? soVN(v) : v < 0 ? ` − ${soVN(-v)}` : ` + ${soVN(v)}`)).join("");
  return gt.length > tran ? `${hien} + … (thêm ${gt.length - tran} số)` : hien;
}
/** 8 → "8%", 8.5 → "8,5%" — dấu phẩy thập phân như ô nhập VAT; vì vậy đối số hàm tách bằng ";". */
const phanTram = (p: number) => `${String(Number(p) || 0).replace(".", ",")}%`;
const tenNgan = (s: unknown) => { const t = String(s ?? "").replace(/\s+/g, " ").trim(); return t.length > 40 ? t.slice(0, 39) + "…" : t; };
const laNhom = (it: M.Item | undefined) => it?.kind === "section" || it?.kind === "subsection";

type Muc = { loai: "hang"; hang: number } | { loai: "nhom"; hang: number; con: number[] };

/** Công thức của ô Tổng sheet (= "Cộng" khi có Discount) theo địa chỉ ô của lưới: `La` cột Thành tiền, `Lq` cột Số lượng. */
export function congThucTongSheet(items: M.Item[], o: { groupSubtotal?: boolean; usesDays: boolean; numberSubs?: boolean; La: string; Lq: string }): CongThucO & { phanTu: PhanTuTong[] } {
  const ds = items || [];
  const nhomTinh = !!o.groupSubtotal;
  const tien = (r: number) => M.lineAmount(ds[r], o.usesDays);
  const oTT = (r: number) => `${o.La}${r + 1}`;
  // Dựng dãy mục đúng thứ tự vòng lặp của sheetSubtotalGrouped: gặp nhóm thì (nếu nhóm tính) mở nhóm mới, gặp info thì bỏ.
  const day: Muc[] = [];
  let nhom: Extract<Muc, { loai: "nhom" }> | null = null;
  for (let i = 0; i < ds.length; i++) {
    const k = ds[i].kind;
    if (k === "section" || k === "subsection") { nhom = nhomTinh ? { loai: "nhom", hang: i, con: [] } : null; if (nhom) day.push(nhom); continue; }
    if (k === "info") continue;
    if (nhom) nhom.con.push(i); else day.push({ loai: "hang", hang: i });
  }
  // Giữa hai hàng chỉ có dòng thông tin (không có ô Thành tiền) → vẫn gộp được thành một dải; hàng nhóm chen giữa thì không.
  const chiInfoGiua = (a: number, b: number) => { for (let j = a + 1; j < b; j++) if (ds[j].kind !== "info") return false; return true; };
  // Nhóm cha của mẫu đánh số nhóm con: ô của nó dồn cả nhóm con (GridTable tinhTongNhom) → không trỏ vào ô đó được.
  const nhomChaDonCon = (g: number) => {
    if (!o.numberSubs || ds[g].kind !== "section") return false;
    let coCon = false;
    for (let j = g + 1; j < ds.length && ds[j].kind !== "section"; j++) {
      if (ds[j].kind === "subsection") coCon = true;
      else if (coCon && ds[j].kind !== "info") return true;
    }
    return false;
  };

  const phanTu: PhanTuTong[] = [];
  const ghiChu: string[] = [];
  let coNhom = false;
  for (let j = 0; j < day.length;) {
    const m = day[j];
    if (m.loai === "hang") {
      let k = j, s = 0;
      while (k + 1 < day.length) { const sau = day[k + 1]; if (sau.loai !== "hang" || !chiInfoGiua((day[k] as { hang: number }).hang, sau.hang)) break; k++; }
      for (let x = j; x <= k; x++) s += tien((day[x] as { hang: number }).hang);
      const a = m.hang, b = (day[k] as { hang: number }).hang;
      phanTu.push({ thamChieu: a === b ? oTT(a) : `SUM(${oTT(a)}:${oTT(b)})`, giaTri: s });
      j = k + 1;
      continue;
    }
    j++;
    if (!m.con.length) continue;   // nhóm rỗng góp 0 — không tô ô của nó
    const he = M.groupMult(ds[m.hang]);
    const tongCon = m.con.reduce((acc, r) => acc + tien(r), 0);
    if (!nhomChaDonCon(m.hang)) { coNhom = true; phanTu.push({ thamChieu: oTT(m.hang), giaTri: tongCon * he }); continue; }
    const a = m.con[0], b = m.con[m.con.length - 1];
    const goc = a === b ? oTT(a) : `SUM(${oTT(a)}:${oTT(b)})`;
    phanTu.push({ thamChieu: he > 1 ? `${goc}*${o.Lq}${m.hang + 1}` : goc, giaTri: tongCon * he });
    ghiChu.push(`Nhóm “${tenNgan(ds[m.hang].name)}” (hàng ${m.hang + 1}): ô Thành tiền nhóm hiện CẢ phần nhóm con, nhưng Tổng sheet chỉ lấy các mục trực tiếp của nhóm${he > 1 ? ` × SL ${soVN(he)}` : ""}; mỗi nhóm con nhân SL của chính nó.`);
  }

  if (coNhom) ghiChu.unshift("Ô Thành tiền của nhóm = tổng Thành tiền các mục trong nhóm × SL nhóm (SL trống hoặc nhỏ hơn 1 tính ×1); mục trong nhóm con nhân SL nhóm con. Tổng sheet cộng ô nhóm, không cộng lại từng mục bên trong.");
  if (!nhomTinh) {
    const coSL = ds.filter((it) => laNhom(it) && M.qtyForAmount(it) > 1);
    if (coSL.length) ghiChu.push(`Chưa bật “Hiện Thành Tiền nhóm” → SL của ${coSL.slice(0, 3).map((it) => `“${tenNgan(it.name)}”`).join(", ")}${coSL.length > 3 ? "…" : ""} KHÔNG nhân vào tổng; cộng thẳng từng mục.`);
  }
  if (ds.some((it) => it.kind === "info")) ghiChu.push("Dòng thông tin không tính tiền.");
  if (ds.some((it, i) => !laNhom(it) && it.kind !== "info" && tien(i) < 0)) ghiChu.push("Hàng có Thành tiền âm được trừ đi.");

  // Số cuối lấy từ CHÍNH hàm tính tổng của báo giá (không cộng lại phanTu) — diễn giải không bao giờ lệch số đang hiện.
  const gross = M.roundVnd(M.sheetSubtotalGrouped(ds, o.usesDays, nhomTinh));
  if (!phanTu.length) return { congThuc: "=0", dienGiai: "Chưa có hàng nào tính tiền", ghiChu, phanTu };
  const cong = phanTu.reduce((acc, p) => acc + p.giaTri, 0);
  const lamTron = Math.abs(cong - gross) > 1e-6 ? ` = ${soVN(cong)} → làm tròn đến đồng: ${M.fmtMoney(gross)}` : ` = ${M.fmtMoney(gross)}`;
  return { congThuc: "=" + phanTu.map((p) => p.thamChieu).join("+"), dienGiai: `= ${noiCong(phanTu.map((p) => p.giaTri))}${lamTron}`, ghiChu, phanTu };
}

// ── Các ô còn lại của khối tổng MỘT sheet: tham chiếu bằng TÊN của chính dòng đó ("Tổng sheet", "Discount", "VAT").
// Các ô này không nằm trong lưới nên không có địa chỉ A1 thật — đặt "G26" cho chúng là bịa ra một ô mà công thức
// trong lưới không trỏ tới được. Ô được nhắc tên vẫn tô sáng như mọi tham chiếu.

/** Nhãn dòng đầu khối tổng — y như QuoteEditor in: có Discount thì "Cộng", không thì "Tổng sheet". */
export const nhanCong = (t: M.SheetTotals) => (t.discount > 0 ? "Cộng" : "Tổng sheet");

/** Discount đã kẹp (M.sheetDiscountOf): không âm, không trừ quá Cộng. Chỉ gọi khi discount > 0. */
export function congThucDiscount(t: M.SheetTotals): CongThucO {
  return { congThuc: `=MIN(${t.discount};Cộng)`, dienGiai: `= MIN(${soVN(t.discount)} ; ${soVN(t.gross)}) = ${soVN(t.discount)} — số nhập ở ô Discount, trừ thẳng vào sheet này trước VAT, không trừ quá Cộng`, ghiChu: [] };
}

/** Dòng "Tổng cộng" (chỉ hiện khi có Discount). */
export function congThucTongCong(t: M.SheetTotals): CongThucO {
  return { congThuc: "=Cộng-Discount", dienGiai: `= ${soVN(t.gross)} − ${soVN(t.discount)} = ${soVN(t.net)}`, ghiChu: [] };
}

/** VAT = ROUND(cơ số × %; 0). Cơ số: (Cộng − Discount) của một sheet, hoặc ô Tổng cộng của bảng Tổng báo giá.
 *  Làm tròn như M.roundVnd (Math.round — nửa đồng làm tròn lên), trên ĐÚNG phép tính `cơ số × % / 100` của mã. */
export function congThucVat(coSo: { congThuc: string; dienGiai: string; giaTri: number }, vatPct: number, vat: number): CongThucO {
  const p = Number(vatPct) || 0;
  const dung = (coSo.giaTri * p) / 100;
  const tron = Math.abs(dung - Math.round(dung)) > 1e-9;
  return {
    congThuc: `=ROUND(${coSo.congThuc}*${phanTram(p)};0)`,
    dienGiai: `= ${coSo.dienGiai} × ${phanTram(p)} = ${soVN(dung)}${tron ? ` → làm tròn đến đồng: ${M.fmtMoney(vat)}` : ""}`,
    ghiChu: [],
  };
}
export function congThucVatSheet(t: M.SheetTotals, vatPct: number, vat: number): CongThucO {
  return congThucVat(t.discount > 0
    ? { congThuc: "(Cộng-Discount)", dienGiai: `(${soVN(t.gross)} − ${soVN(t.discount)})`, giaTri: t.net }
    : { congThuc: "Tổng sheet", dienGiai: soVN(t.gross), giaTri: t.net }, vatPct, vat);
}

/** Thành tiền của MỘT sheet = Tổng sheet − Discount + VAT. */
export function congThucThanhTienSheet(t: M.SheetTotals, vat: number): CongThucO {
  return t.discount > 0
    ? { congThuc: "=Cộng-Discount+VAT", dienGiai: `= ${soVN(t.gross)} − ${soVN(t.discount)} + ${soVN(vat)} = ${soVN(t.net + vat)}`, ghiChu: [] }
    : { congThuc: "=Tổng sheet+VAT", dienGiai: `= ${soVN(t.gross)} + ${soVN(vat)} = ${soVN(t.net + vat)}`, ghiChu: [] };
}

// ── Bảng "Tổng báo giá" (nhiều sheet): đó là một BẢNG thật (STT · Sheet · Khách duyệt · Tổng) nên dùng địa chỉ A1 của
// chính bảng đó, như sheet "Tổng Báo Giá" của tệp Excel. Địa chỉ do nơi gọi đo từ DOM (vị trí ô thật trong bảng).

/** "D2","D3","D4","D6" → "SUM(D2:D4)+D6": các ô liền nhau cùng cột gộp thành dải. Trả từng tham chiếu + chỉ số ô của nó. */
export function gopDai(o: { L: string; r: number }[]): { thamChieu: string; chiSo: number[] }[] {
  const kq: { thamChieu: string; chiSo: number[] }[] = [];
  for (let j = 0; j < o.length;) {
    let k = j;
    while (k + 1 < o.length && o[k + 1].L === o[j].L && o[k + 1].r === o[k].r + 1) k++;
    const a = `${o[j].L}${o[j].r}`, b = `${o[k].L}${o[k].r}`;
    kq.push({ thamChieu: j === k ? a : `SUM(${a}:${b})`, chiSo: Array.from({ length: k - j + 1 }, (_, x) => j + x) });
    j = k + 1;
  }
  return kq;
}

export type SheetBangTong = { ten: string; custStatus?: string | null; tong: M.SheetTotals };
const tenSheet = (s: SheetBangTong, i: number) => `${i + 1}. “${tenNgan(s.ten)}”`;

/** Ô "Tổng (VNĐ)" của một sheet: số Tổng cộng (đã trừ Discount) trong khối tổng của CHÍNH sheet đó. */
export function congThucTongTungSheet(s: SheetBangTong): CongThucO {
  const ten = `'${String(s.ten).replace(/'/g, "''")}'!`;
  return s.tong.discount > 0
    ? { congThuc: `=${ten}Cộng-${ten}Discount`, dienGiai: `= ${soVN(s.tong.gross)} − ${soVN(s.tong.discount)} = ${soVN(s.tong.net)} (khối tổng của sheet “${tenNgan(s.ten)}”)`, ghiChu: [] }
    : { congThuc: `=${ten}Tổng sheet`, dienGiai: `= ${soVN(s.tong.net)} (khối tổng của sheet “${tenNgan(s.ten)}”)`, ghiChu: [] };
}

/** Cộng các ô sheet (đã đo địa chỉ) — dùng cho cả "Tổng cộng" (mọi sheet) lẫn "Tổng phần khách đã duyệt". */
export function congThucCongSheet(ds: { s: SheetBangTong; i: number; L: string; r: number }[], tong: number, cacSheet: SheetBangTong[], chiDaDuyet: boolean): CongThucO & { dai: { thamChieu: string; chiSo: number[] }[] } {
  const dai = gopDai(ds);
  const ghiChu: string[] = [];
  if (ds.some((x) => x.s.tong.discount > 0)) ghiChu.push("Mỗi số là Tổng cộng của sheet đó, ĐÃ trừ Discount của sheet.");
  if (chiDaDuyet) {
    const bo = cacSheet.map((s, i) => ({ s, i })).filter((x) => x.s.custStatus !== "approved");
    if (bo.length) ghiChu.push(`Chỉ cộng sheet khách ĐÃ duyệt — bỏ: ${bo.map((x) => `${tenSheet(x.s, x.i)} (${x.s.custStatus === "rejected" ? "khách không duyệt" : "chưa có ý kiến"})`).join(", ")}.`);
  } else {
    const khong = cacSheet.map((s, i) => ({ s, i })).filter((x) => x.s.custStatus === "rejected");
    if (khong.length) ghiChu.push(`Tổng cộng gồm MỌI sheet, kể cả sheet khách KHÔNG duyệt: ${khong.map((x) => tenSheet(x.s, x.i)).join(", ")} — Excel/PDF gửi khách cũng cộng như vậy.`);
  }
  return {
    congThuc: dai.length ? "=" + dai.map((d) => d.thamChieu).join("+") : "=0",
    dienGiai: ds.length ? `= ${noiCong(ds.map((x) => x.s.tong.net))} = ${M.fmtMoney(tong)}` : "Chưa có sheet nào",
    ghiChu, dai,
  };
}

/** Thành tiền của báo giá = ô Tổng cộng + ô VAT (địa chỉ A1 trong bảng Tổng báo giá). */
export function congThucThanhTienBang(oTong: string, oVat: string, tt: { subtotal: number; vat: number; total: number }): CongThucO {
  return { congThuc: `=${oTong}+${oVat}`, dienGiai: `= ${soVN(tt.subtotal)} + ${soVN(tt.vat)} = ${soVN(tt.total)}`, ghiChu: [] };
}
