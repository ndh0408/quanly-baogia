// Chép cờ "đã trả" + ảnh chứng từ CŨ trong JSON hàng bảng nội bộ sang bảng khoản chi của trang Hóa đơn đầu vào —
// xem src/khoanChiBackfill.ts. Chạy NGAY SAU deploy bản có migration 20261006090000_input_invoice_entries.
//
//   node dist/tools/backfillKhoanChi.js            # CHẾ ĐỘ KHÔ (mặc định): chỉ in kế hoạch + các chỗ lệch, không ghi
//   node dist/tools/backfillKhoanChi.js --ghi      # ghi thật (chỉ THÊM khoản; không đụng JSON) — sau khi đã pg_dump
//   node dist/tools/backfillKhoanChi.js --kiem     # chỉ soát: thoát ≠ 0 nếu còn hàng chưa chép / lệch / thiếu-trùng rid
//   node dist/tools/backfillKhoanChi.js --sua-rid  # CHUẨN HOÁ MÃ: hàng thiếu rid + bản sau của rid trùng nhận rid mới
//                                                  # (giữ nguyên cờ + ảnh; ghi JSON đúng trường rid) — sau khi đã pg_dump
//   node dist/tools/backfillKhoanChi.js --sua-rid --kho   # chỉ liệt kê những hàng --sua-rid sẽ đổi
//   node dist/tools/backfillKhoanChi.js --xac-nhan 12:sheet:abc,12:hn:def   # đánh dấu dòng 'lech-legacySeed' ĐÃ RÀ
//
// Chạy được TỪ TRONG image production (đã biên dịch vào dist/). Thoát 0 = xong (hoặc --kiem sạch).
import { prisma } from "../db.js";
import { keHoachKhoanChi, apDungKhoanChi, conViec, suaRidKhoanChi, xacNhanHatGiong } from "../khoanChiBackfill.js";

const thamSo = process.argv.slice(2);
const co = (ten: string) => thamSo.includes(ten);
const sauCo = (ten: string) => { const i = thamSo.indexOf(ten); return i >= 0 ? thamSo[i + 1] ?? "" : null; };

let ma = 0;
try {
  if (co("--sua-rid")) {
    const ghi = !co("--kho");
    const doi = await suaRidKhoanChi({ ghi });
    for (const d of doi) console.log(JSON.stringify({ loai: "sua-rid", ...d }));
    console.log(ghi
      ? `✓ đã chuẩn hoá ${doi.length} hàng (cờ + ảnh giữ nguyên). Chạy tiếp --ghi rồi --kiem.`
      : `(chế độ khô) ${doi.length} hàng sẽ nhận rid mới. Bỏ --kho để ghi thật — sau khi đã pg_dump.`);
  } else if (sauCo("--xac-nhan") !== null) {
    const khoa = String(sauCo("--xac-nhan")).split(",").map((x) => x.trim()).filter(Boolean);
    if (!khoa.length) { console.log("✗ --xac-nhan cần danh sách quoteId:side:rid, cách nhau bằng dấu phẩy"); ma = 2; }
    else {
      const kq = await xacNhanHatGiong(khoa);
      for (const b of kq.boQua) console.log(`  bỏ qua: ${b}`);
      console.log(`✓ đã xác nhận ${kq.daXacNhan}/${khoa.length} dòng. Chạy lại --kiem để soát.`);
      ma = kq.boQua.length ? 1 : 0;
    }
  } else {
    const ghi = co("--ghi");
    const kiem = co("--kiem");
    const kh = await keHoachKhoanChi();
    for (const d of kh.canChep) console.log(JSON.stringify({ loai: "can-chep", ...d }));
    for (const d of kh.thieuRid) console.log(JSON.stringify({ loai: "thieu-rid", ...d }));
    for (const d of kh.trungRid) console.log(JSON.stringify({ loai: "trung-rid", ...d }));
    for (const d of kh.lechHatGiong) console.log(JSON.stringify({ loai: "lech-legacySeed", ...d }));
    for (const d of kh.hanoiCuTrongTrang) console.log(JSON.stringify({ loai: "hanoi-cu-trong-trang", ...d }));
    const tomTat = `${kh.canChep.length} hàng cần chép · ${kh.thieuRid.length} thiếu rid · ${kh.trungRid.length} rid trùng · ` +
      `${kh.lechHatGiong.length} lệch legacySeed · ${kh.hanoiCuTrongTrang.length} bản HN cũ trong trang`;
    if (kiem) {
      console.log(conViec(kh) ? `✗ còn việc: ${tomTat}` : "✓ sạch: mọi dấu vết JSON cũ đã có khoản, không lệch, không thiếu/trùng rid.");
      ma = conViec(kh) ? 1 : 0;
    } else if (!ghi) {
      console.log(`(chế độ khô) ${tomTat}. Thêm --ghi để tạo khoản (chỉ thêm, không đụng JSON) — sau khi đã pg_dump.`);
    } else {
      const n = await apDungKhoanChi(kh);
      console.log(`✓ đã tạo ${n}/${kh.canChep.length} khoản từ cờ JSON cũ. Chạy lại với --kiem để soát.`);
    }
  }
} catch (e) {
  console.error(`✗ lỗi: ${e instanceof Error ? e.message : String(e)}`);
  ma = 1;
}
await prisma.$disconnect().catch(() => {});
// THOÁT TƯỜNG MINH: dịch vụ kế toán import src/sse.js (Redis pub/sub cho realtime) — kết nối đó giữ vòng sự kiện sống,
// nên đặt process.exitCode thôi thì lệnh không bao giờ tự kết thúc và bước runbook "--kiem phải thoát 0" treo mãi.
process.exit(ma);
