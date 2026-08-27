// TẢI FILE BÁO GIÁ — một đường duy nhất cho cả trang Danh sách lẫn trang Sửa báo giá.
//
// ── VÌ SAO KHÔNG CÒN `window.open` ──────────────────────────────────────────
// Trước đây cả hai nơi gọi `window.open("/api/export/:id.xlsx")`. Với báo giá vừa thì chạy tốt,
// nhưng nó KHÔNG BAO GIỜ thấy được mã lỗi: `src/routes/export.routes.ts:108` (và `:152` cho PDF)
// trả **413** khi báo giá vượt `MAX_EXPORT_ITEMS`, mà `window.open` giao thẳng phản hồi cho trình
// duyệt — người dùng nhận một tab trắng in ra JSON `{"error":"Báo giá quá lớn…"}`.
//
// Và đó là một ngõ cụt THẬT, không phải trường hợp lý thuyết: `src/validators.ts` cho LƯU tới 60
// trang × 1000 dòng = 60.000 dòng, trong khi đường xuất đồng bộ dừng ở 20.000. Người dùng lưu
// được rồi mới phát hiện không tải về được, và lời nhắn "vui lòng dùng xuất nền (async)" trỏ tới
// một chức năng KHÔNG CÓ NÚT NÀO gọi — `POST /api/quotes/:id/export` (src/routes/jobs.routes.ts)
// tồn tại từ lâu nhưng `grep -rn "api/jobs" web/src` không ra kết quả nào.
//
// ── TRẦN 20.000 LÀ ĐÚNG, ĐỪNG NÂNG ──────────────────────────────────────────
// Số đo trong docs/REMAINING_RISKS.md: 60.000 dòng mất 20,8 giây và 393MB RSS cho MỘT request —
// tức chặn event loop 20 giây. Cách đúng là đẩy sang worker, không phải nới trần.
//
// ── LUỒNG ───────────────────────────────────────────────────────────────────
//   1. `fetch` đường đồng bộ. Xong → tải về ngay (đường thường ngày, không đổi gì với người dùng).
//   2. Gặp 413 → `POST /api/quotes/:id/export` xếp việc, rồi hỏi `GET /api/jobs/export/:jobId`
//      tới khi xong, rồi tải từ URL đã ký mà worker trả về.
//   3. Xuất nền cần Redis + kho object. Thiếu → server trả 503 kèm `code:
//      "export_async_unavailable"`; nói thẳng ra chứ đừng để người dùng đoán.
//
// ── VÌ SAO TẢI BẰNG BLOB CHỨ KHÔNG `location.href` ──────────────────────────
// Bước 2 là bất đồng bộ (chờ vài giây tới vài chục giây). Mọi cách mở cửa sổ/điều hướng SAU một
// `await` đều có thể bị chặn pop-up vì trình duyệt không còn coi đó là hành động của người dùng.
// Thẻ `<a download>` gắn vào DOM rồi `.click()` thì không bị chặn.
import { api, ApiError, isPreviewMode, resetCsrfToken } from "./api";
import { toast } from "./ui";

/** Bấm một thẻ <a download> ẩn — không bị chặn pop-up như window.open sau await. */
function taiVe(url: string, tenFile: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = tenFile;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  // GỠ Ở TICK SAU, không cùng tick với click(). Gỡ ngay trong cùng tick từng làm WebKit/Safari cũ
  // huỷ mất lượt tải vừa bấm (nút bấm xong thì không có gì xảy ra, cũng không có lỗi). Repo này cố
  // ý còn hỗ trợ nhóm trình duyệt đó, và trì hoãn một tick thì không mất gì.
  setTimeout(() => a.remove(), 0);
}

/** Tên file lấy từ Content-Disposition của server; thiếu thì tự dựng cho khỏi ra "download". */
function tenTuHeader(res: Response, duPhong: string): string {
  const cd = res.headers.get("Content-Disposition") || "";
  const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd);
  if (!m) return duPhong;
  try { return decodeURIComponent(m[1]); } catch { return m[1]; }
}

