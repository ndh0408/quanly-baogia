/** @vitest-environment jsdom */
/**
 * ============================================================================
 * DÁN KHỐI NHIỀU Ô — CẤU TRÚC HÀNG (nhóm / hạng mục / dòng thông tin) VÀ CỘT ĐÍCH PHẢI ĐÚNG.
 *
 * Các lỗi ở nhánh "khối nhiều ô" của onPaste mà soát toàn diện tìm ra (mỗi describe một lỗi).
 *
 * Sơ đồ địa chỉ (showDetail=false): A=STT B=Hạng Mục C=ĐVT D=Số Lượng E=Đơn Giá F=Thành Tiền G=Ghi Chú
 * ============================================================================
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { GridTable, type GridTableProps } from "./GridTable";
import * as M from "../lib/quoteMath";
import { nextK, type ItemK } from "../lib/gridShared";

vi.mock("../lib/venueCatalog", async (g) => ({ ...(await g<typeof import("../lib/venueCatalog")>()), loadCatalog: () => Promise.resolve({ entries: [], venues: [] }) }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mk = (o: Partial<ItemK>): ItemK =>
  ({ _k: nextK(), kind: "item", name: "", unit: "", quantity: 0, days: 1, unitPrice: 0, notes: "", ...o }) as ItemK;
const nhom = (o: Partial<ItemK>): ItemK => ({ ...mk(o), kind: "section" }) as ItemK;

const hops: HTMLDivElement[] = [];
const roots: Root[] = [];
afterEach(async () => {
  await act(async () => { await new Promise((r) => setTimeout(r, 220)); });
  for (const r of roots.splice(0)) act(() => r.unmount());
  for (const h of hops.splice(0)) h.remove();
  document.body.innerHTML = "";
});

function Vo({ items, them }: { items: ItemK[]; them: Partial<GridTableProps> }) {
  const [, b] = useState(0);
  return <GridTable items={items} usesDays={false} showDetail={false} numberSubs={false} editable internalNote={false}
    groupSubtotal={false} onChange={() => b((v) => v + 1)} {...them} />;
}
/** Dựng một lưới; trả hàm tìm ô của RIÊNG lưới đó (mở được hai lưới cùng lúc). */
function moLuoi(items: ItemK[], them: Partial<GridTableProps> = {}) {
  const hop = document.createElement("div"); document.body.appendChild(hop); hops.push(hop);
  const root = createRoot(hop); roots.push(root);
  act(() => root.render(<Vo items={items} them={them} />));
  return (row: number, f: string) => hop.querySelector(`tr[data-row="${row}"] [data-f="${f}"]`) as HTMLInputElement & HTMLTextAreaElement;
}
const phim = (el: Element, init: KeyboardEventInit) => act(() => { el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init })); });
const vao = (el: HTMLElement) => act(() => { el.focus(); });

