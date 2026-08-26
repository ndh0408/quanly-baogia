// ── LỖI ─────────────────────────────────────────────────────────────────────
// `scripts/migration/pii-backfill.mjs` chỉ biết ĐIỀN bản mã cho hàng `piiVersion = 0`, và luôn mã
// hoá TỪ CỘT THÔ. Hàng đã mã hoá rồi thì bị bỏ qua vĩnh viễn — nên KHÔNG có cách nào mã hoá lại
// bằng khoá mới. `docs/operations/DISASTER_RECOVERY.md` lại dặn "chạy backfill với khoá mới", một
// lệnh không tồn tại.
//
// ── TÁI HIỆN ────────────────────────────────────────────────────────────────
// Tạo hồ sơ nhân sự có `idCardEnc`/`bankAccountEnc` mã bằng khoá CŨ, `piiVersion = 1`. Chạy
// `pii-backfill.mjs --rotate` với `PII_ENC_KEY` = khoá mới, `PII_ENC_KEY_OLD` = khoá cũ. Trước bản
// vá: cờ `--rotate` không tồn tại, script chạy backfill thường và KHÔNG đụng hàng đã mã hoá → gỡ
// khoá cũ ra là không đọc được nữa.
//
// ── HẬU QUẢ ─────────────────────────────────────────────────────────────────
// Nghi lộ `PII_ENC_KEY` mà không xoay được khoá: hoặc sống chung với khoá đã lộ, hoặc xoay rồi cả
// module Nhân sự ném lỗi (`decryptPiiOrThrow`). Cột thô còn nên không mất dữ liệu, nhưng đây là sự
// cố vận hành thật và runbook DR đang hướng dẫn một quy trình không chạy được.
//
// ── CHỐT AN TOÀN CỦA CHÍNH BÀI TEST ─────────────────────────────────────────
// `beforeAll` chạy `--rotate --dry-run` trước. Nếu script CHƯA hỗ trợ `--rotate` thì nó sẽ coi đó
// là lần backfill thường — chạy thật sẽ mã hoá TOÀN BỘ bảng nhân sự của CSDL test bằng khoá của
// bài test này, phá test của người khác. Không thấy dấu hiệu hỗ trợ → ném ngay, không chạy tiếp.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { prisma } from "../src/db.js";

const run = promisify(execFile);

const TAG = `piirot${Date.now()}`;
const OLD_KEY = "PIIROT-backfill-khoa-cu-du-dai-cho-hkdf-01";
const NEW_KEY = "PIIROT-backfill-khoa-moi-du-dai-cho-hkdf-02";
const CCCD = "079301007777";
const STK = "0071000123456";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "PersonnelRecord" LIMIT 1')
  .then(() => true)
  .catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") {
  throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres/schema PersonnelRecord");
}

/** Chạy script migration trong tiến trình con với bộ khoá chỉ định. */
async function chayScript(args, env = {}) {
  try {
    const { stdout, stderr } = await run(
      process.execPath,
      ["--import", "tsx", "scripts/migration/pii-backfill.mjs", ...args],
      {
        cwd: process.cwd(),
        maxBuffer: 8 * 1024 * 1024,
        env: { ...process.env, NODE_ENV: "test", PII_ENC_KEY: NEW_KEY, PII_ENC_KEY_OLD: OLD_KEY, ...env },
      },
    );
    return { code: 0, out: stdout + stderr };
  } catch (e) {
    return { code: e.code ?? 1, out: String(e.stdout ?? "") + String(e.stderr ?? "") };
  }
}

/** Nạp piiBox với đúng bộ khoá mong muốn (khoá được cache trong module). */
async function boxVoi({ key, old }) {
  if (key == null) delete process.env.PII_ENC_KEY;
  else process.env.PII_ENC_KEY = key;
  if (old == null) delete process.env.PII_ENC_KEY_OLD;
  else process.env.PII_ENC_KEY_OLD = old;
  const box = await import("../src/piiBox.js");
  box.__resetPiiKeyCache();
  return box;
}

