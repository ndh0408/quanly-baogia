// Cụm middleware-obs — ba lỗi trong src/sse.ts.
//
// ── LỖI 1: ghi SSE không hề nhìn áp lực ngược, và không có trần số kết nối ───
// `try { res.write(payload); } catch {}` bỏ qua giá trị TRẢ VỀ của `res.write` (false = bộ đệm
// kernel/Node đã đầy). Một client đọc chậm — hoặc một socket chết mà không gửi FIN (rất thường
// gặp qua tunnel/NAT) — làm mọi sự kiện tiếp theo dồn vào bộ đệm trong tiến trình, không giới
// hạn. `attach` cũng không hề kiểm `set.size`, nên một tài khoản mở bao nhiêu EventSource cũng được.
// TÁI HIỆN: dựng một kết nối có `writableLength` vượt trần rồi phát sự kiện → trước khi vá,
// kết nối đó vẫn nằm trong danh sách và tiếp tục nhận thêm dữ liệu.
// HẬU QUẢ: bộ nhớ tiến trình web phình theo số sự kiện, không có chốt nào chặn.
//
// ── LỖI 2: backplane Redis dùng CHUNG options với BullMQ ─────────────────────
// `const opts = { maxRetriesPerRequest: null, enableReadyCheck: false }` dùng cho CẢ publisher lẫn
// subscriber. `maxRetriesPerRequest: null` + hàng đợi offline mặc định nghĩa là: Redis chết thì mọi
// lệnh PUBLISH xếp hàng VÔ HẠN trong bộ nhớ. Đây đúng thứ mà src/queue.ts:19-29 đã viết hẳn một
// đoạn dài để tránh cho đường xử lý request. Publish SSE là bắn-và-quên: thà mất còn hơn xếp hàng.
// HẬU QUẢ: Redis chết → hàng đợi offline của ioredis phình, và không một số liệu nào cho biết.
//
// ── LỖI 3: `emitChange` phát id thật cho MỌI phiên đang mở ───────────────────
// `broadcast("changed", { entity, action, id })` đi tới mọi subscriber, không lọc quyền. Chỗ gọi là
// src/db.ts sau mỗi lần ghi Quote/Customer/User, tức id báo giá thật được phát cho cả những tài
// khoản không có quyền đọc báo giá đó. Client React (web/src/components/Shell.tsx:336) KHÔNG đọc
// payload — nó chỉ kích hoạt re-fetch qua API đã gác quyền — nên id trong payload không phục vụ ai
// ngoài người nghe lén.
// HẬU QUẢ: dựng được nhịp làm việc + khoảng id báo giá theo thời gian thực chỉ bằng cách nghe SSE.
import { describe, it, expect } from "vitest";
import { attach, publish, broadcast, emitChange, backplaneOptions, SSE_MAX_PER_USER, SSE_MAX_BUFFER } from "../src/sse.js";

/** Giả lập cặp req/res đủ cho `attach`, có `writableLength` để mô phỏng bộ đệm đầy. */
function gia() {
  const handlers = {};
  const res = {
    headers: {},
    daGhi: [],
    writableLength: 0,
    daHuy: false,
    trangThai: 0,
    than: null,
    setHeader(k, v) { this.headers[k] = v; },
    flushHeaders() {},
    status(c) { this.trangThai = c; return this; },
    json(o) { this.than = o; return this; },
    write(s) { if (this.daHuy) throw new Error("ghi sau khi huỷ"); this.daGhi.push(s); return true; },
    end() { this.daHuy = true; },
    destroy() { this.daHuy = true; handlers.close?.(); }, // socket thật huỷ → req phát "close"
  };
  const req = { on(ev, fn) { handlers[ev] = fn; } };
  return { req, res, dongSocket: () => handlers.close?.() };
}

