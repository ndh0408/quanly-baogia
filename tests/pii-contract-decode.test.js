// PII CUTOVER PHÁ HỢP ĐỒNG + TỔNG LƯƠNG — ultracode audit 2026-09-09 (H2/H3).
//
// ── LỖI ──────────────────────────────────────────────────────────────────────
// `personnelService.ts` gọi `decodePiiOnRead` ở MỌI hàm đọc, TRỪ hai chỗ:
//   · `downloadContract`  — đưa hàng THÔ thẳng cho `buildContractDocx`.
//   · `listPersonnel`     — tính `summary.salary` bằng `prisma.personnelRecord.aggregate({_sum})`
//                           chạy trên cột `salary` THÔ.
// Từ khi `PII_PLAINTEXT_CUTOVER` bật (commit fc053c2), cột thô của MỌI hồ sơ tạo/sửa sau đó = NULL
// (chỉ còn `salaryEnc`/`idCardEnc`). Hậu quả đo được:
//   · `buildContractDocx` thấy `salary == null` → ném 400 "Hồ sơ thiếu: Lương" — hợp đồng KHÔNG
//     tải được cho bất kỳ hồ sơ nào tạo sau cutover, dù lương đã nhập đầy đủ.
//   · SQL `SUM()` bỏ qua NULL → `summary.salary` (dùng tính thuế TNCN) THIẾU đúng phần hồ sơ mới.
//
// Đo trên production 2026-09-09: bảng PersonnelRecord đang 0 dòng nên CHƯA ai bị ảnh hưởng thật —
// vá TRƯỚC khi HR nhập hồ sơ đầu tiên.
//
// Bài dưới đăng nhập thật, tạo hồ sơ thật qua HTTP (cutover ĐANG BẬT), rồi xác nhận cả hai đường
// đọc trả đúng giá trị đã giải mã — không chỉ đọc code, chạy thật qua Postgres.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import JSZip from "jszip";
import { agentWithCsrf } from "./helpers/agent.js";

// PII_ENC_KEY/PII_PLAINTEXT_CUTOVER phải đặt TRƯỚC khi `src/app.js` (và mọi thứ nó kéo theo) được
// nạp — piiBox/piiFields đọc process.env tại thời điểm GỌI nhưng `config.ts` validate lúc NẠP
// MODULE, và các test khác trong cùng tiến trình vitest có thể đã nạp app.js trước bài này.
process.env.PII_ENC_KEY ||= "khoa-test-hop-dong-du-dai-cho-hkdf-0123456789";
process.env.PII_PLAINTEXT_CUTOVER = "1";

const { prisma } = await import("../src/db.js");

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "PersonnelRecord" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres/schema PersonnelRecord");

const TAG = `piicontract${Date.now()}`;
const PWD = "Test1234!a";

describe.runIf(dbAvailable)("PII cutover: hợp đồng + tổng lương phải đọc bản ĐÃ GIẢI MÃ (integration)", () => {
  let app, mgr, mgrU, recId;
  const SALARY = 31_500_000;
  const ID_CARD = "079123456789";

  beforeAll(async () => {
    const { createApp } = await import("../src/app.js");
    app = createApp();
    mgrU = await prisma.user.create({ data: { username: `${TAG}-mgr`, displayName: `${TAG} mgr`, role: "manager", passwordHash: await bcrypt.hash(PWD, 4) } });
    mgr = agentWithCsrf(app);
    const l = await mgr.post("/api/auth/login").send({ username: mgrU.username, password: PWD });
    expect(l.status).toBe(200);

    const c = await mgr.post("/api/personnel").send({
      fullName: `${TAG} NV`, idCard: ID_CARD, salary: SALARY,
      workStart: "2026-03-10", workEnd: "2026-03-20",
      projectName: "DA thử", projectCode: "PRJ-PIICONTRACT",
    });
    expect(c.status).toBe(201);
    recId = c.body.id;
  });

  afterAll(async () => {
    await prisma.auditEvent.deleteMany({ where: { resource: "personnel", resourceId: String(recId) } });
    await prisma.personnelRecord.deleteMany({ where: { fullName: { startsWith: TAG } }, hardDelete: true });
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true });
  });

  it("cột thô THẬT SỰ null sau cutover (tiền đề của cả bài — nếu fail thì không phải đang test đúng kịch bản)", async () => {
    const raw = await prisma.personnelRecord.findUnique({ where: { id: recId } });
    expect(raw.salary, "cutover phải null hoá cột thô — nếu còn giá trị thì PII_PLAINTEXT_CUTOVER không có hiệu lực trong bài test này").toBeNull();
    expect(raw.idCard).toBeNull();
    expect(String(raw.salaryEnc)).toMatch(/^pii:v1:/);
  });

  it("H2 — GET /:id/contract phải tải được VÀ chứa đúng Lương/CCCD đã giải mã (KHÔNG phải 400 'thiếu Lương')", async () => {
    // superagent không có parser đăng ký sẵn cho content-type wordprocessingml → phải tự gom byte
    // thô, nếu không `r.body` sẽ là chuỗi bị hỏng encoding thay vì Buffer thật.
    const r = await mgr.get(`/api/personnel/${recId}/contract`).buffer(true).parse((res, cb) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => cb(null, Buffer.concat(chunks)));
    });
    // Trước bản vá: buildContractDocx nhận salary=null (cột thô) → ném 400 "Hồ sơ thiếu: Lương".
    expect(r.status, r.status !== 200 ? String(r.body) : "").toBe(200);
    expect(r.headers["content-type"]).toContain("wordprocessingml.document");

    const zip = await JSZip.loadAsync(r.body);
    const xml = await zip.file("word/document.xml").async("string");
    expect(xml, "phải chứa đúng số Lương đã giải mã (31,500,000), không phải dấu chấm/rỗng").toContain("31,500,000");
    expect(xml, "phải chứa đúng CCCD đã giải mã, không phải dấu chấm che (dots)").toContain(ID_CARD);
  });

  it("H3 — GET /api/personnel?... summary.salary phải cộng Lương ĐÃ GIẢI MÃ, không phải 0 (SQL SUM trên cột thô = NULL)", async () => {
    const r = await mgr.get("/api/personnel").query({ q: TAG });
    expect(r.status).toBe(200);
    expect(r.body.data.length).toBeGreaterThan(0);
    // Trước bản vá: aggregate({_sum:{salary}}) chạy trên cột thô (NULL) → summary.salary = 0.
    expect(r.body.summary.salary, "tổng lương phải bằng đúng lương hồ sơ vừa tạo, không phải 0").toBe(SALARY);
  });
});
