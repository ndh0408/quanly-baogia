// SSE — GIAO NHẬN QUA BACKPLANE REDIS THẬT (cả `publish` lẫn `broadcast`).
//
// ── BÀI NÀY KIỂM GÌ, VÀ KHÔNG KIỂM GÌ ───────────────────────────────────────
// KIỂM: sự kiện phát ra có thật sự tới được kết nối đang mở, đi qua Redis THẬT (không mock), ở cả
// hai hàm — `publish` (một người) và `broadcast`/`emitChange` (mọi người). Đã kiểm ngược:
//   · vô hiệu hoá `broadcast` → 1 bài đỏ
//   · vô hiệu hoá `publish`   → 2 bài đỏ
// Đó là răng thật: hỏng đường giao nhận thì đỏ ngay.
//
// KHÔNG KIỂM: CỬA SỔ ĐUA lúc khởi động (gán `pub` trước khi `subscribe` xong).
// Bản đầu của file này khai là có, và điều đó SAI. Đã kiểm ngược tử tế: quay lại đúng lỗi cũ thì
// file này vẫn XANH 3/3. Lý do: ioredis có HÀNG ĐỢI NGOẠI TUYẾN — lệnh PUBLISH gọi lúc chưa nối
// được xếp lại và chỉ bay đi khi kết nối lên, mà lúc đó subscriber cũng vừa subscribe xong. Nên
// từ bên ngoài không có mốc thời gian nào chắc chắn rơi vào cửa sổ.
// (Trước khi biết điều đó, bài "phát rải" của tôi có vẻ bắt được lỗi — thật ra nó đỏ vì một
// TypeError trong chính bài test. Một bài đỏ KHÔNG đồng nghĩa một bài bắt được lỗi.)
//
// CỬA SỔ ĐUA ĐƯỢC KHOÁ Ở ĐÂU: tests/mwobs-sse.test.js. Đo được: quay lại lỗi cũ thì file đó ĐỎ
// 4/4 lượt (2 bài mỗi lượt) — gồm cả bài hành vi lẫn ba bài khoá thứ tự câu lệnh trong src/sse.ts.
//
// ── LỖI GỐC (để hiểu vì sao chuyện này đáng quan tâm) ────────────────────────
// `src/sse.ts` từng gán `pub = pubClient` TRƯỚC `await sub.subscribe(CHANNEL)`. `pub` là CÔNG TẮC:
// `publish()`/`broadcast()` thấy nó khác null là đi đường Redis rồi TRẢ VỀ NGAY, KHÔNG phát cục bộ.
// Redis pub/sub không có bộ đệm, nên sự kiện phát trong cửa sổ đó MẤT HẲN — im lặng, gauge vẫn báo
// khoẻ. Ở production: mỗi lần một instance khởi động lại, ai tạo/sửa báo giá trong cửa sổ ấy thì
// không màn hình nào cập nhật.
//
// ── ĐIỀU KIỆN ───────────────────────────────────────────────────────────────
// Chỉ chạy khi CÓ Redis — không Redis thì `publish` vốn đã đồng bộ và bài này không nói lên gì.
// Thiếu REDIS_URL mà REQUIRE_DB_TESTS=1 thì báo đỏ: bỏ qua âm thầm ĐÚNG ở cấu hình production là
// thứ nguy hiểm nhất.
import { describe, it, expect } from "vitest";

const coRedis = !!process.env.REDIS_URL;
if (!coRedis && process.env.REQUIRE_DB_TESTS === "1") {
  throw new Error("REQUIRE_DB_TESTS=1 nhưng thiếu REDIS_URL — cửa sổ đua của SSE chỉ tồn tại khi có Redis");
}

/** req/res giả tối thiểu cho `attach`. */
function gia() {
  const handlers = {};
  const res = {
    headers: {}, daGhi: [], writableLength: 0, daHuy: false, trangThai: 0,
    setHeader(k, v) { this.headers[k] = v; },
    flushHeaders() {},
    status(c) { this.trangThai = c; return this; },
    json() { return this; },
    write(s) { this.daGhi.push(s); return true; },
    end() { this.daHuy = true; },
    destroy() { this.daHuy = true; handlers.close?.(); },
  };
  return { req: { on(ev, fn) { handlers[ev] = fn; } }, res, dongSocket: () => handlers.close?.() };
}

