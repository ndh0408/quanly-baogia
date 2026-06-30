import { describe, it, expect } from "vitest";
import {
  parseClipboardTSV,
  tsvEscapeField,
  cellsToTSV,
  cellsToHTML,
  parseLooseNumber,
  reconstructExportRows,
  looksLikeExportPaste,
} from "../public/grid-clipboard.js";

// GN template export columns (no days, has Chi Tiết), as copied B:H (STT..Thành Tiền)
const GN_ROLES = ["_stt", "name", "detail", "unit", "quantity", "unitPrice", "_amount"];

describe("reconstructExportRows (re-import app's own export)", () => {
  // Đúng dữ liệu trong ảnh người dùng dán (đã gồm cột STT)
  const matrix = [
    ["A", "Booth backdrop 3m5W x 2m8H (thay AW booth có sẵn)", "", "", "", "5902150", "5902150"],
    ["1", "Vách 3m5W x 2m7H, hông 10cm", ". PP in KTS", "m2", "9,99", "95.000", "949.050"],
    ["2", ". Mặt sau che vải đen", "", "m2", "9,8", "27.000", "264.600"],
    ["", "Chi phí vận chuyển, lắp đặt, tháo dỡ", "", "", "", "2.800.000", "2.800.000"],
    ["1", "HN:\n. Vin Liễu Giai", "", "bộ", "1", "2.800.000", "2.800.000"],
    ["", "", ". Hiflex in KTS", "m2", "3,5", "65.000", "227.500"],
    ["", "Ghi chú chương trình (không tính tiền)", "", "", "", "", ""],
  ];
  const items = reconstructExportRows(matrix, GN_ROLES, new Set(["quantity", "unitPrice", "days"]));

  it("recognizes nhóm chính (A) as a section, not an item", () => {
    expect(items[0].kind).toBe("section");
    expect(items[0].name).toContain("Booth backdrop");
    expect(items[0].unitPrice).toBe(0); // group subtotal is computed, not a real price
  });
  it("maps item columns correctly (no STT shift, VN numbers parsed)", () => {
    expect(items[1].kind).toBe("item");
    expect(items[1].name).toBe("Vách 3m5W x 2m7H, hông 10cm");
    expect(items[1].detail).toBe(". PP in KTS");
    expect(items[1].unit).toBe("m2");
    expect(items[1].quantity).toBeCloseTo(9.99);
    expect(items[1].unitPrice).toBe(95000);
  });
  it("recognizes nhóm con (empty STT + name + subtotal, no ĐVT/SL)", () => {
    expect(items[3].kind).toBe("subsection");
    expect(items[3].name).toContain("Chi phí vận chuyển");
    expect(items[3].unitPrice).toBe(0);
  });
  it("keeps an item under the nhóm con", () => {
    expect(items[4].kind).toBe("item");
    expect(items[4].unit).toBe("bộ");
    expect(items[4].unitPrice).toBe(2800000);
  });
  it("recognizes a hàng con (empty STT + empty name + has ĐVT/SL)", () => {
    expect(items[5].kind).toBe("sub");
    expect(items[5].unit).toBe("m2");
    expect(items[5].unitPrice).toBe(65000);
  });
  it("recognizes a dòng thông tin (empty STT + name, no amounts)", () => {
    expect(items[6].kind).toBe("info");
    expect(items[6].name).toContain("Ghi chú");
  });
});

describe("reconstructExportRows — BANNER (nhóm con đánh SỐ, numberSubs=true)", () => {
  // Banner: nhóm chính = chữ A/B; nhóm con = SỐ 1,2,3; mục = STT TRỐNG.
  const matrix = [
    ["A", "HCM", "", "", "", "", ""],
    ["1", "LM81: khu chờ cạnh màn hình LED", "", "", "1", "1219200", "1219200"],
    ["", "Vách giữa 2m92W x 1m46H", ". PP in KTS", "m2", "7,62", "95.000", "723.900"],
    ["", "Chi phí thi công", "", "m2", "7,62", "65.000", "495.300"],
  ];
  const items = reconstructExportRows(matrix, GN_ROLES, new Set(["quantity", "unitPrice", "days"]), true);
  it("nhóm chính (A) → section", () => expect(items[0].kind).toBe("section"));
  it("nhóm con đánh SỐ (1) → subsection (KHÔNG phải item)", () => {
    expect(items[1].kind).toBe("subsection");
    expect(items[1].name).toContain("LM81");
    expect(items[1].unitPrice).toBe(0);
  });
  it("mục dưới nhóm con (STT trống) → item", () => {
    expect(items[2].kind).toBe("item");
    expect(items[2].unit).toBe("m2");
    expect(items[2].unitPrice).toBe(95000);
    expect(items[3].kind).toBe("item");
  });
});

