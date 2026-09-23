/**
 * ============================================================================
 * CỤM xn — TRẦN KÍCH THƯỚC XUẤT FILE PHẢI KỊP TRONG TRẦN THỜI GIAN CỦA CHÍNH NÓ.
 *
 * ── SỐ ĐO (container quanly-app trên VM thật, `buildQuoteBuffer`, template gn_banner) ──
 *     20.000 dòng →  7,6s →  9,5 MB      ← trần đường ĐỒNG BỘ
 *     40.000 dòng → 15,0s → 19,3 MB
 *     60.000 dòng → 23,0s → 29,0 MB      ← trần đường NỀN (sức chứa schema lưu)
 *
 * ── MỘT LẦN SỬA SAI, GIỮ LẠI VÌ NÓ DẠY ĐÚNG CHỖ ───────────────────────────
 * 23,0s LỌT trần 30s, nhưng chỉ dư 23% — không đủ cho một VM bận hơn. Phản xạ đầu tiên là HẠ trần
 * kích thước xuống 40.000 cho dư 100%. SAI, và ba cụm test có sẵn (b1/b2/b9) bắt ngay:
 *
 *     "trần đường nền ≥ sức chứa đường lưu — nếu không, 413 đang chỉ vào ngõ cụt"
 *
 * Đường đồng bộ trả 413 kèm đúng lời khuyên "dùng xuất nền". Hạ trần đường nền là bịt nốt lối
 * thoát đó — và báo giá CŨ lớn hơn 40.000 mất luôn mọi đường lấy dữ liệu ra. Nhốt người dùng lại
 * với chính dữ liệu của họ: đúng cái bẫy mà khối "ĐÃ GỠ. ĐỪNG ĐẶT LẠI" trong validators.ts ghi lại.
 *
 * Cách đúng: nới THỜI GIAN cho riêng đường NỀN. Ở đó không có request HTTP nào đang treo — job
 * nằm trong hàng đợi, người dùng hỏi trạng thái khi nào cũng được. Nới ở chỗ không ai chờ là chỗ
 * trả giá rẻ nhất.
 * ============================================================================
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { MAX_ASYNC_EXPORT_ITEMS, MAX_EXPORT_ITEMS, MAX_SAVE_SHEETS, MAX_SAVE_ITEMS_PER_SHEET } from "../src/validators.js";
import { EXPORT_GEN_TIMEOUT_MS, EXPORT_GEN_TIMEOUT_NEN_MS } from "../src/exportQueue.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const doc = (p) => readFileSync(join(ROOT, p), "utf8");

/** Ba mốc ĐO ĐƯỢC trên VM. Quan hệ gần như tuyến tính (~2,6 dòng/ms). */
const MOC = [
  [20_000, 7.6],
  [40_000, 15.0],
  [60_000, 23.0],
];
/** Ước giây từ mốc LỚN NHẤT (bi quan hơn mốc nhỏ, vì có phần chi phí cố định). */
const uocGiay = (soDong) => (soDong / MOC[MOC.length - 1][0]) * MOC[MOC.length - 1][1];

