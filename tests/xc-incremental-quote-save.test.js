// ── §16 + §47: LƯU TĂNG DẦN Ở MỨC TRANG, SAU MỘT CỜ TÍNH NĂNG ────────────────
//
// Đường lưu báo giá xoá MỌI trang rồi tạo lại. Số đo (scripts/bench/quote-save-bench.mjs): sửa một
// ô trong báo giá 10.000 dòng tốn ~3,9 giây, 98% nằm ở ghi CSDL, và lần đọc để biết "trang này có
// đổi không" chỉ tốn ~95 ms. Cờ `INCREMENTAL_QUOTE_SAVE` bỏ qua việc ghi lại các trang KHÔNG ĐỔI.
//
// Bộ bài này canh đúng một điều: BẬT CỜ KHÔNG ĐƯỢC ĐỔI KẾT QUẢ. Nhanh hơn mà lệch dù một trường
// cũng là mất dữ liệu âm thầm — người dùng nhận 200 và "Đã lưu", rồi tải lại mới thấy mất.
//
// Cách chứng minh "đã thật sự bỏ qua": so `QuoteSheet.id`. Trang bị xoá-tạo-lại thì id MỚI; trang
// được giữ thì id CŨ. Đó là bằng chứng trực tiếp, không phải đo thời gian (thời gian dao động và
// một bài test bám vào nó sẽ nhấp nháy).
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { prisma } from "../src/db.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "User" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");

const TAG = `inc${Date.now()}`;
const PWD = "Inc1234!abc";
const ORIGIN = process.env.APP_BASE_URL || "http://localhost:3000";

/** Dựng app với cờ bật/tắt. config.ts đọc env LÚC NẠP MODULE nên phải reset. */
async function appVoi(bat) {
  vi.resetModules();
  const cu = process.env.INCREMENTAL_QUOTE_SAVE;
  process.env.INCREMENTAL_QUOTE_SAVE = bat ? "true" : "false";
  const { createApp } = await import("../src/app.js");
  const app = createApp();
  if (cu === undefined) delete process.env.INCREMENTAL_QUOTE_SAVE;
  else process.env.INCREMENTAL_QUOTE_SAVE = cu;
  return app;
}

