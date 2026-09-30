/** @vitest-environment jsdom */
/**
 * ============================================================================
 * Ô TÍCH "HIỆN THÀNH TIỀN NHÓM" — CÓ NHÓM SỐ LƯỢNG > 1 THÌ TỰ BẬT VÀ KHOÁ LẠI.
 *
 * Người dùng (2026-09-30): "nếu có số lượng thì tính năng Thành Tiền nhóm tự động bật và lock nút đó lại".
 *
 * TẠI SAO PHẢI KHOÁ: `sheetSubtotalGrouped` chỉ nhân Số Lượng nhóm vào tiền các mục con khi ô này BẬT;
 * tắt thì ép hệ số = 1. Tự bật đã có từ trước (gõ · dán · kéo điền — GridTable.autoEnableGroupSub) nhưng
 * ô vẫn bỏ tích được: nhóm "SL 3" thành tổng nhỏ hơn thật đúng 3 lần mà không ai báo một lời.
 *
 * LUẬT (mỗi describe khoá một vế):
 *   · còn ít nhất một nhóm / nhóm con SL > 1 VÀ ô đang bật → ô hiện "đã tích", BỊ KHOÁ (disabled +
 *     aria-disabled, có lý do bằng chữ);
 *   · không còn nhóm SL > 1 → ô tự do lại và GIỮ trạng thái đang có (không tự tắt);
 *   · khoá KHÔNG chặn người dùng đưa SL nhóm về 1;
 *   · Ctrl+Z / Ctrl+Y không được để lại "tắt + nhóm SL > 1";
 *   · báo giá CŨ đã lưu "tắt + nhóm SL > 1": mở ra KHÔNG tự bật, KHÔNG khoá (tự bật lúc mở = đổi tổng
 *     của báo giá cũ = đụng tiền);
 *   · chỉ xem: không có ô tích;
 *   · ExtraTables (Chi phí HCM / Phí khách hàng) và HnTables (Hà Nội) dùng CHÍNH lưới này → cũng khoá.
 * ============================================================================
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { GridTable, type GridTableProps } from "./GridTable";
import { ExtraTables, type ExtraTable } from "./ExtraTables";
import { HnTables, type HnTable } from "./HnTables";
import * as M from "../lib/quoteMath";
import { nextK, type ItemK } from "../lib/gridShared";
import { LY_DO_KHOA_NHOM } from "../lib/khoaThanhTienNhom";
import type { EditorTemplate } from "../lib/api";

vi.mock("../lib/venueCatalog", async (g) => ({ ...(await g<typeof import("../lib/venueCatalog")>()), loadCatalog: () => Promise.resolve({ entries: [], venues: [] }) }));
vi.mock("../lib/ui", async (g) => ({ ...(await g<typeof import("../lib/ui")>()), toast: () => {}, confirmModal: async () => true }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ── giàn dựng ────────────────────────────────────────────────────────────────

const mk = (o: Partial<ItemK>): ItemK =>
  ({ _k: nextK(), kind: "item", name: "", unit: "", quantity: 0, days: null, unitPrice: 0, notes: "", ...o }) as ItemK;
const nhom = (o: Partial<ItemK> = {}): ItemK => mk({ kind: "section", name: "Nhóm", quantity: 1, ...o });
const nhomCon = (o: Partial<ItemK> = {}): ItemK => mk({ kind: "subsection", name: "Nhóm con", quantity: 1, ...o });
const muc = (o: Partial<ItemK> = {}): ItemK => mk({ name: "Backdrop", unit: "m2", quantity: 2, unitPrice: 100_000, ...o });

const hops: HTMLDivElement[] = [];
const roots: Root[] = [];
afterEach(async () => {
  await act(async () => { await new Promise((r) => setTimeout(r, 220)); });   // cho hẹn giờ vẽ-hoãn 180ms nổ trong act
  for (const r of roots.splice(0)) act(() => r.unmount());
  for (const h of hops.splice(0)) h.remove();
  document.body.innerHTML = "";
});

/** Cha THẬT như QuoteEditor / ExtraTables: giữ cờ `groupSubtotal` trong state (đổi thì vẽ lại lưới) và
 *  báo mọi lần lưới gọi `onGroupSubtotal` cho `ghiCo`. */
