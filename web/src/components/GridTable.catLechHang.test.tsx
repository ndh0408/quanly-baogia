/** @vitest-environment jsdom */
/**
 * ============================================================================
 * CẮT–DÁN KHÔNG ĐƯỢC XOÁ NHẦM HÀNG KHI BẢNG ĐÃ ĐỔI SAU LÚC CẮT — soát toàn diện L7.
 *
 * Ctrl+X lưu CHỈ SỐ hàng nguồn (r0..r1); dán xong finishCutMove xoá trắng đúng các chỉ số đó. Chỉ số
 * không được dịch khi bảng đổi, và trạng thái cắt không bị huỷ khi người dùng sửa bảng:
 *   (1) cắt hàng Z rồi dán lên hàng NHÓM: onPaste chèn hàng trống dưới nhóm, Z trôi xuống một hàng
 *       nhưng finishCutMove vẫn xoá hàng cũ — tức hàng Y;
 *   (2) cắt C, bấm ✕ xoá hàng A rồi dán: hàng D bị xoá trắng;
 *   (3) cắt hàng 1, gõ nội dung mới vào hàng 1 (Excel huỷ chế độ cắt ở bước này), dán ở hàng 3:
 *       nội dung vừa gõ bị xoá.
 * ============================================================================
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { GridTable } from "./GridTable";
import { nextK, type ItemK } from "../lib/gridShared";

vi.mock("../lib/venueCatalog", async (g) => ({ ...(await g<typeof import("../lib/venueCatalog")>()), loadCatalog: () => Promise.resolve({ entries: [], venues: [] }) }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mk = (o: Partial<ItemK>): ItemK =>
  ({ _k: nextK(), kind: "item", name: "", unit: "", quantity: 0, days: 1, unitPrice: 0, notes: "", ...o }) as ItemK;

let root: Root | null = null;
let hop: HTMLDivElement | null = null;
afterEach(async () => {
  await act(async () => { await new Promise((r) => setTimeout(r, 220)); });
  if (root) act(() => root!.unmount());
  hop?.remove(); root = null; hop = null; document.body.innerHTML = "";
});

function Vo({ items, anh = false }: { items: ItemK[]; anh?: boolean }) {
  const [, b] = useState(0);
  return <GridTable items={items} usesDays={false} showDetail={false} numberSubs={false} editable internalNote={false}
    groupSubtotal={false} fxBar showImages={anh} onShowImages={() => {}} onChange={() => b((v) => v + 1)} />;
}
function moLuoi(items: ItemK[], anh = false) {
  hop = document.createElement("div"); document.body.appendChild(hop); root = createRoot(hop);
  act(() => root!.render(<Vo items={items} anh={anh} />));
}
const o = (row: number, f: string) => hop!.querySelector(`tr[data-row="${row}"] [data-f="${f}"]`) as HTMLInputElement & HTMLTextAreaElement;
const phim = (el: Element, init: KeyboardEventInit) => act(() => { el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init })); });

type Kho = Record<string, string>;
function suKienClip(loai: "cut" | "paste", kho: Kho) {
  const ev = new Event(loai, { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "clipboardData", { value: { getData: (k: string) => kho[k] ?? "", setData: (k: string, v: string) => { kho[k] = v; } } });
  return ev;
}
/** Chọn nguyên hàng (Shift+Space) rồi Ctrl+X. */
function catHang(row: number): Kho {
  act(() => { o(row, "name").focus(); });
  phim(o(row, "name"), { key: " ", code: "Space", shiftKey: true });
  const kho: Kho = {};
  act(() => { o(row, "name").dispatchEvent(suKienClip("cut", kho)); });
  return kho;
}
function dan(row: number, kho: Kho) {
  act(() => { o(row, "name").focus(); });
  act(() => { o(row, "name").dispatchEvent(suKienClip("paste", kho)); });
}
const tom = (items: ItemK[]) => items.map((x) => `${x.kind === "section" ? "§" : ""}${x.name}:${x.quantity}x${x.unitPrice}`);

