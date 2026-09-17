#!/usr/bin/env node
// ============================================================================
// DỰNG `templates/GN_CoNgay.xlsx` TỪ `templates/Marico_Decor.xlsx`.
//
// ── VÌ SAO BÊ NỀN "KHÔNG NGÀY" SANG ───────────────────────────────────────
// Mẫu có-ngày CŨ (`templates/Unibenfood.xlsx`) hỏng ở hai chỗ độc lập nhau, cả hai đo được trên
// file thật xuất từ production (báo giá #40, trang "Premiere"):
//
//   1. HAI DÒNG TIÊU ĐỀ TRÙNG NHAU — r10 và r11 y hệt:
//        r10  STT | Hạng Mục | ĐVT | Số Lượng | Số Ngày | Đơn Giá | Thành Tiền
//        r11  STT | Hạng Mục | ĐVT | Số Lượng | Số Ngày | Đơn Giá | Thành Tiền
//      Lỗi nằm NGAY TRONG FILE MẪU, nên MỌI file khách nhận được đều mang theo.
//      Marico_Decor.xlsx chỉ có đúng một dòng tiêu đề, ở r11.
//
//   2. Bố cục lệch hẳn bản không-ngày, nên mọi bản vá phải làm HAI LẦN. Gần nhất: xoá nhãn "Ms."
//      nhúng cứng ở B3/E3 chỉ vá được cho nền Marico — bản có-ngày không hưởng.
//
// ── CHỈ ĐỔI NHÃN CỘT, KHÔNG CHÈN/XOÁ CỘT ──────────────────────────────────
// Chèn hay xoá cột thì phải nới lại vùng gộp của cả ba hàng tổng, đặt lại bề rộng và vùng in —
// đúng những thứ kế toán nhận ra ngay. Đổi nhãn thì bố cục không xê dịch một ly.
//
//   Marico (không ngày):  B=STT  C=Hạng Mục  D=Chi Tiết  E=ĐVT  F=SỐ LƯỢNG  G=ĐƠN GIÁ  H=THÀNH TIỀN  I=Notes
//   GN_CoNgay (có ngày):  B=STT  C=Hạng Mục  D=ĐVT       E=SỐ LƯỢNG  F=SỐ NGÀY  G=ĐƠN GIÁ  H=THÀNH TIỀN  I=GHI CHÚ
//
// Cột "Chi Tiết" BIẾN MẤT THẬT, không phải bị ẩn hay gộp: bản không-ngày cũng không có cột đó
// trong file xuất ra (`removeDetail: true` gộp C:D lại), nên đây không phải bước lùi.
//
// STYLE ĐI THEO NGHĨA, KHÔNG THEO VỊ TRÍ: cột ĐVT mới (D) chép style của cột ĐVT cũ (E), cột SỐ
// LƯỢNG mới (E) chép của SỐ LƯỢNG cũ (F), SỐ NGÀY (F) cũng chép của SỐ LƯỢNG cũ — cùng là cột số.
// Giữ nguyên vị trí mà không chép style thì cột ĐVT thừa hưởng canh-trái + bề rộng 30 của Chi Tiết.
//
// ── CHỈ ĐỘNG VÀO VÙNG BẢNG, TUYỆT ĐỐI KHÔNG ĐỘNG KHỐI TỔNG ────────────────
// Bản đầu cho cả hai vòng chạy tới HẾT TRANG (dòng 33). Ba hàng tổng nằm ở 22–24, và ở đó nhãn
// "Tổng Cộng"/"VAT"/"Thành Tiền" nằm trong ô GỘP `F22:G22` — tức cột F mang nền be + viền của ô
// nhãn. Mà quy tắc chép style là E ← F, nên E22:E24 thừa hưởng luôn nền + viền đó: file khách nhận
// được có một khối màu rỗng lơ lửng bên trái chữ "Tổng Cộng", thò ra ngoài khung bảng. Bản
// không-ngày không có khối đó — người dùng báo đúng chỗ này.
//
// Nay hai vòng dừng ở hàng cuối của BẢNG. Bất biến sau khi sửa: ngoài vùng bảng, hai file mẫu
// GIỐNG HỆT NHAU — mọi thứ đã đúng ở bản không-ngày (khối tổng, chân trang, vùng in) không có
// đường nào để lệch nữa.
//
//   dùng:  node scripts/dung-mau-co-ngay.mjs
// ============================================================================
import ExcelJS from "exceljs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const NGUON = join(ROOT, "templates/Marico_Decor.xlsx");
const DICH = join(ROOT, "templates/GN_CoNgay.xlsx");
const HANG_TIEU_DE = 11;