describe("SSE — trần số kết nối trên mỗi tài khoản", () => {
  it("vượt trần thì trả 429 và KHÔNG thêm vào danh sách phát", () => {
    const uid = 910001;
    const oks = [];
    for (let i = 0; i < SSE_MAX_PER_USER; i++) {
      const c = gia();
      attach(c.req, c.res, uid);
      oks.push(c);
    }
    const thua = gia();
    attach(thua.req, thua.res, uid);
    expect(thua.res.trangThai).toBe(429);
    expect(thua.res.daGhi).toEqual([]); // không được mở stream

    publish(uid, "thu", { a: 1 });
    expect(thua.res.daGhi).toEqual([]);
    for (const c of oks) expect(c.res.daGhi.some((s) => s.includes("event: thu"))).toBe(true);

    for (const c of oks) c.dongSocket();
  });

  it("trần tính RIÊNG từng tài khoản — người khác không bị ảnh hưởng", () => {
    const a = [], uidA = 910002, uidB = 910003;
    for (let i = 0; i < SSE_MAX_PER_USER; i++) { const c = gia(); attach(c.req, c.res, uidA); a.push(c); }
    const b = gia();
    attach(b.req, b.res, uidB);
    expect(b.res.trangThai).toBe(0);
    expect(b.res.daGhi.length).toBeGreaterThan(0);
    for (const c of a) c.dongSocket();
    b.dongSocket();
  });
});

describe("SSE — áp lực ngược", () => {
  it("kết nối có bộ đệm vượt trần bị huỷ và gỡ khỏi danh sách", () => {
    const uid = 910004;
    const cham = gia(), nhanh = gia();
    attach(cham.req, cham.res, uid);
    attach(nhanh.req, nhanh.res, uid);
    const truocCham = cham.res.daGhi.length;

    cham.res.writableLength = SSE_MAX_BUFFER + 1; // client đọc chậm / socket chết không FIN
    publish(uid, "thu", { a: 1 });

    expect(cham.res.daHuy).toBe(true);
    expect(cham.res.daGhi.length).toBe(truocCham); // không nhồi thêm vào bộ đệm đã đầy
    expect(nhanh.res.daGhi.some((s) => s.includes("event: thu"))).toBe(true);

    // Đã bị gỡ → lần phát sau không đụng tới nó nữa (nếu còn, write sẽ ném vì đã huỷ).
    expect(() => publish(uid, "thu2", { a: 2 })).not.toThrow();
    expect(nhanh.res.daGhi.some((s) => s.includes("event: thu2"))).toBe(true);
    nhanh.dongSocket();
  });

  it("broadcast cũng áp cùng trần, không chỉ publish", () => {
    const uid = 910005;
    const cham = gia();
    attach(cham.req, cham.res, uid);
    cham.res.writableLength = SSE_MAX_BUFFER + 1;
    broadcast("thu", { a: 1 });
    expect(cham.res.daHuy).toBe(true);
  });
});

describe("SSE — emitChange không phát id ra toàn hệ thống", () => {
  it("payload chỉ còn entity + action", () => {
    const uid = 910006;
    const c = gia();
    attach(c.req, c.res, uid);
    emitChange("quote", "update", 4271);
    const su = c.res.daGhi.find((s) => s.includes("event: changed"));
    expect(su, "không nhận được sự kiện changed").toBeTruthy();
    const data = JSON.parse(su.split("data: ")[1].trim());
    expect(data).toEqual({ entity: "quote", action: "update" });
    expect(JSON.stringify(data)).not.toContain("4271");
    c.dongSocket();
  });
});

describe("SSE — options của backplane Redis", () => {
  it("publisher TRƯỢT NHANH: không xếp hàng offline, không thử lại vô hạn", () => {
    const o = backplaneOptions("pub");
    expect(o.enableOfflineQueue).toBe(false);
    expect(o.maxRetriesPerRequest).not.toBeNull();
    expect(typeof o.commandTimeout).toBe("number");
  });

  it("subscriber vẫn được phép chờ mãi (kết nối dài, phải tự nối lại)", () => {
    const o = backplaneOptions("sub");
    expect(o.maxRetriesPerRequest).toBeNull();
  });
});
