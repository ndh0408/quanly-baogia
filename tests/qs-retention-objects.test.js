// Cụm queue-storage — retention phải dọn cả OBJECT trong kho, không chỉ hàng trong CSDL
// (src/retention.ts + src/storage.ts).
//
// LỖI 1 — file xuất ra KHÔNG BAO GIỜ bị dọn (exports-objects-never-pruned).
//   Tái hiện: src/worker.ts ghi `exports/<số báo giá>-<Date.now()>.xlsx|pdf` — khoá kèm timestamp
//   nên MỖI lượt xuất đẻ một object MỚI, không ghi đè. Toàn bộ src/ không có một lệnh xoá nào cho
//   tiền tố `exports/`.
//   NHƯNG: bật dọn mặc định là XOÁ VĨNH VIỄN dữ liệu production trong lượt chạy ĐẦU TIÊN, và bản
//   rà soát đã chứng minh (a) lý do "cứu tarball off-host" là SAI (`mc mirror` cộng dồn, không
//   --remove → bản gương không hề nhỏ đi) và (b) xoá khỏi bucket làm chết cổng đối chiếu số lượng
//   ở scripts/backup/backup-objects.sh (LOCAL_N sẽ vĩnh viễn > REMOTE_N). Nên việc dọn phải
//   TẮT MẶC ĐỊNH, chỉ bật khi người vận hành đặt RETAIN_EXPORT_DAYS.
//
// LỖI 2 — quét exports/ theo CỬA SỔ CỐ ĐỊNH thì phần ĐUÔI không bao giờ tới lượt.
//   ListObjectsV2 trả khoá theo thứ tự TỰ VỰNG. Khoá là `exports/<prefix công ty><năm><số>` nên
//   một công ty đông việc chiếm trọn 10.000 khoá đầu → mọi tiền tố xếp sau KHÔNG BAO GIỜ được rà,
//   kể cả file 5 năm tuổi. Phải phân trang bằng StartAfter, không phải cắt cụt rồi hẹn "lượt sau".
//
// LỖI 3 — object tạm của phiên tải lên bỏ dở nằm lại VĨNH VIỄN
//   (orphan-staging-objects-never-deleted) + hai lỗi kèm theo:
//     · `findMany` KHÔNG có `take` → nạp toàn bộ hàng quá hạn vào RAM tiến trình worker.
//     · `deleteMany` xoá RỘNG HƠN tập vừa dọn object → hàng thứ 5.001 trở đi mất manh mối stagingKey.
//     · Chưa cấu hình kho thì vẫn nạp hàng và vẫn đếm "đã xoá object" — con số bịa.
//
// AN TOÀN: bài test này KHÔNG cần Postgres/MinIO — nó thay ./db.js và ./storage.js bằng bản giả để
// soi đúng chuỗi lệnh mà pruneOldRecords phát ra.
import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  calls: [],                 // nhật ký thứ tự lệnh — chứng minh XOÁ OBJECT TRƯỚC khi xoá hàng DB
  findManyArgs: [],          // đối số thật của mọi lượt findMany (để kiểm `take`)
  deleteManyArgs: [],        // đối số thật của mọi lượt deleteMany (để kiểm phạm vi xoá)
  pendingRows: [],
  rejectedRows: [],
  objects: [],
  storageOn: true,
  failKeys: [],              // khoá cố tình cho xoá lỗi (giả lập S3 chập chờn)
}));

vi.mock("../src/db.js", () => ({
  prisma: {
    auditEvent: { deleteMany: async () => ({ count: 0 }) },
    loginAttempt: { deleteMany: async () => ({ count: 0 }) },
    webhookDelivery: { deleteMany: async () => ({ count: 0 }) },
    uploadObject: {
      findMany: async (args) => {
        h.findManyArgs.push(args);
        h.calls.push(`db:find:${args.where.status}`);
        const rows = args.where.status === "pending" ? h.pendingRows : h.rejectedRows;
        return args.take != null ? rows.slice(0, args.take) : rows;
      },
      deleteMany: async (args) => {
        h.deleteManyArgs.push(args);
        h.calls.push(`db:delete:${args.where.status}`);
        const rows = args.where.status === "pending" ? h.pendingRows : h.rejectedRows;
        const ids = args.where.id?.in;
        return { count: ids ? ids.length : rows.length };
      },
    },
    $executeRawUnsafe: async () => 0,
  },
}));

vi.mock("../src/storage.js", () => ({
  isStorageEnabled: () => h.storageOn,
  listObjects: async (prefix, opts = {}) => {
    h.calls.push(`list:${prefix}${opts.startAfter ? `@${opts.startAfter}` : ""}`);
    const all = h.objects
      .filter((o) => o.key.startsWith(prefix))
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    const rest = opts.startAfter ? all.filter((o) => o.key > opts.startAfter) : all;
    return rest.slice(0, opts.maxKeys ?? 10_000);
  },
  deleteObject: async (key) => {
    h.calls.push(`obj:${key}`);
    if (h.failKeys.includes(key)) throw new Error("S3 down");
  },
}));

