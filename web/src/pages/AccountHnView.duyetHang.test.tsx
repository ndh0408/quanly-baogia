/** @vitest-environment jsdom */
// MÀN ACCOUNT HN — GỬI DUYỆT TỪNG HÀNG (2026-10-06). Không còn khoá CẢ PHẦN khi "đã gửi": hàng đã gửi / đã duyệt khoá
// riêng, hàng đang làm / bị trả / hàng mới vẫn gõ được. Nút "Gửi" ở cột Duyệt gửi đúng một hàng (bản ĐÃ LƯU — còn sửa
// dở thì đòi Lưu trước); nút "✓ Gửi duyệt" cuối màn = Lưu rồi gửi mọi hàng chưa gửi.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";

const MAU = [{ id: 1, code: "gn", name: "GN", companyId: 7, layout: { hasDays: false } }];
const baoGia = () => ({
  id: 11, quoteNumber: "GN26D011", title: "Giao HN", companyId: 7, hnStatus: "submitted",
  updatedAt: "2026-10-06T00:00:00.000Z", hnRev: "0".repeat(32),
  hnTables: [{ name: "HN", templateId: 1, groupSubtotal: false, items: [
    { kind: "item", name: "Đã gửi", quantity: 1, unitPrice: 1000, rid: "c", trangThaiDuyet: "cho-duyet" },
    { kind: "item", name: "Bị trả", quantity: 1, unitPrice: 2000, rid: "t", trangThaiDuyet: "tra-lai", lyDoTra: "Giá cao" },
  ] }],
});
const h = vi.hoisted(() => ({ submitHn: null as unknown as ReturnType<typeof vi.fn>, toast: null as unknown as ReturnType<typeof vi.fn> }));
vi.mock("../lib/api", () => {
  h.submitHn = vi.fn(async () => ({}));
  return {
    ApiError: class ApiError extends Error {},
    isPreviewMode: () => false,
    api: { metaTemplates: vi.fn(async () => MAU), getQuote: vi.fn(async () => baoGia()), saveHn: vi.fn(async () => ({})), submitHn: h.submitHn },
  };
});
vi.mock("../lib/ui", async (gocThat) => {
  h.toast = vi.fn();
  return { ...(await gocThat<typeof import("../lib/ui")>()), toast: h.toast, confirmModal: vi.fn(async () => true) };
});
vi.mock("../lib/daChiHang", () => ({ useDaChiBaoGia: () => null }));

const { AccountHnView } = await import("./AccountHnView");

describe("AccountHnView — gửi duyệt từng hàng", () => {
  let host: HTMLDivElement;
  beforeEach(async () => {
    h.submitHn.mockClear(); h.toast.mockClear();
    document.body.innerHTML = "";
    host = document.createElement("div"); document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => { root.render(<AccountHnView quoteId={11} />); });
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });
  });
  const dong = (ten: string) => [...host.querySelectorAll<HTMLTableRowElement>("tr[data-row]")]
    .find((tr) => tr.querySelector<HTMLTextAreaElement>('textarea[name="name"]')?.value === ten)!;

  it("phần có hàng đang chờ duyệt KHÔNG khoá cả màn: hàng bị trả sửa được, hàng đã gửi khoá; vẫn có nút Lưu / Gửi duyệt", () => {
    expect(dong("Bị trả").querySelector<HTMLInputElement>('input[name="unitPrice"]')!.disabled).toBe(false);
    expect(dong("Đã gửi").querySelector<HTMLInputElement>('input[name="unitPrice"]')!.disabled).toBe(true);
    expect(host.textContent).toContain("💾 Lưu");
    expect(host.textContent).toContain("✓ Gửi duyệt");
  });

  it("nút 'Gửi' của MỘT hàng → submitHn(id, [rid]) — chỉ hàng đó", async () => {
    const nut = dong("Bị trả").querySelector<HTMLButtonElement>(".hn-nut-gui")!;
    expect(dong("Đã gửi").querySelector(".hn-nut-gui")).toBeNull();
    await act(async () => { nut.click(); });
    expect(h.submitHn).toHaveBeenCalledWith(11, ["t"]);
  });

  it("còn sửa dở → nút 'Gửi' KHÔNG gửi (máy chủ sẽ duyệt bản cũ), nhắc Lưu trước", async () => {
    // Bảng có thay đổi chưa lưu: ô Lưu kho gọi thẳng onChange → HnTables gắn cờ chưa lưu.
    await act(async () => { dong("Bị trả").querySelector<HTMLInputElement>('input[name="luuKho"]')!.click(); });
    await act(async () => { dong("Bị trả").querySelector<HTMLButtonElement>(".hn-nut-gui")!.click(); });
    expect(h.submitHn).not.toHaveBeenCalled();
    expect(h.toast.mock.calls.some(([m]) => /Lưu trước/.test(String(m)))).toBe(true);
  });
});
