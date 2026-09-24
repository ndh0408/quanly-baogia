/** @vitest-environment jsdom */
//
// Soát chéo excel#9 — XLSX-11 sửa ngày mặc định ở QuoteEditor (#/rnew) nhưng bỏ sót wizard
// "Tạo báo giá" (#/new), đường tạo mới CHÍNH. Wizard điền sẵn `new Date().toISOString().slice(0,10)`
// — ngày UTC — và LUÔN gửi quoteDate trong draft, nên homNayVN() của máy chủ không bao giờ chạy.
// Mở wizard lúc 06:30 giờ VN ngày 14/06 (23:30Z ngày 13/06) → ô Ngày hiện 13/06, Excel in "ngày 13
// tháng 06", PDF in 13/6: lùi một ngày.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("../lib/api", async (goc) => {
  const that = await goc<typeof import("../lib/api")>();
  return {
    ...that,
    api: {
      ...that.api,
      metaCompanies: vi.fn(async () => [{ id: 7, name: "Gia Nguyễn", address: "HCM" }]),
      metaTemplates: vi.fn(async () => [{ id: 1, name: "Mẫu GN", companyId: 7, layout: {} }]),
      assignableUsers: vi.fn(async () => ({ data: [] })),
    },
  };
});

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { NewQuoteWizard } from "./NewQuoteWizard";

let root: Root | null = null;
// tsconfig web chỉ nạp kiểu vite/client (không có @types/node) — đọc process qua globalThis.
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
const tzGoc = env.TZ;
const cho = async (ms = 0) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
beforeEach(() => {
  // Máy người dùng ở giờ VN. Đặt cứng để bài không phụ thuộc múi giờ của máy chạy test.
  env.TZ = "Asia/Ho_Chi_Minh";
  // CHỈ giả Date: wizard và hàm `cho` còn cần setTimeout thật.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-06-13T23:30:00Z"));   // 06:30 sáng 14/06 giờ VN
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null; document.body.innerHTML = "";
  vi.useRealTimers();
  if (tzGoc === undefined) delete env.TZ; else env.TZ = tzGoc;
});

describe("excel#9 — ngày mặc định của wizard theo lịch VN", () => {
  it("06:30 sáng 14/06 giờ VN → ô Ngày điền sẵn 2026-06-14, không phải 2026-06-13 (ngày UTC)", async () => {
    const hop = document.createElement("div"); document.body.appendChild(hop);
    root = createRoot(hop);
    const me = { id: 1, username: "a", displayName: "A", role: "manager", permissions: ["quote:create"] };
    await act(async () => { root!.render(<NewQuoteWizard me={me} />); });
    await cho(10);
    const bam = async (el: Element) => { await act(async () => { (el as HTMLElement).click(); }); await cho(5); };
    await bam(hop.querySelector(".wizard-foot .btn-primary")!);          // bước 1 → 2
    await bam(hop.querySelector(".pick-card")!);                          // chọn mẫu
    await bam(hop.querySelector(".wizard-foot .btn-primary")!);          // bước 2 → 3
    const oNgay = hop.querySelector('input[type="date"]') as HTMLInputElement;
    expect(oNgay, "không thấy ô Ngày ở bước 3").toBeTruthy();
    expect(oNgay.value).toBe("2026-06-14");
  });
});
