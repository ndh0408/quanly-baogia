/** @vitest-environment jsdom */
//
// Ô CHỌN NHIỀU của bộ lọc Danh sách báo giá (Người tạo, Công ty…). Kiểm đúng những gì NGƯỜI DÙNG làm — mở, tích/bỏ tích,
// tìm không dấu, bỏ chọn, Esc/bấm ra ngoài — và hai điều dễ vỡ âm thầm: giá trị ĐANG chọn mà danh sách đếm lượt sau không còn
// trả về VẪN hiện (không thì tích rồi không gỡ được nữa), và tiêu điểm về đúng nút mở khi đóng bằng bàn phím.
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ChonNhieu, type TuyChon } from "./ChonNhieu";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let hop: HTMLDivElement | null = null;
afterEach(() => { if (root) act(() => root!.unmount()); root = null; hop?.remove(); hop = null; document.body.innerHTML = ""; vi.restoreAllMocks(); });
const cho = (ms = 0) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

const NGUOI: TuyChon[] = [{ value: "7", nhan: "Nguyễn Văn Ánh", dem: 12 }, { value: "8", nhan: "Trần Thị Bình", dem: 3 }];
const DAI: TuyChon[] = ["Nguyễn Văn Ánh", "Trần Thị Bình", "Lê Hoàng", "Phạm Đức", "Đặng Thu", "Võ Minh", "Bùi Lan", "Hồ Sen"].map((nhan, i) => ({ value: String(i + 1), nhan, dem: i }));

/** Có trạng thái (component là kiểm soát từ ngoài); `onChange` ghi lại mọi lần đổi. */
async function mo(tuyChon: TuyChon[], dau: string[] = [], extra: { tenCu?: Record<string, string>; trong?: string } = {}) {
  const onChange = vi.fn();
  function Khung() {
    const [chon, setChon] = useState(dau);
    return <ChonNhieu nhan="Người tạo" tuyChon={tuyChon} chon={chon} tenCu={extra.tenCu} trong={extra.trong} onChange={(v) => { onChange(v); setChon(v); }} />;
  }
  hop = document.createElement("div"); document.body.appendChild(hop);
  root = createRoot(hop);
  await act(async () => { root!.render(<Khung />); });
  return onChange;
}
const nut = () => hop!.querySelector("button.cn-nut") as HTMLButtonElement;
const bang = () => document.querySelector(".bang-noi") as HTMLElement | null;
const dong = () => [...document.querySelectorAll<HTMLLabelElement>(".bang-noi label.cn-dong")];
const tich = (i: number) => dong()[i].querySelector("input") as HTMLInputElement;
const oTim = () => document.querySelector("input.cn-tim") as HTMLInputElement | null;
const nutChan = (ten: string) => [...document.querySelectorAll<HTMLButtonElement>(".cn-chan button")].find((b) => b.textContent === ten)!;
function go(el: HTMLInputElement, v: string) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")!.set!;
  act(() => { setter.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true })); });
}
const phim = (key: string) => act(async () => { document.body.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })); });
const bamNgoai = () => act(async () => { document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); });

