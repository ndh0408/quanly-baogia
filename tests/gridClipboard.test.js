import { describe, it, expect } from "vitest";
import {
  parseClipboardTSV,
  tsvEscapeField,
  cellsToTSV,
  cellsToHTML,
  parseLooseNumber,
} from "../public/grid-clipboard.js";

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
