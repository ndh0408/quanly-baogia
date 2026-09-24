// ┌─────────────────────────────────────────────────────────────────────────────┐
// │ BÁO CÓ BẢN MỚI SAU MỖI LẦN DEPLOY (chủ repo 2026-09-24).                     │
// └─────────────────────────────────────────────────────────────────────────────┘
//
// Service worker cất sẵn bản giao diện trong máy: tab mở từ trước lúc deploy chạy bản CŨ tới khi tự tải
// lại (có khi phải hai lần), mà người dùng không biết Ctrl+Shift+R. Ở đây:
//   1. Hỏi máy chủ `/api/phien-ban` (5 phút/lần, lúc quay lại tab, lúc có mạng lại): tên tệp JS chính
//      máy chủ đang phát khác tệp trang này đang chạy → CÓ BẢN MỚI.
//   2. Tự tải bản mới CHỈ khi: tab đã NẰM NỀN ≥ 5 phút + trang đang mở TỰ KHAI cho tự tải
//      (useTrangAnToan) + không có gì dở (chưa lưu, form mở, ô đang gõ, lệnh lưu / lượt tạo file đang
//      chạy, đang xem thử quyền) + lần hỏi máy chủ vừa rồi THÀNH CÔNG. Người dùng không thấy gì.
//   3. Còn lại chỉ NHẮC (dải thông báo + nút "Tải bản mới"); đang dở — hay trang không tự khai an toàn —
//      thì hỏi trước khi tải.
// "Tải bản mới" = gỡ service worker + xoá kho cache của nó rồi tải lại — đúng thứ Ctrl+Shift+R + gỡ SW
// vẫn phải làm tay, nên lần tải lại đầu tiên đã là bản mới (không phải lần thứ hai).
//
// VÌ SAO "TRANG TỰ KHAI AN TOÀN" MÀ KHÔNG ĐOÁN TỪ DOM (soát 2026-09-24): bản đầu suy "không dở gì" từ ba
// tín hiệu (cờ chưa-lưu, hộp thoại, ô đang có con trỏ) — và tự tải lại xoá im lặng wizard Tạo báo giá,
// báo giá mới vừa ra khỏi wizard (#/rnew, chưa gõ gì nên cờ chưa bật), ma trận Phân quyền tick dở…:
// những màn giữ dữ liệu trong bộ nhớ mà không bật tín hiệu nào. Đoán thì luôn sót. Nay MẶC ĐỊNH là
// KHÔNG an toàn: chỉ trang tự khai mới được tải mà không hỏi; trang mới thêm sau này quên khai thì chỉ
// bị nhắc. Hai mức khai: trang CHỈ XEM (Danh sách, Tổng quan…) cho cả tự tải; trình soạn / Account HN
// đã lưu sạch chỉ cho bấm tay khỏi hỏi (`tuTai: false`) — tự tải ở đó mất sheet đang mở, vị trí cuộn,
// lịch sử Ctrl+Z (soát vòng 2).
import { useEffect, useRef, useSyncExternalStore } from "react";
import { soLenhGhiDangBay, isPreviewMode } from "./api";

export type PhienBanMayChu = { banGiaoDien: string | null; sha: string | null; capNhatLuc: string | null };
export type TrangThai = {
  cuaToi: string | null;          // bản giao diện trang này đang chạy
  mayChu: PhienBanMayChu | null;  // lần hỏi THÀNH CÔNG gần nhất
  coBanMoi: boolean;
  anDenLuc: number;               // người dùng bấm ✕ → ẩn dải tới lúc này (ms)
  dangTai: boolean;
  hoiLuc: number;                 // lúc của lần hỏi THÀNH CÔNG gần nhất (ms) — 0 = chưa hỏi được lần nào
  hoiHong: boolean;               // lần hỏi GẦN NHẤT hỏng (mất mạng / máy chủ đang khởi động lại)
  anTuLuc: number;                // tab bắt đầu nằm nền lúc này (ms) — 0 = đang hiện
};

