// Gác SQL HUỶ DỮ LIỆU trong migration.
//
// ── ĐO TRƯỚC KHI VIẾT ────────────────────────────────────────────────────────
// Gác TRÔI SCHEMA đã có và chạy thật (tests/vdb-schema-index-drift.test.js gọi `prisma migrate
// diff` giữa CSDL đã deploy và schema.prisma). Nhưng nó KHÔNG đọc nội dung migration: một
// `DROP TABLE` làm schema và CSDL KHỚP NHAU — chỉ dữ liệu là mất, và không phép kiểm nào đỏ.
// Lúc viết bài test này, `grep -rn "DROP COLUMN|DROP TABLE|destructive" scripts/ci/ .github/`
// không ra dòng nào, còn prisma/migrations/ có 4 migration huỷ dữ liệu thật.
import { describe, it, expect } from "vitest";
import {
  lenhHuyTrongSql,
  boChuThich,
  quetMigrations,
  chuaKhai,
  CHO_PHEP,
} from "../scripts/ci/check-destructive-sql.mjs";

describe("check-destructive-sql: bộ quét", () => {
  it("bắt DROP TABLE / DROP COLUMN / TRUNCATE", () => {
    expect(lenhHuyTrongSql('DROP TABLE "Quote";')).toEqual(["DROP TABLE"]);
    expect(lenhHuyTrongSql('ALTER TABLE "Quote" DROP COLUMN IF EXISTS "expiredAt";')).toEqual(["DROP COLUMN"]);
    expect(lenhHuyTrongSql('TRUNCATE "AuditEvent";')).toEqual(["TRUNCATE"]);
  });

  it("KHÔNG bắt câu lệnh nằm trong chú thích ROLLBACK (mẫu thật của repo)", () => {
    const sql = [
      '-- ROLLBACK: ALTER TABLE "User" DROP COLUMN "passwordChangedAt";',
      '/* DROP TABLE "UploadObject"; */',
      'ALTER TABLE "User" ADD COLUMN "passwordChangedAt" TIMESTAMP;',
    ].join("\n");
    expect(boChuThich(sql)).not.toMatch(/DROP/);
    expect(lenhHuyTrongSql(sql)).toEqual([]);
  });

  it("KHÔNG bắt DROP TYPE / DROP INDEX / DROP CONSTRAINT (không xoá hàng nào)", () => {
    expect(lenhHuyTrongSql('DROP TYPE "Role_old"; DROP INDEX IF EXISTS "Quote_validUntil_idx";')).toEqual([]);
    expect(lenhHuyTrongSql('ALTER TABLE "QuoteItem" DROP CONSTRAINT IF EXISTS "QuoteItem_kind_check";')).toEqual([]);
  });

  it("DELETE FROM có WHERE thì tha, không WHERE thì bắt", () => {
    expect(lenhHuyTrongSql('DELETE FROM "Quote" WHERE "status" = \'draft\';')).toEqual([]);
    expect(lenhHuyTrongSql('DELETE FROM "Quote";')).toEqual(["DELETE FROM không WHERE"]);
    // Câu lệnh sau có WHERE không được che cho câu lệnh trước.
    expect(lenhHuyTrongSql('DELETE FROM "A"; DELETE FROM "B" WHERE id = 1;')).toEqual(["DELETE FROM không WHERE"]);
  });

  it("UPDATE ... WHERE (backfill) không bị coi là huỷ", () => {
    expect(lenhHuyTrongSql(`UPDATE "User" SET "role" = 'manager' WHERE "role" = 'employee';`)).toEqual([]);
  });

  it("migration huỷ dữ liệu KHÔNG có trong allowlist → bị bắt", () => {
    const gia = [
      { ten: "20990101000000_xoa_bao_gia", file: "x", lenh: ["DROP TABLE"] },
      { ten: "20260619000001_drop_billing", file: "y", lenh: ["DROP TABLE"] },
    ];
    expect(chuaKhai(gia).map((m) => m.ten)).toEqual(["20990101000000_xoa_bao_gia"]);
  });
});

describe("check-destructive-sql: cây hiện tại", () => {
  it("mọi migration huỷ dữ liệu đều được khai tường minh, và không khai thừa", () => {
    const danhSach = quetMigrations();
    // Chốt bộ quét thật sự chạy trên cây thật: repo ĐANG có migration huỷ dữ liệu.
    expect(danhSach.length).toBeGreaterThanOrEqual(4);
    expect(chuaKhai(danhSach).map((m) => m.file)).toEqual([]);

    const co = new Set(danhSach.map((m) => m.ten));
    expect([...CHO_PHEP.keys()].filter((k) => !co.has(k)), "khai thừa").toEqual([]);
  });

  it("bốn migration huỷ dữ liệu đã biết đều nằm trong danh sách quét được", () => {
    const ten = quetMigrations().map((m) => m.ten);
    for (const k of [
      "20260617000002_remove_quote_expiry",
      "20260617000003_drop_approval_matrix",
      "20260619000001_drop_billing",
      "20260619000002_drop_api_keys",
    ]) expect(ten).toContain(k);
  });
});
