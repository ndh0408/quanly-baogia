#!/usr/bin/env node
// ============================================================================
// quote-save-bench.mjs — ĐO GIÁ THẬT CỦA MỘT LẦN BẤM "LƯU".
//
//   node scripts/bench/quote-save-bench.mjs            # bộ kích cỡ mặc định
//   node scripts/bench/quote-save-bench.mjs 200 2000   # chỉ đo hai kích cỡ này
//   BENCH_LAP=7 node scripts/bench/quote-save-bench.mjs
//
// ── VÌ SAO TỒN TẠI ─────────────────────────────────────────────────────────
// §16 của quy ước dự án đề xuất chuyển lưu báo giá sang "incremental mutation" (chỉ ghi sheet/dòng
// THAY ĐỔI thay vì xoá-tạo-lại toàn bộ), và ghi rõ ĐIỀU KIỆN:
//
//     "Không thực hiện full incremental rewrite nếu benchmark chứng minh complexity > benefit.
//      Phải benchmark trước/sau."
//
// Nên bước ĐẦU không phải là viết mã mới, mà là con số. File này sinh ra con số đó, và làm luôn
// vế "sau": nó đo cả CHI PHÍ SÀN của đường incremental (một UPDATE đúng một ô) trên CÙNG báo giá,
// cùng máy, cùng lượt chạy. Hai cột cạnh nhau là đủ để quyết định mà không phải viết trước rồi mới
// biết có đáng không.
//
// ── ĐO CÁI GÌ, VÀ VÌ SAO ĐO Ở TẦNG HTTP ────────────────────────────────────
// Đi qua `supertest(createApp())` chứ không gọi thẳng service: chi phí thật của một lần Lưu gồm cả
// phân giải thân JSON vài MB, zod duyệt từng dòng, tính tiền bằng Decimal, rồi mới tới transaction.
// Gọi thẳng service sẽ cho một con số đẹp mà không ai từng gặp.
//
// KHÔNG dùng cổng mạng: supertest tự dựng máy chủ tạm trên cổng ngẫu nhiên nội bộ, nên đo được cả
// trên máy đang chạy sẵn ứng dụng.
//
// ── CẢNH BÁO VỀ SỐ ─────────────────────────────────────────────────────────
// Số phụ thuộc máy và Postgres cục bộ. Đọc TỈ LỆ giữa các cột, đừng chép số tuyệt đối sang máy
// khác. Mỗi kích cỡ chạy `BENCH_LAP` lần (mặc định 5) và báo cả trung vị lẫn p95 — một lần chạy
// đơn lẻ ở đây dao động tới vài chục phần trăm.
import request from "supertest";
import bcrypt from "bcryptjs";
import { performance } from "node:perf_hooks";

const KICH_CO = process.argv.slice(2).map(Number).filter((n) => Number.isFinite(n) && n > 0);
const CO = KICH_CO.length ? KICH_CO : [100, 500, 2000, 5000];
const LAP = Number(process.env.BENCH_LAP || 5);
const TAG = `bench${Date.now()}`;
const PWD = "Bench1234!a";

const { prisma } = await import("../../dist/db.js");
const { TEMPLATE_CONFIGS, getConfig } = await import("../../dist/templateConfigs.js");
const { createApp } = await import("../../dist/app.js");
const { QuoteUpdateSchema } = await import("../../dist/validators.js");
const { computeQuoteTotals } = await import("../../dist/money.js");
const { snapshotQuoteVersion } = await import("../../dist/quoteVersion.js");

const trungVi = (a) => { const b = [...a].sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
const p95 = (a) => { const b = [...a].sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.ceil(b.length * 0.95) - 1)]; };
const ms = (n) => `${n.toFixed(1)} ms`;

let co = null, tpl = null, u = null;

async function dungMoiTruong() {
  u = await prisma.user.create({ data: {
    username: `${TAG}-admin`, displayName: "Bench Admin", role: "admin", passwordHash: await bcrypt.hash(PWD, 4),
  } });
  co = await prisma.company.create({ data: {
    code: `${TAG}CO`, name: "Cty Bench", address: "1 Đường Đo", quotePrefix: `B${String(process.pid).slice(-4)}`,
  } });
  // Mã mẫu phải là khoá CÓ THẬT trong TEMPLATE_CONFIGS — `getConfig` ném với mã lạ (src/excel.ts).
  const daDung = new Set((await prisma.quoteTemplate.findMany({ select: { code: true }, includeDeleted: true })).map((t) => t.code));
  const ma = Object.keys(TEMPLATE_CONFIGS).find((m) => !daDung.has(m));
  if (!ma) throw new Error("CSDL đã dùng hết mã mẫu — bench cần 1 mã còn trống");
  tpl = await prisma.quoteTemplate.create({ data: { companyId: co.id, name: "Mẫu Bench", code: ma, filePath: getConfig(ma).filePath } });
}

