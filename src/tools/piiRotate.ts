// XOAY KHOÁ PII — chạy được TỪ TRONG image production.
//
// ── VÌ SAO FILE NÀY TỒN TẠI ─────────────────────────────────────────────────
// `docs/operations/DISASTER_RECOVERY.md` § xoay khoá bảo người vận hành chạy
//     node --import tsx scripts/migration/pii-backfill.mjs --rotate
// Lệnh đó KHÔNG BAO GIỜ chạy được ở nơi duy nhất mà runbook tồn tại để phục vụ: tầng runtime của
// Dockerfile chỉ COPY `node_modules`, `prisma`, `package.json`, `dist`, `public`, `templates` —
// KHÔNG có `scripts/`, KHÔNG có `src/`, và tsx là devDependency. Kết quả là MODULE_NOT_FOUND.
//
// Đây ĐÚNG là lỗi mà `src/tools/verifyIntegrity.ts` đã mô tả và đã được sửa một lần cho diễn tập
// khôi phục — rồi lặp lại nguyên vẹn ở runbook xoay khoá. Kịch bản thật: nghi lộ khoá lúc 2 giờ
// sáng, người vận hành mở runbook, gõ lệnh bước 2, nhận MODULE_NOT_FOUND, và tài liệu không có
// bước dự phòng nào.
//
//   node dist/tools/piiRotate.js              # xoay thật
//   node dist/tools/piiRotate.js --dry-run    # chỉ đếm, không ghi
//   node dist/tools/piiRotate.js --batch=500  # cỡ lô (mặc định 200)
//
// Bước CHỨNG MINH đi kèm đã có sẵn trong image: `node dist/tools/verifyIntegrity.js --pii`.
//
// Thoát 0 = xong. Thoát 1 = còn bản ghi không giải được bằng CẢ HAI khoá → ĐỪNG huỷ khoá cũ.
// KHÔNG in ra giá trị PII nào — chỉ đếm.
import { prisma } from "../db.js";
import { PII_FIELDS } from "../piiFields.js";
import { moTheoKhoa, encryptPii, blindIndex, isPiiEncrypted, isPiiEncryptionEnabled } from "../piiBox.js";

const aadFor = (model: string, field: string) => `${model}:${field}`;
const modelClient = (m: string) => (prisma as any)[m.charAt(0).toLowerCase() + m.slice(1)];

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const BATCH = Number(args.find((a) => a.startsWith("--batch="))?.split("=")[1]) || 200;

function chotDauVao() {
  if (!isPiiEncryptionEnabled()) {
    console.error("✖ Chưa đặt PII_ENC_KEY — không có khoá MỚI để mã lại bằng.");
    process.exit(1);
  }
  const cu = process.env.PII_ENC_KEY_OLD || "";
  // Thiếu khoá cũ thì mọi bản mã cũ giải ra null và script sẽ đếm là "hỏng hàng loạt". Chặn ngay
  // rõ ràng hơn nhiều so với để nó chạy mười phút rồi báo "0 xoay được".
  if (!cu) {
    console.error("✖ Cần PII_ENC_KEY_OLD (khoá CŨ) bên cạnh PII_ENC_KEY (khoá MỚI).");
    console.error("  Xem docs/operations/DISASTER_RECOVERY.md § Xoay khoá mã hoá PII.");
    process.exit(1);
  }
  if (cu === process.env.PII_ENC_KEY) {
    console.error("✖ PII_ENC_KEY_OLD trùng PII_ENC_KEY — không có gì để xoay.");
    process.exit(1);
  }
}

