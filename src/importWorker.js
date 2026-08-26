// Worker thread: ĐỌC file .xlsx người dùng tải lên, TÁCH KHỎI luồng chính.
//
// ── VÌ SAO ──────────────────────────────────────────────────────────────────
// `parseQuoteWorkbook` gọi `workbook.xlsx.load(buffer)` của exceljs, tức GIẢI NÉN và dựng TOÀN BỘ
// workbook trong bộ nhớ TRƯỚC khi bất kỳ trần nào của app có tác dụng: `MAX_SHEETS` (30) và
// `MAX_SCAN_ROWS` (200.000) chỉ được kiểm khi đã có object trong tay.
//
// Trần tải lên là 10MB, nhưng .xlsx là ZIP: 10MB nén có thể bung ra hàng trăm MB — XML thưa nén
// cực tốt. Chạy trên luồng chính thì hai chuyện xảy ra cùng lúc:
//   1. CẢ SERVER ĐỨNG. Không phải "chậm" — event loop bị chiếm, mọi request khác, mọi kết nối SSE,
//      mọi nhịp tim đều xếp hàng sau nó. Người dùng khác tưởng hệ thống chết.
//   2. Vượt RAM là V8 giết TIẾN TRÌNH, không phải một request. Từ khi compose đặt trần cgroup thì
//      kernel còn SIGKILL cả container — mọi request đang bay đứt, lần Lưu báo giá đang gửi dở mất.
//
// Worker thread giải quyết CHẮC CHẮN vế thứ nhất: luồng chính rảnh (đã đo bằng độ trễ event loop
// trong tests/import-worker-thread.test.js).
//
// Vế thứ hai thì KHÔNG: `resourceLimits.maxOldGenerationSizeMb` đã được đo và KHÔNG chặn —
// với trần 32MB, worker vẫn cấp phát được `Buffer.alloc(300MB)` và ba triệu object. Hàng rào bộ
// nhớ thật ở đường này là trần tải lên 10MB cộng timeout. Xem chú thích ở src/routes/import.routes.ts.
//
// Nhận Buffer qua `workerData` (structured clone chép 10MB — không đáng kể so với việc bung nó ra),
// trả về kết quả đã phân tích. `parseQuoteWorkbook` KHÔNG hề đổi, nên hành vi đọc Excel — round-trip
// mẫu, nhận dạng cột, dựng lại nhóm — giữ nguyên từng chi tiết.
import { parentPort, workerData } from "node:worker_threads";

// ── Nạp loader tsx khi chạy TỪ NGUỒN `.ts` (dev/test) ──────────────────────
// Phải nội tuyến NGAY TRONG file `.js` này, không được tách ra module riêng: bất kỳ `.ts` nào cũng
// chưa giải quyết được ở thời điểm này — đó chính là vấn đề cần vá.
//
// Cũng KHÔNG dùng `execArgv: ["--import", "tsx"]` ở phía cha: đã thử cả `tsx`, `tsx/esm` và đường
// dẫn thẳng tới loader.mjs — worker vẫn ném `Cannot find module …/src/excelImport.js`. Việc đăng
// ký hook phải xảy ra TRONG chính luồng worker.
//
// Ở `dist/` thì KHÔNG làm gì: mọi file đã là `.js` (phân giải chuẩn của Node là đủ) và image
// production không cài tsx — nó là devDependency.
async function napTsxNeuChayTuNguon() {
  if (import.meta.url.includes("/dist/")) return;
  try {
    const { register } = await import("tsx/esm/api");
    register();
  } catch {
    // Không có tsx → để lỗi phân giải nổ ra ở chỗ import thật; thông điệp ở đó nói rõ thiếu file
    // nào, hữu ích hơn một lỗi "không tìm thấy tsx".
  }
}

// Import ĐỘNG, không phải tĩnh: `import` tĩnh được cẩu lên đầu và giải quyết TRƯỚC khi thân module
// chạy, nên loader tsx sẽ chưa kịp đăng ký.
(async () => {
  try {
    await napTsxNeuChayTuNguon();
    const { parseQuoteWorkbook } = await import("./excelImport.js");
    const { buffer } = workerData;
    const result = await parseQuoteWorkbook(Buffer.from(buffer));
    parentPort.postMessage({ ok: true, result });
  } catch (e) {
    // Phân biệt "file sai" với "file quá nặng": chỗ gọi cần biết để trả 422 hay 413, vì lời khuyên
    // cho người dùng khác hẳn nhau (sửa file / tách bớt sheet).
    const msg = e?.message || String(e);
    const heap = /heap out of memory|Array buffer allocation failed|Invalid string length/i.test(msg);
    parentPort.postMessage({ ok: false, error: msg, quaNang: heap });
  }
})();
