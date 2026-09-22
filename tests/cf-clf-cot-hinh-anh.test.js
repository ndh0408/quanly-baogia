/**
 * ============================================================================
 * CỘT "HÌNH ẢNH" TRÊN MẪU COLORFULL — BA LỖI ĐO ĐƯỢC KHI BẬT `sheet.showImages`.
 *
 * Cột này có từ trước đợt Colorfull, nhưng chưa mẫu nào dùng `paintHeader: false` nên ba lỗi
 * dưới đây chỉ lộ ra khi Colorfull vào. Đo trên tệp do `buildQuoteBuffer` xuất ra:
 *
 *   1. HÀNG TIÊU ĐỀ HAI MÀU — B..I nền theme8/t0.4 (xanh ngọc nướng sẵn trong tệp mẫu) mà ô
 *      "HÌNH ẢNH" nền FFF3C9A1 (peach). Vòng tô header bỏ qua mẫu khai `paintHeader: false`,
 *      còn ô này thì tô vô điều kiện.
 *
 *   2. VẠCH DÀY CHẠY GIỮA BẢNG — khung ngoài lấy `cotCuoi = cols.notes`, không biết tới cột
 *      ảnh, nên cạnh phải 'medium' kẻ ở cột Ghi Chú trong khi cột ảnh nằm BÊN PHẢI nó.
 *      Đo được: hàng hạng mục có I[phải=medium] còn J là cột ảnh.
 *
 *   3. VIỀN LEM RA NGOÀI BẢNG — `icell.border = {...}` gán thẳng, mà ExcelJS gộp các style
 *      giống nhau thành MỘT đối tượng dùng chung. Đo trên mẫu CÓ NGÀY: cột L (sau cả cột ảnh
 *      K, tức ngoài bảng) mọc viền [trái mảnh | phải dày], kể cả ở hàng dải "* Thông tin
 *      chương trình" đang rỗng ⇒ ô rỗng có khung lơ lửng cạnh bảng.
 *
 * Ba mẫu GN đi kèm làm đối chứng: chúng bật `paintHeader` nên header vốn đã liền màu.
 *
 * ── LƯU Ý CHO NGƯỜI GỠ BẢN VÁ ĐỂ THỬ ────────────────────────────────────────────────────────
 * Lỗi (3) phụ thuộc vào THỨ TỰ, không chỉ vào phép gán. Khối gốc chạy theo lối
 *     value → alignment → border → paintCell
 * và `paintCell` nhân bản style, nên nó dọn dẹp SAU KHI viền đã kịp lem. Gỡ bản vá nửa vời — ví
 * dụ trả `icell.border` về gán thẳng nhưng để `paintCell` chạy trước — thì ba ca này VẪN XANH,
 * vì lúc ấy ô đã có style riêng, không còn dùng chung với ai. Muốn thấy lại lỗi thì phải dựng
 * đúng khối gốc cả về thứ tự; làm vậy thì cả ba ca đỏ, ca (3) báo `L4.top=medium` cùng 7 chỗ nữa
 * trên mẫu có-ngày. Đã đo đúng như thế trước khi chốt ba ca này.
 * ============================================================================
 */
import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { buildQuoteBuffer } from "../src/excel.js";

const CLF = ["clofull_decor", "clofull_banner", "clofull_conngay"];
const COT = ["B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M"];

const chu = (v) =>
  v && typeof v === "object"
    ? (Array.isArray(v.richText) ? v.richText.map((t) => t.text).join("")
      : v.formula ? "=" + v.formula : String(v.result ?? ""))
    : String(v ?? "");

/** Mã màu nền, gộp cả hai lối ExcelJS ghi màu (argb tường minh · theme + tint). */
const nen = (c) => {
  const f = c.fill;
  if (!f || f.type !== "pattern" || !f.fgColor) return "-";
  const g = f.fgColor;
  return g.argb ?? `theme${g.theme}/t${Math.round((g.tint || 0) * 100) / 100}`;
};
const net = (c, canh) => c.border?.[canh]?.style ?? "-";

const baoGia = (templateCode) => ({
  quoteNumber: "Q1", title: "T", toCompany: "ABC", city: "HCM",
  quoteDate: new Date("2026-09-18"), vatPercent: 8, hnTables: [],
  sheets: [{
    order: 1, name: "S", groupSubtotal: false, discount: 0, extraTables: [],
    templateCode, showImages: true,
    items: [
      { order: 1, kind: "section", name: "NHOM A", unit: "", quantity: 1, unitPrice: 0, notes: "" },
      { order: 2, kind: "item", name: "Muc 1", detail: ". PP", unit: "m2", quantity: 1, days: 1, unitPrice: 200_000, notes: "" },
      { order: 3, kind: "item", name: "Muc 2", detail: ". PP", unit: "m2", quantity: 1, days: 1, unitPrice: 200_000, notes: "" },
    ],
  }],
});

