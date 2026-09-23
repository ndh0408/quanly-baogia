/** @vitest-environment jsdom */
//
// BÀI KIỂM MỨC COMPONENT CHO CÁC PHÁT HIỆN AUDIT CỦA LƯỚI (GRID-xx).
//
// Tách khỏi GridTable.component.test.tsx vì tệp đó chuyên gác Ctrl+Z/Y và thứ tự pushUndo; các bài ở
// đây gác những lỗi làm SAI SỐ hoặc GHI NHẦM Ô mà audit đã đo trên lưới thật. Giàn dựng giữ đúng nếp
// của tệp kia (createRoot + act, bắn sự kiện GỐC, không @testing-library) — xem lý do ở đầu tệp đó.
import { describe, it, expect, afterEach, vi } from "vitest";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { GridTable, type GridTableProps } from "./GridTable";
import * as M from "../lib/quoteMath";
import { nextK, type ItemK } from "../lib/gridShared";

vi.mock("../lib/venueCatalog", async (nhapGoc) => {
  const goc = await nhapGoc<typeof import("../lib/venueCatalog")>();
  return { ...goc, loadCatalog: () => Promise.resolve({ entries: [], venues: [] }) };
});

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Vo({ items, them }: { items: ItemK[]; them: Partial<GridTableProps> }) {
  const [, buoc] = useState(0);
  return (
    <GridTable items={items} usesDays={false} showDetail={false} numberSubs={false} editable={true}
      internalNote={false} groupSubtotal={false} onChange={() => buoc((v) => v + 1)} {...them} />
  );
}

let root: Root | null = null;
let hop: HTMLDivElement | null = null;

function moLuoi(items: ItemK[], them: Partial<GridTableProps> = {}) {
  hop = document.createElement("div");
  document.body.appendChild(hop);
  root = createRoot(hop);
  act(() => root!.render(<Vo items={items} them={them} />));
}

function o(row: number, field: string): HTMLInputElement | HTMLTextAreaElement {
  const el = hop!.querySelector(`tr[data-row="${row}"] [data-f="${field}"]`);
  if (!el) throw new Error(`không thấy ô (${row}, ${field})`);
  return el as HTMLInputElement | HTMLTextAreaElement;
}

function phim(el: Element, key: string, mo: { ctrl?: boolean; shift?: boolean; keyCode?: number } = {}) {
  const init: KeyboardEventInit & { keyCode?: number } = { key, bubbles: true, cancelable: true, ctrlKey: !!mo.ctrl, shiftKey: !!mo.shift };
  if (mo.keyCode != null) init.keyCode = mo.keyCode;
  let ev!: KeyboardEvent;
  act(() => { ev = new KeyboardEvent("keydown", init); el.dispatchEvent(ev); });
  return ev;
}

const vaoO = (el: HTMLElement) => act(() => el.focus());

/** Kho clipboard giả: jsdom không có DataTransfer. Giữ MỌI kiểu dữ liệu mà lưới setData (kể cả
 *  application/x-quanly-grid) — đó chính là thứ phân biệt "chép trong app" với "dán từ Excel". */