function Vo({ items, batDau, ghiCo, them }: { items: ItemK[]; batDau: boolean; ghiCo: (v: boolean) => void; them: Partial<GridTableProps> }) {
  const [gs, setGs] = useState(batDau);
  const [, b] = useState(0);
  return <GridTable items={items} usesDays={false} showDetail={false} numberSubs={false} editable internalNote={false}
    groupSubtotal={gs} onGroupSubtotal={(v) => { ghiCo(v); setGs(v); }} onChange={() => b((x) => x + 1)} {...them} />;
}

function moLuoi(items: ItemK[], batDau: boolean, them: Partial<GridTableProps> = {}) {
  const hop = document.createElement("div"); document.body.appendChild(hop); hops.push(hop);
  const root = createRoot(hop); roots.push(root);
  const ghiCo = vi.fn<(v: boolean) => void>();
  act(() => root.render(<Vo items={items} batDau={batDau} ghiCo={ghiCo} them={them} />));
  return {
    ghiCo,
    o: (row: number, f: string) => hop.querySelector(`tr[data-row="${row}"] [data-f="${f}"]`) as HTMLInputElement & HTMLTextAreaElement,
    hop,
  };
}

/** Ô tích "Hiện Thành Tiền nhóm" trong một vùng (mặc định: cả trang). */
const oTich = (goc: ParentNode = document) => goc.querySelector<HTMLInputElement>("label.gf-group-sub input[type=\"checkbox\"]");
const lyDo = (goc: ParentNode = document) => goc.querySelector<HTMLElement>(".gf-group-sub-ly-do");

const xaHen = () => act(async () => { await new Promise((r) => setTimeout(r, 220)); });
const vao = (el: HTMLElement) => act(() => { el.focus(); });
const phim = (el: Element, key: string, mo: { ctrl?: boolean } = {}) =>
  act(() => { el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ctrlKey: !!mo.ctrl })); });
/** Gõ vào ô như trình duyệt: đặt value rồi bắn `input`. */
const go = (el: HTMLInputElement | HTMLTextAreaElement, chu: string) => act(() => { el.value = chu; el.dispatchEvent(new Event("input", { bubbles: true })); });
/** Gõ + CHỐT ô (Enter) + chờ vẽ-hoãn — một thao tác sửa hoàn chỉnh, để mỗi lần sửa là một mốc hoàn tác. */
async function nhapSL(el: () => HTMLInputElement, chu: string) {
  vao(el()); go(el(), chu); phim(el(), "Enter"); await xaHen();
}
/** DÁN văn bản thường vào ô đang focus. */
const dan = (text: string) => act(() => {
  const ev = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "clipboardData", { value: { getData: (k: string) => (k === "text/plain" || k === "text" ? text : "") } });
  document.activeElement!.dispatchEvent(ev);
});
const bam = (el: HTMLElement) => act(() => { el.click(); });

// ── (1) KHOÁ khi có nhóm SL > 1 ──────────────────────────────────────────────

