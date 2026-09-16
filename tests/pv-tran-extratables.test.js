// TRẦN TỔNG CHO CỘT `QuoteSheet.extraTables` — và quyền GỠ vẫn phải còn.
//
// ── LỖ ──────────────────────────────────────────────────────────────────────
// `POST /:id/extra/:sheetId/:rid/pay` nhận `paidProof: z.string().max(900_000)` — trần cho MỘT
// LƯỢT, không phải cho CỘT. Mỗi sheet nhận được 20 bảng × 1000 dòng, và chính handler đó là
// ĐỌC–SỬA–GHI toàn khối: nạp cả cột, sửa tại chỗ, ghi cả cột trở lại, bên trong một transaction
// đang giữ `SELECT … FOR UPDATE`. Sau 100 ảnh trên một sheet, MỖI lượt /pay kế tiếp đọc ~90 MB,
// giữ ~90 MB, ghi ~90 MB trên luồng chính.
//
// ── VÌ SAO LÀ P1, KHÔNG PHẢI P0 ─────────────────────────────────────────────
// ĐO ĐƯỢC 2026-09-16: cột lớn nhất trên production là 424 BYTE (tổng 5,3 kB), trên dev là 92 kB.
// Chưa ai đính ảnh thật. Lỗ TIỀM ẨN — chặn trước khi nó thành thói quen thì rẻ.
//
// ── VÀ VÌ SAO CHẶN THEO CHIỀU TĂNG ──────────────────────────────────────────
// Một trần tuyệt đối sẽ khoá luôn thao tác GỠ ảnh trên một cột đã quá lớn — nhốt người dùng lại
// với đúng dữ liệu họ đang cố dọn. Cùng bài học với `MAX_SAVE_TOTAL_ROWS` (src/validators.ts) và
// với khối "ĐÃ GỠ. ĐỪNG ĐẶT LẠI" ngay dưới nó.
import { describe, it, expect } from "vitest";
import { config } from "../src/config.js";

/** Bản sao ĐÚNG luật đang chạy trong markExtraTableRowPayment — giữ hai bên khỏi trôi khỏi nhau. */
function choPhepGhi(byteCu, byteMoi, tran = config.MAX_EXTRA_TABLES_BYTES) {
  return !(byteMoi > tran && byteMoi > byteCu);
}

describe("trần tổng cột extraTables", () => {
  const TRAN = config.MAX_EXTRA_TABLES_BYTES;

  it("hằng số ở mức rộng rãi cho dùng thật nhưng vẫn là trần THẬT", () => {
    // Production đang ở 424 byte, dev 92 kB → trần phải lớn hơn HẲN mức đó.
    expect(TRAN).toBeGreaterThan(1024 * 1024);
    // Và phải nhỏ hơn hẳn kịch bản 90 MB mà nó sinh ra để chặn.
    expect(TRAN).toBeLessThan(64 * 1024 * 1024);
  });

  it("dưới trần → cho ghi", () => {
    expect(choPhepGhi(1_000, 2_000)).toBe(true);
  });

  it("PHÌNH THÊM vượt trần → CHẶN", () => {
    expect(choPhepGhi(TRAN - 10, TRAN + 1_000)).toBe(false);
  });

  it("cột ĐÃ quá trần mà THU NHỎ → vẫn CHO (gỡ ảnh không bị khoá)", () => {
    // Đây là vế quan trọng nhất: người dùng phải luôn dọn được thứ họ đã tạo ra.
    expect(choPhepGhi(TRAN * 3, TRAN * 2)).toBe(true);
    expect(choPhepGhi(TRAN * 3, 500)).toBe(true);
  });

  it("cột ĐÃ quá trần mà GIỮ NGUYÊN kích thước → vẫn CHO (tích/bỏ tích không kèm ảnh)", () => {
    // `paid: false` xoá cờ nhưng chuỗi JSON có thể dài y hệt. Chặn ca này là khoá luôn việc BỎ
    // tích trên một trang đã lỡ quá trần.
    expect(choPhepGhi(TRAN * 2, TRAN * 2)).toBe(true);
  });

  it("cột ĐÃ quá trần mà phình THÊM dù chỉ 1 byte → CHẶN", () => {
    expect(choPhepGhi(TRAN * 2, TRAN * 2 + 1)).toBe(false);
  });
});
