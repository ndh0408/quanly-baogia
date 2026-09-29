/**
 * So sánh phiên bản (diffVersions) KHÔNG báo đổi giả vì ba cột bảng nội bộ NS · Lưu kho · Chứng từ.
 *
 * Từ 4e24308, sanitizeExtraTables / sanitizeHnTables ghi `ns: null, luuKho: false, chungTu: null` vào MỌI
 * hàng của bảng nội bộ. Ảnh chụp phiên bản lưu TRƯỚC đợt đó không có ba khoá, nên lần so đầu tiên qua mốc
 * báo "sheets" và "hnTables" đã đổi dù không ai đụng vào — `khongCoHayRong` chỉ gộp vắng mặt ≡ rỗng ở cấp
 * khoá ngoài cùng, còn ba khoá này nằm tận `sheets[].extraTables[].items[]` / `hnTables[].items[]`.
 * Luật chốt: vắng mặt ≡ giá trị mặc định ở mọi hàng của bảng nội bộ; thay đổi THẬT vẫn phải báo.
 */
import { describe, it, expect } from "vitest";
import { diffVersions } from "../src/quoteVersion.js";

const hang = (o = {}) => ({ kind: "item", name: "Thuê xe", unit: "chuyến", quantity: "1", unitPrice: "500000", days: null, notes: null, rid: "r1", ...o });
const MAC_DINH = { ns: null, luuKho: false, chungTu: null };

/** Ảnh chụp phiên bản tối giản: một trang có bảng HCM + bảng HN cấp báo giá (đúng hình dạng snapshotQuoteVersion). */
const phienBan = ({ hcm = hang(), hn = hang({ rid: "h1", name: "Nhân công HN" }), them = {} } = {}) => ({
  quoteNumber: "GN26001",
  total: "1000000",
  hnTables: [{ name: "HN", templateId: 1, groupSubtotal: false, items: [hn] }],
  sheets: [{
    templateCode: "gn", name: "Trang 1", order: 1, discount: "0",
    extraTables: [{ category: "hcm", name: "HCM", items: [{ kind: "section", name: "NHÓM A" }, hcm] }],
    items: [{ order: 1, kind: "item", name: "Màn LED", quantity: "1", unitPrice: "1000000" }],
  }],
  ...them,
});

describe("diffVersions — ba cột bảng nội bộ: vắng mặt ≡ mặc định", () => {
  it("ảnh chụp TRƯỚC đợt (không có ba khoá) so với SAU đợt (ns null · luuKho false · chungTu null): không có thay đổi", () => {
    const truoc = phienBan();
    const sau = phienBan({ hcm: hang(MAC_DINH), hn: hang({ rid: "h1", name: "Nhân công HN", ...MAC_DINH }) });
    expect(diffVersions(truoc, sau), "báo đổi giả — không ai sửa gì").toEqual([]);
    expect(diffVersions(sau, truoc)).toEqual([]);
  });

  it("hàng NHÓM cũng được sanitize thêm ba khoá — vẫn không báo đổi", () => {
    const truoc = phienBan();
    const sau = phienBan();
    sau.sheets[0].extraTables[0].items[0] = { ...sau.sheets[0].extraTables[0].items[0], ...MAC_DINH };
    expect(diffVersions(truoc, sau)).toEqual([]);
  });

  it("thay đổi THẬT vẫn báo — bảng theo trang: tích Lưu kho, chọn chứng từ, gõ NS", () => {
    const truoc = phienBan();
    for (const doi of [{ luuKho: true }, { chungTu: "VAT" }, { ns: "Anh Tuấn" }]) {
      const d = diffVersions(truoc, phienBan({ hcm: hang({ ...MAC_DINH, ...doi }) }));
      expect(d.map((x) => x.key), JSON.stringify(doi)).toEqual(["sheets"]);
    }
  });

  it("thay đổi THẬT vẫn báo — bảng Hà Nội: bỏ lưu kho, xoá chứng từ, đổi NS", () => {
    const co = hang({ rid: "h1", name: "Nhân công HN", ns: "Chị Lan", luuKho: true, chungTu: "HDNS" });
    const truoc = phienBan({ hn: co });
    for (const doi of [{ luuKho: false }, { chungTu: null }, { ns: "Anh Nam" }, { ns: null }]) {
      const d = diffVersions(truoc, phienBan({ hn: { ...co, ...doi } }));
      expect(d.map((x) => x.key), JSON.stringify(doi)).toEqual(["hnTables"]);
    }
  });

  it("bỏ qua ba khoá KHÔNG che thay đổi khác của bảng nội bộ; before/after trả nguyên dữ liệu phiên bản", () => {
    const truoc = phienBan();
    const sau = phienBan({ hcm: hang({ ...MAC_DINH, unitPrice: "650000" }) });
    const d = diffVersions(truoc, sau);
    expect(d.map((x) => x.key)).toEqual(["sheets"]);
    expect(d[0].after[0].extraTables[0].items[1]).toMatchObject({ unitPrice: "650000", ns: null, luuKho: false, chungTu: null });
  });

  it("dữ liệu Json lạ hình dạng (items không phải mảng, hàng null) không làm hàm ném", () => {
    const la = phienBan();
    la.hnTables = [{ name: "HN", items: "hỏng" }, null];
    la.sheets[0].extraTables = [{ category: "hcm", items: [null, 3] }];
    expect(() => diffVersions(la, phienBan())).not.toThrow();
    expect(diffVersions(la, la)).toEqual([]);
  });
});
