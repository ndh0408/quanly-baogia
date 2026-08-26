/**
 * CỤM auth-session — TOKEN MỜI / ĐẶT-LẠI ĐI THẲNG LÊN SENTRY QUA request.url (src/observability.ts).
 *
 * ── LỖI ─────────────────────────────────────────────────────────────────────────────────
 * Bản vá "token lọt vào log" đặt chốt ở `redact` của pino (src/logger.ts) và bình luận ở đó khẳng
 * định nó "phủ MỌI serializer". Điều đó chỉ đúng với pino. Sentry thu thập URL bằng đường RIÊNG:
 * `scrubSentryEvent` chỉ xoá `request.headers.cookie/authorization` và `extra.data/payload/body`,
 * KHÔNG đụng `event.request.url` lẫn `event.request.query_string`.
 *
 * ── TÁI HIỆN ────────────────────────────────────────────────────────────────────────────
 * Đưa một event có `request.url = "/api/auth/invite/<token thật>"` qua `scrubSentryEvent` → token
 * còn nguyên văn trong kết quả, tức nguyên văn trên Sentry (beforeSend là chốt cuối trước khi gửi).
 *
 * ── HẬU QUẢ ─────────────────────────────────────────────────────────────────────────────
 * Token đó là đầu vào DUY NHẤT của POST /api/auth/accept-invite: ai đọc được nó thì đặt lại được
 * mật khẩu và chiếm tài khoản. Nó rời khỏi hạ tầng công ty sang một dịch vụ ngoài, với vòng đời và
 * quyền đọc hoàn toàn khác CSDL — đúng thứ mà chính bình luận trong src/logger.ts nêu làm lý do vá.
 */
import { describe, it, expect } from "vitest";
import { scrubSentryEvent } from "../src/observability.js";

const TOKEN = "asx0123456789abcdef0123456789abcdef0123456789abcd";

describe("Sentry không được mang bí mật trong URL rời máy", () => {
  it("token trong ĐƯỜNG DẪN /api/auth/invite/:token bị che", () => {
    const ev = scrubSentryEvent({ request: { url: `https://app.example/api/auth/invite/${TOKEN}`, headers: {} } });
    expect(ev.request.url).not.toContain(TOKEN);
    // Vẫn phải đọc được là endpoint nào — che không được làm mất giá trị truy vết.
    expect(ev.request.url).toContain("/api/auth/invite/");
  });

  it("token trong CHUỖI TRUY VẤN bị che ở cả url lẫn query_string", () => {
    const ev = scrubSentryEvent({
      request: { url: `https://app.example/#/onboard?token=${TOKEN}&x=1`, query_string: `token=${TOKEN}&x=1`, headers: {} },
    });
    expect(ev.request.url).not.toContain(TOKEN);
    expect(ev.request.query_string).not.toContain(TOKEN);
    expect(ev.request.query_string).toContain("x=1");
  });

  it("event không có request vẫn đi qua được (không ném lỗi)", () => {
    expect(() => scrubSentryEvent({})).not.toThrow();
    const ev = scrubSentryEvent({ extra: { data: { bimat: 1 }, queue: "export" } });
    expect(ev.extra.data).toBeUndefined();
    expect(ev.extra.queue).toBe("export");
  });
});