describe("ô Thành Tiền nhóm bị KHOÁ khi còn nhóm SL > 1", () => {
  it("NHÓM (section) SL 2, ô đang bật → hiện đã tích, disabled + aria-disabled, có lý do bằng chữ", () => {
    const { ghiCo, hop } = moLuoi([nhom({ quantity: 2 }), muc()], true);
    const tich = oTich()!;
    expect(tich.checked, "ô phải hiện ĐÃ TÍCH").toBe(true);
    expect(tich.disabled, "ô phải bị khoá").toBe(true);
    expect(tich.getAttribute("aria-disabled")).toBe("true");
    expect(tich.closest("label")!.getAttribute("title")).toBe(LY_DO_KHOA_NHOM);
    expect(lyDo(hop)?.textContent).toBe(LY_DO_KHOA_NHOM);
    expect(lyDo(hop)?.id, "dòng lý do phải được ô tích trỏ tới (trợ năng)").toBe(tich.getAttribute("aria-describedby"));
    expect(tich.closest("label")!.style.cursor).toBe("not-allowed");
    expect(ghiCo).not.toHaveBeenCalled();
  });

  it("NHÓM CON (subsection) SL 3 cũng khoá — dù nhóm cha SL 1", () => {
    moLuoi([nhom({ quantity: 1 }), nhomCon({ quantity: 3 }), muc()], true);
    const tich = oTich()!;
    expect([tich.checked, tich.disabled]).toEqual([true, true]);
  });

  it("SL nhóm lẻ 1,5 (nhân thật vào tiền) cũng khoá", () => {
    moLuoi([nhom({ quantity: 1.5 }), muc()], true);
    expect(oTich()!.disabled).toBe(true);
  });

  it("bấm vào ô đã khoá KHÔNG bỏ tích và KHÔNG báo cha (kể cả khi sự kiện lọt vào ô)", () => {
    const { ghiCo } = moLuoi([nhom({ quantity: 2 }), muc()], true);
    const tich = oTich()!;
    bam(tich);
    expect(tich.checked).toBe(true);
    expect(ghiCo).not.toHaveBeenCalled();
    // Phòng thủ tầng hai: tắt `disabled` bằng tay rồi bấm — bộ xử lý vẫn phải từ chối.
    act(() => { tich.disabled = false; tich.click(); });
    expect(ghiCo, "onChange lọt qua ô đã khoá").not.toHaveBeenCalledWith(false);
  });

  it("nhóm SL 1 (hoặc bỏ trống, hoặc 1,04 — hiện là '1') KHÔNG khoá; hàng mục SL > 1 không tính", () => {
    for (const items of [[nhom({ quantity: 1 }), muc({ quantity: 9 })], [nhom({ quantity: 0 }), muc()], [nhom({ quantity: 1.04 }), muc()]]) {
      const { hop } = moLuoi(items, true);
      const tich = oTich(hop)!;
      expect([tich.checked, tich.disabled, lyDo(hop)], JSON.stringify(items.map((x) => x.quantity))).toEqual([true, false, null]);
    }
  });

  it("ô đang TẮT thì không khoá dù có nhóm SL > 1 (báo giá cũ — xem describe 'báo giá CŨ')", () => {
    moLuoi([nhom({ quantity: 2 }), muc()], false);
    const tich = oTich()!;
    expect([tich.checked, tich.disabled]).toEqual([false, false]);
  });
});

// ── (2) TỰ BẬT rồi KHOÁ ngay ─────────────────────────────────────────────────

describe("tự bật vẫn chạy như cũ, và bật xong là khoá ngay", () => {
  it("gõ SL nhóm = 2 khi ô đang tắt → bật, rồi khoá (không cần thêm thao tác)", async () => {
    const items = [nhom({ quantity: 1 }), muc()];
    const { o, ghiCo } = moLuoi(items, false);
    expect(oTich()!.disabled, "chưa có nhóm SL > 1 thì ô còn tự do").toBe(false);
    vao(o(0, "quantity")); go(o(0, "quantity"), "2");
    expect(ghiCo).toHaveBeenCalledWith(true);
    await xaHen();
    const tich = oTich()!;
    expect([tich.checked, tich.disabled]).toEqual([true, true]);
  });

  it("gõ SL 2 cho NHÓM CON cũng tự bật rồi khoá", async () => {
    const { o } = moLuoi([nhom(), nhomCon(), muc()], false);
    vao(o(1, "quantity")); go(o(1, "quantity"), "2");
    await xaHen();
    const tich = oTich()!;
    expect([tich.checked, tich.disabled]).toEqual([true, true]);
  });

  it("DÁN SL 3 vào ô SL của nhóm khi ô đang tắt → bật rồi khoá", async () => {
    const items = [nhom(), muc()];
    const { o, ghiCo } = moLuoi(items, false);
    vao(o(0, "quantity"));
    dan("3");
    expect(items[0].quantity).toBe(3);
    expect(ghiCo).toHaveBeenCalledWith(true);
    await xaHen();
    expect([oTich()!.checked, oTich()!.disabled]).toEqual([true, true]);
  });

  it("gõ SL 1 (hay 0) cho nhóm KHÔNG tự bật, không khoá", async () => {
    const { o, ghiCo } = moLuoi([nhom({ quantity: 0 }), muc()], false);
    await nhapSL(() => o(0, "quantity"), "1");
    expect(ghiCo).not.toHaveBeenCalled();
    expect([oTich()!.checked, oTich()!.disabled]).toEqual([false, false]);
  });
});

