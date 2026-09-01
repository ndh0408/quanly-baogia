#!/usr/bin/env node
// Backfill mã hoá PII — bước 5/6 của lộ trình (xem docs/archive/audits/SECURITY_AUDIT_2026-08.md).
//
//   node scripts/migration/pii-backfill.mjs --dry-run     # đếm, KHÔNG ghi gì
//   node scripts/migration/pii-backfill.mjs               # chạy thật
//   node scripts/migration/pii-backfill.mjs --verify      # giải mã lại toàn bộ và đối chiếu với cột thô
//   PII_ENC_KEY_OLD=<khoá cũ> node scripts/migration/pii-backfill.mjs --rotate   # XOAY KHOÁ
//
// ── XOAY KHOÁ (--rotate) ─────────────────────────────────────────────────────
// Backfill và xoay khoá là HAI việc khác nhau, cố ý tách:
//   • backfill mã hoá TỪ CỘT THÔ cho hàng `piiVersion = 0` — chạy một lần lúc bật mã hoá;
//   • xoay khoá GIẢI MÃ bản mã cũ rồi mã hoá lại bằng khoá mới, KHÔNG đọc cột thô, và chỉ đụng hàng
//     `piiVersion > 0`. Không đọc cột thô là điều kiện bắt buộc để quy trình này còn dùng được sau
//     khi cột thô bị bỏ.
// Cần ĐỒNG THỜI `PII_ENC_KEY` (khoá mới) và `PII_ENC_KEY_OLD` (khoá cũ) — src/piiBox.ts đọc được cả
// hai trong cửa sổ xoay. Xong thì gỡ `PII_ENC_KEY_OLD` rồi chạy `--verify` để chứng minh mọi hàng
// đã đọc được bằng MỘT MÌNH khoá mới; còn hàng nào sót là verify báo đỏ ngay.
//
// Chạy lại được: hàng đã xoay giải mã bằng khoá MỚI vẫn thành công nên chỉ bị mã hoá lại lần nữa
// (vô hại). CỐ Ý không dùng `piiVersion` làm cột đánh dấu đã-xoay — ứng dụng ghi `piiVersion = 1`
// cho mọi bản ghi mới, mượn nó làm số thế hệ khoá là hai nghĩa chồng lên một cột.
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
import { encryptPii, blindIndex, decryptPii, moTheoKhoa, dangXoayKhoa, isPiiEncrypted, isPiiEncryptionEnabled } from "../../src/piiBox.js";
import { PII_FIELDS } from "../../src/piiFields.js";

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const VERIFY = args.includes("--verify");
const ROTATE = args.includes("--rotate");
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
// Xoay khoá mà thiếu khoá cũ thì mọi bản mã cũ sẽ giải ra null → script sẽ đếm là hỏng hàng loạt.
// Chặn ngay từ đầu rõ ràng hơn nhiều so với để nó chạy 10 phút rồi báo "0 xoay được".
if (ROTATE && !(process.env.PII_ENC_KEY_OLD || "")) {
  console.error("✖ --rotate cần PII_ENC_KEY_OLD (khoá CŨ) bên cạnh PII_ENC_KEY (khoá MỚI).");
  console.error("  Xem docs/operations/DISASTER_RECOVERY.md § Sao lưu khoá mã hoá.");
  process.exit(1);
}
if (ROTATE && process.env.PII_ENC_KEY_OLD === process.env.PII_ENC_KEY) {
  console.error("✖ PII_ENC_KEY_OLD trùng PII_ENC_KEY — không có gì để xoay.");
  process.exit(1);
}
// `--verify` là bước CHỨNG MINH "khoá mới TỰ ĐỨNG ĐƯỢC", và runbook dùng đúng dấu ✓ của nó làm
// điều kiện để HUỶ khoá cũ khỏi kho bí mật. Chạy nó khi PII_ENC_KEY_OLD vẫn còn trong môi trường
// là tự phá bước chứng minh: `decryptPii` sẽ lặng lẽ rơi về khoá cũ.
//
// Đây KHÔNG phải tình huống hiếm — nó gần như chắc chắn xảy ra: bước ngay trước đó (`--rotate`)
// BẮT BUỘC phải có PII_ENC_KEY_OLD, nên người vận hành chạy `--verify` từ cùng shell / cùng file
// .env là chuyện tự nhiên nhất. Rồi họ huỷ khoá cũ, và những hàng chưa xoay không bao giờ giải
// lại được. Chặn ở đây, đừng chỉ đếm.
//
// (verifyModel BÊN TRONG cũng đã đếm riêng `conKhoaCu` và coi đó là ✖ — hai lớp, cố ý.)
if (VERIFY && (process.env.PII_ENC_KEY_OLD || "")) {
  console.error("✖ --verify là bước CHỨNG MINH khoá MỚI tự đứng được, nên KHÔNG được chạy khi");
  console.error("  PII_ENC_KEY_OLD vẫn còn trong môi trường — bản mã cũ sẽ vẫn giải ra được và");
  console.error("  bước kiểm sẽ báo ĐẠT một cách sai sự thật.");
  console.error("  Gỡ PII_ENC_KEY_OLD khỏi môi trường rồi chạy lại. Nếu lúc đó có hàng KHÔNG giải");
  console.error("  được, ĐẶT LẠI PII_ENC_KEY_OLD và chạy --rotate tiếp — ĐỪNG huỷ khoá cũ.");
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
  let checked = 0, mismatch = 0, undecryptable = 0, conKhoaCu = 0;
  for (const r of rows) {
    for (const f of fields) {
      const enc = r[f.enc];
      if (!isPiiEncrypted(enc)) continue;
      checked++;
      // KHÔNG dùng decryptPii: nó CỐ Ý rơi về PII_ENC_KEY_OLD, nên bước "chứng minh đã xoay xong"
      // sẽ báo ✓ kể cả khi chưa hàng nào được mã lại. Runbook dùng đúng dấu ✓ đó làm điều kiện để
      // GỠ khoá cũ — gỡ sớm là mọi hàng còn lại hoá đá vĩnh viễn. Phải hỏi "mở được bằng khoá MỚI
      // chưa", không phải "có mở được không".
      const { giaTri: got, khoa } = moTheoKhoa(String(enc), aadFor(model, f.plain));
      if (got == null) { undecryptable++; continue; }
      if (khoa === "cu") conKhoaCu++;
      const want = r[f.plain] == null ? null : String(r[f.plain]);
      // So SÁNH TRONG BỘ NHỚ, không in ra. Chỉ đếm.
      if (want != null && got !== want) mismatch++;
    }
  }
  return { rows: rows.length, checked, mismatch, undecryptable, conKhoaCu };
}