describe.runIf(dbAvailable)("§16 lưu tăng dần ở mức trang (INCREMENTAL_QUOTE_SAVE)", () => {
  let appBat, appTat, u, co, tpl;

  const dangNhap = async (app) => {
    const agent = request.agent(app);
    expect((await agent.post("/api/auth/login").send({ username: u.username, password: PWD })).status).toBe(200);
    const ma = (await agent.get("/api/csrf-token")).body.token;
    return { agent, ma };
  };

  /** Tạo báo giá 3 trang, mỗi trang 3 dòng. */
  const taoBaoGia = async (hau) => {
    const q = await prisma.quote.create({
      data: {
        quoteNumber: `${TAG}-${hau}`,
        title: `Báo giá ${hau}`,
        toCompany: "Khách Inc",
        companyId: co.id,
        fromContact: "Inc",
        fromAddress: "1 Đường Thử",
        city: "TP. Hồ Chí Minh",
        quoteDate: new Date(),
        createdById: u.id,
        status: "draft",
        sheets: {
          create: [0, 1, 2].map((t) => ({
            templateId: tpl.id,
            order: t + 1,
            name: `Trang ${t + 1}`,
            items: {
              create: [0, 1, 2].map((i) => ({
                order: i + 1,
                kind: "item",
                name: `Hạng mục ${t + 1}.${i + 1}`,
                unit: "cái",
                quantity: 2,
                unitPrice: 100000 + t * 1000 + i,
              })),
            },
          })),
        },
      },
      include: { sheets: { orderBy: { order: "asc" } } },
    });
    return q;
  };

  /** Payload lưu = ĐÚNG thứ trình soạn gửi: cả báo giá, mọi trang, mọi dòng. */
  const napPayload = async ({ agent }, id) => {
    const r = await agent.get(`/api/quotes/${id}`).set("Origin", ORIGIN);
    expect(r.status).toBe(200);
    const p = JSON.parse(JSON.stringify(r.body));
    // `presentQuote` trả bảng nội bộ theo hình dạng ĐỌC; schema GHI đòi mảng phẳng có `category`.
    // Báo giá trong bài này không có bảng nội bộ nào nên mảng rỗng là đúng dữ liệu.
    for (const sh of p.sheets) sh.extraTables = [];
    p.baseUpdatedAt = p.updatedAt;
    return p;
  };

  const luu = async ({ agent, ma }, id, p) => {
    const r = await agent.put(`/api/quotes/${id}`).set("Origin", ORIGIN).set("x-csrf-token", ma).send(p);
    expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBe(200);
    return r.body;
  };

  /**
   * LƯU MỘT LẦN CHO "CHÍN" rồi mới đo.
   *
   * `taoBaoGia` dựng thẳng qua Prisma nên cột `QuoteSheet.subtotal` còn ở mặc định 0 — trong khi
   * đường lưu thật LUÔN ghi lại subtotal đã tính (`computeQuoteTotals().sheetTotals`). Nên lần lưu
   * ĐẦU TIÊN sau khi dựng fixture thật sự có đổi dữ liệu ở mọi trang, và việc nó tạo lại mọi trang
   * là ĐÚNG, không phải hỏng. Báo giá trong đời thật đã qua ít nhất một lần Lưu; mồi ở đây để bài
   * test đo đúng cảnh đó thay vì đo một cảnh không tồn tại.
   */
  const moi = async (phien, id) => { await luu(phien, id, await napPayload(phien, id)); };

  const idTrang = async (quoteId) =>
    (await prisma.quoteSheet.findMany({ where: { quoteId }, orderBy: { order: "asc" }, select: { id: true } })).map((s) => s.id);

  /** Ảnh chụp NỘI DUNG (không gồm id / mốc thời gian) để so hai đường với nhau. */
  const anhChup = async (quoteId) => {
    const sheets = await prisma.quoteSheet.findMany({
      where: { quoteId },
      orderBy: { order: "asc" },
      include: { items: { orderBy: { order: "asc" } } },
    });
    return sheets.map((s) => ({
      order: s.order,
      name: s.name,
      groupSubtotal: s.groupSubtotal,
      showImages: s.showImages,
      subtotal: String(s.subtotal),
      custStatus: s.custStatus,
      invoiceNo: s.invoiceNo,
      extraTables: s.extraTables,
      items: s.items.map((i) => ({
        order: i.order,
        kind: i.kind,
        name: i.name,
        unit: i.unit,
        quantity: String(i.quantity),
        unitPrice: String(i.unitPrice),
        days: i.days === null ? null : String(i.days),
        notes: i.notes,
      })),
    }));
  };

  beforeAll(async () => {
    appBat = await appVoi(true);
    appTat = await appVoi(false);
    u = await prisma.user.create({
      data: { username: `${TAG}-u`, displayName: `${TAG} u`, role: "admin", passwordHash: await bcrypt.hash(PWD, 4) },
    });
    co = await prisma.company.create({
      data: { code: `${TAG}CO`, name: "Cty Inc", address: "1 Đường Thử", quotePrefix: `I${String(process.pid).slice(-4)}` },
    });
    const daDung = new Set(
      (await prisma.quoteTemplate.findMany({ select: { code: true }, includeDeleted: true })).map((t) => t.code),
    );
    const { TEMPLATE_CONFIGS, getConfig } = await import("../src/templateConfigs.js");
    const ma = Object.keys(TEMPLATE_CONFIGS).find((m) => !daDung.has(m));
    if (!ma) throw new Error("CSDL đã dùng hết mã mẫu — bài test cần 1 mã còn trống");
    tpl = await prisma.quoteTemplate.create({
      data: { companyId: co.id, name: "Mẫu Inc", code: ma, filePath: getConfig(ma).filePath },
    });
  });

  afterAll(async () => {
    if (co) await prisma.quote.deleteMany({ where: { companyId: co.id }, hardDelete: true, includeDeleted: true }).catch(() => {});
    if (tpl) await prisma.quoteTemplate.deleteMany({ where: { id: tpl.id }, hardDelete: true, includeDeleted: true }).catch(() => {});
    if (co) await prisma.company.deleteMany({ where: { id: co.id }, hardDelete: true, includeDeleted: true }).catch(() => {});
    await prisma.loginAttempt.deleteMany({ where: { username: { startsWith: TAG } } }).catch(() => {});
    if (u) await prisma.user.deleteMany({ where: { id: u.id }, hardDelete: true, includeDeleted: true }).catch(() => {});
  });

  it("CỜ TẮT (mặc định): lưu lại y nguyên vẫn xoá-tạo-lại MỌI trang", async () => {
    const phien = await dangNhap(appTat);
    const q = await taoBaoGia("tat-nooop");
    await moi(phien, q.id);
    const truoc = await idTrang(q.id);
    await luu(phien, q.id, await napPayload(phien, q.id));
    const sau = await idTrang(q.id);
    expect(sau).toHaveLength(3);
    expect(sau.some((id) => truoc.includes(id))).toBe(false); // không id nào sống sót
  });

  it("CỜ BẬT: lưu lại y nguyên KHÔNG đụng trang nào (mọi id giữ nguyên)", async () => {
    const phien = await dangNhap(appBat);
    const q = await taoBaoGia("bat-noop");
    await moi(phien, q.id);
    const truoc = await idTrang(q.id);
    await luu(phien, q.id, await napPayload(phien, q.id));
    expect(await idTrang(q.id)).toEqual(truoc);
  });

  it("CỜ BẬT: sửa MỘT ô ở trang 1 chỉ tạo lại trang 1, hai trang kia giữ nguyên id", async () => {
    const phien = await dangNhap(appBat);
    const q = await taoBaoGia("bat-1o");
    await moi(phien, q.id);
    const truoc = await idTrang(q.id);
    const p = await napPayload(phien, q.id);
    p.sheets[0].items[0].unitPrice = 999000;
    await luu(phien, q.id, p);
    const sau = await idTrang(q.id);
    expect(sau[0]).not.toBe(truoc[0]); // trang đổi → id mới
    expect(sau[1]).toBe(truoc[1]);
    expect(sau[2]).toBe(truoc[2]);
    const dong = await prisma.quoteItem.findFirst({
      where: { sheetId: sau[0], order: 1 },
      select: { unitPrice: true },
    });
    expect(Number(dong.unitPrice)).toBe(999000);
  });

  it("BẬT và TẮT cho ra CÙNG nội dung — trên cùng một chuỗi thao tác", async () => {
    // Đây là bài đắt nhất của cả file: hai báo giá y hệt, cùng chuỗi sửa, hai đường lưu khác nhau.
    const doi = [
      { ten: "sosanh-tat", phien: await dangNhap(appTat) },
      { ten: "sosanh-bat", phien: await dangNhap(appBat) },
    ];
    const ket = [];
    for (const { ten, phien } of doi) {
      const q = await taoBaoGia(ten);
      await moi(phien, q.id);
      // 1. đổi giá một dòng ở trang giữa
      let p = await napPayload(phien, q.id);
      p.sheets[1].items[1].unitPrice = 777000;
      await luu(phien, q.id, p);
      // 2. thêm một dòng vào trang cuối
      p = await napPayload(phien, q.id);
      p.sheets[2].items.push({ order: 4, kind: "item", name: "Dòng thêm", unit: "bộ", quantity: 5, unitPrice: 20000 });
      await luu(phien, q.id, p);
      // 3. đổi tên trang đầu
      p = await napPayload(phien, q.id);
      p.sheets[0].name = "Trang đầu đã đổi tên";
      await luu(phien, q.id, p);
      // 4. xoá trang giữa
      p = await napPayload(phien, q.id);
      p.sheets.splice(1, 1);
      p.sheets.forEach((s, i) => { s.order = i + 1; });
      await luu(phien, q.id, p);
      // 5. đảo thứ tự hai trang còn lại
      p = await napPayload(phien, q.id);
      p.sheets.reverse();
      p.sheets.forEach((s, i) => { s.order = i + 1; });
      await luu(phien, q.id, p);
      ket.push(await anhChup(q.id));
    }
    expect(ket[1]).toEqual(ket[0]);
    expect(ket[0]).toHaveLength(2);
  });

  it("CỜ BẬT: trạng thái mức trang (khách duyệt, số hoá đơn) sống sót ở CẢ trang giữ lẫn trang tạo lại", async () => {
    const phien = await dangNhap(appBat);
    const q = await taoBaoGia("bat-carry");
    await moi(phien, q.id);
    const truoc = await idTrang(q.id);
    // Ghi thẳng trạng thái do MÁY CHỦ giữ (client không đặt được qua đường lưu thường).
    await prisma.quoteSheet.update({ where: { id: truoc[0] }, data: { custStatus: "approved", invoiceNo: "HD-001" } });
    await prisma.quoteSheet.update({ where: { id: truoc[2] }, data: { custStatus: "rejected", invoiceNo: "HD-003" } });

    const p = await napPayload(phien, q.id);
    p.sheets[0].items[0].notes = "sửa để trang 1 phải tạo lại";
    await luu(phien, q.id, p);

    const sau = await prisma.quoteSheet.findMany({
      where: { quoteId: q.id },
      orderBy: { order: "asc" },
      select: { id: true, custStatus: true, invoiceNo: true },
    });
    expect(sau[0].id).not.toBe(truoc[0]);         // tạo lại
    expect(sau[0].custStatus).toBe("approved");    // …mà vẫn bê được trạng thái
    expect(sau[0].invoiceNo).toBe("HD-001");
    expect(sau[2].id).toBe(truoc[2]);              // giữ nguyên
    expect(sau[2].custStatus).toBe("rejected");
    expect(sau[2].invoiceNo).toBe("HD-003");
  });

  it("CỜ BẬT: đảo thứ tự trang — hai trang đổi chỗ bị tạo lại, trang ĐỨNG YÊN vẫn giữ id", async () => {
    // `order` nằm trong phép so, nên trang nào đổi vị trí là đổi dữ liệu thật và phải ghi lại.
    // Đảo ngược 3 trang thì trang GIỮA về đúng chỗ cũ — giữ nó lại là ĐÚNG, không phải sót.
    // Bài này chốt đúng ranh giới đó thay vì "không giữ trang nào" (câu đó sai, và một bài test
    // sai theo hướng khắt khe hơn vẫn là bài test sai).
    const phien = await dangNhap(appBat);
    const q = await taoBaoGia("bat-daothutu");
    await moi(phien, q.id);
    const truoc = await idTrang(q.id);          // theo order: [A, B, C]
    const p = await napPayload(phien, q.id);
    p.sheets.reverse();
    p.sheets.forEach((s, i) => { s.order = i + 1; });
    await luu(phien, q.id, p);
    const sau = await idTrang(q.id);
    expect(sau[1]).toBe(truoc[1]);              // B vẫn ở vị trí 2 → không đụng
    expect(sau[0]).not.toBe(truoc[0]);
    expect(sau[0]).not.toBe(truoc[2]);          // C bị TẠO LẠI (id mới), không phải dời chỗ
    expect(sau[2]).not.toBe(truoc[2]);
    expect(sau[2]).not.toBe(truoc[0]);
    // Và nội dung phải thật sự đảo: tên trang đầu giờ là tên trang cuối cũ.
    const ten = (await prisma.quoteSheet.findMany({ where: { quoteId: q.id }, orderBy: { order: "asc" }, select: { name: true } })).map((x) => x.name);
    expect(ten).toEqual(["Trang 3", "Trang 2", "Trang 1"]);
  });

  it("CỜ BẬT: khoá lạc quan vẫn chặn ghi đè (409), không bị đường mới lách qua", async () => {
    const phien = await dangNhap(appBat);
    const q = await taoBaoGia("bat-409");
    const p = await napPayload(phien, q.id);
    p.baseUpdatedAt = "2020-01-01T00:00:00.000Z"; // mốc CŨ → người khác đã lưu
    p.sheets[0].items[0].unitPrice = 1;
    const r = await phien.agent
      .put(`/api/quotes/${q.id}`)
      .set("Origin", ORIGIN)
      .set("x-csrf-token", phien.ma)
      .send(p);
    expect(r.status).toBe(409);
  });
});
