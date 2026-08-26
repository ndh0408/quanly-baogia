#!/usr/bin/env node
// Backfill mã hoá PII — bước 5/6 của lộ trình (xem docs/archive/audits/SECURITY_AUDIT_2026-08.md).
//
//   node scripts/migration/pii-backfill.mjs --dry-run     # đếm, KHÔNG ghi gì
//   node scripts/migration/pii-backfill.mjs               # chạy thật
//   node scripts/migration/pii-backfill.mjs --verify      # giải mã lại toàn bộ và đối chiếu với cột thô
//
// ── BA NGUYÊN TẮC ────────────────────────────────────────────────────────────
// 1. KHÔNG BAO GIỜ IN GIÁ TRỊ PII. Script này chạy trong terminal, terminal vào lịch sử shell, lịch
//    sử shell vào bản sao lưu máy. Chỉ in ĐẾM và PASS/FAIL.
// 2. CHẠY LẠI ĐƯỢC (idempotent) + TIẾP TỤC ĐƯỢC. Lọc theo `piiVersion = 0` nên bản ghi đã xong
//    không bị mã hoá lần hai; đứt giữa chừng thì chạy lại là tiếp đúng chỗ dở.
// 3. KHÔNG XOÁ CỘT THÔ. Backfill chỉ ĐIỀN thêm cột bản mã. Việc bỏ cột thô là một migration riêng,
//    chạy sau khi đã xác minh và đã có bản sao lưu — không bao giờ gộp chung với bước điền.
//
// ── CHẶN CHẠY NHẦM PRODUCTION ────────────────────────────────────────────────
// Mặc định script TỪ CHỐI chạy khi NODE_ENV=production. Muốn chạy thật trên production phải đặt
// THÊM ALLOW_PII_BACKFILL_PROD=true — hai cờ, một chủ đích. Đây không phải thủ tục hành chính: lệnh
// này đọc và ghi lại toàn bộ hồ sơ nhân sự, chạy nhầm môi trường là sự cố thật.

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { encryptPii, blindIndex, decryptPii, isPiiEncrypted, isPiiEncryptionEnabled } from "../../src/piiBox.js";
import { PII_FIELDS } from "../../src/piiFields.js";

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const VERIFY = args.includes("--verify");
const BATCH = Number(args.find((a) => a.startsWith("--batch="))?.split("=")[1]) || 200;

if (process.env.NODE_ENV === "production" && process.env.ALLOW_PII_BACKFILL_PROD !== "true") {
  console.error("✖ NODE_ENV=production. Cần thêm ALLOW_PII_BACKFILL_PROD=true để chạy thật trên production.");
  console.error("  (Lệnh này đọc + ghi lại toàn bộ hồ sơ nhân sự — chạy nhầm môi trường là sự cố thật.)");
  process.exit(1);
}
if (!isPiiEncryptionEnabled()) {
  console.error("✖ Chưa đặt PII_ENC_KEY — không có gì để mã hoá bằng.");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const aadFor = (model, field) => `${model}:${field}`;
const modelClient = (m) => prisma[m.charAt(0).toLowerCase() + m.slice(1)];

/** Đọc-lại-và-đối-chiếu: bản mã giải ra có KHỚP cột thô không. Không in giá trị nào. */
async function verifyModel(model, fields) {
  const client = modelClient(model);
  const rows = await client.findMany({
    where: { piiVersion: { gt: 0 } },
    select: Object.fromEntries([["id", true], ...fields.flatMap((f) => [[f.plain, true], [f.enc, true]])]),
  });
  let checked = 0, mismatch = 0, undecryptable = 0;
  for (const r of rows) {
    for (const f of fields) {
      const enc = r[f.enc];
      if (!isPiiEncrypted(enc)) continue;
      checked++;
      const got = decryptPii(enc, aadFor(model, f.plain));
      if (got == null) { undecryptable++; continue; }
      const want = r[f.plain] == null ? null : String(r[f.plain]);
      // So SÁNH TRONG BỘ NHỚ, không in ra. Chỉ đếm.
      if (want != null && got !== want) mismatch++;
    }
  }
  return { rows: rows.length, checked, mismatch, undecryptable };
}

async function backfillModel(model, fields) {
  const client = modelClient(model);
  const total = await client.count();
  const done = await client.count({ where: { piiVersion: { gt: 0 } } });
  let pending = await client.count({ where: { piiVersion: 0 } });
  console.log(`\n── ${model}: ${total} bản ghi · đã mã hoá ${done} · còn ${pending}`);
  if (DRY) return { model, total, done, pending, written: 0 };

  let written = 0;
  for (;;) {
    const batch = await client.findMany({
      where: { piiVersion: 0 },
      select: Object.fromEntries([["id", true], ...fields.map((f) => [f.plain, true])]),
      orderBy: { id: "asc" },
      take: BATCH,
    });
    if (!batch.length) break;
    for (const row of batch) {
      const data = { piiVersion: 1 };
      for (const f of fields) {
        const raw = row[f.plain] == null || row[f.plain] === "" ? null : String(row[f.plain]);
        data[f.enc] = raw == null ? null : encryptPii(raw, aadFor(model, f.plain));
        if (f.idx) data[f.idx] = raw == null ? null : blindIndex(raw);
      }
      // Cột thô KHÔNG bị đụng tới — xem nguyên tắc 3 ở đầu file.
      await client.update({ where: { id: row.id }, data });
      written++;
    }
    process.stdout.write(`   … ${written}\r`);
  }
  pending = await client.count({ where: { piiVersion: 0 } });
  console.log(`   ghi ${written} bản ghi · còn lại ${pending}`);
  return { model, total, done: done + written, pending, written };
}

const mode = VERIFY ? "XÁC MINH" : DRY ? "CHẠY THỬ (không ghi)" : "CHẠY THẬT";
console.log(`▶ Backfill PII — ${mode} · NODE_ENV=${process.env.NODE_ENV || "development"} · lô ${BATCH}`);

let bad = false;
for (const [model, fields] of Object.entries(PII_FIELDS)) {
  if (VERIFY) {
    const v = await verifyModel(model, fields);
    const ok = v.mismatch === 0 && v.undecryptable === 0;
    if (!ok) bad = true;
    console.log(`   ${ok ? "✓" : "✖"} ${model}: ${v.rows} bản ghi · ${v.checked} trường đã kiểm · lệch ${v.mismatch} · không giải mã được ${v.undecryptable}`);
  } else {
    const r = await backfillModel(model, fields);
    if (!DRY && r.pending > 0) bad = true;
  }
}

if (VERIFY) console.log(bad ? "\n✖ XÁC MINH THẤT BẠI" : "\n✓ XÁC MINH ĐẠT — mọi bản mã giải ra khớp cột thô");
else if (!DRY) console.log(bad ? "\n✖ Còn bản ghi chưa mã hoá — chạy lại để tiếp tục" : "\n✓ Backfill xong");

await prisma.$disconnect();
await pool.end();
process.exit(bad ? 1 : 0);
