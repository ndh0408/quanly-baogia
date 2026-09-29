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

// ── Soát lại ed1b5b9 (2026-09-29): luật chốt — NS · CHỨNG TỪ · LƯU KHO là thuộc tính CỦA HẠNG MỤC. Khối
// mang cái hạng mục (cột Hạng Mục kèm cột tiền) thì ba trường đi theo; hàng đích bị thay hạng mục thì không
// được giữ ba trường của hạng mục cũ. Chỉ sửa chữ (tên, tên + ĐVT) thì không đụng.
/** Chọn khối từ ô (row, "name") kéo sang phải `buoc` cột bằng Shift+→ (đúng thao tác bàn phím thật). */
function chonKhoi(row: number, buoc: number, sangTrai = 0) {
  const el = o(row);
  act(() => { el.focus(); });
  for (let k = 0; k < buoc; k++) {
    const ae = document.activeElement as HTMLElement;
    act(() => { ae.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", shiftKey: true, bubbles: true, cancelable: true })); });
  }
  for (let k = 0; k < sangTrai; k++) {
    const ae = document.activeElement as HTMLElement;
    act(() => { ae.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", shiftKey: true, bubbles: true, cancelable: true })); });
  }
}
function chepKhoi(cat = false) {
  const cb = clipGia();
  const ev = new Event(cat ? "cut" : "copy", { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "clipboardData", { value: cb });
  act(() => { (document.activeElement as HTMLElement).dispatchEvent(ev); });
  return cb;
}
const baTruong = (x: NB) => [x.ns ?? null, x.chungTu ?? null, !!x.luuKho];

describe("bảng nội bộ — khối Hạng Mục kèm cột tiền mang ba trường, kể cả khi KHÔNG chạm cột NS", () => {
  // FIELDS của lưới thử: _stt · name · unit · quantity · unitPrice · notes · ns → name→notes là 4 bước.
  it("CẮT khối Hạng Mục → Ghi chú (không có cột NS) dán sang hàng trống: cả ba trường sang, hàng nguồn về mặc định", () => {
    const items = [mk({ name: "Backdrop", unitPrice: 250000, notes: "gấp", ns: "Anh Tuấn", chungTu: "VAT", luuKho: true }), mk({ name: "" })];
    moLuoi(items);
    chonKhoi(0, 4);
    const cb = chepKhoi(true);
    expect(JSON.parse(cb.kho["application/x-quanly-grid"]).fields).toEqual(["name", "unit", "quantity", "unitPrice", "notes"]);
    dan(1, cb);
    const [r, e] = items as NB[];
    expect([e.name, e.unitPrice, e.notes], "khối không sang").toEqual(["Backdrop", 250000, "gấp"]);
    expect(baTruong(e), "hàng đích nhận hạng mục mà không có chứng từ / NS / lưu kho").toEqual(["Anh Tuấn", "VAT", true]);
    expect(r.name).toBe("");
    expect(baTruong(r), "hàng nguồn đã trống vẫn giữ NS · VAT · lưu kho").toEqual([null, null, false]);
  });

  it("CHÉP khối Hạng Mục → Đơn giá đè lên hạng mục khác: đích nhận ba trường của nguồn, nguồn giữ nguyên", () => {
    const items = [mk({ name: "Backdrop", unitPrice: 250000, ns: "Anh Tuấn", chungTu: "VAT", luuKho: true }), mk({ name: "Standee", unitPrice: 90000, ns: "Chị Lan", chungTu: "TM", luuKho: false })];
    moLuoi(items);
    chonKhoi(0, 3);
    dan(1, chepKhoi());
    const [a, b] = items as NB[];
    expect([b.name, b.unitPrice]).toEqual(["Backdrop", 250000]);
    expect(baTruong(b), "Standee đã thành Backdrop mà vẫn mang NS / chứng từ của Standee").toEqual(["Anh Tuấn", "VAT", true]);
    expect(baTruong(a)).toEqual(["Anh Tuấn", "VAT", true]);
  });

  it("chép khối Hạng Mục + ĐVT (chỉ CHỮ, không cột tiền) thì không đụng ba trường của đích — như chép riêng cột tên", () => {
    const items = [mk({ name: "Backdrop", unit: "m2", ns: "Anh Tuấn", chungTu: "VAT", luuKho: true }), mk({ name: "Standee", unit: "cái", ns: "Chị Lan", chungTu: "TM", luuKho: false })];
    moLuoi(items);
    chonKhoi(0, 1);
    const cb = chepKhoi();
    expect(JSON.parse(cb.kho["application/x-quanly-grid"]).noiBo).toBeUndefined();
    dan(1, cb);
    const b = items[1] as NB;
    expect([b.name, b.unit]).toEqual(["Backdrop", "m2"]);
    expect(baTruong(b)).toEqual(["Chị Lan", "TM", false]);
  });

  it("chép STT + Hạng Mục của hàng NHÓM đè lên hạng mục: hàng thành nhóm, không giữ ba trường ẩn", () => {
    const items = [mk({ name: "Nhóm A", kind: "section" } as Partial<NB>), mk({ name: "Standee", unitPrice: 90000, ns: "Chị Lan", chungTu: "TM", luuKho: true })];
    moLuoi(items);
    chonKhoi(0, 0, 1);
    const cb = chepKhoi();
    expect(JSON.parse(cb.kho["application/x-quanly-grid"]).fields).toEqual(["_stt", "name"]);
    dan(1, cb);
    const b = items[1] as NB;
    expect(b.kind).toBe("section");
    expect(baTruong(b), "hàng nhóm không có ô nào mà vẫn giữ NS / chứng từ / lưu kho").toEqual([null, null, false]);
  });
});

describe("bảng nội bộ — dán nguyên hàng từ LƯỚI CHÍNH đè lên hạng mục nội bộ", () => {
  function HaiLuoi({ chinh, noiBo }: { chinh: ItemK[]; noiBo: ItemK[] }) {
    const [, buoc] = useState(0);
    return (
      <>
        <div className="luoi-chinh"><GridTable items={chinh} usesDays={false} showDetail={false} numberSubs={false} editable internalNote groupSubtotal={false} onChange={() => buoc((v) => v + 1)} /></div>
        <div className="luoi-noi-bo"><GridTable items={noiBo} usesDays={false} showDetail={false} numberSubs={false} editable internalNote={false} cotNoiBo groupSubtotal={false} onChange={() => buoc((v) => v + 1)} /></div>
      </>
    );
  }
  it("hàng đích nhận hạng mục của lưới chính và KHÔNG giữ NS / chứng từ / lưu kho của hạng mục bị đè", () => {
    const chinh = [mk({ name: "Màn LED", unitPrice: 5000000 })];
    const noiBo = [mk({ name: "Standee", unitPrice: 90000, ns: "Chị Lan", chungTu: "TM", luuKho: true })];
    hop = document.createElement("div");
    document.body.appendChild(hop);
    root = createRoot(hop);
    act(() => root!.render(<HaiLuoi chinh={chinh} noiBo={noiBo} />));
    const ten = (lop: string) => hop!.querySelector(`.${lop} tr[data-row="0"] [data-f="name"]`) as HTMLTextAreaElement;
    act(() => { ten("luoi-chinh").focus(); });
    act(() => { ten("luoi-chinh").dispatchEvent(new KeyboardEvent("keydown", { key: " ", code: "Space", shiftKey: true, bubbles: true, cancelable: true })); });
    const cb = chepKhoi();
    expect(JSON.parse(cb.kho["application/x-quanly-grid"]).noiBo, "lưới chính không có ba cột — không có gì để mang").toBeUndefined();
    act(() => { ten("luoi-noi-bo").focus(); });
    const ev = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(ev, "clipboardData", { value: cb });
    act(() => { ten("luoi-noi-bo").dispatchEvent(ev); });
    const b = noiBo[0] as NB;
    expect([b.name, b.unitPrice]).toEqual(["Màn LED", 5000000]);
    expect(baTruong(b), "Màn LED mang chứng từ TM / lưu kho của Standee").toEqual([null, null, false]);
  });
});

// ── Soát vòng 1 (2026-09-29): ba đường còn lệch luật "ba trường là thuộc tính của hạng mục" ─────────────
/** Bấm một phím ở ô đang có tiêu điểm (keydown nổi bọt tới lưới). */
function bam(init: KeyboardEventInit) {
  const ae = document.activeElement as HTMLElement;
  act(() => { ae.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init })); });
}
/** Dán `cb` vào ô (row, f) — ô bất kỳ, không chỉ cột Hạng Mục. */
function danVaoO(row: number, f: string, cb: ReturnType<typeof clipGia>) {
  const el = hop!.querySelector(`tr[data-row="${row}"] [data-f="${f}"]`) as HTMLElement;
  act(() => { el.focus(); });
  const ev = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "clipboardData", { value: cb });
  act(() => { el.dispatchEvent(ev); });
}
const haiHang = () => [
  mk({ name: "Backdrop", unitPrice: 250000, ns: "Anh Tuấn", chungTu: "VAT", luuKho: true }),
  mk({ name: "Standee", unitPrice: 90000, ns: "Chị Lan", chungTu: "TM", luuKho: false }),
];

describe("bảng nội bộ — dán khối Hạng Mục LỆCH CỘT không thay hạng mục của đích", () => {
  // FIELDS của lưới thử: _stt · name · unit · quantity · unitPrice · notes · ns.
  it("khối Hạng Mục → Đơn giá dán bắt đầu ở ô ĐVT: tên đích giữ nguyên → giữ cả ba trường của đích", () => {
    const items = haiHang();
    moLuoi(items);
    chonKhoi(0, 3);
    danVaoO(1, "unit", chepKhoi());
    const b = items[1] as NB;
    expect([b.name, b.unit], "dán theo vị trí kiểu Excel: tên nguồn rơi vào ĐVT").toEqual(["Standee", "Backdrop"]);
    expect(baTruong(b), "Standee vẫn là Standee mà nhận NS / chứng từ / lưu kho của Backdrop").toEqual(["Chị Lan", "TM", false]);
  });

  it("CẮT lệch cột: đích giữ ba trường của nó; hàng nguồn đã mất tên + tiền thì về mặc định (như Delete)", () => {
    const items = [...haiHang(), mk({ name: "" })];
    moLuoi(items);
    chonKhoi(0, 3);
    danVaoO(1, "unit", chepKhoi(true));
    const [a, b] = items as NB[];
    expect(baTruong(b)).toEqual(["Chị Lan", "TM", false]);
    expect(a.name).toBe("");
    expect(baTruong(a), "hàng nguồn trống mà còn NS · VAT · lưu kho").toEqual([null, null, false]);
  });

  it("dán ĐÚNG cột (bắt đầu ở Hạng Mục) vẫn thay ba trường — mốc so của bài trên", () => {
    const items = haiHang();
    moLuoi(items);
    chonKhoi(0, 3);
    danVaoO(1, "name", chepKhoi());
    expect(baTruong(items[1] as NB)).toEqual(["Anh Tuấn", "VAT", true]);
  });
});

describe("bảng nội bộ — Ctrl+D / ô vuông điền chép hạng mục xuống thì ba trường đi theo", () => {
  it("Ctrl+D khối Hạng Mục → Đơn giá: hàng dưới thành Backdrop VÀ mang NS · chứng từ · lưu kho của Backdrop", () => {
    const items = haiHang();
    moLuoi(items);
    chonKhoi(0, 3);
    bam({ key: "ArrowDown", shiftKey: true });
    bam({ key: "d", ctrlKey: true });
    const b = items[1] as NB;
    expect([b.name, b.unitPrice]).toEqual(["Backdrop", 250000]);
    expect(baTruong(b), "Backdrop mà vẫn mang Chị Lan · TM · không lưu kho của Standee").toEqual(["Anh Tuấn", "VAT", true]);
    // mốc hoàn tác: một Ctrl+Z trả cả chữ lẫn ba trường
    bam({ key: "z", ctrlKey: true });
    expect([items[1].name, ...baTruong(items[1] as NB)]).toEqual(["Standee", "Chị Lan", "TM", false]);
  });

  it("Ctrl+D khối trải tới cột NS: chứng từ / lưu kho cũng theo NS, không nửa nguồn nửa đích", () => {
    const items = haiHang();
    moLuoi(items);
    chonKhoi(0, 5);
    bam({ key: "ArrowDown", shiftKey: true });
    bam({ key: "d", ctrlKey: true });
    expect(baTruong(items[1] as NB)).toEqual(["Anh Tuấn", "VAT", true]);
  });

  it("nhấp đúp ô vuông điền (chép tới hàng cuối): hàng thường nhận ba trường, hàng NHÓM ở giữa không giữ ba trường ẩn", () => {
    const items = [
      mk({ name: "Backdrop", unitPrice: 250000, ns: "Anh Tuấn", chungTu: "VAT", luuKho: true }),
      mk({ name: "NHÓM", kind: "section", ns: "rác", chungTu: "HDNS", luuKho: true } as Partial<NB>),
      mk({ name: "Standee", unitPrice: 90000, ns: "Chị Lan", chungTu: "TM", luuKho: false }),
    ];
    moLuoi(items);
    chonKhoi(0, 3);
    const h = hop!.querySelector(".fill-handle") as HTMLElement;
    expect(h, "ô vuông điền").toBeTruthy();
    act(() => { h.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true })); });
    expect([items[2].name, ...baTruong(items[2] as NB)]).toEqual(["Backdrop", "Anh Tuấn", "VAT", true]);
    expect([items[1].kind, ...baTruong(items[1] as NB)]).toEqual(["section", null, null, false]);
  });

  it("Ctrl+D chỉ cột Hạng Mục (sửa chữ, không cột tiền) thì không đụng ba trường — biên của luật", () => {
    const items = haiHang();
    moLuoi(items);
    act(() => { o(0).focus(); });
    bam({ key: "ArrowDown", shiftKey: true });
    bam({ key: "d", ctrlKey: true });
    expect([items[1].name, ...baTruong(items[1] as NB)]).toEqual(["Backdrop", "Chị Lan", "TM", false]);
  });
});

