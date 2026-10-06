/**
 * ============================================================================
 * KHỐI "KÍNH GỬI" CỦA COLORFULL GỘP LIỀN TỪ CỘT STT (B) TỚI HẾT BỀ NGANG BẢNG.
 *
 * ── LỖI (chủ repo chụp tệp Colorfull xuất ra từ dev: "nó chưa gộp ô nằm ngang nữa") ─────────────
 * Dải tiêu đề xanh phía trên (B2:I2) và dải thông tin chương trình (B5:I5) đều gộp TỪ CỘT STT,
 * nhưng khối "Kính gửi" ở giữa chúng chỉ gộp từ cột Hạng Mục (C3:I3). Ô B3 bên trái nó là MỘT Ô
 * TRỐNG RIÊNG, tách khỏi khối — nhìn trong Excel thấy ngay một ô lẻ ở đầu hàng, và chữ canh giữa
 * của khối lệch 3,5 đơn vị cột sang phải so với tiêu đề ngay trên.
 *
 * Gốc: mẫu gốc (CLF_KhongNgay.xlsx / CLF_CoNgay.xlsx) để B3 trống, C3 là chữ mồi "logo cty khách
 * hàng" và F3:I3 (bản có ngày F3:J3) là khối người gửi cũ. Khi bỏ tính năng logo khách hàng, khối
 * "Kính gửi" được đặt vào C3 và `headerMerges` gộp C3:I3 — B3 bị bỏ sót.
 *
 * ── SỬA ─────────────────────────────────────────────────────────────────────────────────────────
 * Cả ba mẫu Colorfull: ô chủ B3, vùng gộp B3:I3 (bản có ngày B3:J3). Chữ mồi ở C3 vẫn phải mất.
 * Ba mẫu GN không khai `headerMerges` / `toBlockCell` nên không đổi.
 *
 * Hai lớp chắn chốt thêm sau vòng soát: (1) chữ mồi ở C3 mất nhờ `extraCellsToClear` của TỪNG mẫu, không
 * nhờ vùng gộp — bản có ngày khai lại danh sách đó và từng sót "C3"; (2) bề rộng mà phép đo chiều cao
 * hàng 3 dùng bị kẹp từ HAI phía: không hẹp như vùng cũ C..cuối (hàng thừa một dòng), không rộng hơn vùng
 * thật (hàng thiếu một dòng — lệch đủ lớn là Excel xén dòng mã).
 *
 * Bài này đọc TỆP XUẤT THẬT (ExcelJS) chứ không đọc cấu hình: cơ chế gộp + làm phẳng style của
 * ExcelJS (`mergeCells` chép style ô chủ sang mọi ô phụ) chỉ kiểm được trên tệp.
 * ============================================================================
 */
import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { fileURLToPath } from "node:url";
import { buildQuoteBuffer, soDongKhiXuongHang } from "../src/excel.js";
import { getConfig, TEMPLATE_CONFIGS } from "../src/templateConfigs.js";
import { parseQuoteWorkbook } from "../src/excelImport.js";

/** mẫu → cột CUỐI của bảng (mẫu có ngày có thêm cột SỐ NGÀY nên dài hơn một cột). */
const CLF = { clofull_decor: "I", clofull_banner: "I", clofull_conngay: "J" };
const GN = ["marico_decor", "gn_banner", "unibenfood"];
const COT = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"];

const chu = (v) =>
  v && typeof v === "object"
    ? (Array.isArray(v.richText) ? v.richText.map((t) => t.text).join("")
      : v.formula ? "=" + v.formula : String(v.result ?? ""))
    : String(v ?? "");

