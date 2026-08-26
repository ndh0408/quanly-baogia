// Cụm csdl-truyvan — MST khách hàng: chống trùng phải nằm ở CSDL, không chỉ ở tầng ứng dụng.
//
// ── LỖI ─────────────────────────────────────────────────────────────────────
// `createCustomer`/`updateCustomer` (src/services/customerService.ts) kiểm trùng MST bằng
// `findFirst` rồi mới `create`/`update` — CHECK-THEN-WRITE, NGOÀI transaction, và CSDL không hề
// có ràng buộc duy nhất trên `taxCode` (chỉ có một index THƯỜNG partial + một GIN trigram).
// Hai người nhập cùng một mã số thuế trong cùng vài mili-giây thì CẢ HAI đọc "chưa có" rồi CẢ HAI
// ghi được → hai hàng Customer cùng MST. Hậu quả: doanh số/follow-up của một pháp nhân bị chẻ đôi.
//
// ── HAI TẦNG KIỂM ───────────────────────────────────────────────────────────
// A. TẦNG CSDL (tất định): chèn thẳng hai hàng SỐNG cùng `taxCode` bằng SQL — đúng cái mà cửa sổ
//    đua để lọt. Không có ràng buộc thì hai lệnh INSERT đều thành công. Kèm hai khẳng định về
//    PHẠM VI của ràng buộc, vì partial unique sai phạm vi sẽ phá hành vi đang có:
//      · nhiều khách `taxCode = NULL` vẫn phải chèn được (đa số khách lẻ không có MST);
//      · khách ĐÃ XOÁ MỀM không được chặn MST của khách mới — kiểm ở service chạy qua extension
//        soft-delete nên KHÔNG thấy bản đã xoá; ràng buộc thiếu `deletedAt IS NULL` sẽ trả 409
//        cho một MST mà giao diện khẳng định là còn trống.
// B. TẦNG HTTP (đua TẤT ĐỊNH): bắn hai POST /api/customers cùng MST và ép chúng CHỒNG NHAU bằng
//    một trigger `pg_sleep` chỉ khớp đúng hàng của bài test — request thứ hai chạy `findFirst`
//    trong lúc request thứ nhất còn đang INSERT và CHƯA commit, tức đúng cửa sổ mà đời thật chỉ
//    mở vài mili-giây. Không có ràng buộc CSDL thì CẢ HAI được 201. Bắn song song "trần" KHÔNG
//    tái hiện được (đã thử: 6 request cùng lúc vẫn ra 1×201 + 5×409) nên phải ép bằng trigger.
//    Sau khi vá: đúng một 201, bản kia 409 tiếng Việt — KHÔNG 500 (P2002 lọt ra ngoài là lỗi lạ).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { agentWithCsrf } from "./helpers/agent.js";
import bcrypt from "bcryptjs";
import { prisma } from "../src/db.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "Customer" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");

const TAG = `db3tax${Date.now()}`;
const PWD = "Test1234!a";

/** Chèn thẳng một hàng Customer bằng SQL — ĐI VÒNG qua mọi lớp kiểm của ứng dụng. */
const chenThang = (code, taxCode, deletedAt = null) => prisma.$executeRawUnsafe(
  `INSERT INTO "Customer" (code, name, "taxCode", "searchText", "updatedAt", "deletedAt")
   VALUES ($1, $2, $3, '', now(), $4)`,
  code, `${TAG} ${code}`, taxCode, deletedAt,
);