async function moSheet(ma) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await buildQuoteBuffer(baoGia(ma)));
  return wb.worksheets[0];
}

/** Hàng tiêu đề + chữ cột của ô "HÌNH ẢNH" + chữ cột ngay TRƯỚC nó. */
function doBang(ws) {
  let hd = null;
  for (let r = 1; r <= ws.rowCount && hd == null; r++) {
    for (const L of ["A", "B", "C"]) {
      if (chu(ws.getCell(L + r).value).trim().toUpperCase() === "STT") { hd = r; break; }
    }
  }
  if (!hd) throw new Error("không thấy hàng tiêu đề (STT)");
  const iAnh = COT.findIndex((L) => chu(ws.getCell(L + hd).value).trim().toUpperCase() === "HÌNH ẢNH");
  if (iAnh < 1) throw new Error("không thấy cột HÌNH ẢNH — mẫu không bật showImages?");
  return { hd, cotAnh: COT[iAnh], cotTruoc: COT[iAnh - 1], iAnh };
}

describe("Colorfull — cột HÌNH ẢNH", () => {
  it("hàng tiêu đề LIỀN MỘT MÀU: ô 'HÌNH ẢNH' cùng nền với các cột còn lại", async () => {
    for (const ma of CLF) {
      const ws = await moSheet(ma);
      const { hd, cotAnh, iAnh } = doBang(ws);
      const nenChuan = nen(ws.getCell(`${COT[0]}${hd}`));
      expect(nenChuan, `${ma}: ô STT không có nền thì phép so này vô nghĩa`).not.toBe("-");
      // Mọi cột của bảng, KỂ CẢ cột ảnh, phải cùng một nền.
      for (let i = 0; i <= iAnh; i++) {
        expect(nen(ws.getCell(`${COT[i]}${hd}`)), `${ma}: ô tiêu đề ${COT[i]}${hd} lệch nền so với ${COT[0]}${hd}`)
          .toBe(nenChuan);
      }
      expect(nen(ws.getCell(`${cotAnh}${hd}`)), `${ma}: ô HÌNH ẢNH bị tô peach trong khi mẫu giữ nền nướng sẵn`)
        .toBe(nenChuan);
    }
  }, 300_000);

  it("KHÔNG có vạch dày chạy giữa bảng: cạnh phải 'medium' chỉ ở cột ảnh", async () => {
    for (const ma of CLF) {
      const ws = await moSheet(ma);
      const { hd, cotAnh, cotTruoc } = doBang(ws);
      // Hàng hạng mục đầu tiên sau tiêu đề mà có ĐVT (bỏ qua dải banner gộp ngang).
      let rMuc = null;
      for (let r = hd + 1; r <= hd + 6 && rMuc == null; r++) {
        const o = ws.getCell(`E${r}`);
        const laOThat = !o.isMerged || o.master?.address === o.address;
        if (laOThat && chu(o.value).trim()) rMuc = r;
      }
      expect(rMuc, `${ma}: không tìm được hàng hạng mục`).toBeTruthy();
      for (const r of [hd, rMuc]) {
        expect(net(ws.getCell(`${cotTruoc}${r}`), "right"), `${ma}: r${r} còn vạch DÀY giữa bảng ở ${cotTruoc} (cột ảnh nằm bên phải nó)`)
          .not.toBe("medium");
        expect(net(ws.getCell(`${cotAnh}${r}`), "right"), `${ma}: r${r} cạnh phải bảng (cột ảnh) không dày`)
          .toBe("medium");
      }
    }
  }, 300_000);

  it("viền KHÔNG lem sang cột nằm ngoài bảng", async () => {
    for (const ma of CLF) {
      const ws = await moSheet(ma);
      const { cotAnh, iAnh } = doBang(ws);
      const ngoai = COT.slice(iAnh + 1, iAnh + 3);   // hai cột ngay sau cột ảnh
      const lem = [];
      ws.eachRow({ includeEmpty: false }, (row, r) => {
        for (const L of ngoai) {
          const c = ws.getCell(`${L}${r}`);
          for (const canh of ["top", "left", "bottom", "right"]) {
            if (net(c, canh) !== "-") lem.push(`${L}${r}.${canh}=${net(c, canh)}`);
          }
        }
      });
      expect(lem, `${ma}: viền của cột ảnh ${cotAnh} LEM sang cột ngoài bảng (${ngoai.join(",")})`).toEqual([]);
    }
  }, 300_000);
});
