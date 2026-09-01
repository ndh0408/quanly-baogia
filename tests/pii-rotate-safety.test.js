// XOAY KHOÁ PII — ba lỗi làm hỏng chính quy trình được lập ra để cứu dữ liệu. Chốt hồi quy.
//
// Cả ba đều do vòng phản biện tìm ra trên bản vá "xoay được khoá PII" của đợt trước.
//
// ── LỖI 1: `--verify` báo ĐẠT một cách sai sự thật ──────────────────────────
// `decryptPii` CỐ Ý thử khoá mới rồi rơi về `PII_ENC_KEY_OLD` — đó là thứ làm cửa sổ chuyển tiếp
// không gây gián đoạn. Nhưng `scripts/migration/pii-backfill.mjs --verify` xây trên nó, và KHÔNG có
// chốt nào từ chối chạy khi `PII_ENC_KEY_OLD` còn đặt (chốt cũ chỉ áp cho `--rotate`).
//
// Đó không phải tình huống hiếm: bước ngay trước (`--rotate`) BẮT BUỘC phải có `PII_ENC_KEY_OLD`,
// nên chạy `--verify` từ cùng shell / cùng `.env` là chuyện tự nhiên nhất. Runbook thì dặn "chỉ khi
// bước 4 đạt mới HUỶ khoá cũ" → khoá cũ bị huỷ → hàng chưa xoay KHÔNG BAO GIỜ giải lại được.
//
// ── LỖI 2: xoay khoá GHI ĐÈ dữ liệu người dùng vừa sửa ──────────────────────
// `rotateModel` đọc lô 200 hàng rồi ghi lại bằng `update({ where: { id } })` — không khoá hàng,
// không so lại bản mã cũ. Mà runbook khẳng định "trong suốt quy trình đó ứng dụng vẫn phục vụ
// bình thường".
//
// Tình huống cụ thể: 10:00:03 rotate đọc hồ sơ #123 (bankAccountEnc = STK cũ) · 10:00:05 kế toán
// đổi số tài khoản qua PUT /api/personnel/123 · 10:00:07 rotate ghi đè bankAccountEnc = STK CŨ.
// Vì `decodePiiOnRead` ƯU TIÊN cột *Enc hơn cột thô, API trả STK CŨ mãi mãi sau đó → chuyển lương
// vào tài khoản sai. Bảng nhân sự vài nghìn hàng thì cửa sổ này kéo dài nhiều phút tới hàng giờ.
//
// ── LỖI 3: runbook không chạy được trong image production ───────────────────
// Runbook gọi `node --import tsx scripts/migration/pii-backfill.mjs --rotate` và `npm run
// pii:verify`. Tầng runtime của Dockerfile chỉ COPY node_modules/prisma/package.json/dist/public/
// templates — không có `scripts/`, không có `src/`, tsx là devDependency → MODULE_NOT_FOUND.
// Vá bằng `src/tools/piiRotate.ts` (biên dịch vào `dist/tools/`), giống cách đã làm cho
// `verifyIntegrity.ts`.
import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, statSync } from "node:fs";
import path from "node:path";

const chay = promisify(execFile);
const GOC = path.resolve(import.meta.dirname, "..");

const KHOA_CU = "khoa-cu-xoay-thu-32-ky-tu-aaaaaaaaaa";
const KHOA_MOI = "khoa-moi-xoay-thu-32-ky-tu-bbbbbbbb";

let envCu;
beforeEach(() => { envCu = { m: process.env.PII_ENC_KEY, c: process.env.PII_ENC_KEY_OLD }; });
afterEach(async () => {
  if (envCu.m === undefined) delete process.env.PII_ENC_KEY; else process.env.PII_ENC_KEY = envCu.m;
  if (envCu.c === undefined) delete process.env.PII_ENC_KEY_OLD; else process.env.PII_ENC_KEY_OLD = envCu.c;
  const { __resetPiiKeyCache } = await import("../src/piiBox.js");
  __resetPiiKeyCache();
});

/** Chạy script backfill trong tiến trình con với môi trường cho trước. Trả { code, out }. */
async function chayBackfill(env) {
  try {
    const r = await chay("node", ["--import", "tsx", "scripts/migration/pii-backfill.mjs", "--verify"], {
      cwd: GOC,
      env: { ...process.env, NODE_ENV: "test", LOG_LEVEL: "error", ...env },
      timeout: 60_000,
    });
    return { code: 0, out: r.stdout + r.stderr };
  } catch (e) {
    return { code: e.code ?? 1, out: (e.stdout || "") + (e.stderr || "") };
  }
}

