/** @vitest-environment jsdom */
/**
 * ============================================================================
 * MỘT THANH "+ THÊM HÀNG…" DUY NHẤT, PHỤC VỤ ĐÚNG BẢNG ĐANG ĐỨNG.
 *
 * ── NGƯỜI DÙNG BÁO (ảnh chụp, 2026-09-17) ─────────────────────────────────
 * "cái thêm hàng này xài chung cái kia được không nhưng thông minh các thứ được không" ·
 * "cái thêm hàng lấy theo kiểu target rồi mà biết đang ở đâu là nhấn vào là được rồi" ·
 * "chưa có cái tổng như cái của báo giá chính cho từng cái".
 *
 * ── VÌ SAO KHÔNG PHẢI CHUYỆN THẨM MỸ ──────────────────────────────────────
 * Trang soạn báo giá có tới BA lưới: báo giá chính, sheet nội bộ (HCM / Phí KH), sheet Hà Nội.
 * Mỗi lưới tự vẽ thanh nút của nó, nên màn hình có hai hàng nút GIỐNG HỆT nhau cách nhau 40px mà
 * tác động lên hai bảng KHÁC NHAU. Thêm nhầm bảng là lỗi IM LẶNG — dòng rơi vào sai bảng, tổng
 * tiền của luồng kia đổi theo, không có thông báo nào.
 *
 * ── LUẬT ĐÃ CHỐT ──────────────────────────────────────────────────────────
 *   · Có `thanhChung` → lưới KHÔNG tự vẽ thanh; chỉ lưới đang được dùng mới portal thanh xuống ô
 *     dock ở đáy. Chạm vào lưới nào (bấm chuột hoặc Tab vào ô) thì lưới đó chiếm thanh.
 *   · Đóng khối đang chiếm thanh → trả về "chinh", nếu không thanh trỏ vào một lưới đã tháo khỏi
 *     DOM và biến mất sạch.
 *   · KHÔNG có `thanhChung` → y như cũ: mỗi lưới tự vẽ thanh tại chỗ (AccountHnView, bench, test).
 *   · Tiền chỉ hiện MỘT chỗ: đóng → tiêu đề khối; mở + có bảng tổng → trong bảng tổng.
 * ============================================================================
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { HnTables, type HnTable } from "./HnTables";
import { nextK, type ItemK, type ThanhChung } from "../lib/gridShared";
import type { EditorTemplate } from "../lib/api";

vi.mock("../lib/venueCatalog", async (nhapGoc) => {
  const goc = await nhapGoc<typeof import("../lib/venueCatalog")>();
  return { ...goc, loadCatalog: () => Promise.resolve({ entries: [], venues: [] }) };
});
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

let thung: HTMLDivElement, dock: HTMLDivElement, goc: Root;
/** Trạng thái "lưới nào đang chiếm thanh", đúng như QuoteEditor giữ. */
let dangLam: { id: string; nhan: string };

beforeEach(() => {
  thung = document.createElement("div");
  dock = document.createElement("div");
  dock.id = "dock";
  document.body.append(thung, dock);
  goc = createRoot(thung);
  dangLam = { id: "chinh", nhan: "Báo giá chính" };
});
afterEach(() => { act(() => goc.unmount()); thung.remove(); dock.remove(); document.body.innerHTML = ""; });

function ve(tables: HnTable[], coThanhChung = true) {
  const thanhChung: ThanhChung | undefined = coThanhChung
    ? { dock, dangLam: dangLam.id, datDangLam: (id, nhan) => { dangLam = { id, nhan }; ve(tables, coThanhChung); } }
    : undefined;
  act(() => {
    goc.render(<HnTables moMacDinh tables={tables} templates={MAU} companyId={1} editable onMarkDirty={() => {}} thanhChung={thanhChung} />);
  });
}

const thanhTrongKhoi = () => thung.querySelector(".grid-add-bar");
const thanhODay = () => dock.querySelector(".grid-add-bar");
const oDauTien = () => thung.querySelector<HTMLInputElement>('tr[data-row="0"] [data-f="unitPrice"]')!;