// ── (3) NHẢ KHOÁ khi SL nhóm về 1, GIỮ trạng thái ────────────────────────────

describe("SL nhóm về 1 thì nhả khoá và GIỮ trạng thái đang bật", () => {
  it("khoá KHÔNG chặn ô SL nhóm; đưa về 1 → ô tự do lại, vẫn đang tích (không tự tắt)", async () => {
    const items = [nhom({ quantity: 2 }), muc()];
    const { o, ghiCo } = moLuoi(items, true);
    expect(oTich()!.disabled).toBe(true);
    expect(o(0, "quantity").disabled, "khoá không được chặn ô SL của nhóm").toBe(false);
    await nhapSL(() => o(0, "quantity"), "1");
    expect(items[0].quantity).toBe(1);
    const tich = oTich()!;
    expect([tich.checked, tich.disabled], "nhả khoá nhưng phải giữ trạng thái bật").toEqual([true, false]);
    expect(lyDo(document)).toBeNull();
    expect(ghiCo, "nhả khoá không được tự tắt ô").not.toHaveBeenCalledWith(false);
  });

  it("nhả rồi thì người dùng bỏ tích được; SL nhóm lên lại > 1 thì tự bật + khoá lại", async () => {
    const items = [nhom({ quantity: 2 }), muc()];
    const { o, ghiCo } = moLuoi(items, true);
    await nhapSL(() => o(0, "quantity"), "1");
    bam(oTich()!);
    expect(ghiCo).toHaveBeenLastCalledWith(false);
    expect(oTich()!.checked).toBe(false);
    await nhapSL(() => o(0, "quantity"), "4");
    expect(ghiCo).toHaveBeenLastCalledWith(true);
    expect([oTich()!.checked, oTich()!.disabled]).toEqual([true, true]);
  });

  it("còn MỘT trong hai nhóm SL > 1 thì vẫn khoá; hết cả hai mới nhả", async () => {
    const items = [nhom({ quantity: 2 }), muc(), nhom({ quantity: 3 }), muc()];
    const { o } = moLuoi(items, true);
    await nhapSL(() => o(0, "quantity"), "1");
    expect(oTich()!.disabled, "nhóm thứ hai vẫn SL 3").toBe(true);
    await nhapSL(() => o(2, "quantity"), "1");
    expect(oTich()!.disabled).toBe(false);
  });

  it("xoá nhóm SL > 1 (Delete ô SL) → nhả khoá", async () => {
    const { o } = moLuoi([nhom({ quantity: 2 }), muc()], true);
    vao(o(0, "quantity"));
    phim(o(0, "quantity"), "Delete");
    await xaHen();
    expect(oTich()!.disabled).toBe(false);
  });
});

// ── (4) HOÀN TÁC / LÀM LẠI ───────────────────────────────────────────────────