describe("LỖI 1 — `--verify` phải TỪ CHỐI chạy khi khoá cũ còn trong môi trường", () => {
  it("còn PII_ENC_KEY_OLD → thoát khác 0 và nói rõ phải gỡ nó ra", async () => {
    const r = await chayBackfill({ PII_ENC_KEY: KHOA_MOI, PII_ENC_KEY_OLD: KHOA_CU });
    // Trước khi vá: script chạy tiếp và có thể in "✓ XÁC MINH ĐẠT" dù chưa hàng nào được xoay.
    expect(r.code, `phải thoát khác 0. Output:\n${r.out.slice(0, 600)}`).not.toBe(0);
    expect(r.out).toMatch(/PII_ENC_KEY_OLD/);
    expect(r.out, "phải nói người vận hành làm gì tiếp").toMatch(/[Gg]ỡ|rotate/);
    expect(r.out, "TUYỆT ĐỐI không được in dấu đạt").not.toMatch(/✓ XÁC MINH ĐẠT/);
  }, 90_000);

  it("KHÔNG có PII_ENC_KEY_OLD → chạy bình thường (không chặn nhầm đường đúng)", async () => {
    const r = await chayBackfill({ PII_ENC_KEY: KHOA_MOI, PII_ENC_KEY_OLD: "" });
    // Có thể đạt hoặc không tuỳ dữ liệu trong DB thử — điều cần chốt là nó KHÔNG bị chặn bởi
    // chính cái chốt vừa thêm.
    expect(r.out).not.toMatch(/--verify là bước CHỨNG MINH/);
  }, 90_000);
});

describe("LỖI 3 — công cụ xoay khoá phải CÓ THẬT trong artifact biên dịch", () => {
  it("dist/tools/piiRotate.js tồn tại sau khi build", () => {
    // Runbook (docs/operations/DISASTER_RECOVERY.md) bảo chạy đúng đường dẫn này TỪ TRONG container.
    // Image production chỉ chứa dist/ — không scripts/, không src/, không tsx.
    expect(existsSync(path.join(GOC, "dist/tools/piiRotate.js")), "chạy `npm run build` trước").toBe(true);
  });

  // ── dist/ PHẢI MỚI HƠN src/ ────────────────────────────────────────────────
  // Bốn bài trong file này chạy `node dist/tools/piiRotate.js`, tức chúng kiểm một artifact BIÊN
  // DỊCH mà vitest KHÔNG dựng lại. Nếu dist/ cũ hơn src/ thì chúng đang kiểm mã của lần build
  // trước, và mọi khẳng định bên dưới nói về một thứ không còn tồn tại.
  //
  // ĐO ĐƯỢC (2026-08-27): xoá sạch src/tools/piiRotate.ts còn đúng `export {};` rồi chạy file này
  // → 8/9 bài VẪN XANH. Chỉ bài đọc thẳng mã nguồn là đỏ. Đó là lý do có chốt này.
  //
  // scripts/verify-local.sh nay dựng dist/ ở bước [2b], TRƯỚC bước test [4]. Chốt này KHÔNG thừa:
  // nó bắt được cả người chạy `npx vitest run` thẳng tay (đường phổ biến nhất khi sửa một test),
  // và bắt được cả việc ai đó xếp lại thứ tự bước trong script.
  it("dist/tools/piiRotate.js MỚI HƠN src/tools/piiRotate.ts — nếu không, 4 bài dưới kiểm mã CŨ", () => {
    const dist = statSync(path.join(GOC, "dist/tools/piiRotate.js")).mtimeMs;
    const src = statSync(path.join(GOC, "src/tools/piiRotate.ts")).mtimeMs;
    expect(dist,
      `dist/tools/piiRotate.js (${new Date(dist).toISOString()}) CŨ HƠN src/tools/piiRotate.ts ` +
      `(${new Date(src).toISOString()}). Bốn bài chạy \`node dist/...\` bên dưới đang kiểm bản ` +
      `biên dịch của lần trước — chúng sẽ XANH kể cả khi bản vá ở src/ bị gỡ sạch. ` +
      `Chạy \`npm run build\` rồi chạy lại (scripts/verify-local.sh làm việc này ở bước [2b]).`)
      .toBeGreaterThanOrEqual(src);
  });

  it("runbook KHÔNG còn chỉ người vận hành gõ lệnh không tồn tại trong container", async () => {
    const { readFile } = await import("node:fs/promises");
    const doc = await readFile(path.join(GOC, "docs/operations/DISASTER_RECOVERY.md"), "utf8");
    const khoiXoay = doc.slice(doc.indexOf("### Xoay `PII_ENC_KEY`"), doc.indexOf("### Sao lưu kho object"));
    expect(khoiXoay.length).toBeGreaterThan(200);
    expect(khoiXoay, "scripts/ KHÔNG có trong image production").not.toMatch(/scripts\/migration\/pii-backfill\.mjs --rotate/);
    expect(khoiXoay, "npm scripts cũng không dùng được trong image").not.toMatch(/npm run pii:verify/);
    expect(khoiXoay).toMatch(/dist\/tools\/piiRotate\.js/);
    expect(khoiXoay).toMatch(/dist\/tools\/verifyIntegrity\.js/);
  });

  it("piiRotate CHẶN khi thiếu khoá cũ, thay vì chạy 10 phút rồi báo '0 xoay được'", async () => {
    let r;
    try {
      const o = await chay("node", ["dist/tools/piiRotate.js", "--dry-run"], {
        cwd: GOC, env: { ...process.env, NODE_ENV: "test", LOG_LEVEL: "error", PII_ENC_KEY: KHOA_MOI, PII_ENC_KEY_OLD: "" }, timeout: 60_000,
      });
      r = { code: 0, out: o.stdout + o.stderr };
    } catch (e) { r = { code: e.code ?? 1, out: (e.stdout || "") + (e.stderr || "") }; }
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/PII_ENC_KEY_OLD/);
  }, 90_000);

  it("piiRotate CHẶN khi khoá cũ TRÙNG khoá mới", async () => {
    let r;
    try {
      const o = await chay("node", ["dist/tools/piiRotate.js", "--dry-run"], {
        cwd: GOC, env: { ...process.env, NODE_ENV: "test", LOG_LEVEL: "error", PII_ENC_KEY: KHOA_MOI, PII_ENC_KEY_OLD: KHOA_MOI }, timeout: 60_000,
      });
      r = { code: 0, out: o.stdout + o.stderr };
    } catch (e) { r = { code: e.code ?? 1, out: (e.stdout || "") + (e.stderr || "") }; }
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/trùng/i);
  }, 90_000);
});

