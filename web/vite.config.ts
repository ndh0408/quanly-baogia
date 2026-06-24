import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// App React phục vụ tại /app2 (Express serve thư mục public/app2). Dev proxy /api → :3000.
export default defineConfig({
  plugins: [react()],
  base: "/app2/",
  build: {
    outDir: "../public/app2",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:3000" },
    // Cho phép dev-server đọc gói shared/ ở ngoài thư mục web/ (single-source toán tiền BE↔FE).
    fs: { allow: [".."] },
  },
});
