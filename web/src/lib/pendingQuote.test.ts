import { describe, it, expect, beforeEach } from "vitest";
import { setPendingNewQuote, takePendingNewQuote, giuBanNhap } from "./pendingQuote";
import type { QuoteFull } from "./api";

// ── BÀN GIAO BẢN NHÁP WIZARD → TRÌNH SOẠN ────────────────────────────────────
// Bài này canh đúng MỘT lỗi mất-dữ-liệu đã tái hiện được: hiệu ứng nạp của QuoteEditor gọi
// `takePendingNewQuote()` — hàm LẤY-RỒI-XOÁ. <StrictMode> (web/src/main.tsx) gọi lại mọi effect ở
// bản dev, nên lượt thứ hai nhận null, editor rơi vào nhánh "dựng mặc định", và tất cả những gì
// người dùng vừa điền qua 3 bước wizard biến mất — trình soạn mở ra trắng trơn.
//
// Không mount được React ở đây (web/ không có jsdom lẫn @testing-library — cố ý, test web là test
// LOGIC). Nên bất biến được kéo ra thành `giuBanNhap`, và bài này bắn đúng vào bất biến đó: GỌI
// LẠI PHẢI TRẢ VỀ ĐÚNG BẢN CŨ. Lượt E2E tương ứng là scripts/ci/ui-smoke.mjs [U11]–[U12].

const banNhap = (title: string) => ({ id: 0, _new: true, title, sheets: [] }) as unknown as QuoteFull;

describe("pendingQuote — bàn giao bản nháp từ Wizard", () => {
  beforeEach(() => { takePendingNewQuote(); });   // dọn kho module giữa các bài

  it("takePendingNewQuote lấy rồi XOÁ — đây là lý do cần giuBanNhap", () => {
    setPendingNewQuote(banNhap("A"));
    expect(takePendingNewQuote()?.title).toBe("A");
    expect(takePendingNewQuote()).toBeNull();
  });

  it("giuBanNhap gọi HAI lần vẫn trả đúng bản nháp đó (effect chạy lại không mất dữ liệu)", () => {
    const d = banNhap("Báo giá của người dùng");
    setPendingNewQuote(d);
    const hop: { current: QuoteFull | null } = { current: null };
    const lan1 = giuBanNhap(hop);
    const lan2 = giuBanNhap(hop);
    expect(lan1).toBe(d);
    expect(lan2).toBe(d);   // ← chốt: trước khi vá, lần 2 là null
  });

  it("giuBanNhap RÚT bản nháp khỏi kho module ngay lần đầu — hộp khác không nhặt lại được", () => {
    setPendingNewQuote(banNhap("B"));
    const hop1: { current: QuoteFull | null } = { current: null };
    expect(giuBanNhap(hop1)?.title).toBe("B");
    // Hộp mới = lần mount khác (người dùng rời trình soạn rồi vào lại) → phải là bản nháp TRỐNG,
    // không phải bản cũ sống lại. Đúng ý đồ ban đầu của pendingQuote: dùng một lần.
    const hop2: { current: QuoteFull | null } = { current: null };
    expect(giuBanNhap(hop2)).toBeNull();
  });

  it("không có bản nháp nào thì giuBanNhap trả null (vào thẳng #/rnew)", () => {
    const hop: { current: QuoteFull | null } = { current: null };
    expect(giuBanNhap(hop)).toBeNull();
  });
});