// ── LỖI 2: xoay khoá GHI ĐÈ dữ liệu người dùng vừa sửa ─────────────────────
//
// Bài dưới chạy trên CSDL THẬT và dựng lại đúng dòng thời gian đã được mô tả trong báo cáo phản
// biện, không mô phỏng bằng mock:
//
//   T1  rotate ĐỌC lô, thấy bankAccountEnc = <bản mã A>
//   T2  kế toán sửa số tài khoản qua ứng dụng → bankAccountEnc = <bản mã B>
//   T3  rotate GHI LẠI hàng đó
//
// Ở T3, `update({ where: { id } })` ghi đè B bằng A-mã-lại. Vì `decodePiiOnRead` ƯU TIÊN cột *Enc
// hơn cột thô, API trả SỐ TÀI KHOẢN CŨ mãi mãi sau đó — tiền lương chuyển sai chỗ, và không có
// thông báo nào.
//
// Bản vá dùng `updateMany` kèm bản mã CŨ trong WHERE (compare-and-set). Hàng đã đổi thì
// `count === 0` và rotate bỏ qua — hàng đó vốn đã mang khoá MỚI rồi (encodePiiForWrite luôn dùng
// khoá hiện tại), nên bỏ qua là ĐÚNG.
import { prisma as prismaDb } from "../src/db.js";

const dbOk = await prismaDb.$queryRawUnsafe('SELECT 1 FROM "PersonnelRecord" LIMIT 1').then(() => true).catch(() => false);
// REQUIRE_DB_TESTS=1 nghĩa là "thiếu hạ tầng thì ĐỎ, đừng bỏ qua âm thầm" — nhãn của bước [4/9]
// trong scripts/verify-local.sh khẳng định đúng thế. File này TỪNG không tuân: mất CSDL thì
// `describe.runIf(dbOk)` lặng lẽ bỏ 3 bài và cổng vẫn xanh, đúng lớp lỗi ngầm mà cờ ấy sinh ra để
// chặn. Một cổng nói "đã kiểm" về thứ nó không hề kiểm thì tệ hơn không có cổng.
if (!dbOk && process.env.REQUIRE_DB_TESTS === "1") {
  throw new Error("REQUIRE_DB_TESTS=1 nhưng không đọc được bảng PersonnelRecord — nhóm 'xoay khoá không ghi đè' sẽ bị bỏ qua âm thầm");
}
const TAG_R = `rot${Date.now()}`;