/**
 * XOAY KHOÁ: giải mã bằng bộ khoá hiện có (piiBox tự thử khoá mới rồi khoá cũ) và mã hoá lại bằng
 * khoá MỚI, tính lại chỉ mục mù. Không đọc và không ghi cột thô.
 */
async function rotateModel(model, fields) {
  const client = modelClient(model);
  const total = await client.count({ where: { piiVersion: { gt: 0 } } });
  console.log(`\n── ${model}: ${total} bản ghi đã mã hoá — cần mã hoá lại bằng khoá mới`);
  if (DRY) return { model, total, rotated: 0, failed: 0 };

  const select = Object.fromEntries([["id", true], ...fields.map((f) => [f.enc, true])]);
  let rotated = 0, failed = 0, cursor = 0, boQuaVìDaDoi = 0;
  for (;;) {
    // Phân trang bằng CON TRỎ id chứ không bằng skip: hàng đã xoay vẫn khớp `piiVersion > 0` nên
    // `skip` sẽ đứng yên tại chỗ và lặp vô tận.
    const batch = await client.findMany({
      where: { piiVersion: { gt: 0 }, id: { gt: cursor } },
      select,
      orderBy: { id: "asc" },
      take: BATCH,
    });
    if (!batch.length) break;
    for (const row of batch) {
      cursor = row.id;
      const data = {};
      let hong = false;
      for (const f of fields) {
        const enc = row[f.enc];
        if (!isPiiEncrypted(enc)) continue;      // cột rỗng → không có gì để xoay
        const plain = decryptPii(enc, aadFor(model, f.plain));
        if (plain == null) { hong = true; break; }
        data[f.enc] = encryptPii(plain, aadFor(model, f.plain));
        if (f.idx) data[f.idx] = blindIndex(plain);
      }
      // FAIL-CLOSED: một trường không giải được thì BỎ QUA CẢ HÀNG. Ghi phần đã xoay được sẽ để lại
      // bản ghi nửa khoá cũ nửa khoá mới — không cách nào sửa sau khi khoá cũ bị gỡ.
      if (hong) { failed++; continue; }
      if (!Object.keys(data).length) continue;

      // GHI CÓ ĐIỀU KIỆN (compare-and-set), KHÔNG ghi mù.
      //
      // Giữa lúc đọc lô và lúc ghi lại, ứng dụng VẪN ĐANG PHỤC VỤ — runbook nói rõ vậy. Nếu ai đó
      // sửa hồ sơ trong khoảng đó, `update({ where: { id } })` sẽ ghi đè bản mã MỚI của họ bằng
      // giá trị CŨ vừa mã lại. Và vì `decodePiiOnRead` ƯU TIÊN cột *Enc hơn cột thô, API sẽ trả
      // GIÁ TRỊ CŨ mãi mãi sau đó.
      //
      // Tình huống đã được dựng ra cụ thể: 10:00:03 rotate đọc hồ sơ #123 (bankAccountEnc = STK cũ);
      // 10:00:05 kế toán đổi số tài khoản qua PUT /api/personnel/123; 10:00:07 rotate ghi đè bằng
      // STK CŨ. Từ đó màn hình hiện STK cũ trong khi cột thô giữ STK mới → chuyển lương sai tài
      // khoản. Với `salary` còn lộ rõ hơn: tổng ở summary tính trên cột THÔ (mới) còn từng dòng
      // hiển thị từ *Enc (cũ) → tổng không bằng tổng các dòng trên cùng một màn hình.
      //
      // `updateMany` kèm bản mã CŨ trong WHERE biến việc ghi thành nguyên tử: hàng đã đổi thì
      // `count === 0` và ta bỏ qua — hàng đó đã mang khoá MỚI rồi (encodePiiForWrite luôn dùng
      // khoá hiện tại), nên bỏ qua là ĐÚNG, không phải lỗi.
      const dieuKien = { id: row.id };
      for (const f of fields) if (isPiiEncrypted(row[f.enc])) dieuKien[f.enc] = row[f.enc];
      const kq = await client.updateMany({ where: dieuKien, data });
      if (kq.count === 0) { boQuaVìDaDoi++; continue; }
      rotated++;
    }
    process.stdout.write(`   … ${rotated}\r`);
  }
  const ghiChu = boQuaVìDaDoi ? ` · ${boQuaVìDaDoi} bị ứng dụng ghi đè giữa chừng (đã mang khoá mới, bỏ qua đúng)` : "";
  console.log(`   xoay ${rotated} bản ghi · KHÔNG giải mã được ${failed}${ghiChu}`);
  return { model, total, rotated, failed, boQuaVìDaDoi };
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

const mode = VERIFY ? "XÁC MINH" : ROTATE ? "XOAY KHOÁ" : DRY ? "CHẠY THỬ (không ghi)" : "CHẠY THẬT";
const modeDry = DRY && !VERIFY ? " (chạy thử, không ghi)" : "";
console.log(`▶ Backfill PII — ${mode}${modeDry} · NODE_ENV=${process.env.NODE_ENV || "development"} · lô ${BATCH}`);

let bad = false;
for (const [model, fields] of Object.entries(PII_FIELDS)) {
  if (ROTATE && !VERIFY) {
    const r = await rotateModel(model, fields);
    if (r.failed > 0) bad = true;
  } else if (VERIFY) {
    const v = await verifyModel(model, fields);
    // `conKhoaCu > 0` là ✖ CHỨ KHÔNG PHẢI ✓: đây chính là bước mà runbook dùng để quyết định có
    // được gỡ PII_ENC_KEY_OLD hay không. Đọc được nhờ khoá CŨ nghĩa là chưa xoay xong; báo đạt ở
    // đây là mời người vận hành gỡ khoá cũ và làm hoá đá vĩnh viễn phần còn lại.
    const ok = v.mismatch === 0 && v.undecryptable === 0 && v.conKhoaCu === 0;
    if (!ok) bad = true;
    const cu = v.conKhoaCu > 0 ? ` · CÒN Ở KHOÁ CŨ ${v.conKhoaCu}` : "";
    console.log(`   ${ok ? "✓" : "✖"} ${model}: ${v.rows} bản ghi · ${v.checked} trường đã kiểm · lệch ${v.mismatch} · không giải mã được ${v.undecryptable}${cu}`);
  } else {
    const r = await backfillModel(model, fields);
    if (!DRY && r.pending > 0) bad = true;
  }
}

if (VERIFY) {
  console.log(bad
    ? "\n✖ XÁC MINH THẤT BẠI" + (dangXoayKhoa() ? " — nếu vì 'CÒN Ở KHOÁ CŨ' thì chạy --rotate rồi kiểm lại; ĐỪNG gỡ PII_ENC_KEY_OLD." : "")
    : "\n✓ XÁC MINH ĐẠT — mọi bản mã mở được BẰNG KHOÁ HIỆN TẠI và khớp cột thô");
}
else if (ROTATE && !DRY) {
  console.log(bad
    ? "\n✖ XOAY KHOÁ CHƯA XONG — còn bản ghi không giải mã được bằng cả hai khoá. ĐỪNG gỡ PII_ENC_KEY_OLD."
    : "\n✓ Xoay khoá xong. Bước cuối: gỡ PII_ENC_KEY_OLD rồi chạy --verify để chứng minh khoá mới tự đứng được.");
} else if (!DRY) console.log(bad ? "\n✖ Còn bản ghi chưa mã hoá — chạy lại để tiếp tục" : "\n✓ Backfill xong");

await prisma.$disconnect();
await pool.end();
process.exit(bad ? 1 : 0);
