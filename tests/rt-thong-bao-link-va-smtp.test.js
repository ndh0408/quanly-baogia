// RT-05 — email/Telegram thông báo mang link TƯƠNG ĐỐI "/#/quotes/<id>" → nút "Mở" là link chết.
// RT-11 — transport nodemailer không đặt timeout (mặc định 120s/30s/600s) → mời thành viên treo tới 524.
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ jobs: [], transportOpts: null }));

vi.mock("../src/queue.js", () => ({
  QUEUES: { EMAIL: "email", NOTIFY: "notify" },
  runOrQueue: async (q, name, data) => { h.jobs.push({ q, name, data }); },
}));
vi.mock("../src/sse.js", () => ({ publish: () => {} }));
vi.mock("../src/db.js", () => ({
  prisma: {
    notification: { findFirst: async () => null, create: async ({ data }) => ({ id: 1n, ...data, createdAt: new Date() }) },
    user: { findUnique: async () => ({ email: "a@x.vn", displayName: "A" }) },
    setting: {
      findUnique: async ({ where }) => (where.key === "notif.channels" ? { value: { email: "always", telegram: "always" } } : { value: "12345" }),
    },
  },
}));
vi.mock("nodemailer", () => ({
  default: { createTransport: (opts) => { h.transportOpts = opts; return { sendMail: async () => ({ messageId: "m" }) }; } },
}));

const { notify } = await import("../src/notifications.js");
const { config } = await import("../src/config.js");

beforeEach(() => { h.jobs = []; });

describe("RT-05: link tuyệt đối cho email/Telegram", () => {
  it("email và Telegram mang link tuyệt đối theo APP_BASE_URL", async () => {
    await notify(7, { title: "Giao HN", body: "Báo giá 5", link: "/#/quotes/5", important: true });
    const email = h.jobs.find((j) => j.q === "email");
    const tg = h.jobs.find((j) => j.q === "notify");
    const tuyetDoi = `${config.APP_BASE_URL}/#/quotes/5`;
    expect(email.data.html, "href tương đối trong email là link chết").toContain(`href="${tuyetDoi}"`);
    expect(email.data.text).toContain(`Link: ${tuyetDoi}`);
    expect(tg.data.text).toContain(tuyetDoi);
  });
});

describe("RT-11: timeout SMTP", () => {
  it("createTransport nhận connection/greeting/socket timeout hữu hạn", async () => {
    process.env.SMTP_HOST = "smtp.vi-du.invalid";
    vi.resetModules();
    const { sendEmail } = await import("../src/email.js");
    await sendEmail({ to: "a@x.vn", subject: "s", text: "t" }).catch(() => {});
    delete process.env.SMTP_HOST;
    expect(h.transportOpts, "createTransport chưa được gọi").toBeTruthy();
    expect(h.transportOpts.connectionTimeout).toBeLessThanOrEqual(30_000);
    expect(h.transportOpts.greetingTimeout).toBeLessThanOrEqual(30_000);
    expect(h.transportOpts.socketTimeout).toBeLessThanOrEqual(60_000);
  });
});
