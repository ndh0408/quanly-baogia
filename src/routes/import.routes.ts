// NHẬP file Excel vào báo giá — endpoint CHỈ ĐỌC (parse + xem trước), KHÔNG ghi DB.
//
// Vì sao không ghi thẳng: người dùng phải XEM TRƯỚC "trước/sau" rồi mới quyết định. Sau khi bấm
// "Nạp vào báo giá", dữ liệu chảy qua ĐÚNG đường lưu cũ (PUT /api/quotes/:id) nên giữ nguyên mọi
// lớp: kiểm dữ liệu (zod), phân quyền, khoá lạc quan (baseUpdatedAt), lưu phiên bản (QuoteVersion),
// tính lại tổng ở server. Không đẻ thêm đường ghi nào để hở.

import { Router } from "express";
import type { Request, Response } from "express";
import multer from "multer";
import { prisma } from "../db.js";
import { asyncHandler, requireAuth } from "../middleware.js";
import { canOnQuote, requirePermission, can, PERMISSIONS as P } from "../permissions.js";
import { createLimiter } from "../rateLimit.js";
import { Worker } from "node:worker_threads";
import { inspectXlsx } from "../zipSafety.js";
import { audit } from "../audit.js";

const router = Router();
router.use(requireAuth);

// Đọc xlsx = giải nén + duyệt XML → tốn CPU/RAM. Giới hạn riêng, chặt hơn API thường.
const importLimiter = createLimiter("import-excel", { windowMs: 60_000, max: 12 });

const MAX_FILE_BYTES = 10 * 1024 * 1024;

// ─── Đọc workbook TRONG WORKER THREAD ──────────────────────────────────────
//
// `parseQuoteWorkbook` gọi `workbook.xlsx.load()` của exceljs — giải nén và dựng TOÀN BỘ workbook
// trong bộ nhớ TRƯỚC khi bất kỳ trần nào của app (MAX_SHEETS, MAX_SCAN_ROWS) có tác dụng. Trần tải
// lên là 10MB, nhưng .xlsx là ZIP: XML thưa nén cực tốt, 10MB nén bung ra hàng trăm MB. Chạy trên
// luồng chính thì CẢ SERVER ĐỨNG (event loop bị chiếm — mọi request khác, mọi SSE, mọi nhịp tim
// xếp hàng sau nó), và vượt RAM là V8 giết TIẾN TRÌNH chứ không phải một request.
//
// CỐ Ý KHÔNG có đường rơi về nội tuyến (khác `runExportJob`): nội tuyến CHÍNH LÀ thứ đang bỏ đi.
// Worker hỏng thì trả lỗi cho người dùng, không kéo việc nặng về luồng chính đúng lúc đang tải cao.
const IMPORT_WORKER_URL = new URL("../importWorker.js", import.meta.url);
const IMPORT_TIMEOUT_MS = Math.max(5_000, Number(process.env.IMPORT_TIMEOUT_MS) || 30_000);
// Trần heap của worker.
//
// ⚠️ ĐÃ ĐO: `maxOldGenerationSizeMb` KHÔNG chặn được thứ tốn kém nhất ở đây. Thử với trần 32MB,
// một worker vẫn cấp phát thoải mái `Buffer.alloc(300MB)` và ba triệu object. Buffer là bộ nhớ
// NGOÀI heap V8, còn old-space thì V8 co giãn theo cách riêng. Nên ĐỪNG coi đây là hàng rào.
//
// Hàng rào THẬT ở đường này là hai thứ khác: trần tải lên 10MB (multer, ngay trên) và
// IMPORT_TIMEOUT_MS. Trần heap giữ lại như một lớp phòng khi V8 đổi hành vi, không phải như một
// bảo đảm. Lợi ích ĐÃ CHỨNG MINH của worker là tách việc đọc file khỏi EVENT LOOP —
// tests/import-worker-thread.test.js đo độ trễ event loop để chốt điều đó.
//
// Việc còn lại: giới hạn bộ nhớ thật sự cần đọc theo luồng (exceljs WorkbookReader) thay vì
// `.load()` cả workbook. Xem docs/REMAINING_RISKS.md.
const IMPORT_HEAP_MB = Math.max(128, Number(process.env.IMPORT_HEAP_MB) || 512);

