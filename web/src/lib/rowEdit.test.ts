// "Chèn từ rạp" làm công thức trỏ SAI hạng mục → SAI TIỀN — chốt hồi quy.
//
// ── LỖI ─────────────────────────────────────────────────────────────────────
// `GridTable.tsx` có bốn đường sửa số hàng. Ba đường gọi hàm dịch tham chiếu:
//     pushItem     → shiftFormulasForRowEdit(at, 1);  items.splice(...); recomputeAll();
//     addSubAfter  → shiftFormulasForRowEdit(i+1, 1); items.splice(...); recomputeAll();
//     removeRow    → shiftFormulasForRowEdit(i, -1);  items.splice(...); recomputeAll();
// Đường thứ tư — `insertCatalogRows` ("Chèn từ rạp", chèn HÀNG LOẠT) — chỉ có:
//     pushUndo(); let at = insertIndex(); for (...) items.splice(at, 0, it); at++; onChange();
// Không dịch tham chiếu, cũng không `recomputeAll()`.
//
// Hậu quả: người dùng có "=E5*2" ở dòng dưới, chèn 5 hạng mục từ danh mục rạp phía trên → "E5" vẫn
// là "E5" nhưng hàng 5 giờ là một hạng mục khác hẳn. Ô tiền ra số khác, KHÔNG có cảnh báo nào, và
// vì thiếu recomputeAll nên bảng còn hiện số CŨ cho tới lần gõ kế tiếp.
//
// ── CÁCH VÁ ─────────────────────────────────────────────────────────────────
// Gom "dịch + splice" vào `insertRows`/`removeRows` (web/src/lib/rowEdit.ts) rồi cho CẢ BỐN đường
// dùng chung. Splice-mà-quên-dịch không còn là lỗi có thể mắc.
import { describe, it, expect } from "vitest";
import { insertRows, removeRows, shiftFormulasForRowEdit, type RowLike } from "./rowEdit";
import { adjustRefsForRowEdit } from "./clipboard";

/** Lưới thật: 6 hàng, hàng cuối tính tổng đơn giá của hàng 2 và hàng 5. */
const luoi = (): RowLike[] => [
  { name: "Backdrop", unitPrice: 1000 },
  { name: "Standee", unitPrice: 2000, formulas: { unitPrice: "=1000+1000" } },
  { name: "Banner", unitPrice: 3000 },
  { name: "Booth", unitPrice: 4000 },
  { name: "Thảm", unitPrice: 5000 },
  { name: "Tổng phụ", unitPrice: 7000, formulas: { unitPrice: "=E2+E5" } },
];

const fx = (rows: RowLike[], i: number) => rows[i].formulas?.unitPrice;

describe("insertRows — chèn hàng loạt phải dịch tham chiếu công thức", () => {
  it("chèn 5 hàng ở ĐẦU → mọi tham chiếu dịch xuống 5 (đây là lỗi 'Chèn từ rạp')", () => {
    const rows = luoi();
    const moi: RowLike[] = Array.from({ length: 5 }, (_, i) => ({ name: `Rạp ${i}`, unitPrice: 0 }));
    insertRows(rows, 0, moi, adjustRefsForRowEdit);

    expect(rows.length).toBe(11);
    expect(rows[0].name, "hàng mới phải nằm đúng chỗ").toBe("Rạp 0");
    expect(rows[6].name, "hàng cũ bị đẩy xuống").toBe("Standee");
    // "=E2+E5" phải thành "=E7+E10". Trước khi vá: giữ nguyên "=E2+E5" → trỏ vào hai hàng RẠP mới
    // (đơn giá 0) thay vì Standee + Thảm → tổng ra 0 thay vì 7000.
    expect(fx(rows, 10)).toBe("=E7+E10");
    expect(fx(rows, 6), "công thức hằng số không đụng tới").toBe("=1000+1000");
  });

  it("chèn GIỮA → chỉ dịch tham chiếu tới hàng TỪ chỗ chèn trở xuống", () => {
    const rows = luoi();
    insertRows(rows, 3, [{ name: "Chèn", unitPrice: 0 }], adjustRefsForRowEdit);
    // Chèn ở chỉ số 3 = trước hàng Excel số 4. E2 (trên chỗ chèn) giữ nguyên; E5 (dưới) → E6.
    expect(fx(rows, 6)).toBe("=E2+E6");
  });

  it("chèn ở CUỐI → không tham chiếu nào phải đổi", () => {
    const rows = luoi();
    insertRows(rows, rows.length, [{ name: "Cuối", unitPrice: 0 }], adjustRefsForRowEdit);
    expect(fx(rows, 5)).toBe("=E2+E5");
    expect(rows[6].name).toBe("Cuối");
  });

  it("danh sách rỗng → không đụng gì (không dịch nhầm 0 hàng)", () => {
    const rows = luoi();
    insertRows(rows, 0, [], adjustRefsForRowEdit);
    expect(rows.length).toBe(6);
    expect(fx(rows, 5)).toBe("=E2+E5");
  });

  it("giữ ĐÚNG THỨ TỰ khối chèn (chèn từng hàng, không đảo)", () => {
    const rows = luoi();
    insertRows(rows, 2, [{ name: "A" }, { name: "B" }, { name: "C" }], adjustRefsForRowEdit);
    expect([rows[2].name, rows[3].name, rows[4].name]).toEqual(["A", "B", "C"]);
  });

  it("chèn khối lớn không làm tràn ngăn xếp (không dùng spread)", () => {
    const rows = luoi();
    const nhieu: RowLike[] = Array.from({ length: 200_000 }, () => ({ name: "x" }));
    expect(() => insertRows(rows, 0, nhieu, adjustRefsForRowEdit)).not.toThrow();
    expect(rows.length).toBe(200_006);
  });
});

