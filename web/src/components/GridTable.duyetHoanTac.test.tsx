/** @vitest-environment jsdom */
/**
 * ============================================================================
 * CỘT DUYỆT (bảng HCM / Phí KH) + Ctrl+Z — soát toàn diện L2.
 *
 * Ô Duyệt là checkbox KHÔNG kiểm soát (`defaultChecked`) và toggleApprove không ghi mốc hoàn tác.
 * Người duyệt sửa một ô, tích Duyệt, rồi Ctrl+Z: restore() đưa model về approved=false, dòng vẽ lại
 * và React ghi `defaultChecked=false` — nhưng người dùng đã bấm ô (dirty checkedness, chuẩn HTML)
 * nên ô VẪN hiện ✓. Bấm Lưu thì máy chủ nhận approved=false, còn extraTableSum chỉ cộng hàng ĐÃ
 * duyệt → chi phí HCM/Phí KH lưu xuống ngược với cái đang thấy. Không có mốc undo riêng nên Ctrl+Z
 * còn lùi luôn cả lần sửa ô trước đó.
 * ============================================================================
 */
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

const mk = (o: Partial<ItemK>): ItemK =>
  ({ _k: nextK(), kind: "item", name: "", detail: "", unit: "m2", quantity: 1, days: 1, unitPrice: 1000, notes: "", ...o }) as ItemK;

let root: Root | null = null;
let hop: HTMLDivElement | null = null;
afterEach(async () => {
  await act(async () => { await new Promise((r) => setTimeout(r, 220)); });
  if (root) act(() => root!.unmount());
  hop?.remove(); root = null; hop = null; document.body.innerHTML = "";
});

/** Như ExtraTables: onChange vẽ lại (redraw), không khai dataVersion. */
function Vo({ items }: { items: ItemK[] }) {
  const [, buoc] = useState(0);
  return (
    <GridTable items={items} usesDays={false} showDetail={false} numberSubs={false} editable
      internalNote approveCol canApprove groupSubtotal={false} onChange={() => buoc((v) => v + 1)} />
  );
}
function moLuoi(items: ItemK[]) {
  hop = document.createElement("div");
  document.body.appendChild(hop);
  root = createRoot(hop);
  act(() => root!.render(<Vo items={items} />));
}
const o = (row: number, f: string) => hop!.querySelector(`tr[data-row="${row}"] [data-f="${f}"]`) as HTMLInputElement & HTMLTextAreaElement;
const tich = (row: number) => hop!.querySelector(`tr[data-row="${row}"] td.col-approve input`) as HTMLInputElement;
const phim = (el: Element, init: KeyboardEventInit) => act(() => { el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init })); });
const cho = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

/** Sửa tên hàng 1 rồi rời ô → có một mốc hoàn tác CŨ HƠN thao tác duyệt. */
async function suaTenHang1() {
  const el = o(1, "name");
  act(() => { el.focus(); });
  phim(el, { key: "B" });
  act(() => { el.value = "B2"; el.dispatchEvent(new Event("input", { bubbles: true })); });
  act(() => { el.blur(); });
  await cho(250);
}

describe("L2 — ô Duyệt luôn khớp model sau Ctrl+Z / Ctrl+Y", () => {
  it("tích Duyệt rồi Ctrl+Z: ô hết tích, và CHỈ lùi thao tác duyệt (giữ lần sửa tên trước đó)", async () => {
    const items = [mk({ name: "A" }), mk({ name: "B" })];
    moLuoi(items);
    await suaTenHang1();
    act(() => { tich(0).click(); });
    expect(items[0].approved).toBe(true);
    expect(tich(0).checked).toBe(true);

    act(() => { o(0, "unit").focus(); });
    phim(o(0, "unit"), { key: "z", ctrlKey: true });
    expect(!!items[0].approved).toBe(false);
    expect(tich(0).checked, "ô tích vẫn hiện ĐÃ DUYỆT trong khi model = chưa duyệt").toBe(false);
    expect(items[1].name, "Ctrl+Z lùi luôn cả lần sửa ô trước thao tác duyệt").toBe("B2");

    phim(o(0, "unit"), { key: "y", ctrlKey: true });
    expect(items[0].approved).toBe(true);
    expect(tich(0).checked, "Ctrl+Y: model đã duyệt mà ô không tích").toBe(true);
  });

  it("bỏ tích một hàng ĐÃ duyệt rồi Ctrl+Z: model về đã duyệt và ô hiện tích lại", async () => {
    const items = [mk({ name: "A", approved: true, approvedAt: "2026-09-01T00:00:00.000Z" }), mk({ name: "B" })];
    moLuoi(items);
    await suaTenHang1();
    expect(tich(0).checked).toBe(true);
    act(() => { tich(0).click(); });
    expect(!!items[0].approved).toBe(false);
    expect(tich(0).checked).toBe(false);

    act(() => { o(0, "unit").focus(); });
    phim(o(0, "unit"), { key: "z", ctrlKey: true });
    expect(items[0].approved).toBe(true);
    expect(tich(0).checked, "model đã duyệt lại mà ô vẫn trống").toBe(true);
  });
});

