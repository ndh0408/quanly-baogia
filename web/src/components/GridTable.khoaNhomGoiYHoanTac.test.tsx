/** @vitest-environment jsdom */
/**
 * ============================================================================
 * Ô "HIỆN THÀNH TIỀN NHÓM" — HAI KẼ HỞ CÒN LẠI SAU VÒNG 3 (soát cuối, 2026-09-30).
 *
 * (1) GỢI Ý DANH MỤC TRÊN Ô HẠNG MỤC CỦA HÀNG NHÓM. Ô tên của hàng nhóm / nhóm con mở được gợi ý theo rạp bằng Alt+↓
 *     (như Excel mở dropdown) — CHỈ đường đó: gõ tên nhóm không mở gợi ý (gõ ≥ 2 ký tự tự mở chỉ có ở hàng mục). Chọn
 *     một gợi ý là điền cả Số Lượng (m² = W×H, hoặc SL của mục) vào chính hàng đó. Đường này trước đây KHÔNG đi qua
 *     luật tự bật của gõ / dán: nhóm SL 1 → gợi ý điền SL 3, ô đang tắt → "tắt + nhóm SL 3" KHÔNG khoá, tổng sai im
 *     lặng (nhỏ hơn thật đúng 3 lần).
 *
 * (2) HOÀN TÁC LÀM Ô TỰ TẮT. Ctrl+Z một sửa đổi cũ trên báo giá "tắt + nhóm SL 3" mà người dùng đã tích tay (hoặc gõ SL
 *     làm ô tự bật) trả cờ về mốc = TẮT; nhánh BẬT lại đã có toast, nhánh TẮT thì im — ô tích tự bỏ + tổng rớt về số không
 *     nhân hệ số nhóm mà không ai nói một lời.
 * ============================================================================
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { GridTable, type GridTableProps } from "./GridTable";
import { nextK, type ItemK } from "../lib/gridShared";
import { TB_TU_BAT_NHOM, TB_TU_TAT_NHOM } from "../lib/khoaThanhTienNhom";
import { norm, type VenueEntry } from "../lib/venueCatalog";

// Danh mục rạp giả: giữ nguyên hàm thuần của module (searchEntries / fillItemFromEntry / norm), chỉ thay lối ra mạng.
const kho = vi.hoisted(() => ({ danhMuc: { entries: [] as unknown[], venues: [] as unknown[] } }));
vi.mock("../lib/venueCatalog", async (g) => ({ ...(await g<typeof import("../lib/venueCatalog")>()), loadCatalog: () => Promise.resolve(kho.danhMuc) }));
const { toastMock } = vi.hoisted(() => ({ toastMock: vi.fn<(msg: string, kind?: string) => void>() }));
vi.mock("../lib/ui", async (g) => ({ ...(await g<typeof import("../lib/ui")>()), toast: toastMock, confirmModal: async () => true }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ── giàn dựng ────────────────────────────────────────────────────────────────

const mk = (o: Partial<ItemK>): ItemK =>
  ({ _k: nextK(), kind: "item", name: "", unit: "", quantity: 0, days: null, unitPrice: 0, notes: "", ...o }) as ItemK;
const nhom = (o: Partial<ItemK> = {}): ItemK => mk({ kind: "section", name: "Nhóm", quantity: 1, ...o });
const nhomCon = (o: Partial<ItemK> = {}): ItemK => mk({ kind: "subsection", name: "Nhóm con", quantity: 1, ...o });
const muc = (o: Partial<ItemK> = {}): ItemK => mk({ name: "Backdrop", unit: "m2", quantity: 2, unitPrice: 100_000, ...o });

/** Một mục danh mục rạp rộng `w` × cao `h` mét → ĐVT m2, SL = w×h (fillItemFromEntry). */
const mucRap = (name: string, w: number, h: number): VenueEntry => ({
  cat: "Quầy", region: "HCM", venue: "CGV Landmark", name, dim: `(${w}W x ${h}H)m`, w, h, unit: "m2", qty: null, note: null, tags: [],
});
const datDanhMuc = (entries: VenueEntry[]) => {
  entries.forEach((e) => { e._hay = norm(`${e.venue} ${e.name} ${e.region || ""} ${e.cat || ""} ${(e.tags || []).join(" ")}`); });
  kho.danhMuc = { entries, venues: [] };
};

const hops: HTMLDivElement[] = [];
const roots: Root[] = [];
beforeEach(() => { toastMock.mockClear(); datDanhMuc([]); });
afterEach(async () => {
  await act(async () => { await new Promise((r) => setTimeout(r, 220)); });   // cho hẹn giờ vẽ-hoãn 180ms nổ trong act
  for (const r of roots.splice(0)) act(() => r.unmount());
  for (const h of hops.splice(0)) h.remove();
  document.body.innerHTML = "";
});