describe("removeRows — xoá hàng", () => {
  it("xoá hàng TRÊN → tham chiếu dịch lên", () => {
    const rows = luoi();
    removeRows(rows, 0, 1, adjustRefsForRowEdit);
    expect(fx(rows, 4)).toBe("=E1+E4");
  });

  it("xoá đúng hàng ĐANG ĐƯỢC TRỎ TỚI → giữ công thức + bật cờ đỏ (#REF! của Excel)", () => {
    const rows = luoi();
    removeRows(rows, 4, 1, adjustRefsForRowEdit);   // xoá "Thảm" = hàng Excel số 5
    const cuoi = rows[rows.length - 1];
    expect(cuoi.formulas?.unitPrice, "KHÔNG được âm thầm đổi thành số khác").toBe("=E2+E5");
    expect(cuoi._fxWarn?.unitPrice, "phải bật cờ để lưới tô đỏ ô đó").toBe(true);
  });

  it("xoá NHIỀU hàng một lượt", () => {
    const rows = luoi();
    removeRows(rows, 2, 2, adjustRefsForRowEdit);   // bỏ Banner + Booth
    expect(rows.length).toBe(4);
    expect(fx(rows, 3)).toBe("=E2+E3");
  });

  it("count <= 0 → không đụng gì", () => {
    const rows = luoi();
    removeRows(rows, 0, 0, adjustRefsForRowEdit);
    expect(rows.length).toBe(6);
    expect(fx(rows, 5)).toBe("=E2+E5");
  });
});

describe("shiftFormulasForRowEdit — hàng không có công thức", () => {
  it("bỏ qua hàng thiếu `formulas`, không tự tạo object rỗng", () => {
    const rows: RowLike[] = [{ name: "A" }, { name: "B" }];
    shiftFormulasForRowEdit(rows, 0, 1, adjustRefsForRowEdit);
    expect(rows[0].formulas).toBeUndefined();
    expect(rows[1]._fxWarn).toBeUndefined();
  });

  it("delta = 0 → thoát sớm", () => {
    const rows = luoi();
    shiftFormulasForRowEdit(rows, 0, 0, adjustRefsForRowEdit);
    expect(fx(rows, 5)).toBe("=E2+E5");
  });
});

// ── CHỨNG MINH TƯƠNG ĐƯƠNG VỚI LOGIC CŨ ─────────────────────────────────────
// `insertRows`/`removeRows` được TÁCH RA từ code chạy trong GridTable.tsx. Tách code đúng thì dễ,
// tách code đúng mà không đổi hành vi mới là việc phải chứng minh. Bài dưới chạy LẠI đúng nguyên
// văn cặp lệnh cũ rồi so kết quả với hàm mới trên nhiều tình huống — kể cả các ca biên (delta 0,
// chèn ngoài rìa, xoá quá cuối mảng, công thức #REF!).
//
// Nguyên văn logic cũ (GridTable.tsx trước khi tách):
//     const shiftFormulasForRowEdit = (at, delta) => {
//       for (const it of items) { const fx = it.formulas; if (!fx) continue;
//         for (const f in fx) { const moved = adjustRefsForRowEdit(fx[f], at + 1, delta);
//           if (moved === null) { (it._fxWarn ||= {})[f] = true; } else fx[f] = moved; } } };
//     pushItem:    shiftFormulasForRowEdit(at, 1);            items.splice(at, 0, it);
//     addSubAfter: shiftFormulasForRowEdit(i + 1, 1);         items.splice(i + 1, 0, it);
//     removeRow:   shiftFormulasForRowEdit(i, -1);            items.splice(i, 1);
//     dán-vào-nhóm: shiftFormulasForRowEdit(startRow+1, n);   n lần splice(startRow+1, 0, blank)
//     Ctrl+"-":    shiftFormulasForRowEdit(from, -n);         items.splice(from, n);
//     Ctrl+"+":    shiftFormulasForRowEdit(i + 1, 1);         items.splice(i + 1, 0, nit);
function cuShift(items: RowLike[], at: number, delta: number) {
  for (const it of items) {
    const fx = it?.formulas;
    if (!fx) continue;
    for (const f in fx) {
      const moved = adjustRefsForRowEdit(fx[f], at + 1, delta);
      if (moved === null) { const w = it._fxWarn || (it._fxWarn = {}); w[f] = true; }
      else fx[f] = moved;
    }
  }
}
const cuChen = (items: RowLike[], at: number, rows: RowLike[]) => { cuShift(items, at, rows.length); let i = at; for (const r of rows) items.splice(i++, 0, r); };
const cuXoa = (items: RowLike[], at: number, n: number) => { cuShift(items, at, -n); items.splice(at, n); };

