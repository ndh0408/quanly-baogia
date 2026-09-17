/**
 * ============================================================================
 * CỔNG XUẤT FILE PHẢI ĐẾM DÒNG, KHÔNG CHỈ ĐẾM SUẤT.
 *
 * ── LỖ ─────────────────────────────────────────────────────────────────────
 * `EXPORT_MAX_ACTIVE` (mặc định 3) đếm SUẤT: một lượt xuất 1.000 dòng và một lượt 60.000 dòng tốn
 * suất NHƯ NHAU. Đường LƯU đã có cổng đếm trọng số từ lâu (`SAVE_BUDGET_ROWS`), và chính
 * src/saveBudget.ts:56 tự khai sự lệch này — nhưng đường XUẤT chưa được vá theo.
 *
 * ── ĐO THẬT, KHÔNG SUY ĐOÁN ────────────────────────────────────────────────
 * Ảnh production, container 3 GB / 2 CPU / heap 2 GB, trần sinh file nền 90s, qua ĐÚNG đường chạy
 * thật (`runExportJob` → worker_thread):
 *
 *     3 người cùng xuất 60.000 dòng, EXPORT_MAX_ACTIVE=3:
 *         #1 90,1s ✗ quá hạn · #2 90,1s ✗ · #3 90,2s ✗    → HỎNG 3/3, KHÔNG file nào
 *     CÙNG tải, EXPORT_MAX_ACTIVE=1:
 *         #1 74,4s ✓ · #2 151,0s ✓ · #3 226,8s ✓           → HỎNG 0/3
 *
 * Ba lượt tranh 2 CPU nên không lượt nào kịp trần: hệ thống đốt trọn 90 giây để trả về con số
 * không. Đây KHÔNG phải lỗi bộ nhớ — 3 × 416 MB vẫn lọt 3 GB — mà là lỗi THỜI GIAN, và cổng đếm
 * suất mù trước nó vì ba suất thì vẫn đúng là ba suất.
 *
 * Nhưng hạ EXPORT_MAX_ACTIVE xuống 1 là bắt lượt 1.000 dòng (0,9s) xếp sau lượt 60.000 dòng —
 * phạt số đông để chặn ca hiếm. Nên: GIỮ cổng suất, THÊM cổng ngân sách theo dòng.
 *
 * ── BÀI NÀY KHOÁ GÌ ────────────────────────────────────────────────────────
 * 1. Lượt LỚN thứ hai bị chặn khi ngân sách đã cạn — và chặn bằng lỗi CỦA ĐƯỜNG XUẤT.
 * 2. Lượt NHỎ KHÔNG bị phạt (vế đối trọng: cổng mà chặn cả việc nhỏ thì tệ hơn không có cổng).
 * 3. Ngân sách và suất đều được TRẢ, không rò — rò thì cổng đứng im dù máy rảnh.
 * 4. Bất biến trần-một-lượt ≤ ngân sách, nếu không có báo giá hợp lệ mà KHÔNG BAO GIỜ xuất được.
 * ============================================================================
 */
import { describe, it, expect, afterEach, vi } from "vitest";

/** Nạp lại exportQueue với cấu hình cổng riêng cho từng bài. */
async function napCong({ active, pending, budget }) {
  process.env.EXPORT_MAX_ACTIVE = String(active);
  process.env.EXPORT_MAX_PENDING = String(pending);
  process.env.EXPORT_BUDGET_ROWS = String(budget);
  vi.resetModules();
  return import("../src/exportQueue.js");
}

/** Báo giá giả với đúng `n` dòng — chỉ cần đúng hình dạng mà `demDongXuat` đọc. */
const baoGia = (n) => ({
  sheets: [{ items: Array.from({ length: n }, (_, i) => ({ order: i + 1, name: `HM ${i}` })) }],
});

const MOI_TRUONG = { a: process.env.EXPORT_MAX_ACTIVE, p: process.env.EXPORT_MAX_PENDING, b: process.env.EXPORT_BUDGET_ROWS };
/** Trả biến môi trường về ĐÚNG trạng thái cũ. Gán thẳng `undefined` vào `process.env` sẽ đặt
 *  chuỗi "undefined", và zod coerce nó thành NaN → config `process.exit(1)` ngay ở câu import kế
 *  tiếp. Phải XOÁ khoá, không phải gán rỗng. */
