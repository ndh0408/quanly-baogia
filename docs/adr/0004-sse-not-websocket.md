# ADR 0004 — SSE, không WebSocket

**Trạng thái:** đã chấp nhận

## Bối cảnh

Client cần cập nhật realtime: tổng tiền đổi, thông báo, thu hồi phiên, và
presence "ai đang mở báo giá này".

## Quyết định

Server-Sent Events (`src/sse.ts`), có kênh Redis Pub/Sub để lan giữa các instance.

## Lý do

Mọi luồng đều **một chiều: server → client**. Client gửi ngược lại bằng lệnh HTTP
bình thường, vốn đã có sẵn xác thực, phân quyền, validate và rate-limit.

SSE là HTTP thuần: đi qua Cloudflare Tunnel và proxy ngược không cần cấu hình
đặc biệt, tự reconnect trong trình duyệt, và không cần thư viện phía server.
WebSocket sẽ thêm một giao thức, một đường xác thực, và một lớp cần tự lo
reconnect — để đổi lấy một chiều truyền mà ta không dùng.

## Hệ quả

- Nén **phải** tắt cho luồng SSE (compressor gom buffer làm mất sự kiện). Xử lý
  trong `src/app.ts` bằng filter quyết định ở thời điểm request.
- Cần keepalive (25s) để proxy không cắt kết nối nhàn rỗi.
- **Bản đồ presence là in-process**, không qua Redis. Chạy nhiều replica thì danh
  sách "ai đang sửa" không đầy đủ. Hạn chế đã biết, chưa sửa.
- Sự kiện presence chỉ gửi cho người đang mở đúng báo giá đó — phát cho tất cả sẽ
  rò metadata (dựng được sơ đồ ai-đang-làm-báo-giá-nào kèm họ tên, chỉ bằng cách
  ngồi nghe SSE).

## Đường lùi

Bỏ realtime hoàn toàn (client quay lại hỏi định kỳ) là đường lùi **rẻ và tức thì**: SSE ở đây chỉ
đẩy thông báo và tín hiệu làm mới, không có luồng nghiệp vụ nào phụ thuộc nó. Gỡ `EventSource` ở
`web/src/components/Shell.tsx` và đặt một `setInterval` gọi `api.unreadCount()` là xong.

Đường lùi thứ hai (đổi sang WebSocket) **đắt hơn nhiều** vì nó kéo theo hạ tầng: Cloudflare Tunnel,
cân bằng tải và mọi proxy ở giữa phải hỗ trợ nâng cấp giao thức, còn SSE chỉ là HTTP thường. Đó
chính là lý do của quyết định này — nên nếu lật, phải lật vì một yêu cầu HAI CHIỀU có thật, không
vì "WebSocket hiện đại hơn".
