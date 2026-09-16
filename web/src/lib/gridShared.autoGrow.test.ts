/**
 * ============================================================================
 * `autoGrow` KHÔNG ĐƯỢC GHI–ĐỌC XEN KẼ (layout thrashing).
 *
 * ── LỖI ────────────────────────────────────────────────────────────────────
 * Bản trước gọi `measureNow` trong vòng lặp, mà hàm đó làm GHI (`height="auto"`) rồi ĐỌC
 * (`scrollHeight`) cho TỪNG ô. Gom cả lô vào một `requestAnimationFrame` KHÔNG gộp được các lượt
 * tính bố cục: mỗi vòng lặp lại vô hiệu hoá bố cục rồi lại ép trình duyệt tính lại ngay.
 *
 * Chú thích trong mã còn khai ngược lại — "các lần đọc scrollHeight dồn lại chỉ gây một lượt tính
 * bố cục" — nên không ai kiểm lại suốt thời gian đó.
 *
 * ── ĐO TRÊN TRÌNH DUYỆT THẬT ───────────────────────────────────────────────
 * Báo giá #264 trên dev (9 trang, 366 dòng → 403 ô textarea), Chrome với CPU chậm 4× để giả lập
 * máy i5 đời 6000 của công ty:
 *     ghi–đọc xen kẽ (bản cũ)    1.627 ms
 *     tách ba lượt (bản mới)         81 ms     ← nhanh hơn 20 lần
 * DevTools báo tổng "forced reflow" của cả lần tải là 1.860 ms trên LCP 3.381 ms — riêng chỗ này
 * chiếm gần trọn phần đó.
 *
 * ── VÌ SAO KIỂM THEO THỨ TỰ, KHÔNG KIỂM THEO THỜI GIAN ────────────────────
 * jsdom không có bố cục: `scrollHeight` luôn là 0 và không lượt tính bố cục nào xảy ra, nên đo thời
 * gian ở đây sẽ luôn xanh dù mã sai. Thứ CHỨNG MINH được là THỨ TỰ các thao tác — và đó cũng đúng
 * là thứ quyết định trình duyệt có phải tính lại bố cục hay không.
 * ============================================================================
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { autoGrow } from "./gridShared";

/** Textarea giả: ghi lại THỨ TỰ mọi lượt ghi `style.height` và đọc `scrollHeight`. */
function oGia(ten: string, nhatKy: string[]) {
  const style = {
    _h: "",
    get height() { return this._h; },
    set height(v: string) { this._h = v; nhatKy.push(`GHI:${ten}`); },
  };
  return {
    ten,
    isConnected: true,
    style,
    get scrollHeight() { nhatKy.push(`DOC:${ten}`); return 42; },
  } as unknown as HTMLTextAreaElement;
}

describe("autoGrow — gộp bố cục", () => {
  let chayRaf: (() => void)[] = [];

  beforeEach(() => {
    chayRaf = [];
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => { chayRaf.push(cb); return chayRaf.length; });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("một lô nhiều ô → GHI hết, rồi ĐỌC hết, rồi GHI hết (không xen kẽ)", () => {
    const nhatKy: string[] = [];
    const els = ["a", "b", "c", "d"].map((t) => oGia(t, nhatKy));
    for (const e of els) autoGrow(e);

    expect(chayRaf.length, "phải gom vào ĐÚNG MỘT khung hình, không xếp nhiều rAF").toBe(1);
    chayRaf[0]();

    const loai = nhatKy.map((x) => x.split(":")[0]);
    // Đây là vế quyết định: mọi lượt ĐỌC phải nằm trong MỘT khối liên tục, không có GHI xen vào.
    // Ghi-đọc xen kẽ cho ra G,D,G,G,D,G… — mỗi cặp là một lượt tính bố cục bị ép.
    const dauDoc = loai.indexOf("DOC");
    const cuoiDoc = loai.lastIndexOf("DOC");
    expect(dauDoc, "không có lượt đọc scrollHeight nào — hàm không còn đo gì?").toBeGreaterThanOrEqual(0);
    expect(
      loai.slice(dauDoc, cuoiDoc + 1).every((x) => x === "DOC"),
      `có thao tác GHI xen giữa các lượt ĐỌC → ép tính lại bố cục nhiều lần. Thứ tự thật: ${loai.join(",")}`,
    ).toBe(true);

    // Và phải đo ĐỦ mọi ô, đúng một lần mỗi ô.
    expect(nhatKy.filter((x) => x.startsWith("DOC")).sort()).toEqual(["DOC:a", "DOC:b", "DOC:c", "DOC:d"]);
  });

  it("ô đã bị gỡ khỏi DOM thì KHÔNG đo — tránh ép bố cục cho thứ không hiển thị", () => {
    const nhatKy: string[] = [];
    const song = oGia("song", nhatKy);
    const chet = oGia("chet", nhatKy);
    (chet as unknown as { isConnected: boolean }).isConnected = false;
    autoGrow(song);
    autoGrow(chet);
    chayRaf[0]();
    expect(nhatKy.filter((x) => x.includes("chet"))).toEqual([]);
    expect(nhatKy.some((x) => x === "DOC:song")).toBe(true);
  });

  it("gọi lại cùng một ô nhiều lần trong một khung hình chỉ đo MỘT lần", () => {
    // Gõ 20 ký tự trong một frame không được thành 20 lượt đo.
    const nhatKy: string[] = [];
    const el = oGia("x", nhatKy);
    for (let i = 0; i < 20; i++) autoGrow(el);
    expect(chayRaf.length).toBe(1);
    chayRaf[0]();
    expect(nhatKy.filter((x) => x === "DOC:x").length).toBe(1);
  });

  it("không có requestAnimationFrame thì vẫn đo được (không câm lặng bỏ qua)", () => {
    vi.unstubAllGlobals();
    vi.stubGlobal("requestAnimationFrame", undefined);
    const nhatKy: string[] = [];
    autoGrow(oGia("y", nhatKy));
    expect(nhatKy.some((x) => x === "DOC:y"), "môi trường không có rAF thì ô không bao giờ tự cao").toBe(true);
  });

  it("null thì im lặng bỏ qua, không ném", () => {
    expect(() => autoGrow(null)).not.toThrow();
  });
});
