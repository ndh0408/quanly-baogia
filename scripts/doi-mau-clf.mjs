#!/usr/bin/env node
// ============================================================================
// ĐỔI MÀU NỀN NƯỚNG SẴN CỦA MẪU COLORFULL THEO TỆP MẪU NGƯỜI DÙNG CHỈNH (2026-09-23).
//
// Nguồn màu: "Copy of Copy of E2E_-_Nhap_tu_Excel_091-new4.xlsx" (bản sửa sáng 2026-09-23), đọc
// bằng exceljs:
//     dải tiêu đề  "BẢNG BÁO GIÁ …"          nền 9CCDC9 · chữ 243139 đậm
//     hàng tiêu đề cột (STT … Ghi Chú)        nền 9DCCC9
//     khối tổng  (Tổng Cộng / VAT / Thành Tiền) nền 9DCCC9
// Trước đó cả ba vùng là theme8 tint 0.4 (= #93CDDD). Dải "* Thông tin chương trình" (hàng 5) tệp
// mẫu vẫn để theme8 tint 0.4 — KHÔNG đụng.
//
// Hàng nhóm / nhóm con KHÔNG nằm ở đây: app tô lúc xuất theo `items.sectionFill` / `subFill`
// trong `src/templateConfigs.ts`.
//
// Chỉ đổi fgColor của nền (và màu chữ dải tiêu đề) — viền, font, căn lề, vùng gộp giữ nguyên.
//
//   node scripts/doi-mau-clf.mjs              # sửa CLF_KhongNgay.xlsx (nguồn)
//   node scripts/dung-mau-clf-co-ngay.mjs     # rồi dựng lại bản có-ngày từ nó
// Chạy lại nhiều lần vô hại: ô đã đúng màu thì giữ nguyên.
// ============================================================================
import ExcelJS from "exceljs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const GOC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEP = path.join(GOC, "templates/CLF_KhongNgay.xlsx");

const NEN_TIEU_DE = "FF9CCDC9", CHU_TIEU_DE = "FF243139";
const NEN_BANG = "FF9DCCC9";
const COT = ["B", "C", "D", "E", "F", "G", "H", "I"];

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(TEP);
const ws = wb.worksheets[0];

const toNen = (addr, argb) => {
  const o = ws.getCell(addr);
  o.fill = { type: "pattern", pattern: "solid", fgColor: { argb }, bgColor: { indexed: 64 } };
};

// Hàng 2 — dải tiêu đề (gộp B2:I2): tô mọi ô của vùng gộp để Excel không vẽ lệch ở ô phụ.
for (const c of COT) {
  toNen(`${c}2`, NEN_TIEU_DE);
  const o = ws.getCell(`${c}2`);
  o.font = { ...(o.font || {}), color: { argb: CHU_TIEU_DE }, bold: true };
}
// Hàng 4 — tiêu đề cột.
for (const c of COT) toNen(`${c}4`, NEN_BANG);
// Hàng 13–15 — khối tổng: hộp nhãn F:G + ô tiền H (B..E để trống, xem sua-mau-clf-khoi-tong.mjs).
for (const r of [13, 14, 15]) for (const c of ["F", "G", "H"]) toNen(`${c}${r}`, NEN_BANG);

await wb.xlsx.writeFile(TEP);
console.log(`✓ Đã đổi màu ${path.relative(GOC, TEP)} — tiêu đề ${NEN_TIEU_DE}/${CHU_TIEU_DE}, bảng ${NEN_BANG}`);
