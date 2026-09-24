import { useEffect, useState } from "react";
import { QueryClient, useQueryClient } from "@tanstack/react-query";

// Nền TanStack Query. Cấu hình BẢO TOÀN HÀNH VI app hiện tại:
// - refetchOnWindowFocus: false → app cũ KHÔNG refetch khi focus lại; giữ nguyên.
// - staleTime ngắn → điều hướng qua-lại hiện tức thì (cache) nhưng vẫn tươi; SSE invalidate khi đổi thật.
// - retry 1 → chịu lỗi mạng thoáng qua (app cũ 0 retry; 1 lần không đổi hành vi ca thành công).
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 5_000,
      gcTime: 5 * 60_000,
      retry: 1,
    },
  },
});

// Debounce 1 giá trị (thay cho mẫu useEffect+setTimeout cũ ở các ô tìm kiếm).
export function useDebouncedValue<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    if (ms <= 0) { setV(value); return; }
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

// FE-18: sự kiện nào làm tươi query nào. Máy chủ (src/db.ts RT_ENTITY → src/sse.ts emitChange) chỉ
// bắn 'changed' cho ba thực thể và payload có sẵn `entity`. Trước đây client bỏ qua payload và làm tươi
// MỌI query đang mở: kế toán mở Hóa đơn thì mỗi lần Sales bấm Lưu là tải lại cả /quotes/projects
// (≤2000 báo giá), Dashboard gọi lại 4 lệnh analytics — kể cả khi thứ đổi chỉ là một khách hàng.
// Khoá nào hiện TÊN của thực thể kia (tên khách trên danh sách báo giá, tên người tạo trên Dashboard)
// cũng nằm trong danh sách. Nhật ký hoạt động đổi theo mọi lần ghi. Không rõ thực thể → làm tươi tất cả
// (hành vi cũ) — thà thừa còn hơn hiện số cũ.
// "personnel" nằm trong entity=quote (soát chéo files#5): danh sách Nhân sự ghép cột "Tiền trước thuế"
// và tham chiếu dự án từ báo giá ĐÃ CHỐT (personnelService.listPersonnel → buildProjectRef) — lưu, chốt,
// bỏ chốt, xoá báo giá đều làm đổi các cột đó. invalidateQueries chỉ refetch query ĐANG MỞ, nên chỉ tốn
// khi có người đang ở trang Nhân sự. KHÔNG cần ở customer/user: accountName/company được CHÉP vào hồ sơ
// lúc chọn dự án, danh sách không hiện tên người tạo báo giá.
export const KHOA_THEO_THUC_THE: Record<string, string[]> = {
  quote: ["quotes", "quoteProjects", "dashboard", "quote-internal", "audit", "personnel"],
  customer: ["customers", "quotes", "quoteProjects", "dashboard", "audit"],
  user: ["users", "permissions", "perm-catalog", "quotes", "quoteProjects", "dashboard", "audit"],
};

// Cầu nối realtime: SSE 'changed' (Shell dispatch 'realtime:changed' kèm detail {entity, action}) →
// làm tươi đúng các query liên quan → query đang mở tự refetch. Mount dưới QueryClientProvider.
export function RealtimeBridge() {
  const qc = useQueryClient();
  useEffect(() => {
    // THROTTLE leading-edge (giữ hành vi): sự kiện ĐƠN LẺ → invalidate TỨC THÌ như cũ; khi nhiều client
    // cùng đổi trong ~800ms (burst) → GOM thành 1 lần refetch thay vì mỗi client dội 1 lần lên server
    // (chống thundering-herd). KHÔNG làm chậm trường hợp thường, KHÔNG đổi dữ liệu hiển thị.
    let last = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const WINDOW = 800;
    // Gom các khoá cần làm tươi trong một nhịp; `null` = không rõ thực thể → làm tươi tất cả.
    let cho: Set<string> | null = new Set();
    const xa = () => {
      const k = cho; cho = new Set();
      if (k === null) { qc.invalidateQueries(); return; }
      for (const key of k) qc.invalidateQueries({ queryKey: [key] });
    };
    const on = (ev: Event) => {
      const entity = (ev as CustomEvent<{ entity?: string } | null>).detail?.entity;
      const ds = entity ? KHOA_THEO_THUC_THE[entity] : undefined;
      if (!ds) cho = null;
      else if (cho) ds.forEach((k) => cho!.add(k));
      const now = Date.now();
      if (now - last >= WINDOW) { last = now; xa(); }
      else if (!timer) {
        timer = setTimeout(() => { timer = undefined; last = Date.now(); xa(); }, WINDOW - (now - last));
      }
    };
    window.addEventListener("realtime:changed", on);
    return () => { window.removeEventListener("realtime:changed", on); if (timer) clearTimeout(timer); };
  }, [qc]);
  return null;
}
