// Cụm retention — hàng UploadObject bị xoá NGAY CẢ KHI object tạm của nó xoá KHÔNG THÀNH CÔNG.
//
// ── LỖI (orphan-staging-objects-never-deleted, phần chưa đóng) ──────────────
// Thứ tự "xoá object trước, xoá hàng sau" (src/retention.ts) đúng và có chú thích giải thích rằng
// hàng UploadObject là MANH MỐI DUY NHẤT dẫn tới `stagingKey`. Nhưng vòng lặp cũ:
//     for (const u of rows) if (await dropObject(u.stagingKey)) staleObjects++;
//     await prisma.uploadObject.deleteMany({ where: { ...where, id: { in: rows.map(r => r.id) } } });
// `dropObject` NUỐT lỗi S3 và trả false — rồi deleteMany vẫn xoá TOÀN BỘ `rows`, kể cả những hàng
// vừa thất bại. Một lỗi S3 thoáng qua (MinIO restart, 503) là mất vĩnh viễn manh mối của mọi
// stagingKey trong lô đó: đúng thứ mà thứ tự trên sinh ra để chống.
//
// TÁI HIỆN: hai hàng pending, một hàng có object xoá lỗi → trước bản vá cả hai id đều nằm trong
// deleteMany.
import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  deleteManyArgs: [], pendingRows: [], rejectedRows: [], failKeys: [], storageOn: true,
}));

vi.mock("../src/db.js", () => ({
  prisma: {
    uploadObject: {
      findMany: async (args) => (args.where.status === "pending" ? h.pendingRows : h.rejectedRows),
      deleteMany: async (args) => {
        h.deleteManyArgs.push(args);
        const ids = args.where.id?.in;
        return { count: ids ? ids.length : 0 };
      },
    },
    $executeRawUnsafe: async () => 0,
  },
}));

vi.mock("../src/storage.js", () => ({
  isStorageEnabled: () => h.storageOn,
  listObjects: async () => [],
  deleteObject: async (key) => { if (h.failKeys.includes(key)) throw new Error("S3 down"); },
}));

async function loadPrune() {
  delete process.env.RETAIN_EXPORT_DAYS;
  vi.resetModules();
  return (await import("../src/retention.js")).pruneOldRecords;
}

beforeEach(() => {
  h.deleteManyArgs = []; h.pendingRows = []; h.rejectedRows = []; h.failKeys = []; h.storageOn = true;
});

const idsPending = () => h.deleteManyArgs.find((a) => a.where.status === "pending")?.where.id?.in;

describe("retention — hàng chỉ được xoá khi object tạm THẬT SỰ đã đi", () => {
  it("object xoá lỗi → GIỮ hàng lại cho lượt sau, xoá hàng còn lại", async () => {
    const prune = await loadPrune();
    h.pendingRows = [
      { id: 1, stagingKey: "staging/ok" },
      { id: 2, stagingKey: "staging/boom" },
    ];
    h.failKeys = ["staging/boom"];
    const r = await prune();
    expect(idsPending(), "hàng có object xoá hụt vẫn bị xoá → mất manh mối vĩnh viễn").toEqual([1]);
    expect(r.staleObjects).toBe(1);
    expect(r.staleUploads).toBe(1);
  });

  it("lượt sau (S3 đã khoẻ) dọn nốt hàng còn lại — không rác vĩnh viễn", async () => {
    const prune = await loadPrune();
    h.pendingRows = [{ id: 2, stagingKey: "staging/boom" }];
    h.failKeys = [];
    await prune();
    expect(idsPending()).toEqual([2]);
  });

  it("hàng KHÔNG có stagingKey vẫn phải dọn được (không có object nào để mất)", async () => {
    // Nếu chỉ giữ lại 'những hàng dropObject trả true' thì hàng stagingKey rỗng sẽ KHÔNG BAO GIỜ
    // bị xoá — một rò rỉ mới do chính bản vá đẻ ra. Phân biệt "xoá hụt" với "không có gì để xoá".
    const prune = await loadPrune();
    h.pendingRows = [{ id: 5, stagingKey: "" }, { id: 6, stagingKey: null }];
    const r = await prune();
    expect(idsPending()).toEqual([5, 6]);
    expect(r.staleObjects, "không xoá object nào thì không được đếm là đã xoá").toBe(0);
  });

  it("CẢ LÔ xoá hụt: vẫn gọi deleteMany nhưng không xoá hàng nào", async () => {
    const prune = await loadPrune();
    h.pendingRows = [{ id: 9, stagingKey: "staging/boom" }];
    h.failKeys = ["staging/boom"];
    const r = await prune();
    expect(idsPending()).toEqual([]);
    expect(r.staleUploads).toBe(0);
  });
});
