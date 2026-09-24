// Soát toàn diện đợt 5 (d5-soan 2): listQuotes nạp danh sách mẫu (dsMauBangNoiBo → quoteTemplate.findMany)
// cho MỌI người có quyền bảng nội bộ (HN_FILL hoặc INTERNAL_VIEW). Nhưng chỉ nhánh hnOnly của
// presentQuoteRow đọc `_mauBangNoiBo` (tính hnTotal theo mẫu — đợt 4), và route truyền
// internalOnly = can(INTERNAL_VIEW) mà presentQuoteRow xét internalOnly TRƯỚC hnOnly. Người có
// INTERNAL_VIEW (kể cả khi có thêm HN_FILL) vì thế trả một truy vấn thừa trên mỗi lượt tải danh sách —
// đường nóng, refetch thường xuyên.
//
// KHÔNG đụng CSDL: prisma được giả ở ../src/db.js (cùng khuôn tests/projectref-sheet-discount.test.js),
// nên bài này chạy được cả khi không có Postgres.
import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({ mau: [], bangHn: [], goiMau: 0 }));

vi.mock("../src/db.js", () => ({
  prisma: {
    quote: {
      count: async () => 1,
      findMany: async () => [{ id: 5, companyId: 7, company: { id: 7, name: "Gia Nguyễn", shortName: "GN" }, _count: { sheets: 1 } }],
    },
    quoteTemplate: { findMany: async () => { h.goiMau++; return h.mau; } },
    // Hai câu SQL thô của listQuotes: bảng nội bộ theo trang (FROM "QuoteSheet") và bảng HN cấp báo giá.
    $queryRaw: async (sql) => (sql.join("").includes('FROM "QuoteSheet"') ? [] : [{ quoteId: 5, tables: h.bangHn }]),
  },
}));

const { listQuotes } = await import("../src/services/quoteService.js");
const { presentQuoteRow } = await import("../src/quoteUtils.js");

const req = (permissions) => ({
  query: { sort: "createdAt", order: "desc" },
  session: { userId: 3, permissions: ["quote:read:all", ...permissions] },
});
// Đúng cách src/routes/quotes.routes.ts gọi presentQuoteRow cho danh sách.
const trinhBay = (r, perms) => presentQuoteRow(r, { hnOnly: perms.includes("quote:hn:fill"), internalOnly: perms.includes("quote:internal:view") });

beforeEach(() => {
  h.goiMau = 0;
  h.mau = [];
  h.bangHn = [{ category: "hanoi", templateId: 1, items: [{ kind: "item", quantity: 2, unitPrice: 1_000_000, days: 3 }] }];
});

describe("listQuotes — chỉ nạp danh sách mẫu khi nhánh trình bày thật sự dùng tới", () => {
  it("chỉ INTERNAL_VIEW → không nạp mẫu (nhánh internalOnly không tính hnTotal)", async () => {
    const { rows } = await listQuotes(req(["quote:internal:view"]));
    expect(h.goiMau, "nạp mẫu thừa cho nhánh internalOnly").toBe(0);
    // Dữ liệu nhánh internalOnly cần vẫn đủ: bảng HN cấp báo giá vẫn được nạp để đếm hàng.
    expect(trinhBay(rows[0], ["quote:internal:view"]).internalRows).toBe(1);
  });

  it("HN_FILL + INTERNAL_VIEW → internalOnly thắng → không nạp mẫu", async () => {
    const perms = ["quote:hn:fill", "quote:internal:view"];
    const { rows } = await listQuotes(req(perms));
    expect(h.goiMau, "nạp mẫu thừa khi internalOnly thắng hnOnly").toBe(0);
    expect(trinhBay(rows[0], perms)._internalRow).toBe(true);
  });

  it("chỉ HN_FILL → nạp mẫu ĐÚNG MỘT lần, hnTotal tính theo mẫu (mẫu không ngày → không nhân ngày)", async () => {
    h.mau = [{ id: 1, companyId: 7, code: "khong-co-config-nay" }];   // không có config → hasDays: false
    const perms = ["quote:hn:fill"];
    const { rows } = await listQuotes(req(perms));
    expect(h.goiMau).toBe(1);
    expect(trinhBay(rows[0], perms).hnTotal, "mẫu không ngày mà vẫn nhân 3 ngày").toBe(2_000_000);
  });

  it("không có quyền bảng nội bộ → không nạp gì thêm", async () => {
    const { rows } = await listQuotes(req([]));
    expect(h.goiMau).toBe(0);
    expect(rows[0].hnTables).toBeUndefined();
  });
});
