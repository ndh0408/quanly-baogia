// TẮT MÁY ÊM CHO HTTP KHI KEEP-ALIVE DÀI HƠN HẠN TẮT (soát chéo http#12, HTTP-07 × HTTP-08).
//
// Tách khỏi src/server.ts để test được bằng http.Server thật: nạp server.ts là mở cổng + nối CSDL.
//
// VÌ SAO KHÔNG ĐỦ `server.close()` TRẦN: nó chỉ gọi `closeIdleConnections()` MỘT lần, ngay lúc gọi,
// và bỏ qua socket nào đang có request dở. Request đó trả xong vẫn mang `Connection: keep-alive`
// (`Keep-Alive: timeout=95`) và socket được giữ tới keepAliveTimeout — 95s (HTTP-07, dài hơn pool của
// cloudflared), trong khi hạn cưỡng bức là 70s (HTTP-08, SHUTDOWN_TIMEOUT_MS). Nên chỉ cần MỘT request
// đang chạy lúc SIGTERM là callback của close() không bao giờ kịp chạy: tiến trình treo đủ 70s (kết
// nối mới bị từ chối → Cloudflare 502, container mới chưa dựng), cloudflared còn dùng lại chính socket
// đó cho request MỚI, rồi `exit(1)` cắt ngang request đang bay. Đo trên Node 24: callback không chạy
// sau 11s; có hai bước dưới đây thì chạy ~0,3s sau khi request dở trả xong.
//
// KHÔNG hạ keepAliveTimeout: HTTP-07 vẫn cần nó cho lúc chạy bình thường. Chỉ đổi đường TẮT.
import type { Server, ServerResponse } from "node:http";

/** Chu kỳ vét socket vừa rỗi sau khi bắt đầu tắt. Đủ ngắn để không ai nhận ra, đủ thưa để rẻ. */
const CHU_KY_VET_MS = 250;

/**
 * Gắn đường tắt êm lên `server` — gọi MỘT lần ngay sau khi tạo server, TRƯỚC khi có request.
 * Trả về `tat(onXong)`: đóng cổng nghe, đóng dần mọi socket keep-alive, gọi `onXong` khi hết kết nối.
 */
export function ganTatMayEm(server: Server) {
  let dangTat = false;

  // BƯỚC 2 — báo proxy ĐỪNG DÙNG LẠI socket. Bọc `writeHead` chứ không đặt header lúc request mới tới:
  // request đã chạy TRƯỚC SIGTERM (đúng ca cần phủ) chỉ ghi header SAU đó, và Express luôn đi qua
  // `writeHead` (kể cả header ngầm của `res.end`). `Connection: close` khiến Node đóng socket ngay
  // khi phản hồi xong — không chờ bước vét, và cloudflared không gửi request mới lên socket sắp chết.
  // Request mà header đã gửi trước lúc tắt (tải file dạng luồng) thì không báo kịp — bước 1 lo.
  server.prependListener("request", (_req, res: ServerResponse) => {
    const goc = res.writeHead;
    res.writeHead = function (this: ServerResponse, ...thamSo: unknown[]) {
      if (dangTat && !this.headersSent) this.setHeader("Connection", "close");
      return (goc as (...a: unknown[]) => ServerResponse).apply(this, thamSo);
    } as ServerResponse["writeHead"];
  });

  return {
    tat(onXong: () => void) {
      // Tín hiệu thứ hai (SIGINT sau SIGTERM) không dựng thêm vòng vét / callback thứ hai.
      if (dangTat) return;
      dangTat = true;
      // BƯỚC 1 — chốt chính: sau close(), LIÊN TỤC đóng socket vừa rỗi. Socket có request dở sẽ
      // rỗi ngay khi request đó xong; close() trần chỉ nhìn một lần nên không bao giờ thấy nó rỗi.
      const vet = setInterval(() => server.closeIdleConnections(), CHU_KY_VET_MS);
      vet.unref();
      server.close(() => {
        clearInterval(vet);
        onXong();
      });
    },
  };
}