class LoiNhap extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

// ─── PHỄU: TRẦN SỐ WORKER NHẬP CHẠY CÙNG LÚC ───────────────────────────────
//
// Rate limiter ở trên đếm theo KHOÁ (người dùng/IP) trong 60s — nó KHÔNG nói gì về số việc chạy
// ĐỒNG THỜI. 8 người mỗi người một file 10MB là 8 worker cùng lúc, mỗi worker được cấp
// `maxOldGenerationSizeMb: 512`, mà chính chú thích trên ĐÃ ĐO và ghi rằng trần heap đó không
// chặn được thứ tốn kém nhất. Vượt RAM ở mức container thì kernel SIGKILL CẢ TIẾN TRÌNH — mọi
// request đang bay đứt, đúng thứ mà việc chuyển sang worker thread định tránh.
//
// Nên: N việc chạy cùng lúc, hàng chờ có trần, chờ quá lâu thì 429 kèm Retry-After. Từ chối SỚM
// và nói rõ tốt hơn nhận hết rồi chết cả tiến trình.
//
// ⚠️ PHẠM VI — phễu này chặn ĐÚNG MỘT thứ: số WORKER đang ĐỌC FILE cùng lúc. Nó KHÔNG phải trần
// RAM của cả đường nhập. `traSuat()` nằm ở `finally` của lượt `await docWorkbookTrongWorker(...)`,
// tức suất được trả NGAY KHI worker giao kết quả về; `audit(...)` (một lượt ghi DB, có await) và
// `res.json(result)` (tuần tự hoá TOÀN BỘ kết quả ra chuỗi) chạy SAU đó, ngoài phễu. Nên số
// KẾT QUẢ LỚN đang nằm trong RAM luồng chính có thể nhiều hơn IMPORT_MAX_CONCURRENT. Chưa đo
// được mức RAM đó ở đây.
// KHÔNG viết "thứ duy nhất chặn nó là rate limiter" — bản trước ghi thế và tự mâu thuẫn với dòng
// 45 ngay trong file này. Chặn theo tầng, từ ngoài vào:
//   1. multer `fileSize: MAX_FILE_BYTES` (10MB) — trần thật cho mỗi lượt, chặn TRƯỚC khi đọc
//   2. `files: 1, fields: 4` — không cho gửi nhiều file trong một request
//   3. rate limiter theo khoá (người dùng/IP, 60s) — chặn theo TẦN SUẤT, không theo số việc
//   4. phễu này — chặn số worker ĐỌC cùng lúc, và chỉ tới lúc worker giao kết quả
//   5. IMPORT_TIMEOUT_MS — trần thời gian, `terminate()` luồng khi hết hạn
// Phần nằm ngoài mọi tầng trên là quãng từ khi worker giao kết quả tới khi `res.json` viết xong.
//
// Trần mặc định 2: đây là việc NGỐN CPU+RAM, chạy song song nhiều hơn số việc máy làm nổi chỉ
// làm mọi người cùng chậm chứ không ai xong sớm hơn. Chỉnh bằng env khi biết rõ máy.
//
// `raw` RỖNG phải coi như CHƯA ĐẶT. Lý do: `Number("")` và `Number("   ")` đều bằng 0 và đều
// hữu hạn, nên với sàn 0 (`IMPORT_MAX_QUEUED` ngay dưới) chuỗi rỗng lọt qua và cho ra trần 0 —
// tắt hẳn hàng chờ, mọi lượt nhập vượt `IMPORT_MAX_CONCURRENT` bị 429 ngay lập tức thay vì được
// xếp hàng. Mà .env.example ghi sẵn dòng `# IMPORT_MAX_QUEUED=4`: bỏ dấu `#` rồi xoá số là thao
// tác rất dễ xảy ra, và hỏng theo kiểu im lặng (không log, chỉ 429 lác đác). `0` GÕ TƯỜNG MINH
// vẫn giữ nguyên nghĩa "không cho xếp hàng" — chỉ chuỗi rỗng mới rơi về mặc định.
// Xem tests/w1-import-queued-env.test.js.
const soNguyen = (raw: string | undefined, mac: number, toiThieu: number) => {
  const s = (raw ?? "").trim();
  if (s === "") return mac;
  const n = Number(s);
  return Number.isFinite(n) && n >= toiThieu ? Math.floor(n) : mac;
};
/** Chốt cho test: đọc từng nhánh của bộ phân tích env mà không phải nạp lại cả module. */
export const _soNguyen = soNguyen;
const IMPORT_MAX_CONCURRENT = soNguyen(process.env.IMPORT_MAX_CONCURRENT, 2, 1);
const IMPORT_MAX_QUEUED = soNguyen(process.env.IMPORT_MAX_QUEUED, 4, 0);
// Chờ tối đa bấy nhiêu trước khi bỏ cuộc. Phải NGẮN hơn nhiều so với thời gian chờ của trình
// duyệt: người dùng thà nhận "máy chủ đang bận, thử lại" sau 15s còn hơn treo tab.
const IMPORT_WAIT_MS = soNguyen(process.env.IMPORT_WAIT_MS, 15_000, 1);

