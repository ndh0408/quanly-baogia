// ┌─────────────────────────────────────────────────────────────────────────────┐
// │ BÁO CÓ BẢN MỚI SAU MỖI LẦN DEPLOY (chủ repo 2026-09-24).                     │
// └─────────────────────────────────────────────────────────────────────────────┘
//
// Service worker cất sẵn bản giao diện trong máy: tab mở từ trước lúc deploy chạy bản CŨ tới khi tự tải
// lại (có khi phải hai lần), mà người dùng không biết Ctrl+Shift+R. Ở đây:
//   1. Hỏi máy chủ `/api/phien-ban` (5 phút/lần, lúc quay lại tab, lúc có mạng lại): tên tệp JS chính
//      máy chủ đang phát khác tệp trang này đang chạy → CÓ BẢN MỚI.
//   2. Không có gì dở dang + tab đang NẰM NỀN → tự tải bản mới (người dùng không nhìn thấy gì).
//   3. Còn lại chỉ NHẮC (dải thông báo + nút "Tải bản mới"); đang dở thì hỏi trước khi tải.
// "Tải bản mới" = gỡ service worker + xoá kho cache của nó rồi tải lại — đúng thứ Ctrl+Shift+R + gỡ SW
// vẫn phải làm tay, nên lần tải lại đầu tiên đã là bản mới (không phải lần thứ hai).
import { useSyncExternalStore } from "react";

export type PhienBanMayChu = { banGiaoDien: string | null; sha: string | null; capNhatLuc: string | null; khoiDongLuc?: string };
export type TrangThai = {
  cuaToi: string | null;          // bản giao diện trang này đang chạy
  mayChu: PhienBanMayChu | null;  // lần hỏi gần nhất
  coBanMoi: boolean;
  anDenLuc: number;               // người dùng bấm ✕ → ẩn dải tới lúc này (ms)
  dangTai: boolean;
};

export const CHU_KY_MS = 5 * 60 * 1000;
export const AN_TAM_MS = 30 * 60 * 1000;
const KHOA_DA_TAI = "quanly:phien-ban:da-tai-lai-toi";

/** Tên tệp JS chính mà TRANG NÀY đang chạy ("index-BVwnOoE_"), đọc từ thẻ <script type="module">. */
export function banCuaToi(doc: Document = document): string | null {
  for (const s of Array.from(doc.querySelectorAll('script[type="module"][src]'))) {
    const m = /\/assets\/(index-[A-Za-z0-9_-]+)\.js/.exec((s as HTMLScriptElement).src || s.getAttribute("src") || "");
    if (m) return m[1];
  }
  return null;
}

/** So bản: chỉ kết luận "có bản mới" khi CẢ HAI phía đều biết mình là bản nào (dev chạy vite → null). */
export const khacBan = (cuaToi: string | null, mayChu: string | null | undefined) => !!cuaToi && !!mayChu && cuaToi !== mayChu;

export type DangDo = "chua-luu" | "form-mo" | "dang-go" | null;
/**
 * Người dùng có đang làm dở gì không — tải lại lúc này có làm mất gì không.
 *   · "chua-luu": trình soạn báo giá / màn Account HN còn thay đổi chưa lưu (cờ dùng chung __editorDirty)
 *   · "form-mo" : đang mở một hộp thoại / form (thêm-sửa Nhân sự, Danh bạ, Khách, Thanh toán…)
 *   · "dang-go" : tiêu điểm đang ở một ô nhập ĐƯỢC SỬA (ô hoá đơn đang gõ, ô tìm…)
 */
export function dangDo(win: Window = window, doc: Document = document): DangDo {
  if ((win as Window & { __editorDirty?: boolean }).__editorDirty) return "chua-luu";
  if (doc.querySelector('.modal-backdrop, [role="dialog"][aria-modal="true"]')) return "form-mo";
  const a = doc.activeElement as (HTMLInputElement & HTMLTextAreaElement) | null;
  if (a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.tagName === "SELECT" || a.isContentEditable)) {
    const loai = (a.getAttribute("type") || "").toLowerCase();
    const khongPhaiGo = ["checkbox", "radio", "button", "submit", "reset", "file", "range", "color"].includes(loai);
    if (!khongPhaiGo && !a.readOnly && !a.disabled) return "dang-go";
  }
  return null;
}

// ── kho trạng thái dùng chung (useSyncExternalStore) ─────────────────────────────────────────────
let st: TrangThai = { cuaToi: null, mayChu: null, coBanMoi: false, anDenLuc: 0, dangTai: false };
const nghe = new Set<() => void>();
const dat = (p: Partial<TrangThai>) => { st = { ...st, ...p }; nghe.forEach((f) => f()); };
export const layTrangThai = () => st;
export function usePhienBan(): TrangThai {
  return useSyncExternalStore((f) => { nghe.add(f); return () => { nghe.delete(f); }; }, layTrangThai, layTrangThai);
}
/** Chỉ cho test: đưa kho về trạng thái đầu. */
export function _datLai(p: Partial<TrangThai> = {}) { st = { cuaToi: null, mayChu: null, coBanMoi: false, anDenLuc: 0, dangTai: false, ...p }; nghe.forEach((f) => f()); }

/**
 * Hỏi máy chủ một lần. `true` = có bản mới, `false` = đang dùng bản mới nhất, `null` = KHÔNG hỏi được
 * (mất mạng, máy chủ đang khởi động lại giữa lúc deploy) — giữ nguyên kết luận cũ, không báo gì.
 */