describe("L7 — cắt–dán chỉ xoá đúng hàng nguồn", () => {
  it("(1) cắt hàng Z rồi dán lên hàng NHÓM: Z dời lên đầu nhóm, Y còn nguyên", () => {
    const items = [{ ...mk({ name: "Nhóm A" }), kind: "section" } as ItemK, mk({ name: "X", quantity: 1, unitPrice: 100 }), mk({ name: "Y", quantity: 2, unitPrice: 200 }), mk({ name: "Z", quantity: 3, unitPrice: 300 })];
    moLuoi(items);
    const kho = catHang(3);
    dan(0, kho);
    expect(tom(items), "hàng Y bị xoá trắng thay cho Z").toEqual(["§Nhóm A:0x0", "Z:3x300", "X:1x100", "Y:2x200", ":0x0"]);
  });

  it("(2) cắt C, xoá hàng A rồi dán: không hàng nào khác bị xoá trắng", () => {
    const items = [mk({ name: "A", quantity: 1 }), mk({ name: "B", quantity: 2 }), mk({ name: "C", quantity: 3 }), mk({ name: "D", quantity: 4 })];
    moLuoi(items);
    const kho = catHang(2);
    act(() => { (hop!.querySelector('tr[data-row="0"] .rm-row') as HTMLButtonElement).click(); });
    expect(items.map((x) => x.name)).toEqual(["B", "C", "D"]);
    dan(0, kho);
    expect(items.find((x) => x.name === "D")?.quantity, "hàng D bị xoá trắng").toBe(4);
    expect(items[0].name).toBe("C");
  });

  it("(3) cắt hàng 1, gõ nội dung mới vào hàng 1, dán ở hàng 3: nội dung vừa gõ không bị xoá", () => {
    const items = [mk({ name: "A", unit: "cái" }), mk({ name: "B", unit: "cái" }), mk({ name: "C" }), mk({ name: "D" })];
    moLuoi(items);
    const kho = catHang(1);
    const u = o(1, "unit");
    act(() => { u.focus(); });
    phim(u, { key: "b" });
    act(() => { u.value = "bộ (mới gõ)"; u.dispatchEvent(new Event("input", { bubbles: true })); });
    phim(u, { key: "Enter" });
    dan(3, kho);
    expect(items[1].name).toBe("B");
    expect(items[1].unit, "nội dung vừa gõ ở hàng nguồn bị xoá").toBe("bộ (mới gõ)");
    expect(`${items[3].name}/${items[3].unit}`).toBe("B/cái");
  });

  it("cắt–dán bình thường vẫn là DI CHUYỂN (nguồn bị xoá, không để lại thuộc tính rác)", () => {
    const items = [mk({ name: "A", quantity: 1, unitPrice: 5 }), mk({ name: "B" }), mk({ name: "C" })];
    moLuoi(items);
    const kho = catHang(0);
    dan(2, kho);
    expect(tom(items)).toEqual([":0x0", "B:0x0", "A:1x5"]);
    expect(Object.keys(items[0]), "ô STT (ô tính) bị ghi thành thuộc tính của hạng mục").not.toContain("_stt");
  });
});

