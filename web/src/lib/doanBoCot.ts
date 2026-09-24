// ============================================================================
// ĐOÁN BỐ CỤC CỘT CỦA KHỐI DÁN TỪ FILE EXCEL APP XUẤT RA (khi khối KHÔNG kèm hàng tiêu đề).
//
// Trước đây khối dán được hiểu theo bố cục của SHEET ĐÍCH (`ADDR`). Đúng khi nguồn và đích cùng
// mẫu, nhưng sai hẳn khi khác mẫu — đo trên dev 2026-09-23 với 129 dòng sheet "1. Banner" (CLF
// không ngày) dán vào sheet CÓ NGÀY:
//   · CLF có ngày: đơn giá 95.000 rơi vào Số Ngày, nhóm con thành hạng mục;
//   · GN có ngày: ". PP in KTS" rơi vào ĐVT, Số Lượng thành 2.
// Người dùng báo "paste bị lỗi cho cả colorfull và GN".
//
// Cách đoán: mỗi bố cục ứng viên được CHẤM bằng chính số liệu trong khối — hàng hạng mục nào có
// SL × Đơn Giá (× Số Ngày) ≈ Thành Tiền là một phiếu. Bố cục sai đọc ra chữ ở chỗ số, hoặc nhân
// ra số vô nghĩa, nên gần như không được phiếu nào. Hoà điểm thì GIỮ bố cục của sheet đích (đúng
// hành vi cũ), nên khối cùng mẫu đi đúng đường cũ.
//
// Cột thừa ở CUỐI khối (vd "HÌNH ẢNH" khi xuất có bật cột ảnh — chỉ là ảnh, chữ rỗng) không có
// vai trò trong bố cục nào nên bị bỏ qua.
// ============================================================================
import { parseLooseNumber } from "./clipboard";

/** Bố cục cột (từ cột STT) của các mẫu app xuất ra — xem `columns` trong src/templateConfigs.ts.
 *  GN không ngày (marico_decor) vẫn giữ cột D (gộp với tên), nên trùng bố cục Colorfull không ngày. */
export const BO_CUC_XUAT: string[][] = [
  ["_stt", "name", "detail", "unit", "quantity", "unitPrice", "_amount", "notes"],          // CLF / GN không ngày
  ["_stt", "name", "detail", "unit", "quantity", "days", "unitPrice", "_amount", "notes"],  // CLF có ngày
  ["_stt", "name", "unit", "quantity", "days", "unitPrice", "_amount", "notes"],            // GN có ngày
];

const so = (s: string | undefined): number | null => {
  const t = String(s ?? "").trim();
  if (!t || !/\d/.test(t) || /[A-Za-zÀ-ỹ]/.test(t)) return null;
  const n = parseLooseNumber(t);
  return Number.isFinite(n) ? n : null;
};

/** Số hàng của khối mà bố cục `roles` giải ra SL × ĐG (× Ngày) ≈ Thành Tiền.
 *
 *  Hàng mà bố cục đọc ra ĐVT là SỐ thì KHÔNG được phiếu — ĐVT thật không bao giờ là số ("người",
 *  "m2", "bộ"…), đọc ra "1" nghĩa là bố cục đang lệch một cột. Thiếu chốt này thì khối GN CÓ NGÀY
 *  mà mọi SL = 1 ("1 người × N ngày") hoà điểm với bố cục "không ngày" (Ngày đọc thành SL vẫn ra
 *  SL × ĐG = TT), bố cục đứng trước thắng → Chi Tiết "người", ĐVT "1", SL = số ngày (soát toàn diện L17). */
export function diemBoCot(rows: string[][], roles: string[]): number {
  const iq = roles.indexOf("quantity"), ip = roles.indexOf("unitPrice"), ia = roles.indexOf("_amount"), id = roles.indexOf("days");
  const iu = roles.indexOf("unit");
  if (iq < 0 || ip < 0 || ia < 0) return 0;
  let diem = 0;
  for (const r of rows) {
    const q = so(r[iq]), p = so(r[ip]), a = so(r[ia]);
    if (q == null || p == null || a == null || !a) continue;
    if (iu >= 0 && so(r[iu]) != null) continue;   // ĐVT đọc ra SỐ → bố cục lệch cột
    const d = id >= 0 ? so(r[id]) : null;
    if (id >= 0 && d == null && String(r[id] ?? "").trim() !== "") continue;   // ô Ngày có chữ → sai bố cục
    const ky = q * p * (d || 1);
    // Số Lượng hiển thị đã làm tròn (1 số lẻ) nên Thành Tiền có thể lệch vài phần trăm.
    if (Math.abs(ky - a) <= Math.max(1, Math.abs(a) * 0.03)) diem++;
  }
  return diem;
}

/** Chọn bố cục cho khối dán: bố cục của sheet đích nếu không thua bố cục nào, không thì bố cục
 *  ghi được nhiều phiếu nhất. */
export function doanBoCot(rows: string[][], rolesDich: string[]): string[] {
  let tot = rolesDich, diemTot = diemBoCot(rows, rolesDich);
  for (const bc of BO_CUC_XUAT) {
    const d = diemBoCot(rows, bc);
    if (d > diemTot) { tot = bc; diemTot = d; }
  }
  return tot;
}
