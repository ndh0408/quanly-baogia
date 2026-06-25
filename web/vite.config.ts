import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// App React phục vụ tại /app2 (Express serve thư mục public/app2). Dev proxy /api → :3000.
export default defineConfig({
  // Hỗ trợ máy/ĐT đời cũ qua build.target THẤP (es2017: phủ Chrome 58+/Safari 11+ ~2017+), KHÔNG dùng
  // @vitejs/plugin-legacy: plugin đó chèn inline + data: script (dò trình duyệt) → VI PHẠM CSP `script-src 'self'`
  // của app (chặn nên React không mount). Hi sinh trình duyệt tiền-ESM (gần như tuyệt chủng) để giữ CSP bảo mật.
  build: { target: "es2017", outDir: "../public/app2", emptyOutDir: true },
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
});