const cho = (dieuKien, hanMs) => new Promise((ok, loi) => {
  const het = Date.now() + hanMs;
  const nhip = setInterval(() => {
    if (dieuKien()) { clearInterval(nhip); ok(); }
    else if (Date.now() > het) { clearInterval(nhip); loi(new Error("hết hạn chờ")); }
  }, 5);
});

describe.runIf(coRedis)("SSE — cửa sổ khởi động không được nuốt sự kiện", () => {
  // Bắn RẢI 0/1/2/4/8/16/32ms sau khi nạp module: nửa đầu rơi vào lúc backplane còn đang lên,
  // nửa sau rơi vào lúc đã lên. Một bài, hai chế độ giao nhận.
  //
  // ⚠️ ĐÂY KHÔNG PHẢI BÀI PHÁT HIỆN CỬA SỔ ĐUA — xem khối đầu file. Nó là bài SỐNG/CHẾT của đường
  // `publish`: vô hiệu hoá `publish` thì nó đỏ. Đừng viết lại chú thích thành "canh cửa sổ đua",
  // vì đã đo là nó KHÔNG canh được.
  it("phát rải quanh lúc khởi động — KHÔNG phát nào được biến mất", async () => {
    const sse = await import("../src/sse.js");
    const goc = 930000 + (process.pid % 9000) * 10;
    const moc = [0, 1, 2, 4, 8, 16, 32];
    const con = moc.map((ms, i) => {
      const uid = goc + i;
      const c = gia();
      sse.attach(c.req, c.res, uid);
      return { ms, uid, c, ten: `khoi-dong-${i}` };
    });

    await Promise.all(con.map((x) => new Promise((r) => setTimeout(() => {
      sse.publish(x.uid, x.ten, { i: x.ms });
      r();
    }, x.ms))));

    // Trước bản vá: phát nào rơi vào cửa sổ đi thẳng vào Redis lúc chưa ai subscribe → MẤT HẲN.
    // Sau bản vá: `pub` còn null trong suốt cửa sổ nên `localPublish` chạy đồng bộ, tới nơi ngay.
    const mat = [];
    for (const x of con) {
      try {
        await cho(() => x.c.res.daGhi.some((s) => s.includes(`event: ${x.ten}`)), 4000);
      } catch {
        mat.push(`+${x.ms}ms`);
      }
    }
    for (const x of con) x.c.dongSocket();
    expect(mat,
      `sự kiện phát ở các mốc ${mat.join(", ")} sau khi nạp module BIẾN MẤT — đúng lỗi production ` +
      `gặp mỗi lần deploy: instance vừa lên, ai tạo/sửa báo giá lúc đó thì không màn hình nào cập nhật`)
      .toEqual([]);
  }, 60_000);

  it("sau khi backplane lên hẳn, sự kiện vẫn tới (bản vá không làm chết đường Redis)", async () => {
    const sse = await import("../src/sse.js");
    // Cho backplane thời gian nối xong. Không có API "đã sẵn sàng" nên chờ theo mốc thời gian —
    // chấp nhận được vì đây là vế "không làm hỏng đường cũ", không phải vế đo cửa sổ đua.
    await new Promise((r) => setTimeout(r, 1500));

    const uid = 940000 + (process.pid % 9000);
    const c = gia();
    sse.attach(c.req, c.res, uid);
    sse.publish(uid, "sau-khoi-dong", { b: 2 });

    await expect(
      cho(() => c.res.daGhi.some((s) => s.includes("event: sau-khoi-dong")), 5000),
      "vá xong thì đường Redis không còn giao được — đổi một lỗi lấy một lỗi khác",
    ).resolves.toBeUndefined();
    c.dongSocket();
  }, 30_000);

  it("broadcast trong cửa sổ khởi động cũng phải tới (emitChange đi đường này)", async () => {
    // `emitChange` — thứ src/db.ts gọi sau MỖI lần ghi Quote/Customer/User — dùng `broadcast`,
    // không phải `publish`. Hai hàm có hai nhánh `if (pub)` RIÊNG; vá một mà quên cái kia thì
    // đúng đường mà production dùng nhiều nhất vẫn hỏng.
    const sse = await import("../src/sse.js");
    const uid = 950000 + (process.pid % 9000);
    const c = gia();
    sse.attach(c.req, c.res, uid);
    sse.emitChange("quote", "update", 123);

    await expect(
      cho(() => c.res.daGhi.some((s) => s.includes("event: changed")), 4000),
      "emitChange mất trong cửa sổ khởi động — người dùng không thấy danh sách tự cập nhật",
    ).resolves.toBeUndefined();
    c.dongSocket();
  }, 30_000);
});
