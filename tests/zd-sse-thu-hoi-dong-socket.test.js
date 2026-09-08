// THU HỒI PHIÊN PHẢI ĐÓNG SOCKET SSE, KHÔNG CHỈ NHẮN CLIENT — chốt hồi quy, phát hiện qua ultracode
// audit 2026-09-07 (src/sse.ts detachUser / localPublish "session:revoked").
//
// Trước bản vá revokeSession chỉ publish một sự kiện; requireAuth/enforceActiveUser chỉ chạy lúc bắt
// tay nên `curl -N -b qly.sid=…` mở sẵn vẫn nhận notification (title+body) + nhịp `changed` của cả
// công ty vô thời hạn sau khi tài khoản bị khoá/xoá/gỡ MFA.
import { describe, it, expect } from "vitest";
import { EventEmitter } from "node:events";
import { attach, detachUser, revokeSession, SSE_MAX_LIFETIME_MS } from "../src/sse.js";

// Response giả tối thiểu cho attach(): ghi vào bộ đệm, đếm end(), và mô phỏng "close" của req khi end.
function giaKetNoi() {
  const req = new EventEmitter();
  const ghi = [];
  const res = {
    headers: {}, ended: 0,
    setHeader(k, v) { this.headers[k] = v; },
    flushHeaders() {},
    status() { return this; }, json() { return this; },
    write(s) { ghi.push(String(s)); return true; },
    end() { this.ended++; queueMicrotask(() => req.emit("close")); },
    destroy() { this.end(); },
    writableLength: 0,
  };
  return { req, res, ghi };
}
const tick = () => new Promise((r) => setTimeout(r, 5));
// Trên VM dev có REDIS_URL: revokeSession → PUBLISH Redis → subscriber cùng tiến trình → localPublish
// → detachUser. Đường thật, nhưng bất đồng bộ qua mạng — chờ CÓ ĐIỀU KIỆN thay vì sleep cố định.
const choToiKhi = async (dk, ms = 3000) => { const han = Date.now() + ms; while (!dk() && Date.now() < han) await tick(); };

describe("SSE: thu hồi phiên đóng socket thật", () => {
  it("revokeSession → mọi kết nối của tài khoản đó bị end(), kết nối của người khác còn nguyên", async () => {
    const a1 = giaKetNoi(), a2 = giaKetNoi(), b = giaKetNoi();
    attach(a1.req, a1.res, 9001); attach(a2.req, a2.res, 9001); attach(b.req, b.res, 9002);

    revokeSession(9001, "deactivated");
    await choToiKhi(() => a1.res.ended === 1 && a2.res.ended === 1);

    expect(a1.res.ended, "kết nối 1 của nạn nhân phải bị đóng").toBe(1);
    expect(a2.res.ended, "kết nối 2 (tab thứ hai) cũng phải bị đóng").toBe(1);
    expect(a1.ghi.join(""), "vẫn phải nhắn client lý do trước khi đóng").toContain("session:revoked");
    expect(b.res.ended, "người khác không được đụng tới").toBe(0);

    // Sau khi gỡ, publish tiếp không tới được nạn nhân — map đã xoá, không còn rò gì nữa.
    expect(detachUser(9001), "gọi lại phải là no-op (không còn gì để đóng)").toBe(0);
    detachUser(9002);
  });

  it("detachUser trả về số socket đã đóng", async () => {
    const c1 = giaKetNoi(), c2 = giaKetNoi();
    attach(c1.req, c1.res, 9003); attach(c2.req, c2.res, 9003);
    expect(detachUser(9003)).toBe(2);
    await tick();
    expect(c1.res.ended + c2.res.ended).toBe(2);
  });

  it("có trần tuổi thọ kết nối (mặc định 30 phút) để lượt nối lại đi qua cổng xác thực", () => {
    expect(SSE_MAX_LIFETIME_MS).toBeGreaterThan(0);
    expect(SSE_MAX_LIFETIME_MS).toBeLessThanOrEqual(60 * 60 * 1000);
  });
});
