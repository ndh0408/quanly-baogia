/** @vitest-environment jsdom */
/**
 * CÔNG THỨC ĐÃ LƯU NAY KHÔNG TÍNH ĐƯỢC → Ô ĐỎ NGAY KHI MỞ, SỐ GIỮ NGUYÊN (soát toàn diện đợt 3).
 *
 * Bộ đọc công thức đã chặt hơn (dấu phẩy mơ hồ, khoảng trắng giữa số, dải sai chỗ…): công thức lưu
 * từ trước như "=ROUND(F1*0,5)" nay trả null. recomputeAll giữ số đã lưu (đúng — không mất tiền)
 * nhưng KHÔNG báo gì: ô không đỏ, và khi ô đầu vào đổi thì số đứng im im lặng. Cờ đỏ lại không được
 * máy chủ lưu (zod bỏ `_fxLoi`), nên mở lại báo giá là mọi dấu hiệu biến mất.
 *
 * Nay: (1) mở lưới là soát một lượt CHỈ ĐỂ BẬT cờ — không ghi số; (2) recomputeAll gặp null cũng bật
 * cờ thay vì bỏ qua. Công thức ở cột CHỮ (Ghi Chú "=== …") không bị tô — commitCell vốn không tô.
 * Trừ Ô ĐANG GÕ: công thức gõ dở ("=", "=F1*", "=ROUND(") vốn chưa tính được — tô đỏ ở đó là nháy đỏ
 * mỗi phím, và nuốt luôn lời báo GRID-03 lúc chốt (phản biện đợt 3). Ô đó để commitCell xử lúc chốt.
 *
 * Sơ đồ địa chỉ (usesDays bật, addrDetail tắt): A=STT B=Hạng Mục C=ĐVT D=Số Lượng E=Số Ngày
 * F=Đơn Giá G=Thành Tiền H=Ghi Chú.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { GridTable } from "./GridTable";
import { nextK, type ItemK } from "../lib/gridShared";

vi.mock("../lib/venueCatalog", async (g) => ({ ...(await g<typeof import("../lib/venueCatalog")>()), loadCatalog: () => Promise.resolve({ entries: [], venues: [] }) }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mk = (o: Partial<ItemK>): ItemK => ({ _k: nextK(), kind: "item", name: "", unit: "bộ", quantity: 1, days: 1, unitPrice: 0, notes: "", ...o }) as ItemK;

let root: Root | null = null;
let hop: HTMLDivElement | null = null;
afterEach(() => { if (root) act(() => root!.unmount()); hop?.remove(); root = null; hop = null; document.body.innerHTML = ""; });

let veLai: () => void = () => {};
function Vo({ items }: { items: ItemK[] }) {
  const [, b] = useState(0);
  veLai = () => b((v) => v + 1);
  return <GridTable items={items} usesDays showDetail={false} addrDetail={false} numberSubs={false} editable internalNote={false}
    groupSubtotal={false} fxBar onChange={() => b((v) => v + 1)} />;
}
function moLuoi(items: ItemK[]) {
  hop = document.createElement("div"); document.body.appendChild(hop); root = createRoot(hop);
  act(() => root!.render(<Vo items={items} />));
}
const o = (row: number, f: string) => hop!.querySelector(`tr[data-row="${row}"] [data-f="${f}"]`) as HTMLInputElement;
const oDo = (row: number, f: string) => !!o(row, f).closest("td")?.classList.contains("cell-fx-error");
/** Chữ của mọi toast đang hiện (afterEach dọn body nên mỗi bài bắt đầu trống). */
const toastChu = () => document.getElementById("toast-host")?.textContent ?? "";
const BAO_LOI = "Công thức không tính được";
/** Gõ từng bước (mỗi chuỗi là nội dung ô sau một phím) — KHÔNG rời ô. */
function goTungPhim(el: HTMLInputElement, cacBuoc: string[], moiBuoc?: (chu: string) => void) {
  for (const chu of cacBuoc) {
    act(() => { el.value = chu; el.dispatchEvent(new Event("input", { bubbles: true })); });
    moiBuoc?.(chu);
  }
}
function goRoiChot(el: HTMLInputElement, chu: string) {
  act(() => { el.focus(); });
  act(() => { el.value = chu; el.dispatchEvent(new Event("input", { bubbles: true })); });
  act(() => { el.blur(); });
}