// Soát vòng 2 (2026-09-29): (3) ở trên chỉ phủ đường GÕ (markEditUndo). Mọi thao tác sửa bảng khác cũng phải huỷ
// chế độ cắt: payload chốt nội dung lúc Ctrl+X, cắt còn sống thì dán xong nguồn bị xoá theo bản chụp cũ còn đích
// nhận giá trị cũ — thứ vừa sửa ở hàng nguồn mất hẳn, im lặng. Huỷ thì dán chỉ là CHÉP và onPaste báo rõ.
describe("L7 — Delete / Ctrl+D / Ctrl+R / thanh công thức / Ctrl+Enter / ảnh sau Ctrl+X cũng huỷ chế độ cắt", () => {
  const ANH = "data:image/png;base64,QUFB";
  const bonHang = () => [mk({ name: "A", unit: "bộ", quantity: 1, unitPrice: 5 }), mk({ name: "B", unit: "cái", quantity: 2, unitPrice: 10 }), mk({ name: "C" }), mk({ name: "D" })];
  const toastChu = () => document.getElementById("toast-host")?.textContent ?? "";
  /** Đứng ở ô (1, f) với vùng chọn MỘT ô — Ctrl+X vừa để lại vùng chọn cả hàng (Shift+Space), nên đi từ hàng trên xuống. */
  function veO(f: string) {
    act(() => { o(0, f).focus(); });
    phim(o(0, f), { key: "ArrowDown" });
    expect(document.activeElement, `không tới được ô ${f} của hàng nguồn`).toBe(o(1, f));
  }
  /** Dán khối vừa cắt ở hàng 3: phải là CHÉP — hàng nguồn 1 còn hạng mục B, hàng 3 nhận B, có báo. */
  function danLaChep(items: ItemK[], kho: Kho) {
    dan(3, kho);
    expect(items[1].name, "sửa hàng nguồn sau Ctrl+X mà cắt vẫn chạy: hàng nguồn bị xoá trắng").toBe("B");
    expect(items[3].name).toBe("B");
    expect(toastChu()).toContain("KHÔNG phải di chuyển");
  }

  it("Delete ô ĐVT của hàng nguồn rồi dán: ô vừa xoá không sống lại, hàng nguồn còn nguyên", () => {
    const items = bonHang();
    moLuoi(items);
    const kho = catHang(1);
    veO("unit");
    phim(o(1, "unit"), { key: "Delete" });
    expect(items[1].unit).toBe("");
    danLaChep(items, kho);
    expect(items[1].unit).toBe("");
  });

  it("Ctrl+D chép ĐVT của hàng trên xuống hàng nguồn rồi dán: hàng nguồn giữ ĐVT vừa điền", () => {
    const items = bonHang();
    moLuoi(items);
    const kho = catHang(1);
    act(() => { o(0, "unit").focus(); });
    phim(o(0, "unit"), { key: "ArrowDown", shiftKey: true });
    phim(document.activeElement!, { key: "d", ctrlKey: true });
    expect(items[1].unit).toBe("bộ");
    danLaChep(items, kho);
    expect(items[1].unit).toBe("bộ");
  });

  it("Ctrl+R trong hàng nguồn (Hạng Mục → ĐVT) rồi dán: hàng nguồn giữ ĐVT vừa điền", () => {
    const items = bonHang();
    moLuoi(items);
    const kho = catHang(1);
    veO("name");
    phim(o(1, "name"), { key: "ArrowRight", shiftKey: true });
    phim(document.activeElement!, { key: "r", ctrlKey: true });
    expect(items[1].unit).toBe("B");
    danLaChep(items, kho);
    expect(items[1].unit).toBe("B");
  });

  it("chốt SL của hàng nguồn qua THANH CÔNG THỨC rồi dán: hàng nguồn giữ công thức vừa chốt", () => {
    const items = bonHang();
    moLuoi(items);
    const kho = catHang(1);
    veO("quantity");
    const fx = document.getElementById("fx-input") as HTMLInputElement;
    act(() => { fx.focus(); fx.value = "=3+4"; });
    phim(fx, { key: "Enter" });
    expect([items[1].quantity, items[1].formulas?.quantity]).toEqual([7, "=3+4"]);
    danLaChep(items, kho);
    expect(items[1].quantity).toBe(7);
  });

  it("F2 rồi Ctrl+Enter điền cả vùng trong hàng nguồn rồi dán: hàng nguồn giữ nội dung vừa điền", () => {
    const items = bonHang();
    moLuoi(items);
    const kho = catHang(1);
    veO("unit");
    phim(o(1, "unit"), { key: "ArrowRight", shiftKey: true });
    phim(document.activeElement!, { key: "F2" });
    phim(document.activeElement!, { key: "Enter", ctrlKey: true });
    expect(items[1].unit, "Ctrl+Enter không điền cả vùng").toBe("2");
    danLaChep(items, kho);
    expect(items[1].unit).toBe("2");
  });

  it("xoá ẢNH của hàng nguồn rồi dán: hàng nguồn còn nguyên (không bị xoá trắng theo bản chụp lúc cắt)", () => {
    const items = bonHang();
    items[1].images = [ANH];
    moLuoi(items, true);
    const kho = catHang(1);
    act(() => { (hop!.querySelector('tr[data-row="1"] .img-rm') as HTMLButtonElement).click(); });
    expect(items[1].images ?? []).toEqual([]);
    danLaChep(items, kho);
    expect(items[1].images ?? []).toEqual([]);
  });

  it("THÊM ảnh vào hàng nguồn rồi dán: ảnh vừa thêm không mất", async () => {
    // jsdom không giải mã ảnh: Image giả gọi onload ngay, canvas trả null → fileToImg trả nguyên data-URL.
    class AnhGia { onload: null | (() => void) = null; onerror: null | (() => void) = null; width = 20; height = 10; set src(_v: string) { setTimeout(() => this.onload?.(), 0); } }
    vi.stubGlobal("Image", AnhGia);
    const khoiCanvas = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    try {
      const items = bonHang();
      moLuoi(items, true);
      const kho = catHang(1);
      const inp = hop!.querySelector('tr[data-row="1"] .img-add input[type="file"]') as HTMLInputElement;
      Object.defineProperty(inp, "files", { value: [new File(["moi"], "moi.png", { type: "image/png" })], configurable: true });
      act(() => { inp.dispatchEvent(new Event("change", { bubbles: true })); });
      await act(async () => { for (let k = 0; k < 10 && !(items[1].images || []).length; k++) await new Promise((r) => setTimeout(r, 20)); });
      expect((items[1].images || []).length, "ảnh chưa vào hàng nguồn").toBe(1);
      danLaChep(items, kho);
      expect((items[1].images || []).length, "ảnh vừa thêm bị xoá cùng hàng nguồn").toBe(1);
    } finally {
      vi.unstubAllGlobals(); khoiCanvas.mockRestore();
    }
  });
});