export async function kiemTraBanMoi(fetchFn: typeof fetch = fetch): Promise<boolean | null> {
  const cuaToi = st.cuaToi ?? banCuaToi();
  try {
    const r = await fetchFn("/api/phien-ban", { cache: "no-store", credentials: "same-origin" });
    if (!r.ok) return null;
    const mayChu = (await r.json()) as PhienBanMayChu;
    const coBanMoi = khacBan(cuaToi, mayChu.banGiaoDien);
    dat({ cuaToi, mayChu, coBanMoi });
    return coBanMoi;
  } catch {
    return null;
  }
}

/** Người dùng bấm ✕: ẩn dải 30 phút (bản mới vẫn còn đó — hết giờ thì nhắc lại). */
export function anTam(bayGio = Date.now()) { dat({ anDenLuc: bayGio + AN_TAM_MS }); }
/** Người dùng TỰ bấm "Kiểm tra bản mới" → hiện lại dải ngay dù trước đó đã ẩn. */
export function hienLai() { dat({ anDenLuc: 0 }); }

/**
 * TẢI BẢN MỚI: gỡ service worker + xoá kho cache của nó rồi tải lại ĐÚNG trang đang đứng (hash giữ
 * nguyên). Không gỡ thì lần tải lại đầu vẫn lấy bản cũ từ kho — người dùng phải tải lại lần hai.
 * Ghi nhớ đích (sessionStorage) để không tự tải lại vòng tròn nếu vì lý do gì trang mở lại vẫn cũ.
 */
export async function taiBanMoi(win: Window = window): Promise<void> {
  dat({ dangTai: true });
  try { if (st.mayChu?.banGiaoDien) win.sessionStorage.setItem(KHOA_DA_TAI, st.mayChu.banGiaoDien); } catch { /* */ }
  try {
    const regs = (await win.navigator.serviceWorker?.getRegistrations?.()) || [];
    await Promise.all(regs.map((r) => r.unregister().catch(() => false)));
  } catch { /* trình duyệt không có SW — tải lại thường là đủ */ }
  try {
    const ks = (await win.caches?.keys?.()) || [];
    await Promise.all(ks.map((k) => win.caches.delete(k)));
  } catch { /* */ }
  (win as Window & { __editorDirty?: boolean }).__editorDirty = false;   // đã hỏi/đã lưu ở phía gọi
  win.location.reload();
}

/**
 * "Lưu rồi tải bản mới": nhờ màn đang mở tự Lưu (trình soạn báo giá / Account HN nghe sự kiện
 * `phien-ban:luu` và đẩy lời hứa của save() vào `hua`), chờ xong rồi xem cờ chưa-lưu đã hạ chưa.
 * Trả `true` = đã lưu xong (phía gọi mới tải lại); `false` = không màn nào lưu, hoặc lưu hỏng / 409.
 */
export async function luuRoiBao(win: Window = window): Promise<boolean> {
  const hua: Promise<unknown>[] = [];
  win.dispatchEvent(new CustomEvent("phien-ban:luu", { detail: { hua } }));
  if (!hua.length) return false;
  try { await Promise.all(hua); } catch { return false; }
  return !(win as Window & { __editorDirty?: boolean }).__editorDirty;
}

/** Tự tải bản mới khi AN TOÀN: có bản mới, không dở gì, tab đang nằm nền, chưa từng tự tải tới đúng bản này. */
export function nenTuTai(doc: Document = document, win: Window = window): boolean {
  if (!st.coBanMoi || st.dangTai) return false;
  if (doc.visibilityState !== "hidden") return false;
  if (dangDo(win, doc)) return false;
  try { if (win.sessionStorage.getItem(KHOA_DA_TAI) === st.mayChu?.banGiaoDien) return false; } catch { /* */ }
  return true;
}

let daChay = false;
/** Gắn một lần cho cả app (Shell): hỏi ngay, rồi 5 phút/lần, lúc quay lại tab, lúc có mạng lại. */
export function batDauTheoDoi(win: Window = window, doc: Document = document): () => void {
  if (daChay) return () => {};
  daChay = true;
  dat({ cuaToi: banCuaToi(doc) });
  const thuTuTai = () => { if (nenTuTai(doc, win)) void taiBanMoi(win); };
  const hoi = () => { void kiemTraBanMoi().then(thuTuTai); };
  const onVis = () => { if (doc.visibilityState === "visible") hoi(); else thuTuTai(); };
  const onOnline = () => hoi();
  hoi();
  const t = win.setInterval(hoi, CHU_KY_MS);
  doc.addEventListener("visibilitychange", onVis);
  win.addEventListener("online", onOnline);
  return () => { daChay = false; win.clearInterval(t); doc.removeEventListener("visibilitychange", onVis); win.removeEventListener("online", onOnline); };
}

/** "Phiên bản 9dd30dc · 24/09 14:00" — null trường nào thì bỏ phần đó. */
export function nhanPhienBan(mayChu: PhienBanMayChu | null, cuaToi: string | null): { dong1: string; dong2: string | null } {
  const ma = mayChu?.sha || (cuaToi ? cuaToi.replace(/^index-/, "") : null);
  const luc = mayChu?.capNhatLuc ? new Date(mayChu.capNhatLuc) : null;
  const p = (n: number) => String(n).padStart(2, "0");
  const dong2 = luc && !Number.isNaN(luc.getTime())
    ? `Cập nhật ${p(luc.getDate())}/${p(luc.getMonth() + 1)} lúc ${p(luc.getHours())}:${p(luc.getMinutes())}`
    : null;
  return { dong1: ma ? `Phiên bản ${ma}` : "Bản đang phát triển", dong2 };
}
