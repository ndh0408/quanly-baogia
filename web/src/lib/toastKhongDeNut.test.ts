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
import { describe, it, expect, afterEach } from "vitest";
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
