/** @vitest-environment jsdom */
//
// Ô GHI CHÚ + 5 MÀU ở dòng Danh sách báo giá (chủ repo 2026-09-30). Component thuần hiển thị + thu ý định:
// bài này kiểm đúng những gì NGƯỜI DÙNG làm — bấm vào chữ để MỞ KHUNG xem đủ chữ + sửa (Enter / Lưu / bấm ra ngoài =
// lưu, Esc / Hủy = huỷ), bấm chấm để mở bảng 5 màu kiểu Zalo — và những điều dễ vỡ âm thầm: Enter chốt từ của bộ gõ
// tiếng Việt KHÔNG được lưu, lưu đúng MỘT lần, không gọi máy chủ khi chữ không đổi, khung/bảng đóng và trả tiêu điểm đúng chỗ.
//
// Khung toàn văn ra đời từ lời chủ repo: "không thấy được hết chữ, click vào thấy hết chứ" — ô trên bảng chỉ đủ 2 dòng.
import { describe, it, expect, vi, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QuoteNote } from "./QuoteNote";
import type { QuoteListNote } from "../lib/api";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let hop: HTMLDivElement | null = null;
afterEach(() => { if (root) act(() => root!.unmount()); root = null; hop?.remove(); hop = null; document.body.innerHTML = ""; vi.restoreAllMocks(); });
const cho = (ms = 0) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

async function mo(ghiChu: QuoteListNote | null, choSua = true) {
  const onLuu = vi.fn();
  hop = document.createElement("div"); document.body.appendChild(hop);
  root = createRoot(hop);
  await act(async () => { root!.render(<QuoteNote ghiChu={ghiChu} choSua={choSua} nhan="FP_A26_001" onLuu={onLuu} />); });
  return onLuu;
}
const chu = () => hop!.querySelector("button.qn-text") as HTMLButtonElement;
const cham = () => hop!.querySelector("button.qn-dot") as HTMLButtonElement;
const khung = () => document.querySelector(".qn-edit") as HTMLElement | null;
const o = () => document.querySelector("textarea.qn-area") as HTMLTextAreaElement;
const bang = () => document.querySelector(".qn-pop") as HTMLElement | null;
const vong = () => [...document.querySelectorAll<HTMLButtonElement>(".qn-swatch")];
function go(el: HTMLTextAreaElement, v: string) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")!.set!;
  act(() => { setter.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true })); });
}
const phim = (el: Element, key: string, init: KeyboardEventInit = {}) => act(async () => { el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init })); });
const bamNgoai = () => act(async () => { document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); });
const nut = (khungEl: Element, ten: string) => [...khungEl.querySelectorAll("button")].find((b) => b.textContent === ten) as HTMLButtonElement;
const DAI = "Đã xuất hóa đơn, chờ kế toán thu tiền và đối chiếu công nợ tháng chín — ".repeat(3).slice(0, 200);

