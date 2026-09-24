// FILE-12 — MỘT bản mã PII hỏng làm sập TOÀN BỘ danh sách nhân sự/danh bạ (500).
//
// decodePiiList → decodePiiOnRead → decryptPiiOrThrow ném status 500 cho hàng hỏng (khoá cũ gỡ sớm,
// byte hỏng) → cả response hỏng, kể cả tổng lương. Nay hàng hỏng vẫn FAIL-CLOSED (trường PII null,
// không plaintext) nhưng mang cờ piiLoi, các hàng khác trả bình thường.
process.env.PII_ENC_KEY ||= "khoa-test-hop-dong-du-dai-cho-hkdf-0123456789";

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import { agentWithCsrf } from "./helpers/agent.js";

const { decodePiiList } = await import("../src/piiFields.js");
const { encryptPii } = await import("../src/piiBox.js");
const { prisma } = await import("../src/db.js");

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "PersonnelRecord" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");

describe("decodePiiList với một hàng hỏng", () => {
  it("trả đủ 2 hàng; hàng hỏng có piiLoi và KHÔNG có plaintext/bản mã", () => {
    const tot = { id: 1, fullName: "A", idCardEnc: encryptPii("079123456789", "PersonnelRecord:idCard"), idCard: null };
    const hong = { id: 2, fullName: "B", idCardEnc: "pii:v1:AAAA", idCard: "079000000009", salaryEnc: "pii:v1:AAAA", salary: 5 };
    const ra = decodePiiList("PersonnelRecord", [tot, hong]);
    expect(ra).toHaveLength(2);
    expect(ra[0].idCard).toBe("079123456789");
    expect(ra[0].piiLoi).toBeUndefined();
    expect(ra[1].piiLoi).toBe(true);
    expect(ra[1].idCard, "không được rơi về cột thô khi bản mã hỏng").toBeNull();
    expect(ra[1].salary).toBeNull();
    expect(JSON.stringify(ra[1])).not.toMatch(/pii:v1:|079000000009/);
  });
});