const nghi = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * ĐANG CHẠY — chặn bấm lại. Khoá theo (báo giá, định dạng).
 *
 * VÌ SAO CẦN: bản cũ `window.open` trả quyền điều khiển về NGAY, và trình duyệt tự hiện chỉ báo
 * tải xuống nên người dùng biết có chuyện đang xảy ra. Bản này `await` — với báo giá 20.000 dòng
 * là ~8 giây (số đo ở docs/REMAINING_RISKS.md), và với đường nền là hàng chục giây tới vài phút.
 * Suốt quãng đó KHÔNG CÓ GÌ trên màn hình. Người dùng sẽ bấm lại.
 *
 * `QuoteList.tsx` có `busy.current` che được, nhưng `QuoteEditor.tsx` thì KHÔNG — nút nằm trong
 * menu, đóng menu xong mở lại là bấm được lần nữa. Nên khoá đặt ở ĐÂY, nơi cả hai đi qua.
 */
const dangChay = new Set<string>();

/** Báo cho người dùng biết còn đang chạy, nếu quá lâu. Trả về hàm huỷ. */
function bao(cham: () => void, sauMs: number): () => void {
  const t = setTimeout(cham, sauMs);
  return () => clearTimeout(t);
}

/**
 * Hỏi trạng thái job tới khi xong. Nhịp thưa dần: file lớn mất hàng chục giây, hỏi mỗi giây suốt
 * quãng đó chỉ tổ nện vào API mà không sớm hơn được lượt nào.
 *
 * `hanMs` là trần CHỜ của client, KHÔNG phải trần của job. Hết hạn ở đây thì job vẫn chạy tiếp
 * trong worker — nên lời nhắn nói rõ là "chưa xong", đừng nói là "thất bại".
 */
async function choJob(queue: string, jobId: string, hanMs = 5 * 60_000) {
  const het = Date.now() + hanMs;
  let cho = 700;
  for (;;) {
    const j = await api.jobStatus(queue, jobId);
    if (j.state === "completed") return j;
    if (j.state === "failed") throw new Error(j.failedReason || "Tạo file nền thất bại");
    // "unknown" là cách BullMQ nói "job này không nằm trong danh sách nào cả" — nó đã bị dọn, hoặc
    // chưa bao giờ tồn tại. Hỏi tiếp là hỏi về một thứ không có: 65 lượt trong 5 phút rồi mới bỏ
    // cuộc, và lời nhắn cuối cùng lại là "vẫn đang được tạo" — sai hẳn chuyện.
    if (j.state === "unknown") {
      throw new Error("Tác vụ tạo file không còn tồn tại trên máy chủ (đã bị dọn hoặc hàng đợi vừa khởi động lại). Hãy bấm tải lại.");
    }
    if (Date.now() > het) {
      throw new Error("File vẫn đang được tạo (quá lâu để chờ ở đây). Thử tải lại sau ít phút — việc vẫn đang chạy.");
    }
    await nghi(cho);
    cho = Math.min(cho * 1.4, 5_000);
  }
}

/**
 * Tải file báo giá. Trả về `true` nếu đã bắt đầu tải, `false` nếu người dùng nhận lỗi.
 * Mọi lỗi đều được báo bằng toast tại đây — nơi gọi không phải bắt lại.
 */
export async function xuatBaoGia(quoteId: number, ext: "xlsx" | "pdf"): Promise<boolean> {
  const khoa = `${quoteId}:${ext}`;
  if (dangChay.has(khoa)) {
    toast("Đang tạo file, vui lòng đợi — bấm thêm không làm nhanh hơn", "info");
    return false;
  }
  dangChay.add(khoa);
  try {
    return await chay(quoteId, ext);
  } finally {
    dangChay.delete(khoa);
  }
}

