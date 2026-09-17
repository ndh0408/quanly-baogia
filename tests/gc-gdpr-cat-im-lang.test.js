/**
 * ============================================================================
 * BẢN XUẤT GDPR BỊ CẮT THÌ PHẢI KHAI LÀ BỊ CẮT.
 *
 * ── LỖ ─────────────────────────────────────────────────────────────────────
 * `gdprService.exportUser` có BỐN `take` cứng — báo giá 1.000, khách hàng 5.000, nhật ký 5.000,
 * thông báo 5.000 — và cả bốn cắt HOÀN TOÀN IM LẶNG. Người nhận tải về một tệp tự khai
 * `format: "qly-gdpr-export/1.0"` và không có một dòng nào nói bản ghi thứ 1.001 đi đâu.
 *
 * Chính tệp đó đã đặt ra luật ngược lại cho phần DÒNG HẠNG MỤC:
 *     "Cắt mà im lặng là tệ hơn không cắt: người nhận tưởng mình đã có đủ dữ liệu."
 * Luật đúng, chỉ là chưa áp cho bốn nhóm này.
 *
 * TỆ HƠN CẢ IM LẶNG: khối `gioiHan` còn khẳng định "Danh sách báo giá vẫn ĐẦY ĐỦ". Với người có
 * hơn 1.000 báo giá thì câu đó SAI, và sai theo hướng TRẤN AN — người đọc có lý do để tin mình đã
 * nhận đủ. Với bản xuất dữ liệu cá nhân, thiếu-mà-không-khai nghĩa là người ta không có cách nào
 * biết để đi đòi phần còn lại.
 *
 * ── BÀI NÀY DỰNG DỮ LIỆU THẬT VƯỢT TRẦN ────────────────────────────────────
 * Chèn 5.001 thông báo bằng MỘT `createMany` (vài chục mili-giây) rồi gọi đúng `exportUser`. Kiểm
 * bằng cách đọc hằng số rồi tự trấn an là "chắc nó cắt đúng" thì không chứng minh được gì — thứ
 * cần chứng minh là TỆP TRẢ VỀ có khai phần bị cắt hay không.
 * ============================================================================
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import { prisma } from "../src/db.js";
import { exportUser, catVaBao, TRAN_BAN_GHI } from "../src/services/gdprService.js";

const dbAvailable = await prisma
  .$queryRawUnsafe('SELECT 1 FROM "User" LIMIT 1')
  .then(() => true)
  .catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") {
  throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");
}

describe("catVaBao — quyết định 'có chạm trần không'", () => {
  const ds = (n) => Array.from({ length: n }, (_, i) => i);

  it("DƯỚI trần → không cắt, không khai", () => {
    const r = catVaBao(ds(3), 5, "x", "h");
    expect(r.rows.length).toBe(3);
    expect(r.biCat, "chưa chạm trần mà đã báo bị cắt").toBeNull();
  });

  it("ĐÚNG BẰNG trần → vẫn KHÔNG phải bị cắt", () => {
    // Ranh giới dễ sai nhất. Báo "bị cắt" khi vừa khít trần là một lời khai sai theo hướng ngược
    // lại — người nhận đi đòi phần không tồn tại.
    const r = catVaBao(ds(5), 5, "x", "h");
    expect(r.rows.length).toBe(5);
    expect(r.biCat).toBeNull();
  });

  it("VƯỢT trần → cắt đúng trần VÀ khai rõ nhóm nào", () => {
    const r = catVaBao(ds(6), 5, "notifications", "lấy nốt ở đây");
    expect(r.rows.length, "phải cắt lại đúng trần, không giữ bản ghi dư dùng để dò").toBe(5);
    expect(r.biCat).toEqual({ nhom: "notifications", tran: 5, huongDan: "lấy nốt ở đây" });
  });
});

describe.runIf(dbAvailable)("exportUser — vượt trần thì tệp trả về phải khai", () => {
  const TAG = `gccat${Date.now()}`;
  let userId;

  beforeAll(async () => {
    const u = await prisma.user.create({
      data: { username: `${TAG}-u`, displayName: `${TAG} u`, role: "manager", passwordHash: await bcrypt.hash("Test1234!a", 4) },
    });
    userId = u.id;
    // Vượt trần ĐÚNG MỘT bản ghi: đó là ranh giới mà phép dò `take: tran + 1` phải bắt được.
    await prisma.notification.createMany({
      data: Array.from({ length: TRAN_BAN_GHI.thongBao + 1 }, (_, i) => ({
        userId, title: `${TAG} ${i}`, body: "x",
      })),
    });
  }, 120_000);

  afterAll(async () => {
    await prisma.notification.deleteMany({ where: { userId } }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true, includeDeleted: true }).catch(() => {});
  });

  it("thông báo vượt trần → có `gioiHan.danhSachBiCat` nêu đúng nhóm", async () => {
    const d = await exportUser(userId);
    expect(d.gioiHan, "đã cắt mà tệp KHÔNG khai — người nhận tưởng mình có đủ dữ liệu").toBeTruthy();
    expect(Array.isArray(d.gioiHan.danhSachBiCat)).toBe(true);
    const n = d.gioiHan.danhSachBiCat.find((x) => x.nhom === "notifications");
    expect(n, `khai thiếu nhóm notifications: ${JSON.stringify(d.gioiHan.danhSachBiCat)}`).toBeTruthy();
    expect(n.tran).toBe(TRAN_BAN_GHI.thongBao);
    expect(n.huongDan, "khai bị cắt mà không nói lấy nốt ở đâu").toBeTruthy();
  }, 120_000);

  it("số bản ghi trả về ĐÚNG BẰNG trần — không lọt bản ghi dư dùng để dò", async () => {
    // `take: tran + 1` là mẹo phát hiện. Quên cắt lại thì bản xuất có 5.001 dòng trong khi khai
    // trần là 5.000 — một tệp tự mâu thuẫn.
    const d = await exportUser(userId);
    expect(d.notifications.length).toBe(TRAN_BAN_GHI.thongBao);
  }, 120_000);

  it("nhóm KHÔNG chạm trần thì KHÔNG bị khai oan", async () => {
    // Vế đối trọng: khai bừa cũng là khai sai. Người dùng này không có báo giá/khách hàng nào.
    const d = await exportUser(userId);
    const ten = d.gioiHan.danhSachBiCat.map((x) => x.nhom);
    expect(ten).not.toContain("quotes");
    expect(ten).not.toContain("customers");
  }, 120_000);
});

describe("KHÔNG `take` nào trong gdprService được là số trần trụi", () => {
  it("mọi trần phải đi qua TRAN_BAN_GHI — số viết thẳng là cắt im lặng lần nữa", async () => {
    // Bài kiểm ở MỨC MÃ vì hành vi nhìn từ ngoài giống hệt nhau cho tới khi có người vượt trần —
    // và người đó sẽ không bao giờ biết. Cùng khuôn với bài "không nơi nào đọc thẳng meta.target".
    const { readFileSync } = await import("node:fs");
    const { join, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "..", "src/services/gdprService.ts"),
      "utf8",
    );
    const boChuThich = src.split("\n").filter((d) => !/^\s*(\/\/|\*|\/\*)/.test(d)).join("\n");
    const xau = [...boChuThich.matchAll(/take:\s*([^,\n]+)/g)]
      .map((m) => m[1].trim())
      .filter((v) => !v.startsWith("TRAN_BAN_GHI."));
    expect(xau, `take dùng số trần trụi (cắt im lặng): ${xau.join(" | ")}`).toEqual([]);
  });
});