async function donDep() {
  if (co) await prisma.quote.deleteMany({ where: { companyId: co.id }, hardDelete: true, includeDeleted: true }).catch(() => {});
  if (tpl) await prisma.quoteTemplate.deleteMany({ where: { id: tpl.id }, hardDelete: true, includeDeleted: true }).catch(() => {});
  if (co) await prisma.company.deleteMany({ where: { id: co.id }, hardDelete: true, includeDeleted: true }).catch(() => {});
  if (u) await prisma.loginAttempt.deleteMany({ where: { username: { startsWith: TAG } } }).catch(() => {});
  if (u) await prisma.user.deleteMany({ where: { id: u.id }, hardDelete: true, includeDeleted: true }).catch(() => {});
  await prisma.$disconnect().catch(() => {});
}

const dongMau = (i) => ({
  order: i + 1, kind: "item", name: `Hạng mục ${i + 1}`, detail: `Chi tiết dòng ${i + 1}`,
  unit: "cái", quantity: 2, unitPrice: 100000 + i, days: null, notes: "",
});

async function doMotKichCo(app, agent, maCsrf, n) {
  // Trần THẬT của validator: 1000 dòng / trang, 60 trang / báo giá (src/validators.ts
  // MAX_SAVE_ITEMS_PER_SHEET · MAX_SAVE_SHEETS). Nên "10.000 dòng" trong đời thật là 10 TRANG,
  // không phải một trang khổng lồ — chia đúng như vậy, nếu không bài đo sẽ dựng một hình dạng dữ
  // liệu mà máy chủ TỪ CHỐI, và con số đo được chẳng nói về cái gì cả.
  const MOI_TRANG = 1000;
  const soTrang = Math.ceil(n / MOI_TRANG);
  if (soTrang > MAX_TRANG) throw new Error(`${n} dòng cần ${soTrang} trang, quá trần ${MAX_TRANG}`);
  const trang = Array.from({ length: soTrang }, (_, t) => ({
    templateId: tpl.id, order: t + 1, name: `Trang ${t + 1}`,
    items: { create: Array.from({ length: Math.min(MOI_TRANG, n - t * MOI_TRANG) }, (_, i) => dongMau(t * MOI_TRANG + i)) },
  }));
  // Báo giá dựng THẲNG qua Prisma: đây là chi phí CHUẨN BỊ, không phải thứ đang đo.
  const bg = await prisma.quote.create({ data: {
    quoteNumber: `${TAG}-${n}`, title: `Bench ${n} dòng`, toCompany: "Khách Bench",
    companyId: co.id, fromContact: "Bench", fromAddress: "1 Đường Đo", city: "TP. Hồ Chí Minh",
    quoteDate: new Date(), createdById: u.id, status: "draft",
    sheets: { create: trang },
  }, include: { sheets: { include: { items: true } } } });

  const nap = async () => {
    const r = await agent.get(`/api/quotes/${bg.id}`).set("Origin", GOC);
    if (r.status !== 200) throw new Error(`GET /api/quotes/${bg.id} → ${r.status}`);
    return r.body;
  };

  // ── LƯU MỘT LẦN CHO "CHÍN", RỒI MỚI CHỤP PAYLOAD ─────────────────────────
  // Hai lý do, và cả hai đều làm hỏng phép đo nếu bỏ qua:
  //
  //  1. Báo giá vừa dựng thẳng qua Prisma còn để `QuoteSheet.subtotal` ở mặc định 0, mà đường lưu
  //     LUÔN ghi lại subtotal đã tính. Lần lưu đầu tiên vì thế THẬT SỰ đổi dữ liệu ở mọi trang.
  //
  //  2. Lưu = xoá trang rồi tạo lại, tức MỌI `sheet.id` đổi. Payload chụp TRƯỚC lần lưu ấy mang id
  //     đã chết; `carrySheetState` dò theo id nên không ghép được trang nào, và cờ
  //     INCREMENTAL_QUOTE_SAVE không bao giờ có cơ hội giữ trang nào lại. Bản đầu của file này
  //     chụp trước khi mồi và báo "0/2 trang giữ nguyên" — con số ấy nói về BÀI ĐO, không nói gì
  //     về tính năng. (Trình soạn thật không dính: `save()` refresh `q` từ phản hồi của máy chủ.)
  {
    const p0 = await nap();
    for (const sh of p0.sheets) sh.extraTables = [];
    p0.baseUpdatedAt = p0.updatedAt;
    const r0 = await agent.put(`/api/quotes/${bg.id}`).set("Origin", GOC).set("x-csrf-token", maCsrf).send(p0);
    if (r0.status !== 200) throw new Error(`PUT mồi → ${r0.status}: ${JSON.stringify(r0.body).slice(0, 200)}`);
  }

  const q = await nap();
  const than = (lan) => {
    // ĐÚNG thứ trình soạn gửi lên: CẢ báo giá, mọi sheet, mọi dòng — chỉ khác MỘT ô.
    const p = JSON.parse(JSON.stringify(q));
    p.baseUpdatedAt = p.updatedAt;
    // `presentQuote` trả bảng nội bộ theo hình dạng ĐỌC (gom theo nhóm), còn schema GHI đòi mảng
    // phẳng có `category`. Báo giá bench không có bảng nội bộ nào, nên mảng rỗng là ĐÚNG dữ liệu —
    // không phải mẹo cho qua validator.
    for (const sh of p.sheets) sh.extraTables = [];
    p.sheets[0].items[0].unitPrice = 111000 + lan;
    return p;
  };

  const byte = Buffer.byteLength(JSON.stringify(than(0)));

  const doDay = [];
  for (let k = 0; k < LAP; k++) {
    // NẠP LẠI mỗi vòng, không dùng lại ảnh chụp cũ: lần lưu trước vừa đổi `updatedAt` (khoá lạc
    // quan) VÀ đổi `sheet.id` của những trang bị tạo lại. Trình soạn thật cũng làm đúng vậy.
    const tuoi = await nap();
    const p = JSON.parse(JSON.stringify(tuoi));
    for (const sh of p.sheets) sh.extraTables = [];
    p.baseUpdatedAt = tuoi.updatedAt;
    p.sheets[0].items[0].unitPrice = 111000 + k;
    const t0 = performance.now();
    const r = await agent.put(`/api/quotes/${bg.id}`).set("Origin", GOC).set("x-csrf-token", maCsrf).send(p);
    const t1 = performance.now();
    if (r.status !== 200) throw new Error(`PUT → ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`);
    doDay.push(t1 - t0);
  }

  // ── CỜ CÓ THẬT SỰ BỎ QUA TRANG NÀO KHÔNG ─────────────────────────────────
  // Con số thời gian một mình KHÔNG nói được điều này: nếu phép so trượt (một trường lệch là cả
  // trang bị coi là đổi) thì đường mới chạy y hệt đường cũ và ta chỉ thấy "không nhanh hơn" mà
  // không biết vì sao. Đếm số trang GIỮ ĐƯỢC id là bằng chứng trực tiếp.
  const idTruoc = (await prisma.quoteSheet.findMany({ where: { quoteId: bg.id }, orderBy: { order: "asc" }, select: { id: true } })).map((x) => x.id);
  {
    const tuoi = await nap();
    const p1 = JSON.parse(JSON.stringify(tuoi));
    for (const sh of p1.sheets) sh.extraTables = [];
    p1.baseUpdatedAt = tuoi.updatedAt;
    p1.sheets[0].items[0].unitPrice = 111099;
    const r1 = await agent.put(`/api/quotes/${bg.id}`).set("Origin", GOC).set("x-csrf-token", maCsrf).send(p1);
    if (r1.status !== 200) throw new Error(`PUT đếm-trang-giữ → ${r1.status}`);
  }
  const idSau = (await prisma.quoteSheet.findMany({ where: { quoteId: bg.id }, orderBy: { order: "asc" }, select: { id: true } })).map((x) => x.id);
  const giuNguyen = idSau.filter((x) => idTruoc.includes(x)).length;

  // ── SÀN CỦA ĐƯỜNG INCREMENTAL ────────────────────────────────────────────
  // KHÔNG phải bản cài đặt thật — là GIỚI HẠN DƯỚI của nó: một UPDATE đúng ô đã đổi, trong
  // transaction, cộng cập nhật tổng tiền trên Quote. Đường thật sẽ CHẬM HƠN con số này (còn phải
  // so khớp dòng, tính sheet nào bẩn, giữ trạng thái mức sheet). Nếu ngay cả cái sàn cũng không
  // hơn được bao nhiêu thì không cần viết bản thật mới biết.
  const dong1 = await prisma.quoteItem.findFirst({ where: { sheet: { quoteId: bg.id } }, orderBy: { order: "asc" }, select: { id: true } });
  const doSan = [];
  for (let k = 0; k < LAP; k++) {
    const t0 = performance.now();
    await prisma.$transaction(async (tx) => {
      await tx.quoteItem.update({ where: { id: dong1.id }, data: { unitPrice: 222000 + k } });
      await tx.quote.update({ where: { id: bg.id }, data: { subtotal: 1, vat: 0, discount: 0, total: 1 } });
    });
    doSan.push(performance.now() - t0);
  }

  // ── PHÂN RÃ: 4,3 GIÂY ẤY NẰM Ở ĐÂU ───────────────────────────────────────
  // Câu hỏi quyết định của §16 KHÔNG phải "lưu có chậm không" mà là "phần chậm có nằm ở chỗ mà
  // incremental chạm tới không". Nếu phần lớn thời gian nằm ở phân giải JSON + zod duyệt từng dòng
  // + tính tiền bằng Decimal — tức những việc chạy trên TOÀN BỘ thân request trước khi tới CSDL —
  // thì ghi tăng dần cỡ nào cũng không cứu được, và §16 tự trả lời là "đừng làm".
  const thanJson = JSON.stringify(than(0));
  const dJson = [], dZod = [], dTien = [];
  for (let k = 0; k < LAP; k++) {
    let t = performance.now();
    const doiTuong = JSON.parse(thanJson);
    dJson.push(performance.now() - t);

    t = performance.now();
    const kq = QuoteUpdateSchema.safeParse(doiTuong);
    dZod.push(performance.now() - t);
    if (!kq.success) throw new Error("zod từ chối thân bench — bài đo đang dựng dữ liệu sai hình dạng");

    t = performance.now();
    computeQuoteTotals({ vatPercent: kq.data.vatPercent ?? 0, discount: kq.data.discount ?? 0, sheets: kq.data.sheets });
    dTien.push(performance.now() - t);
  }

  // ── PHẦN KHÔNG BIẾN MẤT DÙ CÓ INCREMENTAL ────────────────────────────────
  // `snapshotQuoteVersion` chụp TOÀN BỘ báo giá vào QuoteVersion sau MỖI lần lưu — đọc lại mọi
  // sheet/mọi dòng rồi ghi một payload JSON. Việc đó không nhỏ đi khi ta chỉ ghi một ô, nên nó là
  // SÀN THẬT của bất kỳ đường lưu nào còn giữ lịch sử phiên bản. Đo riêng ra, nếu không thì con số
  // "tiết kiệm được" ở trên là nói quá.
  // ── GIÁ CỦA VIỆC "SO XEM CÓ ĐỔI KHÔNG" ───────────────────────────────────
  // Đường ghi tăng dần AN TOÀN phải so từng sheet trên ĐÚNG tập trường mà lệnh ghi sẽ đặt (nếu so
  // thiếu một trường, "giống nhau" thành mất dữ liệu âm thầm — hạng rủi ro số 1 theo §54). Nghĩa là
  // phải ĐỌC lại mọi dòng, mọi cột, kể cả `images`. Nếu lần đọc đó tự nó đã đắt bằng lần ghi thì
  // toàn bộ ý tưởng sụp, nên đo luôn ở đây thay vì tin vào cảm giác.
  const dDoc = [];
  for (let k = 0; k < LAP; k++) {
    const t = performance.now();
    await prisma.quoteSheet.findMany({
      where: { quoteId: bg.id },
      orderBy: { order: "asc" },
      include: { items: { orderBy: { order: "asc" } } },
    });
    dDoc.push(performance.now() - t);
  }

  const dChup = [];
  for (let k = 0; k < LAP; k++) {
    const t = performance.now();
    await prisma.$transaction(async (tx) => { await snapshotQuoteVersion(tx, bg.id, u.id, "bench"); }, { timeout: 60_000 });
    dChup.push(performance.now() - t);
  }
  await prisma.quoteVersion.deleteMany({ where: { quoteId: bg.id } }).catch(() => {});

  await prisma.quote.deleteMany({ where: { id: bg.id }, hardDelete: true, includeDeleted: true }).catch(() => {});
  return { n, byte, doDay, doSan, dJson, dZod, dTien, dChup, dDoc, giuNguyen, soTrang };
}

