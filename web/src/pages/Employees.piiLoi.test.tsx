/** @vitest-environment jsdom */
/**
 * Hồi quy do gộp FILE-12 × RBAC-04 (soát chéo 2026-09-23, P1). Hàng Danh bạ có bản mã PII hỏng tới
 * giao diện với CCCD/STK = null + cờ `piiLoi`. Mở form Sửa rồi bấm Lưu từng xoá mất bản mã (máy chủ
 * nay chặn 409 — tests/dm-danh-ba-pii-hong-khong-ghi-de.test.js). Form phải CHỈ XEM kèm cảnh báo,
 * không có nút Lưu, để không ai gửi hai ô trống đó lên.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";

const updateEmployee = vi.fn(async () => ({}));
vi.mock("../lib/api", () => {
  class ApiError extends Error {}
  return { ApiError, api: { updateEmployee: (...a: unknown[]) => (updateEmployee as (...x: unknown[]) => Promise<unknown>)(...a) } };
});
vi.mock("../lib/ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/ui")>()),
  toast: () => {},
  confirmModal: async () => true,
  fieldErrorsFrom: () => ({}),
}));

import { EmployeeForm } from "./Employees";

let thung: HTMLDivElement;
let goc: Root;
beforeEach(() => {
  updateEmployee.mockClear();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  thung = document.createElement("div");
  document.body.appendChild(thung);
  goc = createRoot(thung);
});
afterEach(() => { act(() => goc.unmount()); thung.remove(); });

const dung = async (rec: Record<string, unknown>) => {
  await act(async () => { goc.render(<EmployeeForm rec={rec as never} readOnly={false} onClose={() => {}} onSaved={() => {}} />); });
};
const nutLuu = () => [...document.querySelectorAll("button")].find((b) => /Lưu|Thêm/.test(b.textContent || ""));

describe("Danh bạ — hồ sơ có bản mã PII hỏng", () => {
  it("piiLoi → cảnh báo, mọi ô khoá, KHÔNG có nút Lưu dù người dùng có quyền sửa", async () => {
    await dung({ id: 7, createdById: 1, fullName: "Nguyễn Văn B", idCard: null, bankAccount: null, piiLoi: true });
    expect(document.querySelector('[data-testid="pii-loi"]')).not.toBeNull();
    const o = [...document.querySelectorAll<HTMLInputElement>(".modal-body input, .modal-body textarea")];
    expect(o.length).toBeGreaterThan(0);
    expect(o.every((x) => x.disabled), "còn ô sửa được").toBe(true);
    expect(nutLuu(), "còn nút Lưu").toBeUndefined();
    expect(document.getElementById("ef-title")?.textContent).toBe("Xem nhân viên");
  });

  it("hồ sơ bình thường vẫn sửa được như cũ", async () => {
    await dung({ id: 8, createdById: 1, fullName: "Trần Thị C", idCard: "079123456789", bankAccount: "0123" });
    expect(document.querySelector('[data-testid="pii-loi"]')).toBeNull();
    expect(nutLuu()).toBeDefined();
    expect(document.getElementById("ef-title")?.textContent).toBe("Sửa nhân viên");
  });
});
