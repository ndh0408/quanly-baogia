// Xác minh TOÀN VẸN DỮ LIỆU sau khi khôi phục — chạy được TỪ TRONG image production.
//
// ── VÌ SAO FILE NÀY TỒN TẠI ─────────────────────────────────────────────────
// `restore-drill.sh` cần chứng minh hai điều sau mỗi lần khôi phục:
//   1. khoá `PII_ENC_KEY` đang giữ có GIẢI MÃ ĐƯỢC dữ liệu trong bản dump không;
//   2. ảnh chứng từ trong kho object có KHỚP SHA-256 lưu trong CSDL không.
//
// Ban đầu nó gọi `npm run pii:verify` / `npm run proof:verify` bên trong image production. Cách đó
// KHÔNG BAO GIỜ chạy được: hai script ấy nằm ở `scripts/migration/*.mjs`, import mã nguồn TypeScript
// (`../../src/piiBox.js`) và cần tsx — mà image production CHỈ chứa `dist/`, không có `scripts/`,
// không có `src/`, không có tsx. Kết quả sẽ là MODULE_NOT_FOUND mỗi tối Chủ nhật, hai bước quan
// trọng nhất của diễn tập luôn báo THẤT BẠI, `.drill-last-success` không bao giờ được ghi, và
// watchdog bắn cảnh báo "CHƯA TỪNG chạy thành công" mỗi 6 giờ, mãi mãi.
//
// Chỗ đúng của logic này là `src/` — nó là kiểm tra toàn vẹn dữ liệu của ứng dụng, không phải một
// script tiện ích cho máy dev. Nằm ở đây thì nó được BIÊN DỊCH VÀO `dist/` và đi theo image.
//
//   node dist/tools/verifyIntegrity.js            # kiểm cả hai
//   node dist/tools/verifyIntegrity.js --pii      # chỉ PII
//   node dist/tools/verifyIntegrity.js --proof    # chỉ chứng từ
//
// Thoát 0 = đạt. Thoát 1 = có thứ không khôi phục được.
// KHÔNG in ra giá trị PII nào — chỉ đếm.
import { prisma } from "../db.js";
import { PII_FIELDS } from "../piiFields.js";
import { moTheoKhoa, dangXoayKhoa, isPiiEncrypted, isPiiEncryptionEnabled } from "../piiBox.js";
import { getObjectBytes, isStorageEnabled } from "../storage.js";
import { sha256, MAX_PROOF_BYTES, decodeDataUrl } from "../paymentProof.js";

const aadFor = (model: string, field: string) => `${model}:${field}`;
const modelClient = (m: string) => (prisma as any)[m.charAt(0).toLowerCase() + m.slice(1)];

type Ket = { ten: string; dat: boolean; chiTiet: string };

