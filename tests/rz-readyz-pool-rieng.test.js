/**
 * ============================================================================
 * CỤM rz — /readyz KHÔNG ĐƯỢC XẾP HÀNG SAU LƯU LƯỢNG NGƯỜI DÙNG.
 *
 * ── LỖI ────────────────────────────────────────────────────────────────────
 * `/readyz` chạy `prisma.$queryRaw\`SELECT 1\`` — tức đi qua CHÍNH pool mà mọi request của người
 * dùng đang dùng. Pool cạn là chuyện BÌNH THƯỜNG khi nhiều người cùng lưu báo giá lớn
 * (`DB_POOL_MAX` mặc định 20, mỗi lần lưu giữ một kết nối tới hết transaction).
 *
 * Khi pool cạn, phép dò cũng xếp hàng rồi hết giờ, và kubelet đọc thành "pod chưa sẵn sàng" →
 * RÚT pod khỏi Service. Đó là phản ứng ngược đúng lúc tệ nhất:
 *
 *     pod vẫn phục vụ bình thường, chỉ là bận
 *       → bị rút khỏi tải
 *       → toàn bộ lưu lượng dồn sang replica còn lại
 *       → replica đó cạn pool theo
 *       → cũng bị rút
 *       → MẤT DỊCH VỤ HOÀN TOÀN
 *
 * vì một cơn tải mà hệ thống lẽ ra chịu được. Và nó chờ đúng lúc đông người nhất để nổ.
 *
 * ── BẢN VÁ ─────────────────────────────────────────────────────────────────
 * Phép dò sẵn sàng phải trả lời "CSDL còn tới được không", KHÔNG phải "pool có rảnh không". Hai
 * câu hỏi khác nhau, và chỉ câu đầu mới đáng để rút một pod ra khỏi tải. Nên nó có pool RIÊNG
 * (max 1) — `kiemTraCsdlChoDoSanSang` trong src/db.ts.
 *
 * ── BÀI NÀY ĐO ─────────────────────────────────────────────────────────────
 * Chiếm TRỌN pool chính bằng các transaction đang ngủ, rồi gọi /readyz. Trước bản vá nó phải chờ
 * hết `connectionTimeoutMillis` rồi trả 503; sau bản vá nó trả 200 ngay.
 * ============================================================================
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import * as db from "../src/db.js";
import { prisma } from "../src/db.js";
import { config } from "../src/config.js";

const dbAvailable = await prisma
  .$queryRawUnsafe("SELECT 1")
  .then(() => true)
  .catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") {
  throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");
}

afterEach(() => vi.restoreAllMocks());

describe("/readyz đi đường riêng", () => {
  it("KHÔNG gọi prisma — dùng nó là quay lại đúng lỗi này", async () => {
    // Chốt ở mức mã: một lần "dọn dẹp" đổi `kiemTraCsdlChoDoSanSang()` về `prisma.$queryRaw` sẽ
    // KHÔNG làm đỏ bất kỳ bài nào khác, vì hành vi thấy được từ ngoài giống hệt nhau — cho tới
    // lúc hệ thống đông người.
    //
    // KHÔNG giả lập `kiemTraCsdlChoDoSanSang`: giả lập chính hàm đang cần chứng minh thì thân nó
    // không bao giờ chạy, và bài kiểm chỉ còn xác nhận rằng cái mock được gọi. Để nó chạy THẬT
    // (CSDL đang có), và chỉ theo dõi `prisma.$queryRaw` — thứ KHÔNG được gọi.
    const spyPrisma = vi.spyOn(prisma, "$queryRaw");
    const r = await request(createApp()).get("/readyz");
    expect(r.status).toBe(200);
    expect(spyPrisma, "/readyz vẫn đi qua pool dùng chung").not.toHaveBeenCalled();
  });

  it("nhiều lượt dò ĐỒNG THỜI chỉ mở MỘT phép dò — không tự đầu độc bộ nhớ đệm", async () => {
    // ── VÌ SAO CÓ BÀI NÀY ─────────────────────────────────────────────────
    // Bộ nhớ đệm chỉ được GHI sau khi phép dò xong, nên mọi request đến TRONG lúc một phép dò đang
    // chạy đều trượt đệm và cùng gọi `kiemTraCsdlChoDoSanSang()`. Pool riêng có `max: 1` → đúng
    // một lượt cầm được kết nối, phần còn lại xếp hàng rồi hết hạn ở `connectionTimeoutMillis`
    // (2s) và GHI `ok:false` vào đệm — kéo pod ra khỏi Service 5 giây trong khi CSDL hoàn toàn
    // khoẻ. Tức chính bản vá "pool riêng" lại tự tạo ra đúng sự cố nó sinh ra để chặn.
    let soLuotDo = 0;
    const that = db.kiemTraCsdlChoDoSanSang;
    vi.spyOn(db, "kiemTraCsdlChoDoSanSang").mockImplementation(async () => {
      soLuotDo++;
      // Chậm có chủ ý để 8 request sau chắc chắn rơi vào lúc phép dò còn đang bay.
      await new Promise((r) => setTimeout(r, 300));
      return that();
    });

    const app = createApp();
    const rs = await Promise.all(Array.from({ length: 8 }, () => request(app).get("/readyz")));

    expect(rs.map((r) => r.status), "có request nhận 503 dù CSDL khoẻ").toEqual(Array(8).fill(200));
    expect(soLuotDo, `mở ${soLuotDo} phép dò cho 8 request đồng thời — pool max:1 sẽ làm 7 lượt hết giờ rồi ghi ok:false`)
      .toBe(1);
  }, 30_000);

  it("CSDL thật sự chết thì VẪN phải 503 — pool riêng không được biến nó thành mù", async () => {
    // Vế đối trọng: tách pool ra để pool cạn không làm pod bị rút, chứ KHÔNG phải để /readyz luôn
    // trả 200. CSDL không tới được vẫn là "chưa sẵn sàng".
    vi.spyOn(db, "kiemTraCsdlChoDoSanSang").mockRejectedValue(new Error("connection refused"));
    const r = await request(createApp()).get("/readyz");
    expect(r.status).toBe(503);
    expect(JSON.stringify(r.body), "lộ chi tiết lỗi trên endpoint không xác thực").not.toMatch(/connection refused/);
  });
});

describe.runIf(dbAvailable)("/readyz khi pool chính ĐÃ CẠN", () => {
  it("vẫn trả 200 nhanh, không xếp hàng sau lưu lượng người dùng", async () => {
    const soKetNoi = config.DB_POOL_MAX;
    const giu = [];
    let thaRa;
    const choTha = new Promise((r) => { thaRa = r; });

    // Chiếm TRỌN pool chính: mỗi transaction giữ một kết nối cho tới khi được thả.
    for (let i = 0; i < soKetNoi; i++) {
      giu.push(
        prisma.$transaction(async (tx) => {
          await tx.$queryRawUnsafe("SELECT 1");
          await choTha;
        }).catch(() => {}),
      );
    }
    // Chờ các transaction kịp CẦM kết nối trước khi đo.
    await new Promise((r) => setTimeout(r, 400));

    try {
      const dangCho = db.thongKePool();
      expect(dangCho.ranh, `pool chưa bị chiếm hết (còn ${dangCho.ranh} kết nối rảnh) — phép đo vô nghĩa`).toBe(0);

      const t0 = Date.now();
      const r = await request(createApp()).get("/readyz");
      const ms = Date.now() - t0;

      expect(r.status, `pool cạn làm /readyz trả ${r.status} → kubelet sẽ RÚT pod dù nó vẫn phục vụ được`).toBe(200);
      // Và phải trả lời NHANH: chờ lâu thì kubelet hết giờ trước, hậu quả y hệt 503.
      expect(ms, `/readyz mất ${ms} ms khi pool cạn — đang xếp hàng sau lưu lượng người dùng`).toBeLessThan(1_500);
    } finally {
      thaRa();
      await Promise.all(giu);
    }
  }, 60_000);
});
