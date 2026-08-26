// Gõ MỘT PHÍM ở ô meta (Ngày báo giá · VAT · Giảm giá · Tên sheet) vẽ lại TOÀN BỘ lưới.
//
// ── LỖI ─────────────────────────────────────────────────────────────────────
// `QuoteEditor.tsx` gọi `redraw()` (setTick) ngay trong `onInput` của bốn ô meta đó, mà `GridTable`
// KHÔNG được bọc memo và thân nó vẽ lại TỪNG hàng (`items.map`, không cửa sổ hoá). Bốn ô ấy không
// hề đổi thứ gì trong lưới: ngày báo giá chỉ hiện ở dòng "TP…, ngày…", VAT/giảm giá chỉ đổi bảng
// tổng, tên sheet chỉ đổi nhãn tab + bảng tổng.
//
// ── TÁI HIỆN ────────────────────────────────────────────────────────────────
// Báo giá ~1000 dòng, gõ tên sheet: mỗi ký tự dựng lại cả cây lưới (bench.tsx đo được ~73ms/phím
// ở 1000 dòng — con số này của bộ đo sẵn có trong repo, không phải ước lượng của lượt vá này).
//
// ── CÁCH VÁ ─────────────────────────────────────────────────────────────────
// Bọc `GridTable` bằng `memo(..., gridPropsEqual)` + prop `dataVersion`:
//   · `redrawMeta()` (bốn ô meta) chỉ setTick → dataVersion KHÔNG đổi → lưới bỏ qua lượt vẽ.
//   · `redraw()` (mọi đường còn lại, kể cả onChange của chính lưới) tăng dataVersion → lưới vẽ lại.
// AN TOÀN THEO HƯỚNG "quên thì như cũ": `gridPropsEqual` trả false (tức VẼ LẠI) khi nơi gọi KHÔNG
// khai `dataVersion` — ExtraTables/AccountHnView/bench giữ nguyên hành vi cũ; và bất kỳ prop giá
// trị nào lệch cũng vẽ lại. Chỉ prop HÀM bị bỏ qua khi so (chúng được tạo mới mỗi lần render).
import { describe, it, expect } from "vitest";
import { GridTable, gridPropsEqual, type GridTableProps } from "../components/GridTable";
import type { ItemK } from "./gridShared";
// `?raw` của Vite (không phải node:fs): web/tsconfig chỉ nạp types "vite/client", không có
// @types/node — cách đọc-nguồn này theo đúng tiền lệ web/src/lib/imgSrcGuard.test.ts.
import QUOTE_EDITOR from "../pages/QuoteEditor.tsx?raw";

const items: ItemK[] = [{ kind: "item", name: "Backdrop" } as ItemK];

// Props như QuoteEditor truyền: hàm luôn là arrow MỚI mỗi lần render.
const props = (o: Partial<GridTableProps> = {}): GridTableProps => ({
  items, usesDays: false, showDetail: false, addrDetail: false, numberSubs: false,
  editable: true, internalNote: true, groupSubtotal: true, fxBar: true, dataVersion: 7,
  onChange: () => {}, onGroupSubtotal: () => {}, onShowImages: () => {},
  ...o,
});