/** cột ĐÍCH ← cột NGUỒN lấy style, kèm nhãn tiêu đề mới. */
const DOI = [
  { dich: "D", nguonStyle: "E", nhan: "ĐVT" },        // Chi Tiết  → ĐVT
  { dich: "E", nguonStyle: "F", nhan: "SỐ LƯỢNG" },   // ĐVT       → SỐ LƯỢNG
  { dich: "F", nguonStyle: "F", nhan: "SỐ NGÀY" },    // SỐ LƯỢNG  → SỐ NGÀY
  { dich: "I", nguonStyle: "I", nhan: "GHI CHÚ" },    // Notes     → GHI CHÚ
];

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(NGUON);
const ws = wb.worksheets[0];

const sao = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));

/** Hàng cuối của BẢNG = hàng cuối còn có số thứ tự ở cột B. Dò chứ không ghim cứng để đổi mẫu
 *  nguồn không lặng lẽ sai. Dưới nó là khối tổng — vùng cấm, xem đầu file. */
const CUOI = (() => {
  let r = HANG_TIEU_DE;
  while (r + 1 <= ws.rowCount && String(ws.getCell(`B${r + 1}`).value ?? "").trim() !== "") r++;
  if (r <= HANG_TIEU_DE) throw new Error(`không dò được hàng cuối của bảng dưới tiêu đề ${HANG_TIEU_DE}`);
  return r;
})();

// Chụp style NGUỒN TRƯỚC khi ghi đè — làm tuần tự sẽ đọc phải ô vừa bị sửa.
const styleNguon = new Map();
for (const { dich, nguonStyle } of DOI) {
  const theoHang = new Map();
  for (let r = HANG_TIEU_DE; r <= CUOI; r++) theoHang.set(r, sao(ws.getCell(`${nguonStyle}${r}`).style));
  styleNguon.set(dich, theoHang);
}

let doiStyle = 0;
let donNoiDung = 0;
for (const { dich, nhan } of DOI) {
  const theoHang = styleNguon.get(dich);
  for (let r = HANG_TIEU_DE; r <= CUOI; r++) {
    const o = ws.getCell(`${dich}${r}`);
    const st = theoHang.get(r);
    if (st) { o.style = st; doiStyle++; }
    if (r === HANG_TIEU_DE) {
      o.value = nhan;
    } else if (o.value !== null && o.value !== undefined && o.value !== "") {
      // Nội dung của báo giá Marico cũ còn sót trong cột này (vd Chi Tiết ". KT 0,6mW x 1m2…").
      // Để lại thì file có-ngày xuất ra mang chữ của một báo giá khác.
      o.value = null;
      donNoiDung++;
    }
  }
}

// Bề rộng cũng đi theo NGHĨA.
const rong = (c) => ws.getColumn(c).width;
const datRong = (c, v) => { if (v) ws.getColumn(c).width = v; };
const rongDVT = rong("E"), rongSL = rong("F");
datRong("D", rongDVT);
datRong("E", rongSL);
datRong("F", rongSL);

await wb.xlsx.writeFile(DICH);

console.log(`da dung ${DICH}`);
console.log(`  vung bang: hang ${HANG_TIEU_DE}..${CUOI} (khoi tong tu ${CUOI + 1} tro xuong: KHONG dung toi)`);
console.log(`  doi style ${doiStyle} o, don ${donNoiDung} o con sot noi dung mau cu`);
console.log(
  "  tieu de:",
  ["B", "C", "D", "E", "F", "G", "H", "I"]
    .map((c) => `${c}=${JSON.stringify(String(ws.getCell(`${c}${HANG_TIEU_DE}`).value ?? "").replace(/\n/g, "\\n"))}`)
    .join(" "),
);
console.log(
  "  be rong:",
  ["B", "C", "D", "E", "F", "G", "H", "I"].map((c) => `${c}=${rong(c) ?? "-"}`).join(" "),
);
