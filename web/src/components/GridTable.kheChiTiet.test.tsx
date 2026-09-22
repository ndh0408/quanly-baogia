/** @vitest-environment jsdom */
//
// KHE ĐỊA CHỈ Ô CỦA CỘT CHI TIẾT — BÀI GÁC CHO CÔNG THỨC ĐÃ LƯU.
//
// ── LỖ HỔNG NÀY ĐO ĐƯỢC, KHÔNG PHẢI PHÒNG XA ────────────────────────────────
// `GridTable.tsx` chừa khe theo `keepDetailSlot = addrDetail ?? showDetail`. Đổi nó thành
// `= showDetail` rồi chạy CẢ 398 bài của `web/`: XANH HẾT. Tức bất biến quan trọng nhất của đợt
// thêm cột Chi Tiết không có cổng nào gác.
//
// Và đột biến đó KHÔNG vô hại. Đo trên `dist/templateConfigs.js`:
//     marico_decor    detail="D"  removeDetail=true   → reserveDetail=true, hasDetail=FALSE
//     gn_banner       detail="D"  removeDetail=true   → reserveDetail=true, hasDetail=FALSE
//     clofull_*       detail="D"  removeDetail=false  → cả hai TRUE
// Hai mẫu lệch đều là mẫu GIA NGUYỄN — đúng phía người dùng dặn "để yên không đụng tới".
// `metaService.ts:16-17` sinh ra cặp lệch ấy: `hasDetail = !!cols.detail && !removeDetail` còn
// `reserveDetail = !!cols.detail`. Với GN, khe D phải CÒN dù cột không hiện; mất khe là mọi chữ
// cột sau D lùi một bậc, nên công thức đã lưu kiểu `=F3*E3` của báo giá GN cũ trỏ sang cột khác —
// im lặng, không báo lỗi, chỉ ra số sai trong tệp gửi khách.
//
// ── CÁCH ĐO ─────────────────────────────────────────────────────────────────
// Không so với chữ cột đóng cứng (`"F"`), vì như thế bài kiểm chỉ lặp lại hằng số trong mã. So
// BA cấu hình với nhau: bật khe thì chữ cột phải Y NHAU dù cột có hiện hay không, còn tắt khe thì
// phải LÙI — vế sau là vế chứng minh phép đo thật sự nhìn thấy sự khác biệt.
import { describe, it, expect, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { GridTable, type GridTableProps } from "./GridTable";
import { nextK, type ItemK } from "../lib/gridShared";

// Lưới gọi `loadCatalog()` → `fetch()`; trong jsdom không có server nên chặn đúng lối ra mạng,
// giữ nguyên mọi hàm thuần của module (xem chú thích cùng việc ở GridTable.component.test.tsx).
const kho = vi.hoisted(() => ({ danhMuc: { entries: [] as unknown[], venues: [] as unknown[] } }));
vi.mock("../lib/venueCatalog", async (nhapGoc) => {
  const goc = await nhapGoc<typeof import("../lib/venueCatalog")>();
  return { ...goc, loadCatalog: () => Promise.resolve(kho.danhMuc) };
});
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let hop: HTMLDivElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  hop?.remove();
  root = null; hop = null;
});

const mot = (): ItemK[] => [{ _k: nextK(), kind: "item", name: "Mục 1", detail: "", unit: "m2", quantity: 2, unitPrice: 1000, notes: "" } as unknown as ItemK];

/** Dựng lưới rồi trả về CHỮ CỘT mà thanh fx báo cho ô (hàng 0, trường `f`). */
function chuCotCua(f: string, them: Partial<GridTableProps>): string {
  hop = document.createElement("div");
  document.body.appendChild(hop);
  root = createRoot(hop);
  act(() => root!.render(
    <GridTable items={mot()} usesDays={false} numberSubs={false} editable internalNote={false}
      groupSubtotal={false} fxBar showDetail={false} onChange={() => {}} {...them} />,
  ));
  const el = hop.querySelector(`tr[data-row="0"] [data-f="${f}"]`) as HTMLElement | null;
  if (!el) throw new Error(`không thấy ô (0, ${f}) — lưới đổi bộ chọn?`);
  act(() => el.focus());
  const addr = (hop.querySelector("#fx-addr") as HTMLElement | null)?.textContent || "";
  const m = /^([A-Z]+)\d+$/.exec(addr.trim());
  if (!m) throw new Error(`thanh fx không báo địa chỉ hợp lệ cho ${f}: ${JSON.stringify(addr)}`);
  act(() => root!.unmount());
  hop.remove(); root = null; hop = null;
  return m[1];
}

describe("khe địa chỉ ô của cột Chi Tiết", () => {
  // Mọi cột NẰM SAU khe Chi Tiết trong sơ đồ địa chỉ — cột nào cũng lùi một bậc nếu mất khe.
  const SAU_KHE = ["unit", "quantity", "unitPrice", "notes"];   // "_amount" là ô KHOÁ, không có input data-f

  it("GN (khe CÒN, cột ẨN) có chữ cột Y HỆT Colorfull (khe còn, cột hiện)", () => {
    for (const f of SAU_KHE) {
      const gn = chuCotCua(f, { addrDetail: true, showDetail: false });   // marico_decor · gn_banner
      const clf = chuCotCua(f, { addrDetail: true, showDetail: true });   // clofull_*
      expect(gn, `cột ${f}: ẨN cột Chi Tiết làm TRÔI chữ cột — công thức GN đã lưu trỏ sai`).toBe(clf);
    }
  });

  it("và phép đo trên THẬT SỰ thấy được sự khác biệt: bỏ khe thì chữ cột LÙI một bậc", () => {
    // Vế đối trọng. Thiếu nó, bài trên vẫn xanh kể cả khi `chuCotCua` trả một hằng số — đúng loại
    // bài kiểm rỗng đã từng lọt ở đợt này (một hàm phụ trợ hỏi ô "có mượn cột khác không", mà ô
    // chủ luôn trả lời không, nên mọi khẳng định đều xanh mà chẳng đo gì).
    for (const f of SAU_KHE) {
      const coKhe = chuCotCua(f, { addrDetail: true, showDetail: false });
      const khongKhe = chuCotCua(f, { addrDetail: false, showDetail: false });   // unibenfood: không khai cột detail
      expect(khongKhe.charCodeAt(0), `cột ${f}: bỏ khe mà chữ cột KHÔNG lùi — phép đo không nhìn thấy khe`)
        .toBe(coKhe.charCodeAt(0) - 1);
    }
  });
});