const datLai = (ten, cu) => { if (cu === undefined) delete process.env[ten]; else process.env[ten] = cu; };
afterEach(() => {
  datLai("EXPORT_MAX_ACTIVE", MOI_TRUONG.a);
  datLai("EXPORT_MAX_PENDING", MOI_TRUONG.p);
  datLai("EXPORT_BUDGET_ROWS", MOI_TRUONG.b);
  vi.resetModules();
});

describe("demDongXuat — trọng số của một lượt xuất", () => {
  it("cộng dòng của MỌI trang", async () => {
    const eq = await napCong({ active: 3, pending: 20, budget: 60_000 });
    expect(eq.demDongXuat({ sheets: [{ items: [1, 2, 3] }, { items: [1, 2] }] })).toBe(5);
  });

  it("báo giá rỗng vẫn tốn 1 — trọng số 0 là vô hạn lượt lọt qua ngân sách", async () => {
    const eq = await napCong({ active: 3, pending: 20, budget: 60_000 });
    for (const x of [{}, null, undefined, { sheets: [] }, { sheets: [{}] }, { sheets: "rác" }]) {
      expect(eq.demDongXuat(x)).toBe(1);
    }
  });

  it("KHÔNG đếm bảng phụ — đường xuất `omit` chúng và file khách không có chúng", async () => {
    // Đếm thứ không ai dựng là tính phí một khối lượng tưởng tượng, và sẽ chặn oan.
    const eq = await napCong({ active: 3, pending: 20, budget: 60_000 });
    const q = { sheets: [{ items: [1, 2], extraTables: [{ items: [1, 2, 3, 4, 5] }] }], hnTables: [{ items: [1, 2, 3] }] };
    expect(eq.demDongXuat(q)).toBe(2);
  });
});