const BAN = () => new LoiNhap("Máy chủ đang bận đọc file Excel khác. Hãy thử lại sau vài giây.", 429);

let dangChay = 0;
type NguoiCho = { nhan: () => void; huy: (e: unknown) => void; dongHo: NodeJS.Timeout };
const hangCho: NguoiCho[] = [];

/** Xin một suất chạy worker. Resolve = được chạy; reject(LoiNhap 429) = bận, không chạy. */
function xinSuat(): Promise<void> {
  if (dangChay < IMPORT_MAX_CONCURRENT) { dangChay++; return Promise.resolve(); }
  if (hangCho.length >= IMPORT_MAX_QUEUED) return Promise.reject(BAN());
  return new Promise<void>((resolve, reject) => {
    const v: NguoiCho = {
      nhan: () => { clearTimeout(v.dongHo); resolve(); },
      huy: reject,
      dongHo: setTimeout(() => {
        const i = hangCho.indexOf(v);
        if (i >= 0) hangCho.splice(i, 1);
        v.huy(BAN());
      }, IMPORT_WAIT_MS),
    };
    hangCho.push(v);
  });
}

/**
 * Trả suất. CHUYỂN TAY thẳng cho người đang chờ chứ không giảm rồi tăng lại — giảm/tăng qua hai
 * nhịp event loop sẽ để lọt một request mới chen ngang trước người đã xếp hàng.
 */
function traSuat(): void {
  const v = hangCho.shift();
  if (v) { v.nhan(); return; }
  if (dangChay > 0) dangChay--;
}

/** Chốt cho test: xem/điều khiển phễu mà không phải dựng cả một request HTTP. */
export const _tranNhap = {
  xin: xinSuat,
  tra: traSuat,
  soDangChay: () => dangChay,
  soDangCho: () => hangCho.length,
  MAX_CONCURRENT: IMPORT_MAX_CONCURRENT,
  MAX_QUEUED: IMPORT_MAX_QUEUED,
};

