// SessionLostOverlay ĐĂNG NHẬP LẠI BẰNG NGƯỜI KHÁC phải xoá bản nháp cục bộ trước khi reload —
// chốt hồi quy (ultracode audit 2026-09-09, finding M-DRAFT).
//
// ── LỖI ──────────────────────────────────────────────────────────────────────
// Bản nháp cục bộ (localDraft.ts) khoá theo SỐ BÁO GIÁ, không theo người dùng, TTL 7 ngày trong
// localStorage. Hai đường "đổi người dùng" đã gọi `xoaMoiBanNhap()` trước khi rời trang: nút Đăng
// xuất và sự kiện SSE `session:revoked` (cả hai ở Shell.tsx). SessionLostOverlay (App.tsx) — lớp
// phủ "Phiên đăng nhập đã hết" cho phép đăng nhập LẠI BẰNG TÀI KHOẢN KHÁC ngay tại chỗ — là đường
// thứ BA cũng đổi người dùng, nhưng bị bỏ sót: nhánh `m.id !== me.id` chỉ `location.reload()`.
// HẬU QUẢ: người B dùng CHUNG MÁY với người A, đăng nhập lại trên đúng lớp phủ này, mở lại báo giá
// mà A đang dở dang → thấy modal "Khôi phục bản nháp?" chứa giá/khách/bảng nội bộ CỦA NGƯỜI A.
//
// Bài dưới soi MÃ NGUỒN THẬT của App.tsx (không dựng React) — mount toàn bộ App (fetch api.me lúc
// mount, SSE, Shell) tốn công dựng giàn không tương xứng với một chốt "đừng bỏ sót một lời gọi hàm
// trong đúng nhánh". Test hồi quy tương đương cho 2 đường kia (Shell.tsx) cũng ở mức source, không
// mount component (grep "xoaMoiBanNhap" trong localDraft.test.ts's docblock). Đã hết token thời
// gian cho một bài mount 2-tài-khoản-thật đầy đủ trong phiên vá này — xem blind_spots của audit.
import { describe, it, expect } from "vitest";
// `?raw` (kiểu khai trong vite/client, đã có sẵn trong tsconfig của web/) nạp NGUYÊN VĂN nội dung
// file — tránh node:fs/node:url mà tsconfig của web/ (browser-scoped, "types": ["vite/client"])
// không có type cho, để khỏi phải nới phạm vi type-check của cả dự án chỉ vì một bài test.
import doc from "./App.tsx?raw";

describe("SessionLostOverlay.onLogin — nhánh đổi người dùng phải xoá bản nháp", () => {
  it("import xoaMoiBanNhap từ lib/localDraft", () => {
    expect(doc).toMatch(/import\s*\{\s*xoaMoiBanNhap\s*\}\s*from\s*["']\.\/lib\/localDraft["']/);
  });

  it("nhánh `m.id !== me.id` gọi xoaMoiBanNhap() TRƯỚC location.reload()", () => {
    const i = doc.indexOf("m.id !== me.id");
    expect(i, "không tìm thấy nhánh so sánh người dùng trong SessionLostOverlay.onLogin").toBeGreaterThan(-1);
    const than = doc.slice(i, i + 200);
    expect(than, "nhánh đổi người dùng phải gọi xoaMoiBanNhap() trước khi reload — thiếu nó thì bản nháp của người trước sống sót sang người sau")
      .toMatch(/xoaMoiBanNhap\(\)[\s\S]*location\.reload\(\)/);
  });
});
