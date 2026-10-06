// Bảng 5 màu của ghi chú ở Danh sách báo giá tồn tại ở HAI nơi vì server không import được web và ngược lại:
// src/quoteListNote.ts (nguồn để KIỂM — QuoteListNoteSchema từ chối màu ngoài bảng) và
// web/src/lib/ghiChuMau.ts (nguồn để VẼ — bảng chọn màu). Lệch nhau thì hoặc giao diện cho chọn một màu mà
// máy chủ trả 400, hoặc máy chủ nhận một màu mà giao diện không vẽ được. Bài này khoá hai bản.
import { describe, it, expect } from "vitest";
import * as may from "../src/quoteListNote.ts";
import * as web from "../web/src/lib/ghiChuMau.ts";

describe("ghi chú danh sách báo giá — bảng màu server ↔ web", () => {
  it("cùng MỘT tập khoá màu, cùng thứ tự (thứ tự là thứ tự chấm trên bảng chọn)", () => {
    expect([...web.MAU_GHI_CHU]).toEqual([...may.MAU_GHI_CHU]);
    expect(may.MAU_GHI_CHU).toHaveLength(5);   // "5 màu chủ đạo" — đổi số này là đổi yêu cầu, không phải sửa lỗi
  });

  it("cùng trần độ dài ghi chú", () => {
    expect(web.GHI_CHU_TOI_DA).toBe(may.GHI_CHU_TOI_DA);
  });

  it("mỗi màu có tên tiếng Việt, và không có tên thừa", () => {
    expect(Object.keys(web.NHAN_MAU).sort()).toEqual([...web.MAU_GHI_CHU].sort());
    for (const k of web.MAU_GHI_CHU) expect(web.NHAN_MAU[k].trim(), k).not.toBe("");
  });

  it("chuanHoaGhiChu: xuống dòng → một dấu cách, cắt hai đầu, giữ nguyên khoảng trắng bên trong", () => {
    expect(may.chuanHoaGhiChu("  Chờ khách\nduyệt  ")).toBe("Chờ khách duyệt");
    expect(may.chuanHoaGhiChu("a \r\n\r\n b")).toBe("a b");
    expect(may.chuanHoaGhiChu("a  b")).toBe("a  b");
    expect(may.chuanHoaGhiChu(" \n ")).toBe("");
  });
});
