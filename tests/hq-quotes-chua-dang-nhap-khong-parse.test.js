// HTTP-05 — người CHƯA đăng nhập được giải nén + parse tới 16MB JSON ở /api/quotes trước mọi bước
// xác thực (chỉ bị giới hạn 120 lượt/phút/IP): 40-120ms CPU + vài chục MB heap mỗi lượt rồi mới 401.
// Quan sát từ ngoài: thân gzip RÁC gửi không cookie → trước bản vá 400 (bộ giải nén đã chạy), sau
// bản vá 401 (chặn trước khi đụng tới thân).
import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";

const RAC = Buffer.from("day khong phai gzip");
let app, signAccessToken;
beforeAll(async () => {
  ({ createApp: app } = await import("../src/app.js"));
  app = app();
  ({ signAccessToken } = await import("../src/jwt.js"));
});

describe("HTTP-05: /api/quotes chặn trước khi bung thân", () => {
  it("POST /api/quotes KHÔNG danh tính + gzip rác → 401 (thân không bị giải nén)", async () => {
    const r = await request(app).post("/api/quotes").set("Content-Type", "application/json").set("Content-Encoding", "gzip").send(RAC);
    expect(r.status, "bộ giải nén đã chạy cho người chưa đăng nhập").toBe(401);
  });

  it("Bearer GIẢ (không đúng chữ ký) cũng không lách được → 401", async () => {
    const r = await request(app).post("/api/quotes").set("Authorization", "Bearer x.y.z").set("Content-Type", "application/json").set("Content-Encoding", "gzip").send(RAC);
    expect(r.status).toBe(401);
  });

  it("Bearer HỢP LỆ → được đi tiếp tới bộ giải nén (gzip rác → 400 như cũ)", async () => {
    const tok = signAccessToken({ id: 999_999_001, role: "manager", username: "khong-ton-tai" });
    const r = await request(app).post("/api/quotes").set("Authorization", `Bearer ${tok}`).set("Content-Type", "application/json").set("Content-Encoding", "gzip").send(RAC);
    expect(r.status).toBe(400);
  });

  it("GET không bị chốt này đụng tới (vẫn 401 từ requireAuth như cũ)", async () => {
    expect((await request(app).get("/api/quotes")).status).toBe(401);
  });
});