function docWorkbookTrongWorker(buffer: Buffer): Promise<any> {
  return new Promise((resolve, reject) => {
    let xong = false;
    const w = new Worker(IMPORT_WORKER_URL, {
      workerData: { buffer },
      resourceLimits: { maxOldGenerationSizeMb: IMPORT_HEAP_MB },
    });
    const ket = (fn: (a: any) => void, a: any) => { if (xong) return; xong = true; clearTimeout(dongHo); void w.terminate(); fn(a); };
    const dongHo = setTimeout(
      () => ket(reject, new LoiNhap("File Excel quá nặng để đọc trong thời gian cho phép. Hãy tách bớt sheet rồi thử lại.", 413)),
      IMPORT_TIMEOUT_MS,
    );
    w.once("message", (m: any) => {
      if (m?.ok) return ket(resolve, m.result);
      // `quaNang` = worker chạm trần heap. Đó là 413 (file quá lớn), không phải 422 (file hỏng) —
      // lời khuyên cho người dùng khác hẳn nhau.
      ket(reject, m?.quaNang
        ? new LoiNhap("File Excel quá lớn để xử lý. Hãy tách bớt sheet hoặc bớt dòng rồi thử lại.", 413)
        : new LoiNhap(`Không đọc được file Excel: ${m?.error || "file hỏng hoặc sai định dạng"}`, 422));
    });
    w.once("error", (e) => ket(reject, e));
    // Chạm trần heap thì worker CHẾT HẲN, không kịp gửi message nào — bắt ở đây mới thấy.
    w.once("exit", (code) => {
      if (!xong && code !== 0) ket(reject, new LoiNhap("File Excel quá lớn để xử lý. Hãy tách bớt sheet hoặc bớt dòng rồi thử lại.", 413));
    });
  });
}
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: 1, fields: 4 },
  fileFilter: (_req, file, cb) => {
    const ok = file.mimetype === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      || file.mimetype === "application/vnd.ms-excel.sheet.macroEnabled.12"
      || file.mimetype === "application/octet-stream"        // trình duyệt/OS đôi khi gửi kiểu này
      || /\.xlsx?$/i.test(file.originalname || "");
    cb(null, ok);
  },
});

/** xlsx là file zip: PK\x03\x04. KHÔNG tin phần mở rộng/MIME do trình duyệt khai. */
const looksXlsx = (b: Buffer) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;

/**
 * POST /api/quotes/import-excel   (multipart: file=<.xlsx>, quoteId=<id> tuỳ chọn)
 * → { sheets: [...], warnings: [...] }  — dữ liệu lưới đọc từ file, KHÔNG đụng DB.
 *
 * Quyền: có `quote:create` (dựng báo giá mới) HOẶC sửa được đúng báo giá đích (quoteId).
 */
