/** @vitest-environment jsdom */
/**
 * ============================================================================
 * CÔNG THỨC TRỎ VÀO HÀNG NHÓM.
 *
 * ── LỖI NGƯỜI DÙNG BÁO (production, báo giá #41) ───────────────────────────
 * "công thức tôi chọn ô =g3*20% nó không ra" · "= cái ô khác ra cũng không được" · "bên cột thành
 * tiền nó không hiện" · "mấy cột đơn giá hay thành tiền nhóm con nhóm cha gì chưa cho click á".
 *
 * Dữ liệu thật trên production xác nhận: hạng mục "Phí vận chuyển lắp đặt, tháo dở" giữ công thức
 * `{"unitPrice": "=G3*20%"}` mà đơn giá nằm im ở 0.
 *
 * ── HAI LỖI ĐỘC LẬP, CÙNG NẰM Ở HÀNG NHÓM ─────────────────────────────────
 *   1. `cellNum` trả thẳng 0 cho MỌI hàng nhóm. Nhưng hàng nhóm KHÔNG trống hai cột tiền: cột Đơn
 *      Giá hiện tổng của nhóm, cột Thành Tiền hiện tổng × hệ số nhóm. Người dùng thấy số, trỏ vào,
 *      nhận 0 — im lặng, không dấu hiệu gì.
 *   2. `cellAddrFromEvent` chỉ biết hai lớp `col-amount` và `col-stt`. Hàng nhóm không có ô NHẬP ở
 *      cột Đơn Giá (chỉ là chữ trong <td class="col-price">), nên bấm vào đó lúc đang gõ công thức
 *      KHÔNG chèn được tham chiếu. Đúng câu "chưa cho click".
 *
 * ── VẾ ĐỐI TRỌNG: VÒNG LẶP ────────────────────────────────────────────────
 * Một mục nằm TRONG nhóm X mà trỏ vào tổng của X thì tổng ấy phụ thuộc ngược lại vào chính nó —
 * Excel gọi là circular reference. Trả "tổng thật" ở đây sẽ dao động qua 8 lượt của `recomputeAll`
 * rồi dừng ở một con số vô nghĩa, TỆ HƠN số 0 cũ. Nên ca đó phải ra 0 KÈM cờ ô đỏ.
 *
 * ── SƠ ĐỒ ĐỊA CHỈ DÙNG TRONG TỆP NÀY ──────────────────────────────────────
 * `usesDays` bật, `addrDetail` tắt (đúng mẫu "GN có ngày"):
 *   A=STT  B=Hạng Mục  C=ĐVT  D=Số Lượng  E=Số Ngày  F=Đơn Giá  G=Thành Tiền  H=Ghi Chú
 * ============================================================================
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { GridTable, type GridTableProps } from "./GridTable";
import { nextK, type ItemK } from "../lib/gridShared";

vi.mock("../lib/venueCatalog", async (nhapGoc) => {
  const goc = await nhapGoc<typeof import("../lib/venueCatalog")>();
  return { ...goc, loadCatalog: () => Promise.resolve({ entries: [], venues: [] }) };
});
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mk = (o: Partial<ItemK>): ItemK =>
  ({ k: nextK(), kind: "item", name: "", unit: "bộ", quantity: 1, days: 1, unitPrice: 0, notes: "", ...o }) as ItemK;

/** Bố cục giống báo giá #41: nhóm "Sản xuất" (2 mục) — nhóm "Chi phí khác" (1 mục). */
const bo = (): ItemK[] => [
  mk({ kind: "section", name: "Sản xuất", quantity: 1 }),          // hàng 1
  mk({ name: "Bàn ghế", quantity: 3, days: 1, unitPrice: 2_000_000 }), // hàng 2
  mk({ name: "Standee", quantity: 2, days: 1, unitPrice: 500_000 }),   // hàng 3
  mk({ kind: "section", name: "Chi phí khác", quantity: 1 }),      // hàng 4
  mk({ name: "Vận chuyển", quantity: 1, days: 1, unitPrice: 0 }),  // hàng 5
];
// Tổng nhóm "Sản xuất" = 3×1×2.000.000 + 2×1×500.000 = 7.000.000

let root: Root | null = null;
let hop: HTMLDivElement | null = null;

function Vo({ items, them }: { items: ItemK[]; them: Partial<GridTableProps> }) {
  const [, buoc] = useState(0);
  return (
    <GridTable items={items} usesDays showDetail={false} addrDetail={false} numberSubs={false} editable
      internalNote={false} groupSubtotal={false} fxBar onChange={() => buoc((v) => v + 1)} {...them} />
  );
}

function moLuoi(items: ItemK[], them: Partial<GridTableProps> = {}) {
  hop = document.createElement("div");
  document.body.appendChild(hop);
  root = createRoot(hop);
  act(() => root!.render(<Vo items={items} them={them} />));
}

beforeEach(() => { root = null; hop = null; });
afterEach(() => { if (root) act(() => root!.unmount()); hop?.remove(); document.body.innerHTML = ""; });

const o = (row: number, f: string): HTMLInputElement => {
  const el = hop!.querySelector(`tr[data-row="${row}"] [data-f="${f}"]`);
  if (!el) throw new Error(`không thấy ô (${row}, ${f})`);
  return el as HTMLInputElement;
};

/** Gõ vào ô rồi chốt — đúng lối trình duyệt đi (input → change). */
function goRoiChot(el: HTMLInputElement, chu: string) {
  act(() => { el.value = chu; el.dispatchEvent(new Event("input", { bubbles: true })); });
  act(() => { el.dispatchEvent(new Event("change", { bubbles: true })); });
}