describe("Thanh + Thêm hàng dùng chung", () => {
  it("có thanh chung: lưới KHÔNG tự vẽ thanh khi chưa được chạm vào", () => {
    // Đây là vế bỏ hàng nút thứ hai. Còn vẽ = vẫn hai hàng nút giống hệt nhau trên một màn.
    ve([bang("Bảng 1", [1_000_000])]);
    expect(thanhTrongKhoi(), "lưới vẫn tự vẽ thanh dù đã có thanh chung").toBeNull();
    expect(thanhODay(), "chưa chạm vào lưới HN thì thanh chưa thuộc về nó").toBeNull();
  });

  it("bấm vào lưới → thanh ở ĐÁY thuộc về lưới đó, kèm TÊN BẢNG", () => {
    // "bấm vào đâu là thêm hàng vào đó". Tên bảng là lớp chặn nhầm, không phải trang trí.
    ve([bang("Hà Nội 1", [1_000_000])]);
    act(() => { oDauTien().dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 })); });
    expect(dangLam.id).toBe("hn");
    expect(dangLam.nhan).toBe("Hà Nội · Hà Nội 1");
    expect(thanhODay(), "chạm vào lưới HN rồi mà thanh ở đáy vẫn trống").toBeTruthy();
    expect(thanhTrongKhoi(), "thanh phải nằm ở ĐÁY, không phải trong khối").toBeNull();
  });

  it("Tab vào một ô cũng tính là đang đứng ở lưới đó", () => {
    // Người dùng bàn phím không bấm chuột bao giờ — bỏ nhánh này là họ mất hẳn nút thêm hàng.
    ve([bang("Hà Nội 1", [1_000_000])]);
    // `.focus()` chứ không phải `dispatchEvent(new FocusEvent("focus"))`: React nghe `focusin`
    // (sự kiện NỔI BỌT) chứ không nghe `focus`, nên bắn tay sự kiện "focus" không tới handler nào.
    act(() => { oDauTien().focus(); });
    expect(dangLam.id).toBe("hn");
  });

  it("ĐÓNG khối đang chiếm thanh → trả thanh về báo giá chính", () => {
    // Không trả thì thanh trỏ vào một lưới đã tháo khỏi DOM → nút thêm hàng biến mất sạch.
    ve([bang("Hà Nội 1", [1_000_000])]);
    act(() => { oDauTien().dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 })); });
    expect(dangLam.id).toBe("hn");
    act(() => { thung.querySelector<HTMLButtonElement>(".khoi-sheet-nut")!.click(); });
    expect(dangLam.id, "đóng khối rồi mà thanh vẫn trỏ vào lưới đã biến mất").toBe("chinh");
  });

  it("KHÔNG có thanh chung (AccountHnView) → lưới tự vẽ thanh tại chỗ, y như cũ", () => {
    // Vế đối trọng: trang của account HN không có thanh đáy nào cả. Bắt buộc dùng thanh chung ở
    // đó là họ mất luôn nút thêm hàng.
    ve([bang("Bảng 1", [1_000_000])], false);
    expect(thanhTrongKhoi(), "không có thanh chung mà lưới cũng không vẽ thanh").toBeTruthy();
  });
});

