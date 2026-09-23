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
  it("không rõ thực thể (payload lạ / bản Shell cũ) → làm tươi tất cả như trước", async () => {
    const spy = await mo();
    act(() => { window.dispatchEvent(new Event("realtime:changed")); });
    expect(khoa(spy as unknown as ReturnType<typeof vi.fn>)).toEqual(["*TẤT CẢ*"]);
  });
});