// Ô đỏ = một trong hai cờ: `_fxLoi` (vòng lặp / không tính được — đúng ca của tệp này) hoặc
// `_fxWarn` (tham chiếu hỏng). Tách hai cờ ở soát toàn diện L8; lưới tô cùng một màu.
const canhBao = (it: ItemK, f: string) => { const c = it as unknown as { _fxWarn?: Record<string, boolean>; _fxLoi?: Record<string, boolean> }; return !!(c._fxWarn?.[f] || c._fxLoi?.[f]); };

describe("Công thức trỏ vào hàng nhóm", () => {
  it("=F1*20% (Đơn Giá của nhóm KHÁC) ra 20% tổng nhóm — trước đây ra 0", () => {
    const items = bo();
    moLuoi(items);
    goRoiChot(o(4, "unitPrice"), "=F1*20%");
    expect(items[4].unitPrice, "trỏ vào tổng nhóm vẫn ra 0 — đúng lỗi người dùng báo").toBe(1_400_000);
    expect(canhBao(items[4], "unitPrice"), "không phải vòng lặp mà lại báo đỏ").toBe(false);
  });

  it("=G1 (Thành Tiền của nhóm) ra tổng × hệ số khi bật nhân tổng con", () => {
    // Cột Thành Tiền của hàng nhóm CHỈ hiện số khi bật `groupSubtotal`; công thức phải ra đúng con
    // số ĐANG HIỆN, không phải một con số khác trong ruột.
    const items = bo();
    items[0].quantity = 2;            // nhóm "Sản xuất" nhân 2
    moLuoi(items, { groupSubtotal: true });
    goRoiChot(o(4, "unitPrice"), "=G1");
    expect(items[4].unitPrice).toBe(14_000_000);
  });

  it("TẮT nhân tổng con → cột Thành Tiền của nhóm trống, nên =G1 ra 0", () => {
    // Vế trung thực: ô không hiện gì thì công thức cũng không được bịa ra số.
    const items = bo();
    moLuoi(items, { groupSubtotal: false });
    goRoiChot(o(4, "unitPrice"), "=G1");
    expect(items[4].unitPrice).toBe(0);
  });

  it("mục NẰM TRONG nhóm trỏ vào chính nhóm đó → 0 + ô ĐỎ, không bịa số", () => {
    // Đây đúng là ca của báo giá #41: "Phí vận chuyển" nằm trong nhóm mà trỏ vào tổng nhóm.
    // Nếu bài này đỏ vì ra một con số: `recomputeAll` đã chạy 8 lượt rồi dừng ở giá trị vô nghĩa.
    const items = bo();
    moLuoi(items);
    goRoiChot(o(2, "unitPrice"), "=F1*20%");
    expect(items[2].unitPrice, "tham chiếu vòng mà vẫn ra số").toBe(0);
    expect(canhBao(items[2], "unitPrice"), "tham chiếu vòng mà ô KHÔNG được báo đỏ").toBe(true);
  });

  it("sửa công thức vòng thành công thức hợp lệ → cờ đỏ phải TẮT", () => {
    const items = bo();
    moLuoi(items);
    goRoiChot(o(2, "unitPrice"), "=F1*20%");
    expect(canhBao(items[2], "unitPrice")).toBe(true);
    goRoiChot(o(2, "unitPrice"), "=F4*20%");   // trỏ sang nhóm khác
    expect(canhBao(items[2], "unitPrice"), "cờ đỏ kẹt lại sau khi công thức đã sửa đúng").toBe(false);
  });

  it("SUM trên dải qua các mục thường vẫn đúng — lối thoát cho ca vòng lặp", () => {
    // Người dùng muốn "20% của phần sản xuất" mà chính mình nằm trong nhóm đó thì đây là cách làm:
    // cộng thẳng các hàng cần cộng. Bài này khoá lối thoát ấy để nó không hỏng lặng lẽ.
    const items = bo();
    moLuoi(items);
    goRoiChot(o(4, "unitPrice"), "=SUM(G2:G3)*20%");
    expect(items[4].unitPrice).toBe(1_400_000);
  });

  it("bấm vào ô Đơn Giá của hàng NHÓM lúc đang gõ → CHÈN được tham chiếu", () => {
    // "mấy cột đơn giá hay thành tiền nhóm con nhóm cha gì chưa cho click á".
    const items = bo();
    moLuoi(items);
    const el = o(4, "unitPrice");
    act(() => { el.focus(); el.value = "="; el.dispatchEvent(new Event("input", { bubbles: true })); });

    const oNhom = hop!.querySelector('tr[data-row="0"] td.col-price') as HTMLElement;
    expect(oNhom, "hàng nhóm không có ô Đơn Giá").toBeTruthy();
    act(() => { oNhom.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 })); });
    expect(el.value, "bấm ô Đơn Giá của nhóm mà không chèn tham chiếu nào").toBe("=F1");
  });

  it("bấm vào ô Thành Tiền của hàng NHÓM cũng chèn được", () => {
    const items = bo();
    moLuoi(items, { groupSubtotal: true });
    const el = o(4, "unitPrice");
    act(() => { el.focus(); el.value = "="; el.dispatchEvent(new Event("input", { bubbles: true })); });

    const oTien = hop!.querySelector('tr[data-row="0"] td.col-amount') as HTMLElement;
    act(() => { oTien.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 })); });
    expect(el.value).toBe("=G1");
  });
});