async function xoayModel(model: string, fields: any[]) {
  const client = modelClient(model);
  if (!client) return { model, total: 0, xoay: 0, hong: 0, daDoi: 0 };

  const total = await client.count({ where: { piiVersion: { gt: 0 } } });
  console.log(`\n── ${model}: ${total} bản ghi đã mã hoá`);
  if (DRY) return { model, total, xoay: 0, hong: 0, daDoi: 0 };

  const select = Object.fromEntries([["id", true], ...fields.map((f) => [f.enc, true])]);
  let xoay = 0, hong = 0, daDoi = 0, cursor = 0;

  for (;;) {
    // Phân trang bằng CON TRỎ id, không bằng `skip`: hàng đã xoay vẫn khớp `piiVersion > 0` nên
    // `skip` sẽ đứng yên tại chỗ và lặp vô tận.
    const batch = await client.findMany({
      where: { piiVersion: { gt: 0 }, id: { gt: cursor } },
      select,
      orderBy: { id: "asc" },
      take: BATCH,
    });
    if (!batch.length) break;

    for (const row of batch) {
      cursor = row.id;
      const data: Record<string, any> = {};
      let loi = false;

      for (const f of fields) {
        const enc = row[f.enc];
        if (!isPiiEncrypted(enc)) continue;   // cột rỗng → không có gì để xoay
        const { giaTri } = moTheoKhoa(String(enc), aadFor(model, f.plain));
        if (giaTri == null) { loi = true; break; }
        data[f.enc] = encryptPii(giaTri, aadFor(model, f.plain));
        if (f.idx) data[f.idx] = blindIndex(giaTri);
      }

      // FAIL-CLOSED: một trường không giải được thì BỎ QUA CẢ HÀNG. Ghi phần đã xoay được sẽ để
      // lại bản ghi nửa khoá cũ nửa khoá mới — không cách nào sửa sau khi khoá cũ bị huỷ.
      if (loi) { hong++; continue; }
      if (!Object.keys(data).length) continue;

      // GHI CÓ ĐIỀU KIỆN (compare-and-set), KHÔNG ghi mù. Ứng dụng VẪN ĐANG PHỤC VỤ trong lúc
      // xoay — đó là cả điểm của việc có cửa sổ hai khoá. Nếu ai đó sửa hồ sơ giữa lúc ta đọc lô
      // và lúc ta ghi lại, `update({ where: { id } })` sẽ ghi đè bản mã MỚI của họ bằng giá trị
      // CŨ vừa mã lại — và vì `decodePiiOnRead` ưu tiên cột *Enc hơn cột thô, API trả GIÁ TRỊ CŨ
      // mãi mãi sau đó (số tài khoản cũ → chuyển lương sai chỗ).
      //
      // Bản mã cũ nằm trong WHERE làm việc ghi thành nguyên tử. `count === 0` = hàng đã đổi giữa
      // chừng; hàng đó đã mang khoá MỚI rồi (encodePiiForWrite luôn dùng khoá hiện tại) nên bỏ
      // qua là ĐÚNG, không phải lỗi.
      const dieuKien: Record<string, any> = { id: row.id };
      for (const f of fields) if (isPiiEncrypted(row[f.enc])) dieuKien[f.enc] = row[f.enc];
      const kq = await client.updateMany({ where: dieuKien, data });
      if (kq.count === 0) { daDoi++; continue; }
      xoay++;
    }
    process.stdout.write(`   … ${xoay}\r`);
  }

  const themVao = daDoi ? ` · ${daDoi} bị ứng dụng ghi đè giữa chừng (đã mang khoá mới — bỏ qua đúng)` : "";
  console.log(`   xoay ${xoay} · KHÔNG giải mã được ${hong}${themVao}`);
  return { model, total, xoay, hong, daDoi };
}

async function main() {
  chotDauVao();
  console.log(DRY ? "XOAY KHOÁ PII — CHẠY THỬ (không ghi gì)" : "XOAY KHOÁ PII");

  let hong = 0;
  for (const [model, fields] of Object.entries(PII_FIELDS)) {
    const r = await xoayModel(model, fields as any[]);
    hong += r.hong;
  }

  if (hong > 0) {
    console.error(`\n✖ CÒN ${hong} bản ghi KHÔNG giải được bằng cả hai khoá. ĐỪNG huỷ khoá cũ.`);
    console.error("  Điều tra trước: sai khoá cũ? dữ liệu hỏng? khôi phục từ bản sao lưu nào?");
  } else if (!DRY) {
    console.log("\n✓ Xoay xong. Bước tiếp theo — CHỨNG MINH khoá mới tự đứng được:");
    console.log("    1. GỠ PII_ENC_KEY_OLD khỏi môi trường (không gỡ thì bước kiểm sẽ báo đạt sai sự thật)");
    console.log("    2. node dist/tools/verifyIntegrity.js --pii");
    console.log("    3. CHỈ KHI bước 2 báo ✓ mới huỷ khoá cũ khỏi kho bí mật.");
  }

  await prisma.$disconnect();
  process.exit(hong > 0 ? 1 : 0);
}

void main();