describe.runIf(dbOk)("LỖI 2 — xoay khoá KHÔNG được ghi đè bản ghi người dùng vừa sửa", () => {
  let nguoiTao;
  beforeAll(async () => {
    const bcrypt = (await import("bcryptjs")).default;
    nguoiTao = await prismaDb.user.create({
      data: { username: `${TAG_R}u`, displayName: TAG_R, role: "admin", passwordHash: await bcrypt.hash("x", 4) },
    });
  });
  afterAll(async () => {
    await prismaDb.personnelRecord.deleteMany({ where: { fullName: { startsWith: TAG_R } }, hardDelete: true }).catch(() => {});
    await prismaDb.user.deleteMany({ where: { username: { startsWith: TAG_R } }, hardDelete: true }).catch(() => {});
  });

  it("ứng dụng ghi XEN GIỮA lúc rotate đọc và lúc rotate ghi → dữ liệu MỚI phải sống sót", async () => {
    const MA_A = "pii:v1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";   // bản mã "cũ" mà rotate đọc được
    const MA_B = "pii:v1:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";   // ứng dụng ghi đè bằng cái này
    const MA_C = "pii:v1:CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC";   // rotate định ghi (A mã lại)

    const hs = await prismaDb.personnelRecord.create({
      data: { fullName: `${TAG_R} Nguyễn A`, createdById: nguoiTao.id, piiVersion: 1, bankAccountEnc: MA_A },
    });

    // T1 — rotate đọc lô. Đây chính là ảnh chụp mà nó sẽ dùng ở T3.
    const doc = await prismaDb.personnelRecord.findFirst({ where: { id: hs.id }, select: { id: true, bankAccountEnc: true } });
    expect(doc.bankAccountEnc).toBe(MA_A);

    // T2 — kế toán sửa số tài khoản qua ứng dụng.
    await prismaDb.personnelRecord.update({ where: { id: hs.id }, data: { bankAccountEnc: MA_B } });

    // T3 — rotate ghi lại, CÓ ĐIỀU KIỆN trên bản mã nó đã đọc ở T1.
    const kq = await prismaDb.personnelRecord.updateMany({
      where: { id: doc.id, bankAccountEnc: doc.bankAccountEnc },
      data: { bankAccountEnc: MA_C },
    });

    expect(kq.count, "hàng đã đổi giữa chừng → KHÔNG được ghi").toBe(0);
    const sau = await prismaDb.personnelRecord.findFirst({ where: { id: hs.id }, select: { bankAccountEnc: true } });
    // Trước khi vá (`update({ where: { id } })`) giá trị ở đây là MA_C — tức số tài khoản CŨ.
    expect(sau.bankAccountEnc, "số tài khoản kế toán vừa nhập phải còn nguyên").toBe(MA_B);
  });

  it("KHÔNG ai đụng vào → rotate vẫn ghi được bình thường (không chặn nhầm đường đúng)", async () => {
    const MA_A = "pii:v1:DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD";
    const MA_C = "pii:v1:EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE";
    const hs = await prismaDb.personnelRecord.create({
      data: { fullName: `${TAG_R} Trần B`, createdById: nguoiTao.id, piiVersion: 1, bankAccountEnc: MA_A },
    });
    const doc = await prismaDb.personnelRecord.findFirst({ where: { id: hs.id }, select: { id: true, bankAccountEnc: true } });
    const kq = await prismaDb.personnelRecord.updateMany({
      where: { id: doc.id, bankAccountEnc: doc.bankAccountEnc },
      data: { bankAccountEnc: MA_C },
    });
    expect(kq.count).toBe(1);
    const sau = await prismaDb.personnelRecord.findFirst({ where: { id: hs.id }, select: { bankAccountEnc: true } });
    expect(sau.bankAccountEnc).toBe(MA_C);
  });

  it("mã nguồn xoay khoá KHÔNG còn dùng `update({ where: { id } })` để ghi mù", async () => {
    // Chốt ở mức mã nguồn cho CẢ HAI bản (script dev và tool trong image), vì hai bài trên chứng
    // minh CƠ CHẾ đúng nhưng không buộc mã phải dùng cơ chế đó.
    const { readFile } = await import("node:fs/promises");
    for (const f of ["scripts/migration/pii-backfill.mjs", "src/tools/piiRotate.ts"]) {
      const src = await readFile(path.join(GOC, f), "utf8");
      const khoiXoay = src.slice(src.indexOf("XOAY KHOÁ"));
      expect(khoiXoay, `${f} vẫn ghi mù`).toMatch(/updateMany\(\{\s*where:\s*dieuKien/);
    }
  });
});
