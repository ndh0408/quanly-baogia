// Nạp dữ liệu ở schema CŨ cho diễn tập migration. Dùng SQL thuần (không qua Prisma Client) vì client
// đã sinh theo schema MỚI — nó sẽ đòi những cột chưa tồn tại ở bước này.
import pg from "pg";
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
await c.query(
  `INSERT INTO "User" (username,"passwordHash","displayName",role,"updatedAt")
   VALUES ($1,$2,$3,'admin',now()) ON CONFLICT (username) DO NOTHING`,
  ["mig-u1", "hash-cu", "Người dùng schema cũ"]
);
await c.query(
  `INSERT INTO "PersonnelRecord" ("createdById","fullName","idCard","bankAccount",salary,"updatedAt")
   SELECT id,$1,$2,$3,$4,now() FROM "User" WHERE username='mig-u1'
   ON CONFLICT DO NOTHING`,
  ["Hồ sơ schema cũ", "079301009999", "1234567890", 12345678]
);
const u = await c.query(`SELECT count(*)::int n FROM "User"`);
const p = await c.query(`SELECT count(*)::int n FROM "PersonnelRecord"`);
console.log(`   nạp xong: User=${u.rows[0].n} · PersonnelRecord=${p.rows[0].n}`);
await c.end();
