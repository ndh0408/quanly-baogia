// GET /api/phien-ban — web hỏi để báo "Có bản mới" sau deploy (src/phienBan.ts, web/src/lib/phienBan.ts).
//
// Chốt ba điều:
//   1. Đọc đúng bản giao diện (tên tệp JS chính trong public/app2/index.html) và mã commit + giờ từ
//      public/phien-ban.txt — tệp chưa được `git archive` điền thì trả null, không bịa.
//   2. Endpoint CÔNG KHAI, `no-store`, và KHÔNG đi qua phiên: web hỏi 5 phút/lần — đi qua phiên (cookie
//      rolling) thì tab bỏ quên sẽ không bao giờ hết phiên đăng nhập.
//   3. `git archive` (deploy.sh ship mã bằng lệnh này) THẬT SỰ điền mã commit vào tệp (.gitattributes
//      export-subst) — không có thì chân menu mãi hiện "Phiên bản <mã tệp>" thay vì mã commit.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const { docPhienBan } = await import("../src/phienBan.js");
const ROOT = path.join(import.meta.dirname, "..");

describe("docPhienBan", () => {
  let goc;
  beforeAll(() => {
    goc = fs.mkdtempSync(path.join(os.tmpdir(), "phien-ban-"));
    fs.mkdirSync(path.join(goc, "public", "app2"), { recursive: true });
  });
  afterAll(() => fs.rmSync(goc, { recursive: true, force: true }));

  it("tên tệp JS chính + mã commit/giờ đã được git archive điền", () => {
    fs.writeFileSync(path.join(goc, "public", "app2", "index.html"),
      '<html><head><script type="module" crossorigin src="/app2/assets/index-BVwnOoE_.js"></script><link rel="stylesheet" href="/app2/assets/index-Dk2.css"></head></html>');
    fs.writeFileSync(path.join(goc, "public", "phien-ban.txt"), "9dd30dc17584bf3cc5771d2c11dfa44b25eaa2e0 2026-09-24T13:40:12+07:00\n");
    const pb = docPhienBan(goc);
    expect(pb.banGiaoDien).toBe("index-BVwnOoE_");
    expect(pb.sha).toBe("9dd30dc");
    expect(pb.capNhatLuc).toBe("2026-09-24T13:40:12+07:00");
    expect(typeof pb.khoiDongLuc).toBe("string");
  });

  it("tệp còn nguyên $Format:…$ (chạy từ cây làm việc) → sha/giờ null, KHÔNG bịa", () => {
    fs.writeFileSync(path.join(goc, "public", "phien-ban.txt"), "$Format:%H %cI$\n");
    const pb = docPhienBan(goc);
    expect(pb.sha).toBeNull();
    expect(pb.capNhatLuc).toBeNull();
  });

  it("chưa build web (dev chạy vite riêng) → banGiaoDien null — web sẽ không bao giờ báo 'có bản mới' nhầm", () => {
    expect(docPhienBan(path.join(goc, "khong-co")).banGiaoDien).toBeNull();
  });
});

describe("GET /api/phien-ban", () => {
  let app;
  beforeAll(async () => { app = (await import("../src/app.js")).createApp(); });

  it("công khai, no-store, không phát cookie phiên", async () => {
    const r = await request(app).get("/api/phien-ban");
    expect(r.status).toBe(200);
    expect(r.headers["cache-control"]).toMatch(/no-store/);
    expect(r.headers["set-cookie"], "đi qua phiên → cookie rolling được làm mới mỗi 5 phút").toBeUndefined();
    expect(r.body).toHaveProperty("banGiaoDien");
    expect(r.body).toHaveProperty("sha");
  });

  it("kèm cookie phiên cũng KHÔNG chạm kho phiên (tab bỏ quên vẫn hết phiên đúng hạn)", async () => {
    const r = await request(app).get("/api/phien-ban").set("Cookie", "qly.sid=s%3Agia.chuky");
    expect(r.status).toBe(200);
    expect(r.headers["set-cookie"]).toBeUndefined();
  });
});

/** Đọc một tệp khỏi gói tar (git archive thêm một mục pax_global_header đầu tiên). */
function docTuTar(buf, ten) {
  let o = 0;
  while (o + 512 <= buf.length) {
    const tenMuc = buf.subarray(o, o + 100).toString("utf8").replace(/\0.*$/s, "");
    if (!tenMuc) return null;
    const co = parseInt(buf.subarray(o + 124, o + 136).toString("utf8").replace(/\0.*$/s, "").trim() || "0", 8);
    if (tenMuc === ten) return buf.subarray(o + 512, o + 512 + co).toString("utf8");
    o += 512 + Math.ceil(co / 512) * 512;
  }
  return null;
}

const daCommit = (() => {
  // Có trong commit HEAD (không chỉ đã `git add`) — git archive đọc từ commit.
  try { execFileSync("git", ["cat-file", "-e", "HEAD:public/phien-ban.txt"], { cwd: ROOT, stdio: "ignore" }); return true; } catch { return false; }
})();

describe.runIf(daCommit)("git archive điền mã commit vào public/phien-ban.txt (export-subst)", () => {
  it("gói deploy.sh ship mang đúng mã commit HEAD + giờ commit", () => {
    const tar = execFileSync("git", ["archive", "--format=tar", "HEAD", "public/phien-ban.txt"], { cwd: ROOT });
    const noiDung = docTuTar(tar, "public/phien-ban.txt");
    const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
    expect(noiDung, "không thấy tệp trong gói").not.toBeNull();
    expect(noiDung.trim()).toMatch(new RegExp(`^${head} \\d{4}-\\d{2}-\\d{2}T`));
  });
});
