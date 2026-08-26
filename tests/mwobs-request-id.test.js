// Cụm middleware-obs — `X-Request-Id` do client gửi được tin dùng nguyên xi.
//
// ── LỖI ─────────────────────────────────────────────────────────────────────
// src/middleware.ts:requestId lấy thẳng header `x-request-id` làm `req.id` mà không kiểm độ dài
// hay ký tự: `req.id = (Array.isArray(hdr) ? hdr[0] : hdr) || randomUUID();`
//
// ── TÁI HIỆN ────────────────────────────────────────────────────────────────
//  (a) gửi `x-request-id` chứa ký tự xuống dòng → `res.setHeader` ném ERR_INVALID_CHAR NGAY TRONG
//      middleware, tức lỗi 500 sinh ra bởi chính lớp truy vết.
//  (b) gửi một chuỗi 100 KB → nó đi vào MỌI dòng log của request đó, vào ngữ cảnh Sentry và vào
//      thân JSON trả về.
//
// ── HẬU QUẢ ─────────────────────────────────────────────────────────────────
// Lớp truy vết trở thành nguồn lỗi 500 và là kênh bơm rác vào log/Sentry. Kẻ gọi cũng chọn được
// id trùng với id của người khác, làm nhiễu việc truy vết một sự cố thật.
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { requestId } from "../src/middleware.js";

const XUONG_DONG = String.fromCharCode(10);
const KY_TU_DIEU_KHIEN = new RegExp("[^\\t\\x20-\\x7e\\x80-\\xff]");

function chay(hdr) {
  const req = { headers: hdr === undefined ? {} : { "x-request-id": hdr } };
  const res = {
    headers: {},
    setHeader(k, v) {
      // Bắt chước đúng Node: header chứa ký tự điều khiển thì NÉM, không im lặng.
      if (typeof v !== "string" || KY_TU_DIEU_KHIEN.test(v)) {
        throw Object.assign(new TypeError(`Invalid character in header content ["${k}"]`), { code: "ERR_INVALID_CHAR" });
      }
      this.headers[k] = v;
    },
  };
  let daNext = false;
  requestId(req, res, () => { daNext = true; });
  return { req, res, daNext };
}

const LA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe("requestId", () => {
  it("id hợp lệ do client gửi vẫn được giữ (truy vết xuyên hệ thống không hỏng)", () => {
    const { req, res } = chay("edge-7f3a_9B.21");
    expect(req.id).toBe("edge-7f3a_9B.21");
    expect(res.headers["X-Request-Id"]).toBe("edge-7f3a_9B.21");
  });

  it("id chứa ký tự điều khiển KHÔNG được ném — phải rơi về UUID sinh mới", () => {
    const { req, res, daNext } = chay(`abc${XUONG_DONG}def`);
    expect(req.id).toMatch(LA_UUID);
    expect(res.headers["X-Request-Id"]).toMatch(LA_UUID);
    expect(daNext).toBe(true);
  });

  it("id quá dài bị loại (không bơm được rác vào log/Sentry)", () => {
    const { req } = chay("a".repeat(100_000));
    expect(req.id).toMatch(LA_UUID);
  });

  it("id rỗng hoặc thiếu header → UUID sinh mới", () => {
    expect(chay("").req.id).toMatch(LA_UUID);
    expect(chay(undefined).req.id).toMatch(LA_UUID);
  });

  it("header trùng lặp (mảng) vẫn lấy phần tử đầu nếu hợp lệ", () => {
    expect(chay(["ok-1", "ok-2"]).req.id).toBe("ok-1");
    expect(chay([`xau${XUONG_DONG}`, "ok-2"]).req.id).toMatch(LA_UUID);
  });

  it("ký tự tiếng Việt / khoảng trắng bị loại (header phải là Latin-1 an toàn)", () => {
    expect(chay("mã-báo-giá").req.id).toMatch(LA_UUID);
    expect(chay("có khoảng trắng").req.id).toMatch(LA_UUID);
    expect(randomUUID()).toMatch(LA_UUID); // chốt: chính regex kiểm là đúng
  });
});
