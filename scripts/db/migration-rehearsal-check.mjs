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

// ── HAI MIGRATION ĐỤNG DỮ LIỆU CỦA BẢN PHÁT HÀNH 2026-09-15 ────────────────────────────────
// Đây mới là phần trả lời được câu hỏi người ta thật sự sợ: "dữ liệu có chuyển đúng không?".
// DDL chạy được chỉ là điều kiện cần.

// (a) Bảng Hà Nội: QuoteSheet.extraTables[category='hanoi'] → Quote.hnTables
const hn = await c.query(
  `SELECT jsonb_array_length(q."hnTables"::jsonb) AS so_bang,
          (SELECT sum((it->>'quantity')::numeric * (it->>'unitPrice')::numeric * COALESCE((it->>'days')::numeric,1))
             FROM jsonb_array_elements(q."hnTables"::jsonb) t, jsonb_array_elements(t->'items') it) AS tien,
          (SELECT count(*) FROM jsonb_array_elements(q."hnTables"::jsonb) t WHERE t ? 'category') AS con_category
     FROM "Quote" q WHERE q."quoteNumber"='MIG-0001'`
);
say(hn.rows.length === 1, "báo giá schema cũ vẫn đọc được sau nâng cấp");
say(hn.rows[0]?.so_bang === 1, `đúng 1 bảng Hà Nội chuyển sang cột mới (thấy ${hn.rows[0]?.so_bang})`);
// 16.605.000 = 2×4.500.000 + 1×7.605.000. Số TIỀN là thứ phải khớp — không phải số hàng.
say(Number(hn.rows[0]?.tien) === 16605000, `tiền Hà Nội giữ nguyên từng đồng (thấy ${hn.rows[0]?.tien}, mong 16605000)`);
say(Number(hn.rows[0]?.con_category) === 0, "khoá `category` đã bị cắt ở cột mới (cột này chỉ chứa bảng HN)");

// Bảng KHÁC loại phải Ở NGUYÊN chỗ cũ — migration không được đụng vào hcm/khach.
const hcm = await c.query(
  `SELECT count(*)::int n FROM "QuoteSheet" s, jsonb_array_elements(COALESCE(s."extraTables"::jsonb,'[]'::jsonb)) t
    WHERE t->>'category'='hcm'`
);
say(hcm.rows[0].n === 1, `bảng Chi phí HCM không bị đụng tới (${hcm.rows[0].n})`);

// EXPAND-ONLY: bản cũ CÒN NGUYÊN để lùi ảnh một mình vẫn chạy được. Pha "contract" là bản sau.
const conCu = await c.query(
  `SELECT count(*)::int n FROM "QuoteSheet" s, jsonb_array_elements(COALESCE(s."extraTables"::jsonb,'[]'::jsonb)) t
    WHERE t->>'category'='hanoi'`
);
say(conCu.rows[0].n === 1, `EXPAND-ONLY: bản cũ còn nguyên trong trang để rollback ảnh (${conCu.rows[0].n})`);

// (b) Thành viên báo giá: _QuoteMembers (m2m ngầm) → QuoteMember có phạm vi
const qm = await c.query(
  `SELECT scopes, "addedById" FROM "QuoteMember" qm
     JOIN "Quote" q ON q.id = qm."quoteId" WHERE q."quoteNumber"='MIG-0001'`
);
say(qm.rows.length === 1, `thành viên cũ chuyển sang QuoteMember (${qm.rows.length})`);
// Bản cũ KHÔNG có phạm vi ⇒ toàn quyền. Cấp thiếu phạm vi là ÂM THẦM tước quyền người đang dùng.
say(
  JSON.stringify([...(qm.rows[0]?.scopes ?? [])].sort()) === JSON.stringify(["hanoi", "hcm", "khach", "main"]),
  `thành viên cũ được ĐỦ 4 phạm vi, không bị tước quyền âm thầm (${JSON.stringify(qm.rows[0]?.scopes)})`
);
say(qm.rows[0]?.addedById === null, "addedById = NULL: không bịa ra người phân công");

const bangCu = await c.query(`SELECT to_regclass('"_QuoteMembers"') AS t`);
say(bangCu.rows[0].t === null, "bảng ngầm _QuoteMembers đã được bỏ sau khi chép xong");

const m = await c.query(`SELECT count(*)::int n FROM _prisma_migrations WHERE finished_at IS NOT NULL`);
console.log(`   migration đã áp: ${m.rows[0].n}`);
const failed = await c.query(`SELECT count(*)::int n FROM _prisma_migrations WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL`);
say(failed.rows[0].n === 0, `không migration nào lỗi/rollback (${failed.rows[0].n})`);

await c.end();
process.exit(bad);
