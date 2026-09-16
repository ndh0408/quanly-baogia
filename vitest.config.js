import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.js"],
    // ── MỘT FILE PHẢI CHẠY RIÊNG, KHÔNG SONG SONG VỚI AI ──────────────────
    // `pii-rotate-backfill` ĐỔI KHOÁ PII cho tiến trình script rồi chạy
    // `scripts/pii-backfill --rotate`, mà script đó quét TOÀN BẢNG `PersonnelRecord`. Bài khác chạy
    // song song tạo bản ghi bằng khoá CHUẨN của môi trường test → script gặp hàng nó không giải mã
    // được → thoát khác 0 → bài đỏ. ĐO ĐƯỢC: trong một lượt verify đầy đủ nó báo
    // "xoay 1 bản ghi · KHÔNG giải mã được 2"; chạy riêng thì 3/3 XANH.
    //
    // Cùng lý do và cùng cách xử lý với bước [1b] của scripts/verify-local.sh (hai bài đo TOAST
    // đọc chung `pg_statio_all_tables` nên cũng phải chạy lần lượt). Loại khỏi lượt chung ở đây,
    // và verify chạy nó ở một bước RIÊNG — bỏ hẳn thì mất một cổng an toàn dữ liệu.
    //
    // LOẠI THEO CỜ, KHÔNG LOẠI CỨNG. Bản đầu ghi thẳng tên file vào `exclude`, và ĐO ĐƯỢC rằng
    // vitest áp `exclude` CẢ KHI gọi đích danh đường dẫn — nên bước [4b] của verify chạy RỖNG và
    // vẫn thoát 0. Tức tôi vừa xoá một cổng an toàn dữ liệu mà cổng vẫn báo xanh: đúng cái bẫy
    // "xanh vì bỏ qua" mà `do_toast` ở scripts/verify-local.sh đã phải đặt một lớp kiểm riêng để
    // chống. Bước [4b] đặt PII_ROTATE_TEST=1 và ĐÒI báo cáo có ít nhất một bài chạy.
    exclude: [
      "node_modules/**",
      ...(process.env.PII_ROTATE_TEST === "1" ? [] : ["tests/pii-rotate-backfill.test.js"]),
    ],
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
