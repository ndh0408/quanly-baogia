// Cụm queue-storage — retention phải dọn cả OBJECT trong kho, không chỉ hàng trong CSDL
// (src/retention.ts + src/storage.ts).
//
// LỖI 1 — file xuất ra KHÔNG BAO GIỜ bị dọn (exports-objects-never-pruned).
//   Tái hiện: src/worker.ts ghi `exports/<số báo giá>-<Date.now()>.xlsx|pdf` — khoá kèm timestamp
//   nên MỖI lượt xuất đẻ một object MỚI, không ghi đè. Toàn bộ src/ không có một lệnh xoá nào cho
//   tiền tố `exports/`, còn `pruneOldRecords()` chỉ đụng AuditEvent/LoginAttempt/WebhookDelivery/
//   QuoteVersion/UploadObject.
//   Hậu quả: bucket phình vô hạn bằng những file mà link tải đã hết hạn sau 24h. Nặng hơn: bản sao
//   off-host là `mc mirror` CỘNG DỒN (cố ý không --remove) rồi đóng tarball; khi vượt
//   OBJ_TARBALL_MAX_MB script bỏ tarball, tức bản sao off-host của CHỨNG TỪ THANH TOÁN teo lại
//   còn mỗi manifest — mất khả năng khôi phục vì rác file xuất.
//
// LỖI 2 — object tạm của phiên tải lên bỏ dở nằm lại VĨNH VIỄN
//   (orphan-staging-objects-never-deleted).
//   Tái hiện: /sign-upload tạo hàng UploadObject `pending` + ký PUT vào `stagingKey`. Nếu client
//   không bao giờ gọi /finalize, hàng `pending` quá hạn bị `deleteMany` xoá — nhưng OBJECT thì
//   không ai xoá, và sau khi hàng biến mất thì KHÔNG CÒN MANH MỐI nào để dọn nó nữa.
//   Hậu quả: rác vĩnh viễn, lại được nhân bản sang bản gương và mọi tarball NAS.
//
// AN TOÀN: bài test này KHÔNG cần Postgres/MinIO — nó thay ./db.js và ./storage.js bằng bản giả để
// soi đúng chuỗi lệnh mà pruneOldRecords phát ra.
import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  calls: [],                 // nhật ký thứ tự lệnh — chứng minh XOÁ OBJECT TRƯỚC khi xoá hàng DB
  pendingRows: [],
  rejectedRows: [],
  objects: [],
  storageOn: true,
  failKeys: [],           // khoá cố tình cho xoá lỗi (giả lập S3 chập chờn)
}));

vi.mock("../src/db.js", () => ({
  prisma: {
    auditEvent: { deleteMany: async () => ({ count: 0 }) },
    loginAttempt: { deleteMany: async () => ({ count: 0 }) },
    webhookDelivery: { deleteMany: async () => ({ count: 0 }) },
    uploadObject: {
      findMany: async ({ where }) => (where.status === "pending" ? h.pendingRows : h.rejectedRows),
      deleteMany: async ({ where }) => {
        h.calls.push(`db:delete:${where.status}`);
        return { count: where.status === "pending" ? h.pendingRows.length : h.rejectedRows.length };
      },
    },
    $executeRawUnsafe: async () => 0,
  },
}));

vi.mock("../src/storage.js", () => ({
  isStorageEnabled: () => h.storageOn,
  listObjects: async (prefix) => {
    h.calls.push(`list:${prefix}`);
    return h.objects.filter((o) => o.key.startsWith(prefix));
  },
  deleteObject: async (key) => {
    h.calls.push(`obj:${key}`);
    if (h.failKeys.includes(key)) throw new Error("S3 down");
  },
}));

const { pruneOldRecords } = await import("../src/retention.js");

const daysAgo = (n) => new Date(Date.now() - n * 86_400_000);

beforeEach(() => {
  h.calls = [];
  h.pendingRows = [];
  h.rejectedRows = [];
  h.objects = [];
  h.storageOn = true;
  h.failKeys = [];
});

describe("pruneOldRecords — dọn file xuất quá hạn", () => {
  it("xoá object exports/ cũ hơn ngưỡng, GIỮ object mới", async () => {
    h.objects = [
      { key: "exports/BG-001-1.xlsx", lastModified: daysAgo(120) },
      { key: "exports/BG-002-2.pdf", lastModified: daysAgo(31) },
      { key: "exports/BG-003-3.xlsx", lastModified: daysAgo(2) },
    ];
    const r = await pruneOldRecords();
    expect(h.calls).toContain("obj:exports/BG-001-1.xlsx");
    expect(h.calls).toContain("obj:exports/BG-002-2.pdf");
    expect(h.calls).not.toContain("obj:exports/BG-003-3.xlsx");
    expect(r.exports).toBe(2);
  });

  it("CHỈ liệt kê tiền tố exports/ — không được rà cả bucket (logos/, uploads/, chứng từ...)", async () => {
    await pruneOldRecords();
    expect(h.calls.filter((c) => c.startsWith("list:"))).toEqual(["list:exports/"]);
  });

  it("chưa cấu hình kho object thì bỏ qua êm, không ném lỗi", async () => {
    h.storageOn = false;
    h.objects = [{ key: "exports/x.xlsx", lastModified: daysAgo(999) }];
    const r = await pruneOldRecords();
    expect(h.calls.some((c) => c.startsWith("list:"))).toBe(false);
    expect(r.exports).toBe(0);
  });
});

describe("pruneOldRecords — dọn object tạm của phiên tải lên bỏ dở", () => {
  it("xoá object staging TRƯỚC khi xoá hàng CSDL (xoá hàng trước là mất manh mối vĩnh viễn)", async () => {
    h.pendingRows = [{ key: "uploads/u1.png", stagingKey: "staging/u1.png" }];
    const r = await pruneOldRecords();
    const iObj = h.calls.indexOf("obj:staging/u1.png");
    const iDb = h.calls.indexOf("db:delete:pending");
    expect(iObj).toBeGreaterThanOrEqual(0);
    expect(iDb).toBeGreaterThanOrEqual(0);
    expect(iObj).toBeLessThan(iDb);
    expect(r.staleUploads).toBe(1);
  });

  it("KHÔNG đụng tới khoá cuối (key) của hàng pending — /finalize có thể vừa ghi file thật vào đó", async () => {
    h.pendingRows = [{ key: "uploads/u1.png", stagingKey: "staging/u1.png" }];
    await pruneOldRecords();
    expect(h.calls).not.toContain("obj:uploads/u1.png");
  });

  it("hàng rejected cũng được dọn object tạm (nhánh reject của /finalize có thể xoá hụt)", async () => {
    h.rejectedRows = [{ key: "uploads/r1.png", stagingKey: "staging/r1.png" }];
    await pruneOldRecords();
    expect(h.calls).toContain("obj:staging/r1.png");
  });

  it("một object xoá lỗi KHÔNG được làm hỏng cả lượt prune", async () => {
    h.pendingRows = [{ key: "uploads/u1.png", stagingKey: "staging/boom" }];
    h.failKeys = ["staging/boom"];
    h.objects = [{ key: "exports/old.xlsx", lastModified: daysAgo(400) }];
    h.failKeys.push("exports/old.xlsx");
    await expect(pruneOldRecords()).resolves.toBeTruthy();
    expect(h.calls).toContain("db:delete:pending");
  });
});