describe("QuoteNote — chữ ghi chú", () => {
  it("chưa có ghi chú: hiện gợi ý 'Ghi chú…', chấm rỗng (không có màu), nút nói rõ thêm cho dòng nào", async () => {
    await mo(null);
    expect(chu().textContent).toBe("Ghi chú…");
    expect(chu().getAttribute("aria-label")).toBe("Thêm ghi chú cho FP_A26_001");
    expect(hop!.querySelector(".qn")!.className).not.toContain("has-color");
    expect(hop!.querySelector(".qn")!.className).not.toContain("qn-c-");
  });

  it("có chữ + màu: thẻ mang lớp màu và has-text; chấm nói tên màu; tooltip đủ chữ + người ghi", async () => {
    await mo({ note: "Chờ khách duyệt", color: "orange", updatedByName: "Lan", updatedAt: "2026-09-30T02:00:00.000Z" });
    const q = hop!.querySelector(".qn")!;
    expect(q.className).toContain("qn-c-orange");
    expect(q.className).toContain("has-text");
    expect(chu().textContent).toBe("Chờ khách duyệt");
    expect(cham().getAttribute("aria-label")).toContain("Cam");
    expect(chu().title).toContain("Chờ khách duyệt");
    expect(chu().title).toContain("Lan");
  });

  it("bấm chữ → MỞ KHUNG có ô nhập chứa TOÀN VĂN, tiêu điểm + con trỏ ở CUỐI; gõ + Enter → lưu MỘT lần, khung đóng, tiêu điểm về nút chữ", async () => {
    const onLuu = await mo({ note: "Gọi lại", color: null });
    expect(khung()).toBeNull();
    await act(async () => { chu().click(); });
    expect(khung()).toBeTruthy();
    expect(chu().getAttribute("aria-expanded")).toBe("true");
    expect(o().value).toBe("Gọi lại");
    expect(document.activeElement).toBe(o());
    expect(o().selectionStart).toBe("Gọi lại".length);
    go(o(), "Gọi lại thứ Hai");
    await phim(o(), "Enter");
    await cho(30);
    expect(onLuu).toHaveBeenCalledTimes(1);
    expect(onLuu).toHaveBeenCalledWith({ note: "Gọi lại thứ Hai" });
    expect(khung()).toBeNull();
    expect(document.activeElement).toBe(chu());
  });

  it("ghi chú DÀI (200 ký tự) hiện ĐỦ trong khung — không bị cắt như ô trên bảng — kèm bộ đếm 200/200", async () => {
    await mo({ note: DAI, color: "green", updatedByName: "Lan", updatedAt: "2026-09-30T02:00:00.000Z" });
    expect(DAI).toHaveLength(200);
    await act(async () => { chu().click(); });
    expect(o().value, "khung không hiện đủ chữ").toBe(DAI);
    expect(khung()!.querySelector(".qn-count")!.textContent).toBe("200/200");
    expect(khung()!.querySelector(".qn-count")!.className).toContain("is-max");
    expect(khung()!.textContent).toContain("Lan");   // người ghi + ngày
  });

  it("gõ thêm thì bộ đếm chạy theo", async () => {
    await mo(null);
    await act(async () => { chu().click(); });
    expect(khung()!.querySelector(".qn-count")!.textContent).toBe("0/200");
    go(o(), "Nhắc thu tiền");
    expect(khung()!.querySelector(".qn-count")!.textContent).toBe("13/200");
  });

  it("nút Lưu và bấm ra ngoài khung đều LƯU đúng một lần; nút Hủy và Esc thì HUỶ", async () => {
    const onLuu = await mo({ note: "Chữ cũ", color: null });
    // Lưu
    await act(async () => { chu().click(); });
    go(o(), "Bằng nút Lưu");
    await act(async () => { nut(khung()!, "Lưu").click(); });
    expect(onLuu).toHaveBeenLastCalledWith({ note: "Bằng nút Lưu" });
    expect(khung()).toBeNull();
    // Bấm ra ngoài = lưu
    await act(async () => { chu().click(); });
    go(o(), "Bằng bấm ngoài");
    await bamNgoai();
    expect(onLuu).toHaveBeenLastCalledWith({ note: "Bằng bấm ngoài" });
    expect(onLuu).toHaveBeenCalledTimes(2);
    expect(khung()).toBeNull();
    // Hủy
    await act(async () => { chu().click(); });
    go(o(), "Sẽ bỏ");
    await act(async () => { nut(khung()!, "Hủy").click(); });
    expect(khung()).toBeNull();
    // Esc
    await act(async () => { chu().click(); });
    go(o(), "Cũng bỏ");
    await phim(document.activeElement!, "Escape");
    await cho(30);
    expect(khung()).toBeNull();
    expect(onLuu, "Hủy / Esc không được gọi lưu").toHaveBeenCalledTimes(2);
    expect(document.activeElement).toBe(chu());
  });

  it("bấm TRONG khung không bị coi là bấm ra ngoài (khung không tự đóng và lưu dở)", async () => {
    const onLuu = await mo(null);
    await act(async () => { chu().click(); });
    go(o(), "Đang gõ");
    await act(async () => { khung()!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); });
    expect(khung()).toBeTruthy();
    expect(onLuu).not.toHaveBeenCalled();
  });

  it("chữ KHÔNG đổi (kể cả thừa khoảng trắng / xuống dòng) → khỏi gọi máy chủ", async () => {
    const onLuu = await mo({ note: "Y nguyên", color: null });
    await act(async () => { chu().click(); });
    go(o(), "  Y nguyên  \n");
    await phim(o(), "Enter");
    expect(onLuu).not.toHaveBeenCalled();
  });

  it("xuống dòng (dán từ Excel) được gộp thành MỘT dòng trước khi gửi", async () => {
    const onLuu = await mo(null);
    await act(async () => { chu().click(); });
    go(o(), "dòng một\n  dòng hai");
    await phim(o(), "Enter");
    expect(onLuu).toHaveBeenCalledWith({ note: "dòng một dòng hai" });
  });

  it("xoá hết chữ rồi Enter → gửi note rỗng (máy chủ tự dọn hàng nếu cũng không còn màu)", async () => {
    const onLuu = await mo({ note: "Sẽ xoá", color: null });
    await act(async () => { chu().click(); });
    go(o(), "");
    await phim(o(), "Enter");
    expect(onLuu).toHaveBeenCalledWith({ note: "" });
  });

  it("BỘ GÕ tiếng Việt: Enter chốt một từ (isComposing / keyCode 229) KHÔNG phải lệnh lưu", async () => {
    const onLuu = await mo(null);
    await act(async () => { chu().click(); });
    go(o(), "Khach");
    await phim(o(), "Enter", { isComposing: true });
    await phim(o(), "Enter", { keyCode: 229 } as KeyboardEventInit);
    expect(onLuu, "Enter của bộ gõ bị hiểu là lưu → mỗi lần bỏ dấu là một lần lưu nhầm").not.toHaveBeenCalled();
    expect(khung(), "khung phải còn mở để gõ tiếp").toBeTruthy();
    await phim(o(), "Enter");   // Enter THẬT sau khi chốt từ
    expect(onLuu).toHaveBeenCalledWith({ note: "Khach" });
  });

  it("ô nhập giới hạn 200 ký tự (khớp trần máy chủ)", async () => {
    await mo(null);
    await act(async () => { chu().click(); });
    expect(o().maxLength).toBe(200);
  });

  describe("vị trí khung", () => {
    const neo = (rc: Partial<DOMRect>) => vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return (this.classList.contains("qn-text") ? { left: 100, top: 100, right: 240, bottom: 140, width: 140, height: 40, x: 100, y: 100, ...rc, toJSON: () => ({}) } : { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    });

    it("đủ chỗ phía dưới: khung nằm NGAY DƯỚI ô chữ, cùng mép trái", async () => {
      neo({ left: 120, bottom: 140 });
      await mo({ note: "x", color: null });
      await act(async () => { chu().click(); });
      expect(khung()!.style.left).toBe("120px");
      expect(khung()!.style.top).toBe("146px");   // bottom + 6
    });

    it("ô sát đáy màn hình: khung mở LÊN TRÊN thay vì tràn khỏi màn hình", async () => {
      neo({ left: 100, top: window.innerHeight - 50, bottom: window.innerHeight - 10 });
      await mo({ note: "x", color: null });
      await act(async () => { chu().click(); });
      expect(parseFloat(khung()!.style.top)).toBeLessThan(window.innerHeight - 50);
    });

    it("ô sát mép PHẢI: khung bị kẹp lại trong màn hình", async () => {
      neo({ left: window.innerWidth - 20, right: window.innerWidth + 100 });
      await mo({ note: "x", color: null });
      await act(async () => { chu().click(); });
      expect(parseFloat(khung()!.style.left)).toBeLessThanOrEqual(window.innerWidth - 340 - 8 + 1);
    });

    it("cuộn trang/bảng thì khung BÁM THEO ô; cuộn BÊN TRONG khung (chữ dài) thì không kéo khung đi", async () => {
      const dich = neo({ left: 100, bottom: 140 });
      await mo({ note: "x", color: null });
      await act(async () => { chu().click(); });
      expect(khung()!.style.top).toBe("146px");
      dich.mockImplementation(function (this: HTMLElement) { return (this.classList.contains("qn-text") ? { left: 100, top: 300, right: 240, bottom: 340, width: 140, height: 40, x: 100, y: 300, toJSON: () => ({}) } : { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect; });
      await act(async () => { document.dispatchEvent(new Event("scroll")); });   // cuộn ở ngoài
      expect(khung()!.style.top).toBe("346px");
      dich.mockImplementation(function (this: HTMLElement) { return { left: 100, top: 900, right: 240, bottom: 940, width: 140, height: 40, x: 100, y: 900, toJSON: () => ({}) } as DOMRect; });
      await act(async () => { o().dispatchEvent(new Event("scroll")); });   // cuộn trong ô nhập (không bubble, bắt ở capture)
      expect(khung()!.style.top, "cuộn trong chính khung làm khung nhảy").toBe("346px");
    });
  });
});

describe("QuoteNote — bảng 5 màu kiểu Zalo", () => {
  it("bấm chấm → bảng có ĐÚNG 5 chấm theo thứ tự, mỗi chấm có tên tiếng Việt; chưa chọn màu nào và không có 'Bỏ màu'", async () => {
    await mo(null);
    await act(async () => { cham().click(); });
    expect(bang()).toBeTruthy();
    expect(vong().map((b) => b.getAttribute("aria-label"))).toEqual(["Đỏ", "Cam", "Xanh lá", "Xanh dương", "Tím"]);
    expect(vong().map((b) => b.getAttribute("aria-checked"))).toEqual(["false", "false", "false", "false", "false"]);
    expect(bang()!.querySelector(".qn-clear")).toBeNull();
    expect(cham().getAttribute("aria-expanded")).toBe("true");
  });

  it("chọn một màu → lưu {color}, bảng đóng, tiêu điểm về chấm", async () => {
    const onLuu = await mo({ note: "Giữ chữ", color: null });
    await act(async () => { cham().click(); });
    await act(async () => { vong()[1].click(); });
    expect(onLuu).toHaveBeenCalledTimes(1);
    expect(onLuu).toHaveBeenCalledWith({ color: "orange" });   // CHỈ màu — chữ không bị gửi lại (máy chủ giữ nguyên)
    expect(bang()).toBeNull();
    expect(document.activeElement).toBe(cham());
  });

  it("màu đang chọn: aria-checked + dấu ✓; bấm LẠI chính nó = bỏ màu; 'Bỏ màu' cũng bỏ", async () => {
    const onLuu = await mo({ note: "x", color: "green" });
    await act(async () => { cham().click(); });
    expect(vong().map((b) => b.getAttribute("aria-checked"))).toEqual(["false", "false", "true", "false", "false"]);
    expect(vong()[2].querySelector("svg"), "chấm đang chọn phải có dấu ✓").toBeTruthy();
    expect(vong()[0].querySelector("svg")).toBeNull();
    await act(async () => { vong()[2].click(); });
    expect(onLuu).toHaveBeenLastCalledWith({ color: null });

    await act(async () => { cham().click(); });
    await act(async () => { (bang()!.querySelector(".qn-clear") as HTMLButtonElement).click(); });
    expect(onLuu).toHaveBeenLastCalledWith({ color: null });
    expect(onLuu).toHaveBeenCalledTimes(2);
  });

  it("mở bảng: tiêu điểm vào chấm đang chọn (hoặc chấm đầu); ←/→ đi vòng giữa các chấm", async () => {
    await mo({ note: "", color: "blue" });
    await act(async () => { cham().click(); });
    expect(document.activeElement).toBe(vong()[3]);
    await phim(document.activeElement!, "ArrowRight");
    expect(document.activeElement).toBe(vong()[4]);
    await phim(document.activeElement!, "ArrowRight");
    expect(document.activeElement, "đi vòng về chấm đầu").toBe(vong()[0]);
    await phim(document.activeElement!, "ArrowLeft");
    expect(document.activeElement, "đi vòng ngược về chấm cuối").toBe(vong()[4]);
  });

  it("Esc đóng bảng và trả tiêu điểm về chấm; bấm ra ngoài cũng đóng; bấm lại chấm = đóng", async () => {
    await mo(null);
    await act(async () => { cham().click(); });
    await phim(document.activeElement!, "Escape");
    expect(bang()).toBeNull();
    expect(document.activeElement).toBe(cham());

    await act(async () => { cham().click(); });
    expect(bang()).toBeTruthy();
    await bamNgoai();
    expect(bang()).toBeNull();

    await act(async () => { cham().click(); });
    await act(async () => { cham().click(); });
    expect(bang(), "bấm lại chấm phải ĐÓNG chứ không đóng-rồi-mở-lại").toBeNull();
  });

  it("bấm TRONG bảng không bị coi là bấm ra ngoài (bảng không tự đóng trước khi chọn kịp)", async () => {
    await mo(null);
    await act(async () => { cham().click(); });
    await act(async () => { bang()!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); });
    expect(bang()).toBeTruthy();
  });

  it("một lúc chỉ MỘT khung: mở bảng màu thì khung chữ đóng (và ngược lại)", async () => {
    await mo({ note: "abc", color: null });
    await act(async () => { chu().click(); });
    expect(khung()).toBeTruthy();
    await act(async () => { cham().dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); cham().click(); });
    expect(bang()).toBeTruthy();
    expect(khung(), "hai khung chồng nhau").toBeNull();
    await act(async () => { chu().click(); });
    expect(khung()).toBeTruthy();
    expect(bang(), "hai khung chồng nhau").toBeNull();
  });
});

