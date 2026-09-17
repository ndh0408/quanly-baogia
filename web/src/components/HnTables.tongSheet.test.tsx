/** @vitest-environment jsdom */
/**
 * ============================================================================
 * KHỐI "BÁO GIÁ HÀ NỘI" — GẬP ĐƯỢC, VÀ ĐÓNG VẪN ĐỌC ĐƯỢC TIỀN.
 *
 * ── NGƯỜI DÙNG BÁO (ảnh chụp màn hình, 2026-09-17) ────────────────────────
 * "chổ thiết kế đang bị ngu trông không hiểu như nào và làm dài cái báo giá" · "có đóng mở từng
 * cái hay gì các thứ thông minh đầy đủ hoàn chỉnh" · "HN đưa vào 1 chổ cũng có tổng cả các sheet"
 * · "trình bày hơi rườm rà" · "mỗi cái chưa có tổng các sheet như báo giá".
 *
 * ── BẢN CŨ SAI HAI ĐƯỜNG NGƯỢC NHAU ───────────────────────────────────────
 * THỪA: cùng một số tiền in ra BA nơi — "Tổng:" đầu khối, "Tổng sheet:" do GridTable vẽ dưới lưới
 * (khối HN bật `fxBar` nên dòng đó hiện), và "Tổng sheet này:" do HnTables vẽ thêm. Cộng thêm ba
 * luồng nội bộ đều MỞ SẴN, mỗi luồng kéo theo nguyên một lưới Excel → trang dài mấy màn hình.
 *
 * THIẾU: nhiều sheet mà chỉ có MỘT tổng cộng; muốn biết sheet nào góp bao nhiêu phải bấm qua từng
 * tab rồi cộng nhẩm.
 *
 * ── LUẬT ĐÃ CHỐT ──────────────────────────────────────────────────────────
 *   · Mặc định ĐÓNG ở trang soạn báo giá; `AccountHnView` truyền `moMacDinh` vì cả trang chỉ có nó.
 *   · ĐÓNG mà tiêu đề vẫn nói đủ: "N sheet · SỐ TIỀN". Không phải mở ra mới biết.
 *   · MỞ ra thì số tiền tổng chỉ xuất hiện MỘT lần (hai dòng dưới lưới đã bỏ).
 *   · ≥2 sheet → mỗi TAB mang số của chính nó. 1 sheet thì không in, vì tiêu đề đã đúng bằng nó.
 *   · "+ Thêm sheet" lúc đang đóng phải TỰ MỞ, không thì tưởng nút hỏng.
 * ============================================================================
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { HnTables, type HnTable } from "./HnTables";
import { nextK, type ItemK } from "../lib/gridShared";
import type { EditorTemplate } from "../lib/api";

vi.mock("../lib/venueCatalog", async (nhapGoc) => {
  const goc = await nhapGoc<typeof import("../lib/venueCatalog")>();
  return { ...goc, loadCatalog: () => Promise.resolve({ entries: [], venues: [] }) };
});
// GIỮ NGUYÊN mọi thứ khác của module — `GridTable` còn lấy `useEscClose` từ đây, thay cả module
// là hook biến mất và lưới ném ngay lúc render.
vi.mock("../lib/ui", async (nhapGoc) => {
  const goc = await nhapGoc<typeof import("../lib/ui")>();
  return { ...goc, toast: () => {}, confirmModal: async () => true };
});
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const MAU: EditorTemplate[] = [
  { id: 2, code: "unibenfood", name: "GN (có ngày)", companyId: 1, layout: { hasDetail: false, reserveDetail: false, hasDays: true, numberSubsections: false } } as EditorTemplate,
];

const muc = (unitPrice: number): ItemK =>
  ({ _k: nextK(), kind: "item", name: "x", unit: "bộ", quantity: 1, days: 1, unitPrice, notes: "" }) as unknown as ItemK;

const bang = (ten: string, gia: number[]): HnTable =>
  ({ _k: nextK(), templateId: 2, name: ten, groupSubtotal: true, items: gia.map(muc) }) as unknown as HnTable;

let thung: HTMLDivElement, goc: Root;
beforeEach(() => { thung = document.createElement("div"); document.body.appendChild(thung); goc = createRoot(thung); });
afterEach(() => { act(() => goc.unmount()); thung.remove(); document.body.innerHTML = ""; });

/** `mo` = truyền `moMacDinh` (đường mà AccountHnView đi). Bỏ trống = đường trang soạn báo giá. */
function dung(tables: HnTable[], mo = false) {
  act(() => {
    goc.render(<HnTables moMacDinh={mo} tables={tables} templates={MAU} companyId={1} editable onMarkDirty={() => {}} />);
  });
}

