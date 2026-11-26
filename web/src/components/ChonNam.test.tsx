/** @vitest-environment jsdom */
//
// BỘ CHỌN NĂM + THANH CUỘN NGANG NỔI (2026-11-26, chủ repo chuyển lời: "click vô năm 2026 thì chỉ thể hiện 2026 thôi",
// "chiều ngang em cho có thanh cuộn nha … ko show hết thông tin nên dễ bị miss", "cả danh sách báo giá hay gì tất cả luôn").
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ChonNam, demTheoNam, namHieuLuc, useNamDaNho, docNamDaNho } from "./ChonNam";
import { BangCuonNgang } from "./BangCuonNgang";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
const ve = (el: React.ReactElement) => {
  const hop = document.createElement("div");
  document.body.appendChild(hop);
  root = createRoot(hop);
  act(() => { root!.render(el); });
  return hop;
};
beforeEach(() => { try { localStorage.clear(); } catch { /* jsdom luôn có */ } });
afterEach(() => { if (root) act(() => root!.unmount()); root = null; document.body.innerHTML = ""; vi.restoreAllMocks(); });

describe("demTheoNam / namHieuLuc", () => {
  it("đếm theo năm, năm MỚI trước; dòng không có năm không thuộc năm nào", () => {
    const ds = [{ y: 2025 }, { y: 2026 }, { y: 2026 }, { y: null }, { y: undefined }, { y: "2024" }];
    expect(demTheoNam(ds, (r) => r.y)).toEqual([{ nam: "2026", dem: 2 }, { nam: "2025", dem: 1 }, { nam: "2024", dem: 1 }]);
  });
  it("năm đã nhớ mà dữ liệu không còn (hoặc chưa tải) → Tất cả, không giấu sạch bảng", () => {
    const cac = [{ nam: "2026", dem: 3 }];
    expect(namHieuLuc("2026", cac)).toBe("2026");
    expect(namHieuLuc("2024", cac)).toBe("");
    expect(namHieuLuc("2026", [])).toBe("");
    expect(namHieuLuc("", cac)).toBe("");
  });
});

describe("ChonNam", () => {
  it("không có năm nào → không vẽ gì", () => {
    const hop = ve(<ChonNam cacNam={[]} nam="" chon={() => {}} />);
    expect(hop.innerHTML).toBe("");
  });
  it("vẽ Tất cả + từng năm kèm số; nút đang chọn có aria-pressed; bấm gọi chon", () => {
    const chon = vi.fn();
    const hop = ve(<ChonNam cacNam={[{ nam: "2026", dem: 5 }, { nam: "2025", dem: 2 }]} nam="2025" chon={chon} tong={7} />);
    const nut = [...hop.querySelectorAll("button")];
    expect(nut.map((b) => b.textContent)).toEqual(["Tất cả7", "20265", "20252"]);
    expect(nut.map((b) => b.getAttribute("aria-pressed"))).toEqual(["false", "false", "true"]);
    act(() => { nut[1].click(); });
    expect(chon).toHaveBeenLastCalledWith("2026");
    act(() => { nut[0].click(); });
    expect(chon).toHaveBeenLastCalledWith("");
  });
  it("useNamDaNho nhớ năm qua các lần mở (localStorage), chọn Tất cả là quên", () => {
    let chonNgoai: (v: string) => void = () => {};
    function Thu() { const [n, chon] = useNamDaNho("thu.nam"); chonNgoai = chon; return <span id="n">{n || "-"}</span>; }
    const hop = ve(<Thu />);
    expect(hop.querySelector("#n")!.textContent).toBe("-");
    act(() => { chonNgoai("2025"); });
    expect(hop.querySelector("#n")!.textContent).toBe("2025");
    expect(docNamDaNho("thu.nam")).toBe("2025");
    act(() => { chonNgoai(""); });
    expect(docNamDaNho("thu.nam")).toBe("");
  });
});

describe("BangCuonNgang — thanh cuộn ngang nổi", () => {
  // jsdom không dàn trang: giả kích thước khung để có / không có tràn ngang.
  const giaKichThuoc = (scrollWidth: number, clientWidth: number) => {
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(function (this: HTMLElement) { return this.classList.contains("tbl-scroll") ? scrollWidth : 0; });
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) { return this.classList.contains("tbl-scroll") ? clientWidth : 0; });
  };
  it("bảng KHÔNG tràn → không có thanh nổi, khung giữ thanh cuộn gốc", () => {
    giaKichThuoc(800, 800);
    const hop = ve(<BangCuonNgang><table><tbody><tr><td>a</td></tr></tbody></table></BangCuonNgang>);
    expect(hop.querySelector("[data-testid=thanh-cuon-noi]")).toBeNull();
    expect(hop.querySelector(".tbl-scroll")!.classList.contains("co-thanh-noi")).toBe(false);
  });
  it("bảng TRÀN → có thanh nổi rộng đúng bằng bảng; kéo thanh thì bảng cuộn theo và ngược lại", () => {
    giaKichThuoc(2400, 900);
    const hop = ve(<BangCuonNgang className="list-wrap"><table><tbody><tr><td>a</td></tr></tbody></table></BangCuonNgang>);
    const khung = hop.querySelector(".tbl-scroll") as HTMLElement;
    const thanh = hop.querySelector("[data-testid=thanh-cuon-noi]") as HTMLElement;
    expect(thanh).not.toBeNull();
    expect(khung.className).toBe("tbl-scroll co-thanh-noi list-wrap");
    expect((thanh.firstElementChild as HTMLElement).style.width).toBe("2400px");
    act(() => { thanh.scrollLeft = 500; thanh.dispatchEvent(new Event("scroll")); });
    expect(khung.scrollLeft).toBe(500);
    act(() => { khung.scrollLeft = 120; khung.dispatchEvent(new Event("scroll")); });
    expect(thanh.scrollLeft).toBe(120);
  });
});
