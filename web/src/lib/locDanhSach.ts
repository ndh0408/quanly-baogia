// BỘ LỌC của Danh sách báo giá — phần THUẦN (chủ repo 2026-09-30: "bộ lọc … chưa đầy đủ và thông minh"): trạng thái
// trên URL, tham số gửi API, đọc số tiền kiểu người Việt gõ ("100tr", "1,5 tỷ"), mẫu ngày nhanh. Tách khỏi component để
// test được từng luật, và để URL / API / giao diện cùng MỘT định nghĩa "đang lọc những gì".
import { MAU_GHI_CHU } from "./ghiChuMau";

export type BoLocDS = {
  q: string;
  /** Trạng thái báo giá (nhiều). */
  status: string[];
  /** Công ty (id, nhiều). */
  cty: number[];
  /** Người tạo (id, nhiều). */
  nguoi: number[];
  /** Ngày báo giá từ / đến, dạng yyyy-mm-dd ("" = không chặn). */
  tu: string;
  den: string;
  /** Tổng tiền từ / đến, CHỮ SỐ thuần (đã đọc xong), "" = không chặn. */
  tienTu: string;
  tienDen: string;
  /** Ghi chú: "has" = đã có, "none" = chưa có. */
  ghiChu: "" | "has" | "none";
  /** Màu ghi chú (nhiều, khoá trong bảng 5 màu). */
  mau: string[];
};

export const LOC_RONG: BoLocDS = { q: "", status: [], cty: [], nguoi: [], tu: "", den: "", tienTu: "", tienDen: "", ghiChu: "", mau: [] };

/** Số NHÓM đang lọc (hiện trên nút "Xóa tất cả (n)"): ngày, tiền, ghi chú+màu mỗi thứ tính một nhóm. */
export function demBoLoc(b: BoLocDS): number {
  return [b.q.trim() !== "", b.status.length > 0, b.cty.length > 0, b.nguoi.length > 0, !!(b.tu || b.den), !!(b.tienTu || b.tienDen), !!(b.ghiChu || b.mau.length)].filter(Boolean).length;
}

const csv = (s: string | null) => (s ?? "").split(",").map((x) => x.trim()).filter(Boolean);
const dsSo = (s: string | null) => [...new Set(csv(s).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
const laNgay = (s: string | null) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "");
const laChuSo = (s: string | null) => (s && /^\d{1,15}$/.test(s) ? s : "");

/** Đọc bộ lọc từ `#/list?…` — giá trị rác bị BỎ (link cũ / gõ tay không được làm hỏng trang). */
export function docTuUrl(sp: URLSearchParams): BoLocDS {
  const note = sp.get("note");
  return {
    q: sp.get("q") ?? "",
    status: csv(sp.get("status")),
    cty: dsSo(sp.get("company")),
    nguoi: dsSo(sp.get("creator")),
    tu: laNgay(sp.get("from")),
    den: laNgay(sp.get("to")),
    tienTu: laChuSo(sp.get("min")),
    tienDen: laChuSo(sp.get("max")),
    ghiChu: note === "has" || note === "none" ? note : "",
    mau: csv(sp.get("color")).filter((c) => (MAU_GHI_CHU as readonly string[]).includes(c)),
  };
}

/** Ghi bộ lọc lên URL (chỉ khoá có giá trị) — ngược của `docTuUrl`. */
export function ghiLenUrl(b: BoLocDS, p: URLSearchParams = new URLSearchParams()): URLSearchParams {
  if (b.q) p.set("q", b.q);
  if (b.status.length) p.set("status", b.status.join(","));
  if (b.cty.length) p.set("company", b.cty.join(","));
  if (b.nguoi.length) p.set("creator", b.nguoi.join(","));
  if (b.tu) p.set("from", b.tu);
  if (b.den) p.set("to", b.den);
  if (b.tienTu) p.set("min", b.tienTu);
  if (b.tienDen) p.set("max", b.tienDen);
  if (b.ghiChu) p.set("note", b.ghiChu);
  if (b.mau.length) p.set("color", b.mau.join(","));
  return p;
}

/** Tham số gửi `GET /api/quotes` và `/api/quotes/facets` — tên theo máy chủ (ListQuerySchema), chỉ khoá có giá trị. */
export function thamSoApi(b: BoLocDS): Record<string, string> {
  const o: Record<string, string> = {};
  if (b.q.trim()) o.q = b.q.trim();
  if (b.status.length) o.status = b.status.join(",");
  if (b.cty.length) o.companyId = b.cty.join(",");
  if (b.nguoi.length) o.creator = b.nguoi.join(",");
  if (b.tu) o.from = b.tu;
  if (b.den) o.to = b.den;
  if (b.tienTu) o.minTotal = b.tienTu;
  if (b.tienDen) o.maxTotal = b.tienDen;
  if (b.ghiChu) o.note = b.ghiChu;
  if (b.mau.length) o.noteColor = b.mau.join(",");
  return o;
}

/** Bỏ dấu + thường hoá (để nhận "triệu"/"trieu", "tỷ"/"ty"). */
const bo = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "d").toLowerCase();

