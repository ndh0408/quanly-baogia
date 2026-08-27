// FILE TĨNH KHÔNG CÓ THẬT: máy chủ từng trả index.html kèm 200, không phải 404.
//
// ── LỖI ─────────────────────────────────────────────────────────────────────
// src/app.ts mắc `express.static(public)` rồi hai route bắt-tất `["/app2","/app2/*"]` và `"*"`.
// static chỉ phục vụ file CÓ THẬT; thiếu file thì rơi xuống route bắt-tất và chúng trả
// index.html với `200` + `Content-Type: text/html` cho MỌI đường dẫn — kể cả
// `/app2/assets/index-<hash>.js`.
//
// ── HẬU QUẢ ─────────────────────────────────────────────────────────────────
// Trình duyệt nhận HTML ở chỗ nó chờ JavaScript và ném `Unexpected token '<'`. Người dùng thấy
// MÀN HÌNH TRẮNG, còn thông báo lỗi không dính gì tới nguyên nhân thật (thiếu file lúc deploy,
// hoặc client xin một chunk-hash đã bị dọn). Với 404 thì devtools chỉ thẳng vào file thiếu, và
// `LazyBoundary` trong web/src/components/Shell.tsx nhận đúng "Failed to fetch dynamically
// imported module" để tự tải lại một lần.
//
// ── ĐO ĐƯỢC Ở ĐÂU ───────────────────────────────────────────────────────────
// scripts/ci/ui-smoke.mjs, lượt kiểm ngược "giấu public/app2/assets": trước bản vá thì
// "request hỏng ở máy chủ CỦA MÌNH: 0" — 404 bị nuốt hoàn toàn — chỉ còn 2 lỗi console vô nghĩa.
//
// ── VÌ SAO CHỐT "CÓ ĐUÔI FILE" LÀ AN TOÀN ───────────────────────────────────
// SPA định tuyến bằng HASH (`#/list`, `#/quotes/:id`), mà phần sau `#` KHÔNG bao giờ rời trình
// duyệt. Đường dẫn máy chủ nhìn thấy chỉ có `/`, `/app2`, và đường dẫn tài nguyên tĩnh. Nên
// "có phần mở rộng → 404" không chạm route nào của ứng dụng. Bài dưới khoá cả HAI chiều.
import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";

let app;
beforeAll(async () => {
  app = (await import("../src/app.js")).createApp();
});

describe("đường dẫn tài nguyên tĩnh không có thật → 404", () => {
  const KHONG_CO = [
    "/app2/assets/index-khong-ton-tai.js",
    "/app2/assets/style-khong-ton-tai.css",
    "/assets/gi-do.js",
    "/khong-co.png",
    "/thu-muc/sau/nua/file.woff2",
  ];

  for (const p of KHONG_CO) {
    it(`${p} → 404, KHÔNG phải index.html`, async () => {
      const r = await request(app).get(p);
      expect(r.status, `trả ${r.status} — trình duyệt sẽ cố chạy HTML như JavaScript`).toBe(404);
      expect(r.headers["content-type"] || "", "vẫn trả HTML cho một đường dẫn file")
        .not.toMatch(/text\/html/);
    });
  }
});

describe("route của SPA vẫn phải trả index.html", () => {
  // Chiều này quan trọng ngang chiều kia: chốt bắt rộng quá sẽ làm chính ứng dụng 404.
  const CO = ["/", "/app2/", "/list", "/quotes/123", "/bat-ky-duong-nao"];

  for (const p of CO) {
    it(`${p} → index.html của SPA`, async () => {
      const r = await request(app).get(p);
      expect(r.status, `SPA 404 ở ${p} — chốt "có đuôi file" bắt rộng quá`).toBe(200);
      expect(r.headers["content-type"] || "").toMatch(/text\/html/);
      expect(r.text, "trả 200 text/html nhưng không phải trang SPA").toMatch(/<div id="root"/);
    });
  }

  it("/app2 (không dấu / cuối) chuyển hướng về /app2/ — hành vi CÓ SẴN của express.static", () => {
    // `public/app2` là THƯ MỤC có thật, và `express.static` mặc định chuyển hướng thư mục thiếu
    // dấu "/" cuối (301 → /app2/) TRƯỚC khi tới route bắt-tất. Ghi lại ở đây vì bản đầu của bài
    // này đòi 200 và đỏ — hành vi đó có từ trước bản vá, không phải do bản vá gây ra.
    return request(app).get("/app2").then((r) => {
      expect(r.status).toBe(301);
      expect(r.headers.location).toBe("/app2/");
    });
  });

  it("file tĩnh CÓ THẬT vẫn phục vụ bình thường (không bị chốt bắt oan)", async () => {
    const r = await request(app).get("/style.css");
    expect(r.status, "public/style.css có thật mà bị 404 → chốt chặn nhầm file thật").toBe(200);
    expect(r.headers["content-type"] || "").toMatch(/text\/css/);
  });
});
