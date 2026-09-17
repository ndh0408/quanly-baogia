/** @vitest-environment jsdom */
/**
 * ============================================================================
 * HỘP CHỐT BÁO GIÁ — BẮT QUYẾT TỪNG TRANG, VÀ HIỆN ĐÚNG SỐ TIỀN SẼ GHI NHẬN.
 *
 * ── VÌ SAO CÓ HỘP NÀY ──────────────────────────────────────────────────────
 * "Khách chốt" áp cho CẢ báo giá và KHÔNG đảo lại được (máy chủ trả 400 nếu bấm lại). Ngay trên
 * lưới lại có cặp nút gần giống hệt — "✓ Khách duyệt / ✗ Không duyệt" — chỉ áp cho MỘT trang.
 *
 * Và tới 2026-09-17, bấm chốt khi có trang khách đã TỪ CHỐI vẫn ghi nhận doanh thu bằng tổng CẢ
 * MỌI TRANG: `QuoteSheet.custStatus` được GHI nhưng không dòng nào ĐỌC.
 *
 * ── HAI TÍNH CHẤT BÀI NÀY KHOÁ ─────────────────────────────────────────────
 * 1. CÒN TRANG CHƯA QUYẾT → KHÔNG CHỐT ĐƯỢC. Chốt khi còn trang chưa ai duyệt/từ chối là ghi nhận
 *    một con số chưa ai xác nhận. Nhắc suông thì bỏ qua được, nên nút phải bị VÔ HIỆU HOÁ.
 * 2. SỐ TIỀN HIỆN RA PHẢI ĐÚNG bằng số máy chủ sẽ ghi — nếu lệch, người bấm quyết định dựa trên
 *    một con số khác với con số được lưu, và sẽ chỉ phát hiện khi đối chiếu báo cáo.
 *
 * Số tiền trong hộp chỉ để NGƯỜI ĐỌC quyết định; máy chủ tự tính lại từ `custStatus` thật
 * (`markConverted`, src/services/quoteService.ts). Bài kiểm ở tầng máy chủ:
 * tests/ch-chot-tru-trang-tu-choi.test.js.
 *
 * ── VÌ SAO DOCBLOCK `@vitest-environment jsdom` Ở DÒNG ĐẦU ─────────────────
 * `vitest.config.js` đặt `environment: "node"` cho CẢ bộ test web, nên `document` không tồn tại.
 * Hộp thoại này là DOM thuần (dựng `div`, gắn vào `document.body`) — không có jsdom thì mọi bài ở
 * đây ném `ReferenceError: document is not defined` chứ không phải đỏ vì nội dung.
 * ============================================================================
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { modalChotBaoGia } from "./ui";

const TRANG = [
  { id: 1, ten: "1. Banner", net: 1_000_000, custStatus: "approved" as string | null },
  { id: 2, ten: "2. Ticketbox", net: 2_000_000, custStatus: null as string | null },
  { id: 3, ten: "3. Lightbox", net: 3_000_000, custStatus: "rejected" as string | null },
];
const VAT = 8;

/** Hộp đang mở (nó tự gắn vào document.body). */
const hop = () => document.querySelector(".modal-backdrop") as HTMLElement;
const nutChot = () => hop().querySelector("[data-yes]") as HTMLButtonElement;
const nutHuy = () => hop().querySelector("[data-no]") as HTMLButtonElement;
const bam = (sel: string) => (hop().querySelector(sel) as HTMLElement).click();

beforeEach(() => { document.body.innerHTML = ""; });
afterEach(() => { document.body.innerHTML = ""; });

