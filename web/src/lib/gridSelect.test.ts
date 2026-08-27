// MỞ RỘNG VÙNG CHỌN BẰNG SHIFT+MŨI TÊN — trước bài này chưa có chốt nào.
//
// Repo đã có `gridPaintIndex.test.ts`, nhưng nó kiểm hàm TÔ vùng chọn (`paintRect`) — tức phần VẼ.
// Phần TÍNH RA vùng (neo ở đâu, đích chạy tới đâu, nới hay thu, kẹp ở biên nào) thì không bài nào
// đụng tới, mà đó mới là chỗ sai được: tô đúng một vùng đã tính sai vẫn xanh cả hai đầu.
// Phần thuần ấy nay nằm ở `gridSelect.ts` (chỉ DI CHUYỂN khỏi `moveTo`, xem git diff GridTable.tsx).
//
// PHẠM VI — cái bài này KHÔNG phủ: phần đụng DOM còn lại trong `moveTo()` — dò cột thay thế khi ô
// đích không có <input> (hàng NHÓM), `el.focus()`, `lockCell()`, `paintSel()`. Cái được khoá là
// hình học của vùng chọn.
import { describe, it, expect } from "vitest";
import { type Sel, clampRow, clampCol, nextSel, rectOfSel, arrowStep } from "./gridSelect";

// Bộ cột của lưới đầy đủ nhất (có Chi Tiết + Số Ngày + Ghi Chú nội bộ).
const FIELDS = ["_stt", "name", "detail", "unit", "quantity", "days", "unitPrice", "notes", "internalNote"];
const fieldIdx = (f: string) => FIELDS.indexOf(f);
const SO_HANG = 8;

/**
 * Nối đúng chuỗi mà `moveTo()` chạy cho MỘT nhịp phím mũi tên, phần thuần:
 * kẹp hàng → kẹp cột → dựng vùng chọn mới. Không có DOM nên bỏ qua phần dò ô thay thế/focus.
 * Nhờ đi qua cả chuỗi, bài kiểm bắt được lỗi ở khớp nối chứ không chỉ trong từng hàm lẻ.
 */
function nhipMuiTen(sel: Sel, key: string, shift: boolean): Sel {
  const { dRow, dCol } = arrowStep(key);
  const row = clampRow(sel.focus.row + dRow, SO_HANG);
  const ci = clampCol(fieldIdx(sel.focus.field) + dCol, FIELDS.length);
  return nextSel(sel, row, FIELDS[ci], shift);
}

const oDon = (row: number, field: string): Sel => ({ anchor: { row, field }, focus: { row, field } });
/** Vùng chọn rút gọn thành [r0, r1, c0, c1] cho dễ đọc kỳ vọng. */
const vung = (sel: Sel) => { const r = rectOfSel(sel, fieldIdx); return r && [r.r0, r.r1, r.c0, r.c1]; };

describe("Shift+mũi tên NỚI vùng, neo đứng yên", () => {
  it("Shift+↓ một nhịp: vùng cao 2 hàng, neo vẫn ở hàng xuất phát", () => {
    let sel = oDon(2, "quantity");
    expect(vung(sel)).toEqual([2, 2, 4, 4]);
    sel = nhipMuiTen(sel, "ArrowDown", true);
    expect(sel.anchor).toEqual({ row: 2, field: "quantity" });   // NEO không nhúc nhích
    expect(sel.focus).toEqual({ row: 3, field: "quantity" });
    expect(vung(sel)).toEqual([2, 3, 4, 4]);
  });

  it("giữ Shift bấm ↓ ba nhịp: vùng lớn dần, neo vẫn nguyên", () => {
    let sel = oDon(1, "unitPrice");
    for (let n = 0; n < 3; n++) sel = nhipMuiTen(sel, "ArrowDown", true);
    expect(sel.anchor).toEqual({ row: 1, field: "unitPrice" });
    expect(vung(sel)).toEqual([1, 4, 6, 6]);
  });

  it("Shift+→ nới theo chiều ngang, vẫn cùng một neo", () => {
    let sel = oDon(3, "name");
    sel = nhipMuiTen(sel, "ArrowRight", true);
    sel = nhipMuiTen(sel, "ArrowRight", true);
    expect(sel.anchor).toEqual({ row: 3, field: "name" });
    expect(vung(sel)).toEqual([3, 3, 1, 3]);   // name → detail → unit
  });

  it("nới chéo (↓ rồi →) ra đúng khối chữ nhật", () => {
    let sel = oDon(2, "unit");
    sel = nhipMuiTen(sel, "ArrowDown", true);
    sel = nhipMuiTen(sel, "ArrowDown", true);
    sel = nhipMuiTen(sel, "ArrowRight", true);
    expect(vung(sel)).toEqual([2, 4, 3, 4]);
  });
});

