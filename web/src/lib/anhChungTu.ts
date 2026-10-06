// ẢNH CHỨNG TỪ (ủy nhiệm chi) — nén ở trình duyệt trước khi gửi lên.
//
// Máy chủ nhận tối đa 900.000 ký tự data-URL cho MỘT ảnh (src/validators.ts KhoanChiSchema · MAX_PROOF_BYTES ở
// src/paymentProof.ts) rồi còn giải base64 + soát magic bytes. Ảnh chụp điện thoại thô vài MB nên phải nén: thử
// ≤1280px JPEG 0.7 trước; còn vượt trần thì nén lại ≤1024px JPEG 0.5; vẫn vượt thì báo rõ và KHÔNG gửi — thà người
// dùng chụp lại còn hơn nhận một lỗi 400 chung chung từ máy chủ.
//
// Tách khỏi web/src/components/ExtraTables.tsx (2026-10-06) khi ô thanh toán rời màn soạn sang trang Hóa đơn đầu vào.
// (Bản trong web/src/pages/Personnel.tsx giữ nguyên — gộp ở đợt sau.)

/** Trần độ dài data-URL máy chủ chấp nhận cho một ảnh chứng từ. */
export const TRAN_ANH_KY_TU = 900_000;

/** Câu báo khi trình duyệt không đọc / không giải được tệp (HEIC trên máy không hỗ trợ, tệp hỏng, đổi đuôi…). */
export const LOI_DOC_ANH = "Ảnh không đọc được — chọn ảnh PNG / JPG / WEBP khác.";

/**
 * Nén một ảnh về data-URL JPEG, cạnh dài ≤ `maxDim`. Mọi đường hỏng đều reject bằng `Error` có câu tiếng Việt — KHÔNG bao
 * giờ bằng `Event` thô của FileReader / <img> (nơi gọi toast `ex.message`; một Event thì không có message).
 */
export function nenAnh(file: File, maxDim = 1280, quality = 0.7): Promise<string> {
  return new Promise((resolve, reject) => {
    const hong = () => reject(new Error(LOI_DOC_ANH));
    const r = new FileReader();
    r.onload = () => {
      const im = new Image();
      im.onload = () => {
        let { width: w, height: h } = im;
        if (!w || !h) return hong();
        if (w > maxDim || h > maxDim) { const s = maxDim / Math.max(w, h); w = Math.round(w * s); h = Math.round(h * s); }
        const c = document.createElement("canvas"); c.width = w; c.height = h;
        const ctx = c.getContext("2d"); if (!ctx) return reject(new Error("Trình duyệt không vẽ được ảnh để nén — thử trình duyệt khác."));
        ctx.drawImage(im, 0, 0, w, h);
        resolve(c.toDataURL("image/jpeg", quality));
      };
      im.onerror = hong; im.src = String(r.result);
    };
    r.onerror = hong; r.readAsDataURL(file);
  });
}

/**
 * Nén ảnh chứng từ cho vừa trần máy chủ: 1280px / 0.7, không vừa thì 1024px / 0.5. Vẫn không vừa → ném Error kèm câu
 * tiếng Việt để nơi gọi toast nguyên văn.
 */
export async function compressImage(file: File): Promise<string> {
  const lan1 = await nenAnh(file, 1280, 0.7);
  if (lan1.length <= TRAN_ANH_KY_TU) return lan1;
  const lan2 = await nenAnh(file, 1024, 0.5);
  if (lan2.length <= TRAN_ANH_KY_TU) return lan2;
  throw new Error("Ảnh quá lớn kể cả sau khi nén — hãy chụp lại gần hơn / cắt bớt rồi chọn lại.");
}
