/** @vitest-environment jsdom */
// Bảng nội bộ (HCM / Phí KH / Hà Nội, 4e24308): CHỨNG TỪ và LƯU KHO là ô chọn nằm NGOÀI FIELDS (không
// chọn vùng/gõ được) — như ảnh. Chép / cắt "cái hạng mục" (khối trải Hạng Mục → NS) mà không mang chúng
// thì NS sang đích còn CHỨNG TỪ / LƯU KHO ở lại hàng cũ: hạng mục mang nhầm chứng từ của hàng khác, cắt
// xong hàng nguồn đã trống vẫn "VAT · lưu kho" và được lưu như thế (sanitizeExtraTables không xét tên).
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { GridTable } from "./GridTable";
import { nextK, type ItemK } from "../lib/gridShared";

vi.mock("../lib/venueCatalog", async (nhapGoc) => {
  const goc = await nhapGoc<typeof import("../lib/venueCatalog")>();
  return { ...goc, loadCatalog: () => Promise.resolve({ entries: [], venues: [] }) };
});
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type NB = ItemK & { ns?: string | null; luuKho?: boolean; chungTu?: string | null };
const mk = (o: Partial<NB>): NB =>
  ({ _k: nextK(), kind: "item", name: "", detail: "", unit: "m2", quantity: 1, days: 1, unitPrice: 0, notes: "", ...o }) as NB;

let root: Root | null = null;
let hop: HTMLDivElement | null = null;
afterEach(async () => {
  await act(async () => { await new Promise((r) => setTimeout(r, 220)); });
  if (root) act(() => root!.unmount());
  hop?.remove(); root = null; hop = null; document.body.innerHTML = "";
});

function Vo({ items }: { items: ItemK[] }) {
  const [, buoc] = useState(0);
  return <GridTable items={items} usesDays={false} showDetail={false} numberSubs={false} editable
      internalNote={false} cotNoiBo groupSubtotal={false} onChange={() => buoc((v) => v + 1)} />;
}
function moLuoi(items: ItemK[]) {
  hop = document.createElement("div");
  document.body.appendChild(hop);
  root = createRoot(hop);
  // đúng props ExtraTables/HnTables truyền cho bảng nội bộ
  act(() => root!.render(<Vo items={items} />));
}
const o = (row: number) => hop!.querySelector(`tr[data-row="${row}"] [data-f="name"]`) as HTMLTextAreaElement;
function clipGia() {
  const kho: Record<string, string> = {};
  return { kho, setData: (k: string, v: string) => { kho[k] = v; }, getData: (k: string) => kho[k] ?? "" };
}
function layHang(row: number, cat = false) {
  const el = o(row);
  act(() => { el.focus(); });
  act(() => { el.dispatchEvent(new KeyboardEvent("keydown", { key: " ", code: "Space", shiftKey: true, bubbles: true, cancelable: true })); });
  const cb = clipGia();
  const ev = new Event(cat ? "cut" : "copy", { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "clipboardData", { value: cb });
  act(() => { el.dispatchEvent(ev); });
  return cb;
}
function dan(row: number, cb: ReturnType<typeof clipGia>) {
  const el = o(row);
  act(() => { el.focus(); });
  const ev = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "clipboardData", { value: cb });
  act(() => { el.dispatchEvent(ev); });
}

describe("bảng nội bộ — chứng từ / lưu kho đi theo hạng mục khi chép, cắt nguyên hàng", () => {
  it("CẮT nguyên hàng dán sang hàng trống: NS + CHỨNG TỪ + LƯU KHO cùng sang, hàng nguồn về mặc định", () => {
    const items = [mk({ name: "Backdrop", unitPrice: 250000, ns: "Anh Tuấn", chungTu: "VAT", luuKho: true }), mk({ name: "" })];
    moLuoi(items);
    dan(1, layHang(0, true));
    const [a, b] = items as NB[];
    expect([b.name, b.ns, b.chungTu, b.luuKho]).toEqual(["Backdrop", "Anh Tuấn", "VAT", true]);
    expect(a.name).toBe("");
    expect(a.chungTu ?? null).toBeNull();
    expect(!!a.luuKho).toBe(false);
  });

  it("CHÉP nguyên hàng đè lên hàng khác: đích nhận chứng từ / lưu kho của nguồn, nguồn giữ nguyên", () => {
    const items = [mk({ name: "Backdrop", ns: "Anh Tuấn", chungTu: "VAT", luuKho: true }), mk({ name: "Standee", ns: "Chị Lan", chungTu: "TM", luuKho: false })];
    moLuoi(items);
    dan(1, layHang(0));
    const [a, b] = items as NB[];
    expect([b.name, b.ns, b.chungTu, b.luuKho]).toEqual(["Backdrop", "Anh Tuấn", "VAT", true]);
    expect([a.name, a.chungTu, a.luuKho]).toEqual(["Backdrop", "VAT", true]);
  });

  it("chép hàng NHÓM đè lên hạng mục: hàng thành nhóm và không còn giữ chứng từ / lưu kho bị ẩn", () => {
    const items = [mk({ name: "Nhóm A", kind: "section" } as Partial<NB>), mk({ name: "Standee", ns: "Chị Lan", chungTu: "TM", luuKho: true })];
    moLuoi(items);
    dan(1, layHang(0));
    const b = items[1] as NB;
    expect(b.kind).toBe("section");
    expect(b.chungTu ?? null).toBeNull();
    expect(!!b.luuKho).toBe(false);
  });

  it("chép riêng cột TÊN (không phải nguyên hạng mục) thì không đụng chứng từ / lưu kho của đích", () => {
    const items = [mk({ name: "Backdrop", chungTu: "VAT", luuKho: true }), mk({ name: "Standee", chungTu: "TM", luuKho: false })];
    moLuoi(items);
    const el = o(0);
    act(() => { el.focus(); });
    const cb = clipGia();
    const ev = new Event("copy", { bubbles: true, cancelable: true });
    Object.defineProperty(ev, "clipboardData", { value: cb });
    act(() => { el.dispatchEvent(ev); });
    expect(JSON.parse(cb.kho["application/x-quanly-grid"]).noiBo).toBeUndefined();
    dan(1, cb);
    const b = items[1] as NB;
    expect([b.name, b.chungTu, b.luuKho]).toEqual(["Backdrop", "TM", false]);
  });
});
