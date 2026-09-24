/** @vitest-environment jsdom */
/**
 * ============================================================================
 * THÊM ẢNH: NÉN BẤT ĐỒNG BỘ RỒI MỚI GHI — ẢNH PHẢI VỀ ĐÚNG HẠNG MỤC ĐÃ CHỌN (soát toàn diện đợt 4).
 *
 * addImages chụp chỉ số hàng `i` và danh sách ảnh `cur` lúc chọn tệp, nén từng ảnh (FileReader →
 * Image → canvas, bất đồng bộ) rồi mới ghi `items[i].images = [...cur, ...out]` và gọi onChange.
 * Trong lúc nén:
 *   · xoá/chèn hàng phía trên → `items[i]` đã là hạng mục KHÁC — ảnh rơi sai hàng;
 *   · chọn thêm ảnh lần hai cho cùng ô → lần xong sau ghi đè bằng `cur` cũ — mất ảnh của lần trước;
 *   · lưới đã gỡ (đổi sheet, rời trang) → vẫn ghi vào mảng cũ và gọi onChange của lưới đã gỡ.
 * Cùng lớp lỗi L61 (hộp hỏi bất đồng bộ) — dùng conGanRef/itemsNayRef có sẵn từ 9d6208c.
 *
 * jsdom không giải mã ảnh (Image không bao giờ onload) → thay Image bằng bản giả GIỮ onload lại tới
 * khi bài kiểm "thả" — chính là khoảng "đang nén" để chen thao tác vào. canvas.getContext của jsdom trả
 * null → fileToImg trả nguyên data-URL đọc được (nhánh dự phòng của nó).
 * ============================================================================
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { GridTable } from "./GridTable";
import { nextK, type ItemK } from "../lib/gridShared";

vi.mock("../lib/venueCatalog", async (nhapGoc) => {
  const goc = await nhapGoc<typeof import("../lib/venueCatalog")>();
  return { ...goc, loadCatalog: () => Promise.resolve({ entries: [], venues: [] }) };
});
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** onload của các ảnh đang "nén" — bài kiểm tự thả. */
const dangNen: Array<() => void> = [];
class AnhGia {
  onload: null | (() => void) = null;
  onerror: null | (() => void) = null;
  width = 20; height = 10;
  set src(_v: string) { dangNen.push(() => this.onload?.()); }
}
beforeEach(() => {
  dangNen.length = 0;
  vi.stubGlobal("Image", AnhGia);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});

const mk = (o: Partial<ItemK>): ItemK =>
  ({ _k: nextK(), kind: "item", name: "", detail: "", unit: "m2", quantity: 1, days: 1, unitPrice: 0, notes: "", ...o }) as ItemK;

let root: Root | null = null;
let hop: HTMLDivElement | null = null;
afterEach(async () => {
  await act(async () => { await new Promise((r) => setTimeout(r, 220)); });
  if (root) act(() => root!.unmount());
  hop?.remove(); root = null; hop = null; document.body.innerHTML = "";
  vi.unstubAllGlobals(); vi.restoreAllMocks();
});

let soLanDoi = 0;
function Vo({ items }: { items: ItemK[] }) {
  const [, buoc] = useState(0);
  return (
    <GridTable items={items} usesDays={false} showDetail={false} numberSubs={false} editable internalNote={false}
      groupSubtotal={false} showImages onShowImages={() => {}} onChange={() => { soLanDoi++; buoc((v) => v + 1); }} />
  );
}
function moLuoi(items: ItemK[]) {
  soLanDoi = 0;
  hop = document.createElement("div");
  document.body.appendChild(hop);
  root = createRoot(hop);
  act(() => root!.render(<Vo items={items} />));
}
const tep = (ten: string) => new File([ten], ten + ".png", { type: "image/png" });
/** Chọn tệp ở nút "＋" của hàng `row` — đúng đường người dùng (sự kiện change của input file). */
function chonAnh(row: number, tenTep: string[]) {
  const inp = hop!.querySelector(`tr[data-row="${row}"] .img-add input[type="file"]`) as HTMLInputElement;
  Object.defineProperty(inp, "files", { value: tenTep.map(tep), configurable: true });
  act(() => { inp.dispatchEvent(new Event("change", { bubbles: true })); });
}
/** Chờ FileReader đọc xong (ảnh vào hàng "đang nén") — chưa thả onload. */
const choDoc = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });
/** Thả mọi ảnh đang nén cho tới khi không còn ảnh nào (addImages nén tuần tự từng tệp). */
async function thaHet() {
  for (let vong = 0; vong < 20; vong++) {
    await choDoc();
    if (!dangNen.length) return;
    await act(async () => { dangNen.splice(0).forEach((f) => f()); await Promise.resolve(); });
  }
}
const anhCua = (it: ItemK) => ((it.images || []) as string[]).map((s) => atob(s.split(",")[1] ?? ""));
const toastChu = () => document.getElementById("toast-host")?.textContent ?? "";

