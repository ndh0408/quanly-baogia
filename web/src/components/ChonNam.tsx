import { useState } from "react";

// BỘ CHỌN NĂM — "thư mục theo năm" cho các trang danh sách (2026-11-26, chủ repo chuyển lời: "sau 1 năm thì data mình có
// cách nào gom vô 1 thư mục để dễ kiểm soát … click vô năm 2026 thì chỉ thể hiện 2026 thôi" — rồi "cả danh sách báo giá
// hay gì tất cả luôn"). Một hàng nút: Tất cả · 2026 · 2025 …, mỗi nút kèm số dòng của năm đó.
//
// Năm đã chọn NHỚ trên máy này (localStorage, mỗi trang một khoá) để lần sau mở trang vẫn đúng "thư mục" đang xem.
// Trình duyệt chặn bộ nhớ (cửa sổ ẩn danh, chính sách công ty) thì thôi nhớ — trang vẫn chạy bình thường.

export type MucNam = { nam: string; dem: number };

/** Các năm có dữ liệu, MỚI trước, kèm số dòng mỗi năm. Dòng không có năm không thuộc năm nào (chỉ hiện ở "Tất cả"). */
export function demTheoNam<T>(rows: readonly T[], layNam: (r: T) => number | string | null | undefined): MucNam[] {
  const dem = new Map<string, number>();
  for (const r of rows) {
    const n = layNam(r);
    const k = n == null || n === "" ? "" : String(n);
    if (/^\d{4}$/.test(k)) dem.set(k, (dem.get(k) ?? 0) + 1);
  }
  return [...dem.entries()].sort((a, b) => Number(b[0]) - Number(a[0])).map(([nam, d]) => ({ nam, dem: d }));
}

/**
 * Năm đang có hiệu lực: năm đã nhớ mà dữ liệu KHÔNG còn năm đó (hoặc chưa tải xong) → coi như "Tất cả", tuyệt đối không
 * giấu sạch bảng vì một lựa chọn cũ.
 */
export function namHieuLuc(chon: string, cacNam: readonly MucNam[]): string {
  return chon && cacNam.some((x) => x.nam === chon) ? chon : "";
}

export const docNamDaNho = (khoa: string): string => {
  try { return localStorage.getItem(khoa) || ""; } catch { return ""; }
};
export const ghiNamDaNho = (khoa: string, v: string) => {
  try { if (v) localStorage.setItem(khoa, v); else localStorage.removeItem(khoa); } catch { /* bộ nhớ bị chặn: thôi nhớ */ }
};

/** Năm đã chọn của MỘT trang, nhớ qua các lần mở. Trả [năm, chọnNăm]. */
export function useNamDaNho(khoa: string): [string, (v: string) => void] {
  const [nam, setNam] = useState(() => docNamDaNho(khoa));
  return [nam, (v: string) => { setNam(v); ghiNamDaNho(khoa, v); }];
}

export function ChonNam({ cacNam, nam, chon, tong, nhan = "Năm", goiY }: {
  cacNam: readonly MucNam[];
  /** Năm đang có hiệu lực ("" = Tất cả) — đã qua `namHieuLuc`. */
  nam: string;
  chon: (v: string) => void;
  /** Số trên nút "Tất cả"; bỏ trống thì không hiện số. */
  tong?: number;
  nhan?: string;
  /** Chú thích khi rê chuột lên một năm, vd "Dự án khách chốt trong năm 2026". */
  goiY?: (nam: string) => string;
}) {
  if (cacNam.length === 0) return null;
  return (
    <div className="inv-quick-filters chon-nam" role="group" aria-label={`Chọn ${nhan.toLowerCase()}`}>
      <span className="inv-quick-label" aria-hidden="true">{nhan}:</span>
      <button type="button" className={nam === "" ? "active" : ""} aria-pressed={nam === ""} onClick={() => chon("")}>
        Tất cả{tong != null && <b>{tong}</b>}
      </button>
      {cacNam.map((x) => (
        <button key={x.nam} type="button" className={nam === x.nam ? "active" : ""} aria-pressed={nam === x.nam}
          title={goiY?.(x.nam)} onClick={() => chon(x.nam)}>
          {x.nam}<b>{x.dem}</b>
        </button>
      ))}
    </div>
  );
}
