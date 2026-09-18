#!/usr/bin/env node
// ============================================================================
// DỰNG `templates/CLF_CoNgay.xlsx` TỪ `templates/CLF_KhongNgay.xlsx`.
//
// ── VÌ SAO Ở ĐÂY PHẢI CHÈN CỘT, TRONG KHI BẢN GN THÌ KHÔNG ────────────────
// `scripts/dung-mau-co-ngay.mjs` (bản GN) cố ý CHỈ ĐỔI NHÃN CỘT: chèn cột thì phải nới lại vùng
// gộp của ba hàng tổng, đặt lại bề rộng và vùng in — đúng những thứ kế toán nhận ra ngay. GN đủ
// chỗ để làm vậy vì nó HY SINH cột Chi Tiết: D đang là "Chi Tiết" được đổi thẳng thành "ĐVT".
//
// Colorfull thì không hy sinh được — cột Chi Tiết là cột kể nội dung của mẫu này (D rộng 50, rộng
// nhất bảng) và bản không-ngày vừa bật nó lên. Cần CẢ Chi Tiết LẪN Số Ngày ⇒ bảng phải dài thêm
// một cột thật: 8 cột (B…I) thành 9 cột (B…J).
//
//   CLF không ngày:  B=STT  C=Hạng Mục  D=Chi Tiết  E=ĐVT  F=SỐ LƯỢNG            G=ĐƠN GIÁ  H=THÀNH TIỀN  I=Ghi Chú
//   CLF có ngày:     B=STT  C=Hạng Mục  D=Chi Tiết  E=ĐVT  F=SỐ LƯỢNG  G=SỐ NGÀY  H=ĐƠN GIÁ  I=THÀNH TIỀN  J=Ghi Chú
//
// ── BẪY: `spliceColumns` DỜI GIÁ TRỊ MÀ KHÔNG DỜI VÙNG GỘP ────────────────
// Đo trực tiếp trên chính file này trước khi viết script:
//     trước:  B13 = "Tổng Cộng"   (vùng gộp B13:G13)
//     sau spliceColumns(7,0,[]):  B13 = null, chữ chạy sang H13 — mà danh sách gộp VẪN là B13:G13.
// Tức nhãn "Tổng Cộng" biến mất khỏi file trong khi một ô gộp rỗng nằm đè lên chỗ cũ. Nên script
// phải: GỠ hết vùng gộp → chèn cột → GỘP LẠI theo toạ độ đã dịch.
//
// Luật dịch một vùng gộp quanh điểm chèn (cột 7 = G):
//   · cột < 7            → giữ nguyên
//   · cột ≥ 7            → +1
//   · vùng BẮC QUA điểm chèn (đầu < 7 ≤ cuối) → RỘNG RA một cột, đúng ý muốn: nhãn "Tổng Cộng"
//     đang phủ B:G thì sau khi bảng dài thêm phải phủ B:H, không thì chừa một ô trắng giữa nhãn
//     và số tiền.
//
// ── STYLE ĐI THEO NGHĨA ───────────────────────────────────────────────────
// Cột SỐ NGÀY mới (G) chép style của cột SỐ LƯỢNG (F) — cùng là cột số, cùng canh giữa, cùng viền.
// Không chép thì nó thừa hưởng style mặc định và cả bảng lệch một cột trông rất rõ.
//
// ── CHẠY LẠI ĐƯỢC BAO NHIÊU LẦN CŨNG RA MỘT FILE ──────────────────────────
// Luôn đọc từ CLF_KhongNgay.xlsx rồi ghi đè đích, không bao giờ đọc chính đích — chạy hai lần
// không đẻ ra hai cột Số Ngày.
//
//   node scripts/dung-mau-clf-co-ngay.mjs           # dựng
//   node scripts/dung-mau-clf-co-ngay.mjs --soi     # dựng + in bản đồ ô để soi mắt thường
// ============================================================================
import ExcelJS from "exceljs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const GOC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NGUON = path.join(GOC, "templates/CLF_KhongNgay.xlsx");
const DICH = path.join(GOC, "templates/CLF_CoNgay.xlsx");

const CHEN_TAI = 7;           // cột G — ngay trước ĐƠN GIÁ
const NHAN_MOI = "SỐ NGÀY";
const CHEP_STYLE_TU = 6;      // cột F (SỐ LƯỢNG) — cùng loại cột số
const HANG_TIEU_DE = 4;
const soi = process.argv.includes("--soi");

const chuCot = (n) => { let s = ""; while (n > 0) { const d = (n - 1) % 26; s = String.fromCharCode(65 + d) + s; n = Math.floor((n - 1) / 26); } return s; };
const soCot = (s) => [...s].reduce((a, c) => a * 26 + (c.charCodeAt(0) - 64), 0);

/** Dịch một toạ độ cột quanh điểm chèn. */
const dich = (c) => (c < CHEN_TAI ? c : c + 1);

