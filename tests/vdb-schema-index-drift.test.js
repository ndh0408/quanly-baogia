// CỔNG CHỐNG TRÔI SCHEMA — chạy THẬT lệnh mà lỗi nằm ở đó.
//
// ── LỖI ─────────────────────────────────────────────────────────────────────
// Migration tạo index trong CSDL mà `prisma/schema.prisma` KHÔNG khai `@@index` tương ứng.
// Lần sau ai chạy `prisma migrate dev`, Prisma thấy CSDL "thừa" index so với schema và sinh ra
// migration `DROP INDEX`. Commit file đó = XOÁ index trên production.
//
// ── VÌ SAO BÀI NÀY ĐƯỢC VIẾT LẠI ────────────────────────────────────────────
// Bản trước chỉ `readFileSync` schema.prisma rồi regex tìm đúng 5 chuỗi mà người vá vừa gõ vào.
// Nó khẳng định lại code vừa viết chứ không đi qua lớp lỗi: ngày mai ai đó viết migration
// `CREATE INDEX "Quote_hnAssigneeId_idx"` mà quên khai `@@index` — ĐÚNG lớp lỗi này — bài cũ vẫn
// XANH. Nó khoá 5 ca đã biết, không khoá được LUẬT.
//
// Bài này khoá LUẬT bằng hai tầng:
//   A. Quét MỌI `CREATE INDEX` btree THƯỜNG trong prisma/migrations/**/migration.sql (loại trừ
//      GIN/GiST và partial `WHERE`, loại trừ index/bảng đã bị DROP về sau) và đòi mỗi cái có
//      `@@index`/`@@unique`/`@unique` khớp DANH SÁCH CỘT trong schema.prisma. Không cần CSDL.
//   B. Chạy THẬT `prisma migrate deploy` lên một CSDL nháp rỗng rồi `prisma migrate diff
//      --from-config-datasource --to-schema --exit-code`, và đòi tập object bị báo trôi BẰNG ĐÚNG
//      danh sách miễn trừ ghi trong prisma/migrations/README.md. Đây chính là lệnh sinh ra
//      `DROP INDEX`, nên bài này bắt được cả những dạng trôi mà tầng A không nhìn thấy.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { Client } from "pg";

const ROOT = new URL("../", import.meta.url).pathname;
const SCHEMA_PATH = join(ROOT, "prisma/schema.prisma");
const SCHEMA = readFileSync(SCHEMA_PATH, "utf8");
const MIG_DIR = join(ROOT, "prisma/migrations");

// ════════════════════════════════════════════════════════════════════════════
//  TẦNG A — luật "btree thường thì PHẢI khai @@index" (không cần CSDL)
// ════════════════════════════════════════════════════════════════════════════

/** Bỏ chú thích `-- …` trước khi quét: nhiều migration có `CREATE INDEX` nằm trong lời giải thích. */
const boChuThich = (sql) => sql.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");

/**
 * Đọc toàn bộ migration theo THỨ TỰ và dựng trạng thái CUỐI CÙNG của các index:
 * index bị DROP về sau, hoặc nằm trên bảng bị DROP về sau, không còn tồn tại trong CSDL.
 */
function quetIndexTuMigration() {
  const RE_CREATE = /CREATE\s+(UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?"?([A-Za-z0-9_]+)"?\s+ON\s+"?([A-Za-z0-9_]+)"?\s*(USING\s+[a-z]+\s*)?\(([\s\S]*?)\)\s*(WHERE[\s\S]*?)?;/gi;
  const RE_DROP_INDEX = /DROP\s+INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+EXISTS\s+)?"?([A-Za-z0-9_]+)"?/gi;
  const RE_DROP_TABLE = /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?"?([A-Za-z0-9_]+)"?/gi;
  const index = new Map();
  const indexDaXoa = new Set();
  const bangDaXoa = new Set();
  for (const d of readdirSync(MIG_DIR).filter((x) => !x.includes(".")).sort()) {
    let sql;
    try { sql = boChuThich(readFileSync(join(MIG_DIR, d, "migration.sql"), "utf8")); } catch { continue; }
    for (const m of sql.matchAll(RE_CREATE)) {
      const [, uniq, ten, bang, using, cols, where] = m;
      index.set(ten, { uniq: !!uniq, bang, using: (using || "").trim(), cols, where: (where || "").trim(), dir: d });
    }
    for (const m of sql.matchAll(RE_DROP_INDEX)) indexDaXoa.add(m[1]);
    for (const m of sql.matchAll(RE_DROP_TABLE)) bangDaXoa.add(m[1]);
  }
  return [...index].filter(([ten, v]) => !indexDaXoa.has(ten) && !bangDaXoa.has(v.bang));
}

