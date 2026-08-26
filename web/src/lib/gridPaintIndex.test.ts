// Tô vùng chọn của lưới quét lại cả <tbody> cho TỪNG Ô → O(hàng²) — chốt hồi quy.
//
// ── LỖI ─────────────────────────────────────────────────────────────────────
// `GridTable.tsx` dò ô bằng `tdOf(row, field)`, mà thân hàm là:
//     tableRef.current?.querySelector(`tr[data-row="${row}"]`)
// tức MỘT LƯỢT QUÉT TUYẾN TÍNH cả bảng cho mỗi ô. `paintSel` chạy hai vòng lồng r×c gọi `tdOf`,
// nên tô một vùng R hàng × C cột tốn R×C lượt quét, mỗi lượt duyệt R hàng → O(hàng²).
//
// ── TÁI HIỆN ────────────────────────────────────────────────────────────────
// Ctrl+A trong lưới (chọn cả bảng) hoặc kéo chuột chọn vùng: mỗi mouseover gọi lại `paintSel`.
// `paintSel` còn nằm cuối một useEffect KHÔNG có mảng phụ thuộc nên chạy lại sau MỌI lần render.
// Lưới báo giá thật cỡ vài trăm đến 1000 dòng (chính chú thích trong file ghi "~560 ô nhập",
// "73ms mỗi phím ở 1000 dòng") → số lượt quét bảng nhân lên theo bình phương số hàng.
//
// ── HẬU QUẢ ─────────────────────────────────────────────────────────────────
// Không sai tiền, không mất dữ liệu — nhưng kéo chọn vùng ở sheet lớn giật/đơ, gõ phím trễ.
//
// ── CÁCH VÁ ─────────────────────────────────────────────────────────────────
// Dựng CHỈ MỤC hàng MỘT LẦN (`rowIndexOf`) rồi tô qua `paintRect`, tra hàng bằng Map thay vì
// querySelector. Phần thân dò ô trong MỘT hàng tách thành `tdIn` để `tdOf` cũ dùng lại y nguyên
// (hàng NHÓM/NHÓM CON có ô TÍNH, không có <input data-f> → phải dò theo class cột, giữ cho vùng
// chọn kéo qua nhóm vẫn liền mạch).
//
// Test chạy môi trường node (web/ không có jsdom, và cấm cài thêm gói) nên dùng DOM giả: đếm số
// lượt quét cấp BẢNG là đủ để chốt độ phức tạp.
import { describe, it, expect } from "vitest";
import { rowIndexOf, tdIn, paintRect } from "../components/GridTable";

type FakeTd = { classes: string[]; classList: { add: (c: string) => void } };
const fakeTd = (): FakeTd => {
  const classes: string[] = [];
  return { classes, classList: { add: (c: string) => { classes.push(c); } } };
};

/** Hàng giả: `fields` là các cột CÓ ô nhập (data-f), `calcCols` là các cột TÍNH (chỉ có class). */
function fakeRow(r: number, fields: string[], calcCols: Record<string, FakeTd> = {}) {
  const tds: Record<string, FakeTd> = {};
  for (const f of fields) tds[f] = fakeTd();
  const row = {
    scans: 0,
    tds,
    getAttribute: (n: string) => (n === "data-row" ? String(r) : null),
    querySelector(sel: string) {
      row.scans++;
      const m = /^\[data-f="(.+)"\]$/.exec(sel);
      if (m) { const td = tds[m[1]]; return td ? { closest: () => td } : null; }
      return calcCols[sel] ?? null;
    },
  };
  return row;
}

function fakeTable(rowCount: number, fields: string[]) {
  const rows = Array.from({ length: rowCount }, (_, r) => fakeRow(r, fields));
  const tb = {
    tableScans: 0,        // querySelector cấp BẢNG — chính là thứ gây O(hàng²)
    tableListScans: 0,    // querySelectorAll cấp BẢNG
    rows,
    querySelector() { tb.tableScans++; return null; },
    querySelectorAll(sel: string) { tb.tableListScans++; return sel === "tr[data-row]" ? rows : []; },
  };
  return tb;
}

const asNode = (x: unknown) => x as unknown as ParentNode;
const asEl = (x: unknown) => x as unknown as Element;

