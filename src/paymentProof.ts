// Chứng từ thanh toán: từ base64-trong-CSDL sang kho object riêng tư.
//
// ── VÌ SAO PHẢI CHUYỂN ───────────────────────────────────────────────────────
// Ảnh lưu dưới dạng data-URL base64 ngay trong cột `PersonnelRecord.paymentProof` khiến:
//   • MỌI bản sao lưu CSDL cõng theo toàn bộ ảnh — dump phình lên, khôi phục chậm, và ảnh đi theo
//     mỗi bản dump được sao chép ra ngoài;
//   • đọc một hàng là kéo cả ảnh vào bộ nhớ tiến trình (base64 còn phình thêm 33% so với nhị phân);
//   • không cách nào đặt vòng đời/kiểm soát riêng cho ảnh như một tài nguyên độc lập.
//
// ── HỢP ĐỒNG GIAI ĐOẠN CHUYỂN TIẾP ───────────────────────────────────────────
// Ghi MỚI → luôn vào kho object. Đọc → ưu tiên object, thiếu thì rơi về cột base64 cũ. Cột cũ chỉ bị
// bỏ ở một migration RIÊNG sau khi đã xác minh 100% đã chuyển.
//
// ── PHÂN QUYỀN ───────────────────────────────────────────────────────────────
// Quyền tải ảnh bám vào BẢN GHI NGHIỆP VỤ (ai đọc được hồ sơ nhân sự thì đọc được chứng từ của nó),
// KHÔNG bám vào "ai là người đã tải lên". Kế toán tải ảnh lên, nhưng người có quyền xem hồ sơ cũng
// phải xem được — buộc theo người tải lên là sai mô hình nghiệp vụ. Chỗ gọi (personnelService) đã
// chạy `loadAuthorized(req, "read")` trước khi vào đây.

import { createHash, randomBytes } from "node:crypto";
import { putObject, deleteObject, isStorageEnabled, headObject, getObjectBytes } from "./storage.js";
import { httpError } from "./httpError.js";

const NAMESPACE = "payment-proofs";
export const MAX_PROOF_BYTES = 900_000; // khớp trần của validator (ảnh đã nén ở client)
const DATA_URL_RE = /^data:image\/(png|jpe?g|webp);base64,(.+)$/i;

// Chỉ nhận ảnh. Khác allowlist upload chung (không có PDF/XLSX) vì đây là ảnh chụp chứng từ.
const IMAGE_SNIFF: Array<{ mime: string; ext: string; test: (b: Buffer) => boolean }> = [
  { mime: "image/png", ext: ".png", test: (b) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { mime: "image/jpeg", ext: ".jpg", test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: "image/webp", ext: ".webp", test: (b) => b.length > 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP" },
];

export type ProofMeta = {
  paymentProofKey: string;
  paymentProofMime: string;
  paymentProofSize: number;
  paymentProofSha256: string;
  paymentProofUploadedAt: Date;
};

/** Tách data-URL base64 → buffer nhị phân. Trả null nếu không phải data-URL ảnh. */
export function decodeDataUrl(dataUrl: string): Buffer | null {
  const m = String(dataUrl).trim().match(DATA_URL_RE);
  if (!m) return null;
  try {
    const buf = Buffer.from(m[2], "base64");
    return buf.length ? buf : null;
  } catch {
    return null;
  }
}

/** Nhận dạng kiểu THẬT bằng magic bytes — không tin nhãn trong data-URL. */
export function sniffImage(buf: Buffer) {
  return IMAGE_SNIFF.find((s) => s.test(buf)) ?? null;
}

export const sha256 = (buf: Buffer) => createHash("sha256").update(buf).digest("hex");

/**
 * Cất ảnh chứng từ vào kho object, trả siêu dữ liệu để ghi vào CSDL.
 *
 * Key do SERVER sinh, gồm id hồ sơ + ngẫu nhiên — client không đặt được, và không nằm chung namespace
 * với logo công ty (thứ mà mọi người đọc được).
 */
export async function storeProof(recordId: number, dataUrl: string): Promise<ProofMeta> {
  if (!isStorageEnabled()) throw httpError(503, "Chưa cấu hình lưu trữ tệp");
  const buf = decodeDataUrl(dataUrl);
  if (!buf) throw httpError(415, "Ảnh chứng từ không hợp lệ");
  if (buf.length > MAX_PROOF_BYTES) throw httpError(413, "Ảnh chứng từ quá lớn");
  const kind = sniffImage(buf);
  if (!kind) throw httpError(415, "Nội dung không phải ảnh PNG/JPG/WEBP");

  const key = `${NAMESPACE}/p${recordId}/${Date.now()}-${randomBytes(6).toString("hex")}${kind.ext}`;
  await putObject({
    key,
    body: buf,
    contentType: kind.mime,
    contentDisposition: "attachment", // không bao giờ render inline
    metadata: { recordId: String(recordId) },
  });
  // Đọc lại để chắc chắn kho đã nhận đủ — ghi siêu dữ liệu vào CSDL rồi mới phát hiện thiếu byte thì
  // hàng đó thành trỏ-vào-hư-không mà không ai biết.
  const head = await headObject(key);
  if (!head || head.size !== buf.length) {
    await deleteObject(key).catch(() => {});
    throw httpError(502, "Lưu ảnh chứng từ thất bại, vui lòng thử lại");
  }
  return {
    paymentProofKey: key,
    paymentProofMime: kind.mime,
    paymentProofSize: buf.length,
    paymentProofSha256: sha256(buf),
    paymentProofUploadedAt: new Date(),
  };
}

/** Xoá ảnh khỏi kho (bỏ đánh dấu thanh toán). Best-effort — CSDL là nguồn sự thật. */
export async function removeProof(key: string | null | undefined) {
  if (key) await deleteObject(key).catch(() => {});
}

/**
 * ĐỌC SONG SONG: trả data-URL để client hiển thị, bất kể ảnh nằm ở kho object hay còn ở cột base64 cũ.
 * Giữ nguyên hợp đồng API (`{ paymentProof: "data:image/…" }`) nên frontend không phải đổi gì.
 */
export async function readProofDataUrl(rec: {
  paymentProofKey?: string | null;
  paymentProofMime?: string | null;
  paymentProof?: string | null;
}): Promise<string | null> {
  if (rec.paymentProofKey) {
    const buf = await getObjectBytes(rec.paymentProofKey, MAX_PROOF_BYTES * 2);
    if (!buf) throw httpError(502, "Không đọc được ảnh chứng từ từ kho lưu trữ");
    return `data:${rec.paymentProofMime || "image/png"};base64,${buf.toString("base64")}`;
  }
  return rec.paymentProof ?? null; // bản ghi chưa chuyển
}