/** Giải mã lại toàn bộ PII và đối chiếu với cột thô còn lại. */
async function kiemPii(): Promise<Ket> {
  if (!isPiiEncryptionEnabled()) {
    return {
      ten: "PII",
      dat: false,
      chiTiet:
        "PII_ENC_KEY chưa đặt — KHÔNG kiểm được. Nếu bản dump có dữ liệu đã mã hoá thì hiện không ai " +
        "biết khoá đang giữ có mở được nó hay không, cho tới đúng lúc cần khôi phục thật.",
    };
  }

  let rows = 0, checked = 0, mismatch = 0, undecryptable = 0, conKhoaCu = 0;
  for (const [model, fields] of Object.entries(PII_FIELDS)) {
    const client = modelClient(model);
    if (!client) continue;
    const select = Object.fromEntries([
      ["id", true],
      ...fields.flatMap((f) => [[f.plain, true], [f.enc, true]]),
    ]);
    // `includeDeleted: true` — BẮT BUỘC, y như src/tools/piiRotate.ts:84.
    //
    // `prisma` ở src/db.ts được mở rộng: PersonnelRecord và Employee đều nằm trong
    // SOFT_DELETE_MODELS, nên mọi `findMany` tự bị chèn `where.deletedAt = null`. Không có cờ này
    // thì bước kiểm BỎ QUA toàn bộ hồ sơ đã xoá mềm — trong khi piiRotate CỐ Ý mã lại đúng những
    // hàng đó, vì chúng vẫn còn nguyên idCardEnc/bankAccountEnc/salaryEnc trong CSDL.
    //
    // Hậu quả nếu thiếu: người vận hành xoay khoá theo docs/operations/DISASTER_RECOVERY.md; lượt
    // rotate đứt giữa chừng để sót mấy hàng xoá mềm; bước kiểm này chỉ đếm hàng còn sống nên in ✓
    // và thoát 0; runbook (và chính piiRotate.ts:147) lấy đúng dấu ✓ đó làm điều kiện HUỶ KHOÁ CŨ.
    // Khoá cũ mất đi thì CCCD / số tài khoản / lương của các hồ sơ ấy không bao giờ giải lại được.
    // Đây là bằng chứng GIẢ ở đúng chỗ mà khối chú thích ngay dưới đang lo phòng.
    //
    // Bản mà file này thay thế — scripts/migration/pii-backfill.mjs --verify — dùng PrismaClient
    // THÔ nên vẫn quét hàng xoá mềm; thiếu cờ này là phủ HẸP HƠN thứ nó thay.
    const list = await client.findMany({ where: { piiVersion: { gt: 0 } }, select, includeDeleted: true } as never);
    rows += list.length;
    for (const r of list) {
      for (const f of fields) {
        const enc = r[f.enc];
        if (!isPiiEncrypted(enc)) continue;
        checked++;
        // KHÔNG dùng decryptPii ở đây. Nó cố ý rơi về PII_ENC_KEY_OLD, nên nếu dùng, bước kiểm này
        // báo "tất cả đọc được" kể cả khi KHÔNG MỘT HÀNG NÀO được mã lại bằng khoá mới — tức bằng
        // chứng GIẢ, ở đúng chỗ nguy hiểm nhất: diễn tập khôi phục hằng tuần là thứ người vận hành
        // tin để quyết định gỡ khoá cũ, mà gỡ sớm là mất dữ liệu vĩnh viễn.
        const { giaTri: got, khoa } = moTheoKhoa(String(enc), aadFor(model, f.plain));
        if (got == null) { undecryptable++; continue; }
        if (khoa === "cu") conKhoaCu++;
        // So SÁNH TRONG BỘ NHỚ, không in ra. Chỉ đếm.
        const want = r[f.plain] == null ? null : String(r[f.plain]);
        if (want != null && got !== want) mismatch++;
      }
    }
  }

  // Còn hàng nằm ở khoá cũ KHÔNG phải lỗi trong lúc cửa sổ xoay còn mở — đó là trạng thái mong đợi.
  // Nhưng nó PHẢI hiện ra, và phải là ĐỎ khi không hề đang xoay khoá (nghĩa là dữ liệu chỉ đọc được
  // nhờ một khoá mà cấu hình không còn khai — quả bom hẹn giờ).
  const dangXoay = dangXoayKhoa();
  const dat = undecryptable === 0 && mismatch === 0 && (conKhoaCu === 0 || dangXoay);
  const ghiChu = conKhoaCu > 0
    ? ` · ${conKhoaCu} trường CÒN Ở KHOÁ CŨ — chạy pii-backfill.mjs --rotate TRƯỚC KHI gỡ PII_ENC_KEY_OLD`
    : "";
  return {
    ten: "PII",
    dat,
    chiTiet: `${rows} hàng · ${checked} trường mã hoá · ${undecryptable} KHÔNG giải mã được · ${mismatch} lệch${ghiChu}`,
  };
}

/** Tải object chứng từ về và đối chiếu SHA-256 với hash lưu trong CSDL. */
async function kiemChungTu(): Promise<Ket> {
  if (!isStorageEnabled()) {
    return {
      ten: "Chứng từ",
      dat: false,
      chiTiet: "S3_* chưa cấu hình — KHÔNG kiểm được. Hàng chứng từ có thể đang trỏ vào object không tồn tại.",
    };
  }

  const rows = await prisma.personnelRecord.findMany({
    where: { paymentProofKey: { not: null }, deletedAt: null },
    select: { id: true, paymentProof: true, paymentProofKey: true, paymentProofSha256: true },
  });

  let ok = 0, missing = 0, hashMismatch = 0, noHash = 0;
  for (const r of rows) {
    const buf = await getObjectBytes(r.paymentProofKey as string, MAX_PROOF_BYTES * 2);
    if (!buf) { missing++; continue; }
    if (!r.paymentProofSha256) {
      // Hàng chuyển từ thời chưa lưu hash: đối chiếu với cột base64 cũ nếu còn.
      const orig = r.paymentProof ? decodeDataUrl(r.paymentProof) : null;
      if (orig && sha256(orig) === sha256(buf)) ok++;
      else noHash++;
      continue;
    }
    if (sha256(buf) !== r.paymentProofSha256) { hashMismatch++; continue; }
    ok++;
  }

  const dat = missing === 0 && hashMismatch === 0;
  return {
    ten: "Chứng từ",
    dat,
    chiTiet: `${rows.length} hàng · ${ok} khớp · ${missing} THIẾU object · ${hashMismatch} SAI hash · ${noHash} không đối chiếu được`,
  };
}

const args = process.argv.slice(2);
const chiPii = args.includes("--pii");
const chiProof = args.includes("--proof");
const chayCa = !chiPii && !chiProof;

const ketQua: Ket[] = [];
if (chayCa || chiPii) ketQua.push(await kiemPii());
if (chayCa || chiProof) ketQua.push(await kiemChungTu());

for (const k of ketQua) {
  console.log(`${k.dat ? "✓" : "✖"} ${k.ten}: ${k.chiTiet}`);
}

await prisma.$disconnect().catch(() => {});
process.exit(ketQua.every((k) => k.dat) ? 0 : 1);