describe("gridPropsEqual — khi nào lưới ĐƯỢC PHÉP bỏ qua một lượt vẽ", () => {
  it("gõ ô meta (chỉ hàm đổi identity, dataVersion giữ nguyên) → bỏ qua", () => {
    expect(gridPropsEqual(props(), props())).toBe(true);
  });

  it("dữ liệu lưới đổi (dataVersion tăng) → PHẢI vẽ lại", () => {
    expect(gridPropsEqual(props(), props({ dataVersion: 8 }))).toBe(false);
  });

  it("đổi mảng items (tải lại báo giá, đổi sheet) → PHẢI vẽ lại dù dataVersion trùng", () => {
    expect(gridPropsEqual(props(), props({ items: [...items] }))).toBe(false);
  });

  it("mọi prop GIÁ TRỊ lệch đều bắt vẽ lại", () => {
    for (const p of [{ editable: false }, { usesDays: true }, { showDetail: true }, { addrDetail: true },
      { numberSubs: true }, { internalNote: false }, { groupSubtotal: false }, { showImages: true },
      { approveCol: true }, { canApprove: true }, { payCol: true }, { canPay: true },
      { fxBar: false }, { clfTheme: true }] as Partial<GridTableProps>[]) {
      expect(gridPropsEqual(props(), props(p)), JSON.stringify(p)).toBe(false);
    }
  });

  it("nơi gọi KHÔNG khai dataVersion → giữ nguyên hành vi cũ (luôn vẽ lại)", () => {
    const a = props({ dataVersion: undefined }), b = props({ dataVersion: undefined });
    expect(gridPropsEqual(a, b)).toBe(false);
    expect(gridPropsEqual(props(), b)).toBe(false);
    expect(gridPropsEqual(a, props())).toBe(false);
  });

  it("prop MỚI thêm sau này mà lệch giá trị cũng bắt vẽ lại (so theo khoá của cả hai bên)", () => {
    const a = { ...props(), propMoi: 1 } as unknown as GridTableProps;
    const b = { ...props(), propMoi: 2 } as unknown as GridTableProps;
    expect(gridPropsEqual(a, b)).toBe(false);
    expect(gridPropsEqual(props(), a)).toBe(false);   // bên kia thiếu hẳn khoá đó
  });
});

describe("số lượt vẽ lưới trong một phiên gõ thật", () => {
  // Mô phỏng đúng cách React.memo dùng hàm so: so props lần trước với lần này, bằng nhau thì
  // KHÔNG gọi lại thân component.
  const demLuotVe = (day: GridTableProps[]) => {
    let ve = 0; let truoc: GridTableProps | null = null;
    for (const p of day) { if (!truoc || !gridPropsEqual(truoc, p)) ve++; truoc = p; }
    return ve;
  };

  it("gõ 12 ký tự tên sheet rồi sửa 1 ô trong lưới → 2 lượt vẽ lưới (trước đây 14)", () => {
    const ver = 0;
    const day: GridTableProps[] = [props({ dataVersion: ver })];          // lượt vẽ đầu
    for (let i = 0; i < 12; i++) day.push(props({ dataVersion: ver }));   // redrawMeta: KHÔNG tăng ver
    day.push(props({ dataVersion: ver + 1 }));                            // sửa ô trong lưới → redraw
    expect(day).toHaveLength(14);
    expect(demLuotVe(day)).toBe(2);
  });
});

// web/ không có jsdom nên KHÔNG dựng được cây React thật để đếm lượt vẽ. Hai chốt dưới đây kiểm
// phần CÒN LẠI của lượt vá — thứ mà hàm so ở trên không nói lên được: lưới có thật sự được bọc
// memo bằng đúng hàm đó không, và QuoteEditor có nối dây đúng không.
describe("nối dây (phần không dựng được cây React để kiểm)", () => {
  it("GridTable được bọc memo bằng ĐÚNG gridPropsEqual", () => {
    const c = GridTable as unknown as { $$typeof?: symbol; compare?: unknown };
    expect(String(c.$$typeof)).toBe("Symbol(react.memo)");
    expect(c.compare).toBe(gridPropsEqual);
  });

  it("QuoteEditor: bốn ô meta dùng redrawMeta, và lưới nhận dataVersion", () => {
    const src = QUOTE_EDITOR;
    for (const dong of src.split("\n")) {
      // ô gõ-từng-phím: KHÔNG được gọi redraw() (vẽ cả lưới), phải là redrawMeta()
      if (/setQ\("(quoteDate|vatPercent|discount)"|activeSheet\.name = /.test(dong)) {
        expect(dong, dong.trim()).toMatch(/redrawMeta\(\)/);
        expect(dong, dong.trim()).not.toMatch(/[^a-zA-Z]redraw\(\)/);
      }
    }
    expect(src).toMatch(/<GridTable[^>]*dataVersion=\{gridVerRef\.current\}/);
    expect(src).toMatch(/const redraw = useCallback\(\(\) => \{ gridVerRef\.current\+\+;/);
  });
});
