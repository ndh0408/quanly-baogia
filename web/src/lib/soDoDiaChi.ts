// SƠ ĐỒ ĐỊA CHỈ Ô A1 của lưới báo giá (GridTable) — cột nào mang chữ cái nào.
//
// Tách khỏi GridTable (2026-10-07) vì khối tổng của màn soạn (components/CongThucTong.tsx) cũng phải viết công thức
// bằng ĐÚNG địa chỉ ô mà thanh fx của lưới đang dùng ("=SUM(G3:G9)+G12"). Hai bản chép tay của sơ đồ này sẽ trôi
// khỏi nhau ngay lần đầu ai đó thêm một cột — và khi đó khối tổng tô sáng sai cột mà không bài kiểm nào đỏ.
import { groupLetter } from "./quoteMath";

export type CotDiaChi = { f: string; ro?: boolean; L: string };
export type CauHinhDiaChi = {
  /** Mẫu TỪNG có cột Chi Tiết (nay ẩn) → vẫn chừa 1 chữ cái cho nó (GridTable prop `addrDetail ?? showDetail`). */
  giuChiTiet: boolean;
  usesDays: boolean;
  internalNote: boolean;
  cotNoiBo?: boolean;
};

export function soDoDiaChi({ giuChiTiet, usesDays, internalNote, cotNoiBo }: CauHinhDiaChi): CotDiaChi[] {
  const cot: { f: string; ro?: boolean }[] = [
    { f: "_stt", ro: true }, { f: "name" },
    // Cột Chi Tiết dù ĐÃ ẨN vẫn giữ chỗ trong sơ đồ địa chỉ (giuChiTiet) → công thức cũ
    // "=F3*E3" của báo giá đã lưu vẫn trỏ đúng Đơn giá × Số lượng.
    ...(giuChiTiet ? [{ f: "detail" }] : []),
    { f: "unit" }, { f: "quantity" },
    ...(usesDays ? [{ f: "days" }] : []),
    { f: "unitPrice" }, { f: "_amount", ro: true }, { f: "notes" },
    ...(internalNote ? [{ f: "internalNote" }] : []),
    ...(cotNoiBo ? [{ f: "ns" }] : []),   // cột CUỐI của sơ đồ — không dịch chữ cột nào trước nó
  ];
  return cot.map((c, i) => ({ ...c, L: groupLetter(i) }));
}

/** Chữ cái của một trường trong sơ đồ ("" nếu sơ đồ không có cột đó). */
export const chuCot = (so: CotDiaChi[], f: string) => so.find((c) => c.f === f)?.L || "";
