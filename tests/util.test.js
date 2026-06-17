// Unit tests for the SPA pure-util module (extracted from app.js in the
// modularization). These are pure functions (no DOM/state) so they run in node.
import { describe, it, expect } from "vitest";
import {
  quoteTotals, roundVnd, escapeHtml, nl2br, safeLogoSrc, statusLabel,
  groupLetter, baoGiaTitleJS, pvRows, pvAmount, fmtMoney,
} from "../public/js/util.js";

describe("public/js/util.js (extracted SPA helpers)", () => {
  it("quoteTotals: rounds, VATs the rounded subtotal, clamps discount", () => {
    expect(quoteTotals(2500000, 8, 0)).toEqual({ subtotal: 2500000, vat: 200000, discount: 0, total: 2700000 });
    // discount clamped to [0, gross]
    expect(quoteTotals(1000, 0, -50)).toEqual({ subtotal: 1000, vat: 0, discount: 0, total: 1000 });
    expect(quoteTotals(1000, 0, 999999)).toEqual({ subtotal: 1000, vat: 0, discount: 1000, total: 0 });
  });

  it("roundVnd: half-up whole đồng", () => {
    expect(roundVnd(1234.5)).toBe(1235);
    expect(roundVnd("abc")).toBe(0);
  });

  it("escapeHtml: escapes the dangerous set incl quotes", () => {
    expect(escapeHtml(`<b>"x"&'y'`)).toBe("&lt;b&gt;&quot;x&quot;&amp;&#39;y&#39;");
    expect(escapeHtml(null)).toBe("");
  });

  it("nl2br: escapes THEN converts newlines", () => {
    expect(nl2br("a<b>\nc")).toBe("a&lt;b&gt;<br>c");
  });

  it("safeLogoSrc: only allows base64 image data URLs", () => {
    expect(safeLogoSrc("data:image/png;base64,AAAA")).toBe("data:image/png;base64,AAAA");
    expect(safeLogoSrc("javascript:alert(1)")).toBe("");
    expect(safeLogoSrc("data:text/html;base64,AAAA")).toBe("");
  });

  it("statusLabel: known maps, unknown -> dash", () => {
    expect(statusLabel("converted")).toBe("Đã chốt");
    expect(statusLabel("draft")).toBe("Nháp");
    expect(statusLabel("expired")).toBe("expired"); // removed status falls through (no label)
  });

  it("groupLetter: spreadsheet column letters", () => {
    expect(groupLetter(0)).toBe("A");
    expect(groupLetter(25)).toBe("Z");
    expect(groupLetter(26)).toBe("AA");
  });

  it("baoGiaTitleJS: prefixes once, idempotent on already-prefixed", () => {
    expect(baoGiaTitleJS("Dịch vụ X")).toBe("BẢNG BÁO GIÁ - Dịch vụ X");
    expect(baoGiaTitleJS("BẢNG BÁO GIÁ - Y")).toBe("BẢNG BÁO GIÁ - Y");
    expect(baoGiaTitleJS("")).toBe("BẢNG BÁO GIÁ");
  });

  it("pvAmount: qty*price, qty*days*price when usesDays", () => {
    expect(pvAmount({ quantity: 2, unitPrice: 1000 }, false)).toBe(2000);
    expect(pvAmount({ quantity: 2, unitPrice: 1000, days: 3 }, true)).toBe(6000);
  });

  it("pvRows: sections get a letter + restart item numbering", () => {
    const { rows } = pvRows([
      { kind: "section", quantity: 1 },
      { kind: "item", quantity: 1, unitPrice: 100 },
      { kind: "item", quantity: 1, unitPrice: 200 },
    ], false, false);
    expect(rows[0].kind).toBe("section");
    expect(rows[0].letter).toBe("A");
    expect(rows[1].stt).toBe(1);
    expect(rows[2].stt).toBe(2);
  });

  it("fmtMoney: vi-VN grouping, 0 for junk", () => {
    expect(fmtMoney(1234567)).toBe("1.234.567");
    expect(fmtMoney(null)).toBe("0");
  });
});
