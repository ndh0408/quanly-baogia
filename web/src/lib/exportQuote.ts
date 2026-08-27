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
import { api, ApiError } from "./api";
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
  a.remove();
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
  const duPhong = `BaoGia_${quoteId}.${ext}`;
  let res: Response;
  try {
    res = await fetch(`/api/export/${quoteId}.${ext}?t=${Date.now()}`, { credentials: "include" });
  } catch {
    toast("Không kết nối được máy chủ để tải file", "error");
    return false;
  }

  // ĐƯỜNG THƯỜNG NGÀY — báo giá vừa, server trả file luôn.
  if (res.ok) {
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
    toast(msg, "error");
    return false;
  }

  // ── 413: BÁO GIÁ QUÁ LỚN CHO ĐƯỜNG ĐỒNG BỘ → XUẤT NỀN ─────────────────────
  toast("Báo giá lớn — đang tạo file ở chế độ nền, vui lòng đợi…", "info");
  try {
    const { jobId, queue } = await api.exportAsync(quoteId, ext);
    const job = await choJob(queue, jobId);
    const url = job.returnvalue?.url;
    if (!url) throw new Error("Tạo file xong nhưng không nhận được đường tải — hãy báo quản trị viên");
    taiVe(url, duPhong);
    toast("File đã sẵn sàng, đang tải về", "success");
    return true;
  } catch (ex) {
    // 503 + code export_async_unavailable = production chưa bật Redis / kho object. Đây KHÔNG phải
    // lỗi thao tác của người dùng, và họ không tự khắc phục được — nói rõ phải nhờ ai.
    const body = ex instanceof ApiError ? (ex.body as { code?: string } | null) : null;
    if (body?.code === "export_async_unavailable") {
      toast("Báo giá quá lớn để tải trực tiếp, mà chế độ nền chưa được bật trên máy chủ. Hãy nhờ quản trị viên bật, hoặc tách bớt sheet rồi tải lại.", "error");
      return false;
    }
    toast(ex instanceof Error ? ex.message : "Không tạo được file", "error");
    return false;
  }
}