describe("Ctrl+Z / Ctrl+Y", () => {
  it("gõ SL nhóm 2 (tự bật + khoá) → Ctrl+Z về SL 1: nhả khoá, giữ bật → Ctrl+Y: SL 2, khoá lại", async () => {
    const items = [nhom({ quantity: 1 }), muc()];
    const { o, ghiCo } = moLuoi(items, false);
    await nhapSL(() => o(0, "quantity"), "2");
    expect(oTich()!.disabled).toBe(true);

    vao(o(0, "quantity"));
    phim(o(0, "quantity"), "z", { ctrl: true });
    await xaHen();
    expect(items[0].quantity).toBe(1);
    expect([oTich()!.checked, oTich()!.disabled], "lùi về SL 1: nhả khoá, giữ bật").toEqual([true, false]);

    phim(o(0, "quantity"), "y", { ctrl: true });
    await xaHen();
    expect(items[0].quantity).toBe(2);
    expect([oTich()!.checked, oTich()!.disabled]).toEqual([true, true]);
    expect(ghiCo).not.toHaveBeenCalledWith(false);
  });

  it("nhóm SL 2 → về 1 → BỎ TÍCH → Ctrl+Z trả SL 2: KHÔNG được để 'tắt + SL 2' — tự bật lại và khoá", async () => {
    // Ô tích không nằm trong ảnh chụp hoàn tác (chỉ có items) — đây là đường duy nhất mà tổng sai im lặng
    // có thể lọt vào sau khi đã có khoá: lùi một lần sửa SL nhóm sau khi người dùng đã tắt ô lúc SL = 1.
    const items = [nhom({ quantity: 2 }), muc()];
    const { o, ghiCo } = moLuoi(items, true);
    await nhapSL(() => o(0, "quantity"), "1");
    bam(oTich()!);
    expect(oTich()!.checked).toBe(false);
    ghiCo.mockClear();

    vao(o(0, "quantity"));
    phim(o(0, "quantity"), "z", { ctrl: true });
    await xaHen();
    expect(items[0].quantity).toBe(2);
    expect(ghiCo, "lùi trả SL 2 mà ô vẫn tắt").toHaveBeenCalledWith(true);
    expect([oTich()!.checked, oTich()!.disabled]).toEqual([true, true]);
  });

  it("LÀM LẠI (Ctrl+Y) đưa SL nhóm > 1 vào khi ô đang tắt cũng tự bật lại", async () => {
    const items = [nhom({ quantity: 1 }), muc()];
    const { o, ghiCo } = moLuoi(items, false);
    await nhapSL(() => o(0, "quantity"), "3");          // tự bật
    vao(o(0, "quantity"));
    phim(o(0, "quantity"), "z", { ctrl: true });        // SL 1, ô vẫn bật
    await xaHen();
    bam(oTich()!);                                      // người dùng tắt (được phép: đang SL 1)
    expect(oTich()!.checked).toBe(false);
    ghiCo.mockClear();
    vao(o(0, "quantity"));
    phim(o(0, "quantity"), "y", { ctrl: true });        // tiến → SL 3
    await xaHen();
    expect(items[0].quantity).toBe(3);
    expect(ghiCo).toHaveBeenCalledWith(true);
    expect([oTich()!.checked, oTich()!.disabled]).toEqual([true, true]);
  });

  it("lùi một sửa đổi KHÔNG liên quan trên báo giá cũ (tắt + nhóm SL 3) KHÔNG bật ô", async () => {
    // Hàng thứ ba để Enter ở hàng 1 đi XUỐNG (Enter ở hàng CUỐI thì chèn hàng mới — thêm một mốc hoàn tác).
    const items = [nhom({ quantity: 3 }), muc({ unitPrice: 100_000 }), muc()];
    const { o, ghiCo } = moLuoi(items, false);
    await nhapSL(() => o(1, "unitPrice"), "250.000");
    expect(items[1].unitPrice).toBe(250_000);
    vao(o(1, "unitPrice"));
    phim(o(1, "unitPrice"), "z", { ctrl: true });
    await xaHen();
    expect(items[1].unitPrice, "Ctrl+Z phải thật sự lùi (nếu không bài này vô nghĩa)").toBe(100_000);
    expect(ghiCo).not.toHaveBeenCalled();
    expect([oTich()!.checked, oTich()!.disabled]).toEqual([false, false]);
  });
});

