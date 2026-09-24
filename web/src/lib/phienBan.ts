// ┌─────────────────────────────────────────────────────────────────────────────┐
// │ BÁO CÓ BẢN MỚI SAU MỖI LẦN DEPLOY (chủ repo 2026-09-24).                     │
// └─────────────────────────────────────────────────────────────────────────────┘
//
// Service worker cất sẵn bản giao diện trong máy: tab mở từ trước lúc deploy chạy bản CŨ tới khi tự tải
// lại (có khi phải hai lần), mà người dùng không biết Ctrl+Shift+R. Ở đây:
//   1. Hỏi máy chủ `/api/phien-ban` (5 phút/lần, lúc quay lại tab, lúc có mạng lại): tên tệp JS chính
//      máy chủ đang phát khác tệp trang này đang chạy → CÓ BẢN MỚI.
//   2. Tự tải bản mới CHỈ khi: tab đang NẰM NỀN + trang đang mở TỰ KHAI là an toàn (useTrangAnToan) +
//      không có gì dở (chưa lưu, form mở, ô đang gõ, lệnh lưu đang chạy) + lần hỏi máy chủ vừa rồi THÀNH
//      CÔNG. Người dùng không nhìn thấy gì.
//   3. Còn lại chỉ NHẮC (dải thông báo + nút "Tải bản mới"); đang dở — hay trang không tự khai an toàn —
//      thì hỏi trước khi tải.
// "Tải bản mới" = gỡ service worker + xoá kho cache của nó rồi tải lại — đúng thứ Ctrl+Shift+R + gỡ SW
// vẫn phải làm tay, nên lần tải lại đầu tiên đã là bản mới (không phải lần thứ hai).
//
// VÌ SAO "TRANG TỰ KHAI AN TOÀN" MÀ KHÔNG ĐOÁN TỪ DOM (soát 2026-09-24): bản đầu suy "không dở gì" từ ba
// tín hiệu (cờ chưa-lưu, hộp thoại, ô đang có con trỏ) — và tự tải lại xoá im lặng wizard Tạo báo giá,
// báo giá mới vừa ra khỏi wizard (#/rnew, chưa gõ gì nên cờ chưa bật), ma trận Phân quyền tick dở…:
// những màn giữ dữ liệu trong bộ nhớ mà không bật tín hiệu nào. Đoán thì luôn sót. Nay MẶC ĐỊNH là
// KHÔNG an toàn: chỉ trang tự khai (Danh sách, Tổng quan, Thông báo, Nhật ký, màn đăng nhập, trình
// soạn/Account HN khi đã lưu sạch) mới được tự tải; trang mới thêm sau này quên khai thì chỉ bị nhắc.
import { useEffect, useRef, useSyncExternalStore } from "react";
import { soLenhGhiDangBay } from "./api";

export type PhienBanMayChu = { banGiaoDien: string | null; sha: string | null; capNhatLuc: string | null };
export type TrangThai = {
  cuaToi: string | null;          // bản giao diện trang này đang chạy
  mayChu: PhienBanMayChu | null;  // lần hỏi THÀNH CÔNG gần nhất
  coBanMoi: boolean;
  anDenLuc: number;               // người dùng bấm ✕ → ẩn dải tới lúc này (ms)
  dangTai: boolean;
  hoiLuc: number;                 // lúc của lần hỏi THÀNH CÔNG gần nhất (ms) — 0 = chưa hỏi được lần nào
  hoiHong: boolean;               // lần hỏi GẦN NHẤT hỏng (mất mạng / máy chủ đang khởi động lại)
};

export const CHU_KY_MS = 5 * 60 * 1000;
export const AN_TAM_MS = 30 * 60 * 1000;
/** Quay lại tab / có mạng lại liên tục thì không hỏi dồn: cách lần hỏi thành công trước ít nhất chừng này. */
export const KHOANG_NGHI_MS = 60 * 1000;
/** Tự tải chỉ dựa vào kết luận còn MỚI — tab nằm nền nhiều giờ không được tự tải theo một lần hỏi cũ. */
export const KET_LUAN_MOI_MS = 2 * 60 * 1000;
const CHO_LENH_GHI_MS = 10 * 1000;
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

