/** @vitest-environment jsdom */
//
// FE-11: lần dò /auth/me lúc khởi động coi MỌI lỗi là "chưa đăng nhập". Mất mạng / 502 trong khung
// deploy → người đang có phiên hợp lệ thấy form đăng nhập, đăng nhập lại thì "Đăng nhập thất bại".
import { describe, it, expect, vi, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const h = vi.hoisted(() => ({ me: null as null | (() => Promise<unknown>) }));
vi.mock("./lib/api", async (goc) => {
  const that = await goc<typeof import("./lib/api")>();
  return { ...that, api: { ...that.api, me: () => h.me!() }, setPreviewMode: () => {} };
});
vi.mock("./components/Shell", () => ({ Shell: () => <div id="shell-gia" /> }));
vi.mock("./lib/authSync", () => ({ ngheAuth: () => () => {}, phatDangNhap: () => {} }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { App } from "./App";
import { ApiError } from "./lib/api";

let root: Root | null = null;
afterEach(() => { if (root) act(() => root!.unmount()); root = null; document.body.innerHTML = ""; });

async function mo() {
  const hop = document.createElement("div"); document.body.appendChild(hop);
  root = createRoot(hop);
  await act(async () => { root!.render(<App />); });
  await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  return hop;
}

describe("FE-11 — khởi động", () => {
  it("lỗi MẠNG (TypeError) → màn 'Không kết nối được' + nút Thử lại, KHÔNG hiện form đăng nhập", async () => {
    h.me = async () => { throw new TypeError("Failed to fetch"); };
    const hop = await mo();
    expect(hop.textContent).toContain("Không kết nối được máy chủ");
    expect([...hop.querySelectorAll("button")].some((b) => b.textContent === "Thử lại")).toBe(true);
    expect(hop.querySelector("input[type=password]")).toBeNull();
  });
  it("502 lúc deploy → cũng không phải màn đăng nhập", async () => {
    h.me = async () => { throw new ApiError("Lỗi 502", 502, null); };
    const hop = await mo();
    expect(hop.querySelector("input[type=password]")).toBeNull();
  });
  it("401 → màn đăng nhập như cũ", async () => {
    h.me = async () => { throw new ApiError("Chưa đăng nhập", 401, null); };
    const hop = await mo();
    expect(hop.querySelector("input[type=password]")).not.toBeNull();
  });
});