/** Cha THẬT như QuoteEditor: giữ cờ `groupSubtotal` trong state và báo mọi lần lưới gọi `onGroupSubtotal`. */
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

const oTich = (goc: ParentNode = document) => goc.querySelector<HTMLInputElement>("label.gf-group-sub input[type=\"checkbox\"]");
const trangThai = () => [oTich()!.checked, oTich()!.disabled];
const cho = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const xaHen = () => cho(220);
const vao = (el: HTMLElement) => act(() => { el.focus(); });
const phim = (el: Element, key: string, mo: { ctrl?: boolean; alt?: boolean } = {}) =>
  act(() => { el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ctrlKey: !!mo.ctrl, altKey: !!mo.alt })); });
const go = (el: HTMLInputElement | HTMLTextAreaElement, chu: string) => act(() => { el.value = chu; el.dispatchEvent(new Event("input", { bubbles: true })); });
async function nhapSL(el: () => HTMLInputElement, chu: string) { vao(el()); go(el(), chu); phim(el(), "Enter"); await xaHen(); }
const bam = (el: HTMLElement) => act(() => { el.click(); });
const soLanBao = (msg: string) => toastMock.mock.calls.filter(([m]) => m === msg).length;

// ── (1) gợi ý danh mục trên hàng NHÓM ────────────────────────────────────────