const daysAgo = (n) => new Date(Date.now() - n * 86_400_000);

/**
 * Nạp LẠI src/retention.ts với biến môi trường mong muốn.
 * Module đọc env một lần lúc nạp, nên đổi env sau khi import là vô nghĩa.
 */
async function loadPrune(env = {}) {
  const keys = { RETAIN_EXPORT_DAYS: undefined, ...env };
  for (const [k, v] of Object.entries(keys)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = String(v);
  }
  vi.resetModules();
  return (await import("../src/retention.js")).pruneOldRecords;
}

beforeEach(() => {
  h.calls = [];
  h.findManyArgs = [];
  h.deleteManyArgs = [];
  h.pendingRows = [];
  h.rejectedRows = [];
  h.objects = [];
  h.storageOn = true;
  h.failKeys = [];
});

describe("pruneOldRecords — dọn file xuất quá hạn CHỈ KHI được bật rõ ràng", () => {
  it("MẶC ĐỊNH (không đặt RETAIN_EXPORT_DAYS): KHÔNG rà, KHÔNG xoá một object nào", async () => {
    // Xoá object là thao tác KHÔNG HOÀN TÁC ĐƯỢC, và cổng kiểm bản gương ở backup-objects.sh
    // hiện chưa chịu được việc bucket nhỏ đi. Mặc định phải là "không đụng gì".
    const prune = await loadPrune();
    h.objects = [{ key: "exports/BG-001-1.xlsx", lastModified: daysAgo(999) }];
    const r = await prune();
    expect(h.calls.some((c) => c.startsWith("list:"))).toBe(false);
    expect(h.calls.some((c) => c.startsWith("obj:exports/"))).toBe(false);
    expect(r.exports).toBe(0);
  });

  it("RETAIN_EXPORT_DAYS=0 cũng là TẮT (không phải 'xoá tất')", async () => {
    const prune = await loadPrune({ RETAIN_EXPORT_DAYS: 0 });
    h.objects = [{ key: "exports/BG-001-1.xlsx", lastModified: daysAgo(999) }];
    const r = await prune();
    expect(h.calls.some((c) => c.startsWith("obj:"))).toBe(false);
    expect(r.exports).toBe(0);
  });

  it("bật rồi thì xoá object exports/ cũ hơn ngưỡng, GIỮ object mới", async () => {
    const prune = await loadPrune({ RETAIN_EXPORT_DAYS: 30 });
    h.objects = [
      { key: "exports/BG-001-1.xlsx", lastModified: daysAgo(120) },
      { key: "exports/BG-002-2.pdf", lastModified: daysAgo(31) },
      { key: "exports/BG-003-3.xlsx", lastModified: daysAgo(2) },
    ];
    const r = await prune();
    expect(h.calls).toContain("obj:exports/BG-001-1.xlsx");
    expect(h.calls).toContain("obj:exports/BG-002-2.pdf");
    expect(h.calls).not.toContain("obj:exports/BG-003-3.xlsx");
    expect(r.exports).toBe(2);
  });

  it("CHỈ liệt kê tiền tố exports/ — không được rà cả bucket (logos/, uploads/, chứng từ...)", async () => {
    const prune = await loadPrune({ RETAIN_EXPORT_DAYS: 30 });
    await prune();
    expect(h.calls.filter((c) => c.startsWith("list:")).every((c) => c.startsWith("list:exports/"))).toBe(true);
  });

  it("chưa cấu hình kho object thì bỏ qua êm, không ném lỗi", async () => {
    const prune = await loadPrune({ RETAIN_EXPORT_DAYS: 30 });
    h.storageOn = false;
    h.objects = [{ key: "exports/x.xlsx", lastModified: daysAgo(999) }];
    const r = await prune();
    expect(h.calls.some((c) => c.startsWith("list:"))).toBe(false);
    expect(r.exports).toBe(0);
  });

  it("file quá hạn nằm ở ĐUÔI dải tự vựng VẪN phải bị dọn (phân trang StartAfter)", async () => {
    // Kịch bản thật: một công ty đông việc chiếm trọn cửa sổ liệt kê đầu tiên bằng file MỚI.
    // Cắt cụt ở 10.000 khoá rồi hẹn "lượt sau dọn tiếp" là SAI — lượt sau lại bắt đầu từ đúng đầu
    // dải, nên file 5 năm tuổi của công ty có tiền tố xếp sau KHÔNG BAO GIỜ tới lượt.
    const prune = await loadPrune({ RETAIN_EXPORT_DAYS: 30 });
    h.objects = Array.from({ length: 10_001 }, (_, i) => ({
      key: `exports/AA-${String(i).padStart(6, "0")}.xlsx`,
      lastModified: daysAgo(1),
    }));
    h.objects.push({ key: "exports/ZZ-rat-cu.xlsx", lastModified: daysAgo(900) });
    const r = await prune();
    expect(h.calls).toContain("obj:exports/ZZ-rat-cu.xlsx");
    expect(r.exports).toBe(1);
  });
});

