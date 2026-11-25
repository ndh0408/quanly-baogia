// Dọn mã dự án cũ về luật "mã chỉ cấp lúc khách chốt" (chủ repo 2026-11-25) — xem src/maDuAnDonDep.ts.
// Runbook: docs/operations/DON_MA_DU_AN.md (BACKUP TRƯỚC, gửi bảng --kiem cho chủ repo, rồi mới --ap-dung).
//
//   node dist/tools/donMaDuAn.js             # = --kiem (mặc định): CHỈ ĐỌC, in bảng đầy đủ mã cũ → mã mới / → NHÁP
//   node dist/tools/donMaDuAn.js --kiem      # như trên; thoát 1 nếu còn việc phải làm, 0 nếu dữ liệu đã sạch
//   node dist/tools/donMaDuAn.js --ap-dung   # GHI THẬT trong MỘT transaction (sau khi đã pg_dump), in lại bảng kết quả,
//                                            # rồi tự soát: lập lại kế hoạch phải KHÔNG còn việc gì (idempotent)
//   ... --chi-nguoi-tao 12,15                # thêm vào lệnh trên: chỉ báo giá do user 12, 15 tạo (+ tiền tố của họ)
//
// Chạy được TỪ TRONG image production (đã biên dịch vào dist/). Không phải migration: deploy không tự chạy nó.
import { prisma } from "../db.js";
import { keHoachMaDuAn, apDungMaDuAn, coViec, inKeHoach } from "../maDuAnDonDep.js";

const thamSo = process.argv.slice(2);
const co = (ten: string) => thamSo.includes(ten);
const viTriPv = thamSo.indexOf("--chi-nguoi-tao");
const phamVi = viTriPv >= 0
  ? { chiNguoiTao: String(thamSo[viTriPv + 1] ?? "").split(",").map((x) => Number(x.trim())).filter((n) => Number.isInteger(n) && n > 0) }
  : {};

let ma = 0;
try {
  const la = thamSo.filter((t, i) => !["--kiem", "--ap-dung", "--chi-nguoi-tao"].includes(t) && !(viTriPv >= 0 && i === viTriPv + 1));
  if (la.length) throw new Error(`tham số lạ: ${la.join(" ")} (chỉ có --kiem | --ap-dung [--chi-nguoi-tao id,id])`);
  if (viTriPv >= 0 && !phamVi.chiNguoiTao?.length) throw new Error("--chi-nguoi-tao cần danh sách id người dùng, cách nhau bằng dấu phẩy");
  if (co("--kiem") && co("--ap-dung")) throw new Error("chọn MỘT: --kiem hoặc --ap-dung");
  if (co("--ap-dung")) {
    const kh = await apDungMaDuAn(phamVi);
    console.log("=== ĐÃ ÁP DỤNG (một transaction) ===");
    for (const d of inKeHoach(kh)) console.log(d);
    const lai = await keHoachMaDuAn(undefined, phamVi);
    if (coViec(lai)) {
      console.log("\n✗ SOÁT LẠI: vẫn còn việc sau khi áp dụng — dừng lại, xem bảng dưới, KHÔNG chạy lại mù quáng:");
      for (const d of inKeHoach(lai)) console.log(d);
      ma = 1;
    } else {
      console.log("\n✓ soát lại: không còn việc gì — chạy lại sẽ không đổi gì.");
    }
  } else {
    const kh = await keHoachMaDuAn(undefined, phamVi);
    console.log("=== KIỂM (chỉ đọc — chưa ghi gì) ===");
    for (const d of inKeHoach(kh)) console.log(d);
    if (coViec(kh)) {
      console.log("\n(chế độ kiểm) còn việc. Gửi bảng này cho chủ repo duyệt; sau khi pg_dump thì chạy --ap-dung.");
      ma = 1;
    } else {
      console.log("\n✓ sạch: không còn mã nào phải gỡ / đánh lại.");
    }
  }
} catch (e) {
  console.error(`✗ lỗi: ${e instanceof Error ? e.message : String(e)}`);
  ma = 2;
}
await prisma.$disconnect().catch(() => {});
// THOÁT TƯỜNG MINH (cùng lý do src/tools/backfillKhoanChi.ts): kết nối Redis của tầng realtime giữ vòng sự kiện sống.
process.exit(ma);
