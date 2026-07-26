// seed-venues.js — NẠP danh mục kích thước theo rạp (Venue + VenueItem) từ
// prisma/venue-catalog.seed.json (bóc từ Google Sheet của công ty, đã đối chiếu).
//
//   node prisma/seed-venues.js          # nạp LẦN ĐẦU (dừng nếu danh mục đã có dữ liệu)
//   node prisma/seed-venues.js --force  # nạp bổ sung phần còn thiếu vào danh mục đang có
//   node prisma/seed-venues.js --reset  # XOÁ SẠCH danh mục rồi nạp lại từ đầu
//
// IDEMPOTENT: rạp khớp (name, region) thì dùng lại; hạng mục khớp (venue, category, name, dim)
// thì BỎ QUA — nên chạy lại nhiều lần KHÔNG nhân bản dữ liệu và KHÔNG đè sửa đổi của người dùng.
// CỐ Ý KHÔNG chạy tự động trong deploy: người dùng xoá bớt hạng mục thì deploy sau sẽ nạp lại
// (vì "thiếu" so với file gốc) — nạp là thao tác THỦ CÔNG, một lần cho mỗi môi trường.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const prisma = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })) });

const RESET = process.argv.includes("--reset");
const FORCE = process.argv.includes("--force");
const SRC = path.join(__dirname, "venue-catalog.seed.json");

async function main() {
  const raw = JSON.parse(readFileSync(SRC, "utf8"));
  const entries = raw.entries || [];
  if (!entries.length) throw new Error("File nguồn không có entries nào — dừng để khỏi xoá nhầm");

  if (RESET) {
    const n = await prisma.venue.deleteMany({});   // VenueItem xoá theo (cascade)
    console.log(`↺ --reset: đã xoá ${n.count} rạp (kèm toàn bộ hạng mục)`);
  } else if (!FORCE) {
    // Chốt an toàn: danh mục đã có dữ liệu = người dùng đang tự quản lý. Nạp đè sẽ làm SỐNG LẠI
    // những hạng mục họ đã cố ý xoá → bắt phải nói rõ ý định bằng --force / --reset.
    const existing = await prisma.venue.count();
    if (existing > 0) {
      console.log(`⏭  Danh mục đã có ${existing} rạp — bỏ qua (dùng --force để nạp bổ sung, --reset để nạp lại từ đầu)`);
      return;
    }
  }

  // Danh bạ rạp chuẩn trong sheet (cụm / viết tắt) → bổ nghĩa cho rạp cùng tên.
  const meta = new Map();
  for (const v of raw.venues || []) {
    if (v?.name) meta.set(v.name.trim().toLowerCase(), { cluster: v.cluster || null, code: v.code || null });
  }

  let newVenues = 0, newItems = 0, skipped = 0;
  const venueIds = new Map();   // "name||region" → id

  for (const e of entries) {
    const name = String(e.venue || "").trim();
    if (!name) { skipped++; continue; }
    const region = String(e.region || "").trim();
    const key = `${name}||${region}`;

    let venueId = venueIds.get(key);
    if (venueId === undefined) {
      const found = await prisma.venue.findFirst({ where: { name, region } });
      if (found) venueId = found.id;
      else {
        const m = meta.get(name.toLowerCase()) || {};
        const created = await prisma.venue.create({ data: { name, region, cluster: m.cluster, code: m.code } });
        venueId = created.id;
        newVenues++;
      }
      venueIds.set(key, venueId);
    }

    // Trùng (rạp + nhóm + tên + kích thước) → bỏ qua, không tạo bản sao.
    const dup = await prisma.venueItem.findFirst({
      where: { venueId, category: e.cat || "", name: String(e.name || "").trim(), dim: e.dim ?? null },
    });
    if (dup) { skipped++; continue; }

    const max = await prisma.venueItem.aggregate({ where: { venueId }, _max: { sortOrder: true } });
    await prisma.venueItem.create({
      data: {
        venueId,
        category: e.cat || "",
        name: String(e.name || "").trim(),
        dim: e.dim ?? null,
        widthM: e.w ?? null,
        heightM: e.h ?? null,
        unit: e.unit ?? null,
        quantity: e.qty ?? null,
        note: e.note ?? null,
        sortOrder: (max._max.sortOrder ?? 0) + 1,
      },
    });
    newItems++;
  }

  const [totalV, totalI] = await Promise.all([prisma.venue.count(), prisma.venueItem.count()]);
  console.log(`✅ Nạp xong: +${newVenues} rạp, +${newItems} hạng mục (bỏ qua ${skipped} dòng đã có/không hợp lệ)`);
  console.log(`   Danh mục hiện có: ${totalV} rạp · ${totalI} hạng mục`);
}

main()
  .catch((e) => { console.error("❌ Nạp danh mục rạp thất bại:", e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