describe("pruneOldRecords — dọn object tạm của phiên tải lên bỏ dở", () => {
  it("xoá object staging TRƯỚC khi xoá hàng CSDL (xoá hàng trước là mất manh mối vĩnh viễn)", async () => {
    const prune = await loadPrune();
    h.pendingRows = [{ id: 1, key: "uploads/u1.png", stagingKey: "staging/u1.png" }];
    const r = await prune();
    const iObj = h.calls.indexOf("obj:staging/u1.png");
    const iDb = h.calls.indexOf("db:delete:pending");
    expect(iObj).toBeGreaterThanOrEqual(0);
    expect(iDb).toBeGreaterThanOrEqual(0);
    expect(iObj).toBeLessThan(iDb);
    expect(r.staleUploads).toBe(1);
  });

  it("KHÔNG đụng tới khoá cuối (key) của hàng pending — /finalize có thể vừa ghi file thật vào đó", async () => {
    const prune = await loadPrune();
    h.pendingRows = [{ id: 1, key: "uploads/u1.png", stagingKey: "staging/u1.png" }];
    await prune();
    expect(h.calls).not.toContain("obj:uploads/u1.png");
  });

  it("hàng rejected cũng được dọn object tạm (nhánh reject của /finalize có thể xoá hụt)", async () => {
    const prune = await loadPrune();
    h.rejectedRows = [{ id: 7, key: "uploads/r1.png", stagingKey: "staging/r1.png" }];
    await prune();
    expect(h.calls).toContain("obj:staging/r1.png");
  });

  it("một object xoá lỗi KHÔNG được làm hỏng cả lượt prune", async () => {
    const prune = await loadPrune({ RETAIN_EXPORT_DAYS: 30 });
    h.pendingRows = [{ id: 1, key: "uploads/u1.png", stagingKey: "staging/boom" }];
    h.failKeys = ["staging/boom", "exports/old.xlsx"];
    h.objects = [{ key: "exports/old.xlsx", lastModified: daysAgo(400) }];
    await expect(prune()).resolves.toBeTruthy();
    expect(h.calls).toContain("db:delete:pending");
  });

  it("findMany phải CÓ TRẦN (`take`) — không nạp toàn bộ hàng quá hạn vào RAM worker", async () => {
    const prune = await loadPrune();
    h.pendingRows = [{ id: 1, key: "uploads/u1.png", stagingKey: "staging/u1.png" }];
    await prune();
    expect(h.findManyArgs.length).toBeGreaterThan(0);
    for (const a of h.findManyArgs) {
      expect(typeof a.take, JSON.stringify(a.where)).toBe("number");
      expect(a.take).toBeGreaterThan(0);
      expect(a.take).toBeLessThanOrEqual(10_000);
    }
  });

  it("deleteMany chỉ được xoá ĐÚNG những hàng vừa dọn xong object (giới hạn theo id)", async () => {
    // Nếu findMany có trần mà deleteMany thì không, hàng thứ take+1 trở đi bị xoá khi object tạm
    // của nó CHƯA hề bị dọn — mất manh mối stagingKey vĩnh viễn, đúng lỗi mà bản vá này chống.
    const prune = await loadPrune();
    h.pendingRows = [{ id: 11, key: "uploads/a", stagingKey: "staging/a" }];
    h.rejectedRows = [{ id: 22, key: "uploads/b", stagingKey: "staging/b" }];
    await prune();
    expect(h.deleteManyArgs.length).toBe(2);
    for (const a of h.deleteManyArgs) {
      expect(Array.isArray(a.where.id?.in), JSON.stringify(a.where)).toBe(true);
      // Điều kiện trạng thái phải GIỮ NGUYÊN: giữa findMany và deleteMany một hàng pending có thể
      // vừa được /finalize chuyển trạng thái — xoá theo mỗi id là xoá nhầm hàng đã dùng được.
      expect(a.where.status).toBeTruthy();
    }
    expect(h.deleteManyArgs[0].where.id.in).toEqual([11]);
    expect(h.deleteManyArgs[1].where.id.in).toEqual([22]);
  });

  it("chưa cấu hình kho: KHÔNG nạp hàng, KHÔNG đếm object 'đã xoá' (số bịa), vẫn dọn hàng CSDL", async () => {
    const prune = await loadPrune();
    h.storageOn = false;
    h.pendingRows = [{ id: 1, key: "uploads/u1.png", stagingKey: "staging/u1.png" }];
    h.rejectedRows = [{ id: 2, key: "uploads/r1.png", stagingKey: "staging/r1.png" }];
    const r = await prune();
    expect(h.calls.some((c) => c.startsWith("db:find:"))).toBe(false);
    expect(h.calls.some((c) => c.startsWith("obj:"))).toBe(false);
    expect(r.staleObjects).toBe(0);
    expect(h.calls).toContain("db:delete:pending");
    expect(h.calls).toContain("db:delete:rejected");
  });
});