// ── TRANG TỰ KHAI "TẢI LẠI LÚC NÀY KHÔNG MẤT GÌ" ──────────────────────────────────────────────────
const trangAnToan = new Set<{ f: () => boolean }>();
/** Đăng ký một hàm hỏi "trang này tải lại lúc này có an toàn không". Trả hàm gỡ. */
export function dangKyTrangAnToan(f: () => boolean = () => true): () => void {
  const o = { f };
  trangAnToan.add(o);
  return () => { trangAnToan.delete(o); };
}
/**
 * Trang gọi hook này để khai: tải lại trang lúc này không làm mất gì (tuỳ chọn `f` = điều kiện, vd trình
 * soạn: "đã lưu sạch"). Không gọi = không an toàn — tự tải không bao giờ chạy, bấm tay thì bị hỏi lại.
 */
export function useTrangAnToan(f?: () => boolean) {
  const ref = useRef(f);
  ref.current = f;
  useEffect(() => dangKyTrangAnToan(() => (ref.current ? ref.current() : true)), []);
}
/** Có ít nhất một trang đã khai, và MỌI hàm đã khai đều nói an toàn (lớp phủ đăng nhập lại đè lên trang
 *  cũng khai — "không" — nên trang bên dưới không bị tải lại trong lúc đó). */
export const laTrangAnToan = () => trangAnToan.size > 0 && [...trangAnToan].every((o) => { try { return o.f(); } catch { return false; } });

export type DangDo = "chua-luu" | "form-mo" | "dang-go" | "chua-ro" | null;
/**
 * Người dùng có đang làm dở gì không — tải lại lúc này có làm mất gì không.
 *   · "chua-luu": trình soạn báo giá / màn Account HN còn thay đổi chưa lưu (cờ dùng chung __editorDirty)
 *   · "form-mo" : đang mở một hộp thoại / form (thêm-sửa Nhân sự, Danh bạ, Khách, Thanh toán…)
 *   · "dang-go" : tiêu điểm đang ở một ô nhập ĐƯỢC SỬA và ĐÃ CÓ CHỮ (ô hoá đơn đang gõ, ô tìm…).
 *     Ô TRỐNG thì không mất gì: trang đăng nhập tự đặt con trỏ vào ô tên — tính ô trống là "đang gõ"
 *     thì dải hiện "Rời ô đang gõ…" vô lý, và tab đăng nhập để nằm nền không bao giờ tự lên bản mới.
 *   · "chua-ro" : trang đang mở KHÔNG tự khai an toàn (useTrangAnToan) — có thể còn dữ liệu trong bộ nhớ.
 */
export function dangDo(win: Window = window, doc: Document = document): DangDo {
  if ((win as Window & { __editorDirty?: boolean }).__editorDirty) return "chua-luu";
  if (doc.querySelector('.modal-backdrop, [role="dialog"][aria-modal="true"]')) return "form-mo";
  const a = doc.activeElement as (HTMLInputElement & HTMLTextAreaElement) | null;
  if (a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.tagName === "SELECT" || a.isContentEditable)) {
    const loai = (a.getAttribute("type") || "").toLowerCase();
    const khongPhaiGo = ["checkbox", "radio", "button", "submit", "reset", "file", "range", "color"].includes(loai);
    const coChu = a.isContentEditable ? !!a.textContent?.trim() : a.value !== "";
    if (!khongPhaiGo && !a.readOnly && !a.disabled && coChu) return "dang-go";
  }
  if (!laTrangAnToan()) return "chua-ro";
  return null;
}

// ── kho trạng thái dùng chung (useSyncExternalStore) ─────────────────────────────────────────────
const DAU: TrangThai = { cuaToi: null, mayChu: null, coBanMoi: false, anDenLuc: 0, dangTai: false, hoiLuc: 0, hoiHong: false };
let st: TrangThai = { ...DAU };
const nghe = new Set<() => void>();
const dat = (p: Partial<TrangThai>) => { st = { ...st, ...p }; nghe.forEach((f) => f()); };
export const layTrangThai = () => st;
export function usePhienBan(): TrangThai {
  return useSyncExternalStore((f) => { nghe.add(f); return () => { nghe.delete(f); }; }, layTrangThai, layTrangThai);
}
/** Chỉ cho test: đưa kho (và sổ trang an toàn) về trạng thái đầu. */
export function _datLai(p: Partial<TrangThai> = {}) { st = { ...DAU, ...p }; trangAnToan.clear(); nghe.forEach((f) => f()); }