describe("ChonNhieu — mở, tích, đóng", () => {
  it("ban đầu ĐÓNG; bấm nút → mở bảng có tên + danh sách kèm SỐ ĐẾM; aria-expanded đổi theo", async () => {
    await mo(NGUOI);
    expect(bang()).toBeNull();
    expect(nut().getAttribute("aria-expanded")).toBe("false");
    await act(async () => { nut().click(); });
    expect(bang()!.getAttribute("role")).toBe("dialog");
    expect(bang()!.getAttribute("aria-label")).toBe("Người tạo");
    expect(nut().getAttribute("aria-expanded")).toBe("true");
    expect(dong().map((d) => d.textContent)).toEqual(["Nguyễn Văn Ánh12", "Trần Thị Bình3"]);
  });

  it("tích / bỏ tích → onChange nhận MẢNG chuỗi id theo thứ tự chọn; nút hiện số đã chọn + nền nổi bật", async () => {
    const onChange = await mo(NGUOI);
    expect(nut().className).not.toContain("co-chon");
    expect(nut().querySelector(".cn-sl")).toBeNull();
    await act(async () => { nut().click(); });
    await act(async () => { tich(1).click(); });
    await act(async () => { tich(0).click(); });
    expect(onChange.mock.calls.map((c) => c[0])).toEqual([["8"], ["8", "7"]]);
    expect(nut().className).toContain("co-chon");
    expect(nut().querySelector(".cn-sl")!.textContent).toBe("2");
    expect(nut().querySelector(".cn-sl")!.getAttribute("aria-label")).toBe("2 đã chọn");
    await act(async () => { tich(1).click(); });
    expect(onChange.mock.lastCall![0]).toEqual(["7"]);
  });

  it("giá trị ĐANG chọn mà danh sách đếm không còn trả về VẪN hiện (tên đã biết, không thì #id) — tích rồi phải gỡ được", async () => {
    const onChange = await mo(NGUOI, ["7", "99", "55"], { tenCu: { "99": "Người Đã Nghỉ" } });
    await act(async () => { nut().click(); });
    const chu = dong().map((d) => d.querySelector(".cn-ten")!.textContent);
    expect(chu.slice(0, 2).sort()).toEqual(["#55", "Người Đã Nghỉ"].sort());
    expect(chu).toContain("Nguyễn Văn Ánh");
    const iDaNghi = chu.indexOf("Người Đã Nghỉ");
    expect(tich(iDaNghi).checked).toBe(true);
    await act(async () => { tich(iDaNghi).click(); });
    expect(onChange.mock.lastCall![0]).toEqual(["7", "55"]);
    // Mục chỉ còn do người dùng đang chọn thì số đếm là 0, không bỏ trống.
    expect(dong().find((d) => d.textContent?.includes("#55"))!.querySelector(".cn-dem")!.textContent).toBe("0");
  });

  it("danh sách rỗng → thông báo `trong`, vẫn có chân bảng; 'Bỏ chọn' mờ khi chưa chọn gì và xoá hết khi bấm", async () => {
    await mo([], [], { trong: "Chưa có người tạo nào" });
    await act(async () => { nut().click(); });
    expect(bang()!.textContent).toContain("Chưa có người tạo nào");
    expect(nutChan("Bỏ chọn").disabled).toBe(true);
    act(() => root!.unmount()); root = null; hop!.remove(); document.body.innerHTML = "";

    const onChange = await mo(NGUOI, ["7", "8"]);
    await act(async () => { nut().click(); });
    expect(nutChan("Bỏ chọn").disabled).toBe(false);
    await act(async () => { nutChan("Bỏ chọn").click(); });
    expect(onChange.mock.lastCall![0]).toEqual([]);
    expect(nut().querySelector(".cn-sl")).toBeNull();
  });

  it("mở ra thì tiêu điểm VÀO bảng (bàn phím Tab đi tiếp trong bảng, không nhảy sang ô sau nút): hộp tìm nếu có, không thì chính bảng", async () => {
    await mo(NGUOI);
    await act(async () => { nut().click(); });
    expect(bang()!.contains(document.activeElement), "bảng mở mà tiêu điểm vẫn ở nút mở").toBe(true);
    expect(document.activeElement).toBe(bang());
    await phim("Escape");
    act(() => root!.unmount()); root = null; hop!.remove(); document.body.innerHTML = "";
    await mo(DAI);   // ≥7 lựa chọn → có hộp tìm (autoFocus) và KHÔNG bị giành tiêu điểm
    await act(async () => { nut().click(); });
    expect(document.activeElement).toBe(oTim());
  });

  it("Esc đóng và TRẢ tiêu điểm về nút mở; 'Xong' cũng vậy; bấm ra ngoài đóng KHÔNG giành tiêu điểm", async () => {
    await mo(NGUOI);
    await act(async () => { nut().click(); });
    await phim("Escape");
    expect(bang()).toBeNull();
    expect(document.activeElement).toBe(nut());

    await act(async () => { nut().click(); });
    (document.activeElement as HTMLElement).blur();
    await act(async () => { nutChan("Xong").click(); });
    expect(bang()).toBeNull();
    expect(document.activeElement).toBe(nut());

    await act(async () => { nut().click(); });
    (document.activeElement as HTMLElement).blur?.();
    await bamNgoai();
    expect(bang()).toBeNull();
    expect(document.activeElement).not.toBe(nut());
  });

  it("bấm TRONG bảng không đóng nó; bấm lại nút mở thì đóng (nút tự bật/tắt, không đóng rồi mở lại)", async () => {
    await mo(NGUOI);
    await act(async () => { nut().click(); });
    await act(async () => { bang()!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); });
    expect(bang()).toBeTruthy();
    // mousedown trên CHÍNH nút mở không tính là "ngoài" — để click sau đó tự đóng.
    await act(async () => { nut().dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); nut().click(); });
    expect(bang()).toBeNull();
  });
});

describe("ChonNhieu — hộp tìm", () => {
  it("chỉ hiện hộp tìm khi có từ 7 lựa chọn (ít hơn thì cuộn mắt là đủ)", async () => {
    await mo(NGUOI);
    await act(async () => { nut().click(); });
    expect(oTim()).toBeNull();
    act(() => root!.unmount()); root = null; hop!.remove(); document.body.innerHTML = "";
    await mo(DAI);
    await act(async () => { nut().click(); });
    expect(oTim()).toBeTruthy();
    expect(oTim()!.getAttribute("aria-label")).toBe("Tìm người tạo");
  });

  it("tìm KHÔNG DẤU, không phân hoa thường: 'nguyen' ra 'Nguyễn Văn Ánh', 'dang' ra 'Đặng Thu'; không khớp → báo rõ", async () => {
    await mo(DAI);
    await act(async () => { nut().click(); });
    go(oTim()!, "nguyen");
    expect(dong().map((d) => d.querySelector(".cn-ten")!.textContent)).toEqual(["Nguyễn Văn Ánh"]);
    go(oTim()!, "DANG");
    expect(dong().map((d) => d.querySelector(".cn-ten")!.textContent)).toEqual(["Đặng Thu"]);
    go(oTim()!, "zzz");
    expect(dong()).toHaveLength(0);
    expect(bang()!.textContent).toContain("Không có “zzz”.");
  });

  it("đóng rồi mở lại thì ô tìm sạch (không giữ từ khoá cũ làm người dùng tưởng danh sách thiếu)", async () => {
    await mo(DAI);
    await act(async () => { nut().click(); });
    go(oTim()!, "nguyen");
    await phim("Escape");
    await act(async () => { nut().click(); });
    expect(oTim()!.value).toBe("");
    expect(dong()).toHaveLength(8);
  });

  it("tích trong kết quả tìm vẫn ghi đúng id (không lệch theo vị trí đã lọc)", async () => {
    const onChange = await mo(DAI);
    await act(async () => { nut().click(); });
    go(oTim()!, "hoang");
    await act(async () => { tich(0).click(); });
    expect(onChange.mock.lastCall![0]).toEqual(["3"]);   // "Lê Hoàng" là #3
    await cho();
  });
});
