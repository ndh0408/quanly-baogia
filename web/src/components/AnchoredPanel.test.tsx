/** @vitest-environment jsdom */
/**
 * ============================================================================
 * HỘP BUNG NEO THEO NÚT — ĐÓNG ĐÚNG LÚC, VÀ KHÔNG ĐÓNG SAI LÚC.
 *
 * ── VÌ SAO CÓ TỆP NÀY ──────────────────────────────────────────────────────
 * `AnchoredPanel` sinh ra để chữa việc menu "⋯" và bảng phím tắt bị thanh nút đáy cắt mất trên màn
 * thấp (thanh đó bật `overflow-x: auto`, mà chuẩn CSS Overflow ép trục còn lại thành `auto` theo,
 * nên `overflow-y: visible` vô tác dụng). Cách chữa là render ra `document.body` qua portal.
 *
 * Nhưng bản đầu đóng hộp khi có BẤT KỲ sự kiện `scroll` nào, ở chế độ CAPTURE:
 *
 *     document.addEventListener("scroll", onClose, true);
 *
 * Chính hộp này có `maxHeight` + `overflow: auto`, tức nó LÀ một vùng cuộn. Nên cuộn bên trong menu
 * làm menu tự đóng. ĐÃ ĐỎ THẬT ở cổng [12] ui-smoke: Playwright cuộn mục vào tầm nhìn trước khi
 * bấm, lượt cuộn đó nằm trong hộp → hộp đóng → `page.click` hết giờ 30 giây.
 *
 * Đó là lỗi DÙNG THẬT chứ không phải chuyện riêng của kịch bản test: menu dài, người dùng lăn chuột
 * để đọc mục cuối là menu biến mất.
 *
 * ── DOCBLOCK `@vitest-environment jsdom` Ở DÒNG ĐẦU ────────────────────────
 * `web/vite.config.ts` không khai khối `test` nên vitest lấy mặc định `environment: "node"` — thiếu
 * dòng này thì mọi bài ở đây ném `ReferenceError: document is not defined`.
 * ============================================================================
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { AnchoredPanel } from "./AnchoredPanel";

let thung: HTMLDivElement;
let goc: Root;

beforeEach(() => {
  thung = document.createElement("div");
  document.body.appendChild(thung);
  goc = createRoot(thung);
});

afterEach(() => {
  act(() => goc.unmount());
  thung.remove();
  document.body.innerHTML = "";
});

/** Dựng một nút neo + hộp; trả về hàm đóng đã bị theo dõi. */
function dung({ open = true } = {}) {
  const nut = document.createElement("button");
  nut.textContent = "⋯";
  document.body.appendChild(nut);
  const neo = createRef<HTMLElement>();
  (neo as { current: HTMLElement | null }).current = nut;
  const onClose = vi.fn();
  act(() => {
    goc.render(
      <AnchoredPanel anchorRef={neo} open={open} onClose={onClose} className="kebab-menu" role="menu" label="Thêm thao tác">
        <button role="menuitem">Tải Excel gửi khách</button>
      </AnchoredPanel>,
    );
  });
  return { nut, onClose };
}

/** Hộp đang mở. NÉM nếu không có — thông điệp rõ hơn hẳn `null` lặng lẽ ở dòng kế tiếp. */
const hop = (): HTMLElement => {
  const p = document.querySelector<HTMLElement>(".anchored-pop");
  if (!p) throw new Error("không có hộp nào đang mở");
  return p;
};
/** Dùng khi CHỜ ĐỢI không có hộp. */
const hopNeuCo = () => document.querySelector<HTMLElement>(".anchored-pop");

/** Mục trong menu. Cũng ném cho rõ. */
const mucMenu = (): HTMLElement => {
  const m = hop().querySelector<HTMLElement>('[role="menuitem"]');
  if (!m) throw new Error("hộp không có mục menu nào");
  return m;
};

describe("AnchoredPanel", () => {
  it("mở thì render Ở BODY, không nằm trong cụm nút", () => {
    // Đây là toàn bộ lý do component này tồn tại: nằm trong cụm nút thì bị khung cuộn cắt.
    dung();
    const p = hop();
    expect(p.parentElement, "hộp phải là con TRỰC TIẾP của body").toBe(document.body);
    expect(p.getAttribute("role")).toBe("menu");
    expect(p.className).toContain("kebab-menu");
    expect(p.textContent).toContain("Tải Excel gửi khách");
  });

  it("đóng thì KHÔNG render gì cả", () => {
    dung({ open: false });
    expect(hopNeuCo()).toBeNull();
  });

  it("CUỘN BÊN TRONG hộp KHÔNG làm đóng — đây là lỗi đã làm đỏ ui-smoke", () => {
    // Nếu bài này đỏ thì menu dài không đọc được: lăn chuột một cái là mất.
    const { onClose } = dung();
    act(() => { mucMenu().dispatchEvent(new Event("scroll", { bubbles: true })); });
    expect(onClose, "cuộn trong hộp mà hộp tự đóng").not.toHaveBeenCalled();
  });

  it("cuộn NGOÀI hộp thì ĐÓNG — hộp `fixed` không đi theo nút được", () => {
    // Vế đối trọng: bỏ hẳn việc đóng theo cuộn thì hộp đứng yên một chỗ trong khi nút neo trôi đi,
    // và người dùng thấy một menu lơ lửng chẳng dính vào đâu.
    const { onClose } = dung();
    act(() => { document.dispatchEvent(new Event("scroll", { bubbles: true })); });
    expect(onClose, "cuộn trang mà hộp vẫn dính lại một chỗ").toHaveBeenCalled();
  });

  it("Escape thì đóng", () => {
    const { onClose } = dung();
    act(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    expect(onClose).toHaveBeenCalled();
  });

  it("bấm NGOÀI thì đóng, bấm TRONG hộp hoặc TRÊN NÚT thì không", () => {
    const { nut, onClose } = dung();
    // trong hộp
    act(() => { mucMenu().dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); });
    expect(onClose, "bấm vào chính mục trong menu mà menu đóng trước khi kịp chạy").not.toHaveBeenCalled();
    // trên nút neo (nút tự lo bật/tắt — đóng ở đây nữa thành bật rồi tắt ngay)
    act(() => { nut.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); });
    expect(onClose).not.toHaveBeenCalled();
    // ra ngoài
    act(() => { document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); });
    expect(onClose).toHaveBeenCalled();
  });
});
