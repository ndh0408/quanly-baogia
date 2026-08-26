// Tô ô THAM CHIẾU của công thức vẫn quét lại cả <tbody> cho TỪNG Ô → O(hàng²) — chốt hồi quy.
//
// ── LỖI ─────────────────────────────────────────────────────────────────────
// Lượt vá trước chỉ dọn `paintSel` (rowIndexOf + paintRect). Hai hàm ngay bên cạnh trong
// `GridTable.tsx` vẫn dùng `tdOf(row, field)`, tức
//     tableRef.current?.querySelector(`tr[data-row="${row}"]`)
// MỘT LƯỢT QUÉT cả bảng cho MỖI ô:
//   · `paintRefPick(a, b)`            — tô vùng đang chỉ khi chèn tham chiếu bằng chuột/bàn phím
//   · `highlightActiveFormulaRefs(s)` — tô các ô mà công thức đang gõ tham chiếu tới
// Cả hai chạy trong `apply()` của `startPointDrag`, mà `apply` được gọi ở MỖI mousemove khi kéo
// chọn vùng cho công thức → tô vùng R×C tốn R×C lượt quét, mỗi lượt duyệt R hàng.
//
// ── TÁI HIỆN ────────────────────────────────────────────────────────────────
// Sheet ~1000 dòng, gõ "=SUM(" rồi kéo chuột chọn một dải dài: mỗi nhịp chuột tô lại toàn dải.
//
// ── HẬU QUẢ ─────────────────────────────────────────────────────────────────
// Không sai tiền, không mất dữ liệu — kéo chọn giật/đơ đúng lúc đang soạn công thức.
//
// ── CÁCH VÁ ─────────────────────────────────────────────────────────────────
// Dựng chỉ mục hàng MỘT LẦN mỗi lượt tô (`rowIndexOf`) rồi tô qua `paintRect` / `paintRectWith`
// (bản nhận hàm tô, để highlight còn đặt được màu --ref-color riêng cho từng tham chiếu).
// Phần TÁCH tham chiếu khỏi chuỗi công thức đưa ra `refRectsOfFormula` — thuần, không đụng DOM,
// nên kiểm được thứ tự (thứ tự này quyết định màu) ngoài trình duyệt (web/ không có jsdom).
import { describe, it, expect } from "vitest";
import { rowIndexOf, paintRect, paintRectWith, refRectsOfFormula } from "../components/GridTable";

// ── DOM giả: đếm số lượt quét cấp BẢNG (thứ gây O(hàng²)) ──────────────────────────────────────
type FakeTd = { classes: string[]; styles: Record<string, string>; classList: { add: (c: string) => void }; style: { setProperty: (k: string, v: string) => void } };
const fakeTd = (): FakeTd => {
  const classes: string[] = []; const styles: Record<string, string> = {};
  return { classes, styles, classList: { add: (c) => { classes.push(c); } }, style: { setProperty: (k, v) => { styles[k] = v; } } };
};
function fakeRow(r: number, fields: string[]) {
  const tds: Record<string, FakeTd> = {};
  for (const f of fields) tds[f] = fakeTd();
  const row = {
    scans: 0, tds,
    getAttribute: (n: string) => (n === "data-row" ? String(r) : null),
    querySelector(sel: string) {
      row.scans++;
      const m = /^\[data-f="(.+)"\]$/.exec(sel);
      if (m) { const td = tds[m[1]]; return td ? { closest: () => td } : null; }
      return null;
    },
  };
  return row;
}
function fakeTable(rowCount: number, fields: string[]) {
  const rows = Array.from({ length: rowCount }, (_, r) => fakeRow(r, fields));
  const tb = {
    tableScans: 0, tableListScans: 0, rows,
    querySelector() { tb.tableScans++; return null; },
    querySelectorAll(sel: string) { tb.tableListScans++; return sel === "tr[data-row]" ? rows : []; },
  };
  return tb;
}
const asNode = (x: unknown) => x as unknown as ParentNode;

// Sơ đồ địa chỉ ô rút gọn giống ADDR của lưới: A=name, B=unit, C=quantity, D=unitPrice.
const ADDR = [{ L: "A", f: "name" }, { L: "B", f: "unit" }, { L: "C", f: "quantity" }, { L: "D", f: "unitPrice" }];
const FIELDS = ADDR.map((c) => c.f);
const colOf = (L: string) => ADDR.findIndex((c) => c.L === L);
const parse = (a: string) => {
  const m = /^\$?([A-Za-z]+)\$?(\d+)$/.exec(a.trim()); if (!m) return null;
  const c = ADDR.find((x) => x.L === m[1].toUpperCase()); if (!c) return null;
  const row = parseInt(m[2], 10) - 1; if (row < 0 || row >= 1000) return null;
  return { row, f: c.f, L: c.L };
};