// ── (5) BÁO GIÁ CŨ: tắt + nhóm SL > 1 — KHÔNG ĐỤNG DỮ LIỆU ───────────────────

describe("báo giá CŨ đã lưu 'tắt + nhóm SL > 1': giữ nguyên hành vi, không đụng tổng", () => {
  it("mở ra: KHÔNG tự bật, KHÔNG khoá, tổng lưu không đổi", async () => {
    const items = [nhom({ quantity: 3 }), muc()];
    const tongTruoc = M.sheetSubtotalGrouped(items, false, false);
    const { ghiCo } = moLuoi(items, false);
    await xaHen();
    expect(ghiCo, "tự bật lúc MỞ là đổi tổng báo giá cũ").not.toHaveBeenCalled();
    const tich = oTich()!;
    expect([tich.checked, tich.disabled, lyDo()]).toEqual([false, false, null]);
    expect(M.sheetSubtotalGrouped(items, false, false)).toBe(tongTruoc);
  });

  it("sửa MỘT ô không liên quan (SL của hạng mục) cũng không bật ô", async () => {
    const items = [nhom({ quantity: 3 }), muc()];
    const { o, ghiCo } = moLuoi(items, false);
    await nhapSL(() => o(1, "quantity"), "5");
    expect(items[1].quantity).toBe(5);
    expect(ghiCo).not.toHaveBeenCalled();
    expect(oTich()!.checked).toBe(false);
  });

  it("người dùng tự tích thì bật và từ đó bị khoá (còn nhóm SL 3)", () => {
    const { ghiCo } = moLuoi([nhom({ quantity: 3 }), muc()], false);
    bam(oTich()!);
    expect(ghiCo).toHaveBeenCalledWith(true);
    expect([oTich()!.checked, oTich()!.disabled]).toEqual([true, true]);
  });
});

// ── (6) CHỈ XEM ──────────────────────────────────────────────────────────────

describe("chế độ chỉ xem", () => {
  it("editable=false: không có ô tích, dù ô bật và có nhóm SL > 1", () => {
    const { hop } = moLuoi([nhom({ quantity: 2 }), muc()], true, { editable: false });
    expect(oTich(hop)).toBeNull();
    expect(lyDo(hop)).toBeNull();
    expect(hop.textContent).not.toContain("Hiện Thành Tiền nhóm");
  });

  it("không có onGroupSubtotal (như bench / nơi chỉ vẽ): không có ô tích", () => {
    const hop = document.createElement("div"); document.body.appendChild(hop); hops.push(hop);
    const root = createRoot(hop); roots.push(root);
    act(() => root.render(<GridTable items={[nhom({ quantity: 2 }), muc()]} usesDays={false} showDetail={false} numberSubs={false}
      editable internalNote={false} groupSubtotal onChange={() => {}} />));
    expect(oTich(hop)).toBeNull();
  });
});

// ── (7) ExtraTables và HnTables — CÙNG MỘT LƯỚI, CÙNG MỘT KHOÁ ────────────────

const MAU: EditorTemplate[] = [{ id: 1, code: "gn", name: "GN (không ngày)", companyId: 1, layout: { hasDetail: false, reserveDetail: false, hasDays: false, numberSubsections: false } } as EditorTemplate];

function dungThung() {
  const thung = document.createElement("div"); document.body.appendChild(thung); hops.push(thung);
  const goc = createRoot(thung); roots.push(goc);
  return { thung, goc };
}
const oTrong = (thung: HTMLElement, row: number, f: string) => thung.querySelector(`table.excel-table tr[data-row="${row}"] [data-f="${f}"]`) as HTMLInputElement & HTMLTextAreaElement;