describe("addImages — ảnh ghi theo hạng mục lúc chọn tệp, không theo chỉ số", () => {
  it("xoá hàng PHÍA TRÊN trong lúc nén → ảnh vẫn vào hạng mục B, không rơi sang C", async () => {
    const items = [mk({ name: "A" }), mk({ name: "B" }), mk({ name: "C" })];
    moLuoi(items);
    chonAnh(1, ["b1"]);
    await choDoc();
    expect(dangNen.length, "bản giả Image không giữ được ảnh đang nén").toBe(1);
    act(() => { (hop!.querySelector('tr[data-row="0"] .rm-row') as HTMLButtonElement).click(); });
    expect(items.map((x) => x.name)).toEqual(["B", "C"]);
    await thaHet();
    expect(anhCua(items[1]), "ảnh của B rơi sang C").toEqual([]);
    expect(anhCua(items[0])).toEqual(["b1"]);
  });

  it("chọn ảnh lần hai cho CÙNG ô khi lần đầu chưa nén xong → giữ đủ cả hai lần", async () => {
    const items = [mk({ name: "A", images: ["data:image/png;base64," + btoa("cu")] } as Partial<ItemK>)];
    moLuoi(items);
    chonAnh(0, ["x1", "x2"]);
    await choDoc();
    chonAnh(0, ["y1"]);
    await thaHet();
    expect(anhCua(items[0]).sort(), "lần xong sau ghi đè mất ảnh của lần xong trước").toEqual(["cu", "x1", "x2", "y1"]);
  });

  it("lưới bị GỠ trong lúc nén (đổi sheet, rời trang) → không ghi vào mảng cũ, không gọi onChange", async () => {
    const items = [mk({ name: "A" }), mk({ name: "B" })];
    moLuoi(items);
    chonAnh(1, ["b1"]);
    await choDoc();
    act(() => root!.unmount()); root = null;
    const truoc = soLanDoi;
    await thaHet();
    expect(anhCua(items[1]), "lưới đã gỡ mà ảnh vẫn được ghi vào model").toEqual([]);
    expect(soLanDoi, "lưới đã gỡ mà vẫn gọi onChange").toBe(truoc);
  });

  it("mảng items bị THAY (nạp lại sau Lưu) trong lúc nén → không ghi vào mảng cũ, báo người dùng chọn lại", async () => {
    const items = [mk({ name: "A" }), mk({ name: "B" })];
    moLuoi(items);
    chonAnh(1, ["b1"]);
    await choDoc();
    const moi = items.map((x) => ({ ...x, _k: nextK() }) as ItemK);
    act(() => root!.render(<Vo items={moi} />));
    await thaHet();
    expect(anhCua(items[1])).toEqual([]);
    expect(anhCua(moi[1])).toEqual([]);
    expect(toastChu()).toContain("chọn lại");
  });

  // `_k` là trường TUỲ CHỌN của ItemK. Mọi đường nạp hiện nay đều đóng khoá, nhưng GridTable không tự
  // đóng: hàng thiếu `_k` thì tìm theo `_k === undefined` khớp nhầm hàng ĐẦU TIÊN cũng thiếu khoá
  // (phản biện đợt 4). Thiếu khoá thì nhận hàng theo chính đối tượng hàng lúc chọn tệp.
  it("hàng THIẾU `_k`: chọn ảnh cho hàng 2 → ảnh vào hàng 2, không rơi sang hàng đầu cũng thiếu khoá", async () => {
    const items = [mk({ name: "A" }), mk({ name: "B" }), mk({ name: "C" })];
    items.forEach((x) => { delete (x as { _k?: number })._k; });
    moLuoi(items);
    chonAnh(2, ["c1"]);
    await thaHet();
    expect(anhCua(items[0]), "ảnh của C rơi sang A (hàng đầu thiếu khoá)").toEqual([]);
    expect(anhCua(items[2])).toEqual(["c1"]);
  });

  it("hàng THIẾU `_k` bị xoá trong lúc nén → không ghi sang hàng khác, báo chọn lại", async () => {
    const items = [mk({ name: "A" }), mk({ name: "B" })];
    items.forEach((x) => { delete (x as { _k?: number })._k; });
    moLuoi(items);
    chonAnh(1, ["b1"]);
    await choDoc();
    act(() => { (hop!.querySelector('tr[data-row="1"] .rm-row') as HTMLButtonElement).click(); });
    expect(items.map((x) => x.name)).toEqual(["A"]);
    await thaHet();
    expect(anhCua(items[0]), "hàng B đã xoá mà ảnh của nó rơi sang A").toEqual([]);
    expect(toastChu()).toContain("chọn lại");
  });

  it("đường thường: chọn 2 ảnh → vào đúng hàng, một mốc hoàn tác", async () => {
    const items = [mk({ name: "A" }), mk({ name: "B" })];
    moLuoi(items);
    chonAnh(1, ["b1", "b2"]);
    await thaHet();
    expect(anhCua(items[1])).toEqual(["b1", "b2"]);
    expect(anhCua(items[0])).toEqual([]);
    act(() => { (hop!.querySelector('tr[data-row="0"] [data-f="name"]') as HTMLElement).focus(); });
    act(() => { document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true })); });
    expect(anhCua(items[1])).toEqual([]);
  });
});