/** "B13:G13" → "B13:H13" sau khi chèn. Vùng bắc qua điểm chèn thì rộng thêm một cột. */
function dichVung(range) {
  const [a, b] = range.split(":");
  const tach = (addr) => { const m = addr.match(/^([A-Z]+)(\d+)$/); return { c: soCot(m[1]), r: m[2] }; };
  const t = tach(a), p = tach(b || a);
  return `${chuCot(dich(t.c))}${t.r}:${chuCot(dich(p.c))}${p.r}`;
}

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(NGUON);
const ws = wb.worksheets[0];

// 1) CHỤP STYLE TỪNG Ô — PHẢI LÀM TRƯỚC MỌI THỨ.
// Hai lệnh dưới đây đều PHÁ style theo hai kiểu khác nhau:
//   · `unMergeCells` XOÁ style của các ô KHÔNG phải ô chủ trong vùng gộp;
//   · `mergeCells` thì ngược lại — chép style ô chủ ra CẢ vùng.
// Excel không làm cả hai: file gốc có hàng 5 ("* Thông tin chương trình", gộp B5:I5) với viền
// KHÔNG đồng nhất — B5 = trái+trên+dưới · C5…H5 = trên+dưới · I5 = trên+PHẢI+dưới, tức dải màu
// đóng khung hai đầu, giữa không vạch dọc. Đo trên hai bản dựng hỏng trước đó:
//     bản gốc      r5:  B:LT-B  C..H:-T-B  I:-TRB     ← đúng
//     chụp SAU merge:   B..J:LT-B                     ← hở cạnh phải, mọc vạch dọc từng cột
//     chụp SAU unmerge: B:LT-B  C..J:----             ← mất sạch viền, còn tệ hơn
// Nên chụp NGAY BÂY GIỜ, lúc file còn nguyên, rồi trả lại sau khi đã chèn cột + gộp lại — trả về
// toạ độ ĐÃ DỊCH, vì cột từ G trở đi đều dời một ô.
const styleCu = new Map();
ws.eachRow({ includeEmpty: true }, (row, r) => {
  row.eachCell({ includeEmpty: true }, (cell, c) => {
    styleCu.set(`${r}:${c}`, JSON.parse(JSON.stringify(cell.style ?? {})));
  });
});

// 2) Nhớ rồi GỠ HẾT vùng gộp (xem bẫy ở đầu tệp).
const gopCu = [...(ws.model.merges || [])];
for (const m of gopCu) ws.unMergeCells(m);

// 3) GỠ CÔNG THỨC CHIA SẺ — BẮT BUỘC LÀM TRƯỚC KHI CHÈN CỘT.
// File CLF dùng shared formula cho cột Thành Tiền (một ô master, các ô dưới là clone). Nếu chèn
// cột trước thì:
//   · ExcelJS TỪ CHỐI GHI: "Shared Formula master must exist above and or left of clone for cell I8";
//   · và ngay cả việc ĐỌC `.formula` của ô clone cũng ném lỗi, vì nó đi tìm công thức của ô master
//     mà ô đó đã dời chỗ (đo được: TypeError trong slideFormula).
// Làm trước, lúc quan hệ master/clone còn nguyên, thì getter `.formula` trả về chuỗi đầy đủ và mỗi
// ô trở thành công thức độc lập — không còn quan hệ nào để mà gãy.
const congThucGoc = new Map();
ws.eachRow({ includeEmpty: false }, (row) => {
  row.eachCell({ includeEmpty: false }, (cell) => {
    const f = cell.formula;
    if (f) congThucGoc.set(cell.address, { f, kq: cell.result });
  });
});
for (const [addr, { f, kq }] of congThucGoc) ws.getCell(addr).value = { formula: f, result: kq ?? undefined };

// 4) Chèn cột trống trước G. Giá trị + style của G,H,I chạy sang H,I,J.
ws.spliceColumns(CHEN_TAI, 0, []);

// 5) THAM CHIẾU TRONG CÔNG THỨC KHÔNG TỰ DỊCH THEO CỘT ĐÃ CHÈN.
// `=SUM(H6:H12)` vẫn trỏ H sau khi cột Thành Tiền đã sang I → dòng tổng lấy nhầm cột Đơn Giá.
// App ghi đè phần lớn công thức này lúc xuất, nhưng một file mẫu mang sẵn công thức SAI là thứ sẽ
// cắn vào một ngày nào đó — và nó hiện ra ngay khi ai đó mở file mẫu bằng Excel.
const dichCongThuc = (f) => f.replace(/(\$?)([A-Z]{1,2})(\$?)(\d+)/g, (ca, d1, cot, d2, hang) => {
  const c = soCot(cot);
  return c >= 1 && c <= 26 ? `${d1}${chuCot(dich(c))}${d2}${hang}` : ca;
});
ws.eachRow({ includeEmpty: false }, (row) => {
  row.eachCell({ includeEmpty: false }, (cell) => {
    const f = cell.formula;
    if (f) cell.value = { formula: dichCongThuc(f), result: cell.result ?? undefined };
  });
});

