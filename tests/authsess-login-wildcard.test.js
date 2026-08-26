// TÊN ĐĂNG NHẬP TRỞ THÀNH MẪU KHỚP — chốt hồi quy.
//
// ── LỖI ─────────────────────────────────────────────────────────────────────
// `findLoginUser` (src/authCore.ts) tra tài khoản không phân biệt hoa/thường bằng
//     { username: { equals: loginId, mode: "insensitive" } }
// Trên Postgres, Prisma biên dịch cặp `equals` + `mode: "insensitive"` thành **ILIKE**, KHÔNG phải
// `lower(a) = lower(b)`. Nghĩa là chuỗi người dùng gõ trở thành một MẪU: `%` khớp mọi thứ, `_` khớp
// một ký tự bất kỳ.
//
// Đã đo trên CSDL thật trước khi vá — gõ đúng một ký tự `%` làm tên đăng nhập:
//     "…_alpha" → …_alpha      (đúng)
//     "…%"      → …_alpha      ← SAI
//     "%"       → …_alpha      ← SAI, khớp một tài khoản có thật bất kỳ
//
// Không phải đường vượt mật khẩu (vẫn phải đúng mật khẩu), nhưng đủ để:
//   · KHOÁ TÀI KHOẢN NGƯỜI KHÁC — vài lần sai mật khẩu với `%` là `failedAttempts` cộng lên một tài
//     khoản THẬT, mà kẻ gửi không cần biết tên đăng nhập nào tồn tại. Với ngưỡng mặc định 5 lần và
//     khoá 15 phút, một script vài dòng khoá luân phiên cả công ty.
//   · DÒ TÊN NGƯỜI DÙNG — thử `a%`, `b%`… rồi đọc phản hồi (yêu cầu MFA / bị khoá) để biết tiền tố
//     nào có thật, dù thông điệp lỗi cố ý mờ.
//   · `sendPasswordReset` dùng CHUNG hàm này nên cũng bắn được email đặt-lại cho người bất kỳ.
//
// ── CÁCH VÁ ─────────────────────────────────────────────────────────────────
// Hai lớp: (1) thử so BẰNG-ĐÚNG trước (dùng thẳng index unique, không đụng ILIKE) — đây là đường đi
// của gần như mọi lần đăng nhập; (2) chỉ khi không thấy mới rơi xuống nhánh không-phân-biệt-hoa-
// thường, và ở đó THOÁT `% _ \` để chuỗi được so như văn bản thường. Kèm `orderBy` cho tất định.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../src/db.js";
import { findLoginUser } from "../src/authCore.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "User" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");

const TAG = `lwc${Date.now()}`;

describe.runIf(dbAvailable)("findLoginUser — chuỗi người dùng gõ KHÔNG được là mẫu khớp", () => {
  beforeAll(async () => {
    await prisma.user.create({ data: { username: `${TAG}_alpha`, email: `${TAG}_alpha@vd.com`, displayName: "A", role: "admin", passwordHash: "x" } });
    await prisma.user.create({ data: { username: `${TAG}_beta`, email: `${TAG}_beta@vd.com`, displayName: "B", role: "admin", passwordHash: "x" } });
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
  });

  it.each([
    ["%", "một ký tự % — khớp MỌI tài khoản trong CSDL"],
    [`${TAG}%`, "tiền tố + % — khớp mọi tài khoản cùng tiền tố"],
    [`${TAG}_alph_`, "_ thay cho một ký tự bất kỳ"],
    ["%a%", "% ở cả hai đầu"],
    [`${TAG}\\_alpha`, "gạch dưới đã tự thoát — vẫn không được khớp tên thật"],
  ])("gõ %j (%s) → KHÔNG khớp ai", async (dauVao) => {
    // Trước khi vá: trả về một User thật → mọi lần sai mật khẩu cộng dồn vào tài khoản đó.
    expect(await findLoginUser(dauVao)).toBe(null);
  });

  it("tên ĐÚNG vẫn tìm được (không lỡ tay chặn đường đăng nhập thật)", async () => {
    expect((await findLoginUser(`${TAG}_alpha`))?.username).toBe(`${TAG}_alpha`);
    expect((await findLoginUser(`${TAG}_beta`))?.username).toBe(`${TAG}_beta`);
  });

  it("EMAIL đúng vẫn tìm được", async () => {
    expect((await findLoginUser(`${TAG}_alpha@vd.com`))?.username).toBe(`${TAG}_alpha`);
  });

  it("khác HOA/THƯỜNG vẫn tìm được — đây là lý do nhánh insensitive tồn tại", async () => {
    expect((await findLoginUser(`${TAG}_ALPHA`.toUpperCase()))?.username, "username viết hoa").toBe(`${TAG}_alpha`);
    expect((await findLoginUser(`${TAG}_ALPHA@VD.COM`.toUpperCase()))?.username, "email viết hoa").toBe(`${TAG}_alpha`);
  });

  it("hai hàng chỉ khác hoa/thường → khớp CHÍNH XÁC luôn thắng", async () => {
    const hoa = await prisma.user.create({ data: { username: `${TAG}_Case`, displayName: "C1", role: "admin", passwordHash: "x" } });
    const thuong = await prisma.user.create({ data: { username: `${TAG}_case`, displayName: "C2", role: "admin", passwordHash: "x" } });
    // Ràng buộc unique so byte nên hai hàng này CÙNG tồn tại được. Ai gõ đúng phải vào đúng của mình.
    expect((await findLoginUser(`${TAG}_Case`))?.id).toBe(hoa.id);
    expect((await findLoginUser(`${TAG}_case`))?.id).toBe(thuong.id);
  });

  it("không tìm thấy → null, không ném", async () => {
    expect(await findLoginUser(`${TAG}_khongtontai`)).toBe(null);
    expect(await findLoginUser("")).toBe(null);
  });
});
