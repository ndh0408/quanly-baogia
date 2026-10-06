/** @vitest-environment jsdom */
/**
 * GAP1-05 (audit 2026-09-22) — toast "Đã lưu" đè nút "⋯" (Tải Excel/PDF) của thanh dính đáy.
 *
 * LỖI: `#toast-host` là khối `fixed` ở góc phải-dưới, đúng chỗ nút ⋯. Chú thích CSS và commit ad017aa
 * khẳng định đã cho chuột "đi xuyên hộp chứa" (`pointer-events: none`) — dòng đó CHƯA TỪNG có trong
 * CSS, còn luật `bottom: 84px` bị khối thứ hai ghi đè thành mã chết. Đo được ở 1440×900:
 * `elementFromPoint` tại tâm nút ⋯ trả về `.toast-msg` → luồng "Lưu → ⋯ → Tải Excel" mất cú bấm đầu.
 *
 * jsdom không có layout nên phần "đè" kiểm qua hai thứ quyết định nó: toast được nâng lên trên thanh
 * khi đang ở trình soạn, và CSS thật sự cho chuột đi xuyên hộp chứa.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { toast } from "./ui";

// Đọc NGUYÊN VĂN styles.css. KHÔNG dùng `?raw`: vitest xử lý tệp .css riêng và trả chuỗi RỖNG (đã đo)
// — bài kiểm sẽ xanh/đỏ vì một chuỗi rỗng chứ không vì CSS thật. tsconfig của web/ là browser-scoped
// (không có @types/node) nên nạp node:fs bằng import động mang kiểu tự khai.
async function docCss(): Promise<string> {
  const fs = (await import(/* @vite-ignore */ "node:" + "fs")) as { readFileSync(p: string, e: "utf8"): string };
  // jsdom làm import.meta.url không còn là file:// — lấy theo thư mục chạy (vitest của web/ chạy
  // với cwd = web/, xem docs/development/TESTING.md).
  const cwd = (globalThis as unknown as { process: { cwd(): string } }).process.cwd();
  return fs.readFileSync(`${cwd}/src/styles.css`, "utf8");
}

afterEach(() => { document.body.innerHTML = ""; });

describe("toast không đè thanh nút của trình soạn", () => {
  it("đang ở trình soạn (.editor .actions) → hộp toast nâng lên trên thanh (bottom 84px)", () => {
    document.body.innerHTML = '<div class="editor"><div class="actions"><button>⋯</button></div></div>';
    toast("Đã lưu", "success");
    expect(document.getElementById("toast-host")!.style.bottom).toBe("84px");
  });

  // Thanh có mép trên ở `top` (toạ độ khung nhìn) và cao `cao` — jsdom không dàn trang nên tự đặt hộp. Cửa sổ jsdom cao 768px.
  const dinhThanh = (top: number, cao: number) => {
    const thanh = document.querySelector(".editor .actions") as HTMLElement;
    thanh.getBoundingClientRect = () => ({ top, bottom: top + cao, height: cao, left: 0, right: 0, width: 0, x: 0, y: top, toJSON() {} }) as DOMRect;
  };
  const day = () => window.innerHeight;
  const vaoSoan = () => { document.body.innerHTML = '<div class="editor"><div class="actions"><button>⋯</button></div></div>'; };
  const bottom = () => document.getElementById("toast-host")!.style.bottom;

  it("thanh CAO hơn một hàng (lớp hai hàng ~100px, dính đáy) → toast nâng theo mép trên THẬT + 21px, không cố định 84px", () => {
    vaoSoan();
    dinhThanh(day() - 100.4, 100.4);
    toast("Đã lưu", "success");
    // ceil(100.4) + 21 = 122 — làm tròn LÊN để không hở nửa điểm ảnh đè lên mép trên của thanh
    expect(bottom()).toBe("122px");
  });

  it("thanh THẤP dính đáy (một hàng 63px, hoặc dải cuộn điện thoại 55px) → vẫn giữ sàn 84px như trước", () => {
    vaoSoan();
    dinhThanh(day() - 63, 63);
    toast("Đã lưu", "success");
    expect(bottom()).toBe("84px");
    dinhThanh(day() - 55, 55);
    toast("Đã lưu lần nữa", "success");
    expect(bottom()).toBe("84px");
  });

  it("CUỘN HẾT TRANG: thanh đứng ở chỗ tĩnh, cao hơn đáy cửa sổ 53px → toast đặt theo MÉP TRÊN của thanh, không theo chiều cao", () => {
    // Đo 2026-10-06 ở 1280×720 / 1366×768 / 1024×768: đặt theo chiều cao (63 + 21 = 84px) thì toast đè "⋯" 43×13px.
    vaoSoan();
    dinhThanh(day() - 53 - 63, 63);
    toast("Đã lưu", "success");
    expect(bottom()).toBe(`${53 + 63 + 21}px`);
  });

  it("trang NGẮN: thanh nằm hẳn phía trên vùng toast → không nâng (vị trí mặc định của CSS)", () => {
    vaoSoan();
    dinhThanh(200, 63);
    toast("Đã lưu", "success");
    expect(bottom()).toBe("");
  });

  it("đo LẠI sau hai khung hình: toast sinh giữa lúc lưu (thanh tạm thấp) vẫn kịp nâng khi thanh cao lên", () => {
    // Lớp hai hàng: GridTable tạm gỡ nhóm thêm hàng lúc lưu → thanh 79px, vẽ lại xong 93px (đo 2026-10-06, 1024×768).
    const hang: FrameRequestCallback[] = [];
    const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation((f) => { hang.push(f); return hang.length; });
    try {
      vaoSoan();
      dinhThanh(day() - 79, 79);
      toast("Đã lưu", "success");
      expect(bottom()).toBe(`${79 + 21}px`);
      dinhThanh(day() - 93, 93);
      while (hang.length) hang.shift()!(0);
      expect(bottom()).toBe(`${93 + 21}px`);
    } finally {
      raf.mockRestore();
    }
  });

  it("ngoài trình soạn → vị trí mặc định của CSS (không đặt inline)", () => {
    toast("Xong", "info");
    expect(document.getElementById("toast-host")!.style.bottom).toBe("");
  });

  it("CSS: hộp chứa cho chuột đi xuyên, từng toast nhận lại chuột; không còn khối #toast-host chết", async () => {
    const css = await docCss();
    expect(css.length).toBeGreaterThan(1000);
    const khoi = [...css.matchAll(/#toast-host\s*\{([^}]*)\}/g)].map((m) => m[1]);
    expect(khoi.length, "hai khối #toast-host — khối sau ghi đè khối trước").toBe(1);
    expect(khoi[0]).toMatch(/pointer-events:\s*none/);
    expect(css).toMatch(/#toast-host\s*>\s*\.toast\s*\{[^}]*pointer-events:\s*auto/);
  });
});
