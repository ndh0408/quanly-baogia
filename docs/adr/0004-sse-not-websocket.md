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
