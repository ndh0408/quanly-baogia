#!/usr/bin/env node
// ============================================================================
// THU GỌN KHỐI TỔNG CỦA MẪU COLORFULL CHO GIỐNG BẢN GIA NGUYỄN.
//
// ── ĐO ĐƯỢC TRÊN HAI FILE MẪU ─────────────────────────────────────────────
//   Marico_Decor.xlsx (GN) r22:  B..E = KHÔNG tô màu · F:G gộp + tô · H tô
//   CLF_KhongNgay.xlsx     r13:  B..G GỘP HẾT + tô   · H tô
// Tức bên GN nhãn "Tổng Cộng / VAT / Thành Tiền" nằm trong một hộp gọn ngay cạnh cột tiền, còn
// bên Colorfull nó là một băng màu chạy suốt chiều ngang bảng. Người dùng yêu cầu thu lại như GN.
//
// ── VÌ SAO PHẢI SỬA FILE MẪU, KHÔNG SỬA Ở TẦNG MÃ ─────────────────────────
// Bản đầu tôi chỉ đổi `labelCells` của cấu hình từ ["B","G"] sang ["F","G"]. Kết quả: file xuất ra
// MỞ KHÔNG ĐƯỢC. Lý do đo được trong chính file (đọc mergeCells trong XML):
//     B16:F16  +  F16:G16     ← hai vùng gộp CHỒNG NHAU ở cột F
// `mergeCells("F16:G16")` đè lên vùng B16:G16 sẵn có của mẫu thì ExcelJS XÉ vùng cũ thành phần
// bên trái, tạo ra chồng lấn. Và KHÔNG gỡ trước được: hàng tổng cuối do `duplicateRow` dựng ra,
// mà sau lệnh đó sổ ghi vùng gộp của ExcelJS LỆCH khỏi trạng thái thật của ô (ô báo `isMerged`
// đúng, sổ vẫn ghi toạ độ cũ) — nên mọi cách gỡ dựa trên sổ đều trượt.
// Cách đúng: để FILE MẪU khớp sẵn với cấu hình, y như mẫu GN vốn đã vậy. Không còn gì để mà xé.
//
// ── CHẠY ─────────────────────────────────────────────────────────────────
//   node scripts/sua-mau-clf-khoi-tong.mjs        # sửa CLF_KhongNgay.xlsx (nguồn)
//   node scripts/dung-mau-clf-co-ngay.mjs         # rồi dựng lại bản có-ngày từ nó
// Chạy lại nhiều lần vô hại: đã ở dạng F:G thì script báo "không có gì để sửa" và thoát.
// ============================================================================
import ExcelJS from "exceljs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const GOC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEP = path.join(GOC, "templates/CLF_KhongNgay.xlsx");
const HANG_TONG = [13, 14, 15];          // Tổng Cộng · VAT · Thành Tiền
const COT_DAU = 2, COT_NHAN_TU = 6, COT_NHAN_DEN = 7;   // B … F..G (giá trị ở H)

const chuCot = (n) => { let s = ""; while (n > 0) { const d = (n - 1) % 26; s = String.fromCharCode(65 + d) + s; n = Math.floor((n - 1) / 26); } return s; };

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(TEP);
const ws = wb.worksheets[0];

const canSua = HANG_TONG.filter((r) => (ws.model.merges || []).includes(`B${r}:G${r}`));
if (!canSua.length) console.log("· Khối tổng đã ở dạng gọn (F:G) — bỏ qua bước này.");

for (const r of canSua) {
  // Style của CẢ băng nằm ở ô chủ B{r} (các ô còn lại là ô phụ, không giữ style riêng).
  const styleBang = JSON.parse(JSON.stringify(ws.getCell(`B${r}`).style ?? {}));
  // CHỮ NHÃN ĐANG NẰM Ở Ô CHỦ CŨ (B) — phải mang theo sang hộp nhãn mới, không thì file mẫu mất
  // hẳn ba chữ "Tổng Cộng / VAT(8%) / Thành Tiền" (app có ghi đè lúc xuất, nhưng mở file mẫu ra
  // xem thì trống trơn, và bước dựng bản có-ngày đọc chính chữ này).
  const chuNhan = ws.getCell(`B${r}`).value;
  ws.unMergeCells(`B${r}:G${r}`);

  // B..E: trả về TRỐNG như bên GN — bỏ nền, bỏ viền. Giữ font/căn lề để không lệch dòng.
  for (let c = COT_DAU; c < COT_NHAN_TU; c++) {
    const o = ws.getCell(r, c);
    const st = JSON.parse(JSON.stringify(styleBang));
    delete st.fill;
    delete st.border;
    o.style = st;
    o.value = null;
  }
  // F..G: giữ nguyên style băng rồi gộp lại thành hộp nhãn gọn.
  for (let c = COT_NHAN_TU; c <= COT_NHAN_DEN; c++) {
    ws.getCell(r, c).style = JSON.parse(JSON.stringify(styleBang));
  }
  ws.mergeCells(`${chuCot(COT_NHAN_TU)}${r}:${chuCot(COT_NHAN_DEN)}${r}`);
  ws.getCell(`${chuCot(COT_NHAN_TU)}${r}`).value = chuNhan ?? null;
}