describe("bảng nội bộ — Delete khối hạng mục xoá luôn ba trường", () => {
  it("Shift+Space cả hàng rồi Delete: hàng trống không còn VAT · lưu kho", () => {
    const items = haiHang();
    moLuoi(items);
    act(() => { o(0).focus(); });
    bam({ key: " ", code: "Space", shiftKey: true });
    bam({ key: "Delete" });
    const a = items[0] as NB;
    expect([a.name, a.unitPrice]).toEqual(["", 0]);
    expect(baTruong(a), "xoá sạch hàng mà còn 'VAT · lưu kho'").toEqual([null, null, false]);
    // ô chọn / ô tích trên màn cũng về
    const sel = hop!.querySelector('tr[data-row="0"] td.col-chung-tu select') as HTMLSelectElement;
    const tk = hop!.querySelector('tr[data-row="0"] td.col-luu-kho input') as HTMLInputElement;
    expect([sel.value, tk.checked]).toEqual(["", false]);
    bam({ key: "z", ctrlKey: true });
    expect([items[0].name, ...baTruong(items[0] as NB)]).toEqual(["Backdrop", "Anh Tuấn", "VAT", true]);
  });

  it("Delete khối Hạng Mục + ĐVT (chỉ chữ) thì giữ ba trường — biên của luật", () => {
    const items = haiHang();
    moLuoi(items);
    chonKhoi(0, 1);
    bam({ key: "Delete" });
    const a = items[0] as NB;
    expect([a.name, a.unit]).toEqual(["", ""]);
    expect(baTruong(a)).toEqual(["Anh Tuấn", "VAT", true]);
  });
});
