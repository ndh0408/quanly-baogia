import { describe, it, expect } from "vitest";
import { normalizeSearch, searchTextFilter } from "../src/searchText.js";

describe("normalizeSearch — chuẩn-hóa bỏ dấu", () => {
  it("bỏ dấu tiếng Việt + thường hóa", () => {
    expect(normalizeSearch("Nguyễn Đức Hòa")).toBe("nguyen duc hoa");
    expect(normalizeSearch("CÔNG TY Gia Nguyễn")).toBe("cong ty gia nguyen");
    expect(normalizeSearch("Trần Thị Bưởi")).toBe("tran thi buoi");
  });
  it("đ → d (không phải dấu tổ hợp)", () => {
    expect(normalizeSearch("Đường Đỏ")).toBe("duong do");
  });
  it("gộp nhiều phần + bỏ ký tự lạ về khoảng trắng", () => {
    expect(normalizeSearch("FE_A26", null, "0914-291-951")).toBe("fe a26 0914 291 951");
    expect(normalizeSearch("a@b.com")).toBe("a b com");
  });
  it("bỏ qua null/undefined/rỗng", () => {
    expect(normalizeSearch(null, undefined, "", "X")).toBe("x");
  });
  it("chuỗi toàn ký tự đặc biệt / khoảng trắng → rỗng", () => {
    for (const s of ["@#$", "...", "   ", "!!!", "---"]) expect(normalizeSearch(s)).toBe("");
  });
});

describe("searchTextFilter — Prisma filter (chống contains:'' nuốt cả danh sách)", () => {
  it("từ khóa thật → contains chuỗi đã chuẩn-hóa", () => {
    expect(searchTextFilter("Cà phê")).toEqual({ contains: "ca phe" });
    expect(searchTextFilter("nguyen")).toEqual({ contains: "nguyen" });
  });
  it("q rỗng-sau-chuẩn-hóa (rác/space) → token KHÔNG-khớp, KHÔNG phải ''", () => {
    for (const s of ["@#$", "...", "   ", null, undefined, ""]) {
      const f = searchTextFilter(s);
      expect(f.contains).not.toBe(""); // nếu là "" → LIKE '%%' nuốt mọi row
      expect(f.contains).toBe("~no~match~");
    }
  });
});