/** `"quoteId", "createdAt" DESC` → ["quoteId", "createdAt"] */
const cotTuSql = (cols) => cols.split(",").map((c) => c.trim().replace(/"/g, "").replace(/\s+(ASC|DESC)$/i, "").trim());

/** Thân của `model X { … }` — để không bắt nhầm attribute sang model khác. */
function modelBlock(name) {
  const m = SCHEMA.match(new RegExp(`^model ${name} \\{([\\s\\S]*?)^\\}`, "m"));
  return m ? m[1] : null;
}

/** Mọi tổ hợp cột đã được khai trong model: @@index/@@unique/@@id + @unique/@id mức trường. */
function cotDaKhai(body) {
  const attrs = [...body.matchAll(/@@(?:index|unique|id)\(\s*\[([^\]]*)\]/g)]
    .map((m) => m[1].split(",").map((c) => c.trim().replace(/\(.*$/, "").trim()));
  const mucTruong = [...body.matchAll(/^\s*(\w+)\s+\S+[^\n]*@(?:unique|id)\b/gm)].map((m) => [m[1]]);
  return [...attrs, ...mucTruong];
}

// Bảng KHÔNG phải model Prisma → không thể khai @@index cho chúng.
// `_QuoteMembers` là bảng nối m2m NGẦM (quan hệ Quote↔User): Prisma tự quản, không khai được.
const BANG_KHONG_PHAI_MODEL = new Set(["_QuoteMembers"]);

describe("LUẬT: mọi index btree THƯỜNG trong migration phải được khai trong schema.prisma", () => {
  const tatCa = quetIndexTuMigration();

  it("quét được một lượng index hợp lý (bảo hiểm cho chính bộ quét)", () => {
    // Nếu regex hỏng/đường dẫn sai, `tatCa` rỗng và mọi khẳng định dưới thành vô nghĩa mà vẫn XANH.
    expect(tatCa.length).toBeGreaterThan(60);
  });

  it("KHÔNG index btree thường nào thiếu @@index/@@unique tương ứng", () => {
    const thieu = [];
    for (const [ten, v] of tatCa) {
      if (v.using) continue;                       // GIN/GiST — Prisma không biểu diễn được
      if (v.where) continue;                       // partial index — Prisma không có
      if (BANG_KHONG_PHAI_MODEL.has(v.bang)) continue;
      const body = modelBlock(v.bang);
      if (body == null) { thieu.push(`${ten}: KHÔNG có model ${v.bang} trong schema.prisma`); continue; }
      const cot = cotTuSql(v.cols);
      const khop = cotDaKhai(body).some((a) => a.length === cot.length && a.every((x, i) => x === cot[i]));
      if (!khop) thieu.push(`${ten} (${v.dir}) → model ${v.bang} thiếu @@index([${cot.join(", ")}])`);
    }
    // Thông điệp liệt kê ĐÚNG chỗ phải sửa — người đọc không phải tự dò lại 49 migration.
    expect(thieu, `Thiếu khai báo trong prisma/schema.prisma:\n  - ${thieu.join("\n  - ")}`).toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════════════════════
//  TẦNG B — chạy THẬT migrate deploy + migrate diff trên CSDL nháp
// ════════════════════════════════════════════════════════════════════════════

// Danh sách miễn trừ, PHẢI khớp bảng "Drift ĐƯỢC PHÉP" trong prisma/migrations/README.md.
// Prisma không biểu diễn được các object này nên chúng sẽ mãi bị báo trôi — đó là CHỜ ĐỢI.
// So sánh là BẰNG ĐÚNG (cả hai chiều): thêm một trôi mới → ĐỎ; sửa xong một trôi cũ mà quên cập
// nhật README/bảng này → cũng ĐỎ, buộc hai nơi đi cùng nhau.
const DRIFT_DUOC_PHEP = {
  Customer: ["Removed index on columns (name)", "Removed index on columns (searchText)", "Removed index on columns (taxCode)"],
  PersonnelRecord: ["Removed index on columns (searchText)"],
  Product: ["Removed index on columns (name)", "Removed index on columns (sku)"],
  Quote: ["Removed index on columns (quoteNumber)", "Removed index on columns (searchText)", "Removed index on columns (title)", "Removed index on columns (toCompany)"],
  Venue: ["Removed index on columns (tags)"],
  _QuoteMembers: ["Added primary key on columns (A, B)", "Removed unique index on columns (A, B)"],
};

const BASE_URL = process.env.DATABASE_URL || "postgresql://quanly:quanly_pwd@localhost:5432/quanly_test?schema=public";
// CSDL nháp RIÊNG có dấu thời gian: KHÔNG đụng `quanly_test` mà các bộ test/agent khác đang dùng.
const SHADOW_DB = `vdb_drift_${Date.now()}`;
const urlCho = (db) => { const u = new URL(BASE_URL); u.pathname = `/${db}`; return u.toString(); };

/** Kết nối tới CSDL `postgres` để CREATE/DROP DATABASE. null nếu không kết nối/không đủ quyền. */
async function thuTaoShadow() {
  const c = new Client({ connectionString: urlCho("postgres") });
  try {
    await c.connect();
    await c.query(`CREATE DATABASE "${SHADOW_DB}"`);
    await c.end();
  } catch { try { await c.end(); } catch { /* đã đóng */ } return false; }
  const s = new Client({ connectionString: urlCho(SHADOW_DB) });
  try {
    await s.connect();
    await s.query("CREATE EXTENSION IF NOT EXISTS pg_trgm");   // migration trgm cần extension này
    await s.end();
    return true;
  } catch { try { await s.end(); } catch { /* đã đóng */ } return false; }
}

const shadowOk = await thuTaoShadow();
if (!shadowOk && process.env.REQUIRE_DB_TESTS === "1") {
  throw new Error("REQUIRE_DB_TESTS=1 nhưng không tạo được CSDL nháp để đo trôi schema");
}

const prismaCli = (args, db) =>
  spawnSync(process.execPath, [join(ROOT, "node_modules/prisma/build/index.js"), ...args], {
    cwd: ROOT, encoding: "utf8", timeout: 120_000,
    env: { ...process.env, DATABASE_URL: urlCho(db) },
  });

describe.runIf(shadowOk)("CỔNG THẬT: prisma migrate diff giữa CSDL đã deploy và schema.prisma", () => {
  let ketQua;

  beforeAll(() => {
    const deploy = prismaCli(["migrate", "deploy"], SHADOW_DB);
    expect(deploy.status, `migrate deploy thất bại:\n${deploy.stdout}\n${deploy.stderr}`).toBe(0);
    // --exit-code: 0 = không trôi, 2 = có trôi. Ta CHỜ ĐỢI 2 (còn bộ miễn trừ), nên không dùng
    // exit code làm khẳng định chính — mà so TỪNG object bị báo với allowlist.
    ketQua = prismaCli(["migrate", "diff", "--from-config-datasource", "--to-schema", "prisma/schema.prisma", "--exit-code"], SHADOW_DB);
  });

  afterAll(async () => {
    const c = new Client({ connectionString: urlCho("postgres") });
    try {
      await c.connect();
      await c.query(`DROP DATABASE IF EXISTS "${SHADOW_DB}" WITH (FORCE)`);
    } catch { /* dọn dẹp best-effort — CSDL nháp có dấu thời gian nên không đụng ai */ }
    finally { try { await c.end(); } catch { /* đã đóng */ } }
  });

  it("tập object bị báo trôi BẰNG ĐÚNG danh sách miễn trừ trong README", () => {
    const out = `${ketQua.stdout || ""}${ketQua.stderr || ""}`;
    expect(out, "migrate diff không chạy được").toMatch(/Changed the|No difference detected/);
    // Phân tích đầu ra dạng:  "[*] Changed the `X` table"  rồi các dòng "  [-]/[+]/[*] …"
    const thucTe = {};
    let bang = null;
    for (const raw of out.split("\n")) {
      const dauBang = raw.match(/^\[\*\] Changed the `([^`]+)` table/);
      if (dauBang) { bang = dauBang[1]; (thucTe[bang] ||= []); continue; }
      const dong = raw.match(/^\s+\[[-+*]\]\s+(.*\S)\s*$/);
      if (dong && bang) thucTe[bang].push(dong[1]);
    }
    const chuanHoa = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, [...v].sort()]));
    expect(
      chuanHoa(thucTe),
      `Trôi schema KHÁC danh sách miễn trừ. Đầu ra migrate diff:\n${out}\n` +
      "→ Object btree THƯỜNG bị báo thừa nghĩa là schema.prisma thiếu @@index — SỬA SCHEMA, đừng " +
      "chạy `migrate dev` rồi commit file DROP INDEX. Nếu đây là miễn trừ mới hợp lệ thì cập nhật " +
      "CẢ prisma/migrations/README.md và hằng số DRIFT_DUOC_PHEP trong bài test này.",
    ).toEqual(chuanHoa(DRIFT_DUOC_PHEP));
  });
});
