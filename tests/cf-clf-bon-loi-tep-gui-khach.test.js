/**
 * ============================================================================
 * BỐN LỖI CỦA TỆP GỬI KHÁCH — TẤT CẢ DO CHÍNH ĐỢT VÁ COLORFULL ĐẺ RA.
 *
 * Bốn ca dưới đây không phải phòng xa: mỗi ca tái hiện một thứ ĐO ĐƯỢC trên tệp do
 * `buildQuoteBuffer` xuất ra, trên cả ba mẫu CLF, sau đợt thêm cột Chi Tiết + đổi màu + bỏ logo
 * khách hàng. Ba mẫu GN đi kèm làm vế đối chứng: không cái nào trong bốn lỗi chạm tới GN.
 *
 * 1. TIỀN CỘNG ĐÔI KHI KHÁCH GỬI LẠI TỆP  (nặng nhất — sai SỐ TIỀN, không chỉ trình bày)
 *    Đổi màu nhóm CLF sang F6D479 / D5DDA2 trong `templateConfigs.ts` mà `excelImport.ts` vẫn
 *    dò theo hai màu cũ. Đường đi: khách mở tệp, gõ SỐ đè lên ô Đơn Giá của hàng NHÓM CON (phá
 *    `=SUM(...)`) rồi gửi lại. Bộ nhập không nhận ra màu nữa ⇒ xếp hàng đó thành HẠNG MỤC THẬT
 *    ⇒ đơn giá của nó (vốn là TỔNG các mục con) bị cộng LẦN THỨ HAI. App chỉ kêu "tổng lệch",
 *    không nói cấu trúc nhóm sai — nên người dùng đọc ra thành "khách sửa số".
 *    Nay hai tập màu SINH RA từ `TEMPLATE_CONFIGS` nên không lệch lại được.
 *
 * 2. KHỐI "KÍNH GỬI" IN RA CHỮ ĐỎ TƯƠI
 *    Ô C3 của hai tệp mẫu CLF vốn là chữ mồi "logo cty khách hàng", font FFFF0000. Bỏ tính năng
 *    logo thì `extraCellsToClear` dọn GIÁ TRỊ mà giữ STYLE, `headerMerges` nhân style đỏ ra cả
 *    dải C3:I3, rồi khối "Kính gửi" được ghi vào đúng ô ấy.
 *
 * 3. HÀNG "KÍNH GỬI" CAO KHÔNG ĐỦ → CẮT DÒNG EMAIL
 *    Mẫu khoá 67pt, mà `toBlockFormat` sinh 5 dòng nên cần khoảng 75pt. Cắt kể cả khi mọi trường
 *    ĐỀU NGẮN — tức không phải ca biên, mà là mọi báo giá.
 *
 * 4. GHI CHÚ NGƯỜI DÙNG BỊ NUỐT XUỐNG DÒNG VÀ BỊ CHE
 *    `clean()` gộp mọi xuống dòng thành dấu cách (đúng như chú thích của chính nó), nên ghi chú
 *    5 dòng có gạch đầu dòng ra tệp còn 2 dòng dính liền; và hàng bị mẫu khoá cứng 61pt.
 *
 * 5. DẢI "* THÔNG TIN CHƯƠNG TRÌNH" CŨNG BỊ CHE
 *    Cùng gốc với (3): ô gộp ngang B5:I5 nằm ngoài vòng đo chiều cao của hàng hạng mục. Đo: dòng
 *    thông tin 183 ký tự ngắt thành 2 dòng mà hàng chỉ 25pt ⇒ giấu mất dòng thứ hai.
 *
 * Bốn lỗi 2/3/4/5 đều là cùng MỘT lớp: "ô của mẫu được tái sử dụng làm ô dữ liệu mà không dọn
 * style và không đo lại chiều cao".
 * ============================================================================
 */
import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { buildQuoteBuffer } from "../src/excel.js";
import { parseQuoteWorkbook } from "../src/excelImport.js";

const CLF = ["clofull_decor", "clofull_banner", "clofull_conngay"];
const GN = ["marico_decor", "gn_banner", "unibenfood"];

const chu = (v) =>
  v && typeof v === "object"
    ? (Array.isArray(v.richText) ? v.richText.map((t) => t.text).join("")
      : v.formula ? "=" + v.formula : String(v.result ?? ""))
    : String(v ?? "");

/** Ghi chú NHIỀU DÒNG, đúng hình dạng thật người dùng gõ (gạch đầu dòng). */
const GHI_CHU = [
  "- Báo giá chưa gồm chi phí vận chuyển ngoài nội thành.",
  "- Thi công dự kiến 5 ngày kể từ ngày chốt.",
  "- Thanh toán 50% khi ký hợp đồng, 50% sau nghiệm thu.",
  "- Phát sinh ngoài hạng mục sẽ báo giá bổ sung bằng văn bản.",
].join("\n");

