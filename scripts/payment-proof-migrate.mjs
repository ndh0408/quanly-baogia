#!/usr/bin/env node
// Chuyển ảnh chứng từ thanh toán: base64-trong-CSDL → kho object riêng tư.
//
//   node scripts/payment-proof-migrate.mjs --dry-run   # đếm, KHÔNG ghi gì
//   node scripts/payment-proof-migrate.mjs             # chạy thật
//   node scripts/payment-proof-migrate.mjs --verify    # tải object về, so SHA-256 với base64 gốc
//
// ── NGUYÊN TẮC ───────────────────────────────────────────────────────────────
// 1. KHÔNG XOÁ CỘT BASE64. Script chỉ TẢI LÊN + ghi siêu dữ liệu. Cột cũ là đường lui: nếu kho object
//    hỏng hoặc chuyển sai, dữ liệu gốc vẫn còn nguyên. Bỏ cột là migration RIÊNG, sau khi verify.
// 2. XÁC MINH RỒI MỚI ĐÁNH DẤU. Tải lên → HEAD lại → so kích thước → mới ghi `paymentProofKey`.
//    Ghi khoá trước rồi mới phát hiện tải thiếu byte là tạo ra hàng trỏ-vào-hư-không.
// 3. CHẠY LẠI ĐƯỢC. Lọc `paymentProofKey IS NULL AND paymentProof IS NOT NULL` → hàng đã chuyển
//    không bị đụng lần hai; đứt giữa chừng thì chạy lại là tiếp đúng chỗ dở.
//
// Chặn chạy nhầm production: cần NODE_ENV != production, hoặc thêm ALLOW_PROOF_MIGRATE_PROD=true.

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { decodeDataUrl, sniffImage, sha256, storeProof, MAX_PROOF_BYTES } from "../src/paymentProof.js";
import { getObjectBytes, isStorageEnabled } from "../src/storage.js";

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const VERIFY = args.includes("--verify");
const BATCH = Number(args.find((a) => a.startsWith("--batch="))?.split("=")[1]) || 50;

if (process.env.NODE_ENV === "production" && process.env.ALLOW_PROOF_MIGRATE_PROD !== "true") {
  console.error("✖ NODE_ENV=production. Cần thêm ALLOW_PROOF_MIGRATE_PROD=true để chạy thật trên production.");
  process.exit(1);
}
if (!isStorageEnabled()) {
  console.error("✖ Chưa cấu hình S3_* — không có kho object để chuyển vào.");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const PENDING = { paymentProof: { not: null }, paymentProofKey: null };

async function counts() {
  const [total, legacy, migrated] = await Promise.all([
    prisma.personnelRecord.count({ where: { OR: [{ paymentProof: { not: null } }, { paymentProofKey: { not: null } }] } }),
    prisma.personnelRecord.count({ where: PENDING }),
    prisma.personnelRecord.count({ where: { paymentProofKey: { not: null } } }),
  ]);
  return { total, legacy, migrated };
}

async function migrate() {
  let moved = 0, failed = 0;
  for (;;) {
    const batch = await prisma.personnelRecord.findMany({
      where: PENDING, select: { id: true, paymentProof: true }, orderBy: { id: "asc" }, take: BATCH,
    });
    if (!batch.length) break;
    for (const row of batch) {
      try {
        // Kiểm nội dung TRƯỚC khi tải lên: dữ liệu cũ có thể chứa data-URL hỏng do client đời trước.
        const buf = decodeDataUrl(row.paymentProof);
        if (!buf) throw new Error("không phải data-URL ảnh hợp lệ");
        if (buf.length > MAX_PROOF_BYTES) throw new Error(`quá lớn (${buf.length} byte)`);
        if (!sniffImage(buf)) throw new Error("nội dung không phải ảnh PNG/JPG/WEBP");

        // storeProof đã tự HEAD lại và đối chiếu kích thước; ném nếu kho nhận thiếu.
        const meta = await storeProof(row.id, row.paymentProof);
        // Chỉ ghi siêu dữ liệu — cột base64 GIỮ NGUYÊN (nguyên tắc 1).
        await prisma.personnelRecord.update({ where: { id: row.id }, data: meta });
        moved++;
      } catch (e) {
        failed++;
        // KHÔNG in nội dung ảnh. Chỉ id + lý do.
        console.error(`   ✖ hồ sơ #${row.id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    process.stdout.write(`   … đã chuyển ${moved}\r`);
  }
  return { moved, failed };
}

/** Tải object về và so SHA-256 với base64 gốc — bằng chứng "chuyển đúng", không chỉ "chuyển xong". */
async function verify() {
  const rows = await prisma.personnelRecord.findMany({
    where: { paymentProofKey: { not: null } },
    select: { id: true, paymentProof: true, paymentProofKey: true, paymentProofSize: true, paymentProofSha256: true },
  });
  let ok = 0, hashMismatch = 0, sizeMismatch = 0, unreadable = 0, noLegacy = 0;
  for (const r of rows) {
    const buf = await getObjectBytes(r.paymentProofKey, MAX_PROOF_BYTES * 2);
    if (!buf) { unreadable++; continue; }
    if (buf.length !== r.paymentProofSize) { sizeMismatch++; continue; }
    if (sha256(buf) !== r.paymentProofSha256) { hashMismatch++; continue; }
    // Đối chiếu với bản gốc còn giữ lại (nếu còn) — đây mới là bằng chứng nội dung KHÔNG đổi.
    if (r.paymentProof) {
      const orig = decodeDataUrl(r.paymentProof);
      if (!orig || sha256(orig) !== r.paymentProofSha256) { hashMismatch++; continue; }
    } else noLegacy++;
    ok++;
  }
  return { rows: rows.length, ok, hashMismatch, sizeMismatch, unreadable, noLegacy };
}

const mode = VERIFY ? "XÁC MINH" : DRY ? "CHẠY THỬ (không ghi)" : "CHẠY THẬT";
console.log(`▶ Chuyển chứng từ thanh toán — ${mode} · NODE_ENV=${process.env.NODE_ENV || "development"}`);

const c = await counts();
console.log(`   hồ sơ có chứng từ: ${c.total} · còn base64: ${c.legacy} · đã ở kho object: ${c.migrated}`);

let bad = false;
if (VERIFY) {
  const v = await verify();
  bad = v.hashMismatch > 0 || v.sizeMismatch > 0 || v.unreadable > 0;
  console.log(`   ${bad ? "✖" : "✓"} kiểm ${v.rows} object · khớp ${v.ok} · lệch hash ${v.hashMismatch} · lệch kích thước ${v.sizeMismatch} · không đọc được ${v.unreadable}`);
  console.log(bad ? "\n✖ XÁC MINH THẤT BẠI — KHÔNG được bỏ cột base64" : "\n✓ XÁC MINH ĐẠT — nội dung trong kho khớp bản gốc từng byte");
} else if (!DRY) {
  const r = await migrate();
  const after = await counts();
  bad = r.failed > 0 || after.legacy > 0;
  console.log(`   chuyển ${r.moved} · lỗi ${r.failed} · còn base64 chưa chuyển: ${after.legacy}`);
  console.log(bad ? "\n✖ Chưa chuyển hết — xem lỗi ở trên rồi chạy lại" : "\n✓ Chuyển xong (cột base64 GIỮ NGUYÊN làm đường lui)");
}

await prisma.$disconnect();
await pool.end();
process.exit(bad ? 1 : 0);