describe("gợi ý danh mục điền Số Lượng cho hàng NHÓM → đi cùng luật tự bật như gõ / dán", () => {
  /** Alt+↓ trên ô Hạng Mục của hàng `row` (tên đã là "quay bap" để khớp danh mục), chọn gợi ý đầu bằng ↓ + Tab. */
  async function chonGoiY(o: (r: number, f: string) => HTMLInputElement & HTMLTextAreaElement, row: number) {
    vao(o(row, "name"));
    phim(o(row, "name"), "ArrowDown", { alt: true });   // Alt+↓ — mở danh sách gợi ý của ô như Excel
    await cho(280);                                       // hẹn giờ tra 150ms + promise danh mục
    phim(o(row, "name"), "ArrowDown");                    // chọn dòng gợi ý đầu
    phim(o(row, "name"), "Tab");                          // Tab = điền
  }

  it("NHÓM SL 1, ô đang tắt: Alt+↓ rồi chọn gợi ý 3 m² (điền SL 3) → tự bật + khoá, không toast (người dùng đang nhìn)", async () => {
    datDanhMuc([mucRap("Quầy bắp", 3, 1)]);
    const items = [nhom({ name: "quay bap", quantity: 1 }), muc()];
    const { o, ghiCo } = moLuoi(items, false, { fxBar: true });
    await chonGoiY(o, 0);
    expect(items[0].name, "dropdown gợi ý không mở / không chọn được → bài này vô nghĩa").toContain("Quầy bắp");
    expect(items[0].quantity, "gợi ý phải điền SL = 3 × 1").toBe(3);
    expect(ghiCo, "nhóm thành SL 3 mà ô tắt là tổng sai im lặng").toHaveBeenCalledWith(true);
    await xaHen();
    expect(trangThai()).toEqual([true, true]);
    expect(toastMock).not.toHaveBeenCalled();
  });

  it("NHÓM CON cũng vậy", async () => {
    datDanhMuc([mucRap("Quầy bắp", 3, 1)]);
    const items = [nhom({ quantity: 1 }), nhomCon({ name: "quay bap", quantity: 1 }), muc()];
    const { o, ghiCo } = moLuoi(items, false, { fxBar: true });
    await chonGoiY(o, 1);
    expect(items[1].quantity).toBe(3);
    expect(ghiCo).toHaveBeenCalledWith(true);
    await xaHen();
    expect(trangThai()).toEqual([true, true]);
  });

  it("Ctrl+Z trả SL nhóm về 1: giữ nguyên ô đang bật (SL ≤ 1 thì cờ không đổi tổng), nhả khoá, không toast", async () => {
    datDanhMuc([mucRap("Quầy bắp", 3, 1)]);
    const items = [nhom({ name: "quay bap", quantity: 1 }), muc()];
    const { o } = moLuoi(items, false, { fxBar: true });
    await chonGoiY(o, 0);
    await xaHen();
    expect(items[0].quantity).toBe(3);
    vao(o(1, "unitPrice"));   // hàng nhóm không có ô Đơn giá — Ctrl+Z từ ô của hàng mục bên dưới
    phim(o(1, "unitPrice"), "z", { ctrl: true });
    await xaHen();
    expect(items[0].quantity).toBe(1);
    expect(trangThai()).toEqual([true, false]);
    expect(toastMock).not.toHaveBeenCalled();
  });

  it("báo giá CŨ 'tắt + nhóm SL 3': gợi ý điền ĐÚNG SL 3 (không đổi số) thì KHÔNG bật hộ — bật là đổi tổng đã lưu", async () => {
    datDanhMuc([mucRap("Quầy bắp", 3, 1)]);
    const items = [nhom({ name: "quay bap", quantity: 3 }), muc()];
    const { o, ghiCo } = moLuoi(items, false, { fxBar: true });
    await chonGoiY(o, 0);
    expect(items[0].name).toContain("Quầy bắp");
    expect(items[0].quantity).toBe(3);
    expect(ghiCo).not.toHaveBeenCalled();
    await xaHen();
    expect(trangThai()).toEqual([false, false]);
  });

  it("nhưng gợi ý ĐỔI SL nhóm cũ (3 → 6) là người dùng đặt SL nhóm → bật + khoá", async () => {
    datDanhMuc([mucRap("Quầy bắp", 3, 2)]);
    const items = [nhom({ name: "quay bap", quantity: 3 }), muc()];
    const { o, ghiCo } = moLuoi(items, false, { fxBar: true });
    await chonGoiY(o, 0);
    expect(items[0].quantity).toBe(6);
    expect(ghiCo).toHaveBeenCalledWith(true);
  });

  it("gợi ý điền SL 1 cho nhóm SL 1 → không bật (hệ số ×1 không đổi tổng)", async () => {
    datDanhMuc([mucRap("Quầy bắp", 1, 1)]);
    const items = [nhom({ name: "quay bap", quantity: 1 }), muc()];
    const { o, ghiCo } = moLuoi(items, false, { fxBar: true });
    await chonGoiY(o, 0);
    expect(items[0].quantity).toBe(1);
    expect(ghiCo).not.toHaveBeenCalled();
  });

  it("gợi ý cho hàng MỤC (không phải nhóm) SL 3 → không bật (chỉ hàng nhóm mới có hệ số)", async () => {
    datDanhMuc([mucRap("Quầy bắp", 3, 1)]);
    const items = [nhom({ quantity: 1 }), muc({ name: "quay bap", quantity: 1 })];
    const { o, ghiCo } = moLuoi(items, false, { fxBar: true });
    await chonGoiY(o, 1);
    expect(items[1].quantity).toBe(3);
    expect(ghiCo).not.toHaveBeenCalled();
  });

  // FEATURES.md (mục Ô "Hiện Thành Tiền nhóm") liệt kê đường này là "Alt+↓ trên ô tên nhóm". Bản trước của tài liệu và
  // chú thích applySug còn ghi "hoặc gõ tên rồi chọn" — sai: ô tên hàng nhóm (data-xl="ten-nhom") đi tenNhom, không gọi
  // nameSuggest. Bài này chốt đúng điều tài liệu nói; đổi hành vi thì sửa cả tài liệu.
  it("trên hàng NHÓM / NHÓM CON gợi ý CHỈ mở bằng Alt+↓ — gõ tên nhóm không mở (đối chứng cùng lưới: hàng MỤC gõ tên thì mở)", async () => {
    datDanhMuc([mucRap("Quầy bắp", 3, 1)]);
    const items = [nhom({ name: "" }), nhomCon({ name: "" }), muc({ name: "" })];
    const { o } = moLuoi(items, false, { fxBar: true });
    const moGoiY = () => !!document.querySelector(".vs-auto .vs-item");
    /** Gõ như người dùng: phím chữ đầu (gõ là đè, vào chế độ gõ) rồi cả cụm chữ, chờ quá hẹn giờ tra 150ms + promise danh mục. */
    const goTen = async (row: number) => { vao(o(row, "name")); phim(o(row, "name"), "q"); go(o(row, "name"), "quay bap"); await cho(280); };
    await goTen(0);
    expect(moGoiY(), "gõ tên NHÓM mà mở gợi ý → tài liệu (chỉ Alt+↓) sai").toBe(false);
    await goTen(1);
    expect(moGoiY(), "gõ tên NHÓM CON mà mở gợi ý → tài liệu (chỉ Alt+↓) sai").toBe(false);
    await goTen(2);
    expect(moGoiY(), "đối chứng hỏng: hàng MỤC gõ tên phải mở gợi ý — không thì hai câu trên vô nghĩa").toBe(true);
    phim(o(2, "name"), "Escape");   // đóng gợi ý của hàng mục
    await cho(50);
    expect(moGoiY()).toBe(false);
    vao(o(0, "name"));
    phim(o(0, "name"), "ArrowDown", { alt: true });
    await cho(280);
    expect(moGoiY(), "Alt+↓ trên ô tên nhóm (chữ đã gõ ở trên) phải mở gợi ý").toBe(true);
  });
});