describe("Shift+mũi tên ngược hướng THU vùng lại — không phải nới thêm", () => {
  // Đây là lý do vùng chọn phải lưu neo+đích chứ không lưu sẵn r0/r1: nếu chỉ giữ hình chữ nhật
  // rồi "min/max thêm ô mới" thì Shift+↑ sau khi đã Shift+↓ sẽ PHÌNH vùng lên trên, sai hẳn Excel.
  it("Shift+↓↓ rồi Shift+↑ → vùng thu về 2 hàng", () => {
    let sel = oDon(2, "quantity");
    sel = nhipMuiTen(sel, "ArrowDown", true);
    sel = nhipMuiTen(sel, "ArrowDown", true);
    expect(vung(sel)).toEqual([2, 4, 4, 4]);
    sel = nhipMuiTen(sel, "ArrowUp", true);
    expect(vung(sel)).toEqual([2, 3, 4, 4]);   // THU, không phải nới thành [1,4]
  });

  it("Shift+↑ quá neo → vùng lật lên PHÍA TRÊN neo, vẫn chuẩn hoá r0<r1", () => {
    let sel = oDon(4, "notes");
    sel = nhipMuiTen(sel, "ArrowUp", true);
    sel = nhipMuiTen(sel, "ArrowUp", true);
    sel = nhipMuiTen(sel, "ArrowUp", true);
    expect(sel.anchor.row).toBe(4);
    expect(sel.focus.row).toBe(1);
    expect(vung(sel)).toEqual([1, 4, 7, 7]);   // r0 < r1 dù kéo NGƯỢC lên
  });

  it("kéo ngược cả hai chiều (neo ở góc dưới-phải) vẫn ra hình chữ nhật hợp lệ", () => {
    let sel = oDon(5, "unitPrice");
    sel = nhipMuiTen(sel, "ArrowUp", true);
    sel = nhipMuiTen(sel, "ArrowUp", true);
    sel = nhipMuiTen(sel, "ArrowLeft", true);
    sel = nhipMuiTen(sel, "ArrowLeft", true);
    expect(vung(sel)).toEqual([3, 5, 4, 6]);
  });
});

describe("mũi tên KHÔNG giữ Shift → vùng co về một ô", () => {
  it("đang chọn cả khối, bấm ↓ trơn thì mất vùng, chỉ còn ô đích", () => {
    let sel = oDon(1, "quantity");
    sel = nhipMuiTen(sel, "ArrowDown", true);
    sel = nhipMuiTen(sel, "ArrowDown", true);
    expect(vung(sel)).toEqual([1, 3, 4, 4]);
    sel = nhipMuiTen(sel, "ArrowDown", false);
    expect(sel.anchor).toEqual({ row: 4, field: "quantity" });
    expect(sel.focus).toEqual({ row: 4, field: "quantity" });
    expect(vung(sel)).toEqual([4, 4, 4, 4]);
  });

  it("giữ Shift khi CHƯA có vùng nào (sel = null) cũng chỉ ra một ô", () => {
    const sel = nextSel(null, 3, "unit", true);
    expect(sel.anchor).toEqual({ row: 3, field: "unit" });
    expect(sel.focus).toEqual({ row: 3, field: "unit" });
  });
});

describe("kẹp ở biên bảng — Shift+mũi tên không chọn ra ngoài lưới", () => {
  it("Shift+↓ ở HÀNG CUỐI đứng yên, vùng không nở thêm", () => {
    let sel = oDon(SO_HANG - 2, "name");
    sel = nhipMuiTen(sel, "ArrowDown", true);
    expect(vung(sel)).toEqual([SO_HANG - 2, SO_HANG - 1, 1, 1]);
    const truoc = vung(sel);
    sel = nhipMuiTen(sel, "ArrowDown", true);   // đã chạm đáy
    expect(vung(sel)).toEqual(truoc);
    sel = nhipMuiTen(sel, "ArrowDown", true);
    expect(vung(sel)).toEqual(truoc);
  });

  it("Shift+↑ ở hàng 0 và Shift+← ở cột đầu đều đứng yên", () => {
    let sel = oDon(0, "_stt");
    sel = nhipMuiTen(sel, "ArrowUp", true);
    sel = nhipMuiTen(sel, "ArrowLeft", true);
    expect(vung(sel)).toEqual([0, 0, 0, 0]);
  });

  it("Shift+→ ở cột cuối đứng yên", () => {
    const cuoi = FIELDS.length - 1;
    let sel = oDon(2, FIELDS[cuoi]);
    sel = nhipMuiTen(sel, "ArrowRight", true);
    expect(vung(sel)).toEqual([2, 2, cuoi, cuoi]);
  });

  it("clampRow/clampCol kẹp đúng hai đầu", () => {
    expect(clampRow(-5, 8)).toBe(0);
    expect(clampRow(99, 8)).toBe(7);
    expect(clampRow(3, 8)).toBe(3);
    expect(clampCol(-1, 9)).toBe(0);    // cột không có trong FIELDS (fieldIdx = -1) → về cột đầu
    expect(clampCol(99, 9)).toBe(8);
  });
});