// ── BA CỘT CỦA BẢNG NỘI BỘ: NS · CHỨNG TỪ · LƯU KHO (2026-09-25) ────────────────────────────
// Cùng tệp với cột Duyệt vì cùng loại: cột chỉ bảng nội bộ bật, ô tích/chọn không đi qua đường gõ ô.
function VoNoiBo({ items, cotNoiBo }: { items: ItemK[]; cotNoiBo: boolean }) {
  const [, buoc] = useState(0);
  return (
    <GridTable items={items} usesDays={false} showDetail={false} numberSubs={false} editable
      internalNote={false} approveCol canApprove cotNoiBo={cotNoiBo} groupSubtotal={false} onChange={() => buoc((v) => v + 1)} />
  );
}
function moLuoiNoiBo(items: ItemK[], cotNoiBo = true) {
  hop = document.createElement("div");
  document.body.appendChild(hop);
  root = createRoot(hop);
  act(() => root!.render(<VoNoiBo items={items} cotNoiBo={cotNoiBo} />));
}
const tieuDe = () => [...hop!.querySelectorAll("thead th")].map((th) => (th.textContent || "").trim());

describe("bảng nội bộ: cột NS · CHỨNG TỪ · LƯU KHO", () => {
  it("chỉ hiện khi bật cotNoiBo, đứng sau GHI CHÚ và trước DUYỆT", () => {
    moLuoiNoiBo([mk({ name: "Nước suối" })]);
    const td = tieuDe();
    expect(td.slice(td.indexOf("GHI CHÚ"), td.indexOf("DUYỆT") + 1)).toEqual(["GHI CHÚ", "NS", "CHỨNG TỪ", "LƯU KHO", "DUYỆT"]);
  });

  it("lưới không bật (lưới chính) thì không có ba cột", async () => {
    moLuoiNoiBo([mk({ name: "A" })], false);
    expect(tieuDe()).not.toContain("NS");
    expect(tieuDe()).not.toContain("LƯU KHO");
  });

  it("tích Lưu kho, chọn Chứng từ, gõ NS → ghi đúng vào hàng", () => {
    const items = [mk({ name: "Nước suối" })];
    moLuoiNoiBo(items);
    const kho = hop!.querySelector('tr[data-row="0"] td.col-luu-kho input') as HTMLInputElement;
    act(() => { kho.click(); });
    expect(items[0].luuKho).toBe(true);
    expect(kho.checked).toBe(true);

    const chon = hop!.querySelector('tr[data-row="0"] td.col-chung-tu select') as HTMLSelectElement;
    expect([...chon.options].map((x) => x.textContent)).toEqual(["—", "VAT", "HĐNS", "TM"]);
    act(() => { chon.value = "HDNS"; chon.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(items[0].chungTu).toBe("HDNS");
    act(() => { chon.value = ""; chon.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(items[0].chungTu).toBeNull();

    const ns = o(0, "ns");
    expect(ns, "ô NS phải là ô chữ của lưới (điều hướng / chép / dán được)").toBeTruthy();
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(ns, "Tiên ứng");
      ns.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(items[0].ns).toBe("Tiên ứng");
  });

  it("hàng nhóm không có ô tích / ô chọn (không có gì để lưu kho hay chứng từ)", () => {
    moLuoiNoiBo([mk({ kind: "section", name: "NHÓM A" }), mk({ name: "Hàng" })]);
    expect(hop!.querySelector('tr[data-row="0"] td.col-luu-kho input')).toBeNull();
    expect(hop!.querySelector('tr[data-row="0"] td.col-chung-tu select')).toBeNull();
    expect(hop!.querySelector('tr[data-row="1"] td.col-luu-kho input')).toBeTruthy();
  });
});

// ── Ô CHỌN / Ô TÍCH trong điều hướng bàn phím + Ctrl+Z (2026-09-29) ─────────────────────────────
// onGridKeyDown chỉ nhận ô có data-f, nên CHỨNG TỪ / LƯU KHO / DUYỆT nằm ngoài bàn phím: → từ ô NS không
// tới được chúng, và đứng ở đó bấm Ctrl+Z thì không có gì xảy ra (phải bấm sang ô chữ mới lùi được).
function VoOc({ items, canApprove = true }: { items: ItemK[]; canApprove?: boolean }) {
  const [, buoc] = useState(0);
  return (
    <GridTable items={items} usesDays={false} showDetail={false} numberSubs={false} editable
      internalNote={false} approveCol canApprove={canApprove} cotNoiBo groupSubtotal={false} onChange={() => buoc((v) => v + 1)} />
  );
}
function moLuoiOc(items: ItemK[], canApprove = true) {
  hop = document.createElement("div");
  document.body.appendChild(hop);
  root = createRoot(hop);
  act(() => root!.render(<VoOc items={items} canApprove={canApprove} />));
}
const oc = (row: number, ten: string) => hop!.querySelector(`tr[data-row="${row}"] [data-oc="${ten}"]`) as HTMLInputElement & HTMLSelectElement;
const dangO = () => document.activeElement;
/** Bấm một phím ở ô ĐANG có tiêu điểm; trả về sự kiện để xem có bị chặn mặc định không. */
const bam = (init: KeyboardEventInit) => {
  const ev = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  act(() => { (document.activeElement as HTMLElement).dispatchEvent(ev); });
  return ev;
};
type NB = ItemK & { ns?: string | null; luuKho?: boolean; chungTu?: string | null };

describe("ô CHỨNG TỪ / LƯU KHO / DUYỆT nằm trong điều hướng mũi tên", () => {
  it("→ từ ô NS đi qua CHỨNG TỪ → LƯU KHO → DUYỆT (hết thì đứng yên); ← quay về tới ô NS", () => {
    moLuoiOc([mk({ name: "Nước suối" })]);
    act(() => { o(0, "ns").focus(); });
    bam({ key: "ArrowRight" });
    expect(dangO(), "→ ở ô NS không sang được ô Chứng từ").toBe(oc(0, "chungTu"));
    bam({ key: "ArrowRight" });
    expect(dangO()).toBe(oc(0, "luuKho"));
    bam({ key: "ArrowRight" });
    expect(dangO()).toBe(oc(0, "approved"));
    bam({ key: "ArrowRight" });
    expect(dangO(), "ô cuối hàng — đứng yên").toBe(oc(0, "approved"));
    bam({ key: "ArrowLeft" }); bam({ key: "ArrowLeft" });
    expect(dangO()).toBe(oc(0, "chungTu"));
    bam({ key: "ArrowLeft" });
    expect(dangO(), "← ở ô Chứng từ phải về ô chữ NS").toBe(o(0, "ns"));
  });

  it("↑/↓ đi cùng cột, bỏ qua hàng nhóm (không có ô); mũi tên KHÔNG đổi chứng từ đang chọn", () => {
    const items = [mk({ name: "A", chungTu: "VAT" } as Partial<NB>), mk({ kind: "section", name: "NHÓM" }), mk({ name: "B", chungTu: "TM" } as Partial<NB>)];
    moLuoiOc(items);
    act(() => { oc(0, "chungTu").focus(); });
    const ev = bam({ key: "ArrowDown" });
    expect(ev.defaultPrevented, "để mặc định thì <select> đổi sang chứng từ kế tiếp").toBe(true);
    expect(dangO()).toBe(oc(2, "chungTu"));
    bam({ key: "ArrowUp" });
    expect(dangO()).toBe(oc(0, "chungTu"));
    expect([(items[0] as NB).chungTu, (items[2] as NB).chungTu]).toEqual(["VAT", "TM"]);
    act(() => { oc(0, "luuKho").focus(); });
    bam({ key: "ArrowDown", ctrlKey: true });
    expect(dangO(), "Ctrl+↓ nhảy tới ô cùng cột ở hàng cuối").toBe(oc(2, "luuKho"));
  });

  it("Alt+↓ ở ô chọn để trình duyệt mở danh sách (không bị chặn)", () => {
    moLuoiOc([mk({ name: "A" })]);
    act(() => { oc(0, "chungTu").focus(); });
    expect(bam({ key: "ArrowDown", altKey: true }).defaultPrevented).toBe(false);
    expect(dangO()).toBe(oc(0, "chungTu"));
  });

  it("ô Duyệt khoá (không có quyền duyệt) thì bàn phím đi qua, không kẹt ở đó", () => {
    moLuoiOc([mk({ name: "A" })], false);
    act(() => { oc(0, "luuKho").focus(); });
    bam({ key: "ArrowRight" });
    expect(dangO()).toBe(oc(0, "luuKho"));
  });
});

describe("Ctrl+Z / Ctrl+Y khi đang đứng ở ô chọn / ô tích", () => {
  it("chọn Chứng từ rồi Ctrl+Z NGAY tại ô đó: model và ô cùng về trước; Ctrl+Y làm lại", () => {
    const items = [mk({ name: "A" })];
    moLuoiOc(items);
    const chon = oc(0, "chungTu");
    act(() => { chon.focus(); });
    act(() => { chon.value = "HDNS"; chon.dispatchEvent(new Event("change", { bubbles: true })); });
    expect((items[0] as NB).chungTu).toBe("HDNS");
    bam({ key: "z", ctrlKey: true });
    expect((items[0] as NB).chungTu ?? null, "Ctrl+Z ở ô chọn không làm gì").toBeNull();
    expect(oc(0, "chungTu").value).toBe("");
    bam({ key: "y", ctrlKey: true });
    expect((items[0] as NB).chungTu).toBe("HDNS");
    expect(oc(0, "chungTu").value).toBe("HDNS");
  });

  it("tích Lưu kho rồi Ctrl+Z tại ô tích: bỏ tích cả model lẫn ô", () => {
    const items = [mk({ name: "A" })];
    moLuoiOc(items);
    act(() => { oc(0, "luuKho").focus(); });
    act(() => { oc(0, "luuKho").click(); });
    expect((items[0] as NB).luuKho).toBe(true);
    bam({ key: "z", ctrlKey: true });
    expect(!!(items[0] as NB).luuKho).toBe(false);
    expect(oc(0, "luuKho").checked).toBe(false);
  });

  it("ô DUYỆT cùng gốc lỗi: tích rồi Ctrl+Z tại chính ô Duyệt", async () => {
    const items = [mk({ name: "A" }), mk({ name: "B" })];
    moLuoiOc(items);
    await suaTenHang1();
    act(() => { oc(0, "approved").focus(); });
    act(() => { oc(0, "approved").click(); });
    expect(items[0].approved).toBe(true);
    bam({ key: "z", ctrlKey: true });
    expect(!!items[0].approved, "Ctrl+Z ở ô Duyệt không làm gì").toBe(false);
    expect(oc(0, "approved").checked).toBe(false);
    expect(items[1].name, "chỉ lùi thao tác duyệt").toBe("B2");
  });

  it("dán khi đang đứng ở ô chọn không ghi vào ô chữ nào (không có ô nào đang được chọn để nhận)", () => {
    const items = [mk({ name: "A", notes: "giữ" })];
    moLuoiOc(items);
    act(() => { o(0, "notes").focus(); });
    bam({ key: "ArrowRight" });   // Ghi chú → NS
    bam({ key: "ArrowRight" });   // NS → Chứng từ
    expect(dangO()).toBe(oc(0, "chungTu"));
    const ev = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(ev, "clipboardData", { value: { getData: (k: string) => (k === "text/plain" ? "CHỮ DÁN" : "") } });
    act(() => { oc(0, "chungTu").dispatchEvent(ev); });
    expect([items[0].name, items[0].notes, (items[0] as NB).ns ?? ""]).toEqual(["A", "giữ", ""]);
  });
});
