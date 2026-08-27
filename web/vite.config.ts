import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// ── REACT PHẢI LÀ BẢN PRODUCTION, BẤT KỂ NODE_ENV CỦA MÁY ĐANG BUILD ──────────
// Vite tính `isProduction` từ `process.env.NODE_ENV ?? mode`, tức nó ĐỌC biến môi trường của tiến
// trình gọi nó. Ai build khi shell đang có `NODE_ENV=test` (chính `scripts/verify-local.sh` export
// như vậy) hay `NODE_ENV=development` sẽ nhận BẢN DEV của React trong bundle giao cho người dùng.
// Số đo trên repo này: 767.695 byte (dev) so với 463.630 byte (prod) — phình 65%. Và dung lượng là
// phần NHẸ nhất:
//   · <StrictMode> ở web/src/main.tsx CHẠY LẠI mọi useEffect một lần nữa ở bản dev. Hiệu ứng nạp
//     của QuoteEditor gọi `takePendingNewQuote()` — hàm LẤY-RỒI-XOÁ — nên lượt chạy thứ hai nhận
//     null: mọi thông tin người dùng vừa điền qua 3 bước wizard biến mất, trình soạn mở ra trống
//     trơn. (Đo được bằng scripts/ci/ui-smoke.mjs [U11], không phải suy luận.)
//   · mọi cảnh báo/kiểm tra chỉ-dành-cho-dev của React chạy trên máy khách.
// Ảnh Docker tình cờ thoát vì stage `webbuild` không đặt NODE_ENV — nhưng "tình cờ" không phải là
// cổng. Chốt cứng ở đây; cổng kiểm là scripts/ci/check-web-bundle.mjs.
//
// HAI LỚP, vì mỗi lớp bịt một đường khác nhau:
//   1. đặt `process.env.NODE_ENV` TRƯỚC khi trả cấu hình → Vite tính `isProduction` đúng, kéo theo
//      điều kiện resolve của React (chỉ `define` thôi thì ra 562.038 byte — vẫn sai).
//   2. `define` → mọi tham chiếu `process.env.NODE_ENV` còn sót trong mã nguồn bị thay tĩnh.
//
// App React phục vụ tại /app2 (Express serve thư mục public/app2). Dev proxy /api → :3000.
export default defineConfig(({ mode, command }) => {
  if (command === "build" && process.env.NODE_ENV !== "production") process.env.NODE_ENV = "production";
  return {
    ...(command === "build" ? { define: { "process.env.NODE_ENV": '"production"' } } : {}),
    // Hỗ trợ máy/ĐT đời cũ qua build.target THẤP (es2017: phủ Chrome 58+/Safari 11+ ~2017+), KHÔNG dùng
    // @vitejs/plugin-legacy: plugin đó chèn inline + data: script (dò trình duyệt) → VI PHẠM CSP `script-src 'self'`
    // của app (chặn nên React không mount). Hi sinh trình duyệt tiền-ESM (gần như tuyệt chủng) để giữ CSP bảo mật.
    // `vite build --mode bench` → build KÈM trang đo hiệu năng (/app2/bench.html). Build thường thì
    // trang đo KHÔNG lọt vào bản giao cho người dùng.
    build: {
      target: "es2017",
      outDir: "../public/app2",
      emptyOutDir: true,
      ...(mode === "bench" ? { rollupOptions: { input: { main: "index.html", bench: "bench.html" } } } : {}),
    },
    plugins: [
      react(),
      // PWA: cài như app + tải app-shell nhanh (offline được phần tĩnh). KHÔNG cache /api (data động).
      VitePWA({
        registerType: "autoUpdate",
        includeAssets: ["icon.svg", "apple-touch-icon.png"],
        manifest: {
          name: "Quản lý · Gia Nguyễn",
          short_name: "Gia Nguyễn",
          description: "Hệ thống báo giá & nhân sự Gia Nguyễn / Colorfull",
          lang: "vi",
          theme_color: "#1b2034",
          background_color: "#1b2034",
          display: "standalone",
          start_url: "/app2/",
          scope: "/app2/",
          icons: [
            { src: "icon-192.png", sizes: "192x192", type: "image/png" },
            { src: "icon-512.png", sizes: "512x512", type: "image/png" },
            { src: "icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          ],
        },
        workbox: {
          // SPA fallback nhưng KHÔNG đụng /api (để data luôn lấy mạng, không phục vụ bản cache cũ).
          navigateFallback: "/app2/index.html",
          navigateFallbackDenylist: [/^\/api/],
          globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
          runtimeCaching: [
            {
              // Font Google: cache lâu (ít đổi) → tải lại nhanh, đỡ phụ thuộc mạng.
              urlPattern: ({ url }: { url: URL }) =>
                url.origin === "https://fonts.googleapis.com" || url.origin === "https://fonts.gstatic.com",
              handler: "CacheFirst",
              options: { cacheName: "google-fonts", expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 } },
            },
          ],
        },
        devOptions: { enabled: false },
      }),
    ],
    base: "/app2/",
    server: {
      port: 5173,
      proxy: { "/api": "http://localhost:3000" },
      // Cho phép dev-server đọc gói shared/ ở ngoài thư mục web/ (single-source toán tiền BE↔FE).
      fs: { allow: [".."] },
    },
  };
});