describe("Cổng ngân sách dòng cho đường xuất", () => {
  it("lượt LỚN thứ hai bị chặn khi ngân sách cạn, bằng lỗi CỦA ĐƯỜNG XUẤT", async () => {
    // Ngân sách 1.000 dòng (sàn cho phép của config), hàng chờ 0. Suất còn thừa (3) — nên nếu bài này xanh thì thứ chặn được
    // lượt thứ hai CHỈ có thể là ngân sách, không phải cổng suất.
    const eq = await napCong({ active: 3, pending: 0, budget: 1_000 });
    const noiTuyen1 = vi.fn(() => Buffer.from("PK\x03\x04đủ dài cho looksValid........"));
    const noiTuyen2 = vi.fn(() => Buffer.from("PK\x03\x04đủ dài cho looksValid........"));

    // CÙNG MỘT KHỐI ĐỒNG BỘ — xem chú thích trong tests/qs-export-gate-abort.test.js.
    const p1 = eq.runExportJob("xlsx", baoGia(1_000), noiTuyen1);
    const p2 = eq.runExportJob("xlsx", baoGia(1_000), noiTuyen2);
    const r1 = p1.then(() => "xong", (e) => e);

    // `export_capacity` chứ KHÔNG phải `save_budget_full`: mã sai sẽ không khớp `isCapacityError`
    // và lượt bị chặn rơi thẳng xuống đường NỘI TUYẾN — cổng bị chính đường dự phòng đi vòng qua.
    await expect(p2).rejects.toMatchObject({ status: 503, code: "export_capacity" });
    expect(noiTuyen2, "503 bị nuốt rồi chạy nội tuyến — cổng thành vô nghĩa").not.toHaveBeenCalled();
    await r1;
  }, 30_000);

  it("lượt NHỎ KHÔNG bị phạt — vẫn chạy song song", async () => {
    // Vế đối trọng. Nếu bài trên xanh mà bài này đỏ thì bản vá đã biến thành "xếp hàng tất",
    // đúng thứ phải tránh: 60.000 dòng là ca hiếm, 50 dòng là ca thường ngày.
    const eq = await napCong({ active: 3, pending: 0, budget: 10_000 });
    const fns = [vi.fn(), vi.fn(), vi.fn()].map(() => () => Buffer.from("PK\x03\x04đủ dài cho looksValid........"));
    const ps = fns.map((f) => eq.runExportJob("xlsx", baoGia(50), f).then(() => "xong", (e) => e));
    const kq = await Promise.all(ps);
    expect(kq, `có lượt nhỏ bị chặn: ${JSON.stringify(kq.map(String))}`).toEqual(["xong", "xong", "xong"]);
  }, 30_000);

  it("ngân sách và suất đều được TRẢ — không rò sau khi xong", async () => {
    const eq = await napCong({ active: 3, pending: 0, budget: 10_000 });
    await eq.runExportJob("xlsx", baoGia(500), () => Buffer.from("PK\x03\x04đủ dài cho looksValid........"))
      .catch(() => {});
    const t = eq.exportGateStats();
    expect(t.dongDangBay, "ngân sách rò — sau vài lượt cổng đứng im dù máy rảnh").toBe(0);
    expect(t.active, "suất rò").toBe(0);
    expect(t.nganSachDong).toBe(10_000);
  }, 30_000);

  it("ngân sách chặn thì SUẤT phải được trả lại", async () => {
    // Thứ tự xin là SUẤT trước, NGÂN SÁCH sau. Nhánh ngân sách hỏng mà quên trả suất là rò một
    // suất mỗi lượt bị chặn — cổng tự bóp chính nó cho tới khi khởi động lại.
    const eq = await napCong({ active: 3, pending: 0, budget: 1_000 });
    const buf = () => Buffer.from("PK\x03\x04đủ dài cho looksValid........");
    const p1 = eq.runExportJob("xlsx", baoGia(1_000), buf);
    const p2 = eq.runExportJob("xlsx", baoGia(1_000), buf);
    await Promise.allSettled([p1, p2]);
    expect(eq.exportGateStats().active, "suất bị rò ở nhánh ngân sách từ chối").toBe(0);
    expect(eq.exportGateStats().dongDangBay).toBe(0);
  }, 30_000);
});

describe("Bất biến cấu hình", () => {
  it("cấu hình ĐANG DÙNG thoả bất biến", async () => {
    // Cùng luật, cùng lý do như MAX_SAVE_TOTAL_ROWS ≤ SAVE_BUDGET_ROWS. Vi phạm nghĩa là người
    // dùng bấm Xuất và nhận 503 vĩnh viễn dù hệ thống hoàn toàn rảnh.
    datLai("EXPORT_BUDGET_ROWS", MOI_TRUONG.b);
    vi.resetModules();
    const { MAX_ASYNC_EXPORT_ITEMS, loiBatBienNganSachXuat } = await import("../src/validators.js");
    const { config } = await import("../src/config.js");
    expect(loiBatBienNganSachXuat(MAX_ASYNC_EXPORT_ITEMS, config.EXPORT_BUDGET_ROWS)).toBeNull();
  });

  it("phép kiểm THẬT SỰ bắt được cấu hình sai — và nêu tên CẢ HAI biến", async () => {
    // Vế đối trọng: một bất biến chỉ chạy trên cấu hình đúng thì không ai biết nó còn sống hay
    // đã thành mã chết. Gọi thẳng hàm thuần với con số vi phạm.
    vi.resetModules();
    const { loiBatBienNganSachXuat } = await import("../src/validators.js");
    const loi = loiBatBienNganSachXuat(60_000, 10_000);
    expect(loi, "cấu hình mâu thuẫn mà phép kiểm im lặng").toBeTruthy();
    expect(loi).toContain("MAX_ASYNC_EXPORT_ITEMS");
    expect(loi).toContain("EXPORT_BUDGET_ROWS");
    // Bằng nhau là HỢP LỆ — đúng một lượt lớn nhất chạy một mình, không được chặn.
    expect(loiBatBienNganSachXuat(60_000, 60_000)).toBeNull();
  });
});