describe("modalChotBaoGia", () => {
  it("liệt kê MỌI trang và mỗi dòng TỰ NÓI trạng thái của nó", () => {
    // Gom theo nhóm thì trang nào đang ở nhóm nào phải suy ra từ vị trí — đây là màn hình quyết
    // định tiền, không nên bắt ai suy luận.
    modalChotBaoGia("GN26008", TRANG, VAT);
    const chu = hop().textContent || "";
    for (const t of TRANG) expect(chu, `thiếu trang ${t.ten}`).toContain(t.ten);
    expect(chu).toContain("đã duyệt");
    expect(chu).toContain("chưa có ý kiến");
    expect(chu).toContain("không duyệt");
  });

  it("CÒN trang chưa có ý kiến → nút Chốt bị VÔ HIỆU HOÁ", () => {
    modalChotBaoGia("GN26008", TRANG, VAT);
    expect(nutChot().disabled, "chốt được khi còn trang chưa ai quyết").toBe(true);
    expect(nutChot().textContent).toContain("1 trang chưa quyết");
  });

  it("quyết xong hết → mở khoá, và tiền TRỪ đúng phần bị từ chối", () => {
    modalChotBaoGia("GN26008", TRANG, VAT);
    bam("[data-duyet-het]");
    expect(nutChot().disabled).toBe(false);
    // Giữ lại 1tr (đã duyệt) + 2tr (vừa duyệt) = 3tr; trang 3tr bị từ chối KHÔNG tính.
    // VAT 8% tính trên 3tr → 3.240.000. Không phải 6tr×1,08 rồi mới trừ.
    const mong = (3_000_000 * 1.08).toLocaleString("vi-VN");
    expect(nutChot().textContent, `nút ghi: ${nutChot().textContent}`).toContain(mong);
    expect(hop().textContent).toContain("Đã trừ");
  });

  it("“Không duyệt hết” cũng mở khoá được — không ép người dùng phải duyệt", () => {
    // Bắt QUYẾT, không phải bắt ĐỒNG Ý. Chỉ cho một lối thoát là biến hộp này thành cái bẫy.
    modalChotBaoGia("GN26008", TRANG, VAT);
    bam("[data-tuchoi-het]");
    expect(nutChot().disabled).toBe(false);
    // Chỉ còn trang 1 (1tr) được tính.
    expect(nutChot().textContent).toContain((1_000_000 * 1.08).toLocaleString("vi-VN"));
  });

  it("“Đồng ý lại” một trang đang bị từ chối → cộng tiền của nó trở lại", () => {
    modalChotBaoGia("GN26008", TRANG, VAT);
    bam("[data-duyet-het]");
    const truoc = nutChot().textContent || "";
    bam('[data-dat="3|approved"]');
    const sau = nutChot().textContent || "";
    expect(sau, "bấm Đồng ý lại mà số tiền không đổi").not.toBe(truoc);
    expect(sau).toContain((6_000_000 * 1.08).toLocaleString("vi-VN"));
  });

  it("chỉ trả về trang THẬT SỰ đổi — không đẻ bản ghi audit rỗng", async () => {
    const p = modalChotBaoGia("GN26008", TRANG, VAT);
    bam('[data-dat="2|approved"]');   // chỉ đổi trang 2
    nutChot().click();
    const doi = await p;
    expect(doi).toEqual([{ id: 2, status: "approved" }]);
  });

  it("Hủy → trả null, KHÔNG đổi gì", async () => {
    const p = modalChotBaoGia("GN26008", TRANG, VAT);
    bam("[data-duyet-het]");
    nutHuy().click();
    expect(await p).toBeNull();
  });

  it("phím Enter KHÔNG chốt — thao tác không đảo lại được thì phải bấm đúng nút", async () => {
    const p = modalChotBaoGia("GN26008", TRANG, VAT);
    bam("[data-duyet-het]");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    // Vẫn còn mở → chưa resolve. Đóng bằng Escape để bài kiểm kết thúc.
    expect(hop(), "Enter đã đóng hộp — một phím lỡ tay là chốt cả báo giá").toBeTruthy();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(await p).toBeNull();
  });

  it("MỌI trang đã quyết sẵn → mở khoá ngay, không bắt bấm thêm", () => {
    const daQuyet = TRANG.map((t) => ({ ...t, custStatus: t.custStatus ?? "approved" }));
    modalChotBaoGia("GN26008", daQuyet, VAT);
    expect(nutChot().disabled).toBe(false);
  });
});