describe("QuoteNote — chỉ đọc", () => {
  it("không có quyền sửa: chấm là ảnh mô tả (không bấm được); bấm chữ mở khung ĐỌC đủ chữ, không có ô nhập", async () => {
    const onLuu = await mo({ note: DAI, color: "purple", updatedByName: "Lan", updatedAt: "2026-09-30T02:00:00.000Z" }, false);
    expect(hop!.querySelector("button.qn-dot")).toBeNull();
    expect(hop!.querySelector(".qn-dot")!.getAttribute("role")).toBe("img");
    expect(hop!.querySelector(".qn-dot")!.getAttribute("aria-label")).toContain("Tím");
    await act(async () => { chu().click(); });
    expect(o(), "người chỉ đọc không được có ô nhập").toBeNull();
    expect(khung()!.querySelector(".qn-doc")!.textContent, "khung đọc không hiện đủ chữ").toBe(DAI);
    expect(khung()!.textContent).toContain("Lan");
    await act(async () => { nut(khung()!, "Đóng").click(); });
    expect(khung()).toBeNull();
    expect(onLuu).not.toHaveBeenCalled();
  });

  it("chỉ đọc + bấm ra ngoài / Esc chỉ ĐÓNG, không gọi lưu", async () => {
    const onLuu = await mo({ note: "Chỉ xem", color: null }, false);
    await act(async () => { chu().click(); });
    await bamNgoai();
    expect(khung()).toBeNull();
    await act(async () => { chu().click(); });
    await phim(document.activeElement!, "Escape");
    expect(khung()).toBeNull();
    expect(onLuu).not.toHaveBeenCalled();
  });

  it("chỉ đọc và chưa có ghi chú: dấu gạch, KHÔNG có nút nào (không mời người không có quyền)", async () => {
    await mo(null, false);
    expect(hop!.querySelectorAll("button").length).toBe(0);
    expect(hop!.querySelector(".qn-text")!.textContent).toBe("—");
  });
});
