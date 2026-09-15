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
// ── DỮ LIỆU CHO HAI MIGRATION CỦA BẢN PHÁT HÀNH 2026-09-15 ──────────────────────────────────
// Tới 2026-09-16 file này CHỈ nạp User + PersonnelRecord. Nghĩa là buổi diễn tập — thứ mà
// docs/operations/DEPLOYMENT.md chỉ định là guard BẮT BUỘC cho "migration đụng dữ liệu" — chạy
// trên một CSDL KHÔNG CÓ báo giá nào, rồi báo ĐẠT. Nó chứng minh được đúng một điều: lệnh DDL
// chạy không lỗi. Nó KHÔNG chứng minh dữ liệu chuyển sang chỗ mới đúng và đủ, mà đó mới là thứ
// người ta sợ. Hai migration cần dữ liệu thật:
//   · 20260915090000_quote_member_scopes  — chép `_QuoteMembers` (m2m ngầm) sang bảng QuoteMember
//   · 20260915140000_hn_tables_quote_level — chép bảng category='hanoi' từ QuoteSheet.extraTables
//                                            sang cột mới Quote.hnTables
const TIEN_HN = 2 * 4_500_000 + 1 * 7_605_000;   // 16.605.000 — check đối chiếu ĐÚNG con số này

await c.query(
  `INSERT INTO "Company" (code,name,address,"updatedAt") VALUES ('mig_co','Cty diễn tập','1 Đường Diễn Tập',now())
   ON CONFLICT (code) DO NOTHING`
);
await c.query(
  `INSERT INTO "QuoteTemplate" (code,name,"companyId","filePath","updatedAt")
   SELECT 'mig_tpl','Mẫu diễn tập',id,'templates/mig.xlsx',now() FROM "Company" WHERE code='mig_co'
   ON CONFLICT (code) DO NOTHING`
);
await c.query(
  `INSERT INTO "Quote" ("quoteNumber",title,"toCompany","companyId","fromContact","fromAddress",city,"quoteDate","createdById","updatedAt")
   SELECT 'MIG-0001','Báo giá schema cũ','Khách diễn tập',co.id,'B','2 Đường Y','TP. Hồ Chí Minh',now(),u.id,now()
   FROM "Company" co, "User" u WHERE co.code='mig_co' AND u.username='mig-u1'
   ON CONFLICT ("quoteNumber") DO NOTHING`
);
// Bảng Hà Nội nằm TRONG trang — đúng chỗ production đang giữ nó trước bản phát hành này.
await c.query(
  `INSERT INTO "QuoteSheet" ("quoteId","templateId","order","extraTables")
   SELECT q.id,t.id,0,$1::jsonb FROM "Quote" q, "QuoteTemplate" t
   WHERE q."quoteNumber"='MIG-0001' AND t.code='mig_tpl'
     AND NOT EXISTS (SELECT 1 FROM "QuoteSheet" s WHERE s."quoteId"=q.id)`,
  [JSON.stringify([
    { category: "hcm", name: "Chi phí HCM", items: [{ rid: "mig_hcm_0", kind: "item", name: "Vận chuyển", quantity: 1, unitPrice: 3_000_000, days: 1 }] },
    { category: "hanoi", name: "Giá thuê Hà Nội", items: [
      { rid: "mig_hn_0", kind: "item", name: "Vách 3x6", quantity: 2, unitPrice: 4_500_000, days: 1 },
      { rid: "mig_hn_1", kind: "item", name: "Sàn gỗ", quantity: 1, unitPrice: 7_605_000, days: 1 },
    ] },
  ])]
);
// Thành viên báo giá ở dạng m2m NGẦM của Prisma — bảng này bị migration XOÁ sau khi chép.
await c.query(
  `INSERT INTO "_QuoteMembers" ("A","B")
   SELECT q.id,u.id FROM "Quote" q, "User" u WHERE q."quoteNumber"='MIG-0001' AND u.username='mig-u1'
   ON CONFLICT DO NOTHING`
);

const u = await c.query(`SELECT count(*)::int n FROM "User"`);
const p = await c.query(`SELECT count(*)::int n FROM "PersonnelRecord"`);
const q = await c.query(`SELECT count(*)::int n FROM "Quote"`);
const m = await c.query(`SELECT count(*)::int n FROM "_QuoteMembers"`);
console.log(`   nạp xong: User=${u.rows[0].n} · PersonnelRecord=${p.rows[0].n} · Quote=${q.rows[0].n} · _QuoteMembers=${m.rows[0].n} · tiền HN=${TIEN_HN}`);
await c.end();
