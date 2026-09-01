/**
 * ============================================================================
 * GIẢ MẠO CHỨNG TỪ THANH TOÁN BẰNG CÁCH CHÉP LẠI `rid`.
 *
 * ── BỐI CẢNH ────────────────────────────────────────────────────────────────
 * `reconcileExtraPayments` (src/services/quoteService.ts) là lớp chặn "tự đánh dấu đã trả qua
 * payload": ai KHÔNG có `quote:internal:pay` thì trạng thái thanh toán bị ép về đúng bản CSDL,
 * khớp theo `rid` của từng hàng.
 *
 * ── LỖI ─────────────────────────────────────────────────────────────────────
 * `rid` do CHÍNH CLIENT gửi lên, và `sanitizeExtraTables` (src/quoteUtils.ts:240) giữ NGUYÊN VĂN
 * khi ghi. Bản trước chỉ `prior.get(it.rid)` — tin cậy hoàn toàn một chuỗi client kiểm soát.
 *
 * PHẢI NÓI ĐÚNG CẢ HAI CHIỀU (đã đo, không suy đoán):
 *   · rid BỊA (chưa từng có trong CSDL) → `p` là null → `paid` bị ép về false. Chiều này AN TOÀN
 *     từ trước bản vá. Nó KHÔNG phải lỗ, và test dưới đây khoá lại điều đó.
 *   · CHÉP LẠI rid của một hàng ĐÃ THANH TOÁN sang một hàng BỊA → hàng bịa nhận `paid: true` cùng
 *     `paidAt`/`paidById` của người trả thật VÀ cả ẢNH CHỨNG TỪ thật. ĐÂY mới là lỗ: giả mạo
 *     chứng từ tài chính, làm được bởi đúng lớp tài khoản mà lớp gác này sinh ra để chặn
 *     (account_hn đọc được `rid` ngay trong payload trả về của chính họ).
 *
 * ── BẤT BIẾN ĐÓNG LỖ ────────────────────────────────────────────────────────
 * AI KHÔNG ĐƯỢC ĐẶT `paid` THÌ CŨNG KHÔNG ĐƯỢC ĐỔI SỐ TIỀN CỦA HÀNG ĐÃ TRẢ. Cộng thêm: mỗi `rid`
 * chỉ kế thừa MỘT lần. Người có `quote:internal:pay` không bị ràng buộc (họ vốn đặt `paid` trực tiếp).
 *
 * ── CƠ CHẾ: TỪ CHỐI CẢ LẦN LƯU, KHÔNG PHẢI "CẮT KẾ THỪA" ────────────────────
 * Bản đầu phản ứng bằng `p = null`, tức ép `paid=false` và bỏ luôn `paidAt`/`paidById`/`paidProof`.
 * Chốt đó chặn được kẻ chép `rid`, nhưng nó KHÔNG phân biệt được "chép rid sang hàng bịa" với
 * "sale sửa giá đúng hàng thật" — và ca thứ hai là thao tác BÌNH THƯỜNG: kế toán bấm /pay đánh dấu
 * một hàng chi phí đã trả kèm ảnh uỷ nhiệm chi, rồi sale (không có `quote:internal:pay`) sửa số
 * lượng vì chi phí đổi. Kết quả cũ: ảnh và cờ đã-trả biến mất vĩnh viễn, im lặng, vẫn trả 200 —
 * xoá chứng từ tài chính THẬT để chặn một đường khai thác hẹp.
 *
 * Nay hàm ném 400 nêu ĐÍCH DANH hàng đang vướng. Kẻ tấn công vẫn không thu được gì (cả lần ghi bị
 * chặn), người dùng thật giữ nguyên dữ liệu và biết phải làm gì. Xem tests/extra-paid-preserved.test.js.
 * ============================================================================
 */
import { describe, it, expect } from "vitest";
import { reconcileExtraPayments } from "../src/services/quoteService.js";

