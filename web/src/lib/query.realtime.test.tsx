/** @vitest-environment jsdom */
//
// FE-18: mọi sự kiện 'changed' của bất kỳ ai làm tươi TOÀN BỘ query → kế toán mở Hóa đơn thì mỗi lần
// Sales bấm Lưu là tải lại cả /quotes/projects, dù thứ đổi chỉ là một khách hàng. Payload {entity} có
// sẵn mà client bỏ qua.
import { describe, it, expect, vi, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RealtimeBridge } from "./query";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(() => { if (root) act(() => root!.unmount()); root = null; document.body.innerHTML = ""; });

async function mo() {
  const qc = new QueryClient();
  const spy = vi.spyOn(qc, "invalidateQueries");
  const hop = document.createElement("div"); document.body.appendChild(hop);
  root = createRoot(hop);
  await act(async () => { root!.render(<QueryClientProvider client={qc}><RealtimeBridge /></QueryClientProvider>); });
  return spy;
}
const khoa = (spy: ReturnType<typeof vi.fn>) => spy.mock.calls.map((c) => (c[0] as { queryKey?: string[] } | undefined)?.queryKey?.[0] ?? "*TẤT CẢ*");

describe("FE-18 — RealtimeBridge làm tươi theo thực thể", () => {
  it("entity=customer → chỉ các khoá liên quan khách hàng; KHÔNG làm tươi tất cả, KHÔNG đụng nhân sự", async () => {
    const spy = await mo();
    act(() => { window.dispatchEvent(new CustomEvent("realtime:changed", { detail: { entity: "customer", action: "update" } })); });
    const ds = khoa(spy as unknown as ReturnType<typeof vi.fn>);
    expect(ds).toContain("customers");
    expect(ds).not.toContain("*TẤT CẢ*");
    expect(ds).not.toContain("personnel");
    expect(ds).not.toContain("employees");
  });
  // Soát chéo files#5 (hồi quy do FE-18): danh sách Nhân sự ghép cột "Tiền trước thuế" / tham chiếu dự án
  // từ báo giá đã chốt (personnelService.listPersonnel → buildProjectRef). Trước FE-18 mọi 'changed' làm
  // tươi tất cả nên trang Nhân sự đang mở tự cập nhật khi Sales lưu/chốt/bỏ chốt/xoá báo giá; bản FE-18
  // bỏ "personnel" khỏi entity=quote nên HR nhìn số cũ tới khi tự F5.
  it("entity=quote → làm tươi cả danh sách Nhân sự (cột tham chiếu dự án đọc từ báo giá)", async () => {
    const spy = await mo();
    act(() => { window.dispatchEvent(new CustomEvent("realtime:changed", { detail: { entity: "quote", action: "update" } })); });
    const ds = khoa(spy as unknown as ReturnType<typeof vi.fn>);
    expect(ds).toContain("quotes");
    expect(ds).toContain("personnel");
    expect(ds).not.toContain("*TẤT CẢ*");
  });
  // Ghi chú + màu ở dòng Danh sách báo giá có thực thể RIÊNG. Gộp vào "quote" thì mỗi lần ai đó gõ một dòng
  // ghi chú là kế toán đang mở Hóa đơn tải lại cả /quotes/projects (≤2000 báo giá) và Dashboard chạy lại 4 lệnh.
  it("entity=quoteNote → CHỈ làm tươi danh sách báo giá + số đếm bộ lọc của nó, không đụng /quotes/projects, Dashboard, Nhân sự", async () => {
    const spy = await mo();
    act(() => { window.dispatchEvent(new CustomEvent("realtime:changed", { detail: { entity: "quoteNote", action: "upsert" } })); });
    // Số đếm "Có ghi chú / Chưa có / từng màu" của bộ lọc (quoteFacets) đổi theo từng dòng ghi chú — không làm tươi thì hiện số cũ.
    expect(khoa(spy as unknown as ReturnType<typeof vi.fn>)).toEqual(["quotes", "quoteFacets"]);
  });
  it("số đếm bộ lọc (quoteFacets) đi cùng danh sách báo giá ở MỌI thực thể làm đổi danh sách đó (quote, customer, user)", async () => {
    for (const entity of ["quote", "customer", "user"]) {
      const spy = await mo();
      act(() => { window.dispatchEvent(new CustomEvent("realtime:changed", { detail: { entity, action: "update" } })); });
      const ds = khoa(spy as unknown as ReturnType<typeof vi.fn>);
      expect(ds, entity).toContain("quotes");
      expect(ds, entity).toContain("quoteFacets");
      act(() => root!.unmount()); root = null;   // gỡ cầu nối của vòng này trước khi dựng vòng sau (khỏi nghe chồng sự kiện)
    }
  });
  it("không rõ thực thể (payload lạ / bản Shell cũ) → làm tươi tất cả như trước", async () => {
    const spy = await mo();
    act(() => { window.dispatchEvent(new Event("realtime:changed")); });
    expect(khoa(spy as unknown as ReturnType<typeof vi.fn>)).toEqual(["*TẤT CẢ*"]);
  });
});