export const CHU_KY_MS = 5 * 60 * 1000;
export const AN_TAM_MS = 30 * 60 * 1000;
/** Quay lại tab / có mạng lại liên tục thì không hỏi dồn: cách lần hỏi thành công trước ít nhất chừng này. */
export const KHOANG_NGHI_MS = 60 * 1000;
/** Tự tải chỉ dựa vào kết luận còn MỚI — tab nằm nền nhiều giờ không được tự tải theo một lần hỏi cũ. */
export const KET_LUAN_MOI_MS = 2 * 60 * 1000;
/**
 * Tab phải nằm nền ít nhất chừng này mới được tự tải. Rời tab vài giây (Alt+Tab sang Zalo chép một con
 * số) mà quay lại thấy trang đang tải lại là "tự tải khi người dùng đang nhìn" trá hình (soát vòng 2).
 */
export const NAM_NEN_TOI_THIEU_MS = 5 * 60 * 1000;
/** Hỏi máy chủ quá chừng này (máy chủ nhận kết nối mà không trả lời) → coi như hỏng. */
export const HAN_HOI_MS = 8 * 1000;
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
type Khai = { f: () => boolean; tuTai: boolean };
const trangAnToan = new Set<Khai>();
/**
 * Đăng ký một hàm hỏi "trang này tải lại lúc này có an toàn không". Trả hàm gỡ.
 * `tuTai: false` = chỉ cho BẤM TAY khỏi hỏi lại, không cho tự tải (xem đầu tệp).
 */
export function dangKyTrangAnToan(f: () => boolean = () => true, { tuTai = true }: { tuTai?: boolean } = {}): () => void {
  const o: Khai = { f, tuTai };
  trangAnToan.add(o);
  return () => { trangAnToan.delete(o); };
}
/**
 * Trang gọi hook này để khai: tải lại trang lúc này không làm mất gì (tuỳ chọn `f` = điều kiện, vd trình
 * soạn: "đã lưu sạch"). Không gọi = không an toàn — tự tải không bao giờ chạy, bấm tay thì bị hỏi lại.
 */
export function useTrangAnToan(f?: () => boolean, opts?: { tuTai?: boolean }) {
  const ref = useRef(f);
  ref.current = f;
  const tuTai = opts?.tuTai ?? true;
  useEffect(() => dangKyTrangAnToan(() => (ref.current ? ref.current() : true), { tuTai }), [tuTai]);
}
/**
 * Có ít nhất một trang đã khai, và MỌI lời khai đều nói an toàn (lớp phủ đăng nhập lại khai "không" đè lên
 * trang cũ nên trang bên dưới không bị tải lại trong lúc đó). `tuDong`: thêm điều kiện mọi lời khai đều
 * cho TỰ tải.
 */
export const laTrangAnToan = (tuDong = false) => trangAnToan.size > 0
  && [...trangAnToan].every((o) => { if (tuDong && !o.tuTai) return false; try { return o.f(); } catch { return false; } });

// ── VIỆC NỀN ĐANG CHẠY (tạo file Excel/PDF) ─────────────────────────────────────────────────────
let viecNen = 0;
/**
 * Báo "đang có việc chạy nền mà tải lại sẽ cắt ngang" (lượt tạo file Excel/PDF — có khi vài phút ở chế độ
 * nền). Trả hàm báo xong (gọi nhiều lần vô hại).
 */
export function batDauViecNen(): () => void {
  viecNen++;
  let xong = false;
  return () => { if (!xong) { xong = true; viecNen--; } };
}

export type DangDo = "chua-luu" | "form-mo" | "dang-go" | "dang-tao-file" | "xem-thu" | "chua-ro" | null;
/**
 * Người dùng có đang làm dở gì không — tải lại lúc này có làm mất gì không.
 *   · "xem-thu" : admin đang XEM THỬ quyền — chế độ này chỉ sống trong bộ nhớ; tải lại là rớt về quyền
 *     THẬT mà người dùng có thể không để ý (lệnh "thử" thành lệnh ghi thật). Xét ĐẦU TIÊN: đang xem thử
 *     thì mọi lệnh Lưu chỉ là "thành công giả", câu "Lưu rồi tải" hay "form sẽ mất" đều nói sai chỗ
 *     quan trọng nhất (soát vòng 3).
 *   · "chua-luu": trình soạn báo giá / màn Account HN còn thay đổi chưa lưu (cờ dùng chung __editorDirty)
 *   · "form-mo" : đang mở một hộp thoại / form (thêm-sửa Nhân sự, Danh bạ, Khách, Thanh toán…)
 *   · "dang-go" : tiêu điểm đang ở một ô nhập ĐƯỢC SỬA và ĐÃ CÓ CHỮ (ô hoá đơn đang gõ, ô tìm…).
 *     Ô TRỐNG thì không mất gì: trang đăng nhập tự đặt con trỏ vào ô tên — tính ô trống là "đang gõ"
 *     thì dải hiện "Rời ô đang gõ…" vô lý, và tab đăng nhập để nằm nền không bao giờ tự lên bản mới.
 *   · "dang-tao-file": lượt tạo file Excel/PDF đang chạy (tải lại là file không bao giờ về, không báo gì)
 *   · "chua-ro" : trang đang mở KHÔNG tự khai an toàn (useTrangAnToan) — có thể còn dữ liệu trong bộ nhớ.
 */
