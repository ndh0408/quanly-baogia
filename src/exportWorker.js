// Worker thread: generates the Excel/PDF buffer OFF the main event loop so a
// CPU-heavy export can't freeze the whole app. Receives a JSON-serialized quote
// (plain numbers/strings — structured-clone safe) via workerData, returns the
// buffer to the parent (ArrayBuffer transferred, no copy). Any failure is
// reported back so the caller can fall back to inline generation.
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

// ĐÃ ĐO: trước bản vá này worker KHÔNG BAO GIỜ khởi động nổi ở dev/test — `./excel.js` không tồn
// tại khi chạy từ nguồn (chỉ có `excel.ts`), nên `runExportJob` nuốt lỗi rồi rơi về chạy NỘI TUYẾN.
// Nghĩa là suốt thời gian qua, mọi lần xuất file ở dev/test đều chạy TRÊN LUỒNG CHÍNH — đúng thứ
// mà worker sinh ra để tránh — mà bộ test vẫn xanh vì đường lui đó cho ra kết quả đúng.
(async () => {
  try {
    await napTsxNeuChayTuNguon();
    const { buildQuoteBuffer } = await import("./excel.js");
    const { renderQuotePdf } = await import("./pdf.js");
    const { kind, quote } = workerData;
    const buf = kind === "pdf" ? await renderQuotePdf(quote) : await buildQuoteBuffer(quote);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    parentPort.postMessage({ ok: true, buffer: ab }, [ab]);
  } catch (e) {
    parentPort.postMessage({ ok: false, error: e?.message || String(e) });
  }
})();