/** Báo giá có NHÓM + NHÓM CON — cấu trúc cần thiết để lộ lỗi cộng đôi. */
const baoGia = (templateCode) => ({
  quoteNumber: "CLF26070", projectCode: "FP_A26_002", title: "T",
  toCompany: "CÔNG TY TNHH ABC", toContact: "Mr. Tài", toEmail: "tai@abc.vn",
  toPhone: "0909123456", toAddress: "123 Đường X, P.Phú Thuận, TP.HCM",
  city: "TP. Hồ Chí Minh", quoteDate: new Date("2026-09-18"), vatPercent: 8,
  hnTables: [], notes: GHI_CHU,
  sheets: [{
    order: 1, name: "S", groupSubtotal: false, discount: 0, extraTables: [], templateCode,
    items: [
      { order: 1, kind: "section", name: "NHOM A", unit: "", quantity: 1, unitPrice: 0, notes: "" },
      { order: 2, kind: "item", name: "Muc 1", detail: ". PP in KTS", unit: "m2", quantity: 1, days: 1, unitPrice: 200_000, notes: "" },
      { order: 3, kind: "subsection", name: "Nhom con B1", unit: "", quantity: 1, unitPrice: 0, notes: "" },
      { order: 4, kind: "item", name: "Muc 2", detail: ". PP", unit: "m2", quantity: 1, days: 1, unitPrice: 200_000, notes: "" },
    ],
  }],
});

async function moFile(buf) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  return wb;
}

/** Quét cả sheet tìm ô ĐẦU TIÊN có chữ khớp `re`. Không đoán toạ độ: ba mẫu CLF khác nhau về số
 *  cột (bản có-ngày có thêm cột SỐ NGÀY) nên toạ độ đóng cứng sẽ trượt ở đúng một mẫu. */
function timO(ws, re) {
  for (let r = 1; r <= ws.rowCount; r++) {
    for (const L of ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K"]) {
      const o = ws.getCell(L + r);
      if (re.test(chu(o.value))) return o;
    }
  }
  return null;
}

