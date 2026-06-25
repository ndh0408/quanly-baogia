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
    const on = () => { qc.invalidateQueries(); };
    window.addEventListener("realtime:changed", on);
    return () => window.removeEventListener("realtime:changed", on);
  }, [qc]);
  return null;
}
