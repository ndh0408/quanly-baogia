// HAI BẢN CÀI ĐẶT CỦA MÃ DỰ ÁN KHÔNG ĐƯỢC LỆCH.
//
// `codeLabel` + `sheetCode` phải khai HAI LẦN: server ở src/quoteCode.ts, web ở
// shared/quote-math.ts. Không gộp được vì tsconfig.build.json đặt rootDir="src" nên `shared/`
// KHÔNG vào dist/ — `src/` import `shared/` là chết lúc chạy trong container.
//
// Lệch một ký tự giữa hai bản là hai màn hình hiện HAI MÃ KHÁC NHAU cho cùng một sheet, mà mã này
// chính là thứ trang Nhân sự dùng để tra ngược (`PersonnelRecord.projectCode` lưu cứng chuỗi đó và
// `buildProjectRef` khớp BẰNG-ĐÚNG). Bài này chạy CẢ HAI trên cùng dữ liệu và bắt lệch ngay.
import { describe, it, expect } from "vitest";
import * as SV from "../src/quoteCode.js";
import * as WEB from "../shared/quote-math.js";

const QUOTES = [
  { projectCode: "FP_A26_003", projectVersion: 1, quoteNumber: "GN26003" },
  { projectCode: "FP_A26_003", projectVersion: 2, quoteNumber: "GN26004" },   // bản gửi lại _v2
  { projectCode: null, projectVersion: 1, quoteNumber: "GN26010" },            // chưa có mã dự án
  { projectCode: null, projectVersion: 3, quoteNumber: "GN26011" },
  { projectCode: "FD_A27_001", projectVersion: 1, quoteNumber: "GN27001" },    // sang năm mới
  { projectCode: "", projectVersion: 1, quoteNumber: "" },                     // rỗng hết
];
const SHEETS = [null, undefined, {}, { codeNo: null }, { codeNo: 0 }, { codeNo: 1 }, { codeNo: 2 }, { codeNo: 9 }, { codeNo: 10 }, { codeNo: 123 }];

describe("mã dự án — server và web phải ra CÙNG một chuỗi", () => {
  it("codeLabel khớp trên mọi tổ hợp", () => {
    for (const q of QUOTES) expect(SV.codeLabel(q), JSON.stringify(q)).toBe(WEB.codeLabel(q));
  });

  it("soMa khớp (số đã cấp, hoặc vị trí cho dữ liệu cũ)", () => {
    for (const sh of SHEETS) for (const i of [0, 1, 5]) {
      expect(SV.soMa(sh, i), JSON.stringify({ sh, i })).toBe(WEB.soMa(sh, i));
    }
  });

  it("sheetCode khớp trên mọi tổ hợp (báo giá × số thứ tự × số sheet)", () => {
    for (const q of QUOTES) for (const sh of SHEETS) for (const i of [0, 1, 5]) for (const total of [1, 2, 3, 12]) {
      const n = SV.soMa(sh, i);
      expect(SV.sheetCode(q, n, total), JSON.stringify({ q, sh, i, total })).toBe(WEB.sheetCode(q, n, total));
    }
  });
});

describe("mã dự án — hình dạng đã chốt với chủ dự án 2026-09-07", () => {
  const q = { projectCode: "FD_A26_001", projectVersion: 1, quoteNumber: "GN26001" };
  it("báo giá MỘT sheet: KHÔNG có hậu tố", () => {
    expect(SV.sheetCode(q, 1, 1)).toBe("FD_A26_001");
  });
  it("nhiều sheet: hậu tố HAI chữ số theo số ĐÃ CẤP, không theo vị trí", () => {
    expect(SV.sheetCode(q, 1, 4)).toBe("FD_A26_001_01");
    expect(SV.sheetCode(q, 2, 4)).toBe("FD_A26_001_02");
    // Xoá sheet 02 → còn 2 sheet mang số 1 và 3; số 3 PHẢI vẫn là _03, không tụt thành _02.
    expect(SV.sheetCode(q, 3, 2)).toBe("FD_A26_001_03");
  });
  it("sheet thứ 10 trở lên không bị đệm thừa số 0", () => {
    expect(SV.sheetCode(q, 10, 12)).toBe("FD_A26_001_10");
  });
  it("bản gửi lại _v2 đứng TRƯỚC hậu tố sheet", () => {
    expect(SV.sheetCode({ ...q, projectVersion: 2 }, 2, 3)).toBe("FD_A26_001_v2_02");
  });
  it("chưa có mã dự án thì lùi về số báo giá", () => {
    expect(SV.sheetCode({ projectCode: null, quoteNumber: "GN26007", projectVersion: 1 }, 2, 3)).toBe("GN26007_02");
  });
});