describe("backward-compat: mẫu thường numberSubs=false — STT số vẫn = item", () => {
  const matrix = [
    ["A", "Nhóm", "", "", "", "", ""],
    ["", "Nhóm con", "", "", "", "1000000", "1000000"],  // STT trống + tên + giá = nhóm con
    ["1", "Mục đánh số", "", "m2", "2", "95000", "190000"],  // STT số = mục
  ];
  const items = reconstructExportRows(matrix, GN_ROLES, new Set(["quantity", "unitPrice", "days"]), false);
  it("nhóm con STT trống → subsection", () => expect(items[1].kind).toBe("subsection"));
  it("mục STT số → item (không bị nhận nhầm nhóm con)", () => expect(items[2].kind).toBe("item"));
});

describe("reconstructExportRows — công thức (dán bảng export có =…)", () => {
  const NUM = new Set(["quantity", "unitPrice", "days"]);
  it("giữ công thức Số Lượng thành it.formulas, KHÔNG nuốt thành số sai", () => {
    // "=3.7*2.5" trước đây bị numLoose biến thành 3725 — nay phải giữ làm công thức.
    const m = [["1", "Diecut", "", "m2", "=3.7*2.5", "740000", "2.756.500"]];
    const [it] = reconstructExportRows(m, GN_ROLES, NUM);
    expect(it.kind).toBe("item");
    expect(it.formulas).toEqual({ quantity: "=3.7*2.5" });
    expect(it.quantity).toBe(0);       // placeholder — app gọi recomputeAll() để ra 9.25
    expect(it.unitPrice).toBe(740000); // giá thường vẫn parse số
  });
  it("giữ công thức Đơn Giá", () => {
    const m = [["1", "x", "", "bộ", "1", "=1000000*8%", ""]];
    const [it] = reconstructExportRows(m, GN_ROLES, NUM);
    expect(it.formulas).toEqual({ unitPrice: "=1000000*8%" });
    expect(it.quantity).toBe(1);
  });
  it("số thường vẫn parse như cũ (không có formulas)", () => {
    const m = [["1", "x", "", "m2", "9,99", "95.000", ""]];
    const [it] = reconstructExportRows(m, GN_ROLES, NUM);
    expect(it.formulas).toBeUndefined();
    expect(it.quantity).toBeCloseTo(9.99);
    expect(it.unitPrice).toBe(95000);
  });
  it("nhóm chính KHÔNG nhận công thức đơn giá (Đơn Giá nhóm = tổng tự tính)", () => {
    const m = [["A", "Nhóm", "", "", "", "=5000", ""]];
    const [it] = reconstructExportRows(m, GN_ROLES, NUM);
    expect(it.kind).toBe("section");
    expect(it.unitPrice).toBe(0);
    expect(it.formulas).toBeUndefined();
  });
});

describe("looksLikeExportPaste", () => {
  it("detects an export block (has group letter, pasted at col 0)", () => {
    const m = [["A", "x", "", "", "", "100", "100"], ["1", "y", "", "m2", "2", "50", "100"]];
    expect(looksLikeExportPaste(m, 0, 6)).toBe(true);
  });
  it("ignores a normal paste of free text", () => {
    expect(looksLikeExportPaste([["Vách 3m5", "9,99"]], 0, 6)).toBe(false);
  });
  it("ignores a paste that does not start at column 0", () => {
    expect(looksLikeExportPaste([["A", "x"]], 2, 6)).toBe(false);
  });
  it("ignores an external table whose col-0 header is a 2-letter word (TT/KL/ID)", () => {
    // bảng ngoài: cột đầu là "TT" (thứ tự) — KHÔNG được hiểu nhầm thành nhóm
    const m = [["TT", "Tên", "SL", "Đơn giá"], ["1", "Vách", "2", "95000"], ["2", "Sàn", "1", "65000"]];
    expect(looksLikeExportPaste(m, 0, 6)).toBe(false);
  });
  it("requires the extra STT column (not just a group letter)", () => {
    // có chữ nhóm "A" nhưng chỉ đúng số cột nhập (không có cột STT thừa) → không kích hoạt
    expect(looksLikeExportPaste([["A", "x", "", "m2", "1", "100"]], 0, 6)).toBe(false);
  });
});