const GOC = process.env.APP_BASE_URL || "http://localhost:3000";
const MAX_TRANG = 60;   // src/validators.ts MAX_SAVE_SHEETS

async function main() {
  const CO_INC = /^(1|true|yes|on)$/i.test(process.env.INCREMENTAL_QUOTE_SAVE || "");
  console.log(`\n\x1b[1mĐO LƯU BÁO GIÁ\x1b[0m — ${LAP} lần mỗi kích cỡ · ${CO.join(", ")} dòng`);
  console.log(`INCREMENTAL_QUOTE_SAVE = ${CO_INC ? "BẬT (đường mới)" : "TẮT (đường mặc định)"}\n`);
  await dungMoiTruong();
  const app = createApp();
  const agent = request.agent(app);
  const dn = await agent.post("/api/auth/login").send({ username: u.username, password: PWD });
  if (dn.status !== 200) throw new Error(`đăng nhập thất bại: ${dn.status}`);
  const maCsrf = (await agent.get("/api/csrf-token")).body.token;

  const bang = [];
  for (const n of CO) {
    process.stdout.write(`  đang đo ${n} dòng…`);
    bang.push(await doMotKichCo(app, agent, maCsrf, n));
    process.stdout.write(" xong\n");
  }

  console.log("\n| dòng | trang | thân JSON | LƯU (trung vị) | (p95) | trang GIỮ NGUYÊN | SÀN incremental | chênh |");
  console.log("|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const r of bang) {
    const tv = trungVi(r.doDay), s = trungVi(r.doSan);
    console.log(`| ${r.n} | ${r.soTrang} | ${(r.byte / 1024).toFixed(0)} KB | ${ms(tv)} | ${ms(p95(r.doDay))} | ${r.giuNguyen}/${r.soTrang} | ${ms(s)} | ${(tv / s).toFixed(1)}× |`);
  }
  console.log("\nGhi chú: cột SÀN là GIỚI HẠN DƯỚI của đường incremental (một UPDATE + một cập nhật");
  console.log("tổng, trong transaction), KHÔNG phải bản cài đặt thật — bản thật luôn chậm hơn.\n");

  console.log("PHÂN RÃ MỘT LẦN LƯU — phần nào incremental KHÔNG chạm tới được:");
  console.log("| dòng | JSON.parse | zod | tính tiền | ba phần trên | tổng LƯU | phần CSDL (còn lại) |");
  console.log("|---:|---:|---:|---:|---:|---:|---:|");
  for (const r of bang) {
    const j = trungVi(r.dJson), z = trungVi(r.dZod), t = trungVi(r.dTien);
    const tv = trungVi(r.doDay), truoc = j + z + t;
    console.log(`| ${r.n} | ${ms(j)} | ${ms(z)} | ${ms(t)} | ${ms(truoc)} (${((truoc / tv) * 100).toFixed(0)}%) | ${ms(tv)} | ${ms(tv - truoc)} (${(((tv - truoc) / tv) * 100).toFixed(0)}%) |`);
  }

  console.log("\nCHỤP PHIÊN BẢN — chi phí KHÔNG nhỏ đi dù chỉ ghi một ô:");
  console.log("| dòng | snapshotQuoteVersion | tổng LƯU | tỉ lệ | sàn thực tế nếu ghi tăng dần |");
  console.log("|---:|---:|---:|---:|---:|");
  for (const r of bang) {
    const c = trungVi(r.dChup), tv = trungVi(r.doDay), j = trungVi(r.dJson), z = trungVi(r.dZod), t = trungVi(r.dTien);
    const san = c + j + z + t + trungVi(r.doSan);
    console.log(`| ${r.n} | ${ms(c)} | ${ms(tv)} | ${((c / tv) * 100).toFixed(0)}% | ~${ms(san)} (${(tv / san).toFixed(1)}× nhanh hơn) |`);
  }

  console.log("\nGIÁ CỦA LẦN ĐỌC ĐỂ SO SÁNH (đường ghi tăng dần an toàn bắt buộc phải trả):");
  console.log("| dòng | đọc lại mọi sheet+dòng | tổng LƯU | ước tính LƯU tăng dần (đọc + chụp + phần còn lại) |");
  console.log("|---:|---:|---:|---:|");
  for (const r of bang) {
    const d = trungVi(r.dDoc), c = trungVi(r.dChup), tv = trungVi(r.doDay);
    const j = trungVi(r.dJson), z = trungVi(r.dZod), t = trungVi(r.dTien), sa = trungVi(r.doSan);
    const uoc = d + c + j + z + t + sa;
    console.log(`| ${r.n} | ${ms(d)} | ${ms(tv)} | ~${ms(uoc)} (${(tv / uoc).toFixed(1)}× nhanh hơn) |`);
  }
  console.log("");
}

main().then(() => donDep(), async (e) => { console.error("\n❌", e); await donDep(); process.exit(1); });