router.post(
  "/import-excel",
  importLimiter,
  requirePermission(P.QUOTE_CREATE),
  upload.single("file"),
  asyncHandler(async (req: Request, res: Response) => {
    // Người điền HN chỉ được điền bảng Hà Nội — không nạp đè lưới báo giá chính (khớp PUT /:id).
    // Theo QUYỀN chứ không theo chuỗi role: quote:hn:fill cấp được per-user. Xem quotes.routes.ts.
    if (can(req.session, P.QUOTE_HN_FILL)) {
      return res.status(403).json({ error: "Account Hà Nội không được nhập file vào báo giá chính." });
    }
    if (!req.file) return res.status(400).json({ error: "Vui lòng chọn file Excel (.xlsx)" });
    if (!looksXlsx(req.file.buffer)) {
      return res.status(415).json({ error: "File không phải .xlsx. Nếu đang dùng .xls cũ, hãy mở bằng Excel rồi 'Lưu thành' .xlsx." });
    }
    // ĐÂY là chỗ nguy hiểm nhất trong toàn hệ: buffer do người ngoài đưa vào sắp được GIẢI NÉN và
    // phân tích XML ngay trong tiến trình ứng dụng. `PK\x03\x04` chỉ chứng minh "là zip" — nó khớp
    // với cả bom giải nén (4 GB số 0 nén còn vài KB) lẫn zip 200.000 mục. Soi mục lục trước, không
    // giải nén một byte nào (src/zipSafety.ts).
    const zip = inspectXlsx(req.file.buffer);
    if (!zip.ok) {
      await audit(req, "quote.import.rejected", {
        resource: "quote", resourceId: Number(req.body?.quoteId) || undefined,
        after: { reason: zip.reason, file: String(req.file.originalname || "").slice(0, 120), size: req.file.size },
      });
      return res.status(415).json({ error: `Tệp Excel không hợp lệ: ${zip.reason}` });
    }

    // Nạp vào báo giá CÓ SẴN → phải sửa được chính báo giá đó (chặn IDOR: người không liên quan
    // không được dùng endpoint này để dò dữ liệu báo giá khác).
    const quoteId = Number(req.body?.quoteId) || 0;
    if (quoteId) {
      const quote = await prisma.quote.findFirst({
        where: { id: quoteId },
        select: { id: true, createdById: true, status: true, members: { select: { id: true } } },
      });
      if (!quote) return res.status(404).json({ error: "Không tìm thấy báo giá" });
      if (!canOnQuote(req.session, "update", quote)) {
        return res.status(403).json({ error: "Bạn không có quyền sửa báo giá này" });
      }
      // Đã chốt / không chốt là TRẠNG THÁI CUỐI — khớp `editable` ở editor + canEdit ở service.
      const terminal = quote.status === "converted" || quote.status === "lost";
      if (terminal && !can(req.session, P.QUOTE_SEND)) {
        return res.status(409).json({ error: "Báo giá đã chốt/không chốt — không nhập đè được nữa." });
      }
    }

    // Xin suất SAU mọi kiểm tra rẻ tiền (quyền, chữ ký zip, quyền trên báo giá) để không giữ
    // chỗ cho những request đằng nào cũng bị từ chối.
    try {
      await xinSuat();
    } catch (e) {
      res.setHeader("Retry-After", "5");
      return res.status(429).json({ error: e instanceof LoiNhap ? e.message : "Máy chủ đang bận, hãy thử lại sau vài giây." });
    }

    let result;
    try {
      result = await docWorkbookTrongWorker(req.file.buffer);
    } catch (e) {
      const st = e instanceof LoiNhap ? e.status : 422;
      const msg = e instanceof LoiNhap
        ? e.message
        : `Không đọc được file Excel: ${e instanceof Error ? e.message : "file hỏng hoặc sai định dạng"}`;
      return res.status(st).json({ error: msg });
    } finally {
      // PHẢI ở finally: thiếu một đường thoát là suất bị ăn mòn dần cho tới khi không ai nhập
      // được nữa — kiểu hỏng chỉ lộ ra sau nhiều ngày chạy.
      //
      // Trả suất ở ĐÂY nghĩa là phễu buông ngay khi worker xong, TRƯỚC `audit()` và
      // `res.json(result)` bên dưới. Đánh đổi: giữ suất qua lượt ghi DB thì một truy vấn chậm
      // khoá luôn cả hàng nhập, còn buông sớm như hiện nay thì `result` vẫn nằm trong RAM luồng
      // chính suốt hai bước đó mà KHÔNG được phễu tính — xem đoạn "PHẠM VI" ở khai báo phễu.
      traSuat();
    }

    await audit(req, "quote.import.preview", {
      resource: "quote",
      resourceId: quoteId || undefined,
      after: {
        file: String(req.file.originalname || "").slice(0, 120),
        size: req.file.size,
        sheets: result.sheets.map((s: any) => ({ name: s.name, rows: s.items.length, skipped: s.skipped || undefined })),
      },
    });
    res.json(result);
  })
);

// Lỗi từ multer (file quá lớn / sai loại) → thông báo tiếng Việt thay vì 500.
router.use((err: unknown, _req: Request, res: Response, next: (e?: unknown) => void) => {
  const e = err as { code?: string; message?: string };
  if (e?.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: "File quá lớn (tối đa 10 MB)" });
  if (e?.code === "LIMIT_UNEXPECTED_FILE") return res.status(400).json({ error: "Chỉ nhận 1 file .xlsx" });
  return next(err);
});

export default router;