// ── THIẾT LẬP TRANG IN: ĐỪNG NHỒI CẢ BẢNG VÀO MỘT TRANG ──────────────────────────────────
// Đo trên file xuất THẬT (báo giá 120 hạng mục → 143 hàng):
//     GN  : fitToPage=false, tỷ lệ 55  → in nhiều trang ở 55%, đọc được
//     CLF : fitToPage=true, fitToWidth=1, fitToHeight=1  → Excel BÓP cả 143 hàng vào MỘT trang
// Tức mọi báo giá Colorfull dài đem in hoặc xuất PDF đều nhỏ tới mức không đọc nổi. Bộ xuất chỉ
// CHÉP NGUYÊN `pageSetup` của file mẫu (src/excel.ts) nên lỗi này nằm ở chính file mẫu.
//
// CỐ Ý KHÔNG bắt chước y GN (fitToPage=false + tỷ lệ 55): bảng Colorfull bản có-ngày rộng 9 cột,
// một tỷ lệ cố định có thể cắt mất cột cuối. `fitToWidth=1` + `fitToHeight=0` nghĩa là "vừa đúng
// một trang NGANG, cao bao nhiêu trang cũng được" — vừa chắc không cắt cột, vừa không bóp chữ.
// Lề trái/phải 0.25 → 0.7 cho khớp GN (0.25 là sát mép, máy in thường cắt).
const ps = ws.pageSetup || (ws.pageSetup = {});
const truocPS = `fitToPage=${ps.fitToPage} fitH=${ps.fitToHeight} le=${ps.margins?.left}`;
ps.fitToPage = true;
ps.fitToWidth = 1;
ps.fitToHeight = 0;
ps.margins = { ...(ps.margins || {}), left: 0.7, right: 0.7 };
console.log(`· Trang in: ${truocPS}  →  fitToPage=true fitH=0 le=0.7`);

await wb.xlsx.writeFile(TEP);
console.log(`✓ Đã thu gọn khối tổng ở ${canSua.length} hàng: ${canSua.join(", ")}`);

// ── Tự soi lại: đọc LẠI file vừa ghi ───────────────────────────────────────────────────────
const kt = new ExcelJS.Workbook();
await kt.xlsx.readFile(TEP);
const w2 = kt.worksheets[0];
const loi = [];
const ps2 = w2.pageSetup || {};
if (ps2.fitToHeight !== 0) loi.push(`trang in: fitToHeight phải là 0 (cao bao nhiêu trang cũng được), đang là ${ps2.fitToHeight}`);
if (ps2.fitToWidth !== 1) loi.push(`trang in: fitToWidth phải là 1, đang là ${ps2.fitToWidth}`);
if (Number(ps2.margins?.left) < 0.7) loi.push(`trang in: lề trái ${ps2.margins?.left} sát mép quá (GN dùng 0.7)`);
for (const r of HANG_TONG) {
  const merges = w2.model.merges || [];
  if (!merges.includes(`F${r}:G${r}`)) loi.push(`hàng ${r}: thiếu vùng gộp F:G (đang có ${merges.filter((m) => m.includes(String(r))).join(",") || "không gì"})`);
  if (merges.includes(`B${r}:G${r}`)) loi.push(`hàng ${r}: vùng gộp B:G vẫn còn`);
  for (const L of ["B", "C", "D", "E"]) {
    if (w2.getCell(`${L}${r}`).fill?.fgColor) loi.push(`${L}${r}: vẫn còn nền — bên GN các ô này để trống`);
  }
  if (!w2.getCell(`F${r}`).fill?.fgColor) loi.push(`F${r}: mất nền của hộp nhãn`);
  if (!w2.getCell(`H${r}`).fill?.fgColor) loi.push(`H${r}: mất nền của ô số tiền`);
  if (!String(w2.getCell(`F${r}`).value ?? "").trim()) loi.push(`F${r}: mất chữ nhãn (phải mang theo từ ô chủ cũ B${r})`);
}
if (loi.length) { console.error("✖ SAI:\n  - " + loi.join("\n  - ")); process.exit(1); }
console.log("  ✓ F:G gộp gọn · B..E sạch nền · H giữ nền — khớp bố cục mẫu GN");