/** Lưới sinh theo hạt giống — nhiều công thức trỏ chéo nhau ở các hàng khác nhau. */
const luoiN = (n: number): RowLike[] =>
  Array.from({ length: n }, (_, i) => ({
    name: `H${i}`,
    unitPrice: (i + 1) * 100,
    ...(i % 3 === 0 ? { formulas: { unitPrice: `=E${(i % n) + 1}+E${((i * 7) % n) + 1}`, quantity: `=D${((i * 3) % n) + 1}*2` } } : {}),
  }));

describe("tương đương với logic cũ trong GridTable", () => {
  const truongHopChen: [number, number, number][] = [
    // [số hàng, vị trí chèn, số hàng chèn]
    [8, 0, 1], [8, 3, 1], [8, 8, 1], [8, 0, 5], [8, 4, 3], [8, 8, 4],
    [1, 0, 1], [1, 1, 2], [12, 6, 1], [12, 0, 12], [8, 2, 0],
  ];
  it.each(truongHopChen)("CHÈN: %i hàng, tại %i, chèn %i hàng → giống hệt logic cũ", (n, at, k) => {
    const moi = () => Array.from({ length: k }, (_, i) => ({ name: `M${i}` }) as RowLike);
    const a = luoiN(n); insertRows(a, at, moi(), adjustRefsForRowEdit);
    const b = luoiN(n); cuChen(b, at, moi());
    expect(a).toEqual(b);
  });

  const truongHopXoa: [number, number, number][] = [
    [8, 0, 1], [8, 3, 1], [8, 7, 1], [8, 0, 3], [8, 5, 3],
    [8, 6, 5],   // xoá quá cuối mảng — splice tự kẹp
    [8, 0, 8], [1, 0, 1], [12, 4, 2], [8, 2, 0],
  ];
  it.each(truongHopXoa)("XOÁ: %i hàng, tại %i, xoá %i hàng → giống hệt logic cũ (kể cả cờ #REF!)", (n, at, k) => {
    const a = luoiN(n); removeRows(a, at, k, adjustRefsForRowEdit);
    const b = luoiN(n); cuXoa(b, at, k);
    expect(a).toEqual(b);
  });

  it("DÁN VÀO HÀNG NHÓM: chèn n hàng trắng — cũ splice n lần cùng chỗ, mới chèn tuần tự → mảng y hệt", () => {
    // Cũ chèn n hàng TRẮNG GIỐNG NHAU vào cùng chỉ số nên thứ tự đảo cũng không phân biệt được;
    // bài này chốt lại điều đó thay vì tin vào lập luận.
    const n = 4, startRow = 2;
    const a = luoiN(9); insertRows(a, startRow + 1, Array.from({ length: n }, () => ({ name: "" }) as RowLike), adjustRefsForRowEdit);
    const b = luoiN(9); cuShift(b, startRow + 1, n); Array.from({ length: n }).forEach(() => b.splice(startRow + 1, 0, { name: "" }));
    expect(a).toEqual(b);
  });

  it("chuỗi thao tác dài (chèn/xoá xen kẽ 40 lượt) → hai bên không bao giờ lệch", () => {
    const a = luoiN(15), b = luoiN(15);
    let seed = 12345;
    const rnd = (m: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % m; };   // LCG cố định, không dùng Math.random để test lặp lại được
    for (let step = 0; step < 40; step++) {
      const at = rnd(Math.max(1, a.length));
      if (rnd(2) === 0 || a.length <= 2) {
        const k = 1 + rnd(3);
        const rows = () => Array.from({ length: k }, (_, i) => ({ name: `s${step}_${i}` }) as RowLike);
        insertRows(a, at, rows(), adjustRefsForRowEdit);
        cuChen(b, at, rows());
      } else {
        const k = 1 + rnd(2);
        removeRows(a, at, k, adjustRefsForRowEdit);
        cuXoa(b, at, k);
      }
      expect(a, `lệch ở bước ${step}`).toEqual(b);
    }
    expect(a.length).toBe(b.length);
  });
});