// 6) Gộp lại theo toạ độ đã dịch.
const gopMoi = gopCu.map(dichVung);
for (const m of gopMoi) ws.mergeCells(m);

// 7) TRẢ STYLE VỀ TỪNG Ô, theo toạ độ đã dịch (xem bước 1).
for (const [khoa, st] of styleCu) {
  const [r, c] = khoa.split(":").map(Number);
  ws.getCell(r, dich(c)).style = st;
}

// 8) Dựng cột SỐ NGÀY: nhãn + style chép từ cột SỐ LƯỢNG.
const colNguon = ws.getColumn(CHEP_STYLE_TU);
const colMoi = ws.getColumn(CHEN_TAI);
colMoi.width = colNguon.width;
ws.eachRow({ includeEmpty: true }, (row, r) => {
  const nguon = row.getCell(CHEP_STYLE_TU);
  const dichO = row.getCell(CHEN_TAI);
  dichO.style = JSON.parse(JSON.stringify(nguon.style ?? {}));
});
const oTieuDe = ws.getCell(`${chuCot(CHEN_TAI)}${HANG_TIEU_DE}`);
oTieuDe.value = NHAN_MOI;
oTieuDe.style = JSON.parse(JSON.stringify(ws.getCell(`${chuCot(CHEP_STYLE_TU)}${HANG_TIEU_DE}`).style ?? {}));

// 9) Hai ô chú thích cho lập trình viên trong file gốc ("hàng này có hoặc ko tùy chương trình",
//    "tạo được những hàng con…") nằm ở J5/J8, sau khi chèn thì trôi sang K5/K8. Chúng KHÔNG phải
//    nội dung báo giá — bản không-ngày phải dùng `extraCellsToClear` để xoá lúc xuất. Mẫu mới thì
//    dọn thẳng ở đây, không mang rác sang.
for (const addr of ["K5", "K8"]) ws.getCell(addr).value = null;

await wb.xlsx.writeFile(DICH);
console.log(`✓ Đã dựng ${path.relative(GOC, DICH)}`);

// ── Tự soi lại: đọc LẠI file vừa ghi, không tin vào workbook trong bộ nhớ ───────────────────
const kt = new ExcelJS.Workbook();
await kt.xlsx.readFile(DICH);
const w2 = kt.worksheets[0];
const tieuDe = ["B", "C", "D", "E", "F", "G", "H", "I", "J"].map((L) => String(w2.getCell(`${L}${HANG_TIEU_DE}`).value ?? "").trim());
console.log("  Hàng tiêu đề:", tieuDe.map((t, i) => `${chuCot(i + 2)}=${t || "∅"}`).join("  "));
console.log("  Vùng gộp    :", JSON.stringify(w2.model.merges));
console.log("  Bề rộng     :", ["C", "D", "F", "G", "H", "I"].map((L) => `${L}=${w2.getColumn(L).width}`).join("  "));

const loi = [];
if (tieuDe[5] !== NHAN_MOI) loi.push(`G${HANG_TIEU_DE} phải là "${NHAN_MOI}", đang là "${tieuDe[5]}"`);
if (tieuDe[2] !== "Chi Tiết") loi.push(`D${HANG_TIEU_DE} mất cột Chi Tiết (đang là "${tieuDe[2]}")`);
for (const [r, nhan] of [[13, "Tổng Cộng"], [14, "VAT(8%)"], [15, "Thành Tiền"]]) {
  const v = String(w2.getCell(`B${r}`).value ?? "").trim();
  if (v !== nhan) loi.push(`B${r} phải là nhãn "${nhan}", đang là "${v}" — vùng gộp bị lệch`);
  if (!w2.model.merges.includes(`B${r}:H${r}`)) loi.push(`hàng ${r} phải gộp B:H, đang có ${w2.model.merges.filter((m) => m.startsWith(`B${r}`)).join(",") || "không gì"}`);
}
if (loi.length) { console.error("✖ SAI:\n  - " + loi.join("\n  - ")); process.exit(1); }
console.log("  ✓ tiêu đề, nhãn tổng và vùng gộp đều đúng");

if (soi) {
  for (let r = 1; r <= 20; r++) {
    const o = [];
    for (let c = 2; c <= 11; c++) {
      const cell = w2.getCell(r, c);
      let v = cell.value;
      if (v && typeof v === "object") v = v.formula ? `=${v.formula}` : (v.richText ? v.richText.map((t) => t.text).join("") : "?");
      const s = String(v ?? "").replace(/\n/g, "⏎").slice(0, 22);
      if (s) o.push(`${chuCot(c)}=${s}`);
    }
    if (o.length) console.log(`  r${r}: ${o.join(" | ")}`);
  }
}
