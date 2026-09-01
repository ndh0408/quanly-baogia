// Cụm quote-concurrency — lỗi transaction của Prisma rơi thành 500 "Lỗi server".
//
// ── LỖI ─────────────────────────────────────────────────────────────────────
// `errorHandler` (src/middleware.ts) khớp mọi mã `P####` nhưng CHỈ gán status cho P2002/P2025/P2003.
// Ba mã sinh ra đúng từ chỗ cụm này vừa đụng vào thì không được map:
//   P2028 — transaction hết giờ (trần DB_TX_TIMEOUT của src/db.ts)
//   P2024 — hết kết nối trong pool (trần connectionTimeoutMillis của src/db.ts)
//   P2034 — deadlock / write conflict (hai người Lưu cùng một báo giá)
//
// ── HẬU QUẢ ─────────────────────────────────────────────────────────────────
// Nới trần transaction 5s → 60s làm ca này TỆ HƠN chứ không nhẹ đi: người dùng chờ tới 60 GIÂY rồi
// nhận đúng một câu "Lỗi server" 500, mất trắng lần sửa, không có manh mối phải làm gì. Ba mã trên
// đều là "thử lại / tách bớt trang" chứ không phải hỏng hệ thống, và 500 còn kéo theo báo động giả
// sang Sentry (errorHandler gọi captureError cho mọi status ≥ 500).
import { describe, it, expect } from "vitest";
import { errorHandler } from "../src/middleware.js";

/** res giả tối thiểu, đủ để đọc lại status + body + header mà errorHandler đặt. */
function resGia() {
  const r = {
    headersSent: false, statusCode: 0, body: null, headers: {},
    setHeader(k, v) { r.headers[k.toLowerCase()] = v; },
    status(s) { r.statusCode = s; return r; },
    json(b) { r.body = b; return r; },
  };
  return r;
}

const chay = (code) => {
  const res = resGia();
  const err = Object.assign(new Error("Transaction API error"), { code });
  errorHandler(err, { id: "r1", path: "/api/quotes/1", method: "PUT", session: {} }, res, () => {});
  return res;
};

describe("errorHandler dịch lỗi transaction của Prisma", () => {
  it("P2028 (transaction hết giờ) → 503 + Retry-After + chỉ dẫn tách bớt trang", () => {
    const res = chay("P2028");
    expect(res.statusCode, "P2028 không được rơi thành 500 'Lỗi server'").toBe(503);
    expect(res.headers["retry-after"], "503 phải nói client chờ bao lâu").toBeTruthy();
    expect(res.body.error).toMatch(/quá lớn|tách/i);
    expect(res.body.error).not.toBe("Lỗi server");
  });

  it("P2024 (hết kết nối trong pool) → 503 + Retry-After", () => {
    const res = chay("P2024");
    expect(res.statusCode).toBe(503);
    expect(res.headers["retry-after"]).toBeTruthy();
    expect(res.body.error).not.toBe("Lỗi server");
  });

  it("P2034 (deadlock/write conflict) → 409 'thử lại', không phải 500", () => {
    const res = chay("P2034");
    expect(res.statusCode).toBe(409);
    expect(res.body.error).toMatch(/thử lại/i);
  });

  it("các mã đã map từ trước GIỮ NGUYÊN hành vi", () => {
    expect(chay("P2002").statusCode).toBe(409);
    expect(chay("P2025").statusCode).toBe(404);
    expect(chay("P2003").statusCode).toBe(409);
  });

  it("mã P lạ vẫn là 500 (không đoán bừa)", () => {
    const res = chay("P9999");
    expect(res.statusCode).toBe(500);
    expect(res.body.error).toBe("Lỗi server");
  });
});
