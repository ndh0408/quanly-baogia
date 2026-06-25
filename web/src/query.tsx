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

// Cầu nối realtime: SSE 'changed' (Shell dispatch 'realtime:changed') → làm MỌI query cũ → active query
// tự refetch. Mirror đúng hành vi "đổi dữ liệu → list tự tải lại" của app cũ. Mount dưới QueryClientProvider.
export function RealtimeBridge() {
  const qc = useQueryClient();
  useEffect(() => {
    // THROTTLE leading-edge (giữ hành vi): sự kiện ĐƠN LẺ → invalidate TỨC THÌ như cũ; khi nhiều client
    // cùng đổi trong ~800ms (burst) → GOM thành 1 lần refetch thay vì mỗi client dội 1 lần lên server
    // (chống thundering-herd). KHÔNG làm chậm trường hợp thường, KHÔNG đổi dữ liệu hiển thị.
    let last = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const WINDOW = 800;
    const on = () => {
      const now = Date.now();
      if (now - last >= WINDOW) { last = now; qc.invalidateQueries(); }
      else if (!timer) {
        timer = setTimeout(() => { timer = undefined; last = Date.now(); qc.invalidateQueries(); }, WINDOW - (now - last));
      }
    };
    window.addEventListener("realtime:changed", on);
    return () => { window.removeEventListener("realtime:changed", on); if (timer) clearTimeout(timer); };
  }, [qc]);
  return null;
}