// ── (2) hoàn tác làm ô tự TẮT phải báo ───────────────────────────────────────

describe("Ctrl+Z / Ctrl+Y / Esc làm ô đổi trạng thái thì phải NÓI — cả bật lại lẫn tắt", () => {
  const cu = () => [nhom({ quantity: 3, name: "Nhóm cũ" }), muc({ unitPrice: 100_000 }), muc()];

  it("báo giá cũ: người dùng TỰ TÍCH ô rồi Ctrl+Z một sửa đổi trước đó → ô về tắt VÀ có toast nói vì sao", async () => {
    const items = cu();
    const { o, ghiCo } = moLuoi(items, false);
    await nhapSL(() => o(1, "unitPrice"), "250.000");   // mốc: tắt + SL 3
    bam(oTich()!);                                       // tự tích → bật + khoá
    expect(trangThai()).toEqual([true, true]);
    expect(toastMock, "tự tích tay thì chưa có gì để báo").not.toHaveBeenCalled();
    ghiCo.mockClear();
    vao(o(1, "unitPrice"));
    phim(o(1, "unitPrice"), "z", { ctrl: true });
    await xaHen();
    expect(items[1].unitPrice).toBe(100_000);
    expect(ghiCo).toHaveBeenCalledWith(false);
    expect(trangThai()).toEqual([false, false]);
    expect(toastMock).toHaveBeenCalledWith(TB_TU_TAT_NHOM, "info");
    expect(soLanBao(TB_TU_TAT_NHOM), "chỉ MỘT lời báo (restore rồi tính lại không được báo hai lần)").toBe(1);
  });

  it("gõ SL nhóm 5 (tự bật, im lặng) rồi Ctrl+Z → SL 3, ô về tắt + toast; Ctrl+Y → SL 5, bật lại + toast bật", async () => {
    const items = cu();
    const { o } = moLuoi(items, false);
    await nhapSL(() => o(0, "quantity"), "5");
    expect(trangThai()).toEqual([true, true]);
    expect(toastMock, "gõ thẳng vào ô SL nhóm thì im").not.toHaveBeenCalled();
    vao(o(0, "quantity"));
    phim(o(0, "quantity"), "z", { ctrl: true });
    await xaHen();
    expect(items[0].quantity).toBe(3);
    expect(trangThai()).toEqual([false, false]);
    expect(soLanBao(TB_TU_TAT_NHOM)).toBe(1);
    phim(o(0, "quantity"), "y", { ctrl: true });
    await xaHen();
    expect(items[0].quantity).toBe(5);
    expect(trangThai()).toEqual([true, true]);
    expect(soLanBao(TB_TU_BAT_NHOM), "nhánh bật đã có từ trước — giữ nguyên").toBe(1);
    expect(soLanBao(TB_TU_TAT_NHOM)).toBe(1);
  });

  it("Esc huỷ phiên gõ SL nhóm đã tự bật ô (báo giá cũ tắt + SL 3) → ô về tắt + toast", async () => {
    const items = [nhom({ quantity: 3 }), muc()];
    const { o } = moLuoi(items, false);
    vao(o(0, "quantity")); go(o(0, "quantity"), "5");
    await xaHen();
    expect(trangThai()).toEqual([true, true]);
    phim(o(0, "quantity"), "Escape");
    await xaHen();
    expect(items[0].quantity).toBe(3);
    expect(trangThai()).toEqual([false, false]);
    expect(toastMock).toHaveBeenCalledWith(TB_TU_TAT_NHOM, "info");
  });

  it("CHỐT giữ nguyên — không đổi trạng thái ô thì KHÔNG toast: báo giá cũ tắt, Ctrl+Z sửa đổi không liên quan", async () => {
    const items = cu();
    const { o, ghiCo } = moLuoi(items, false);
    await nhapSL(() => o(1, "unitPrice"), "250.000");
    vao(o(1, "unitPrice"));
    phim(o(1, "unitPrice"), "z", { ctrl: true });
    await xaHen();
    expect(items[1].unitPrice).toBe(100_000);
    expect(ghiCo).not.toHaveBeenCalled();
    expect(toastMock).not.toHaveBeenCalled();
  });

  it("CHỐT giữ nguyên — ô đang bật + nhóm SL 2, Ctrl+Z sửa đổi khác: không toast", async () => {
    const items = [nhom({ quantity: 2 }), muc({ unitPrice: 100_000 }), muc()];
    const { o } = moLuoi(items, true);
    await nhapSL(() => o(1, "unitPrice"), "250.000");
    vao(o(1, "unitPrice"));
    phim(o(1, "unitPrice"), "z", { ctrl: true });
    await xaHen();
    expect(toastMock).not.toHaveBeenCalled();
  });
});
