// PHANH THỜI GIAN Ở POSTGRES — `statement_timeout` + `idle_in_transaction_session_timeout`.
//
// ── VÌ SAO CÓ BÀI NÀY ───────────────────────────────────────────────────────
// ĐO ĐƯỢC trên production 2026-09-16:
//     statement_timeout                   = 0
//     idle_in_transaction_session_timeout = 0
// tức KHÔNG có phanh nào. `DB_TX_TIMEOUT` của Prisma chỉ chi phối cái nằm TRONG `$transaction`;
// hai thứ nguy hiểm nhất lại nằm NGOÀI nó:
//   · một truy vấn lẻ chạy loạn giữ kết nối tới khi nào xong;
//   · một transaction BỊ BỎ DỞ (tiến trình web chết giữa chừng) giữ kết nối VĨNH VIỄN, và kết
//     nối "idle in transaction" còn chặn cả VACUUM dọn rác.
// Với `max_connections = 100` (đo được ở cả dev lẫn production), đó chính là cơ chế biến 44/100
// kết nối thành 100/100 sau vài tuần — chậm, âm thầm, rồi sập một lần.
//
// ── BÀI NÀY CANH GÌ ─────────────────────────────────────────────────────────
// 1. Phanh THẬT SỰ tới được Postgres qua `options` của pool (không phải chỉ nằm trong config).
// 2. Phanh THẬT SỰ cắt — kể cả khi đang CHỜ KHOÁ, đường mà hai người cùng lưu một báo giá đi qua.
// 3. Bất biến `DB_STATEMENT_TIMEOUT >= DB_TX_TIMEOUT` giết tiến trình lúc KHỞI ĐỘNG, không để
//    phát hiện lúc người dùng đang gõ.
import { describe, it, expect, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import pg from "pg";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const URL_DB = process.env.DATABASE_URL;
const coDb = !!URL_DB;

function napConfig(env) {
  try {
    const out = execFileSync(
      process.execPath,
      ["--import", "tsx", "-e", `import(${JSON.stringify(pathToFileURL(path.join(ROOT, "src/config.ts")).href)})`],
      {
        cwd: ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, NODE_ENV: "development", DATABASE_URL: "postgresql://u:p@localhost:5432/x", ...env },
      },
    );
    return { ma: 0, out };
  } catch (e) {
    return { ma: e.status ?? -1, out: `${e.stdout || ""}${e.stderr || ""}` };
  }
}

describe("bất biến cấu hình: phanh câu lệnh không được chặt hơn trần transaction", () => {
  it("DB_STATEMENT_TIMEOUT < DB_TX_TIMEOUT → CHẾT lúc khởi động, kèm TÊN cả hai biến", () => {
    const r = napConfig({ DB_TX_TIMEOUT: "60000", DB_STATEMENT_TIMEOUT: "30000" });
    expect(r.ma, `phải thoát khác 0, nhận được ${r.ma}. out: ${r.out.slice(0, 300)}`).not.toBe(0);
    expect(r.out).toContain("DB_STATEMENT_TIMEOUT");
    expect(r.out).toContain("DB_TX_TIMEOUT");
  });

  it("bằng nhau thì HỢP LỆ (đây là cấu hình mặc định: 60s/60s)", () => {
    const r = napConfig({ DB_TX_TIMEOUT: "60000", DB_STATEMENT_TIMEOUT: "60000" });
    expect(r.ma, r.out.slice(0, 300)).toBe(0);
  });

  it("gõ nhầm ĐƠN VỊ (giây thay vì mili-giây) bị chặn, không lặng lẽ thành 5ms", () => {
    const r = napConfig({ DB_STATEMENT_TIMEOUT: "60" });
    expect(r.ma).not.toBe(0);
    expect(r.out).toContain("DB_STATEMENT_TIMEOUT");
  });
});

const moTa = coDb ? describe : describe.skip;
const beHo = [];
afterAll(async () => { for (const p of beHo) await p.end().catch(() => {}); });

moTa("phanh tới được Postgres THẬT và cắt THẬT", () => {
  it("`options` của pool đặt được cả hai trần trên phiên", async () => {
    const pool = new pg.Pool({
      connectionString: URL_DB,
      options: "-c statement_timeout=7000 -c idle_in_transaction_session_timeout=9000",
    });
    beHo.push(pool);
    const c = await pool.connect();
    try {
      const a = await c.query("show statement_timeout");
      const b = await c.query("show idle_in_transaction_session_timeout");
      expect(a.rows[0].statement_timeout).toBe("7s");
      expect(b.rows[0].idle_in_transaction_session_timeout).toBe("9s");
    } finally { c.release(); }
  }, 30_000);

  it("cắt một câu lệnh chạy quá lâu, đúng mã 57014", async () => {
    const pool = new pg.Pool({ connectionString: URL_DB, options: "-c statement_timeout=1200" });
    beHo.push(pool);
    const c = await pool.connect();
    try {
      const t = Date.now();
      await expect(c.query("select pg_sleep(5)")).rejects.toMatchObject({ code: "57014" });
      const troi = Date.now() - t;
      // Cắt ĐÚNG LÚC, không phải "cuối cùng cũng xong": nếu phanh không ăn thì câu này mất 5.000ms.
      expect(troi, `cắt sau ${troi}ms (trần 1.200ms)`).toBeLessThan(3_000);
    } finally { c.release(); }
  }, 30_000);

  it("cắt CẢ khi đang CHỜ KHOÁ — đường hai người cùng lưu một báo giá đi qua", async () => {
    const ten = `thu_phanh_${process.pid}`;
    const poolGiu = new pg.Pool({ connectionString: URL_DB });
    const poolCho = new pg.Pool({ connectionString: URL_DB, options: "-c statement_timeout=1200" });
    beHo.push(poolGiu, poolCho);
    const giu = await poolGiu.connect();
    const cho = await poolCho.connect();
    try {
      await giu.query(`create table if not exists "${ten}" (id int primary key, v text)`);
      await giu.query(`insert into "${ten}" (id,v) values (1,'a') on conflict (id) do nothing`);
      await giu.query("begin");
      await giu.query(`select * from "${ten}" where id=1 for update`);
      await expect(cho.query(`update "${ten}" set v='b' where id=1`)).rejects.toMatchObject({ code: "57014" });
      await giu.query("rollback");
    } finally {
      await giu.query(`drop table if exists "${ten}"`).catch(() => {});
      giu.release(); cho.release();
    }
  }, 30_000);
});