async function chay(quoteId: number, ext: "xlsx" | "pdf"): Promise<boolean> {
  const duPhong = `BaoGia_${quoteId}.${ext}`;
  let res: Response;
  // Đường đồng bộ vẫn có thể mất ~8 giây ở báo giá 20.000 dòng. Im lặng suốt quãng đó là hồi quy so
  // với `window.open` (trình duyệt tự hiện chỉ báo tải). Báo sau 1,2 giây — đủ lâu để báo giá thường
  // (dưới một giây) không nháy một lời nhắn vô ích.
  const huyBao = bao(() => toast("Đang tạo file, vui lòng đợi…", "info"), 1200);
  try {
    res = await fetch(`/api/export/${quoteId}.${ext}?t=${Date.now()}`, { credentials: "include" });
  } catch {
    toast("Không kết nối được máy chủ để tải file", "error");
    return false;
  } finally {
    huyBao();
  }

  // ĐƯỜNG THƯỜNG NGÀY — báo giá vừa, server trả file luôn.
  if (res.ok) {
    // 200 KHÔNG bảo đảm đó là file. Một lớp hạ tầng đứng trước (nginx, Cloudflare, trang đăng nhập
    // của SSO, hay chính SPA fallback trả index.html cho mọi đường dẫn không khớp) đều trả 200 kèm
    // HTML. Không kiểm thì ta lưu nguyên trang HTML đó thành .xlsx và người dùng nhận một file
    // "hỏng" mà không có manh mối nào — Excel chỉ báo "không mở được".
    // Chỉ chặn HTML: đó là thứ DUY NHẤT xuất hiện ở tình huống này, và bắt hẹp thì không có nguy cơ
    // từ chối nhầm một Content-Type hợp lệ nào đó về sau.
    const kieu = res.headers.get("Content-Type") || "";
    if (/text\/html/i.test(kieu)) {
      toast("Máy chủ trả về một trang web thay vì file — nhiều khả năng phiên đã hết hạn hoặc có lớp proxy chắn ở giữa. Hãy tải lại trang rồi thử lại.", "error");
      return false;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    taiVe(url, tenTuHeader(res, duPhong));
    // Thu hồi SAU một nhịp: thu ngay thì có trình duyệt huỷ mất lượt tải vừa bấm.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return true;
  }

  if (res.status !== 413) {
    let msg = `Lỗi ${res.status}`;
    try { msg = (await res.json())?.error || msg; } catch { /* thân không phải JSON */ }
    // ── 401 PHẢI KÉO LỚP PHỦ ĐĂNG NHẬP LẠI ────────────────────────────────────
    // Đường này dùng `fetch` TRẦN chứ không qua `req()` của api.ts (vì cần đọc mã 413 và thân nhị
    // phân). Nhưng `req()` mới là nơi làm hai việc cho MỌI 401: dọn mã CSRF đã chết theo phiên, và
    // bắn `auth:expired` để App.tsx bật lớp phủ đăng nhập lại ĐÈ LÊN cây đang mount (xem
    // web/src/lib/api401.test.ts — lớp phủ đó tồn tại chính là để KHÔNG unmount QuoteEditor và
    // không làm mất báo giá đang soạn).
    // Đi vòng qua `req()` mà quên hai việc đó thì: người dùng bấm Tải sau khi phiên hết hạn chỉ
    // thấy "Chưa đăng nhập" rồi thôi — không có đường đăng nhập lại, và lần GHI kế tiếp còn ăn
    // thêm một 403 CSRF vì mã cũ vẫn nằm trong biến module.
    if (res.status === 401) {
      resetCsrfToken();
      window.dispatchEvent(new Event("auth:expired"));
    }
    toast(msg, "error");
    return false;
  }

  // ── 413: BÁO GIÁ QUÁ LỚN CHO ĐƯỜNG ĐỒNG BỘ → XUẤT NỀN ─────────────────────
  // ── CHẾ ĐỘ XEM THỬ CHẶN MỌI LỆNH GHI ─────────────────────────────────────
  // `req()` trong api.ts có nhánh `if (__preview && method !== "GET")` TRẢ VỀ THÀNH CÔNG GIẢ và
  // KHÔNG gửi gì lên máy chủ. `api.exportAsync` là POST nên rơi đúng vào nhánh đó: nó trả
  // `{ ok: true, id: <số giả>, _preview: true, format }` — KHÔNG có `jobId`, KHÔNG có `queue`.
  //
  // ĐÃ TÁI HIỆN (không phải suy đoán): thiếu chốt này thì client đi hỏi
  // `GET /api/jobs/undefined/undefined`, máy chủ trả 404, và người dùng nhận đúng một dòng
  // "Không tìm thấy hàng đợi" — chẳng liên quan gì tới việc họ đang xem thử.
  //
  // Xếp việc vào hàng đợi LÀ một tác dụng phụ thật (tốn CPU worker, đẻ object trong kho), nên chế
  // độ xem thử chặn nó là ĐÚNG. Chỉ có lời nhắn là sai. Nói thẳng ra.
  if (isPreviewMode()) {
    toast("Xem thử: báo giá này quá lớn nên phải tạo file ở chế độ nền, mà chế độ xem thử không chạy lệnh ghi nào. Thoát xem thử rồi tải lại.", "error");
    return false;
  }

  toast("Báo giá lớn — đang tạo file ở chế độ nền, vui lòng đợi…", "info");
  try {
    const { jobId, queue } = await api.exportAsync(quoteId, ext);
    // Phòng thủ cho MỌI lý do khác làm phản hồi mất hình dạng (đổi API, proxy trả rỗng…). Thiếu
    // chốt này thì lỗi biến thành `GET /jobs/undefined/undefined` — một câu hỏi vô nghĩa gửi lên
    // máy chủ, rồi một lời nhắn vô nghĩa gửi về người dùng.
    if (!jobId || !queue) throw new Error("Máy chủ không trả về mã tác vụ — không theo dõi được lượt xuất này");
    const job = await choJob(queue, jobId);
    const url = job.returnvalue?.url;
    if (!url) throw new Error("Tạo file xong nhưng không nhận được đường tải — hãy báo quản trị viên");
    // `duPhong` ở đây gần như CHẮC CHẮN bị bỏ qua: URL đã ký trỏ vào kho object, tức KHÁC ORIGIN,
    // mà trình duyệt bỏ qua thuộc tính `download` khi khác origin. Tên file thật do header
    // Content-Disposition của kho quyết định — src/worker.ts nay truyền `filename` vào
    // `presignDownload` đúng theo công thức của đường đồng bộ, nên hai đường cho ra CÙNG một tên.
    // Vẫn đặt `download` vì nó vô hại và cứu được trường hợp kho chạy CÙNG origin (đứng sau proxy).
    taiVe(url, duPhong);
    toast("File đã sẵn sàng, đang tải về", "success");
    return true;
  } catch (ex) {
    // 503 + code export_async_unavailable = production chưa bật Redis / kho object. Đây KHÔNG phải
    // lỗi thao tác của người dùng, và họ không tự khắc phục được — nói rõ phải nhờ ai.
    // ── MỌI 503 Ở ĐÂY ĐỀU LÀ "XUẤT NỀN CHƯA DÙNG ĐƯỢC" ───────────────────────
    // KHÔNG chỉ bắt theo `code`. src/routes/jobs.routes.ts có HAI nhánh 503 (thiếu hàng đợi/Redis,
    // và thiếu kho object) — trước đợt này chỉ nhánh sau mang `code`, nên cùng một nguyên nhân lại
    // cho ra hai hành vi khác nhau ở đây. Nay cả hai đều có `code`, nhưng vẫn bắt theo MÃ TRẠNG
    // THÁI làm lưới an toàn: thêm một nhánh 503 thứ ba ở máy chủ mà quên `code` thì chỗ này vẫn nói
    // đúng chuyện, thay vì đổ ra một câu kỹ thuật mà người dùng không làm gì được.
    const loi = ex instanceof ApiError ? ex : null;
    const body = loi ? (loi.body as { code?: string } | null) : null;
    if (body?.code === "export_async_unavailable" || loi?.status === 503) {
      // Dùng NGUYÊN VĂN lời nhắn của máy chủ khi có: nó nói rõ thiếu HÀNG ĐỢI hay thiếu KHO, và
      // quản trị viên cần đúng chi tiết đó. Chỉ rơi về câu chung khi máy chủ không nói gì.
      const cuThe = loi?.message && /quản trị viên/.test(loi.message) ? loi.message : null;
      toast(cuThe || "Báo giá quá lớn để tải trực tiếp, mà chế độ nền chưa được bật trên máy chủ. Hãy nhờ quản trị viên bật, hoặc tách bớt sheet rồi tải lại.", "error");
      return false;
    }
    toast(ex instanceof Error ? ex.message : "Không tạo được file", "error");
    return false;
  }
}