/** Báo giá đủ thứ: khối "Kính gửi" đủ 5 dòng người nhận + dòng mã, dải thông tin chương trình, nhóm, nhóm con. */
const baoGia = (templateCode, { showImages = false, over = {} } = {}) => ({
  quoteNumber: "CLF26072", projectCode: "FP_A26_006", title: "Kiểm tra gộp ô nằm ngang",
  toCompany: "CÔNG TY TNHH COLORFULL VIỆT NAM", toContact: "Mr. Tài", toEmail: "tai.nguyen@colorfull.vn",
  toPhone: "0909 123 456", toAddress: "128 Nguyễn Văn Trỗi, P.8, Q.Phú Nhuận, TP.HCM",
  fromContact: "Lan Anh", fromTitle: "Account Manager", fromPhone: "0938 227 519", fromAddress: "34 Đào Trí, P.Phú Thuận, TP.HCM",
  city: "TP. Hồ Chí Minh", quoteDate: new Date("2026-09-30"), vatPercent: 8, hnTables: [],
  sheets: [{
    order: 1, name: "Sảnh chính", groupSubtotal: false, discount: 0, extraTables: [], templateCode, showImages,
    items: [
      { order: 1, kind: "info", name: "Chương trình ra mắt sản phẩm mùa thu 2026", unit: "", quantity: 0, unitPrice: 0, notes: "" },
      { order: 2, kind: "section", name: "KHU VỰC SẢNH ĐÓN KHÁCH", unit: "", quantity: 1, unitPrice: 0, notes: "" },
      { order: 3, kind: "item", name: "Backdrop sân khấu chính", detail: ". KT: 14mW x 5mH", unit: "m2", quantity: 70, days: 2, unitPrice: 385_000, notes: "" },
      { order: 4, kind: "subsection", name: "Hạng mục trang trí phụ trợ", unit: "", quantity: 1, unitPrice: 0, notes: "" },
      { order: 5, kind: "item", name: "Bàn check-in", detail: ". Phủ decal in KTS", unit: "cái", quantity: 6, days: 2, unitPrice: 450_000, notes: "" },
    ],
  }],
  ...over,
});

async function moFile(buf) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  return wb.worksheets[0];
}
const xuat = async (ma, opt) => moFile(await buildQuoteBuffer(baoGia(ma, opt)));

/** Ô CHỦ của `addr` (chính nó nếu không nằm trong vùng gộp). */
const oChu = (ws, addr) => {
  const c = ws.getCell(addr);
  return c.isMerged && c.master ? c.master.address : c.address;
};
/** Vùng gộp của tệp bắt đầu ở hàng `r` (mọi vùng có đỉnh ở hàng đó). */
const gopHang = (ws, r) => (ws.model.merges || []).filter((m) => new RegExp(`^[A-Z]+${r}:`).test(m));
const cotCuaVung = (v) => { const m = /^([A-Z]+)\d+:([A-Z]+)\d+$/.exec(v); return [m[1], m[2]]; };
/** Mọi chữ cái cột từ `a` tới `b` (một chữ cái, đủ cho B…K). */
const dai = (a, b) => COT.slice(COT.indexOf(a), COT.indexOf(b) + 1);
/** Tổng bề rộng (đơn vị cột) các cột `a`..`b` của tệp xuất. */
const rongHai = (ws, a, z) => dai(a, z).reduce((s, L) => s + ws.getColumn(L).width, 0);
const net = (c, canh) => c.border?.[canh]?.style ?? "-";