describe("Trần kích thước phải nằm trong trần thời gian tương ứng", () => {
  it("phép nội suy dùng ở đây khớp ba mốc đo — nếu không thì mọi kết luận dưới đây vô nghĩa", () => {
    for (const [dong, giay] of MOC) {
      expect(Math.abs(uocGiay(dong) - giay), `mốc ${dong} lệch quá xa đường tuyến tính`).toBeLessThan(1.2);
    }
  });

  it("đường ĐỒNG BỘ: trần 20.000 dòng kịp thoải mái trong 30s", () => {
    // Có một request HTTP đang treo, nên ở đây chật là người dùng ngồi nhìn màn hình.
    const giay = uocGiay(MAX_EXPORT_ITEMS);
    expect(giay, `${MAX_EXPORT_ITEMS} dòng ≈ ${giay.toFixed(1)}s`).toBeLessThan(EXPORT_GEN_TIMEOUT_MS / 1000 / 3);
  });

  it("đường NỀN: trần 60.000 dòng có ÍT NHẤT 3× biên trong trần riêng của nó", () => {
    const giay = uocGiay(MAX_ASYNC_EXPORT_ITEMS);
    const tran = EXPORT_GEN_TIMEOUT_NEN_MS / 1000;
    expect(giay, `${MAX_ASYNC_EXPORT_ITEMS} dòng ≈ ${giay.toFixed(1)}s, trần nền ${tran}s — không đủ biên`)
      .toBeLessThan(tran / 3);
  });

  it("trần nền PHẢI dài hơn trần đồng bộ — nếu bằng thì việc tách ra là vô nghĩa", () => {
    // 23,0s trong trần 30s dùng chung chính là tình trạng CŨ: lọt, nhưng dư 23%.
    expect(EXPORT_GEN_TIMEOUT_NEN_MS).toBeGreaterThan(EXPORT_GEN_TIMEOUT_MS);
    const giayNen = uocGiay(MAX_ASYNC_EXPORT_ITEMS);
    expect(giayNen / (EXPORT_GEN_TIMEOUT_MS / 1000), "trần nền dùng chung 30s thì biên chỉ còn ~23%")
      .toBeGreaterThan(0.7);
  });

  it("đường nền vẫn phủ TRỌN sức chứa schema lưu — không được bịt lối thoát của 413", () => {
    // Bất biến này do b1/b2/b9 khoá. Lặp lại ở đây kèm LÝ DO, để lần sau ai định hạ hằng số vì
    // "cho đủ biên thời gian" thì đọc được ngay rằng đã có người thử và đã sai.
    expect(MAX_ASYNC_EXPORT_ITEMS).toBe(MAX_SAVE_SHEETS * MAX_SAVE_ITEMS_PER_SHEET);
  });

  it("chỉ ĐƯỜNG NỀN dùng trần dài — đường đồng bộ KHÔNG được thừa hưởng", () => {
    // Nếu `runExportJob` mặc định lấy trần nền thì một request HTTP có thể treo 90 giây.
    const src = doc("src/exportQueue.ts");
    expect(src, "mặc định của runExportJob phải là trần ĐỒNG BỘ").toMatch(/timeoutMs = EXPORT_GEN_TIMEOUT_MS/);
    expect(doc("src/worker.ts"), "worker phải truyền trần NỀN vào một cách tường minh")
      .toMatch(/timeoutMs:\s*EXPORT_GEN_TIMEOUT_NEN_MS/);
  });
});

describe("Ân hạn dừng phải BAO ĐƯỢC trần sinh file của đường nền", () => {
  // Job bị cắt ngang giữa chừng thì BullMQ giữ khoá tới hết `lockDuration` (5 phút, src/queue.ts)
  // mới cho chạy lại — người dùng thấy bản xuất đứng im suốt lượt deploy. Đó đúng là thứ ân hạn
  // này sinh ra để tránh, nên nó phải lớn hơn trần sinh file, không phải bằng.
  const NGUON = {
    "docker-compose.prod.yml": /stop_grace_period:\s*(\d+)s/,
    "docker-compose.staging.yml": /stop_grace_period:\s*(\d+)s/,
    "infra/k8s/worker.yaml": /terminationGracePeriodSeconds:\s*(\d+)/,
    "infra/helm/quanly/values.yaml": /terminationGracePeriodSeconds:\s*(\d+)/,
  };

  // Compose: CẮT về đúng service `worker` trước khi dò. Bản trước dò `stop_grace_period` đầu tiên
  // của CẢ tệp — đúng chừng nào chỉ worker khai nó. Từ HTTP-08 service app cũng khai (75s, ân hạn
  // tắt tiến trình WEB), và nó đứng trước worker trong tệp.
  const phamVi = (f, t) => (f.startsWith("docker-compose") ? t.slice(t.indexOf("\n  worker:")) : t);
  const doc2 = (f) => {
    const m = NGUON[f].exec(phamVi(f, doc(f)));
    if (!m) throw new Error(`${f}: không đọc được ân hạn dừng`);
    return Number(m[1]);
  };

  it("cả BA đường triển khai khai CÙNG một con số", () => {
    // Lệch nhau thì bản vá chỉ dời chỗ hỏng sang đường khác — và đường k8s/Helm là đường không ai
    // nhìn cho tới lúc chuyển sang dùng nó.
    const gia = Object.keys(NGUON).map(doc2);
    expect(new Set(gia).size, `ba đường lệch nhau: ${Object.keys(NGUON).map((f, i) => `${f}=${gia[i]}`).join(", ")}`).toBe(1);
  });

  it("ân hạn > trần sinh file của đường nền, còn chừa chỗ cho tải lên kho object + ghi CSDL", () => {
    const an = doc2("docker-compose.prod.yml");
    const tran = EXPORT_GEN_TIMEOUT_NEN_MS / 1000;
    expect(an, `ân hạn ${an}s ≤ trần sinh file ${tran}s → job bị cắt ngang, BullMQ khoá 5 phút`)
      .toBeGreaterThan(tran);
    expect(an - tran, "không còn chỗ cho tải lên kho object và ghi CSDL").toBeGreaterThanOrEqual(30);
  });
});