export function dangDo(win: Window = window, doc: Document = document): DangDo {
  if (isPreviewMode()) return "xem-thu";
  if ((win as Window & { __editorDirty?: boolean }).__editorDirty) return "chua-luu";
  if (doc.querySelector('.modal-backdrop, [role="dialog"][aria-modal="true"]')) return "form-mo";
  const a = doc.activeElement as (HTMLInputElement & HTMLTextAreaElement) | null;
  if (a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.tagName === "SELECT" || a.isContentEditable)) {
    const loai = (a.getAttribute("type") || "").toLowerCase();
    const khongPhaiGo = ["checkbox", "radio", "button", "submit", "reset", "file", "range", "color"].includes(loai);
    const coChu = a.isContentEditable ? !!a.textContent?.trim() : a.value !== "";
    if (!khongPhaiGo && !a.readOnly && !a.disabled && coChu) return "dang-go";
  }
  if (viecNen > 0) return "dang-tao-file";
  if (!laTrangAnToan()) return "chua-ro";
  return null;
}

// ── kho trạng thái dùng chung (useSyncExternalStore) ─────────────────────────────────────────────
const DAU: TrangThai = { cuaToi: null, mayChu: null, coBanMoi: false, anDenLuc: 0, dangTai: false, hoiLuc: 0, hoiHong: false, anTuLuc: 0 };
let st: TrangThai = { ...DAU };
const nghe = new Set<() => void>();
const dat = (p: Partial<TrangThai>) => { st = { ...st, ...p }; nghe.forEach((f) => f()); };
export const layTrangThai = () => st;
export function usePhienBan(): TrangThai {
  return useSyncExternalStore((f) => { nghe.add(f); return () => { nghe.delete(f); }; }, layTrangThai, layTrangThai);
}
/** Chỉ cho test: đưa kho (và sổ trang an toàn, việc nền) về trạng thái đầu. */
export function _datLai(p: Partial<TrangThai> = {}) { st = { ...DAU, ...p }; trangAnToan.clear(); viecNen = 0; nghe.forEach((f) => f()); }

/**
 * Hỏi máy chủ một lần. `true` = có bản mới, `false` = đang dùng bản mới nhất, `null` = KHÔNG hỏi được
 * (mất mạng, máy chủ đang khởi động lại giữa lúc deploy, quá `hanMs` không trả lời) — giữ nguyên kết luận
 * cũ, không báo gì.
 */
export async function kiemTraBanMoi(fetchFn: typeof fetch = fetch, hanMs = HAN_HOI_MS): Promise<boolean | null> {
  const cuaToi = st.cuaToi ?? banCuaToi();
  // Không có hạn giờ thì máy chủ nhận kết nối mà không trả lời (event loop bận, Cloudflare chờ origin tới
  // ~100 giây) làm dải kẹt "Đang tải bản mới…" và nút Thử lại trông như chết (soát vòng 2).
  const ac = typeof AbortController === "function" ? new AbortController() : null;
  const hen = ac ? setTimeout(() => ac.abort(), hanMs) : undefined;
  try {
    const r = await fetchFn("/api/phien-ban", { cache: "no-store", credentials: "same-origin", signal: ac?.signal });
    if (!r.ok) { dat({ hoiHong: true }); return null; }
    const mayChu = (await r.json()) as PhienBanMayChu;
    const coBanMoi = khacBan(cuaToi, mayChu.banGiaoDien);
    dat({ cuaToi, mayChu, coBanMoi, hoiLuc: Date.now(), hoiHong: false });
    return coBanMoi;
  } catch {
    dat({ hoiHong: true });
    return null;
  } finally {
    if (hen !== undefined) clearTimeout(hen);
  }
}