describe("Colorfull — khối 'Kính gửi' gộp liền từ cột STT", () => {
  for (const [ma, cuoi] of Object.entries(CLF)) {
    it(`${ma}: vùng gộp B3:${cuoi}3, KHÔNG còn C3:${cuoi}3`, async () => {
      const ws = await xuat(ma);
      const hang3 = gopHang(ws, 3);
      expect(hang3, `${ma}: hàng 3 phải có ĐÚNG MỘT vùng gộp, phủ từ STT tới hết bảng`).toEqual([`B3:${cuoi}3`]);
      expect(ws.model.merges, `${ma}: vùng gộp cũ C3:${cuoi}3 còn sót`).not.toContain(`C3:${cuoi}3`);
      expect(ws.model.merges.filter((m) => m.startsWith("C3:")), `${ma}: còn vùng gộp bắt đầu ở C3`).toEqual([]);
    }, 300_000);

    it(`${ma}: ô chủ B3 giữ chuỗi khối; mọi ô B..${cuoi} thuộc về B3; ô ngoài dải KHÔNG bị hút vào`, async () => {
      const ws = await xuat(ma);
      const b3 = ws.getCell("B3");
      expect(b3.isMerged && b3.master.address, `${ma}: B3 phải là ô chủ`).toBe("B3");
      expect(typeof b3.value, "khối Kính gửi phải là chuỗi thường").toBe("string");
      const dong = b3.value.split("\n");
      expect(dong[0]).toBe("Kính gửi: CÔNG TY TNHH COLORFULL VIỆT NAM");
      expect(dong).toHaveLength(6);   // 5 dòng người nhận + dòng mã
      expect(dong.at(-1)).toBe("(Số://FP_A26_006)");
      for (const L of dai("B", cuoi)) expect(oChu(ws, `${L}3`), `${ma}: ${L}3 không thuộc khối`).toBe("B3");
      // Cột A (lề trái) và cột sau cột cuối của bảng nằm NGOÀI khối.
      expect(oChu(ws, "A3")).toBe("A3");
      const sau = COT[COT.indexOf(cuoi) + 1];
      expect(oChu(ws, `${sau}3`), `${ma}: khối tràn ra ngoài bảng`).toBe(`${sau}3`);
    }, 300_000);

    it(`${ma}: chữ mồi "logo cty khách hàng" ở C3 biến mất — cả hàng 3 chỉ còn đúng MỘT chuỗi`, async () => {
      const ws = await xuat(ma);
      const chuoi = [];
      for (const L of COT) { const c = ws.getCell(`${L}3`); if (chu(c.value).trim() && (!c.isMerged || c.master === c)) chuoi.push(`${L}3`); }
      expect(chuoi, `${ma}: hàng 3 còn ô có chữ ngoài khối`).toEqual(["B3"]);
      let mo = 0;
      ws.eachRow({ includeEmpty: false }, (row) => row.eachCell({ includeEmpty: false }, (c) => { if (/logo cty/i.test(chu(c.value))) mo++; }));
      expect(mo, `${ma}: chữ mồi vẫn nằm đâu đó trong tệp`).toBe(0);
      // C3 bây giờ là ô PHỤ: nó đọc ra chuỗi của B3 (ExcelJS), không phải chữ mồi.
      expect(chu(ws.getCell("C3").value)).toBe(chu(ws.getCell("B3").value));
    }, 300_000);

    it(`${ma}: vùng gộp không áp được thì chữ mồi ở C3 vẫn KHÔNG sống lại — xoá tường minh, không nhờ vùng gộp`, async () => {
      // C3 nay là ô PHỤ của B3:${cuoi}3 nên vùng gộp nuốt mất chữ mồi. Nhưng `safeMerge` nuốt lỗi, và ai đó có
      // thể gỡ `headerMerges` — lớp chắn thật phải là `cleanup.extraCellsToClear`. Bản có ngày KHAI LẠI danh
      // sách đó (K5/K8/H22) và từng sót "C3": gỡ vùng gộp là tệp có ngày in lại dòng chữ ĐỎ cạnh khối,
      // trong khi hai bản không-ngày vẫn sạch.
      const cfg = getConfig(ma);
      // Tiền đề: tệp mẫu THẬT SỰ mang chữ mồi ở C3 — không thì bài này đúng một cách vô nghĩa.
      const mau = new ExcelJS.Workbook();
      await mau.xlsx.readFile(fileURLToPath(new URL(`../${cfg.filePath}`, import.meta.url)));
      expect(chu(mau.worksheets[0].getCell("C3").value), `${ma}: tệp mẫu không còn chữ mồi ở C3`).toMatch(/logo cty/i);
      // Mã mẫu tạm = chính mẫu này nhưng KHÔNG gộp đầu trang; mở đầu "clofull" như mọi mẫu Colorfull. Gỡ trong `finally`.
      const tam = `${ma}_thu_khong_gop`;
      TEMPLATE_CONFIGS[tam] = { ...cfg, headerMerges: [] };
      try {
        const buf = await buildQuoteBuffer(baoGia(tam));
        const ws = await moFile(buf);
        expect(ws.model.merges, "tiền đề: khối Kính gửi phải KHÔNG được gộp").not.toContain(`B3:${cuoi}3`);
        expect(chu(ws.getCell("B3").value).startsWith("Kính gửi:"), "khối vẫn ghi vào B3").toBe(true);
        expect(ws.getCell("C3").value ?? null, `${ma}: C3 còn giữ chữ của tệp mẫu khi không gộp`).toBeNull();
        // Soi XML THÔ, không qua ExcelJS: chuỗi nằm trong gói là Excel đọc được.
        const zip = await JSZip.loadAsync(buf);
        const noi = [];
        for (const [ten, tep] of Object.entries(zip.files)) {
          if (!tep.dir && ten.endsWith(".xml") && /logo cty/i.test(await tep.async("string"))) noi.push(ten);
        }
        expect(noi, `${ma}: chữ mồi "logo cty khách hàng" sống lại trong tệp`).toEqual([]);
      } finally {
        delete TEMPLATE_CONFIGS[tam];
      }
    }, 300_000);

    it(`${ma}: liền một mảng — mọi ô B..${cuoi} cùng kiểu, canh giữa, chữ không đỏ, không viền dọc ở ranh giới B|C`, async () => {
      const ws = await xuat(ma);
      const kieu = (c) => JSON.stringify([c.font, c.alignment, c.border, c.fill]);
      const chuan = kieu(ws.getCell("B3"));
      for (const L of dai("B", cuoi)) {
        const c = ws.getCell(`${L}3`);
        expect(kieu(c), `${ma}: ${L}3 khác kiểu B3 — khối không liền một mảng`).toBe(chuan);
        expect(c.alignment?.horizontal, `${ma}: ${L}3 không canh giữa`).toBe("center");
        expect(c.alignment?.vertical, `${ma}: ${L}3 không canh giữa dọc`).toBe("middle");
        expect(c.alignment?.wrapText, `${ma}: ${L}3 không xuống dòng`).toBe(true);
        expect(c.font?.color?.argb, `${ma}: ${L}3 mang chữ đỏ của ô mồi`).not.toBe("FFFF0000");
      }
      // Ranh giới B|C nằm TRONG khối: không được có nét dọc nào chen vào.
      expect(net(ws.getCell("B3"), "right"), `${ma}: viền dọc thừa ở cạnh phải B3`).toBe("-");
      expect(net(ws.getCell("C3"), "left"), `${ma}: viền dọc thừa ở cạnh trái C3`).toBe("-");
      // Hai mép của khối cùng kiểu với hai mép dải tiêu đề B2 (không viền, không nền lạ ở B3 / cột cuối).
      expect(net(ws.getCell("B3"), "left")).toBe(net(ws.getCell("B2"), "left"));
      expect(net(ws.getCell(`${cuoi}3`), "right")).toBe(net(ws.getCell(`${cuoi}2`), "right"));
      expect(ws.getCell("B3").fill?.fgColor ?? null, `${ma}: B3 có nền riêng`).toEqual(ws.getCell("C3").fill?.fgColor ?? null);
    }, 300_000);

    it(`${ma}: hai mép của khối trùng hai mép dải tiêu đề B2 và dải thông tin B5`, async () => {
      const ws = await xuat(ma);
      const [t1, t2] = cotCuaVung(gopHang(ws, 2)[0]);
      const [i1, i2] = cotCuaVung(gopHang(ws, 5)[0]);
      const [k1, k2] = cotCuaVung(gopHang(ws, 3)[0]);
      expect([k1, k2], `${ma}: khối Kính gửi lệch mép so với dải tiêu đề`).toEqual([t1, t2]);
      expect([k1, k2], `${ma}: khối Kính gửi lệch mép so với dải thông tin chương trình`).toEqual([i1, i2]);
      expect(k1, "khối phải bắt đầu ở cột STT").toBe("B");
    }, 300_000);

    it(`${ma}: bật cột HÌNH ẢNH thì khối kéo dài sang cột ấy, vẫn bắt đầu ở B`, async () => {
      const ws = await xuat(ma, { showImages: true });
      const sau = COT[COT.indexOf(cuoi) + 1];
      expect(gopHang(ws, 3), `${ma}: khối Kính gửi phải phủ cả cột hình ảnh`).toEqual([`B3:${sau}3`]);
      expect(gopHang(ws, 2)).toEqual([`B2:${sau}2`]);
      expect(oChu(ws, `${sau}3`)).toBe("B3");
      expect(chu(ws.getCell("B3").value).startsWith("Kính gửi:")).toBe(true);
    }, 300_000);

    it(`${ma}: hàng 3 đủ cao cho 5 dòng người nhận + dòng mã — số dòng đo theo bề rộng THẬT của B..${cuoi}`, async () => {
      // Sáu dòng ở đây đều xuống hàng TƯỜNG MINH, không dòng nào tự ngắt, nên bề rộng nào ≥ B..cuối cũng ra
      // sáu dòng: bài này chỉ chốt mức sàn. Bề rộng mà phép đo dùng được kẹp ở hai bài ca biên bên dưới.
      const ws = await xuat(ma);
      const b3 = ws.getCell("B3");
      expect(b3.font?.size).toBe(12);
      const [a, z] = cotCuaVung(gopHang(ws, 3)[0]);
      let rong = 0;
      for (const L of dai(a, z)) rong += ws.getColumn(L).width;
      const soDong = soDongKhiXuongHang(b3.value, rong, { dam: !!b3.font.bold, co: 12 });
      expect(soDong, `${ma}: 5 dòng người nhận + mã thì ít nhất 6 dòng`).toBeGreaterThanOrEqual(6);
      expect(ws.getRow(3).height, `${ma}: hàng 3 cao ${ws.getRow(3).height}pt cho ${soDong} dòng — CẮT chữ`)
        .toBeGreaterThanOrEqual(soDong * 15.75);
      expect(ws.getRow(3).height).toBeGreaterThanOrEqual(94.5);
    }, 300_000);

    it(`${ma}: phép đo chiều cao dùng bề rộng B..${cuoi}, không dùng bề rộng C..${cuoi} của vùng gộp cũ`, async () => {
      // Dựng một địa chỉ mà cùng một dòng chữ NGẮT HAI DÒNG ở C..cuối nhưng VỪA MỘT DÒNG ở B..cuối.
      // Nếu phép đo còn tính bề rộng vùng cũ thì hàng 3 cao thừa đúng một dòng (15,75pt).
      const mau = await xuat(ma);
      const rongBI = rongHai(mau, "B", cuoi), rongCI = rongHai(mau, "C", cuoi);
      const f = { dam: false, co: 12 };
      let diaChi = null;
      for (let n = 10; n < 120 && !diaChi; n++) {
        const thu = `Đ/c: ${"Nguyễn ".repeat(n).trim()}`;
        if (soDongKhiXuongHang(thu, rongCI, f) > soDongKhiXuongHang(thu, rongBI, f)) diaChi = thu.slice(5);
      }
      expect(diaChi, "không dựng được ca biên giữa hai bề rộng — hiệu chuẩn ước lượng đã đổi?").toBeTruthy();
      const ws = await xuat(ma, { over: { toAddress: diaChi } });
      const text = ws.getCell("B3").value;
      const dungBI = soDongKhiXuongHang(text, rongBI, f), sai = soDongKhiXuongHang(text, rongCI, f);
      expect(sai, "ca biên phải phân biệt được hai bề rộng").toBeGreaterThan(dungBI);
      expect(ws.getRow(3).height, `${ma}: hàng 3 cao theo bề rộng vùng gộp CŨ (${sai} dòng) thay vì ${dungBI} dòng`)
        .toBeCloseTo(dungBI * 15.75 + 3, 2);
    }, 300_000);

    it(`${ma}: phép đo chiều cao cũng KHÔNG dùng bề rộng LỚN hơn B..${cuoi} — dòng Đ/c vừa tràn sang dòng 2 vẫn được tính`, async () => {
      // Ca biên ĐỐI XỨNG với bài trên. Bài trên chỉ bắt phép đo HẸP hơn vùng gộp — hàng cao thừa một dòng.
      // Chiều ngược lại mới xén chữ: đo theo bề rộng LỚN hơn vùng thật (cộng nhầm một cột, nhân hệ số…)
      // thì số dòng ước ra ÍT đi và hàng 3 thấp hơn chữ. Đo Excel COM: lệch ×1,5 với Đ/c "Nguyễn" ×22 là
      // Excel xén cả nửa trên dòng "Kính gửi" lẫn dòng mã "(Số://…)"; lệch ×1,1 chưa xén trên máy đo nhưng
      // đã ăn hết biên an toàn 5% của bộ ước lượng — biên dành cho máy khác DPI / bản Excel khác.
      // Dựng dòng Đ/c NGẮT HAI DÒNG ở đúng B..cuối nhưng VỪA MỘT DÒNG khi chỉ rộng thêm MỘT đơn vị cột (7px):
      // "Nguyễn" ×n rồi đệm một từ toàn chữ 'i' — ký tự hẹp nhất bảng đo (3px) — để đặt chuỗi sát ngưỡng.
      const mau = await xuat(ma);
      const rongBI = rongHai(mau, "B", cuoi);
      const f = { dam: !!mau.getCell("B3").font?.bold, co: 12 };
      let diaChi = null;
      for (let n = 1; n < 60 && !diaChi; n++) {
        for (let k = 0; k <= 20 && !diaChi; k++) {
          const thu = `Đ/c: ${"Nguyễn ".repeat(n)}${"i".repeat(k)}`.trim();
          if (soDongKhiXuongHang(thu, rongBI, f) === 2 && soDongKhiXuongHang(thu, rongBI + 1, f) === 1) diaChi = thu.slice(5);
        }
      }
      expect(diaChi, "không dựng được ca biên sát ngưỡng — hiệu chuẩn ước lượng đã đổi?").toBeTruthy();
      const ws = await xuat(ma, { over: { toAddress: diaChi } });
      const text = ws.getCell("B3").value;
      const dung = soDongKhiXuongHang(text, rongBI, f);
      expect(dung, "5 dòng người nhận (dòng Đ/c ngắt làm hai) + dòng mã").toBe(7);
      // Ca biên có răng: rộng thêm một đơn vị cột (≈0,7%) là ước lượng đã hụt một dòng — nên phép đo nào
      // rộng hơn vùng gộp thật (×1,1 · ×1,5 · cộng thêm cột A…) cũng làm hàng 3 thấp đi đúng 15,75pt.
      expect(soDongKhiXuongHang(text, rongBI + 1, f), "ca biên phải phân biệt được hai bề rộng").toBe(dung - 1);
      expect(ws.getRow(3).height, `${ma}: hàng 3 đo theo bề rộng LỚN hơn B..${cuoi} — thiếu một dòng, xén dòng mã`)
        .toBeCloseTo(dung * 15.75 + 3, 2);   // 7 × 15,75 + 3 = 113,25pt
    }, 300_000);

    it(`${ma}: cấu hình nhất quán — ô chủ của khối chính là đỉnh vùng gộp đầu trang phủ hàng 3`, () => {
      const cfg = getConfig(ma);
      expect(cfg.cells.toBlockCell).toBe("B3");
      const vung = cfg.headerMerges.filter((m) => m.startsWith(`${cfg.cells.toBlockCell}:`));
      // Lệch nhau thì `src/excel.ts` không tìm được vùng để trải style ra ô phụ ⇒ chữ đỏ của ô mồi nằm lại trong tệp.
      expect(vung).toEqual([`B3:${CLF[ma]}3`]);
    });
  }
});

