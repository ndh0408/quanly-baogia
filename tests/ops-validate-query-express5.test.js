/**
 * OPS · DEP-08 — validate() không được gán thẳng `req.query`.
 *
 * LỖI (c450a46): `req.query = schemas.query.parse(...)`. Express 5 khai `req.query` là getter không có
 * setter trên prototype → phép gán ném TypeError (module ESM, strict) → mọi route có query-schema
 * (16 chỗ, vd analytics) trả 400 ngay khi ai đó nâng Express. tsc không bắt được (`as any`).
 *
 * TÁI HIỆN: request giả có `query` là getter-only trên prototype — đúng hình dạng Express 5.
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { validate } from "../src/validators.js";

function resGia() {
  const r = { code: 200, body: null };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}

describe("validate({ query }) — tương thích Express 5", () => {
  it("req.query getter-only (Express 5): vẫn parse + coerce, gọi next, không 400", () => {
    const proto = { get query() { return { page: "2" }; } };
    const req = Object.create(proto);
    req.body = {};
    req.params = {};
    const res = resGia();
    let goiNext = false;
    validate({ query: z.object({ page: z.coerce.number() }) })(req, res, () => { goiNext = true; });
    expect(res.code, JSON.stringify(res.body)).toBe(200);
    expect(goiNext).toBe(true);
    expect(req.query.page).toBe(2);
  });

  it("Express 4 (thuộc tính thường) giữ nguyên hành vi", () => {
    const req = { query: { page: "3" }, body: {}, params: {} };
    let goiNext = false;
    validate({ query: z.object({ page: z.coerce.number().default(1) }) })(req, resGia(), () => { goiNext = true; });
    expect(goiNext).toBe(true);
    expect(req.query.page).toBe(3);
  });
});