const nutGap = () => thung.querySelector<HTMLButtonElement>(".khoi-sheet-nut")!;
const dauKhoi = () => thung.querySelector(".extra-cat-grouphead")?.textContent || "";
const coLuoi = () => !!thung.querySelector("table");

/** Mọi số tiền ĐANG HIỆN, chuẩn hoá về số: "4.204.000" → 4204000. */
const moiSoTien = () => [...(thung.textContent || "").matchAll(/\d{1,3}(?:\.\d{3})+/g)].map((m) => Number(m[0].replace(/\./g, "")));
const demSo = (n: number) => moiSoTien().filter((x) => x === n).length;

describe("Khối Báo Giá Hà Nội", () => {
  it("trang soạn báo giá: mặc định ĐÓNG — không kéo theo cả lưới Excel", () => {
    // Đây là vế "làm dài cái báo giá": ba luồng mở sẵn, mỗi luồng một lưới.
    dung([bang("Bảng 1", [2_186_000, 2_018_000])]);
    expect(coLuoi(), "khối đang đóng mà vẫn vẽ lưới").toBe(false);
    expect(nutGap().getAttribute("aria-expanded")).toBe("false");
  });

  it("ĐÓNG vẫn đọc được số sheet và số tiền — không phải mở ra mới biết", () => {
    dung([bang("A", [1_000_000]), bang("B", [2_500_000])]);
    expect(dauKhoi()).toContain("2 sheet");
    expect(dauKhoi()).toContain("3.500.000");
  });

  it("bấm tiêu đề thì MỞ, bấm lần nữa thì ĐÓNG", () => {
    dung([bang("Bảng 1", [4_204_000])]);
    act(() => { nutGap().click(); });
    expect(coLuoi(), "bấm mở mà không ra lưới").toBe(true);
    act(() => { nutGap().click(); });
    expect(coLuoi(), "bấm lại mà không đóng").toBe(false);
  });

  it("MỞ: tổng chỉ hiện ĐÚNG MỘT LẦN", () => {
    // Ảnh người dùng gửi: 4.204.000 in ba lần trên cùng một màn.
    dung([bang("Bảng 1", [2_186_000, 2_018_000])], true);
    expect(demSo(4_204_000), `4.204.000 hiện ${demSo(4_204_000)} lần — đang in lại ở nơi khác`).toBe(1);
  });

  it("MỞ: KHÔNG còn dòng 'Tổng sheet này' lẫn 'Tổng sheet' dưới lưới", () => {
    // Khoá theo CHỮ, vì hai nhãn ấy chính là thứ người dùng nhìn thấy và kêu rườm rà.
    dung([bang("Bảng 1", [2_186_000, 2_018_000])], true);
    const chu = thung.textContent || "";
    expect(chu).not.toContain("Tổng sheet này");
    expect(chu.match(/Tổng sheet:/g), "dòng 'Tổng sheet:' của lưới vẫn còn").toBeNull();
  });

  it("MỞ, HAI sheet: mỗi tab mang số CỦA NÓ, tổng cộng vẫn đúng", () => {
    dung([bang("Hà Nội 1", [1_000_000]), bang("Hà Nội 2", [2_500_000])], true);
    const tabs = [...thung.querySelectorAll(".sheet-tab")];
    expect(tabs.length).toBe(2);
    expect(tabs.map((t) => t.querySelector(".sheet-tab-tong")?.textContent?.replace(/\./g, "")))
      .toEqual(["1000000", "2500000"]);
    expect(demSo(3_500_000), "tổng cộng của cả khối").toBe(1);
  });

  it("MỞ, MỘT sheet: KHÔNG in tổng lên tab — sẽ thành con số thứ hai vô nghĩa", () => {
    // Vế đối trọng: thêm số vào tab cho "đầy đủ" là quay lại đúng chỗ rườm rà cũ.
    dung([bang("Bảng 1", [4_204_000])], true);
    expect(thung.querySelector(".sheet-tab-tong"), "một sheet mà tab vẫn in tổng").toBeNull();
  });

  it("'+ Thêm sheet' lúc đang ĐÓNG phải tự MỞ ra", () => {
    // Không mở thì người dùng bấm xong màn hình y nguyên → tưởng nút hỏng, bấm tiếp, đẻ ra 3 sheet.
    const tables = [bang("Bảng 1", [1_000_000])];
    dung(tables);
    expect(coLuoi()).toBe(false);
    const them = [...thung.querySelectorAll("button")].find((b) => /Thêm sheet/.test(b.textContent || ""));
    act(() => { them!.click(); });
    expect(coLuoi(), "thêm sheet xong mà khối vẫn đóng").toBe(true);
    expect(tables.length).toBe(2);
  });

  it("AccountHnView (moMacDinh): mở sẵn — cả trang chỉ có mỗi khối này", () => {
    dung([bang("Bảng 1", [1_000_000])], true);
    expect(coLuoi()).toBe(true);
  });
});