describe("Công thức đã lưu trả null", () => {
  it("mở lưới: =ROUND(F1*0,5) đỏ NGAY, số 525.000 giữ nguyên; công thức đúng không đỏ", () => {
    const items = [
      mk({ name: "Gốc", unitPrice: 1_050_000 }),
      mk({ name: "Mơ hồ", unitPrice: 525_000, formulas: { unitPrice: "=ROUND(F1*0,5)" } } as Partial<ItemK>),
      mk({ name: "Đúng", unitPrice: 525_000, formulas: { unitPrice: "=ROUND(F1*0,5;0)" } } as Partial<ItemK>),
      mk({ name: "Ghi chú", notes: "=== xem kỹ ===", formulas: { notes: "=== xem kỹ ===" } } as Partial<ItemK>),
    ];
    moLuoi(items);
    expect(oDo(1, "unitPrice"), "công thức không tính được mà ô không đỏ").toBe(true);
    expect(items[1].unitPrice).toBe(525_000);
    expect(oDo(2, "unitPrice")).toBe(false);
    expect(items[2].unitPrice).toBe(525_000);   // lúc mở KHÔNG tính lại để ghi số
    expect((items[3] as unknown as { _fxLoi?: unknown })._fxLoi).toBeUndefined();
  });

  it("sửa ô khác (recomputeAll) → ô vẫn đỏ, số vẫn giữ", () => {
    const items = [
      mk({ name: "Gốc", unitPrice: 1_050_000 }),
      mk({ name: "Mơ hồ", unitPrice: 525_000, formulas: { unitPrice: "=ROUND(F1*0,5)" } } as Partial<ItemK>),
      mk({ name: "Khác" }),
    ];
    moLuoi(items);
    goRoiChot(o(2, "quantity"), "2");
    expect(items[1].unitPrice).toBe(525_000);
    expect(oDo(1, "unitPrice")).toBe(true);
  });

  it("bấm vào ô đỏ rồi rời đi (không gõ gì) → số KHÔNG thành 0, ô vẫn đỏ", () => {
    const items = [
      mk({ name: "Gốc", unitPrice: 1_050_000 }),
      mk({ name: "Mơ hồ", unitPrice: 525_000, formulas: { unitPrice: "=ROUND(F1*0,5)" } } as Partial<ItemK>),
    ];
    moLuoi(items);
    const el = o(1, "unitPrice");
    act(() => { el.focus(); });
    expect(el.value).toBe("=ROUND(F1*0,5)");
    act(() => { el.blur(); });
    expect(items[1].unitPrice, "rời ô không gõ gì mà đơn giá thành 0").toBe(525_000);
    expect(items[1].formulas?.unitPrice).toBe("=ROUND(F1*0,5)");
    expect(oDo(1, "unitPrice")).toBe(true);
  });

  it("GÕ lại công thức hỏng rồi chốt → vẫn như GRID-03 (ô đỏ, báo lỗi)", () => {
    const items = [mk({ name: "Gốc", unitPrice: 1_050_000 }), mk({ name: "Mới" })];
    moLuoi(items);
    goRoiChot(o(1, "unitPrice"), "=ROUND(F1*0,5)");
    expect(oDo(1, "unitPrice")).toBe(true);
    expect(toastChu(), "chốt công thức hỏng mà không báo — lời nhắc dấu ';' mất").toContain(BAO_LOI);
  });

  // Phản biện đợt 3: recomputeAll bật cờ cho MỌI null — kể cả công thức người dùng ĐANG GÕ dở ở chính ô
  // đó (onNumInput gọi recomputeAll mỗi phím). Ô nháy đỏ ở mọi bước dở, và lúc chốt commitCell thấy cờ
  // vừa bật khi gõ → coi là "đã đỏ từ trước" → không báo GRID-03.
  it("gõ DỞ công thức từng phím → ô KHÔNG nháy đỏ; công thức đúng thì chốt ra số", () => {
    const items = [mk({ name: "Gốc", unitPrice: 1_050_000 }), mk({ name: "Mới" })];
    moLuoi(items);
    const el = o(1, "unitPrice");
    act(() => { el.focus(); });
    const nhayDo: string[] = [];
    goTungPhim(el, ["=", "=F", "=F1", "=F1*", "=F1*2", "=ROUND(", "=ROUND(F1", "=ROUND(F1;0)"], (chu) => { if (oDo(1, "unitPrice")) nhayDo.push(chu); });
    expect(nhayDo, "ô đang gõ nháy đỏ ở các bước dở").toEqual([]);
    act(() => { el.blur(); });
    expect(items[1].unitPrice).toBe(1_050_000);
    expect(oDo(1, "unitPrice")).toBe(false);
    expect(toastChu()).not.toContain(BAO_LOI);
  });

  it("gõ '=F1*' (từng phím) rồi rời ô → ô đỏ VÀ báo GRID-03", () => {
    const items = [mk({ name: "Gốc", unitPrice: 1_050_000 }), mk({ name: "Mới" })];
    moLuoi(items);
    const el = o(1, "unitPrice");
    act(() => { el.focus(); });
    goTungPhim(el, ["=", "=F", "=F1", "=F1*"]);
    act(() => { el.blur(); });
    expect(oDo(1, "unitPrice")).toBe(true);
    expect(items[1].unitPrice).toBe(0);
    expect(toastChu(), "chốt công thức hỏng mà không báo").toContain(BAO_LOI);
  });

  it("ô số vẫn là 0: gõ công thức hỏng rồi rời ô → ô ĐỎ ngay (chỉ cờ đổi cũng phải vẽ lại)", () => {
    // Số trước và sau khi chốt cùng là 0, công thức đã được onNumInput ghi live → chỉ còn CỜ đổi.
    const items = [mk({ name: "Gốc", unitPrice: 1_050_000 }), mk({ name: "Mới" })];
    moLuoi(items);
    goRoiChot(o(1, "unitPrice"), "=F1*");
    expect(items[1].unitPrice).toBe(0);
    expect(oDo(1, "unitPrice"), "cờ đỏ đã bật mà ô chưa vẽ lại").toBe(true);
  });

  it("gõ '=' rồi đổi ý gõ số 700 → không đỏ lúc gõ số, chốt ra 700", () => {
    const items = [mk({ name: "Gốc", unitPrice: 1_050_000 }), mk({ name: "Mới" })];
    moLuoi(items);
    const el = o(1, "unitPrice");
    act(() => { el.focus(); });
    const nhayDo: string[] = [];
    goTungPhim(el, ["=", "", "7", "70", "700"], (chu) => { if (oDo(1, "unitPrice")) nhayDo.push(chu || "(trống)"); });
    expect(nhayDo, "ô đỏ trong lúc gõ số").toEqual([]);
    act(() => { el.blur(); });
    expect(items[1].unitPrice).toBe(700);
    expect(items[1].formulas?.unitPrice).toBeUndefined();
    expect(oDo(1, "unitPrice")).toBe(false);
  });

  it("gõ ở ô A, ô B trỏ vào A mà thành null → B VẪN đỏ (chỉ riêng ô đang gõ được miễn)", () => {
    const items = [mk({ name: "A", unitPrice: 4 }), mk({ name: "B", unitPrice: 250, formulas: { unitPrice: "=1000/F1" } } as Partial<ItemK>)];
    moLuoi(items);
    expect(oDo(1, "unitPrice")).toBe(false);
    const el = o(0, "unitPrice");
    act(() => { el.focus(); });
    goTungPhim(el, ["=", "=0", "=0*"]);   // "=0" → F1 = 0 → B chia 0
    expect(oDo(1, "unitPrice"), "ô B chia 0 không đỏ").toBe(true);
    expect(items[1].unitPrice).toBe(250);
    expect(oDo(0, "unitPrice")).toBe(false);
  });

  it("chia 0 lúc mở → đỏ; đầu vào sửa hết lỗi thì tính lại và hết đỏ", () => {
    const items = [
      mk({ name: "Chia", unitPrice: 0, days: 1 }),
      mk({ name: "Kq", unitPrice: 777, formulas: { unitPrice: "=1000/F1" } } as Partial<ItemK>),
    ];
    moLuoi(items);
    expect(oDo(1, "unitPrice")).toBe(true);
    expect(items[1].unitPrice).toBe(777);
    goRoiChot(o(0, "unitPrice"), "4");
    expect(items[1].unitPrice).toBe(250);
    act(() => veLai());
    expect(oDo(1, "unitPrice")).toBe(false);
  });
});
