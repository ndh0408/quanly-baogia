/** @vitest-environment jsdom */
//
// FE-14: wizard bắt nhập tay "Khách hàng (To)" dù vừa chọn mã khách — thêm bước thừa cho việc chính
// hằng ngày. Chọn mã khách thì điền sẵn ô đó nếu còn trống; đã gõ sẵn thì KHÔNG đè.
import { describe, it, expect, vi, afterEach } from "vitest";
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
      listCustomers: vi.fn(async () => ({ data: [{ id: 3, code: "KH003", name: "Công ty ABC" }] })),
    },
  };
});

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { NewQuoteWizard } from "./NewQuoteWizard";

let root: Root | null = null;
const cho = async (ms = 0) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
afterEach(() => { if (root) act(() => root!.unmount()); root = null; document.body.innerHTML = ""; });

async function denBuoc3() {
  const hop = document.createElement("div"); document.body.appendChild(hop);
  root = createRoot(hop);
  const me = { id: 1, username: "a", displayName: "A", role: "manager", permissions: ["quote:create"] };
  await act(async () => { root!.render(<NewQuoteWizard me={me} />); });
  await cho(10);
  const bam = async (el: Element) => { await act(async () => { (el as HTMLElement).click(); }); await cho(5); };
  await bam(hop.querySelector(".wizard-foot .btn-primary")!);          // bước 1 → 2 (công ty đã chọn sẵn)
  await bam(hop.querySelector(".pick-card")!);                          // chọn mẫu
  await bam(hop.querySelector(".wizard-foot .btn-primary")!);          // bước 2 → 3
  return { hop, bam };
}
const oKhach = (hop: Element) => [...hop.querySelectorAll("label")].find((l) => l.textContent?.startsWith("Khách hàng (To)"))!.querySelector("input") as HTMLInputElement;

describe("FE-14 — chọn mã khách điền sẵn 'Khách hàng (To)'", () => {
  it("ô còn trống → điền tên khách vừa chọn", async () => {
    const { hop, bam } = await denBuoc3();
    await bam([...hop.querySelectorAll("button")].find((b) => b.textContent === "Chọn khách hàng")!);
    await cho(300);                                                     // ô tìm hoãn 250ms
    await bam(document.querySelector('.modal[aria-label="Chọn khách hàng"] tr.qrow')!);
    expect(oKhach(hop).value).toBe("Công ty ABC");
  });
});
