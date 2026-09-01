// Xoá bảng nội bộ: phép đo "bảng này có dữ liệu không" BỎ SÓT, và màn Hà Nội có đường xoá RIÊNG.
//
// ── LỖI ─────────────────────────────────────────────────────────────────────
// (1) `extraTableHasData` (ExtraTables.tsx) chỉ nhìn name/detail/quantity/unitPrice. Bảng mà mọi
//     dòng chỉ có GHI CHÚ, CÔNG THỨC, ẢNH, hoặc đã tích DUYỆT / THANH TOÁN (kèm chứng từ) bị coi
//     là "trống" → nút ✕ xoá THẲNG, không hỏi. Đó lại đúng là dữ liệu đắt nhất: cờ duyệt/thanh
//     toán có chứng từ không dựng lại được, và Ctrl+Z không cứu (ngăn hoàn tác nằm trong GridTable
//     của chính bảng vừa bị gỡ khỏi cây).
// (2) Chú thích ở ExtraTables.tsx tự nhận `removeExtraTableAt` là "đường xoá DUY NHẤT ... để không
//     ai thêm đường splice thứ hai", nhưng AccountHnView.tsx CHÉP TAY lại nguyên logic đó
//     (hasData + confirm + splice + dịch tab đang mở) cho bảng Hà Nội, và không có test nào phủ.
//     Hai bản chép tay thì sẽ trôi khỏi nhau — sửa (1) ở một chỗ là bên kia vẫn thủng.
//
// ── TÁI HIỆN ────────────────────────────────────────────────────────────────
// Mở "Bảng nội bộ" (hoặc màn Phần Giá Hà Nội), thêm một bảng, gõ Ghi Chú / đặt công thức / tích
// "Đã TT" nhưng chưa điền tên-số lượng-đơn giá, rồi bấm ✕ trên tab: bảng biến mất, KHÔNG hỏi.
//
// ── CÁCH VÁ ─────────────────────────────────────────────────────────────────
// Mở rộng `extraTableHasData` sang notes/internalNote/unit/label/images/formulas/approved/paid,
// và đưa CẢ HAI đường xoá (Bảng nội bộ + bảng Hà Nội) qua cùng một lõi `removeTableFromList`.
// KHÔNG tính `days`: `M.blankItem(true)` đặt sẵn days = 1 (shared/quote-math.ts:125) nên bảng mới
// tinh của mẫu có cột Số Ngày sẽ bị coi là "có dữ liệu" và hỏi vô cớ.
import { describe, it, expect } from "vitest";
import { extraTableHasData, removeTableFromList, removeExtraTableAt, type ExtraTable } from "../components/ExtraTables";
import type { ItemK } from "./gridShared";

const item = (o: Record<string, unknown> = {}): ItemK => ({ kind: "item", ...o }) as ItemK;
const table = (items: ItemK[]): ExtraTable => ({ category: "hanoi", name: "Bảng 1", items });

describe("extraTableHasData — dữ liệu KHÔNG chỉ nằm ở tên/số lượng/đơn giá", () => {
  it("ghi chú / ghi chú nội bộ / ĐVT / nhãn nhóm đều là dữ liệu", () => {
    expect(extraTableHasData(table([item({ notes: "giao trước 2 ngày" })]))).toBe(true);
    expect(extraTableHasData(table([item({ internalNote: "thầu phụ Bình" })]))).toBe(true);
    expect(extraTableHasData(table([item({ unit: "m2" })]))).toBe(true);
    expect(extraTableHasData(table([item({ kind: "section", label: "A" })]))).toBe(true);
  });

  it("công thức và ảnh là dữ liệu (ô hiển thị 0 nhưng công thức thì có thật)", () => {
    expect(extraTableHasData(table([item({ formulas: { unitPrice: "=D2*2" } })]))).toBe(true);
    expect(extraTableHasData(table([item({ images: ["data:image/png;base64,AAA"] })]))).toBe(true);
  });

  it("cờ DUYỆT / THANH TOÁN là dữ liệu đắt nhất — phải hỏi trước khi xoá", () => {
    expect(extraTableHasData(table([item({ approved: true })]))).toBe(true);
    expect(extraTableHasData(table([item({ paid: true })]))).toBe(true);
    expect(extraTableHasData(table([item({ hasPaidProof: true })]))).toBe(true);
  });

  it("bảng mới tinh vẫn là TRỐNG — không hỏi vô cớ", () => {
    // đúng những gì M.blankItem(usesDays) đặt: days = 1 khi mẫu có cột Số Ngày
    expect(extraTableHasData(table([item({ name: "", detail: "", unit: "", quantity: 0, unitPrice: 0, days: 1, notes: "" })]))).toBe(false);
    expect(extraTableHasData(table([item({ formulas: {}, images: [] })]))).toBe(false);
    expect(extraTableHasData(table([item({ approved: false, paid: false })]))).toBe(false);
    expect(extraTableHasData(table([item({ notes: "   " })]))).toBe(false);   // khoảng trắng không tính
    expect(extraTableHasData(table([]))).toBe(false);
  });
});

describe("removeTableFromList — LÕI DÙNG CHUNG cho bảng nội bộ và bảng Hà Nội", () => {
  const hn = () => [table([item({ notes: "chốt giá với xưởng" })]), table([item()])];

  it("bảng có dữ liệu: HỎI trước, huỷ thì không đụng vào mảng", async () => {
    const tables = hn();
    const hoi: ExtraTable[] = [];
    const r = await removeTableFromList(tables, 0, 0, async (t) => { hoi.push(t); return false; });
    expect(r).toEqual({ removed: false, active: 0 });
    expect(hoi).toHaveLength(1);
    expect(tables).toHaveLength(2);
  });

  it("bảng có dữ liệu: đồng ý mới xoá, và trả về tab đang mở sau khi xoá", async () => {
    const tables = hn();
    const r = await removeTableFromList(tables, 0, 1, async () => true);
    expect(r).toEqual({ removed: true, active: 0 });   // xoá tab TRƯỚC → tab đang mở lùi 1
    expect(tables).toHaveLength(1);
  });

  it("bảng trống: xoá thẳng, không làm phiền", async () => {
    const tables = hn();
    let daHoi = false;
    const r = await removeTableFromList(tables, 1, 1, async () => { daHoi = true; return true; });
    expect(daHoi).toBe(false);
    expect(r).toEqual({ removed: true, active: 0 });   // tab đang mở bị xoá → kẹp về cuối mảng
  });

  it("chỉ số ngoài mảng / mảng không có → không làm gì, giữ nguyên tab đang mở", async () => {
    expect(await removeTableFromList(hn(), 9, 1, async () => true)).toEqual({ removed: false, active: 1 });
    expect(await removeTableFromList(undefined, 0, 3, async () => true)).toEqual({ removed: false, active: 3 });
  });

  it("removeExtraTableAt (Bảng nội bộ) chạy trên đúng lõi này", async () => {
    const sheet = { extraTables: hn(), _activeExtra: 1 };
    expect(await removeExtraTableAt(sheet, 0, async () => false)).toBe(false);
    expect(sheet.extraTables).toHaveLength(2);
    expect(sheet._activeExtra).toBe(1);
    expect(await removeExtraTableAt(sheet, 0, async () => true)).toBe(true);
    expect(sheet.extraTables).toHaveLength(1);
    expect(sheet._activeExtra).toBe(0);
  });
});
