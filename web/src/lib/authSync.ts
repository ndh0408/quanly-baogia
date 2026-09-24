// ============================================================================
// ĐỒNG BỘ ĐĂNG NHẬP / ĐĂNG XUẤT GIỮA CÁC TAB (FE-05)
//
// Cookie phiên `qly.sid` dùng CHUNG cho mọi tab của một trình duyệt, còn danh tính `me` + cache React
// Query + editor đang soạn thì sống RIÊNG trong từng tab. Trước đây không tab nào báo cho tab nào:
// tab 1 đăng xuất rồi B đăng nhập → tab 2 vẫn hiện tên A, vẫn giữ dữ liệu của A, nhưng mọi request
// đi bằng cookie của B (200, auth:ok) → bấm Lưu ở tab 2 là ghi dưới danh tính B.
//
// Kênh BroadcastChannel báo "vừa đăng nhập người X" / "vừa đăng xuất". Tab nghe thấy danh tính của
// mình không còn đúng thì nạp lại sạch. Trình duyệt quá cũ không có BroadcastChannel thì thôi —
// hành vi y như trước, không vỡ gì.
// ============================================================================
const TEN_KENH = "quanly-auth";

export type TinAuth = { type: "login"; userId: number } | { type: "logout" };

function moKenh(): BroadcastChannel | null {
  try {
    return typeof BroadcastChannel === "function" ? new BroadcastChannel(TEN_KENH) : null;
  } catch {
    return null;
  }
}

function phat(tin: TinAuth) {
  const k = moKenh();
  if (!k) return;
  try { k.postMessage(tin); } catch { /* bỏ qua */ }
  k.close();
}
export const phatDangNhap = (userId: number) => phat({ type: "login", userId });
export const phatDangXuat = () => phat({ type: "logout" });

/** Tab đang giữ danh tính `meId` có còn đúng sau tin này không. */
export function canNapLai(tin: unknown, meId: number | null | undefined): boolean {
  if (meId == null || !tin || typeof tin !== "object") return false;
  const t = tin as Partial<TinAuth> & { userId?: unknown };
  if (t.type === "logout") return true;
  if (t.type === "login") return Number(t.userId) !== meId;
  return false;
}

/** Tin này là tab khác vừa ĐĂNG NHẬP LẠI chính người đang giữ ở tab này (phiên chung sống lại). */
export function laDangNhapLaiCungNguoi(tin: unknown, meId: number | null | undefined): boolean {
  if (meId == null || !tin || typeof tin !== "object") return false;
  const t = tin as Partial<TinAuth> & { userId?: unknown };
  return t.type === "login" && Number(t.userId) === meId;
}

/**
 * Nghe tin từ tab khác. Trả hàm huỷ. `layMeId` đọc danh tính HIỆN TẠI mỗi lần có tin.
 * `songLai` (tuỳ chọn): tab khác vừa đăng nhập lại CÙNG người — tab này đang hiện lớp phủ "Phiên đăng
 * nhập đã hết" / đang chặn lời gọi (api.ts) thì gỡ ra, khỏi bắt người dùng đăng nhập lần hai (diễn tập
 * 2026-09-25: tab bị chặn không tự hết chặn khi đăng nhập lại ở tab khác).
 */
export function ngheAuth(layMeId: () => number | null | undefined, napLai: () => void, songLai?: () => void): () => void {
  const k = moKenh();
  if (!k) return () => {};
  k.onmessage = (e) => {
    const me = layMeId();
    if (canNapLai(e.data, me)) napLai();
    else if (songLai && laDangNhapLaiCungNguoi(e.data, me)) songLai();
  };
  return () => k.close();
}

/**
 * Đăng xuất. Chỉ coi là XONG khi máy chủ đã huỷ phiên — hoặc phiên vốn đã chết (401). Bản cũ nuốt
 * mọi lỗi rồi vẫn xoá nháp + nạp lại như đã đăng xuất: mất mạng lúc bấm là người dùng TƯỞNG đã thoát
 * trên máy chung, trong khi phiên A vẫn sống khi mạng về.
 */
export async function dangXuat(logout: () => Promise<unknown>): Promise<boolean> {
  try {
    await logout();
    return true;
  } catch (e) {
    return (e as { status?: number } | null)?.status === 401;
  }
}
