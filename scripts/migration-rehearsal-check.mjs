// Kiểm SAU khi nâng cấp: dữ liệu cũ còn đọc được, và schema mới đã có mặt.
import pg from "pg";
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
let bad = 0;
const say = (ok, msg) => { console.log(`   ${ok ? "✓" : "✖"} ${msg}`); if (!ok) bad = 1; };

const u = await c.query(`SELECT username,"passwordChangedAt" FROM "User" WHERE username='mig-u1'`);
say(u.rows.length === 1, `hàng User cũ vẫn đọc được (${u.rows.length})`);
// Cột mới phải là NULL cho hàng cũ — đặt now() cho tất cả sẽ đá mọi người đang đăng nhập ra.
say(u.rows[0]?.passwordChangedAt === null, "passwordChangedAt của hàng cũ = NULL (không đá ai ra lúc deploy)");

const p = await c.query(`SELECT "fullName","idCard","bankAccount",salary,"piiVersion","idCardEnc","paymentProofKey" FROM "PersonnelRecord" WHERE "fullName"='Hồ sơ schema cũ'`);
say(p.rows.length === 1, "hàng PersonnelRecord cũ vẫn đọc được");
say(p.rows[0]?.idCard === "079301009999", "PII cột THÔ giữ nguyên giá trị (chưa backfill)");
say(p.rows[0]?.piiVersion === 0, "piiVersion mặc định 0 cho hàng cũ");
say(p.rows[0]?.idCardEnc === null && p.rows[0]?.paymentProofKey === null, "cột mới NULL, không bịa dữ liệu");

const t = await c.query(`SELECT table_name FROM information_schema.tables WHERE table_name='UploadObject'`);
say(t.rows.length === 1, "bảng mới UploadObject đã tạo");

const cols = await c.query(
  `SELECT column_name FROM information_schema.columns
   WHERE table_name='PersonnelRecord'
     AND column_name IN ('idCardEnc','idCardIdx','bankAccountEnc','salaryEnc','piiVersion','paymentProofKey','paymentProofSha256')`
);
say(cols.rows.length === 7, `đủ 7 cột mới ở PersonnelRecord (thấy ${cols.rows.length})`);

const m = await c.query(`SELECT count(*)::int n FROM _prisma_migrations WHERE finished_at IS NOT NULL`);
console.log(`   migration đã áp: ${m.rows[0].n}`);
const failed = await c.query(`SELECT count(*)::int n FROM _prisma_migrations WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL`);
say(failed.rows[0].n === 0, `không migration nào lỗi/rollback (${failed.rows[0].n})`);

await c.end();
process.exit(bad);
