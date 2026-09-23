/** @vitest-environment jsdom */
/**
 * ============================================================================
 * DÁN KHỐI BÁO GIÁ (copy từ file Excel app xuất ra, KHÔNG kèm hàng tiêu đề) SANG SHEET KHÁC MẪU.
 *
 * Người dùng báo 2026-09-23: "paste bị lỗi cho cả colorfull và GN". Đo trên dev bằng 129 dòng
 * sheet "1. Banner" (CLF không ngày): dán vào sheet CÓ NGÀY thì cột lệch —
 *   · CLF có ngày: đơn giá 95.000 rơi vào Số Ngày, nhóm con thành hạng mục;
 *   · GN có ngày: ". PP in KTS" rơi vào ĐVT, Số Lượng thành 2.
 * Bật/tắt cột Hình ảnh KHÔNG đổi kết quả; khối xuất khi bật ảnh chỉ thừa một cột rỗng ở cuối.
 * Bản sửa: đoán bố cục FILE NGUỒN bằng SL × ĐG (× Ngày) ≈ Thành Tiền (lib/doanBoCot.ts).
 *
 * Dữ liệu dưới đây DỰNG TAY theo đúng bố cục cột của từng mẫu (src/templateConfigs.ts `columns`).
 * ============================================================================
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { GridTable } from "./GridTable";
import { nextK, type ItemK } from "../lib/gridShared";

vi.mock("../lib/venueCatalog", async (g) => ({ ...(await g<typeof import("../lib/venueCatalog")>()), loadCatalog: () => Promise.resolve({ entries: [], venues: [] }) }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const tsv = (rows: string[][]) => rows.map((r) => r.join("\t")).join("\r\n") + "\r\n";
// Nguồn 1 — CLF / GN KHÔNG ngày: STT | Hạng Mục | Chi Tiết | ĐVT | SL | Đơn Giá | Thành Tiền | Ghi Chú
const KHONG_NGAY = [
  ["A", "HCM", "", "", "", "1,120,000", "", ""],
  ["1", "SVH - hallway", "", "", "", "896,000", "", "18/9 thay Dream"],
  ["", "Hallway 2m75W x 2m05H", ". PP in KTS", "m2", "5.6", "95,000", "532,000", ""],
  ["", "Chi phí thi công", "", "m2", "5.6", "65,000", "364,000", ""],
  ["", "Giao hàng", "", "bộ", "1", "224,000", "224,000", ""],
];
// Nguồn 2 — CLF CÓ ngày: STT | Hạng Mục | Chi Tiết | ĐVT | SL | Số Ngày | Đơn Giá | Thành Tiền | Ghi Chú
const CLF_CO_NGAY = [
  ["A", "HCM", "", "", "", "", "2,016,000", "", ""],
  ["1", "SVH - hallway", "", "", "", "", "1,792,000", "", "18/9 thay Dream"],
  ["", "Hallway 2m75W x 2m05H", ". PP in KTS", "m2", "5.6", "2", "95,000", "1,064,000", ""],
  ["", "Chi phí thi công", "", "m2", "5.6", "2", "65,000", "728,000", ""],
  ["", "Giao hàng", "", "bộ", "1", "1", "224,000", "224,000", ""],
];
// Nguồn 3 — GN CÓ ngày: STT | Hạng Mục | ĐVT | SL | Số Ngày | Đơn Giá | Thành Tiền | Ghi Chú
const GN_CO_NGAY = [
  ["A", "HCM", "", "", "", "2,016,000", "", ""],
  ["1", "SVH - hallway", "", "", "", "1,792,000", "", "18/9 thay Dream"],
  ["", "Hallway 2m75W x 2m05H", "m2", "5.6", "2", "95,000", "1,064,000", ""],
  ["", "Chi phí thi công", "m2", "5.6", "2", "65,000", "728,000", ""],
  ["", "Giao hàng", "bộ", "1", "1", "224,000", "224,000", ""],
];
const themCotAnh = (rows: string[][]) => rows.map((r) => [...r, ""]);   // xuất khi BẬT cột Hình ảnh

const MAU: Record<string, { usesDays: boolean; showDetail: boolean; addrDetail: boolean }> = {
  "CLF không ngày": { usesDays: false, showDetail: true, addrDetail: true },
  "CLF có ngày": { usesDays: true, showDetail: true, addrDetail: true },
  "GN không ngày": { usesDays: false, showDetail: false, addrDetail: true },
  "GN có ngày": { usesDays: true, showDetail: false, addrDetail: false },
};
const NGUON: Record<string, { rows: string[][]; ngay: number; coChiTiet: boolean }> = {
  "khối không ngày": { rows: KHONG_NGAY, ngay: 1, coChiTiet: true },
  "khối CLF có ngày": { rows: CLF_CO_NGAY, ngay: 2, coChiTiet: true },
  "khối GN có ngày": { rows: GN_CO_NGAY, ngay: 2, coChiTiet: false },
};

let root: Root | null = null;
let hop: HTMLDivElement | null = null;
afterEach(async () => {
  await act(async () => { await new Promise((r) => setTimeout(r, 220)); });
  if (root) act(() => root!.unmount());
  hop?.remove(); root = null; hop = null; document.body.innerHTML = "";
});

function Vo({ items, p, anh }: { items: ItemK[]; p: (typeof MAU)[string]; anh: boolean }) {
  const [, b] = useState(0);
  return <GridTable items={items} editable numberSubs={false} groupSubtotal={false} fxBar internalNote onChange={() => b((v) => v + 1)}
    usesDays={p.usesDays} showDetail={p.showDetail} addrDetail={p.addrDetail} showImages={anh} onShowImages={() => {}} />;
}
function danVao(p: (typeof MAU)[string], anh: boolean, text: string): ItemK[] {
  const items = [{ _k: nextK(), kind: "item", name: "", unit: "", quantity: 0, days: 1, unitPrice: 0, notes: "" } as ItemK];
  hop = document.createElement("div"); document.body.appendChild(hop); root = createRoot(hop);
  act(() => root!.render(<Vo items={items} p={p} anh={anh} />));
  const el = hop.querySelector('tr[data-row="0"] [data-f="name"]') as HTMLElement;
  act(() => { el.focus(); });
  const ev = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "clipboardData", { value: { getData: (k: string) => (k === "text/plain" ? text : "") } });
  act(() => { el.dispatchEvent(ev); });
  return items;
}

describe("Dán khối báo giá sang sheet khác mẫu — cột phải vào đúng chỗ", () => {
  for (const [tenMau, p] of Object.entries(MAU)) for (const [tenNguon, n] of Object.entries(NGUON)) for (const anh of [false, true]) {
    it(`${tenNguon}${anh ? " (+ cột HÌNH ẢNH)" : ""} → sheet ${tenMau}${anh ? ", cột ảnh BẬT" : ""}`, () => {
      const items = danVao(p, anh, tsv(anh ? themCotAnh(n.rows) : n.rows));
      expect(items.map((x) => x.kind), "cấu trúc nhóm / nhóm con / hạng mục").toEqual(["section", "subsection", "item", "item", "item"]);
      expect(items[1].name).toBe("SVH - hallway");
      expect(String(items[1].notes)).toBe("18/9 thay Dream");
      const x = items[2];
      expect(x.name).toBe("Hallway 2m75W x 2m05H");
      expect(x.unit, "ĐVT lệch cột").toBe("m2");
      expect(Number(x.quantity), "Số Lượng lệch cột").toBe(5.6);
      expect(Number(x.unitPrice), "Đơn Giá lệch cột").toBe(95000);
      if (p.usesDays) expect(Number(x.days || 1), "Số Ngày lệch cột").toBe(n.ngay);
      if (n.coChiTiet) expect(String(x.detail ?? ""), "Chi Tiết mất").toBe(". PP in KTS");
      expect(String(x.internalNote ?? ""), "cột thừa rơi vào Ghi chú nội bộ").toBe("");
    });
  }
});