/** Người dùng bấm ✕: ẩn dải 30 phút (bản mới vẫn còn đó — hết giờ thì nhắc lại). */
export function anTam(bayGio = Date.now()) { dat({ anDenLuc: bayGio + AN_TAM_MS }); }
/** Người dùng TỰ bấm "Kiểm tra bản mới" → hiện lại dải ngay dù trước đó đã ẩn. */
export function hienLai() { dat({ anDenLuc: 0 }); }

/** Điều kiện của ĐƯỜNG TỰ ĐỘNG tại đúng lúc này (dùng cả lúc quyết lẫn ngay trước khi tải lại). */
function tuTaiDuocLucNay(doc: Document, win: Window, bayGio: number): boolean {
  if (doc.visibilityState !== "hidden") return false;                // người dùng đang nhìn → không bao giờ
  if (!st.anTuLuc || bayGio - st.anTuLuc < NAM_NEN_TOI_THIEU_MS) return false;   // mới rời tab — sắp quay lại
  if (win.navigator && win.navigator.onLine === false) return false; // mất mạng → tải lại là ra trang lỗi
  if (soLenhGhiDangBay() > 0) return false;                          // lệnh lưu đang chạy
  if (dangDo(win, doc) !== null) return false;
  return laTrangAnToan(true);                                        // trang cho TỰ tải (không chỉ bấm tay)
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
 * KHÔNG đụng cờ chưa-lưu: dải KHÔNG cho "Tải luôn" khi còn thay đổi chưa lưu (chỉ "Lưu rồi tải"), và nếu
 * vì lý do gì vẫn tới đây lúc còn chưa lưu thì hộp "Tải lại trang?" của trình duyệt hỏi lần cuối (máy
 * tính; iPhone/iPad KHÔNG có hộp đó — nên dải mới không cho "Tải luôn", soát vòng 3). Soát vòng 2: bản
 * trước hạ chốt đó sau khi ghi bản nháp — nhưng bản nháp lệch mốc (người khác vừa lưu, account HN vừa gửi
 * giá) bị bỏ im lặng lúc mở lại, quá 1MB thì bị bóc ảnh: hạ chốt là mất dữ liệu đúng lúc app hứa "được giữ".
 */
/** Còn thay đổi THẬT chưa lưu (lúc xem thử quyền thì mọi lệnh Lưu là giả — không tính). */
const conChuaLuu = (win: Window) => !isPreviewMode() && !!(win as Window & { __editorDirty?: boolean }).__editorDirty;

export async function taiBanMoi(win: Window = window, { tuDong = false }: { tuDong?: boolean } = {}): Promise<boolean> {
  if (st.dangTai) return false;
  // Còn thay đổi chưa lưu thì KHÔNG tải — kể cả khi phía gọi quên hỏi (iPhone/iPad không có hộp "Tải lại
  // trang?" để đỡ). Kiểm cả ở đầu lẫn ngay trước reload: người dùng có thể gõ tiếp trong lúc chờ hỏi máy
  // chủ / gỡ SW (soát vòng 3).
  if (conChuaLuu(win)) return false;
  dat({ dangTai: true });
  const thoi = () => { dat({ dangTai: false }); return false; };
  for (let cho = 0; soLenhGhiDangBay() > 0; cho += 250) {
    if (cho >= CHO_LENH_GHI_MS) return thoi();
    await ngu(250);
  }
  if ((await kiemTraBanMoi()) !== true) return thoi();
  await goBoNhoDem(win);
  if (tuDong && !tuTaiDuocLucNay(win.document, win, Date.now())) return thoi();   // SW đã gỡ không sao — lần tải sau tự đăng ký lại
  if (conChuaLuu(win)) return thoi();
  // Khoá chống tải vòng tròn chỉ ghi khi trang THẬT SỰ rời đi: ghi trước reload mà hộp "Tải lại trang?"
  // bị Hủy thì khoá nằm lại và tab đó không bao giờ tự lên bản này nữa (soát vòng 3).
  const dich = st.mayChu?.banGiaoDien;
  const ghiKhoa = () => { try { if (dich) win.sessionStorage.setItem(KHOA_DA_TAI, dich); } catch { /* */ } };
  win.addEventListener("pagehide", ghiKhoa, { once: true });
  win.location.reload();
  // Hộp "Tải lại trang?" của trình duyệt bị bấm Hủy → trang ở lại: trả dải về bình thường, đừng kẹt mãi ở
  // "Đang tải bản mới…", và gỡ trình ghi khoá (rời trang sau này không phải do lần tải này).
  win.setTimeout(() => { win.removeEventListener("pagehide", ghiKhoa); dat({ dangTai: false }); }, 3000);
  return true;
}

let dangTaiLai = false;
/**
 * Nút "Thử lại" (màn không kết nối được máy chủ, màn lỗi của một trang) / "Tải lại trang" (màn lỗi hiển
 * thị): máy chủ đang phát bản KHÁC thì gỡ SW trước để lần này đã là bản mới; không hỏi được máy chủ (hạn
 * 4 giây) thì GIỮ SW (vỏ offline của nó mới hiện được màn "Không kết nối được máy chủ" thay cho trang lỗi
 * của trình duyệt) và tải lại thường. Bấm dồn trong lúc đang hỏi thì bỏ qua.
 */
export async function taiLaiTrang(win: Window = window): Promise<void> {
  if (dangTaiLai) return;
  dangTaiLai = true;
  try {
    if ((await kiemTraBanMoi(fetch, 4000)) === true) await goBoNhoDem(win);
  } finally {
    dangTaiLai = false;
  }
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
 * hỏi gần nhất không hỏng), tab nằm nền đủ lâu, có mạng, không lệnh lưu nào đang chạy, trang cho tự tải
 * và không dở gì, chưa từng tự tải tới đúng bản này (chống vòng tròn).
 */
export function nenTuTai(doc: Document = document, win: Window = window, bayGio = Date.now()): boolean {
  if (!st.coBanMoi || st.dangTai) return false;
  if (st.hoiHong || bayGio - st.hoiLuc > KET_LUAN_MOI_MS) return false;
  if (!tuTaiDuocLucNay(doc, win, bayGio)) return false;
  try { if (win.sessionStorage.getItem(KHOA_DA_TAI) === st.mayChu?.banGiaoDien) return false; } catch { /* */ }
  return true;
}

let daChay = false;
/** Gắn một lần cho cả app (main.tsx): hỏi ngay, rồi 5 phút/lần, lúc quay lại / rời tab, lúc có mạng lại. */
export function batDauTheoDoi(win: Window = window, doc: Document = document): () => void {
  if (daChay) return () => {};
  daChay = true;
  dat({ cuaToi: banCuaToi(doc), anTuLuc: doc.visibilityState === "hidden" ? Date.now() : 0 });
  const thuTuTai = () => { if (nenTuTai(doc, win)) void taiBanMoi(win, { tuDong: true }); };
  // Chỉ tự tải theo kết quả của CHÍNH lần hỏi vừa xong (true) — hỏi hỏng (null) thì thôi.
  const hoi = () => { void kiemTraBanMoi().then((co) => { if (co === true) thuTuTai(); }); };
  // Quay lại / rời tab, có mạng lại: vừa hỏi thành công chưa tới 1 phút thì dùng luôn kết luận đó.
  // Rời tab chỉ ghi mốc bắt đầu nằm nền — tự tải để nhịp 5 phút lo khi đã nằm nền đủ lâu.
  const hoiNeuCan = () => {
    if (!st.hoiHong && Date.now() - st.hoiLuc < KHOANG_NGHI_MS) thuTuTai();
    else hoi();
  };
  const onVis = () => {
    if (doc.visibilityState === "hidden") { if (!st.anTuLuc) dat({ anTuLuc: Date.now() }); }
    else if (st.anTuLuc) dat({ anTuLuc: 0 });
    hoiNeuCan();
  };
  hoi();
  const t = win.setInterval(hoi, CHU_KY_MS);
  doc.addEventListener("visibilitychange", onVis);
  win.addEventListener("online", hoiNeuCan);
  return () => { daChay = false; win.clearInterval(t); doc.removeEventListener("visibilitychange", onVis); win.removeEventListener("online", hoiNeuCan); };
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
