// Cụm middleware-obs — ký webhook nằm NGOÀI khối try, hỏng là mất luôn bản ghi giao nhận.
//
// ── LỖI ─────────────────────────────────────────────────────────────────────
// src/webhooks.ts:deliverWebhook có dòng
//     const sig = sign(body, decryptValue(h.secret) as string);
// nằm NGAY TRƯỚC `try {`. `decryptValue` trả `null` khi không giải mã được (nó chỉ ghi log warn),
// còn `as string` chỉ là ép kiểu của TypeScript — lúc chạy vẫn là null, và
// `createHmac("sha256", null)` ném TypeError.
//
// ── TÁI HIỆN ────────────────────────────────────────────────────────────────
// Khoá giải mã lấy từ `MFA_ENC_KEY || JWT_SECRET` (src/secretbox.ts:key). Xoay MFA_ENC_KEY là mọi
// `Webhook.secret` đã mã hoá thành không giải được. Test dựng thẳng một hàng có secret hỏng.
// Trước khi vá: TypeError thoát ra TRƯỚC `prisma.webhookDelivery.create`, nên KHÔNG có bản ghi
// giao nhận nào được tạo.
//
// ── HẬU QUẢ ─────────────────────────────────────────────────────────────────
// Màn hình webhook của admin im lặng giống hệt "chưa có sự kiện nào" — không phân biệt được
// "không có gì để gửi" với "mọi lần gửi đều chết vì khoá đã xoay". Chẩn đoán phải đi lục log
// BullMQ mới ra.
import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "../src/db.js";
import { deliverWebhook } from "../src/webhooks.js";

const TAG = "mwobs-webhook-sign";
const idDaTao = [];

async function taoWebhook(secret) {
  const h = await prisma.webhook.create({
    data: { url: `https://${TAG}.example.com/hook`, events: ["quote.approved"], secret, active: true },
  });
  idDaTao.push(h.id);
  return h;
}

afterAll(async () => {
  for (const id of idDaTao) {
    await prisma.webhookDelivery.deleteMany({ where: { webhookId: id } });
    await prisma.webhook.delete({ where: { id } }).catch(() => {});
  }
});

describe("deliverWebhook khi secret KHÔNG giải mã được (đã xoay MFA_ENC_KEY)", () => {
  it("vẫn ghi bản ghi giao nhận thay vì ném TypeError ra ngoài", async () => {
    // "enc:v1:" + rác → decryptValue vào nhánh catch và trả null.
    const h = await taoWebhook("enc:v1:" + Buffer.from("rac-khong-giai-duoc-nhung-du-dai-32b").toString("base64"));

    let loi;
    try {
      await deliverWebhook({ webhookId: h.id, event: "quote.approved", payload: { quoteId: 1 } });
    } catch (e) {
      loi = e;
    }

    // Phải là lỗi giao nhận bình thường của BullMQ (để nó retry/đánh dấu failed), KHÔNG phải TypeError.
    expect(loi).toBeInstanceOf(Error);
    expect(loi.constructor.name).not.toBe("TypeError");
    expect(String(loi.message)).toContain(`webhook ${h.id} returned 0`);

    const giaoNhan = await prisma.webhookDelivery.findMany({ where: { webhookId: h.id } });
    expect(giaoNhan.length, "không có bản ghi giao nhận nào — admin không thấy gì").toBe(1);
    expect(giaoNhan[0].responseStatus).toBe(0);
    expect(giaoNhan[0].deliveredAt).toBeNull();
    expect(giaoNhan[0].responseBody || "").toMatch(/secret|khoá|khoa/i);
  });

  it("secret thường (plaintext cũ) vẫn ký và gửi như trước — không siết nhầm đường đang chạy", async () => {
    const h = await taoWebhook("bi-mat-thuong-chua-ma-hoa");
    let loi;
    try {
      await deliverWebhook({ webhookId: h.id, event: "quote.approved", payload: { quoteId: 2 } });
    } catch (e) {
      loi = e;
    }
    // Đích không tồn tại nên vẫn hỏng, nhưng phải hỏng ở bước GỬI (DNS/kết nối), không phải bước ký.
    const giaoNhan = await prisma.webhookDelivery.findMany({ where: { webhookId: h.id } });
    expect(giaoNhan.length).toBe(1);
    expect(giaoNhan[0].responseBody || "").not.toMatch(/secret/i);
    expect(loi).toBeInstanceOf(Error);
  });
});