describe("Gộp phần giao việc Hà Nội vào ĐÚNG một khối", () => {
  /* ── NGƯỜI DÙNG BÁO ────────────────────────────────────────────────────────────────────────
     "Phần Hà Nội (Account) / Account đang làm sao không nằm cùng với hà nội luôn đi".

     Ba thứ cùng nói về phần Hà Nội từng nằm rải rác trong trang soạn báo giá, lại bị khối "Bảng
     nội bộ" chen vào giữa: thẻ giao việc Ở TRÊN, khối sheet Ở DƯỚI, dòng báo khoá ở dưới nữa.

     Luật: trạng thái lên TIÊU ĐỀ (liếc thấy cả khi khối đang đóng — đó là thứ quản lý cần biết
     mà không phải mở), còn nút giao việc / duyệt / trả lại nằm trong THÂN (hành động thì mở ra
     mới làm). */
  const veCoSlot = (tables: HnTable[], mo: boolean) => {
    act(() => {
      goc.render(
        <HnTables moMacDinh={mo} tables={tables} templates={MAU} companyId={1} editable onMarkDirty={() => {}}
          phuHieu={<span className="ahn-status">Account đang làm</span>}
          dieuKhien={<div className="hn-mgr-panel">Giao việc</div>} />,
      );
    });
  };

  it("ĐÓNG: trạng thái vẫn đọc được trên tiêu đề, nút giao việc thì KHÔNG", () => {
    veCoSlot([bang("Bảng 1", [1_000_000])], false);
    const dau = thung.querySelector(".extra-cat-grouphead");
    expect(dau?.textContent, "đóng khối là mất luôn trạng thái phần HN").toContain("Account đang làm");
    expect(thung.querySelector(".hn-mgr-panel"), "nút giao việc lộ ra khi khối đang đóng").toBeNull();
  });

  it("MỞ: nút giao việc nằm TRONG khối, ngay trên dải tab", () => {
    veCoSlot([bang("Bảng 1", [1_000_000])], true);
    const khoi = thung.querySelector(".khoi-sheet");
    const gv = khoi?.querySelector(".hn-mgr-panel");
    const tab = khoi?.querySelector(".sheet-tabs");
    expect(gv, "mở khối mà không thấy phần giao việc").toBeTruthy();
    expect(tab, "không thấy dải tab để so vị trí").toBeTruthy();
    // Phải đứng TRƯỚC dải tab — giao việc là bước đầu, không phải thứ lục dưới đáy mới thấy.
    const truocTab = !!(gv!.compareDocumentPosition(tab!) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(truocTab, "giao việc bị đẩy xuống dưới dải tab").toBe(true);
  });

  it("KHÔNG truyền slot (màn account HN) → không vẽ gì thêm", () => {
    // Vế đối trọng: account HN không có quyền giao việc, và trang của họ không có hai thẻ đó.
    ve([bang("Bảng 1", [1_000_000])], false);
    expect(thung.querySelector(".hn-mgr-panel")).toBeNull();
    expect(thung.querySelector(".ahn-status")).toBeNull();
  });
});

describe("Bảng tổng của một luồng", () => {
  const bangTong = () => thung.querySelector(".khoi-sheet-tong");
  const moiSoTien = () => [...(thung.textContent || "").matchAll(/\d{1,3}(?:\.\d{3})+/g)].map((m) => Number(m[0].replace(/\./g, "")));

  it("HAI sheet: có bảng liệt kê từng sheet + dòng Tổng cộng, giống báo giá chính", () => {
    ve([bang("Hà Nội 1", [1_000_000]), bang("Hà Nội 2", [2_500_000])]);
    const b = bangTong();
    expect(b, "không dựng bảng tổng cho luồng").toBeTruthy();
    const dong = [...b!.querySelectorAll("tbody tr")].map((tr) => [...tr.querySelectorAll("td")].map((td) => td.textContent));
    expect(dong).toEqual([["1", "Hà Nội 1", "1.000.000"], ["2", "Hà Nội 2", "2.500.000"]]);
    expect(b!.querySelector("tfoot")?.textContent).toContain("3.500.000");
  });

  it("MỞ + có bảng tổng → tiêu đề KHÔNG in lại số tiền nữa", () => {
    // Một con số một chỗ. In ở cả hai là lặp đúng kiểu người dùng đã kêu rườm rà.
    ve([bang("A", [1_000_000]), bang("B", [2_500_000])]);
    expect(moiSoTien().filter((x) => x === 3_500_000).length, "tổng cộng hiện nhiều hơn một lần").toBe(1);
  });

  it("MỘT sheet: KHÔNG dựng bảng tổng — một dòng rồi cộng lại chính nó là vô nghĩa", () => {
    // HAI hạng mục cộng lại thành 4.204.000 — nếu dùng MỘT hạng mục đúng bằng con số đó thì chính
    // ô Đơn Giá và ô Thành Tiền trong lưới cũng in nó ra, và phép đếm không còn nói lên điều gì.
    ve([bang("Bảng 1", [2_186_000, 2_018_000])]);
    expect(bangTong()).toBeNull();
    expect(moiSoTien().filter((x) => x === 4_204_000).length, "một sheet thì tiền nằm ở tiêu đề, đúng một lần").toBe(1);
  });
});