describe("Colorfull — bốn lỗi của tệp gửi khách", () => {
  it("[1] khách gõ đè giá lên hàng NHÓM CON rồi gửi lại: cấu trúc và TIỀN vẫn đúng", async () => {
    // Đây là đường đi CHÍNH của tính năng nhập, không phải ca hiếm: khách nhận báo giá, sửa vài
    // con số trong Excel rồi gửi ngược lại. Gõ số vào ô Đơn Giá của hàng nhóm con là phá công
    // thức `=SUM(...)`, nên MÀU NỀN trở thành dấu hiệu duy nhất còn lại để nhận ra hàng nhóm.
    for (const ma of [...CLF, ...GN]) {
      const wb = await moFile(await buildQuoteBuffer(baoGia(ma)));
      const ws = wb.worksheets[0];
      const oCon = timO(ws, /^Nhom con B1$/);
      expect(oCon, `${ma}: không thấy hàng nhóm con trong tệp xuất`).toBeTruthy();
      const rCon = +oCon.address.replace(/^[A-Z]+/, "");
      // GN ghi tiêu đề là "ĐƠN GIÁ\n(VNĐ)" (có xuống dòng + đơn vị), CLF ghi gọn "ĐƠN GIÁ" —
      // nên khớp theo TIỀN TỐ, đừng đòi kết thúc ngay sau "GIÁ". Và KHÔNG dùng `\b`: trong regex
      // JS, `\b` định nghĩa qua `\w` = [A-Za-z0-9_] thuần ASCII, nên sau chữ "Á" KHÔNG hề có
      // ranh giới từ — `/GIÁ\b/` không khớp cả "ĐƠN GIÁ" lẫn "ĐƠN GIÁ (VNĐ)".
      const oTieuDeGia = timO(ws, /^\s*ĐƠN\s*GIÁ/i);
      expect(oTieuDeGia, `${ma}: không thấy cột Đơn Giá`).toBeTruthy();
      const cotGia = oTieuDeGia.address.replace(/\d+$/, "");

      ws.getCell(`${cotGia}${rCon}`).value = 400_000;   // khách gõ số đè, công thức biến mất
      const kq = await parseQuoteWorkbook(Buffer.from(await wb.xlsx.writeBuffer()));

      const mucs = kq.sheets?.[0]?.items || [];
      expect(mucs.map((i) => i.kind).join(","), `${ma}: hàng NHÓM CON bị nạp thành hạng mục thật`)
        .toBe("section,item,subsection,item");
      const tien = mucs.filter((i) => i.kind === "item")
        .reduce((s, i) => s + (Number(i.quantity) || 0) * (Number(i.unitPrice) || 0), 0);
      expect(tien, `${ma}: tiền nạp về bị cộng đôi đơn giá của hàng nhóm con`).toBe(400_000);
    }
  }, 300_000);

  it("[2] khối 'Kính gửi' KHÔNG in ra chữ đỏ — đó là màu của chữ mồi logo đã bỏ", async () => {
    for (const ma of CLF) {
      const ws = (await moFile(await buildQuoteBuffer(baoGia(ma)))).worksheets[0];
      const o = timO(ws, /^Kính gửi/);
      expect(o, `${ma}: không thấy khối Kính gửi`).toBeTruthy();
      expect(o.font?.color?.argb, `${ma}: khối Kính gửi vẫn mang màu chữ mồi "logo cty khách hàng"`)
        .not.toBe("FFFF0000");
    }
  }, 300_000);

  it("[3] hàng 'Kính gửi' đủ cao cho MỌI dòng — kể cả khi mọi trường đều ngắn", async () => {
    for (const ma of CLF) {
      const ws = (await moFile(await buildQuoteBuffer(baoGia(ma)))).worksheets[0];
      const o = timO(ws, /^Kính gửi/);
      const r = +o.address.replace(/^[A-Z]+/, "");
      const soDong = chu(o.value).split("\n").length;
      expect(soDong, `${ma}: khối Kính gửi phải nhiều dòng thì ca này mới có nghĩa`).toBeGreaterThan(1);
      expect(ws.getRow(r).height, `${ma}: hàng ${r} cao ${ws.getRow(r).height}pt cho ${soDong} dòng — CẮT chữ`)
        .toBeGreaterThanOrEqual(soDong * 15);
    }
  }, 300_000);

  it("[5] dải '* Thông tin chương trình' cũng đủ cao — cùng lớp lỗi với hàng Kính gửi", async () => {
    // Dải này là ô GỘP NGANG B5:I5, nằm ngoài vòng đo chiều cao của hàng hạng mục nên giữ nguyên
    // chiều cao nướng sẵn trong tệp mẫu. Đo: dòng thông tin 183 ký tự ngắt thành 2 dòng, mà hàng
    // chỉ 25pt ⇒ GIẤU MẤT DÒNG THỨ HAI. Nới theo chữ thì thành 33pt.
    const INFO = "Chương trình ra mắt sản phẩm mùa thu 2026 tại Trung tâm Hội nghị Quốc gia, "
      + "thi công từ 18/09 đến 22/09, bao gồm khu vực sảnh chính và hai khu trải nghiệm phụ";
    for (const ma of CLF) {
      const bg = baoGia(ma);
      bg.sheets[0].items.unshift({ order: 0, kind: "info", name: INFO, unit: "", quantity: 0, unitPrice: 0, notes: "" });
      const ws = (await moFile(await buildQuoteBuffer(bg))).worksheets[0];
      const o = timO(ws, /Thông tin chương trình/);
      expect(o, `${ma}: không thấy dải thông tin chương trình`).toBeTruthy();
      const r = +o.address.replace(/^[A-Z]+/, "");
      const row = ws.getRow(r);
      expect(row.hidden, `${ma}: dải CÓ nội dung mà vẫn bị ẩn`).toBeFalsy();
      // Bề rộng thật của dải = tổng bề rộng các cột nó phủ; đếm dòng theo lối ngắt-theo-TỪ.
      const vung = (ws.model?.merges || []).find((v) => v.startsWith(`${o.address}:`));
      expect(vung, `${ma}: dải thông tin không còn là ô gộp — phép đo bề rộng mất nghĩa`).toBeTruthy();
      const m = /^([A-Z])\d+:([A-Z])\d+$/.exec(vung);
      let beRong = 0;
      for (let i = m[1].charCodeAt(0); i <= m[2].charCodeAt(0); i++) beRong += ws.getColumn(String.fromCharCode(i)).width || 0;
      const perLine = Math.max(4, Math.floor(beRong - 1));
      let dong = 1, dai = 0;
      for (const tu of chu(o.value).split(/\s+/).filter(Boolean)) {
        const canThem = dai === 0 ? tu.length : dai + 1 + tu.length;
        if (canThem <= perLine) { dai = canThem; continue; }
        dong++; dai = tu.length;
      }
      expect(dong, `${ma}: dòng thông tin phải dài đủ để ngắt >1 dòng thì ca này mới có nghĩa`).toBeGreaterThan(1);
      expect(row.height, `${ma}: dải cao ${row.height}pt cho ${dong} dòng — giấu mất dòng cuối`)
        .toBeGreaterThanOrEqual(dong * 15);
    }
  }, 300_000);

  it("[4] ghi chú người dùng giữ ĐỦ dòng và hàng đủ cao", async () => {
    const canCo = GHI_CHU.split("\n").length + 1;   // cộng dòng nhãn "* Ghi chú:"
    for (const ma of CLF) {
      const ws = (await moFile(await buildQuoteBuffer(baoGia(ma)))).worksheets[0];
      const o = timO(ws, /^\* ?Ghi chú/i);
      expect(o, `${ma}: không thấy ô ghi chú`).toBeTruthy();
      const t = chu(o.value);
      expect(t.split("\n").length, `${ma}: xuống dòng người dùng gõ bị gộp thành dấu cách`).toBe(canCo);
      for (const dong of GHI_CHU.split("\n")) {
        expect(t, `${ma}: mất một dòng ghi chú`).toContain(dong);
      }
      const r = +o.address.replace(/^[A-Z]+/, "");
      expect(ws.getRow(r).height, `${ma}: hàng ghi chú bị khoá thấp — che mất phần cuối`)
        .toBeGreaterThanOrEqual(canCo * 15);
    }
  }, 300_000);
});