type Kho = Record<string, string>;
function suKienClip(loai: "copy" | "cut" | "paste", kho: Kho) {
  const ev = new Event(loai, { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "clipboardData", { value: { getData: (k: string) => kho[k] ?? "", setData: (k: string, v: string) => { kho[k] = v; } } });
  return ev;
}
const chep = (loai: "copy" | "cut" = "copy"): Kho => { const kho: Kho = {}; act(() => { document.activeElement!.dispatchEvent(suKienClip(loai, kho)); }); return kho; };
const dan = (kho: Kho | string) => act(() => { document.activeElement!.dispatchEvent(suKienClip("paste", typeof kho === "string" ? { "text/plain": kho } : kho)); });
/** Shift+mũi tên n lần từ ô đang focus. */
const moRong = (key: string, n: number) => { for (let k = 0; k < n; k++) phim(document.activeElement!, { key, shiftKey: true }); };

describe("L10 — khối KHÔNG phủ nguyên hàng không mang 'loại hàng' sang hàng đích", () => {
  it("dán cột SL chép từ [Nhóm G, X] vào SL của Y, Z: Y vẫn là hạng mục", () => {
    const items = [nhom({ name: "Nhóm G", quantity: 2 }), mk({ name: "X", quantity: 3, unitPrice: 100 }), mk({ name: "Y", quantity: 4, unitPrice: 200 }), mk({ name: "Z", quantity: 5, unitPrice: 300 })];
    const o = moLuoi(items, { groupSubtotal: true });
    vao(o(0, "quantity")); moRong("ArrowDown", 1);
    const kho = chep();
    vao(o(2, "quantity"));
    dan(kho);
    expect(items.map((x) => x.kind), "hạng mục Y bị đổi thành NHÓM").toEqual(["section", "item", "item", "item"]);
    expect([items[2].quantity, items[3].quantity]).toEqual([2, 3]);
    expect(M.lineAmount(items[2], false)).toBe(400);
  });

  it("khối CÓ cột Hạng Mục (chép từ Hạng Mục sang phải) vẫn mang cấu trúc nhóm như cũ", () => {
    const items = [nhom({ name: "Nhóm G", quantity: 1 }), mk({ name: "X", quantity: 3, unitPrice: 100 }), mk({ name: "Y" }), mk({ name: "Z" })];
    const o = moLuoi(items);
    vao(o(0, "name")); moRong("ArrowDown", 1); moRong("ArrowRight", 3);
    const kho = chep();
    vao(o(2, "name"));
    dan(kho);
    expect(items.map((x) => `${x.kind}:${x.name}`)).toEqual(["section:Nhóm G", "item:X", "section:Nhóm G", "item:X"]);
  });
});

describe("L14 — chép Hạng Mục → Ghi Chú sang báo giá KHÁC MẪU: ghép cột theo tên trường", () => {
  it("nguồn CÓ Số Ngày → đích KHÔNG ngày: Đơn Giá không nhận Số Ngày", () => {
    const nguon = [mk({ name: "Hallway", unit: "m2", quantity: 5.6, days: 2, unitPrice: 95000, notes: "giao 18/9" })];
    const dich = [mk({})];
    const oN = moLuoi(nguon, { usesDays: true });
    const oD = moLuoi(dich, { usesDays: false });
    vao(oN(0, "name")); moRong("ArrowRight", 5);   // name → notes
    const kho = chep();
    vao(oD(0, "name"));
    dan(kho);
    expect({ q: dich[0].quantity, p: dich[0].unitPrice, n: dich[0].notes }, "cột lệch: Số Ngày rơi vào Đơn Giá").toEqual({ q: 5.6, p: 95000, n: "giao 18/9" });
  });

  it("nguồn KHÔNG ngày → đích CÓ ngày: Số Ngày của đích giữ nguyên, Đơn Giá đúng cột", () => {
    const nguon = [mk({ name: "Hallway", unit: "m2", quantity: 5.6, unitPrice: 95000, notes: "giao 18/9" })];
    const dich = [mk({ days: 3 })];
    const oN = moLuoi(nguon, { usesDays: false });
    const oD = moLuoi(dich, { usesDays: true });
    vao(oN(0, "name")); moRong("ArrowRight", 4);
    const kho = chep();
    vao(oD(0, "name"));
    dan(kho);
    expect({ q: dich[0].quantity, d: dich[0].days, p: dich[0].unitPrice, n: dich[0].notes }).toEqual({ q: 5.6, d: 3, p: 95000, n: "giao 18/9" });
  });

  it("nguồn CÓ Chi Tiết → đích KHÔNG Chi Tiết: ĐVT/SL/ĐG vào đúng chỗ", () => {
    const nguon = [mk({ name: "Hallway", detail: "PP in KTS", unit: "m2", quantity: 5.6, unitPrice: 95000, notes: "ghi" })];
    const dich = [mk({})];
    const oN = moLuoi(nguon, { showDetail: true });
    const oD = moLuoi(dich, { showDetail: false });
    vao(oN(0, "name")); moRong("ArrowRight", 5);
    const kho = chep();
    vao(oD(0, "name"));
    dan(kho);
    expect({ u: dich[0].unit, q: dich[0].quantity, p: dich[0].unitPrice, n: dich[0].notes }).toEqual({ u: "m2", q: 5.6, p: 95000, n: "ghi" });
  });

  it("dán LỆCH cột có chủ ý (chép cột SL, dán vào cột Đơn Giá) vẫn ghép theo vị trí", () => {
    const items = [mk({ quantity: 7 }), mk({ quantity: 1, unitPrice: 5 })];
    const o = moLuoi(items);
    vao(o(0, "quantity")); moRong("ArrowDown", 1);
    const kho = chep();
    vao(o(0, "unitPrice"));
    dan(kho);
    expect([items[0].unitPrice, items[1].unitPrice]).toEqual([7, 1]);
  });
});

describe("L12 — khối từ Excel có cột Thành Tiền (giữa Đơn Giá và Ghi Chú) không làm lệch Ghi Chú", () => {
  it("dán Hạng Mục → Ghi Chú (7 ô, có TT) vào Hạng Mục: Ghi Chú đúng, TT bị bỏ (ô tính)", () => {
    const items = [mk({})];
    const o = moLuoi(items, { showDetail: true, internalNote: true });
    vao(o(0, "name"));
    dan("Hallway 2m75W\tPP in KTS\tm2\t5,6\t95.000\t532.000\tgiao 18/9");
    const x = items[0];
    expect({ n: x.name, d: x.detail, u: x.unit, q: x.quantity, p: x.unitPrice }).toEqual({ n: "Hallway 2m75W", d: "PP in KTS", u: "m2", q: 5.6, p: 95000 });
    expect(x.notes, "Thành Tiền rơi vào Ghi Chú").toBe("giao 18/9");
    expect(x.internalNote ?? "", "Ghi chú thật rơi vào Ghi chú NỘI BỘ (không xuất Excel)").toBe("");
  });

  it("cột Ghi chú nội bộ TẮT: ghi chú thật không bị bỏ mất", () => {
    const items = [mk({})];
    const o = moLuoi(items, { showDetail: true });
    vao(o(0, "name"));
    dan("Hallway 2m75W\tPP in KTS\tm2\t5,6\t95.000\t532.000\tgiao 18/9");
    expect(items[0].notes).toBe("giao 18/9");
  });

  it("dán SL | ĐG | TT | Ghi chú (nhiều dòng) vào ô SL", () => {
    const items = [mk({ name: "A" }), mk({ name: "B" })];
    const o = moLuoi(items, { internalNote: true });
    vao(o(0, "quantity"));
    dan("2\t150.000\t300.000\tghi A\r\n3\t10.000\t30.000\tghi B\r\n");
    expect(items.map((x) => [x.quantity, x.unitPrice, x.notes, x.internalNote ?? ""])).toEqual([[2, 150000, "ghi A", ""], [3, 10000, "ghi B", ""]]);
  });

  it("khối KHÔNG có cột TT (6 ô) vẫn ghép theo vị trí như cũ", () => {
    const items = [mk({})];
    const o = moLuoi(items, { showDetail: true, internalNote: true });
    vao(o(0, "name"));
    dan("Hallway\tPP in KTS\tm2\t5,6\t95.000\tgiao 18/9");
    expect([items[0].unitPrice, items[0].notes]).toEqual([95000, "giao 18/9"]);
  });

  it("ô ở vị trí TT KHÔNG khớp SL × ĐG (vd hai cột ghi chú) → không đoán, giữ theo vị trí", () => {
    const items = [mk({})];
    const o = moLuoi(items, { showDetail: true, internalNote: true });
    vao(o(0, "name"));
    dan("Hallway\tPP\tm2\t5,6\t95.000\t12\tnội bộ");
    expect([items[0].notes, items[0].internalNote]).toEqual(["12", "nội bộ"]);
  });
});

describe("L13 — dán khối KHÔNG phủ nguyên hàng lên hàng NHÓM: giữ cột đang chọn", () => {
  it("chép SL + ĐG rồi dán vào ô SL của hàng nhóm: hàng mới có SL/ĐG đúng cột", () => {
    const items = [nhom({ name: "Nhóm" }), mk({ name: "X", quantity: 2, unitPrice: 150000 })];
    const o = moLuoi(items);
    vao(o(1, "quantity")); moRong("ArrowRight", 1);
    const kho = chep();
    vao(o(0, "quantity"));
    dan(kho);
    expect(items.map((x) => x.kind)).toEqual(["section", "item", "item"]);
    expect({ n: items[1].name, u: items[1].unit, q: items[1].quantity, p: items[1].unitPrice }, "số rơi vào cột chữ").toEqual({ n: "", u: "", q: 2, p: 150000 });
  });

  it("dán khối ngoài 'SL ⇥ ĐG' vào ô SL của hàng nhóm", () => {
    const items = [nhom({ name: "Nhóm" })];
    const o = moLuoi(items);
    vao(o(0, "quantity"));
    dan("2\t150000");
    expect([items[1].name, items[1].quantity, items[1].unitPrice]).toEqual(["", 2, 150000]);
  });

  it("dán khối nguyên hàng lên hàng nhóm vẫn ghép theo tên (không đổi)", () => {
    const items = [nhom({ name: "Nhóm" }), mk({ name: "X", unit: "m2", quantity: 2, unitPrice: 150000 })];
    const o = moLuoi(items);
    vao(o(1, "name")); phim(document.activeElement!, { key: " ", code: "Space", shiftKey: true });
    const kho = chep();
    vao(o(0, "quantity"));
    dan(kho);
    expect([items[1].name, items[1].unit, items[1].quantity, items[1].unitPrice]).toEqual(["X", "m2", 2, 150000]);
  });

  it("khối trong app BẮT ĐẦU từ Hạng Mục (không nguyên hàng) dán vào ô SL của hàng nhóm: vẫn vào từ Hạng Mục", () => {
    // Phản biện L13: bỏ hẳn việc ép về Hạng Mục thì khối "Hạng Mục → Đơn Giá" ghép theo vị trí từ cột SL
    // — tên rơi vào SL (đọc ra 0), ĐVT/SL/ĐG lệch sang phải. Bản trước L13 làm đúng ca này.
    const items = [nhom({ name: "Nhóm" }), mk({ name: "X", unit: "m2", quantity: 2, unitPrice: 150000 })];
    const o = moLuoi(items);
    vao(o(1, "name")); moRong("ArrowRight", 3);
    const kho = chep();
    vao(o(0, "quantity"));
    dan(kho);
    expect(items.map((x) => `${x.kind}:${x.name}`)).toEqual(["section:Nhóm", "item:X", "item:X"]);
    expect({ u: items[1].unit, q: items[1].quantity, p: items[1].unitPrice }, "tên hạng mục rơi vào ô SL").toEqual({ u: "m2", q: 2, p: 150000 });
  });

  // Soát toàn diện đợt 3 (hồi quy do 235374f): bản 667191b ép MỌI khối về Hạng Mục nên hai ca dưới đúng;
  // 235374f giữ cột đang chọn cho mọi khối trừ khối trong app bắt đầu từ Hạng Mục.
  it("khối NGOÀI có cột đầu là chữ 'Banner ⇥ m2 ⇥ 2 ⇥ 100.000' dán vào ô SL của nhóm: vào từ Hạng Mục", () => {
    const items = [nhom({ name: "Nhóm" })];
    const o = moLuoi(items);
    vao(o(0, "quantity"));
    dan("Banner\tm2\t2\t100.000\r\nStandee\tcái\t1\t50.000\r\n");
    expect(items.map((x) => x.kind)).toEqual(["section", "item", "item"]);
    expect([items[1].name, items[1].unit, items[1].quantity, items[1].unitPrice], "chữ 'Banner' đọc thành SL 0, 'm2' thành ĐG 2").toEqual(["Banner", "m2", 2, 100000]);
    expect([items[2].name, items[2].unit, items[2].quantity, items[2].unitPrice]).toEqual(["Standee", "cái", 1, 50000]);
  });

  it("khối trong app bắt đầu từ ĐVT (ĐVT → ĐG) dán vào ô SL của nhóm: vào đúng cột nguồn", () => {
    const items = [nhom({ name: "Nhóm" }), mk({ name: "X", unit: "m2", quantity: 2, unitPrice: 150000 })];
    const o = moLuoi(items);
    vao(o(1, "unit")); moRong("ArrowRight", 2);
    const kho = chep();
    vao(o(0, "quantity"));
    dan(kho);
    expect(items.map((x) => `${x.kind}:${x.name}`)).toEqual(["section:Nhóm", "item:", "item:X"]);
    expect({ u: items[1].unit, q: items[1].quantity, p: items[1].unitPrice, g: items[1].notes }, "ĐVT rơi vào SL, ĐG vào Ghi chú").toEqual({ u: "m2", q: 2, p: 150000, g: "" });
  });

  it("khối ngoài CHỮ dán vào ô Ghi chú của nhóm vẫn vào Ghi chú (cột chữ đang chọn được giữ)", () => {
    const items = [nhom({ name: "Nhóm" })];
    const o = moLuoi(items);
    vao(o(0, "notes"));
    dan("Giao trước 5h\r\nKèm VAT\r\n");
    expect([items[1].name, items[1].notes, items[2].notes]).toEqual(["", "Giao trước 5h", "Kèm VAT"]);
  });

  // Phản biện đợt 3: luật "khối trong app vào từ cột NGUỒN" chỉ cần cho ô SỐ (SL) của nhóm — nơi dán theo
  // vị trí làm chữ đọc thành số. Người dùng CỐ Ý chọn ô CHỮ (Hạng Mục / ĐVT / Ghi chú) thì dán theo vị trí
  // như Excel, như cả 667191b lẫn 235374f.
  it("khối trong app chép từ Ghi chú dán vào ô HẠNG MỤC của nhóm: vào Hạng Mục (cột chữ đang chọn được giữ)", () => {
    const items = [nhom({ name: "Nhóm" }), mk({ name: "X", notes: "g1" }), mk({ name: "Y", notes: "g2" })];
    const o = moLuoi(items);
    vao(o(1, "notes")); moRong("ArrowDown", 1);
    const kho = chep();
    vao(o(0, "name"));
    dan(kho);
    expect(items.map((x) => `${x.kind}|${x.name}|${x.notes}`), "chữ bị kéo về cột Ghi chú nguồn").toEqual(["section|Nhóm|", "item|g1|", "item|g2|", "item|X|g1", "item|Y|g2"]);
  });

  it("khối trong app BẮT ĐẦU từ Hạng Mục dán vào ô ĐVT của nhóm: vẫn vào từ Hạng Mục (như 667191b, 235374f)", () => {
    const items = [nhom({ name: "Nhóm" }), mk({ name: "X", unit: "m2", quantity: 2, unitPrice: 150000 })];
    const o = moLuoi(items);
    vao(o(1, "name")); moRong("ArrowRight", 3);
    const kho = chep();
    vao(o(0, "unit"));
    dan(kho);
    expect([items[1].name, items[1].unit, items[1].quantity, items[1].unitPrice]).toEqual(["X", "m2", 2, 150000]);
  });
});

describe("L18 — dán khối bắt đầu ở DÒNG THÔNG TIN: số vừa dán phải hiện và vào tổng", () => {
  const info = (name: string): ItemK => ({ ...mk({ name }), kind: "info", days: null } as unknown as ItemK);

  it("dán 'Banner | m2 | 2 | 100.000' lên dòng thông tin: dòng thành hạng mục, 200.000 vào tổng", () => {
    const items = [info("Chương trình X"), mk({ name: "Standee", unit: "cái", quantity: 1, unitPrice: 50000 })];
    const o = moLuoi(items);
    vao(o(0, "name"));
    dan("Banner\tm2\t2\t100.000\r\nStandee 2\tcái\t1\t50.000\r\n");
    expect(items.map((x) => x.kind), "dòng thông tin giữ nguyên → SL/ĐG bị ẩn").toEqual(["item", "item"]);
    expect([items[0].name, items[0].quantity, items[0].unitPrice]).toEqual(["Banner", 2, 100000]);
    expect(M.sheetSubtotalGrouped(items, false, false)).toBe(250000);
    expect(hop0(o).querySelector('tr[data-row="0"] [data-f="unitPrice"]'), "ô Đơn giá không hiện").not.toBeNull();
  });

  it("dán CHỈ chữ (một cột) lên dòng thông tin: vẫn là dòng thông tin", () => {
    const items = [info("Chương trình X"), mk({ name: "Standee" })];
    const o = moLuoi(items);
    vao(o(0, "name"));
    dan("Dòng A\r\nDòng B\r\n");
    expect(items.map((x) => `${x.kind}:${x.name}`)).toEqual(["info:Dòng A", "item:Dòng B"]);
  });
});
/** Bảng chứa một ô — để hỏi ô khác trong cùng lưới sau khi dòng vẽ lại. */
function hop0(o: (row: number, f: string) => HTMLElement) { return o(0, "name").closest("table")!; }

describe("L16 — danh sách tên 1–2 chữ cái (S/M/L/XL) không bị hiểu là báo giá app xuất", () => {
  it("dán một cột 'S⏎M⏎L⏎XL' vào Hạng Mục: 4 hạng mục đúng tên, không thành nhóm rỗng tên", () => {
    const items = [mk({}), mk({}), mk({}), mk({})];
    const o = moLuoi(items);
    vao(o(0, "name"));
    dan("S\r\nM\r\nL\r\nXL\r\n");
    expect(items.map((x) => `${x.kind}:${x.name}`)).toEqual(["item:S", "item:M", "item:L", "item:XL"]);
  });

  it("khối cỡ áo 'S ⇥ ⇥ cái ⇥ 10 ⇥ 50.000' (3 dòng): tên, ĐVT, SL, ĐG vào đúng cột", () => {
    const items = [mk({})];
    const o = moLuoi(items, { showDetail: true });
    vao(o(0, "name"));
    dan("S\t\tcái\t10\t50.000\r\nM\t\tcái\t12\t50.000\r\nL\t\tcái\t8\t55.000\r\n");
    expect(items.map((x) => `${x.kind}:${x.name}:${x.unit}:${x.quantity}:${x.unitPrice}`)).toEqual(["item:S:cái:10:50000", "item:M:cái:12:50000", "item:L:cái:8:55000"]);
  });

  it("khối báo giá THẬT (chữ nhóm A + hàng hạng mục đánh số) vẫn được dựng lại", () => {
    const items = [mk({})];
    const o = moLuoi(items, { showDetail: true });
    vao(o(0, "name"));
    dan("A\tHCM\t\t\t\t95,000\t\t\r\n1\tHallway\tPP\tm2\t1\t95,000\t95,000\t\r\n");
    expect(items.map((x) => `${x.kind}:${x.name}`)).toEqual(["section:HCM", "item:Hallway"]);
  });

  it("khối CHỈ gồm hàng nhóm chép từ file app xuất (A | Nhóm 1, B | Nhóm 2, đủ cột) vẫn dựng lại thành nhóm", () => {
    // Phản biện L16: điều kiện "có hàng STT trống/số" loại mất ca này — 'A'/'B' rơi vào Hạng Mục,
    // tên nhóm sang cột kế bên. Bản xuất (7 cột: STT…Ghi Chú) dài hơn số cột nhập (5) → có cột STT thừa.
    const items = [mk({})];
    const o = moLuoi(items);
    vao(o(0, "name"));
    dan("A\tNhóm 1\t\t\t\t\t\r\nB\tNhóm 2\t\t2\t\t\t\r\n");
    expect(items.map((x) => `${x.kind}:${x.name}`)).toEqual(["section:Nhóm 1", "section:Nhóm 2"]);
  });

  it("hai cột 'cỡ ⇥ tên' ngắn (S | Áo thun, M | Áo thun) KHÔNG bị coi là các nhóm", () => {
    const items = [mk({}), mk({})];
    const o = moLuoi(items);
    vao(o(0, "name"));
    dan("S\tÁo thun\r\nM\tÁo thun\r\n");
    expect(items.map((x) => `${x.kind}:${x.name}:${x.unit}`)).toEqual(["item:S:Áo thun", "item:M:Áo thun"]);
  });

  // Soát toàn diện đợt 3 (hồi quy do 689cfc4): ngoại lệ "khối chỉ gồm hàng nhóm" nhận cả danh sách cỡ áo
  // ĐỦ cột (dài hơn số cột nhập) — mọi hàng thành NHÓM 'Áo thun', ĐG 0.
  it.each([
    ["7 cột (có TT + ghi chú)", "S\tÁo thun\tcái\t10\t50.000\t500.000\tx\r\nM\tÁo thun\tcái\t12\t50.000\t600.000\tx\r\nL\tÁo thun\tcái\t8\t55.000\t440.000\tx\r\n"],
    ["6 cột (không TT)", "S\tÁo thun\tcái\t10\t50.000\tx\r\nM\tÁo thun\tcái\t12\t50.000\tx\r\nL\tÁo thun\tcái\t8\t55.000\tx\r\n"],
  ])("danh sách cỡ áo có tên ở cột 2, %s: vẫn là HẠNG MỤC, không thành nhóm", (_ten, khoi) => {
    const items = [mk({}), mk({}), mk({})];
    const o = moLuoi(items);
    vao(o(0, "name"));
    dan(khoi);
    expect(items.map((x) => x.kind), "mọi hàng thành NHÓM").toEqual(["item", "item", "item"]);
    expect(items.map((x) => x.name)).toEqual(["S", "M", "L"]);
  });

  it("khối chỉ gồm hàng nhóm bắt đầu giữa bản xuất (C | D | E, liên tiếp) vẫn dựng lại thành nhóm", () => {
    const items = [mk({})];
    const o = moLuoi(items);
    vao(o(0, "name"));
    dan("C\tNhóm 3\t\t\t\t\t\r\nD\tNhóm 4\t\t\t\t\t\r\nE\tNhóm 5\t\t\t\t\t\r\n");
    expect(items.map((x) => `${x.kind}:${x.name}`)).toEqual(["section:Nhóm 3", "section:Nhóm 4", "section:Nhóm 5"]);
  });
});
