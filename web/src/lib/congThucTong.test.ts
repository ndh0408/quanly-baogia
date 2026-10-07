// Công thức của khối tổng (lib/congThucTong) phải là LUẬT CỘNG THẬT của báo giá — chủ repo 2026-10-07: "tôi nhấn vào
// tổng sheet nó chưa hiện các ô lên xem cộng như nào công thức ra sao". Bài chính: dựng công thức Tổng sheet cho hàng
// trăm sheet sinh ngẫu nhiên (nhóm / nhóm con / dòng con / dòng thông tin / số âm / SL lẻ / có-không "Hiện Thành Tiền
// nhóm" / mẫu đánh số nhóm con) rồi TÍNH LẠI chính chuỗi đó bằng evalFormula của lưới, với ô được đọc đúng như
// GridTable.cellNum đọc → phải ra đúng M.sheetSubtotalGrouped. Và mọi ô Thành tiền được trỏ tới phải là ô thật sự góp
// vào tổng (không tô ô nhóm rỗng, không tô hàng nhóm khi nhóm không tính, không đếm một mục hai lần).
import { describe, it, expect } from "vitest";
import * as M from "./quoteMath";
import { evalFormula } from "./formula";
import { soDoDiaChi, chuCot } from "./soDoDiaChi";
import { congThucTongSheet, congThucVatSheet, congThucThanhTienSheet, congThucDiscount, congThucVat, gopDai, noiCong } from "./congThucTong";

const it_ = (kind: M.ItemKind, quantity = 0, unitPrice = 0, name = ""): M.Item => ({ kind, name, quantity, unitPrice, days: null });
const SO = soDoDiaChi({ giuChiTiet: true, usesDays: false, internalNote: true });   // A STT · B Hạng mục · C Chi tiết · D ĐVT · E SL · F ĐG · G Thành tiền
const La = chuCot(SO, "_amount"), Lq = chuCot(SO, "quantity");

/** Đọc ô như GridTable.cellNum (cột Thành tiền + Số lượng) — bản sao CÓ CHỦ ĐÍCH để bài kiểm không tự chấm bài của mình. */
function boGiai(items: M.Item[], usesDays: boolean, groupSubtotal: boolean, numberSubs: boolean, so = SO) {
  const rk = M.computeRowKinds(items);
  const tong: Record<number, number> = {};
  let cs = -1, cu = -1;
  for (let i = 0; i < items.length; i++) {
    if (rk[i] === "section") { if (items[i].kind === "subsection") cu = i; else { cs = i; cu = -1; } tong[i] = 0; }
    else if (rk[i] === "head" || rk[i] === "sub") {
      const amt = M.lineAmount(items[i], usesDays);
      const cha = cu >= 0 ? cu : cs;
      if (cha >= 0) tong[cha] += amt;
      if (numberSubs && cu >= 0 && cs >= 0) tong[cs] += amt;
    }
  }
  const cot = new Map(so.map((c, i) => [c.L, i]));
  const doc = (a: string) => { const m = /^\$?([A-Z]+)\$?(\d+)$/.exec(a); if (!m) throw new Error("địa chỉ lạ " + a); return { L: m[1], r: Number(m[2]) - 1 }; };
  const o = (a: string) => {
    const { L, r } = doc(a); const it = items[r]; if (!it) throw new Error("ngoài bảng " + a);
    const f = so[cot.get(L)!].f;
    const nhom = it.kind === "section" || it.kind === "subsection";
    if (f === "_amount") return nhom ? (groupSubtotal ? tong[r] * M.groupMult(it) : 0) : it.kind === "info" ? 0 : M.lineAmount(it, usesDays);
    if (f === "quantity") return M.qtyForAmount(it);
    throw new Error("công thức tổng trỏ vào cột lạ " + a);
  };
  return {
    cell: o,
    range: (a: string, b: string) => { const x = doc(a), y = doc(b); if (x.L !== y.L) throw new Error("dải nhiều cột"); const out: number[] = []; for (let r = x.r; r <= y.r; r++) out.push(o(`${x.L}${r + 1}`)); return out; },
  };
}
/** Mọi ô cột Thành tiền mà công thức trỏ tới (dải bung ra từng hàng). */
function oThanhTien(congThuc: string): number[] {
  const out: number[] = [];
  const re = new RegExp(`${La}(\\d+)(?::${La}(\\d+))?`, "g"); let m: RegExpExecArray | null;
  while ((m = re.exec(congThuc))) { const a = Number(m[1]) - 1, b = m[2] ? Number(m[2]) - 1 : a; for (let r = a; r <= b; r++) out.push(r); }
  return out;
}