describe.runIf(dbAvailable)("GET /api/personnel có một hàng PII hỏng", () => {
  const TAG = `plhong${Date.now()}`;
  const PWD = "Test1234!a";
  let admin, u, hongId;
  beforeAll(async () => {
    const { createApp } = await import("../src/app.js");
    const app = createApp();
    u = await prisma.user.create({ data: { username: `${TAG}-a`, displayName: TAG, role: "admin", passwordHash: await bcrypt.hash(PWD, 4) } });
    admin = agentWithCsrf(app);
    expect((await admin.post("/api/auth/login").send({ username: u.username, password: PWD })).status).toBe(200);
    await prisma.personnelRecord.create({ data: { createdById: u.id, fullName: `${TAG} tot`, searchText: `${TAG} tot`, piiVersion: 1, salaryEnc: encryptPii("3000000", "PersonnelRecord:salary") } });
    hongId = (await prisma.personnelRecord.create({ data: { createdById: u.id, fullName: `${TAG} hong`, searchText: `${TAG} hong`, piiVersion: 1, salaryEnc: "pii:v1:AAAA", idCardEnc: "pii:v1:AAAA" } })).id;
  });
  afterAll(async () => {
    await prisma.personnelRecord.deleteMany({ where: { fullName: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.auditEvent.deleteMany({ where: { actorId: u?.id } }).catch(() => {});
    await prisma.loginAttempt.deleteMany({ where: { username: { startsWith: TAG } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
  });

  it("trang vẫn 200; hàng hỏng mang piiLoi; tổng lương tính trên hàng đọc được", async () => {
    const r = await admin.get(`/api/personnel?q=${TAG}&size=50`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data).toHaveLength(2);
    expect(r.body.data.find((x) => x.fullName.endsWith("hong")).piiLoi).toBe(true);
    expect(r.body.summary.salary).toBe(3_000_000);
  });

  // Soát chéo files#1: bản FILE-12 đổi "trang 500" thành "Σ Lương / Σ Thuế TNCN thiếu tiền mà không báo
  // gì" — hàng hỏng cộng như 0. Tổng phải nói nó đang THIẾU bao nhiêu hồ sơ.
  it("summary báo số hồ sơ không giải mã được (piiLoi) để giao diện cảnh báo tổng đang thiếu", async () => {
    const r = await admin.get(`/api/personnel?q=${TAG}&size=50`);
    expect(r.status).toBe(200);
    expect(r.body.summary.piiLoi, "tổng thiếu tiền mà không có tín hiệu nào").toBe(1);
    // Sắp theo lương (đường giải mã toàn tập lọc) cũng phải đếm đúng.
    const s = await admin.get(`/api/personnel?q=${TAG}&size=50&sort=salary&order=desc`);
    expect(s.status).toBe(200);
    expect(s.body.summary.piiLoi).toBe(1);
    expect(s.body.summary.salary).toBe(3_000_000);
  });

  it("trang không có hàng hỏng → summary.piiLoi = 0", async () => {
    const r = await admin.get(`/api/personnel?q=${TAG}%20tot&size=50`);
    expect(r.status).toBe(200);
    expect(r.body.data.every((x) => !x.piiLoi)).toBe(true);
    expect(r.body.summary.piiLoi).toBe(0);
  });

  // files#1 mục 4: PUT trên hàng hỏng vốn đã không ghi (giải mã trong transaction trước lệnh update) nhưng
  // trả 500 "Lỗi server". Cùng nếp updateEmployee: 409 + lời giải thích, bản mã giữ nguyên.
  it("PUT hàng hỏng → 409 (không phải 500), bản mã KHÔNG bị ghi đè", async () => {
    const r = await admin.put(`/api/personnel/${hongId}`).send({ fullName: `${TAG} hong`, idCard: "", salary: null });
    expect(r.status, JSON.stringify(r.body)).toBe(409);
    expect(String(r.body.error)).toMatch(/giải mã/);
    const sau = await prisma.personnelRecord.findUnique({ where: { id: hongId } });
    expect(sau.salaryEnc).toBe("pii:v1:AAAA");
    expect(sau.idCardEnc).toBe("pii:v1:AAAA");
  });

  // Soát chéo files#2: các đường ghi tại chỗ ghi CSDL + nhật ký XONG rồi mới giải mã để trả về → ném 500
  // sau khi đã commit. Người dùng thấy "thất bại", bấm lại → thêm object chứng từ mồ côi + audit trùng.
  // Thanh toán/xác nhận/ghi chú không đụng PII nên phải trả 200 khớp với trạng thái đã commit.
  const sachPii = (body) => {
    expect(body.piiLoi).toBe(true);
    expect(body.salary ?? null).toBeNull();
    expect(body.idCard ?? null).toBeNull();
    expect(JSON.stringify(body)).not.toMatch(/pii:v1:|salaryEnc|idCardEnc/);
  };

  it("POST /:id/payment trên hàng hỏng → 200, piiLoi, đúng MỘT dòng audit personnel.pay", async () => {
    const r = await admin.post(`/api/personnel/${hongId}/payment`).send({ paid: true });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    sachPii(r.body);
    expect(r.body.payment).toBe("Đã thanh toán");
    const n = await prisma.auditEvent.count({ where: { actorId: u.id, action: "personnel.pay", resourceId: String(hongId) } });
    expect(n).toBe(1);
  });

  it("POST /:id/confirm trên hàng hỏng → 200, piiLoi", async () => {
    const r = await admin.post(`/api/personnel/${hongId}/confirm`).send({ confirmed: true });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    sachPii(r.body);
    expect(r.body.confirmed).toBe("Đã ký");
  });

  it("team-note / accounting-note / note trên hàng hỏng → 200, piiLoi, giá trị đã lưu", async () => {
    for (const [duong, cot] of [["team-note", "teamNote"], ["accounting-note", "accountingNote"], ["note", "note"]]) {
      const r = await admin.post(`/api/personnel/${hongId}/${duong}`).send({ value: `ghi ${duong}` });
      expect(r.status, `${duong}: ${JSON.stringify(r.body)}`).toBe(200);
      sachPii(r.body);
      expect(r.body[cot]).toBe(`ghi ${duong}`);
    }
  });
});
