/** @vitest-environment jsdom */
//
// FE-03: POST /mfa/setup sinh secret MỚI mỗi lần gọi. Đặt nó trong useQuery thì mỗi sự kiện SSE
// 'changed' của bất kỳ ai (RealtimeBridge → invalidateQueries() không lọc) gọi lại → QR đổi giữa lúc
// người dùng đang quét, "Xác nhận bật" gửi secret mới kèm mã của secret cũ. Mở hộp = đúng MỘT lần gọi.
// Dựng đủ QueryClientProvider + RealtimeBridge THẬT như App, để bài kiểm đi đúng đường sự kiện.
import { describe, it, expect, vi, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("../lib/api", async (goc) => {
  const that = await goc<typeof import("../lib/api")>();
  let n = 0;
  return { ...that, api: { ...that.api, mfaSetup: vi.fn(async () => { n++; return { qr: "data:image/png;base64,AAAA", secret: "SECRET" + n }; }) } };
});

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { ProfilePage } from "./Profile";
import { RealtimeBridge } from "../lib/query";
import { api } from "../lib/api";

let root: Root | null = null;
const cho = async (ms = 0) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
afterEach(() => { if (root) act(() => root!.unmount()); root = null; document.body.innerHTML = ""; });

describe("FE-03 — bật MFA", () => {
  it("sự kiện realtime:changed trong lúc đang quét QR KHÔNG tạo lại secret", async () => {
    const hop = document.createElement("div"); document.body.appendChild(hop);
    root = createRoot(hop);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const me = { id: 1, username: "a", displayName: "A", role: "admin", permissions: [], mfaEnabled: false };
    await act(async () => { root!.render(<QueryClientProvider client={qc}><RealtimeBridge /><ProfilePage me={me} onMe={() => {}} /></QueryClientProvider>); });
    const nut = [...hop.querySelectorAll("button")].find((b) => b.textContent === "Bật bảo mật 2 lớp")!;
    await act(async () => { nut.click(); });
    await cho(10);
    expect(api.mfaSetup).toHaveBeenCalledTimes(1);
    const khoaDau = hop.textContent?.match(/SECRET\d+/)?.[0];
    await act(async () => { window.dispatchEvent(new Event("realtime:changed")); });
    await cho(900);
    await act(async () => { window.dispatchEvent(new Event("realtime:changed")); });
    await cho(10);
    expect(api.mfaSetup).toHaveBeenCalledTimes(1);
    expect(hop.textContent?.match(/SECRET\d+/)?.[0]).toBe(khoaDau);
  });
});