describe("congThucTongSheet — công thức Tổng sheet theo địa chỉ ô của lưới", () => {
  const nhomVaHang = [
    it_("item", 1, 1_000_000, "Backdrop"),         // G1 — trước nhóm đầu: ×1
    it_("section", 2, 0, "Nhóm A"),                // G2 = (600.000 + 100.000 + 50.000) × 2
    it_("item", 2, 300_000, "Standee"),
    it_("sub", 1, 100_000, "Chân đế"),             // dòng con: tính riêng, vẫn thuộc nhóm A
    it_("info", 0, 0, "ghi chú"),                  // không tính
    it_("item", 1, 50_000, "Phụ kiện"),
    it_("subsection", 3, 0, "Nhóm con B"),         // G7 = 10.000 × 3 — KHÔNG nhân thêm SL nhóm A
    it_("item", 1, 10_000, "Tem"),
    it_("section", 5, 0, "Nhóm rỗng"),             // không có mục → không trỏ tới
  ];

  it("có nhóm + bật Hiện Thành Tiền nhóm: cộng ô nhóm, bỏ nhóm rỗng, nhóm con nhân SL của nó", () => {
    const ct = congThucTongSheet(nhomVaHang, { groupSubtotal: true, usesDays: false, La, Lq });
    expect(ct.congThuc).toBe("=G1+G2+G7");
    expect(ct.phanTu.map((p) => p.giaTri)).toEqual([1_000_000, 1_500_000, 30_000]);
    expect(ct.dienGiai).toBe("= 1.000.000 + 1.500.000 + 30.000 = 2.530.000");
    expect(M.sheetSubtotalGrouped(nhomVaHang, false, true)).toBe(2_530_000);
    expect(ct.ghiChu.join(" ")).toMatch(/× SL nhóm/);
    expect(ct.ghiChu.join(" ")).toMatch(/Dòng thông tin không tính tiền/);
  });

  it("CHƯA bật Hiện Thành Tiền nhóm: cộng thẳng từng mục, hàng nhóm cắt dải, dòng thông tin không cắt; SL nhóm không nhân", () => {
    const ct = congThucTongSheet(nhomVaHang, { groupSubtotal: false, usesDays: false, La, Lq });
    expect(ct.congThuc).toBe("=G1+SUM(G3:G6)+G8");
    expect(oThanhTien(ct.congThuc).filter((r) => nhomVaHang[r].kind !== "info")).toEqual([0, 2, 3, 5, 7]);
    expect(ct.dienGiai).toBe("= 1.000.000 + 750.000 + 10.000 = 1.760.000");
    expect(ct.ghiChu.join(" ")).toMatch(/SL của “Nhóm A”, “Nhóm con B”, “Nhóm rỗng” KHÔNG nhân vào tổng/);
  });

  it("mẫu đánh số nhóm con: KHÔNG trỏ vào ô nhóm cha (ô đó dồn cả nhóm con) — lấy mục trực tiếp × SL nhóm cha", () => {
    const ds = [it_("section", 2, 0, "Cha"), it_("item", 1, 100, "a"), it_("item", 1, 200, "b"), it_("subsection", 3, 0, "Con"), it_("item", 1, 1000, "c")];
    const ct = congThucTongSheet(ds, { groupSubtotal: true, usesDays: false, numberSubs: true, La, Lq });
    expect(ct.congThuc).toBe("=SUM(G2:G3)*E1+G4");
    expect(ct.dienGiai).toBe("= 600 + 3.000 = 3.600");
    expect(ct.ghiChu.join(" ")).toMatch(/“Cha”.*CẢ phần nhóm con/);
    // Mẫu KHÔNG đánh số nhóm con: ô nhóm cha chỉ là phần trực tiếp → trỏ thẳng vào nó.
    expect(congThucTongSheet(ds, { groupSubtotal: true, usesDays: false, numberSubs: false, La, Lq }).congThuc).toBe("=G1+G4");
  });

  it("số âm viết thành phép trừ, tổng lẻ ghi rõ làm tròn", () => {
    const ds = [it_("item", 1, 500_000), it_("item", 1, -120_000, "Giảm"), it_("section", 1.5, 0, "N"), it_("item", 1, 333)];
    const ct = congThucTongSheet(ds, { groupSubtotal: true, usesDays: false, La, Lq });
    expect(ct.congThuc).toBe("=SUM(G1:G2)+G3");
    expect(ct.dienGiai).toBe("= 380.000 + 499,5 = 380.499,5 → làm tròn đến đồng: 380.500");
    expect(noiCong([1000, -200, 50])).toBe("1.000 − 200 + 50");
    expect(ct.ghiChu.join(" ")).toMatch(/âm được trừ/);
  });

  it("sheet trống / chỉ có nhóm + thông tin → =0", () => {
    expect(congThucTongSheet([], { groupSubtotal: false, usesDays: false, La, Lq }).congThuc).toBe("=0");
    expect(congThucTongSheet([it_("section", 2), it_("info")], { groupSubtotal: true, usesDays: false, La, Lq }).congThuc).toBe("=0");
  });

  it("SINH NGẪU NHIÊN 600 sheet: tính lại công thức bằng evalFormula của lưới = M.sheetSubtotalGrouped; ô trỏ tới đều góp vào tổng", () => {
    let hat = 20261007;
    const rnd = () => { hat = (hat * 1103515245 + 12345) % 2147483648; return hat / 2147483648; };
    const chon = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
    const KIND: M.ItemKind[] = ["item", "item", "item", "sub", "sub", "section", "subsection", "info"];
    for (let lan = 0; lan < 600; lan++) {
      const usesDays = rnd() < 0.3, groupSubtotal = rnd() < 0.6, numberSubs = rnd() < 0.4;
      const so = soDoDiaChi({ giuChiTiet: rnd() < 0.5, usesDays, internalNote: rnd() < 0.5 });
      const La2 = chuCot(so, "_amount"), Lq2 = chuCot(so, "quantity");
      const items: M.Item[] = Array.from({ length: Math.floor(rnd() * 26) }, () => ({
        kind: chon(KIND), name: "x", quantity: chon([0, 0.5, 1, 1, 2, 3, 7.37, -1, 1.25]), unitPrice: chon([0, 1000, 12_345, 99_999, -5000, 163_845]),
        days: usesDays ? chon([null, 0, 1, 2.5]) : null, quantityExact: rnd() < 0.1,
      }));
      const ct = congThucTongSheet(items, { groupSubtotal, usesDays, numberSubs, La: La2, Lq: Lq2 });
      const dung = M.sheetSubtotalGrouped(items, usesDays, groupSubtotal);
      const tinh = evalFormula(ct.congThuc, boGiai(items, usesDays, groupSubtotal, numberSubs, so));
      const ten = `lần ${lan}: ${ct.congThuc} · ${JSON.stringify(items.map((x) => [x.kind, x.quantity, x.unitPrice]))} gs=${groupSubtotal} ns=${numberSubs}`;
      expect(tinh, ten).not.toBeNull();
      expect(Math.abs((tinh as number) - dung), ten).toBeLessThan(1e-6 * Math.max(1, Math.abs(dung)));
      // Không thừa: ô Thành tiền trỏ tới là mục (item/sub), dòng thông tin nằm giữa một dải (không có ô), hoặc ô NHÓM có
      // mục — chỉ khi nhóm được tính; và không mục nào bị đếm hai lần (vừa tự nó vừa qua ô nhóm của nó).
      const re = new RegExp(`${La2}(\\d+)(?::${La2}(\\d+))?`, "g"); let m: RegExpExecArray | null; const tro: number[] = [];
      while ((m = re.exec(ct.congThuc))) { const a = Number(m[1]) - 1, b = m[2] ? Number(m[2]) - 1 : a; for (let r = a; r <= b; r++) tro.push(r); }
      expect(new Set(tro).size, ten).toBe(tro.length);
      const laNhom = (j: number) => items[j].kind === "section" || items[j].kind === "subsection";
      for (const r of tro) {
        if (laNhom(r)) {
          expect(groupSubtotal, `${ten} — trỏ vào ô nhóm khi nhóm không tính`).toBe(true);
          let coMuc = false;
          for (let j = r + 1; j < items.length && !laNhom(j); j++) if (items[j].kind !== "info") coMuc = true;
          expect(coMuc, `${ten} — trỏ vào nhóm rỗng G${r + 1}`).toBe(true);
        } else if (groupSubtotal) {
          let g = r - 1; while (g >= 0 && !laNhom(g)) g--;
          expect(g >= 0 && tro.includes(g), `${ten} — G${r + 1} đếm hai lần (cả ô nhóm G${g + 1})`).toBe(false);
        }
      }
    }
  });
});