describe("chỉ mục hàng của lưới (rowIndexOf)", () => {
  it("quét bảng ĐÚNG MỘT LẦN và lập chỉ mục theo data-row", () => {
    const tb = fakeTable(500, ["name", "quantity", "unitPrice"]);
    const idx = rowIndexOf(asNode(tb));
    expect(idx.size).toBe(500);
    expect(idx.get(0)).toBe(tb.rows[0]);
    expect(idx.get(499)).toBe(tb.rows[499]);
    expect(tb.tableListScans).toBe(1);
    expect(tb.tableScans).toBe(0);
  });
});

describe("tô vùng chọn (paintRect) — không còn phụ thuộc số hàng", () => {
  const FIELDS = ["name", "quantity", "unitPrice"];
  const fieldAt = (c: number) => FIELDS[c];

  it("tô đúng các ô trong hình chữ nhật", () => {
    const tb = fakeTable(4, FIELDS);
    paintRect(rowIndexOf(asNode(tb)), 1, 2, 0, 1, fieldAt, "cell-selected");
    expect(tb.rows[1].tds.name.classes).toEqual(["cell-selected"]);
    expect(tb.rows[1].tds.quantity.classes).toEqual(["cell-selected"]);
    expect(tb.rows[2].tds.quantity.classes).toEqual(["cell-selected"]);
    expect(tb.rows[1].tds.unitPrice.classes).toEqual([]);   // ngoài vùng
    expect(tb.rows[0].tds.name.classes).toEqual([]);
    expect(tb.rows[3].tds.name.classes).toEqual([]);
  });

  it("số lượt quét cấp BẢNG là HẰNG SỐ, không tăng theo số hàng (chốt O(hàng²))", () => {
    const scansFor = (rowCount: number) => {
      const tb = fakeTable(rowCount, FIELDS);
      const idx = rowIndexOf(asNode(tb));
      // Ctrl+A: tô cả bảng
      paintRect(idx, 0, rowCount - 1, 0, FIELDS.length - 1, fieldAt, "cell-selected");
      const perRow = Math.max(...tb.rows.map((r) => r.scans));
      return { table: tb.tableScans + tb.tableListScans, perRow };
    };
    const nho = scansFor(20), lon = scansFor(1000);
    expect(nho.table).toBe(1);
    expect(lon.table).toBe(1);                    // 1000 hàng vẫn CHỈ một lượt quét bảng
    expect(lon.perRow).toBeLessThanOrEqual(FIELDS.length);   // mỗi hàng chỉ dò đúng số cột của nó
  });

  it("dùng CHUNG một chỉ mục cho nhiều vùng (vùng cắt + vùng chọn) → vẫn 1 lượt quét", () => {
    const tb = fakeTable(300, FIELDS);
    const idx = rowIndexOf(asNode(tb));
    paintRect(idx, 0, 10, 0, 2, fieldAt, "cell-cut");
    paintRect(idx, 20, 299, 0, 2, fieldAt, "cell-selected");
    expect(tb.tableListScans).toBe(1);
    expect(tb.tableScans).toBe(0);
  });

  it("bỏ qua hàng không có trong chỉ mục thay vì ném lỗi", () => {
    const tb = fakeTable(3, FIELDS);
    const idx = rowIndexOf(asNode(tb));
    expect(() => paintRect(idx, 0, 99, 0, 2, fieldAt, "cell-selected")).not.toThrow();
  });
});

describe("dò ô trong MỘT hàng (tdIn) — giữ nguyên hành vi cũ của tdOf", () => {
  it("ô nhập bình thường → <td> bọc ngoài input", () => {
    const row = fakeRow(0, ["quantity"]);
    expect(tdIn(asEl(row), "quantity")).toBe(row.tds.quantity);
  });

  it("cột tính _amount / _stt → dò theo class", () => {
    const amount = fakeTd(), stt = fakeTd();
    const row = fakeRow(0, ["name"], { ".col-amount": amount, ".col-stt": stt });
    expect(tdIn(asEl(row), "_amount")).toBe(amount);
    expect(tdIn(asEl(row), "_stt")).toBe(stt);
  });

  it("hàng NHÓM (đơn giá là ô TÍNH, không có input) → vẫn tô được nhờ class cột", () => {
    const price = fakeTd();
    const row = fakeRow(0, ["name"], { ".col-price": price });
    expect(tdIn(asEl(row), "unitPrice")).toBe(price);
  });

  it("hàng không tồn tại / cột lạ → null, không ném lỗi", () => {
    expect(tdIn(null, "quantity")).toBeNull();
    expect(tdIn(asEl(fakeRow(0, ["name"])), "khongCoCotNay")).toBeNull();
  });
});