describe("refRectsOfFormula — tách ô/vùng mà công thức tham chiếu tới", () => {
  it("không phải công thức → không có gì để tô", () => {
    expect(refRectsOfFormula("", parse, colOf)).toEqual([]);
    expect(refRectsOfFormula("120000", parse, colOf)).toEqual([]);
    expect(refRectsOfFormula("Backdrop A1", parse, colOf)).toEqual([]);   // chữ thường, không mở đầu bằng "="
  });

  it("một ô đơn: =D3 → đúng ô đó", () => {
    expect(refRectsOfFormula("=D3", parse, colOf)).toEqual([{ r0: 2, r1: 2, c0: 3, c1: 3 }]);
  });

  it("dải ô: =SUM(C2:D5) → hình chữ nhật đã chuẩn hoá", () => {
    expect(refRectsOfFormula("=SUM(C2:D5)", parse, colOf)).toEqual([{ r0: 1, r1: 4, c0: 2, c1: 3 }]);
    // viết ngược (D5:C2) vẫn ra cùng hình chữ nhật
    expect(refRectsOfFormula("=SUM(D5:C2)", parse, colOf)).toEqual([{ r0: 1, r1: 4, c0: 2, c1: 3 }]);
  });

  it("THỨ TỰ: mọi DẢI trước, rồi tới các ô đơn — thứ tự này quyết định màu highlight", () => {
    expect(refRectsOfFormula("=D2+SUM(C3:C5)*D9", parse, colOf)).toEqual([
      { r0: 2, r1: 4, c0: 2, c1: 2 },   // C3:C5 (dải)
      { r0: 1, r1: 1, c0: 3, c1: 3 },   // D2
      { r0: 8, r1: 8, c0: 3, c1: 3 },   // D9
    ]);
  });

  it("ô trong dải KHÔNG bị đếm lại thành ô đơn, và tên hàm không thành tham chiếu", () => {
    const rects = refRectsOfFormula("=ROUND(C2:C4)", parse, colOf);
    expect(rects).toEqual([{ r0: 1, r1: 3, c0: 2, c1: 2 }]);   // ROUND không phải địa chỉ ô
  });

  it("địa chỉ ngoài sơ đồ cột / ngoài số hàng → bỏ qua, không ném lỗi", () => {
    expect(refRectsOfFormula("=Z9", parse, colOf)).toEqual([]);
    expect(refRectsOfFormula("=SUM(Z1:Z9)", parse, colOf)).toEqual([]);
  });
});

describe("tô vùng tham chiếu — số lượt quét BẢNG là hằng số", () => {
  const fieldAt = (c: number) => ADDR[c].f;

  it("paintRefPick (kéo chuột chọn dải cho công thức): 1 lượt quét bảng dù dải dài bao nhiêu", () => {
    const scansFor = (rowCount: number) => {
      const tb = fakeTable(rowCount, FIELDS);
      // đúng như trong lưới: mỗi nhịp mousemove dựng chỉ mục MỘT lần rồi tô cả dải
      paintRect(rowIndexOf(asNode(tb)), 0, rowCount - 1, 0, FIELDS.length - 1, fieldAt, "cell-ref-pick");
      return { table: tb.tableScans + tb.tableListScans, perRow: Math.max(...tb.rows.map((r) => r.scans)) };
    };
    const nho = scansFor(20), lon = scansFor(1000);
    expect(nho.table).toBe(1);
    expect(lon.table).toBe(1);
    expect(lon.perRow).toBeLessThanOrEqual(FIELDS.length);
  });

  it("paintRectWith: tô ĐÚNG các ô và đặt được màu riêng cho từng tham chiếu", () => {
    const tb = fakeTable(6, FIELDS);
    const idx = rowIndexOf(asNode(tb));
    const rects = refRectsOfFormula("=D2+SUM(C3:C4)", parse, colOf);
    rects.forEach((rc, ci) => paintRectWith(idx, rc.r0, rc.r1, rc.c0, rc.c1, fieldAt, (td) => {
      (td as unknown as FakeTd).classList.add("cell-ref-active");
      (td as unknown as FakeTd).style.setProperty("--ref-color", `mau-${ci}`);
    }));
    expect(tb.rows[2].tds.quantity.classes).toEqual(["cell-ref-active"]);   // C3 thuộc dải → màu 0
    expect(tb.rows[3].tds.quantity.styles["--ref-color"]).toBe("mau-0");
    expect(tb.rows[1].tds.unitPrice.styles["--ref-color"]).toBe("mau-1");   // D2 là ô đơn → màu 1
    expect(tb.rows[0].tds.name.classes).toEqual([]);                        // ngoài vùng
    expect(tb.tableListScans).toBe(1);                                      // MỘT chỉ mục cho MỌI tham chiếu
  });

  it("hàng không có trong chỉ mục → bỏ qua, không ném lỗi", () => {
    const tb = fakeTable(3, FIELDS);
    expect(() => paintRectWith(rowIndexOf(asNode(tb)), 0, 99, 0, 3, fieldAt, () => {})).not.toThrow();
  });
});