describe("nextSel không sửa vùng cũ (nơi gọi giữ tham chiếu qua nhiều nhịp)", () => {
  it("vùng truyền vào giữ nguyên sau khi dựng vùng mới", () => {
    const cu = oDon(2, "quantity");
    const moi = nextSel(cu, 5, "unitPrice", true);
    expect(cu.focus).toEqual({ row: 2, field: "quantity" });
    expect(moi).not.toBe(cu);
    expect(moi.anchor).toBe(cu.anchor);   // NEO dùng lại nguyên tham chiếu, đúng như mã cũ
  });
});

describe("rectOfSel — chuẩn hoá và cửa an toàn", () => {
  it("không có vùng chọn → null", () => {
    expect(rectOfSel(null, fieldIdx)).toBeNull();
  });

  it("cột không nằm trong bộ cột hiện hành → null, không bịa ra vùng", () => {
    // Mẫu báo giá TẮT cột Ghi Chú nội bộ: vùng cũ trỏ vào cột đã biến mất phải bị bỏ qua.
    const rutGon = ["_stt", "name", "unit", "quantity", "unitPrice"];
    const idx = (f: string) => rutGon.indexOf(f);
    expect(rectOfSel(oDon(1, "internalNote"), idx)).toBeNull();
    expect(rectOfSel({ anchor: { row: 1, field: "name" }, focus: { row: 2, field: "days" } }, idx)).toBeNull();
  });

  it("neo ở góc dưới-phải vẫn cho r0≤r1 và c0≤c1", () => {
    const sel: Sel = { anchor: { row: 6, field: "notes" }, focus: { row: 2, field: "unit" } };
    expect(rectOfSel(sel, fieldIdx)).toEqual({ r0: 2, r1: 6, c0: 3, c1: 7 });
  });
});

describe("arrowStep — hướng của phím mũi tên", () => {
  it("bốn phím chuẩn ra đúng hướng", () => {
    expect(arrowStep("ArrowUp")).toEqual({ dRow: -1, dCol: 0, prefer: 0 });
    expect(arrowStep("ArrowDown")).toEqual({ dRow: 1, dCol: 0, prefer: 0 });
    expect(arrowStep("ArrowLeft")).toEqual({ dRow: 0, dCol: -1, prefer: -1 });
    expect(arrowStep("ArrowRight")).toEqual({ dRow: 0, dCol: 1, prefer: 1 });
  });

  it("đi ngang mang theo hướng ưu tiên, đi dọc thì không", () => {
    // `prefer` quyết định dò cột thay thế về phía nào khi ô đích không nhập được (hàng NHÓM).
    // Đi → mà ưu tiên dò ngược sang trái thì con trỏ kẹt tại chỗ.
    expect(arrowStep("ArrowRight").prefer).toBe(1);
    expect(arrowStep("ArrowLeft").prefer).toBe(-1);
    expect(arrowStep("ArrowUp").prefer).toBe(0);
    expect(arrowStep("ArrowDown").prefer).toBe(0);
  });

  it("phím Arrow lạ → nhịp RỖNG, vùng chọn đứng yên (giữ hành vi cũ, không nhảy bậy)", () => {
    expect(arrowStep("ArrowKhongCo")).toEqual({ dRow: 0, dCol: 0, prefer: 0 });
    const sel = nhipMuiTen(oDon(3, "unit"), "ArrowKhongCo", true);
    expect(vung(sel)).toEqual([3, 3, 3, 3]);
  });
});

describe("Shift+bấm chuột dùng CHUNG phép nới với Shift+mũi tên", () => {
  it("bấm Shift vào ô xa cho ra đúng vùng như bấm Shift+mũi tên tới đó", () => {
    // GridTable gọi nextSel(sel, row, field, true) ở CẢ hai lối vào → không thể trôi khỏi nhau.
    let banPhim = oDon(2, "unit");
    for (let n = 0; n < 3; n++) banPhim = nhipMuiTen(banPhim, "ArrowDown", true);
    banPhim = nhipMuiTen(banPhim, "ArrowRight", true);

    const chuot = nextSel(oDon(2, "unit"), 5, "quantity", true);
    expect(vung(chuot)).toEqual(vung(banPhim));
    expect(chuot.anchor).toEqual(banPhim.anchor);
  });
});