/**
 * Đọc số tiền NGƯỜI VIỆT gõ → đồng (số nguyên), hoặc null nếu không hiểu.
 *   "100tr" · "100 triệu" · "100m"      → 100.000.000
 *   "1,5 tỷ" · "1.5 tỷ" · "1,5ty"       → 1.500.000.000
 *   "500k" · "500 nghìn"                → 500.000
 *   "1.250.000" · "1250000" · "1,250,000" → 1.250.000   (không có đơn vị: dấu chấm/phẩy là NGĂN CÁCH HÀNG NGHÌN)
 * Có đơn vị thì dấu phẩy/chấm là THẬP PHÂN ("1,5 tỷ" = 1,5 tỷ, không phải 15 tỷ). Số âm / chữ lạ → null: một ô lọc
 * tiền hiểu sai lặng lẽ (vd "1,5" thành 15) còn tệ hơn báo "chưa hiểu".
 */
export function parseTien(raw: string): number | null {
  const s = bo(raw).replace(/\s+/g, "");
  if (!s) return null;
  const m = /^(\d[\d.,]*)(ty|ti|b|trieu|tr|m|nghin|ngan|k)?(d|vnd)?$/.exec(s);
  if (!m) return null;
  const [, so, don] = m;
  const nhan = don ? ({ ty: 1e9, ti: 1e9, b: 1e9, trieu: 1e6, tr: 1e6, m: 1e6, nghin: 1e3, ngan: 1e3, k: 1e3 } as Record<string, number>)[don] : 1;
  let n: number;
  if (don) {
    const t = so.replace(/,/g, ".");
    n = Number((t.match(/\./g) || []).length > 1 ? t.replace(/\./g, "") : t);   // "1.250 tr" (nhiều dấu chấm) = ngăn cách hàng nghìn
  } else {
    n = Number(so.replace(/[.,]/g, ""));
  }
  return Number.isFinite(n) ? Math.round(n * nhan) : null;
}

/** Hiển thị số tiền trong ô lọc sau khi đọc xong: 100000000 → "100.000.000". */
export const hienTien = (chuSo: string) => (chuSo ? Number(chuSo).toLocaleString("vi-VN") : "");

// ── MẪU NGÀY NHANH ────────────────────────────────────────────────────────────────────────────────
const p2 = (n: number) => String(n).padStart(2, "0");
/** yyyy-mm-dd theo GIỜ MÁY (giờ Việt Nam ở người dùng) — `toISOString` đổi sang UTC và lệch ngày vào sáng sớm. */
export const ngayCucBo = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;

export const MAU_NGAY = [
  { khoa: "homnay", nhan: "Hôm nay" },
  { khoa: "7ngay", nhan: "7 ngày qua" },
  { khoa: "30ngay", nhan: "30 ngày qua" },
  { khoa: "thangnay", nhan: "Tháng này" },
  { khoa: "thangtruoc", nhan: "Tháng trước" },
  { khoa: "quynay", nhan: "Quý này" },
  { khoa: "namnay", nhan: "Năm nay" },
] as const;
export type KhoaMauNgay = (typeof MAU_NGAY)[number]["khoa"];

/** Khoảng ngày (gồm cả hai đầu) của một mẫu, tính từ `nay`. */
export function khoangNgay(khoa: KhoaMauNgay, nay: Date = new Date()): { tu: string; den: string } {
  const y = nay.getFullYear(), m = nay.getMonth(), d = nay.getDate();
  const ngay = (yy: number, mm: number, dd: number) => ngayCucBo(new Date(yy, mm, dd));   // Date tự chuẩn hoá tháng/ngày tràn
  switch (khoa) {
    case "homnay": return { tu: ngay(y, m, d), den: ngay(y, m, d) };
    case "7ngay": return { tu: ngay(y, m, d - 6), den: ngay(y, m, d) };
    case "30ngay": return { tu: ngay(y, m, d - 29), den: ngay(y, m, d) };
    case "thangnay": return { tu: ngay(y, m, 1), den: ngay(y, m + 1, 0) };
    case "thangtruoc": return { tu: ngay(y, m - 1, 1), den: ngay(y, m, 0) };
    case "quynay": { const q0 = Math.floor(m / 3) * 3; return { tu: ngay(y, q0, 1), den: ngay(y, q0 + 3, 0) }; }
    case "namnay": return { tu: ngay(y, 0, 1), den: ngay(y, 11, 31) };
  }
}

/** Mẫu nào đang KHỚP đúng bộ lọc ngày hiện tại (để ô chọn mẫu hiện đúng tên; không mẫu nào khớp → ""). */
export function mauNgayDangKhop(tu: string, den: string, nay: Date = new Date()): KhoaMauNgay | "" {
  if (!tu && !den) return "";
  return MAU_NGAY.find((x) => { const k = khoangNgay(x.khoa, nay); return k.tu === tu && k.den === den; })?.khoa ?? "";
}
