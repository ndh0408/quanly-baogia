import { describe, expect, it } from "vitest";
import { normalizeFilterText, smartTextMatch } from "./filterText";

describe("invoice smart filter text", () => {
  it("tìm tiếng Việt không dấu và không phân biệt hoa thường", () => {
    expect(normalizeFilterText("Công ty Bến Thành")).toBe("cong ty ben thanh");
    expect(smartTextMatch("ben thanh", ["Công ty Bến Thành Media"])).toBe(true);
  });

  it("cho phép nhiều từ khóa nằm ở nhiều cột và khác thứ tự", () => {
    expect(smartTextMatch("26001 sao mai", ["Công ty Sao Mai", "GN26001"])).toBe(true);
    expect(smartTextMatch("sao 99999", ["Công ty Sao Mai", "GN26001"])).toBe(false);
  });

  it("bỏ dấu câu để tìm số hóa đơn và ngày", () => {
    expect(smartTextMatch("HD 2026 01", ["HD-2026-01", "01/06/2026"])).toBe(true);
  });
});
