/** @vitest-environment jsdom */
//
// FE-15: bấm "Xem thử" trong modal Sửa nhân viên chuyển sang #/dashboard → trang gỡ → form đang sửa
// mất mà KHÔNG hỏi (Đóng / Esc / bấm nền thì có hỏi). Cùng khuôn giàn dựng với Users.senderName.test.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PermCatalog } from "../lib/api";

const NHAN_VIEN = {
  id: 7, username: "lan@gianguyen.vn", displayName: "Nguyễn Thị Lan", role: "manager", phone: "", projectCode: "FE_A",
  email: "lan@gianguyen.vn", senderName: "", active: true, pending: false, permissions: [], effectivePermissions: [],
};
const h = vi.hoisted(() => ({ confirm: false, confirmCalls: [] as string[] }));
vi.mock("../lib/api", () => {
  class ApiError extends Error { body: unknown; constructor(m: string, body?: unknown) { super(m); this.body = body; } }
  return {
    ApiError,
    api: {
      listUsers: async () => [NHAN_VIEN],
      permissionsCatalog: async (): Promise<PermCatalog> => ({ groups: [], editableRoles: [], adminOnlyPermissions: [], roles: [] }),
      updateUser: async () => NHAN_VIEN,
    },
  };
});
vi.mock("../lib/ui", () => ({
  toast: () => {},
  confirmModal: async (tieuDe: string) => { h.confirmCalls.push(tieuDe); return h.confirm; },
  fieldErrorsFrom: () => ({}),
  useEscClose: () => {},
}));

import { UsersPage } from "./Users";

let thung: HTMLDivElement;
let goc: Root;
beforeEach(() => {
  h.confirm = false; h.confirmCalls = [];
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  thung = document.createElement("div"); document.body.appendChild(thung); goc = createRoot(thung);
});
afterEach(() => { act(() => goc.unmount()); thung.remove(); document.body.innerHTML = ""; });

const timNut = (chu: RegExp) => [...document.querySelectorAll("button")].find((x) => chu.test(x.textContent?.trim() || ""));
async function choTa(xong: () => boolean) { for (let i = 0; i < 50 && !xong(); i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); }

async function moSua(onPreview: (p: string[], l: string) => void) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await act(async () => { goc.render(<QueryClientProvider client={qc}><UsersPage me={{ id: 1 } as never} onPreview={onPreview} /></QueryClientProvider>); });
  await choTa(() => !!timNut(/^Sửa$/));
  await act(async () => { timNut(/^Sửa$/)!.click(); });
  await choTa(() => !!timNut(/Xem thử app/));
}
function goTen(v: string) {
  const o = [...document.querySelectorAll("input")].find((i) => i.value === "Nguyễn Thị Lan") as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => { setter.call(o, v); o.dispatchEvent(new Event("input", { bubbles: true })); });
}

describe("FE-15 — Xem thử khi form Sửa nhân viên còn thay đổi", () => {
  it("form bẩn → hỏi trước; Hủy thì KHÔNG chuyển sang xem thử", async () => {
    const onPreview = vi.fn();
    await moSua(onPreview);
    goTen("Lan đã sửa");
    await act(async () => { timNut(/Xem thử app/)!.click(); });
    expect(h.confirmCalls).toContain("Bỏ thay đổi để xem thử?");
    expect(onPreview).not.toHaveBeenCalled();
  });
  it("form sạch → xem thử ngay, không hỏi", async () => {
    const onPreview = vi.fn();
    await moSua(onPreview);
    await act(async () => { timNut(/Xem thử app/)!.click(); });
    expect(h.confirmCalls).toEqual([]);
    expect(onPreview).toHaveBeenCalledTimes(1);
  });
});
