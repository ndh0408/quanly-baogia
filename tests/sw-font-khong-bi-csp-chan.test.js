/**
 * ============================================================================
 * L73 (soát toàn diện) · Font Be Vietnam Pro KHÔNG BAO GIỜ tải được khi service worker điều khiển trang.
 *
 * LỖI LÀ GÌ
 *   web/vite.config.ts khai một route runtimeCaching CacheFirst cho fonts.googleapis.com /
 *   fonts.gstatic.com. Từ lần mở thứ hai (SW đã điều khiển trang), yêu cầu CSS/woff2 của Google đi vào
 *   SW, và Workbox tự gọi fetch() tới Google BÊN TRONG SW. SW bị ràng buộc bởi CSP gửi kèm CHÍNH script
 *   của nó — helmet (src/app.ts) gắn cùng một CSP cho mọi phản hồi, kể cả /app2/sw.js — mà CSP đó có
 *   `connect-src 'self'` → net::ERR_FAILED. Không có @font-face nào; cả app rơi về system-ui/Segoe UI,
 *   cho MỌI người dùng từ lần mở thứ hai.
 *
 * TÁI HIỆN (2026-09-24, Chrome thật): build web ra thư mục tạm, phục vụ bằng helmet cùng cấu hình
 *   CSP của src/app.ts. Lần đầu: document.fonts = 15 mặt Be Vietnam Pro. Tải lại (controller = true):
 *   document.fonts = 0, fonts.googleapis.com responseStatus 0 sau 3 ms, caches chỉ có workbox-precache.
 *
 * CÁCH SỬA: bỏ route đó — không có route khớp thì Workbox không gọi respondWith, trình duyệt tự tải
 *   theo CSP của TRANG (style-src / font-src đã cho Google). KHÔNG nới connect-src: helmet dùng MỘT CSP
 *   cho cả app, nới ở đây là mở connect-src ra ngoài cho toàn bộ mã chạy trên trang.
 *
 * Bài này là chốt tổng quát: MỌI route runtimeCaching trỏ ra origin ngoài phải nằm trong connect-src,
 * nếu không SW sẽ tự chặn chính nó. Đọc tệp dạng văn bản — không đụng CSDL.
 * ============================================================================
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../src/app.ts", import.meta.url), "utf8");
const vite = readFileSync(new URL("../web/vite.config.ts", import.meta.url), "utf8").replace(/^\s*\/\/.*$/gm, "");
const html = readFileSync(new URL("../web/index.html", import.meta.url), "utf8");

/** Nguồn của một chỉ thị CSP khai trong src/app.ts (khối helmet `directives`). */
function chiThi(ten) {
  const m = new RegExp(`"${ten}":\\s*\\[([^\\]]*)\\]`).exec(app);
  return m ? [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]) : null;
}
/** Khối `runtimeCaching: [...]` của workbox (cân ngoặc vuông). */
function khoiRuntimeCaching() {
  const i = vite.indexOf("runtimeCaching:");
  if (i < 0) return "";
  const a = vite.indexOf("[", i);
  let sau = 0;
  for (let j = a; j < vite.length; j++) {
    if (vite[j] === "[") sau++;
    if (vite[j] === "]" && --sau === 0) return vite.slice(a, j + 1);
  }
  return vite.slice(a);
}

describe("L73 — service worker không chặn chính yêu cầu nó bắt", () => {
  it("đọc được connect-src của CSP", () => {
    expect(chiThi("connect-src")).toEqual(["'self'"]);
  });

  it("mọi route runtimeCaching trỏ ra origin ngoài đều nằm trong connect-src (SW fetch theo CSP của sw.js)", () => {
    const connect = chiThi("connect-src");
    const ngoai = [...new Set([...khoiRuntimeCaching().matchAll(/https?:\/\/[\w.-]+/g)].map((m) => m[0]))];
    const biChan = ngoai.filter((o) => !connect.includes(o));
    expect(biChan, `SW sẽ fetch tới ${biChan.join(", ")} nhưng connect-src chỉ cho ${connect.join(" ")}`).toEqual([]);
  });

  it("font vẫn tải được bằng đường của TRANG: index.html nạp CSS Google, style-src/font-src cho phép", () => {
    expect(html).toMatch(/<link href="https:\/\/fonts\.googleapis\.com\/css2\?family=Be\+Vietnam\+Pro[^"]*" rel="stylesheet"/);
    expect(chiThi("style-src")).toContain("https://fonts.googleapis.com");
    expect(chiThi("font-src")).toContain("https://fonts.gstatic.com");
  });
});
