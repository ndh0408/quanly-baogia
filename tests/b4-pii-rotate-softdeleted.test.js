/**
 * CỤM B4 — `src/tools/piiRotate.ts` BỎ SÓT mọi hàng đã XOÁ MỀM.
 *
 * TÁI HIỆN (đọc mã, đối chiếu ba file):
 *   · src/db.ts:16 `SOFT_DELETE_MODELS` chứa CẢ "PersonnelRecord" và "Employee" — đúng hai model
 *     duy nhất có PII (src/piiFields.ts PII_FIELDS).
 *   · src/db.ts:17 `READS` gồm `findMany` VÀ `count`; db.ts:80-88 tự chèn `where.deletedAt = null`
 *     cho mọi thao tác đọc trừ khi truyền `includeDeleted: true`.
 *   · src/tools/piiRotate.ts import `prisma` từ "../db.js" (bản ĐÃ mở rộng) rồi gọi
 *     `client.count(...)` / `client.findMany(...)` KHÔNG kèm `includeDeleted`.
 * HẬU QUẢ: hàng xoá mềm vẫn giữ nguyên bản mã dưới KHOÁ CŨ và không bao giờ được mã lại. Huỷ khoá cũ
 * theo runbook (docs/operations/DISASTER_RECOVERY.md) là khoá vĩnh viễn phần dữ liệu đó — mà đây
 * chính là dữ liệu phải giữ được để trả lời yêu cầu GDPR/thanh tra.
 *
 * BÀI TEST đi qua ĐÚNG lớp có lỗi: nạp chính module piiRotate với `../src/db.js` bị thay bằng bản
 * GHI LẠI ĐỐI SỐ, rồi soi đối số thật mà nó gửi xuống Prisma. Không cần CSDL.
 * `updateMany` KHÔNG được kiểm ở đây vì db.ts:89-96 không lọc deletedAt cho thao tác GHI — nó vốn
 * đã chạm được hàng xoá mềm.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";

const goiFindMany = [];
const goiCount = [];

const fakeModel = () => ({
  count: async (args) => { goiCount.push(args); return 0; },
  findMany: async (args) => { goiFindMany.push(args); return []; },
  updateMany: async () => ({ count: 1 }),
});

vi.mock("../src/db.js", () => ({
  prisma: {
    personnelRecord: fakeModel(),
    employee: fakeModel(),
    $disconnect: async () => {},
  },
}));

describe("B4 — piiRotate phải xoay CẢ hàng đã xoá mềm", () => {
  beforeAll(async () => {
    // chotDauVao() đòi hai khoá KHÁC nhau, nếu không nó process.exit(1) trước khi truy vấn gì.
    process.env.PII_ENC_KEY = "khoa-moi-cho-bai-test-b4-du-dai";
    process.env.PII_ENC_KEY_OLD = "khoa-cu-cho-bai-test-b4-du-dai";
    const exit = vi.spyOn(process, "exit").mockImplementation(() => undefined);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await import("../src/tools/piiRotate.js");
    // `void main()` chạy bất đồng bộ ngay lúc nạp module — nhường vài nhịp cho nó xong.
    for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
    exit.mockRestore();
    log.mockRestore();
  });

  it("count() của mỗi model truyền includeDeleted: true", () => {
    expect(goiCount.length).toBeGreaterThan(0);
    for (const a of goiCount) expect(a.includeDeleted).toBe(true);
  });

  it("findMany() phân trang cũng truyền includeDeleted: true", () => {
    expect(goiFindMany.length).toBeGreaterThan(0);
    for (const a of goiFindMany) expect(a.includeDeleted).toBe(true);
  });
});