type Kho = Record<string, string>;
function suKienClip(loai: "copy" | "paste", kho: Kho) {
  const ev = new Event(loai, { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "clipboardData", {
    value: { getData: (k: string) => kho[k] ?? (k === "text" ? kho["text/plain"] ?? "" : ""), setData: (k: string, v: string) => { kho[k] = v; } },
  });
  return ev;
}
function chep(el: HTMLElement): Kho {
  const kho: Kho = {};
  act(() => { el.dispatchEvent(suKienClip("copy", kho)); });
  return kho;
}
function dan(el: HTMLElement, kho: Kho | string) {
  const k = typeof kho === "string" ? { "text/plain": kho } : kho;
  const ev = suKienClip("paste", k);
  act(() => { el.dispatchEvent(ev); });
  return ev;
}
function go(el: HTMLInputElement | HTMLTextAreaElement, chu: string) {
  act(() => { el.value = chu; el.dispatchEvent(new Event("input", { bubbles: true })); });
}
/** Gõ rồi Enter — đi đúng đường người dùng chốt một ô (onNumInput → commitCell → recomputeAll). */
function goEnter(row: number, field: string, chu: string) {
  vaoO(o(row, field));
  go(o(row, field), chu);
  phim(o(row, field), "Enter");
}
const coDo = (row: number, field: string) => o(row, field).closest("td")!.classList.contains("cell-fx-error");
async function xaHen() {
  await act(async () => { await new Promise((r) => setTimeout(r, 220)); });
}

const hang = (name: string, unit = "", quantity = 0, unitPrice = 0): ItemK =>
  ({ ...M.blankItem(false), name, unit, quantity, unitPrice, _k: nextK() }) as ItemK;

afterEach(async () => {
  await xaHen();
  if (root) act(() => root!.unmount());
  root = null;
  hop?.remove();
  hop = null;
  document.body.innerHTML = "";
});

// ── GRID-01 / MONEY-04: dán số có 3 chữ số lẻ vào SL bị nhân 1000 ─────────────────────────────
describe("GRID-01 — dán số vào cột SỐ LƯỢNG / ĐƠN GIÁ không được đoán nhầm nghìn", () => {
  it("chép-dán NGAY TRONG lưới: SL 2,675 sang hàng khác vẫn là 2,675 (không phải 2675)", () => {
    const items = [hang("Vách", "m2", 2.675, 100000), hang("Sàn", "m2", 1, 100000)];
    moLuoi(items);
    vaoO(o(0, "quantity"));
    const kho = chep(o(0, "quantity"));
    expect(kho["text/plain"]).toBe("2.675");            // số THÔ — đúng thứ mà bản cũ đọc thành 2675
    vaoO(o(1, "quantity"));
    dan(o(1, "quantity"), kho);
    expect(items[1].quantity).toBe(2.675);
    expect(M.lineAmount(items[1], false)).toBe(270000);
  });

  it("chép-dán trong lưới: SL 1500 và Đơn giá 1500000 giữ nguyên", () => {
    const items = [hang("A", "cái", 1500, 1500000), hang("B", "cái", 1, 1)];
    moLuoi(items);
    vaoO(o(0, "quantity"));
    phim(o(0, "quantity"), "ArrowRight", { shift: true });
    const kho = chep(o(0, "unitPrice"));
    vaoO(o(1, "quantity"));
    dan(o(1, "quantity"), kho);
    expect([items[1].quantity, items[1].unitPrice]).toEqual([1500, 1500000]);
  });

  it.each([
    ["2.675", 2.675],
    ["2,675", 2.675],
    ["0,125", 0.125],
    ["13.524", 13.524],
    ["1.500.000", 1500000],
  ])("dán từ NGUỒN NGOÀI vào SL: %s → %s", (chu, mong) => {
    const items = [hang("Vách", "m2", 1, 100000)];
    moLuoi(items);
    vaoO(o(0, "quantity"));
    dan(o(0, "quantity"), chu);
    expect(items[0].quantity).toBeCloseTo(mong, 6);
  });

  it("dán từ nguồn ngoài vào ĐƠN GIÁ: '1.500' vẫn là 1500 (tiền VND, nghìn)", () => {
    const items = [hang("Vách", "m2", 1, 0)];
    moLuoi(items);
    vaoO(o(0, "unitPrice"));
    dan(o(0, "unitPrice"), "1.500");
    expect(items[0].unitPrice).toBe(1500);
  });

  it("dán KHỐI từ Excel VN (SL | Đơn giá): SL thập phân, giá nghìn", () => {
    const items = [hang("Vách", "m2", 1, 1)];
    moLuoi(items);
    vaoO(o(0, "quantity"));
    dan(o(0, "quantity"), "0,125\t95.000");
    expect([items[0].quantity, items[0].unitPrice]).toEqual([0.125, 95000]);
  });

  // Suy quy ước số từ CẢ khối dán ngoài: SL "1.500" cái từ Excel máy VN không được hụt 1000 lần.
  it.each([
    ["khối VN: SL '1.500' + Đơn giá '250.000'", "1.500\t250.000", 1500, 250000],
    ["khối VN: SL '2,675' + Đơn giá '1.500.000'", "2,675\t1.500.000", 2.675, 1500000],
    ["khối US: SL '1,500' + Đơn giá '250,000.00'", "1,500\t250,000.00", 1500, 250000],
    ["khối VN nhiều hàng: '1.500' hàng 1 đọc theo '1.234,5' hàng 2", "1.500\t90\n1.234,5\t10", 1500, 90],
  ])("GRID-01 suy quy ước: %s", (_ten, chu, sl, gia) => {
    const items = [hang("A", "cái", 1, 1), hang("B", "cái", 1, 1)];
    moLuoi(items);
    vaoO(o(0, "quantity"));
    dan(o(0, "quantity"), chu);
    expect(items[0].quantity).toBeCloseTo(sl, 6);
    expect(items[0].unitPrice).toBe(gia);
  });

  // Soát chéo grid#7: quy ước của khối chỉ áp cho ô khớp khuôn của nó. Người Việt hay gõ SL "2.5"
  // mà vẫn ghi giá "250.000" (bảng Word/Zalo/email); bản trước bỏ mọi "." nên SL "13.5" thành 135.
  it.each([
    ["SL '13.5' + giá '250.000'", "13.5\t250.000", [13.5], [250000]],
    ["SL '0.5' + giá '2.500.000'", "0.5\t2.500.000", [0.5], [2500000]],
    ["SL '2,5' + giá '250,000' (khối US)", "2,5\t250,000", [2.5], [250000]],
    ["SL '12.25' + giá '1.200.000'", "12.25\t1.200.000", [12.25], [1200000]],
    ["nhiều hàng: '1.500' hàng 1 theo quy ước, '2.5' hàng 2 không bị phóng", "1.500\t250.000\n2.5\t1.200.000", [1500, 2.5], [250000, 1200000]],
  ])("grid#7 — ô lệch khuôn quy ước khối: %s", (_ten, chu, sl, gia) => {
    const items = [hang("A", "cái", 1, 1), hang("B", "cái", 1, 1)];
    moLuoi(items);
    vaoO(o(0, "quantity"));
    dan(o(0, "quantity"), chu);
    sl.forEach((v, k) => expect(items[k].quantity).toBeCloseTo(v, 6));
    gia.forEach((v, k) => expect(items[k].unitPrice).toBe(v));
  });

  it("GRID-01: khối KHÔNG suy được quy ước (SL '1.500' + giá '90') → giữ cách cũ: SL thập phân 1,5", () => {
    const items = [hang("A", "cái", 1, 1)];
    moLuoi(items);
    vaoO(o(0, "quantity"));
    dan(o(0, "quantity"), "1.500\t90");
    expect(items[0].quantity).toBeCloseTo(1.5, 6);
  });

  // Soát chéo grid#9: payload nội bộ chỉ nói "chép trong app", KHÔNG nói ô nguồn là số. Ô Ghi chú
  // gõ "95.000" được chép nguyên văn; đọc bằng Number() thì ra 95 — Đơn giá hụt 1000 lần.
  it("grid#9 — chép ô GHI CHÚ '95.000' trong lưới rồi dán vào Đơn giá → 95.000, không phải 95", () => {
    const items = [{ ...hang("A", "cái", 1, 1), notes: "95.000" } as ItemK];
    moLuoi(items);
    vaoO(o(0, "notes"));
    const kho = chep(o(0, "notes"));
    expect(JSON.parse(kho["application/x-quanly-grid"]).fields).toEqual(["notes"]);
    vaoO(o(0, "unitPrice"));
    dan(o(0, "unitPrice"), kho);
    expect(items[0].unitPrice).toBe(95000);
  });

  it("grid#9 — ô Ghi chú '95.000' dán ĐIỀN cả vùng Đơn giá → 95.000 mọi ô", () => {
    const items = [{ ...hang("A", "cái", 1, 1), notes: "95.000" } as ItemK, hang("B", "cái", 1, 1)];
    moLuoi(items);
    vaoO(o(0, "notes"));
    const kho = chep(o(0, "notes"));
    vaoO(o(0, "unitPrice"));
    phim(o(0, "unitPrice"), "ArrowDown", { shift: true });
    dan(o(1, "unitPrice"), kho);
    expect([items[0].unitPrice, items[1].unitPrice]).toEqual([95000, 95000]);
  });

  it("grid#9 — KHỐI hai ô Ghi chú ('95.000', '250.000') dán sang cột Đơn giá → 95.000 / 250.000", () => {
    const items = [{ ...hang("A", "cái", 1, 1), notes: "95.000" } as ItemK, { ...hang("B", "cái", 1, 1), notes: "250.000" } as ItemK];
    moLuoi(items);
    vaoO(o(0, "notes"));
    phim(o(0, "notes"), "ArrowDown", { shift: true });
    const kho = chep(o(1, "notes"));
    expect(kho["text/plain"]).toBe("95.000\r\n250.000");
    vaoO(o(0, "unitPrice"));
    dan(o(0, "unitPrice"), kho);
    expect([items[0].unitPrice, items[1].unitPrice]).toEqual([95000, 250000]);
  });

  it("grid#9 — ô nguồn là SỐ thì vẫn đọc số thô: SL 2,675 chép sang Đơn giá là 2,675", () => {
    const items = [hang("A", "m2", 2.675, 1), hang("B", "m2", 1, 1)];
    moLuoi(items);
    vaoO(o(0, "quantity"));
    const kho = chep(o(0, "quantity"));
    vaoO(o(1, "unitPrice"));
    dan(o(1, "unitPrice"), kho);
    expect(items[1].unitPrice).toBe(2.675);
  });

  it("GRID-13: dán '(1.500.000)' (âm kiểu kế toán) vào Đơn giá ra SỐ ÂM", () => {
    const items = [hang("Giảm giá", "gói", 1, 0)];
    moLuoi(items);
    vaoO(o(0, "unitPrice"));
    dan(o(0, "unitPrice"), "(1.500.000)");
    expect(items[0].unitPrice).toBe(-1500000);
  });
});

// ── GRID-04 / GRID-14: tham chiếu vòng + chuỗi phụ thuộc dài ──────────────────────────────────
// Mẫu không ngày, không Chi Tiết: A=STT B=Hạng mục C=ĐVT D=SL E=Đơn giá F=Thành tiền.
const hangFx = (unitPrice: number, fx?: string): ItemK => {
  const h = hang("x", "cái", 1, unitPrice);
  if (fx) h.formulas = { unitPrice: fx };
  return h;
};
describe("GRID-04 — tham chiếu vòng bị phát hiện, số đứng yên", () => {
  it("ô tự trỏ =E1*1,1: giữ 1.000.000, tô đỏ, không phình qua các lần sửa ô khác", async () => {
    const items = [hang("Vách", "m2", 1, 1000000), hang("Sàn", "m2", 1, 5)];
    moLuoi(items);
    goEnter(0, "unitPrice", "=E1*1,1");
    await xaHen();
    expect(items[0].unitPrice).toBe(1000000);
    expect(coDo(0, "unitPrice")).toBe(true);
    for (const v of ["6", "7", "8"]) { goEnter(1, "unitPrice", v); await xaHen(); }
    expect(items[0].unitPrice).toBe(1000000);
    expect(coDo(0, "unitPrice")).toBe(true);
  });

  it("vòng hai ô E1=E2, E2=E1+1: cả hai đỏ, giá trị không đổi qua 3 lần recompute", async () => {
    const items = [hangFx(8, "=E2"), hangFx(9, "=E1+1"), hang("Khác", "cái", 1, 1)];
    moLuoi(items);
    for (const v of ["2", "3", "4"]) { goEnter(2, "unitPrice", v); await xaHen(); }
    expect([items[0].unitPrice, items[1].unitPrice]).toEqual([8, 9]);
    expect(coDo(0, "unitPrice") && coDo(1, "unitPrice")).toBe(true);
  });

  it("sửa hết vòng thì hết đỏ và tính lại bình thường", async () => {
    const items = [hang("Vách", "m2", 1, 1000000), hang("Sàn", "m2", 1, 5)];
    moLuoi(items);
    goEnter(0, "unitPrice", "=E1*1,1");
    await xaHen();
    goEnter(0, "unitPrice", "=E2*2");
    await xaHen();
    expect(items[0].unitPrice).toBe(10);
    expect(coDo(0, "unitPrice")).toBe(false);
  });

  it("ô chỉ ĐỌC từ một vòng vẫn tính từ số đã đứng yên (không đỏ)", async () => {
    const items = [hangFx(8, "=E2"), hangFx(9, "=E1+1"), hangFx(0, "=E1*10"), hang("Khác", "cái", 1, 1)];
    moLuoi(items);
    goEnter(3, "unitPrice", "2");
    await xaHen();
    expect(items[2].unitPrice).toBe(80);
    expect(coDo(2, "unitPrice")).toBe(false);
  });

  // Một lần Enter chạy recomputeAll hai lần (commit + chốt), mỗi lần 8 lượt ở bản cũ → chuỗi phải dài
  // hơn 16 bậc thì mới lộ lỗi qua đúng thao tác người dùng. 25 hàng = 24 bậc.
  it("GRID-14: chuỗi tham chiếu NGƯỢC 25 hàng (E1=E2 … E24=E25) hội tụ đúng sau MỘT thao tác", async () => {
    const N = 25;
    const items: ItemK[] = [];
    for (let k = 0; k < N - 1; k++) items.push(hangFx(0, `=E${k + 2}`));
    items.push(hang("Cuối", "cái", 1, 1));
    moLuoi(items);
    goEnter(N - 1, "unitPrice", "500");
    await xaHen();
    // Enter ở hàng CUỐI đẻ thêm một hàng trống (nếp của lưới) — chỉ so N hàng của chuỗi.
    expect(items.slice(0, N).map((it) => it.unitPrice)).toEqual(Array(N).fill(500));
    expect(items.some((_, k) => k < N - 1 && coDo(k, "unitPrice"))).toBe(false);
  });
});

// ── GRID-03: công thức lỗi → ô đỏ, không lặng lẽ ra 0 ────────────────────────────────────────
describe("GRID-03 — công thức không tính được thì tô đỏ", () => {
  it("=E1* rồi Enter → ô đỏ; đỏ còn nguyên sau khi sửa ô khác; sửa lại đúng thì hết đỏ", async () => {
    const items = [hang("A", "cái", 1, 100000), hang("B", "cái", 1, 250000), hang("C", "cái", 1, 5)];
    moLuoi(items);
    goEnter(2, "unitPrice", "=E1*");
    await xaHen();
    expect(coDo(2, "unitPrice")).toBe(true);
    goEnter(0, "unitPrice", "200000");
    await xaHen();
    expect(coDo(2, "unitPrice")).toBe(true);
    goEnter(2, "unitPrice", "=SUM(E1,E2)");
    await xaHen();
    expect(items[2].unitPrice).toBe(450000);
    expect(coDo(2, "unitPrice")).toBe(false);
  });
});

// ── GRID-05: dán văn bản nhiều dòng vào ô chữ ĐANG SỬA ghi đè Hạng Mục các hàng dưới ─────────
describe("GRID-05 — dán nhiều dòng vào ô đang sửa", () => {
  it("F2 ô Hạng Mục rồi dán 'a\\nb' → hàng dưới KHÔNG đổi, để trình duyệt chèn (không preventDefault)", () => {
    const items = [hang("Banner A"), hang("Standee B")];
    moLuoi(items);
    vaoO(o(0, "name"));
    phim(o(0, "name"), "F2");
    const ev = dan(o(0, "name"), "Banner cổng chính\nIn hiflex 2 mặt");
    expect(ev.defaultPrevented).toBe(false);
    expect(items[1].name).toBe("Standee B");
    expect(items.length).toBe(2);
  });
  it("ô đang CHỌN (chưa sửa) → vẫn dán khối phủ 2 hàng như Excel", () => {
    const items = [hang("Banner A"), hang("Standee B")];
    moLuoi(items);
    vaoO(o(0, "name"));
    dan(o(0, "name"), "Một\nHai");
    expect(items.map((x) => x.name)).toEqual(["Một", "Hai"]);
  });
});

// ── GRID-12: thanh công thức xử lý Enter của IME như Enter chốt ô ─────────────────────────────
describe("GRID-12 — thanh công thức không cướp Enter của bộ gõ", () => {
  it("Enter kèm keyCode 229 (đang chốt cụm chữ IME) → KHÔNG chốt ô; Enter thường thì chốt", () => {
    const items = [hang("Banner", "cái", 1, 1000)];
    moLuoi(items, { fxBar: true });
    vaoO(o(0, "unitPrice"));
    const fx = hop!.querySelector("#fx-input") as HTMLInputElement;
    act(() => { fx.focus(); fx.value = "=5*2"; fx.dispatchEvent(new Event("input", { bubbles: true })); });
    phim(fx, "Enter", { keyCode: 229 });
    expect(items[0].unitPrice).toBe(1000);
    phim(fx, "Enter");
    expect(items[0].unitPrice).toBe(10);
  });
});

// ── GRID-15: Ctrl+Enter / dán một giá trị ra vùng gồm cột STT ghi rác `_stt` vào model ──────────
describe("GRID-15 — vùng chọn gồm STT không ghi trường rác", () => {
  it("Shift+Space rồi dán '7' → không có _stt trong item", () => {
    const items = [hang("Banner", "cái", 1, 1000)];
    moLuoi(items);
    vaoO(o(0, "name"));
    phim(o(0, "name"), " ", { shift: true });
    dan(o(0, "name"), "7");
    expect("_stt" in items[0]).toBe(false);
    expect(items[0].unitPrice).toBe(7);
  });
  it("Shift+Space, gõ '=E1*2', Ctrl+Enter → formulas không có _stt", () => {
    const items = [hang("Banner", "cái", 1, 1000)];
    moLuoi(items);
    vaoO(o(0, "name"));
    phim(o(0, "name"), " ", { shift: true });
    go(o(0, "name"), "=E1*2");
    phim(o(0, "name"), "Enter", { ctrl: true });
    expect("_stt" in items[0]).toBe(false);
    expect(items[0].formulas && "_stt" in items[0].formulas).toBeFalsy();
  });
});

// ── GRID-06: phím zoom của trình duyệt xoá/chèn hàng ─────────────────────────────────────────
describe("GRID-06 — Ctrl+'-' / Ctrl+'=' trơn là zoom, không đụng hàng", () => {
  it("Ctrl+'-' khi CHƯA chọn nguyên hàng → không xoá, không chặn phím (trình duyệt zoom)", () => {
    const items = [hang("Banner A"), hang("Standee B"), hang("Cổng")];
    moLuoi(items);
    vaoO(o(1, "unitPrice"));
    const ev = phim(o(1, "unitPrice"), "-", { ctrl: true });
    expect(items.length).toBe(3);
    expect(ev.defaultPrevented).toBe(false);
  });
  it("Ctrl+A rồi Ctrl+'-' (định thu nhỏ trang) → HỎI trước, Hủy thì không xoá gì", async () => {
    const items = [hang("Banner A"), hang("Standee B")];
    moLuoi(items);
    vaoO(o(0, "name"));
    phim(o(0, "name"), "a", { ctrl: true });
    phim(o(0, "name"), "-", { ctrl: true });
    expect(items.length).toBe(2);
    const huy = document.querySelector('[data-focus-trap="own"] [data-no]') as HTMLButtonElement;
    expect(huy, "phải có hộp xác nhận xoá nhiều hàng").not.toBeNull();
    await act(async () => { huy.click(); });
    expect(items.length).toBe(2);
  });
  it("Ctrl+'=' / Ctrl+'+' trơn (phóng to trang) → không chèn", () => {
    const items = [hang("Banner A"), hang("Standee B")];
    moLuoi(items);
    vaoO(o(0, "name"));
    phim(o(0, "name"), "=", { ctrl: true });
    phim(o(0, "name"), "+", { ctrl: true });
    expect(items.length).toBe(2);
  });
  it("Ctrl+Shift+'+' → chèn", () => {
    const items = [hang("Banner A")];
    moLuoi(items);
    vaoO(o(0, "name"));
    phim(o(0, "name"), "+", { ctrl: true, shift: true });
    expect(items.length).toBe(2);
  });
});

// ── GRID-02: đi tới cột STT không dời tiêu điểm → phím gõ kế tiếp đè lên ô CŨ ────────────────
describe("GRID-02 — vùng chọn nhìn thấy và ô nhận phím không được tách nhau", () => {
  const baHang = () => {
    const a = hang("Banner A", "cái", 1, 50000); a.internalNote = "NCC Minh — giá gốc 70k";
    return [a, hang("Standee B", "bộ", 2, 70000), hang("Cổng", "bộ", 1, 90000)];
  };
  it("Tab ở cột CUỐI → tiêu điểm vào Hạng Mục hàng kế; gõ không đụng ô cũ", () => {
    const items = baHang();
    moLuoi(items, { internalNote: true });
    vaoO(o(0, "internalNote"));
    phim(o(0, "internalNote"), "Tab");
    expect(document.activeElement).toBe(o(1, "name"));
    phim(document.activeElement!, "C");
    expect(items[0].internalNote).toBe("NCC Minh — giá gốc 70k");
  });

  it("Ctrl+Home từ Đơn giá rồi gõ '5' → Đơn giá hàng 2 KHÔNG đổi", () => {
    const items = baHang();
    moLuoi(items);
    vaoO(o(2, "unitPrice"));
    phim(o(2, "unitPrice"), "Home", { ctrl: true });
    expect(document.activeElement).toBe(o(0, "name"));
    phim(document.activeElement!, "5");
    expect(items[2].unitPrice).toBe(90000);
  });

  it("Shift+Tab từ Hạng Mục → cột CUỐI của hàng trước (không kẹt)", () => {
    const items = baHang();
    moLuoi(items);
    vaoO(o(1, "name"));
    phim(o(1, "name"), "Tab", { shift: true });
    expect(document.activeElement).toBe(o(0, "notes"));
  });

  it("Shift+← từ Hạng Mục vẫn chọn được vùng gồm STT (copy nguyên hàng)", () => {
    const items = baHang();
    moLuoi(items);
    vaoO(o(0, "name"));
    phim(o(0, "name"), "ArrowLeft", { shift: true });
    expect(hop!.querySelector('tr[data-row="0"] td.col-stt')!.classList.contains("cell-selected")).toBe(true);
    expect(document.activeElement).toBe(o(0, "name"));
  });
});