describe("parseClipboardTSV", () => {
  it("parses a plain TSV grid", () => {
    expect(parseClipboardTSV("a\tb\tc\n1\t2\t3")).toEqual([["a", "b", "c"], ["1", "2", "3"]]);
  });
  it("treats a single value as a 1x1 grid", () => {
    expect(parseClipboardTSV("100")).toEqual([["100"]]);
  });
  it("keeps a quoted multi-line cell as ONE cell (no row explosion)", () => {
    // Excel copies a cell containing a newline as: "line1\nline2"
    const clip = 'HN:\tx\n"a\nb"\ty';
    expect(parseClipboardTSV(clip)).toEqual([["HN:", "x"], ["a\nb", "y"]]);
  });
  it("handles doubled-quote escapes inside a quoted field", () => {
    expect(parseClipboardTSV('"say ""hi"""\tz')).toEqual([['say "hi"', "z"]]);
  });
  it("handles CRLF, lone CR, and LF row terminators", () => {
    expect(parseClipboardTSV("a\r\nb")).toEqual([["a"], ["b"]]);
    expect(parseClipboardTSV("a\rb")).toEqual([["a"], ["b"]]);
    expect(parseClipboardTSV("a\nb")).toEqual([["a"], ["b"]]);
  });
  it("drops a single trailing blank row from a terminal newline", () => {
    expect(parseClipboardTSV("a\tb\n")).toEqual([["a", "b"]]);
    expect(parseClipboardTSV("a\tb\r\n")).toEqual([["a", "b"]]);
  });
  it("preserves intentional empty cells", () => {
    expect(parseClipboardTSV("a\t\tc")).toEqual([["a", "", "c"]]);
  });
  it("strips a leading BOM", () => {
    expect(parseClipboardTSV("\uFEFFa\tb")).toEqual([["a", "b"]]);
  });
  it("preserves a tab embedded inside a quoted field", () => {
    expect(parseClipboardTSV('"a\tb"\tc')).toEqual([["a\tb", "c"]]);
  });
});

describe("serialize round-trip", () => {
  it("escapes only fields that need it", () => {
    expect(tsvEscapeField("plain")).toBe("plain");
    expect(tsvEscapeField("a\tb")).toBe('"a\tb"');
    expect(tsvEscapeField("a\nb")).toBe('"a\nb"');
    expect(tsvEscapeField('a"b')).toBe('"a""b"');
  });
  it("joins rows with CRLF", () => {
    expect(cellsToTSV([["a", "b"], ["c", "d"]])).toBe("a\tb\r\nc\td");
  });
  it("round-trips a matrix with newlines and tabs", () => {
    const m = [["HN:\n. Vin", "9.99"], ["plain", ""]];
    expect(parseClipboardTSV(cellsToTSV(m))).toEqual(m);
  });
  it("emits an HTML table with <br> for newlines", () => {
    expect(cellsToHTML([["a\nb", "c"]])).toBe("<table><tr><td>a<br>b</td><td>c</td></tr></table>");
  });
  it("html-escapes special chars", () => {
    expect(cellsToHTML([["<b>&", "x"]])).toBe("<table><tr><td>&lt;b&gt;&amp;</td><td>x</td></tr></table>");
  });
});

describe("parseLooseNumber", () => {
  it("fixes the VN single dotted-thousands money bug", () => {
    expect(parseLooseNumber("1.234")).toBe(1234);
    expect(parseLooseNumber("12.500")).toBe(12500);
    expect(parseLooseNumber("1.234.567")).toBe(1234567);
  });
  it("keeps genuine US decimals", () => {
    expect(parseLooseNumber("1234.5")).toBe(1234.5);
    expect(parseLooseNumber("1.5")).toBe(1.5);
  });
  it("handles VN decimal comma and US thousands", () => {
    expect(parseLooseNumber("12,5")).toBe(12.5);
    expect(parseLooseNumber("1,234")).toBe(1234);
    expect(parseLooseNumber("1.234,56")).toBe(1234.56);
    expect(parseLooseNumber("1,234,567")).toBe(1234567);
  });
  it("strips currency symbols/spaces and handles blanks", () => {
    expect(parseLooseNumber(" 95.000 ₫ ")).toBe(95000);
    expect(parseLooseNumber("")).toBe(0);
    expect(parseLooseNumber("abc")).toBe(0);
  });
});