describe("Colorfull — nhập lại tệp vừa xuất (khối Kính gửi không lẫn vào dữ liệu)", () => {
  for (const ma of Object.keys(CLF)) {
    it(`${ma}: hạng mục / số lượng / đơn giá / nhóm nguyên vẹn, không có chữ của khối Kính gửi hay dòng mã`, async () => {
      const buf = await buildQuoteBuffer(baoGia(ma));
      const kq = await parseQuoteWorkbook(buf);
      const s = kq.sheets.find((x) => !x.skipped);
      expect(s, `${ma}: không nhập được sheet nào`).toBeTruthy();
      const cauTruc = s.items.map((i) => `${i.kind}:${i.name}`);
      expect(cauTruc).toEqual([
        "info:Chương trình ra mắt sản phẩm mùa thu 2026",
        "section:KHU VỰC SẢNH ĐÓN KHÁCH",
        "item:Backdrop sân khấu chính",
        "subsection:Hạng mục trang trí phụ trợ",
        "item:Bàn check-in",
      ]);
      const backdrop = s.items.find((i) => i.name === "Backdrop sân khấu chính");
      const ban = s.items.find((i) => i.name === "Bàn check-in");
      expect([Number(backdrop.quantity), Number(backdrop.unitPrice)]).toEqual([70, 385_000]);
      expect([Number(ban.quantity), Number(ban.unitPrice)]).toEqual([6, 450_000]);
      if (ma === "clofull_conngay") expect([Number(backdrop.days), Number(ban.days)]).toEqual([2, 2]);
      for (const i of s.items) {
        for (const k of ["name", "detail", "notes", "unit"]) {
          expect(String(i[k] ?? ""), `${ma}: ${k} của "${i.name}" lẫn chữ của khối Kính gửi`)
            .not.toMatch(/Kính gửi|Số:\/\/|logo cty|Đ\/c:|Email:/);
        }
      }
    }, 300_000);
  }
});

describe("Ba mẫu GN — không đổi", () => {
  for (const ma of GN) {
    it(`${ma}: không khai headerMerges / toBlockCell; hàng 3 giữ nguyên vùng gộp của tệp mẫu`, async () => {
      const cfg = getConfig(ma);
      expect(cfg.headerMerges, `${ma}: GN không được có headerMerges`).toBeUndefined();
      expect(cfg.cells.toBlockCell, `${ma}: GN không được có toBlockCell`).toBeUndefined();
      const mau = new ExcelJS.Workbook();
      await mau.xlsx.readFile(fileURLToPath(new URL(`../${cfg.filePath}`, import.meta.url)));
      const goc = gopHang(mau.worksheets[0], 3);
      const ws = await xuat(ma);
      expect(gopHang(ws, 3), `${ma}: vùng gộp hàng 3 của GN đã đổi`).toEqual(goc);
      expect(ws.model.merges.filter((m) => /^B3:|^C3:/.test(m)), `${ma}: GN không được có vùng gộp B3 / C3`).toEqual([]);
    }, 300_000);
  }
});
