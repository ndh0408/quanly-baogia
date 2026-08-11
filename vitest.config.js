import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.js"],
    setupFiles: ["tests/setup.js"],
    testTimeout: 20_000,
    hookTimeout: 30_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      // Backend đã chuyển sang TypeScript: chỉ include "*.js" thì độ phủ đo trên gần như KHÔNG file
      // nào (con số đẹp mà không kiểm gì) — nhất là các module phân quyền/dịch vụ đều là .ts.
      include: ["src/**/*.{js,ts}"],
      exclude: ["src/server.ts", "src/server.js", "src/types/**"],
    },
  },
});