const ANH = "data:image/png;base64,AAAA";
const hangDb = (over = {}) => ({ rid: "r-that", name: "Thi công nhỏ", quantity: 1, unitPrice: 1_000_000, days: null, paid: true, paidAt: "2026-01-01T00:00:00.000Z", paidById: 9, paidProof: ANH, ...over });
const db = (items) => [{ extraTables: [{ category: "hanoi", items }] }];
const payload = (items) => [{ extraTables: [{ category: "hanoi", items }] }];
const hang = (p) => p[0].extraTables[0].items;

describe("reconcileExtraPayments — rid do client gửi", () => {
  it("rid BỊA không đặt được paid (chiều này vốn đã an toàn — khoá lại để không hồi quy)", () => {
    const p = payload([{ rid: "BIA-MOI", name: "Hàng bịa", quantity: 1, unitPrice: 50_000_000, paid: true, paidById: 1, paidProof: ANH }]);
    reconcileExtraPayments(p, db([hangDb()]), false, 1);
    expect(hang(p)[0].paid).toBe(false);
    expect(hang(p)[0].paidAt).toBeNull();
    expect(hang(p)[0].paidProof).toBeNull();
  });

  it("CHÉP rid của hàng đã trả sang hàng ĐỔI SỐ TIỀN → cả lần lưu bị từ chối", () => {
    const p = payload([{ rid: "r-that", name: "Hàng bịa 50 triệu", quantity: 1, unitPrice: 50_000_000, paid: true }]);
    let loi;
    try { reconcileExtraPayments(p, db([hangDb()]), false, 1); } catch (e) { loi = e; }
    expect(loi, "hàng bịa đi lọt — phải chặn cả lần ghi").toBeTruthy();
    expect(loi.status, "phải là lỗi của người gửi, không phải 500").toBe(400);
    expect(loi.message, "thông điệp phải nêu đích danh hàng vướng").toContain("Hàng bịa 50 triệu");
    // Và KHÔNG được xoá chứng từ thật để đổi lấy việc chặn — đó là bản vá cũ.
    expect(hang(p)[0].paidProof, "ảnh gốc trong CSDL không được đụng tới").not.toBe(null);
  });

  it("đổi SỐ LƯỢNG cũng tính là đổi số tiền", () => {
    const p = payload([{ rid: "r-that", name: "Thi công nhỏ", quantity: 40, unitPrice: 1_000_000, paid: true }]);
    expect(() => reconcileExtraPayments(p, db([hangDb()]), false, 1)).toThrowError(/đã thanh toán/);
  });

  it("đổi SỐ NGÀY cũng vậy", () => {
    const p = payload([{ rid: "r-that", name: "Thi công nhỏ", quantity: 1, unitPrice: 1_000_000, days: 30, paid: true }]);
    expect(() => reconcileExtraPayments(p, db([hangDb({ days: 1 })]), false, 1)).toThrowError(/đã thanh toán/);
  });

  it("hai hàng CÙNG rid → chỉ hàng ĐẦU kế thừa, bản sao thì không", () => {
    const p = payload([
      { rid: "r-that", name: "Thi công nhỏ", quantity: 1, unitPrice: 1_000_000, paid: true },
      { rid: "r-that", name: "Bản sao", quantity: 1, unitPrice: 1_000_000, paid: true },
    ]);
    reconcileExtraPayments(p, db([hangDb()]), false, 1);
    expect(hang(p)[0].paid, "hàng gốc phải giữ được trạng thái đã trả").toBe(true);
    expect(hang(p)[1].paid, "bản sao cùng rid vẫn nhận được trạng thái đã trả").toBe(false);
  });

  // ── KHÔNG ĐƯỢC PHÁ NGHIỆP VỤ ĐANG CHẠY ────────────────────────────────────
  it("KHÔNG đổi tiền → hàng đã trả GIỮ NGUYÊN trạng thái, ảnh và người trả", () => {
    const p = payload([{ rid: "r-that", name: "Đổi tên thôi", quantity: 1, unitPrice: 1_000_000, paid: true }]);
    reconcileExtraPayments(p, db([hangDb()]), false, 1);
    const it = hang(p)[0];
    expect(it.paid).toBe(true);
    expect(it.paidById).toBe(9);
    expect(it.paidAt).toBe("2026-01-01T00:00:00.000Z");
    expect(it.paidProof).toBe(ANH);
  });

  it("hàng CHƯA trả đổi giá tự do — ràng buộc chỉ áp cho hàng ĐÃ trả", () => {
    const p = payload([{ rid: "r-chua", name: "Sửa giá", quantity: 2, unitPrice: 9_000_000 }]);
    reconcileExtraPayments(p, db([{ rid: "r-chua", quantity: 1, unitPrice: 1_000_000, paid: false }]), false, 1);
    expect(hang(p)[0].paid).toBe(false);
    expect(hang(p)[0].unitPrice).toBe(9_000_000);   // giá người dùng gõ KHÔNG bị đụng
  });

  it("người CÓ quote:internal:pay vẫn đổi được giá hàng đã trả (luồng kế toán không đổi)", () => {
    const p = payload([{ rid: "r-that", name: "Kế toán chỉnh", quantity: 1, unitPrice: 3_000_000, paid: true }]);
    reconcileExtraPayments(p, db([hangDb()]), true, 5);
    const it = hang(p)[0];
    expect(it.paid).toBe(true);
    expect(it.paidById).toBe(9);                    // giữ người trả gốc
    expect(it.paidProof).toBe(ANH);                 // ảnh vẫn theo DB
  });

  // ── ĐÁNH ĐỔI CÓ CHỦ Ý, ĐỪNG "SIẾT LẠI" MÀ KHÔNG ĐỌC ───────────────────────
  // Hàng bảng nội bộ ghi từ trước khi `sanitizeExtraTables` chuẩn hoá (hoặc ghi qua route /pay)
  // KHÔNG có `quantity`/`unitPrice` trong JSON, còn payload gửi lên thì luôn có số. Nếu coi
  // "thiếu" là "bằng 0" thì phép so báo lệch và chốt sẽ CẮT trạng thái đã-trả của một hàng HỢP LỆ
  // — tự tay xoá chứng từ tài chính thật, hại hơn hẳn đường khai thác nó đi chặn.
  // Bản đầu của chốt này mắc đúng lỗi đó và bị tests/extra-paid-preserved.test.js bắt.
  it("bản CSDL KHÔNG ghi số tiền → giữ nguyên kế thừa (fail-open, không xoá dữ liệu thật)", () => {
    const p = payload([{ rid: "r-cu", name: "Thuê xe (sửa chính tả)", quantity: 1, unitPrice: 100, paid: true }]);
    // Đúng hình dạng hàng cũ: chỉ có rid/name/paid/paidAt/paidById, không có quantity/unitPrice.
    reconcileExtraPayments(p, db([{ rid: "r-cu", name: "Thuê xe", paid: true, paidAt: "2026-08-01T00:00:00Z", paidById: 7, paidProof: ANH }]), false, 1);
    const it = hang(p)[0];
    expect(it.paid, "hàng cũ hợp lệ bị xoá mất trạng thái đã trả").toBe(true);
    expect(it.paidById).toBe(7);
    expect(it.paidProof).toBe(ANH);
  });

  it("người có quyền vẫn ĐÁNH DẤU MỚI được, có đóng dấu người/thời điểm", () => {
    const p = payload([{ rid: "r-chua", quantity: 1, unitPrice: 1_000_000, paid: true }]);
    reconcileExtraPayments(p, db([{ rid: "r-chua", quantity: 1, unitPrice: 1_000_000, paid: false }]), true, 5);
    expect(hang(p)[0].paid).toBe(true);
    expect(hang(p)[0].paidById).toBe(5);
    expect(hang(p)[0].paidAt).toBeTruthy();
  });
});
