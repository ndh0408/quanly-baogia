// RT-04 — xoá phiên (đổi/đặt lại mật khẩu, nhận lời mời, gỡ MFA, đăng xuất) phải đóng luôn socket SSE.
//
// `destroyAllSessions` chỉ xoá hàng user_sessions. Luồng /api/stream/events chỉ qua enforceActiveUser
// LÚC BẮT TAY, nên socket của phiên CŨ (tab trên máy khác, `curl -N -b qly.sid=…`) vẫn nhận
// `notification` (tiêu đề + nội dung) và `changed` tới hết SSE_MAX_LIFETIME_MS (30 phút) sau khi nạn
// nhân đổi mật khẩu. Nay destroyAllSessions → closeUserStreams → mọi socket của tài khoản bị end()
// mà KHÔNG nhận "session:revoked" (tab hợp lệ chỉ cần nối lại, không bị bảo đăng xuất).
import { describe, it, expect } from "vitest";
import { EventEmitter } from "node:events";
import { attach, detachUser } from "../src/sse.js";
import { destroyAllSessions } from "../src/sessions.js";

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
const choToiKhi = async (dk, ms = 3000) => { const han = Date.now() + ms; while (!dk() && Date.now() < han) await tick(); };

describe("RT-04: xoá phiên đóng socket SSE", () => {
  it("destroyAllSessions → mọi socket của tài khoản bị end(), không nhận session:revoked; người khác nguyên", async () => {
    const a1 = giaKetNoi(), a2 = giaKetNoi(), b = giaKetNoi();
    const A = 970_001, B = 970_002;
    attach(a1.req, a1.res, A); attach(a2.req, a2.res, A); attach(b.req, b.res, B);

    await destroyAllSessions(A, "sid-dang-giu");
    await choToiKhi(() => a1.res.ended === 1 && a2.res.ended === 1);

    expect(a1.res.ended, "socket SSE của phiên cũ vẫn mở sau khi xoá phiên").toBe(1);
    expect(a2.res.ended).toBe(1);
    const daGhi = a1.ghi.join("") + a2.ghi.join("");
    expect(daGhi, "không được bảo tab hợp lệ đăng xuất").not.toContain("session:revoked");
    expect(daGhi).not.toContain("session:close");
    expect(b.res.ended, "tài khoản khác không bị đụng").toBe(0);
    detachUser(B);
  });
});