describe("VAT / Thành tiền / Discount của khối tổng", () => {
  const t = M.sheetTotals({ items: [it_("item", 1, 20_746_077)], discount: 500_000 }, false);
  it("VAT có Discount: =ROUND((Cộng-Discount)*8%;0), làm tròn như M.roundVnd", () => {
    const vat = M.roundVnd(t.net * 8 / 100);
    const ct = congThucVatSheet(t, 8, vat);
    expect(ct.congThuc).toBe("=ROUND((Cộng-Discount)*8%;0)");
    expect(ct.dienGiai).toBe("= (20.746.077 − 500.000) × 8% = 1.619.686,16 → làm tròn đến đồng: 1.619.686");
    expect(congThucThanhTienSheet(t, vat)).toMatchObject({ congThuc: "=Cộng-Discount+VAT", dienGiai: "= 20.746.077 − 500.000 + 1.619.686 = 21.865.763" });
    expect(congThucDiscount(t).congThuc).toBe("=MIN(500000;Cộng)");
  });
  it("không Discount: tham chiếu thẳng ô Tổng sheet; VAT lẻ phần trăm viết dấu phẩy", () => {
    const t0 = M.sheetTotals({ items: [it_("item", 1, 1_000_000)] }, false);
    expect(congThucVatSheet(t0, 8, 80_000)).toMatchObject({ congThuc: "=ROUND(Tổng sheet*8%;0)", dienGiai: "= 1.000.000 × 8% = 80.000" });
    expect(congThucVatSheet(t0, 8.5, 85_000).congThuc).toBe("=ROUND(Tổng sheet*8,5%;0)");
    expect(congThucThanhTienSheet(t0, 80_000).congThuc).toBe("=Tổng sheet+VAT");
    expect(congThucVat({ congThuc: "D4", dienGiai: "4.400.000", giaTri: 4_400_000 }, 8, 352_000).congThuc).toBe("=ROUND(D4*8%;0)");
  });
  it("gopDai: ô liền nhau cùng cột gộp thành dải", () => {
    expect(gopDai([{ L: "D", r: 2 }, { L: "D", r: 3 }, { L: "D", r: 4 }, { L: "D", r: 6 }]).map((d) => d.thamChieu)).toEqual(["SUM(D2:D4)", "D6"]);
  });
});