describe.runIf(dbAvailable)("pii-backfill --rotate (integration)", () => {
  let idDaMa;   // hồ sơ đã mã hoá bằng khoá CŨ
  let idChuaMa; // hồ sơ còn thô (piiVersion = 0) — phải KHÔNG bị đụng
  let userId;

  beforeAll(async () => {
    const gate = await chayScript(["--rotate", "--dry-run"]);
    if (!/XOAY KHO/i.test(gate.out)) {
      throw new Error(
        "pii-backfill.mjs chưa hỗ trợ --rotate — dừng để KHÔNG chạy backfill toàn bảng nhân sự của CSDL test.\n" + gate.out,
      );
    }

    const boxCu = await boxVoi({ key: OLD_KEY, old: null });
    const u = await prisma.user.create({
      data: { username: `${TAG}-owner`, displayName: `${TAG} owner`, role: "manager", passwordHash: "x" },
    });
    userId = u.id;

    const daMa = await prisma.personnelRecord.create({
      data: {
        createdById: userId,
        fullName: `${TAG} Đã mã hoá`,
        idCard: CCCD,
        bankAccount: STK,
        idCardEnc: boxCu.encryptPii(CCCD, "PersonnelRecord:idCard"),
        idCardIdx: boxCu.blindIndex(CCCD),
        bankAccountEnc: boxCu.encryptPii(STK, "PersonnelRecord:bankAccount"),
        piiVersion: 1,
      },
    });
    idDaMa = daMa.id;

    const chuaMa = await prisma.personnelRecord.create({
      data: { createdById: userId, fullName: `${TAG} Còn thô`, idCard: "079301006666", piiVersion: 0 },
    });
    idChuaMa = chuaMa.id;
  }, 90_000);

  afterAll(async () => {
    if (userId) {
      await prisma.personnelRecord.deleteMany({ where: { createdById: userId }, hardDelete: true });
      await prisma.user.deleteMany({ where: { id: userId }, hardDelete: true });
    }
    delete process.env.PII_ENC_KEY;
    delete process.env.PII_ENC_KEY_OLD;
    const box = await import("../src/piiBox.js");
    box.__resetPiiKeyCache();
  });

  it("từ chối xoay khi THIẾU PII_ENC_KEY_OLD — không có khoá cũ thì không giải mã lại được", async () => {
    const r = await chayScript(["--rotate"], { PII_ENC_KEY_OLD: "" });
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/PII_ENC_KEY_OLD/);
  }, 90_000);

  it("mã hoá lại bằng khoá MỚI: gỡ khoá cũ ra vẫn đọc được, chỉ mục mù tính lại", async () => {
    const r = await chayScript(["--rotate"]);
    expect(r.code, r.out).toBe(0);

    const row = await prisma.personnelRecord.findUnique({
      where: { id: idDaMa },
      select: { idCard: true, bankAccount: true, idCardEnc: true, idCardIdx: true, bankAccountEnc: true, piiVersion: true },
    });

    // Chỉ còn khoá MỚI: đây là trạng thái sau khi vận hành gỡ PII_ENC_KEY_OLD.
    const boxMoi = await boxVoi({ key: NEW_KEY, old: null });
    expect(boxMoi.decryptPii(row.idCardEnc, "PersonnelRecord:idCard")).toBe(CCCD);
    expect(boxMoi.decryptPii(row.bankAccountEnc, "PersonnelRecord:bankAccount")).toBe(STK);
    expect(row.idCardIdx).toBe(boxMoi.blindIndex(CCCD));
    // Nguyên tắc 3 của script: cột thô KHÔNG bị đụng.
    expect(row.idCard).toBe(CCCD);
    expect(row.bankAccount).toBe(STK);
    expect(row.piiVersion).toBe(1);
  }, 120_000);

  it("KHÔNG đụng hàng chưa backfill (piiVersion = 0) — xoay khoá không phải là backfill", async () => {
    const row = await prisma.personnelRecord.findUnique({
      where: { id: idChuaMa },
      select: { idCard: true, idCardEnc: true, idCardIdx: true, piiVersion: true },
    });
    expect(row.piiVersion).toBe(0);
    expect(row.idCardEnc).toBeNull();
    expect(row.idCardIdx).toBeNull();
    expect(row.idCard).toBe("079301006666");
  });
});
