// Cụm quote-concurrency — hai lỗi ở lớp trình bày/làm sạch bảng nội bộ (src/quoteUtils.ts).
//
// ── LỖI 1: sanitizeExtraTables ĐÁNH RƠI `quantityExact` ─────────────────────
// `extraTableSum` (quoteUtils.ts) rẽ nhánh theo `it.quantityExact`: bật thì giữ 4 chữ số thập
// phân, tắt thì `qtyRound` cắt còn 1 chữ số. Đường lưới CHÍNH (`buildSheetsCreate`) CÓ ghi cờ này
// xuống DB, zod (`validators.ts` extraTableSchema) CÓ nhận nó, nhưng mapper của
// `sanitizeExtraTables` — nơi bảng nội bộ đi qua trước khi vào cột Json — liệt kê thiếu đúng field
// đó, nên cờ bị bỏ im lặng.
// TÁI HIỆN: một hàng bảng nội bộ số lượng 1.2345 (vd mét vải, giờ công lẻ) bật "số lẻ chính xác".
// HẬU QUẢ: tổng bảng nội bộ NHẢY SỐ ngay sau khi tải lại trang (1235 → 1200 trong ví dụ dưới) —
// người dùng thấy con số mình vừa nhập tự đổi mà không ai sửa gì.
//
// ── LỖI 2: view của account Hà Nội RÒ ảnh chứng từ thanh toán ───────────────
// `presentQuoteForAccountHn` lọc thẳng `s.extraTables` mà KHÔNG bọc `stripExtraProofs`, trong khi
// `presentQuoteForInternal` và `presentQuote` đều bọc — chính chú thích của `stripExtraProofs`
// phát biểu quy tắc: ảnh base64 chỉ tải on-demand qua route riêng.
// TÁI HIỆN: kế toán (quote:internal:pay) đính ảnh chứng từ cho một hàng bảng "hanoi" (route /pay
// khớp theo `rid`, KHÔNG lọc category) → account HN mở báo giá được giao.
// HẬU QUẢ: account Hà Nội — vai trò KHÔNG có quote:internal:view lẫn quote:internal:pay — nhận
// nguyên chuỗi base64 ảnh chứng từ trong payload, và mỗi lần mở báo giá là kéo cả đống ảnh.
import { describe, it, expect } from "vitest";
import { sanitizeExtraTables, extraTableSum, presentQuote } from "../src/quoteUtils.js";

describe("sanitizeExtraTables giữ cờ quantityExact", () => {
  const bang = (extra) => ({
    category: "hanoi",   // "hanoi" cộng MỌI hàng — khỏi vướng luật "chỉ cộng hàng đã duyệt" của hcm/khach
    name: "Giá HN",
    items: [{ kind: "item", name: "Vải", quantity: 1.2345, unitPrice: 1000, ...extra }],
  });

  it("hàng bật quantityExact: cờ còn sau khi làm sạch", () => {
    const out = sanitizeExtraTables([bang({ quantityExact: true })]);
    expect(out[0].items[0].quantityExact, "cờ bị mapper đánh rơi → số lượng bị cắt còn 1 chữ số thập phân").toBe(true);
  });

  it("hàng KHÔNG bật quantityExact vẫn là false (không tự bật)", () => {
    const out = sanitizeExtraTables([bang({})]);
    expect(out[0].items[0].quantityExact).toBe(false);
  });

  it("tổng bảng KHÔNG đổi qua vòng lưu → tải lại", () => {
    const truoc = bang({ quantityExact: true });
    const sau = sanitizeExtraTables([truoc])[0];
    expect(extraTableSum(truoc), "1.2345 × 1000, giữ 4 chữ số → 1235").toBe(1235);
    expect(extraTableSum(sau), "sau khi lưu phải RA ĐÚNG SỐ ĐÓ, không nhảy về 1200").toBe(extraTableSum(truoc));
  });
});

describe("presentQuote(hnOnly) không gửi ảnh chứng từ cho account Hà Nội", () => {
  const q = {
    id: 7, quoteNumber: "GN26001", title: "Dự án thử", companyId: 1,
    sheets: [{
      id: 11, name: "Trang 1", order: 1,
      extraTables: [
        { category: "hanoi", name: "Giá HN", items: [{ kind: "item", rid: "r1", name: "Thuê xe", quantity: 1, unitPrice: 2000, paid: true, paidProof: "data:image/png;base64,AAAA" }] },
        { category: "hcm", name: "Chi phí HCM", items: [{ kind: "item", rid: "h1", name: "Kho", quantity: 1, unitPrice: 1000, paidProof: "data:image/png;base64,BBBB" }] },
      ],
    }],
  };

  it("ảnh base64 bị lược, chỉ còn cờ hasPaidProof", () => {
    const out = presentQuote(q, { hnOnly: true });
    const row = out.hnSheets[0].hnTables[0].items[0];
    expect(row.paidProof, "ảnh chứng từ chỉ tải on-demand qua route riêng").toBeUndefined();
    expect(row.hasPaidProof, "vẫn phải biết là CÓ ảnh để hiện dấu kẹp giấy").toBe(true);
  });

  it("vẫn CHỈ trả bảng 'hanoi' (không kèm hcm/khach) và giữ nguyên số liệu", () => {
    const out = presentQuote(q, { hnOnly: true });
    expect(out.hnSheets[0].hnTables).toHaveLength(1);
    expect(out.hnSheets[0].hnTables[0].category).toBe("hanoi");
    expect(out.hnSheets[0].hnTables[0].items[0].unitPrice).toBe(2000);
  });
});