describe("ExtraTables (Chi phí HCM · Phí khách hàng)", () => {
  const dung = (t: ExtraTable) => {
    const { thung, goc } = dungThung();
    const danhDau = vi.fn();
    const sheet = { id: 1, templateId: 1, extraTables: [t] };
    act(() => { goc.render(<ExtraTables sheet={sheet} templates={MAU} companyId={1} editable canApprove onMarkDirty={danhDau} />); });
    // Hai khối gập: [0] Chi phí HCM, [1] Phí khách hàng — mở khối chứa bảng đang thử.
    act(() => { (thung.querySelectorAll(".khoi-sheet-nut")[t.category === "khach" ? 1 : 0] as HTMLButtonElement).click(); });
    return { thung, danhDau };
  };

  it("bảng bật + nhóm SL 2 → ô khoá; bảng có nhóm SL 1 → ô tự do", () => {
    const khoa = dung({ category: "hcm", templateId: 1, name: "HCM", groupSubtotal: true, items: [nhom({ quantity: 2 }), muc()] } as unknown as ExtraTable);
    expect([oTich(khoa.thung)!.checked, oTich(khoa.thung)!.disabled]).toEqual([true, true]);
    const tuDo = dung({ category: "khach", templateId: 1, name: "KH", groupSubtotal: true, items: [nhom({ quantity: 1 }), muc()] } as unknown as ExtraTable);
    expect([oTich(tuDo.thung)!.checked, oTich(tuDo.thung)!.disabled]).toEqual([true, false]);
  });

  it("gõ SL nhóm 2 vào bảng đang tắt → ghi vào bảng, báo 'chưa lưu', rồi khoá", async () => {
    const t = { category: "hcm", templateId: 1, name: "HCM", groupSubtotal: false, items: [nhom({ quantity: 1 }), muc()] } as unknown as ExtraTable;
    const { thung, danhDau } = dung(t);
    vao(oTrong(thung, 0, "quantity")); go(oTrong(thung, 0, "quantity"), "2");
    expect(t.groupSubtotal).toBe(true);
    expect(danhDau).toHaveBeenCalled();
    await xaHen();
    expect([oTich(thung)!.checked, oTich(thung)!.disabled]).toEqual([true, true]);
  });

  it("báo giá cũ: bảng tắt + nhóm SL 3 → mở ra không tự bật, không khoá", async () => {
    const t = { category: "hcm", templateId: 1, name: "HCM", groupSubtotal: false, items: [nhom({ quantity: 3 }), muc()] } as unknown as ExtraTable;
    const { thung } = dung(t);
    await xaHen();
    expect(t.groupSubtotal).toBe(false);
    expect([oTich(thung)!.checked, oTich(thung)!.disabled]).toEqual([false, false]);
  });
});

describe("HnTables (Báo giá Hà Nội)", () => {
  const dung = (t: HnTable) => {
    const { thung, goc } = dungThung();
    act(() => { goc.render(<HnTables moMacDinh tables={[t]} templates={MAU} companyId={1} editable onMarkDirty={() => {}} />); });
    return thung;
  };

  it("bảng bật + nhóm CON SL 2 → ô khoá", () => {
    const thung = dung({ templateId: 1, name: "HN", groupSubtotal: true, items: [nhom(), nhomCon({ quantity: 2 }), muc()] } as unknown as HnTable);
    expect([oTich(thung)!.checked, oTich(thung)!.disabled]).toEqual([true, true]);
  });

  it("gõ SL nhóm 2 vào bảng đang tắt → tự bật rồi khoá", async () => {
    const t = { templateId: 1, name: "HN", groupSubtotal: false, items: [nhom({ quantity: 1 }), muc()] } as unknown as HnTable;
    const thung = dung(t);
    vao(oTrong(thung, 0, "quantity")); go(oTrong(thung, 0, "quantity"), "2");
    expect(t.groupSubtotal).toBe(true);
    await xaHen();
    expect([oTich(thung)!.checked, oTich(thung)!.disabled]).toEqual([true, true]);
  });
});