/**
 * Hỏi máy chủ một lần. `true` = có bản mới, `false` = đang dùng bản mới nhất, `null` = KHÔNG hỏi được
 * (mất mạng, máy chủ đang khởi động lại giữa lúc deploy) — giữ nguyên kết luận cũ, không báo gì.
 */
export async function kiemTraBanMoi(fetchFn: typeof fetch = fetch): Promise<boolean | null> {
  const cuaToi = st.cuaToi ?? banCuaToi();
  try {
    const r = await fetchFn("/api/phien-ban", { cache: "no-store", credentials: "same-origin" });
    if (!r.ok) { dat({ hoiHong: true }); return null; }
    const mayChu = (await r.json()) as PhienBanMayChu;
    const coBanMoi = khacBan(cuaToi, mayChu.banGiaoDien);
    dat({ cuaToi, mayChu, coBanMoi, hoiLuc: Date.now(), hoiHong: false });
    return coBanMoi;
  } catch {
    dat({ hoiHong: true });
    return null;
  }
}

/** Người dùng bấm ✕: ẩn dải 30 phút (bản mới vẫn còn đó — hết giờ thì nhắc lại). */
export function anTam(bayGio = Date.now()) { dat({ anDenLuc: bayGio + AN_TAM_MS }); }
/** Người dùng TỰ bấm "Kiểm tra bản mới" → hiện lại dải ngay dù trước đó đã ẩn. */
export function hienLai() { dat({ anDenLuc: 0 }); }

/** Điều kiện của ĐƯỜNG TỰ ĐỘNG tại đúng lúc này (dùng cả lúc quyết lẫn ngay trước khi tải lại). */
function tuTaiDuocLucNay(doc: Document, win: Window): boolean {
  if (doc.visibilityState !== "hidden") return false;                // người dùng đang nhìn → không bao giờ
  if (win.navigator && win.navigator.onLine === false) return false; // mất mạng → tải lại là ra trang lỗi
  if (soLenhGhiDangBay() > 0) return false;                          // lệnh lưu đang chạy
  return dangDo(win, doc) === null;
}

/** Gỡ service worker + xoá kho cache của nó (không có SW / không có Cache Storage thì bỏ qua). */
async function goBoNhoDem(win: Window): Promise<void> {
  try {
    const regs = (await win.navigator.serviceWorker?.getRegistrations?.()) || [];
    await Promise.all(regs.map((r) => r.unregister().catch(() => false)));
  } catch { /* trình duyệt không có SW — tải lại thường là đủ */ }
  try {
    const ks = (await win.caches?.keys?.()) || [];
    await Promise.all(ks.map((k) => win.caches.delete(k)));
  } catch { /* */ }
}

const ngu = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * TẢI BẢN MỚI: gỡ service worker + xoá kho cache của nó rồi tải lại ĐÚNG trang đang đứng (hash giữ
 * nguyên). Không gỡ thì lần tải lại đầu vẫn lấy bản cũ từ kho — người dùng phải tải lại lần hai.
 * Trả `false` (và KHÔNG đụng gì) khi:
 *   · lệnh lưu còn chạy quá 10 giây — tải lại lúc đó là nuốt kết quả lưu;
 *   · hỏi lại máy chủ KHÔNG được (mất mạng / đang khởi động lại): gỡ SW rồi tải lại lúc đó là rơi vào
 *     trang lỗi của trình duyệt, mất luôn vỏ offline — giữ nguyên, lát thử lại;
 *   · máy chủ hoá ra đang phát đúng bản này (vd vừa lùi bản) — không có gì để tải;
 *   · `tuDong` mà ngay trước lúc tải điều kiện tự tải không còn (người dùng quay lại tab, bắt đầu gõ…).
 * Không tự hạ cờ chưa-lưu: "Tải luôn" chỉ bắn `phien-ban:truoc-tai` để màn đang soạn GHI BẢN NHÁP NGAY
 * (mở lại được hỏi "Khôi phục?"); ghi không được thì màn đó giữ cờ và hộp của trình duyệt hỏi lần cuối.
 */
