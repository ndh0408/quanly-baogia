// Trôi schema: DB có index mà `prisma/schema.prisma` KHÔNG khai — và bảng chỉ-ghi-thêm thiếu
// index dẫn đầu bằng createdAt. Chốt hồi quy ở mức tệp schema.
//
// ── LỖI 1: index có trong migration nhưng KHÔNG có trong schema ─────────────
//   · `20260811000001_sheet_customer_decision/migration.sql`
//       CREATE INDEX "QuoteSheet_custStatusById_idx" ON "QuoteSheet"("custStatusById");
//   · `20260811200000_payment_proof_object/migration.sql`
//       CREATE INDEX IF NOT EXISTS "PersonnelRecord_paymentProofKey_idx" ON "PersonnelRecord" ("paymentProofKey");
// Cả hai là btree THƯỜNG — Prisma biểu diễn được, nên KHÔNG nằm trong diện miễn trừ mà
// `prisma/migrations/README.md` mô tả (chỉ miễn trigram + partial + CHECK).
//
// HẬU QUẢ: `prisma migrate dev` coi đây là trôi schema và sinh ra migration `DROP INDEX`. Ai
// chạy lệnh đó rồi commit file sinh ra là XOÁ index trên production — sau đó mọi truy vấn
// "user này đã đánh dấu hộ khách những sheet nào" và mọi tra cứu theo khoá ảnh chứng từ đều
// seq-scan. Đây là lỗi TIỀM ẨN: cần một hành động tương lai mới thành thiệt hại.
//
// ── LỖI 2: bảng chỉ-ghi-thêm không có index dẫn đầu createdAt ───────────────
// `AuditEvent`, `LoginAttempt`, `WebhookDelivery` chỉ có index GHÉP với `createdAt` ở cột 2/3
// (`[actorId, createdAt]`, `[username, createdAt]`…). Truy vấn KHÔNG lọc — trang Nhật ký mở
// không bộ lọc (`src/services/auditService.ts` để `where = {}` rồi `orderBy: createdAt desc`) và
// job dọn dữ liệu (`src/retention.ts` xoá thuần theo `createdAt <`) — không dùng được index nào
// trong số đó: seq-scan + top-N sort, đắt dần theo thời gian trên bảng chỉ có lớn lên.
//
// ── TÁI HIỆN ────────────────────────────────────────────────────────────────
// Đọc thẳng `prisma/schema.prisma` và kiểm từng khối model. Trước khi vá, 5 khẳng định dưới đỏ.
//
// ── CÁCH VÁ ─────────────────────────────────────────────────────────────────
// Khai `@@index` cho hai index DB đã có (không cần migration — DB khớp sẵn), và thêm
// `@@index([createdAt(sort: Desc)])` cho ba bảng chỉ-ghi-thêm kèm migration tạo index tương ứng.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SCHEMA = readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
const MIG_DIR = new URL("../prisma/migrations/", import.meta.url).pathname;

/** Lấy thân của một khối `model X { ... }` để khẳng định không bắt nhầm sang model khác. */
function modelBlock(name) {
  const m = SCHEMA.match(new RegExp(`^model ${name} \\{([\\s\\S]*?)^\\}`, "m"));
  if (!m) throw new Error(`không tìm thấy model ${name} trong prisma/schema.prisma`);
  return m[1];
}

/** Toàn bộ SQL của mọi migration, nối lại — để dò một index đã được tạo ở đâu đó chưa. */
function allMigrationSql() {
  return readdirSync(MIG_DIR)
    .filter((d) => !d.includes("."))
    .map((d) => { try { return readFileSync(join(MIG_DIR, d, "migration.sql"), "utf8"); } catch { return ""; } })
    .join("\n");
}

describe("schema.prisma không được trôi khỏi index thật trong CSDL", () => {
  it("QuoteSheet khai @@index([custStatusById]) — index migration đã tạo", () => {
    expect(allMigrationSql()).toContain('"QuoteSheet_custStatusById_idx"');
    expect(modelBlock("QuoteSheet")).toMatch(/@@index\(\[custStatusById\]\)/);
  });

  it("PersonnelRecord khai @@index([paymentProofKey]) — index migration đã tạo", () => {
    expect(allMigrationSql()).toContain('"PersonnelRecord_paymentProofKey_idx"');
    expect(modelBlock("PersonnelRecord")).toMatch(/@@index\(\[paymentProofKey\]\)/);
  });
});

describe("bảng chỉ-ghi-thêm phải có index dẫn đầu bằng createdAt", () => {
  // Cả ba đều bị quét toàn bảng khi liệt kê KHÔNG lọc và khi job retention xoá theo createdAt.
  for (const model of ["AuditEvent", "LoginAttempt", "WebhookDelivery"]) {
    it(`${model} khai @@index([createdAt(sort: Desc)])`, () => {
      expect(modelBlock(model)).toMatch(/@@index\(\[createdAt\(sort: Desc\)\]\)/);
    });

    it(`${model}_createdAt_idx có migration tạo thật (schema không được đi trước CSDL)`, () => {
      expect(allMigrationSql()).toContain(`"${model}_createdAt_idx"`);
    });
  }
});