describe.runIf(dbAvailable)("MST khách hàng — ràng buộc duy nhất ở CSDL", () => {
  let app, admin;

  beforeAll(async () => {
    const { createApp } = await import("../src/app.js");
    app = createApp();
    await prisma.user.create({ data: { username: `${TAG}-admin`, displayName: `${TAG} admin`, role: "admin", passwordHash: await bcrypt.hash(PWD, 4) } });
    admin = agentWithCsrf(app);
    expect((await admin.post("/api/auth/login").send({ username: `${TAG}-admin`, password: PWD })).status).toBe(200);
  });

  afterAll(async () => {
    await prisma.customer.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true, includeDeleted: true }).catch(() => {});
    await prisma.customer.deleteMany({ where: { name: { startsWith: TAG } }, hardDelete: true, includeDeleted: true }).catch(() => {});
    await prisma.loginAttempt.deleteMany({ where: { username: { startsWith: TAG } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
  });

  // ── TẦNG A ───────────────────────────────────────────────────────────────
  it("CSDL CHẶN hai khách SỐNG cùng một MST", async () => {
    const mst = `${TAG}-0100000001`;
    await chenThang(`${TAG}a1`, mst);
    await expect(
      chenThang(`${TAG}a2`, mst),
      "hai hàng Customer sống cùng MST phải bị CSDL từ chối — tầng ứng dụng chỉ check-then-write",
    ).rejects.toThrow();
  });

  it("nhiều khách KHÔNG có MST vẫn chèn được (ràng buộc phải bỏ qua NULL)", async () => {
    await chenThang(`${TAG}b1`, null);
    await chenThang(`${TAG}b2`, null);
    const n = await prisma.customer.count({ where: { code: { startsWith: `${TAG}b` }, taxCode: null } });
    expect(n).toBe(2);
  });

  it("khách ĐÃ XOÁ MỀM không giữ MST — khách mới dùng lại được", async () => {
    const mst = `${TAG}-0100000002`;
    await chenThang(`${TAG}c1`, mst, new Date());
    await expect(chenThang(`${TAG}c2`, mst)).resolves.toBeDefined();
  });

  // ── TẦNG B ───────────────────────────────────────────────────────────────
  it("hai người nhập CÙNG một MST chồng nhau → đúng MỘT khách được tạo, bản kia 409", async () => {
    const mst = `${TAG}-0100000003`;
    const maCham = `${TAG}d1`;
    // Trigger CHỈ khớp đúng hàng của bài test này (mã + MST có TAG duy nhất) → không đụng agent khác.
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION ${TAG}_cham() RETURNS trigger AS $fn$
      BEGIN
        IF NEW.code = '${maCham}' THEN PERFORM pg_sleep(1.5); END IF;
        RETURN NEW;
      END $fn$ LANGUAGE plpgsql;`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER ${TAG}_cham_trg BEFORE INSERT ON "Customer" FOR EACH ROW EXECUTE FUNCTION ${TAG}_cham();`);
    let r1, r2;
    try {
      // supertest gửi LƯỜI (chỉ khi .then được gọi) → phải bắn NGAY rồi mới chờ.
      const p1 = admin.post("/api/customers").send({ code: maCham, name: `${TAG} dua 1`, taxCode: mst }).then((r) => r);
      await new Promise((res) => setTimeout(res, 700));   // #1 đang kẹt trong INSERT, chưa commit
      const p2 = admin.post("/api/customers").send({ code: `${TAG}d2`, name: `${TAG} dua 2`, taxCode: mst }).then((r) => r);
      [r1, r2] = await Promise.all([p1, p2]);
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${TAG}_cham_trg ON "Customer"`).catch(() => {});
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${TAG}_cham()`).catch(() => {});
    }
    const ma = [r1.status, r2.status];
    expect(ma.filter((s) => s === 201).length, `phải đúng 1 bản được tạo, nhận: ${ma.join(",")}`).toBe(1);
    // P2002 lọt ra ngoài thành 500 là hỏng trải nghiệm: thông điệp phải vẫn là 409 tiếng Việt.
    expect(ma.filter((s) => s === 500), `không được có 500: ${JSON.stringify([r1.body, r2.body])}`).toEqual([]);
    expect(await prisma.customer.count({ where: { taxCode: mst } })).toBe(1);
  }, 30_000);
});