export async function taiBanMoi(win: Window = window, { tuDong = false }: { tuDong?: boolean } = {}): Promise<boolean> {
  if (st.dangTai) return false;
  dat({ dangTai: true });
  const thoi = () => { dat({ dangTai: false }); return false; };
  for (let cho = 0; soLenhGhiDangBay() > 0; cho += 250) {
    if (cho >= CHO_LENH_GHI_MS) return thoi();
    await ngu(250);
  }
  if ((await kiemTraBanMoi()) !== true) return thoi();
  await goBoNhoDem(win);
  if (tuDong && !tuTaiDuocLucNay(win.document, win)) return thoi();   // SW đã gỡ không sao — lần tải sau tự đăng ký lại
  try { if (st.mayChu?.banGiaoDien) win.sessionStorage.setItem(KHOA_DA_TAI, st.mayChu.banGiaoDien); } catch { /* */ }
  win.dispatchEvent(new Event("phien-ban:truoc-tai"));
  win.location.reload();
  // Hộp "Tải lại trang?" của trình duyệt (còn thay đổi chưa lưu mà không ghi được bản nháp) bị bấm Hủy →
  // trang ở lại: trả dải về bình thường, đừng kẹt mãi ở "Đang tải bản mới…".
  win.setTimeout(() => dat({ dangTai: false }), 3000);
  return true;
}

/**
 * Nút "Thử lại" (màn không kết nối được máy chủ) / "Tải lại trang" (màn lỗi hiển thị): máy chủ đang phát
 * bản KHÁC thì gỡ SW trước để lần này đã là bản mới; không hỏi được máy chủ thì GIỮ SW (vỏ offline của nó
 * mới hiện được màn "Không kết nối được máy chủ" thay cho trang lỗi của trình duyệt) và tải lại thường.
 */
export async function taiLaiTrang(win: Window = window): Promise<void> {
  if ((await kiemTraBanMoi()) === true) await goBoNhoDem(win);
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

/**
 * Tự tải bản mới khi AN TOÀN: có bản mới (kết luận của một lần hỏi THÀNH CÔNG trong 2 phút qua, và lần
 * hỏi gần nhất không hỏng), tab nằm nền, có mạng, không lệnh lưu nào đang chạy, trang tự khai an toàn và
 * không dở gì, chưa từng tự tải tới đúng bản này (chống vòng tròn).
 */
export function nenTuTai(doc: Document = document, win: Window = window, bayGio = Date.now()): boolean {
  if (!st.coBanMoi || st.dangTai) return false;
  if (st.hoiHong || bayGio - st.hoiLuc > KET_LUAN_MOI_MS) return false;
  if (!tuTaiDuocLucNay(doc, win)) return false;
  try { if (win.sessionStorage.getItem(KHOA_DA_TAI) === st.mayChu?.banGiaoDien) return false; } catch { /* */ }
  return true;
}

let daChay = false;
/** Gắn một lần cho cả app (main.tsx): hỏi ngay, rồi 5 phút/lần, lúc quay lại / rời tab, lúc có mạng lại. */
export function batDauTheoDoi(win: Window = window, doc: Document = document): () => void {
  if (daChay) return () => {};
  daChay = true;
  dat({ cuaToi: banCuaToi(doc) });
  const thuTuTai = () => { if (nenTuTai(doc, win)) void taiBanMoi(win, { tuDong: true }); };
  // Chỉ tự tải theo kết quả của CHÍNH lần hỏi vừa xong (true) — hỏi hỏng (null) thì thôi.
  const hoi = () => { void kiemTraBanMoi().then((co) => { if (co === true) thuTuTai(); }); };
  // Quay lại / rời tab, có mạng lại: vừa hỏi thành công chưa tới 1 phút thì dùng luôn kết luận đó.
  const hoiNeuCan = () => {
    if (!st.hoiHong && Date.now() - st.hoiLuc < KHOANG_NGHI_MS) thuTuTai();
    else hoi();
  };
  hoi();
  const t = win.setInterval(hoi, CHU_KY_MS);
  doc.addEventListener("visibilitychange", hoiNeuCan);
  win.addEventListener("online", hoiNeuCan);
  return () => { daChay = false; win.clearInterval(t); doc.removeEventListener("visibilitychange", hoiNeuCan); win.removeEventListener("online", hoiNeuCan); };
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
