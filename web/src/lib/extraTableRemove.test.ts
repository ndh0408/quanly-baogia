// Xoá sheet "Bảng nội bộ" KHÔNG hỏi xác nhận → mất dữ liệu, Ctrl+Z không cứu — chốt hồi quy.
//
// ── LỖI ─────────────────────────────────────────────────────────────────────
// `ExtraTables.tsx` có `removeTable(i)` chỉ `tables.splice(i, 1)` rồi `onChange()`. Nút gọi nó là
// dấu ✕ nhỏ nằm SÁT nhãn tab sheet, tức chỉ lệch một nhịp chuột so với thao tác "đổi sheet".
//
// ── TÁI HIỆN ────────────────────────────────────────────────────────────────
// Mở "Bảng nội bộ", nhập vài dòng chi phí HCM, rồi bấm ✕ trên tab: sheet biến mất NGAY, không hỏi
// gì. Ctrl+Z vô hiệu vì ngăn hoàn tác nằm TRONG `GridTable` của chính sheet vừa bị gỡ khỏi cây.
// Hai chỗ tương đương trong app đều hỏi: `QuoteEditor` (xoá sheet) và `AccountHnView` (xoá bảng HN,
// chỉ hỏi khi bảng đã có dòng điền).
//
// ── HẬU QUẢ ─────────────────────────────────────────────────────────────────
// Mất cả cờ DUYỆT/THANH TOÁN từng hàng và phần tổng đổ sang "Quản lý dự án". Chưa mất khỏi CSDL cho
// tới khi bấm Lưu, nhưng người dùng thường bấm Lưu mà không biết mình vừa xoá gì.
//
// ── CÁCH VÁ ─────────────────────────────────────────────────────────────────
// Đưa toàn bộ đường xoá qua `removeExtraTableAt(sheet, i, confirmFn)`: sheet CÓ dữ liệu thì phải
// hỏi trước; huỷ thì không đụng vào mảng. Tách khỏi component để kiểm thử được ngoài trình duyệt
// (web/ không có jsdom) và để không ai lỡ tay thêm một đường splice thứ hai bỏ qua bước hỏi.
import { describe, it, expect } from "vitest";
import { removeExtraTableAt, extraTableHasData, type ExtraTable } from "../components/ExtraTables";
import type { ItemK } from "./gridShared";

const item = (o: Partial<ItemK> = {}): ItemK => ({ kind: "item", ...o }) as ItemK;
const table = (name: string, items: ItemK[]): ExtraTable => ({ category: "hcm", name, items });
const sheetTrong = () => table("Trống", [item()]);
const sheetCoDl = () => table("Chi phí thi công", [item({ name: "Thảm sự kiện", quantity: 2, unitPrice: 500000 })]);

describe("extraTableHasData — sheet nào đáng hỏi trước khi xoá", () => {
  it("sheet mới tinh (1 dòng rỗng) → không cần hỏi", () => {
    expect(extraTableHasData(sheetTrong())).toBe(false);
    expect(extraTableHasData(table("", []))).toBe(false);
  });

  it("chỉ cần MỘT trường có giá trị là coi như có dữ liệu", () => {
    expect(extraTableHasData(table("x", [item({ name: "Backdrop" })]))).toBe(true);
    expect(extraTableHasData(table("x", [item({ detail: "3x2m" })]))).toBe(true);
    expect(extraTableHasData(table("x", [item({ quantity: 1 })]))).toBe(true);
    expect(extraTableHasData(table("x", [item({ unitPrice: 1000 })]))).toBe(true);
  });

  it("khoảng trắng không tính là dữ liệu", () => {
    expect(extraTableHasData(table("x", [item({ name: "   " })]))).toBe(false);
  });
});

describe("removeExtraTableAt — không xoá sheet có dữ liệu khi chưa được đồng ý", () => {
  it("sheet CÓ dữ liệu: phải HỎI, và huỷ thì giữ nguyên mảng", async () => {
    const co = sheetCoDl();
    const sheet = { extraTables: [sheetTrong(), co], _activeExtra: 1 };
    const hoi: ExtraTable[] = [];
    const ok = await removeExtraTableAt(sheet, 1, async (t) => { hoi.push(t); return false; });
    expect(ok).toBe(false);
    expect(hoi).toEqual([co]);                       // ĐÃ hỏi, và hỏi đúng sheet
    expect(sheet.extraTables).toHaveLength(2);       // huỷ → không mất gì
    expect(sheet.extraTables[1]).toBe(co);
    expect(sheet._activeExtra).toBe(1);
  });

  it("sheet CÓ dữ liệu: đồng ý thì mới xoá", async () => {
    const sheet = { extraTables: [sheetTrong(), sheetCoDl()], _activeExtra: 1 };
    const ok = await removeExtraTableAt(sheet, 1, async () => true);
    expect(ok).toBe(true);
    expect(sheet.extraTables).toHaveLength(1);
    expect(sheet._activeExtra).toBe(0);
  });

  it("sheet TRỐNG: xoá thẳng, KHÔNG làm phiền người dùng", async () => {
    const sheet = { extraTables: [sheetCoDl(), sheetTrong()], _activeExtra: 1 };
    let daHoi = false;
    const ok = await removeExtraTableAt(sheet, 1, async () => { daHoi = true; return true; });
    expect(ok).toBe(true);
    expect(daHoi).toBe(false);
    expect(sheet.extraTables).toHaveLength(1);
  });

  it("giữ nguyên cách dịch sheet đang mở như trước khi vá", async () => {
    const sheet = { extraTables: [sheetTrong(), sheetTrong(), sheetTrong()], _activeExtra: 2 };
    await removeExtraTableAt(sheet, 0, async () => true);
    expect(sheet._activeExtra).toBe(1);              // xoá sheet TRƯỚC → tab đang mở lùi 1
    await removeExtraTableAt(sheet, 1, async () => true);
    expect(sheet._activeExtra).toBe(0);              // xoá chính tab đang mở → kẹp về cuối mảng
  });

  it("chỉ số ngoài mảng → không làm gì, không ném lỗi", async () => {
    const sheet = { extraTables: [sheetTrong()], _activeExtra: 0 };
    expect(await removeExtraTableAt(sheet, 9, async () => true)).toBe(false);
    expect(sheet.extraTables).toHaveLength(1);
    expect(await removeExtraTableAt({}, 0, async () => true)).toBe(false);
  });
});
