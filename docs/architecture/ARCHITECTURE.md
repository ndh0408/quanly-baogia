# Kiến trúc

Một **modular monolith**: một tiến trình API, một tiến trình worker, dùng chung
mã nguồn và cùng một CSDL. Cố ý không tách microservice — quy mô hiện tại không
đòi hỏi, và cái giá vận hành sẽ do đúng một người gánh.

```
                      Cloudflare Tunnel
                             │
                             ▼
   ┌─────────────────────────────────────────────┐
   │  React SPA (/)          SPA vanilla (/app)  │
   └────────────────────┬────────────────────────┘
                        │ HTTPS
                        ▼
   ┌─────────────────────────────────────────────┐
   │              Express (src/app.ts)           │
   │  helmet → compression → requestId → log     │
   │  → decompressBody → body parser → session   │
   │  → metrics → bearerAuth → enforceActiveUser │
   │  → csrfGuard → rate limit → routes          │
   └──────┬───────────────────────────┬──────────┘
          │                           │
          ▼                           ▼
   ┌─────────────┐            ┌──────────────┐
   │  services/  │            │    Redis     │
   │  (nghiệp vụ)│            │  session·SSE │
   └──────┬──────┘            │  BullMQ·rate │
          │                   └──────┬───────┘
          ▼                          ▼
   ┌─────────────┐            ┌──────────────┐
   │   Prisma    │            │   Worker     │
   │      ▼      │            │ dist/worker  │
   │ PostgreSQL  │            │ xlsx·pdf·mail│
   └─────────────┘            └──────┬───────┘
                                     ▼
                            ┌──────────────────┐
                            │  Kho object (S3) │
                            │  chứng từ · file │
                            └──────────────────┘
```

## Chuỗi middleware — thứ tự là một phần của thiết kế

Đọc `src/app.ts`. Thứ tự dưới đây **không tuỳ tiện**; đổi chỗ là mở lỗ hổng.

| # | Lớp | Chặn gì | Vì sao ở đúng chỗ này |
|---|---|---|---|
| 1 | `helmet` | CSP, HSTS, sniffing | phải bọc **mọi** response, kể cả response lỗi |
| 2 | `compression` | nén text | loại trừ SSE — compressor gom buffer làm mất sự kiện realtime |
| 3 | `requestId` | gắn id cho request | phải trước logger, nếu không log đầu tiên không có id |
| 4 | `pino-http` | log truy cập | |
| 5 | `decompressBody` | giải nén thân gửi lên | **trước** body parser vì nó thay thế luồng thân. Trần theo route: nhóm `/api/quotes` 16MB, còn lại 2MB — dùng chung 16MB nghĩa là người CHƯA đăng nhập bơm được 16MB vào bất kỳ endpoint nào |
| 6 | `express.json` | phân tích JSON | trần khớp lớp trên |
| 7 | `session` | phiên cookie (kho PG) | phải trước mọi thứ đọc `req.session` |
| 8 | `metricsMiddleware` | đo Prometheus | |
| 9 | `bearerAuth` | JWT → giả lập phiên | **trước** csrfGuard: guard cần biết `req.viaJwt` để miễn cho client Bearer |
| 10 | `enforceActiveUser` | nạp lại vai trò/trạng thái **từ CSDL** | mỗi request — admin khoá tài khoản là có hiệu lực ở request KẾ TIẾP |
| 11 | `csrfGuard` | Origin/Referer + token gắn phiên | **sau** bearerAuth, **trước** route |
| 12 | `rate limit` | chống dội | |
| 13 | routes | nghiệp vụ | |
| 14 | `notFound` → static → SPA | | `notFound` đặt **trước** static nên `/api/*` không tồn tại trả 404 JSON, không rơi vào vỏ SPA |

## Ranh giới module

```
src/routes/*.routes.ts   HTTP: phân tích, validate (zod), gọi service, trả JSON
src/services/*.ts        nghiệp vụ: giao dịch, phân quyền mức bản ghi, tính toán
src/*.ts                 hạ tầng dùng chung: db, storage, queue, sse, excel, pdf…
```

**KHÔNG có lớp repository.** Service gọi thẳng Prisma. Đây là lựa chọn có chủ ý:
Prisma đã là lớp trừu tượng hoá truy cập dữ liệu, bọc thêm một lớp chỉ để chuyển
tiếp lời gọi thì thêm file, thêm chỗ lệch, mà không thêm khả năng nào. Chỗ nào
truy vấn phức tạp thì viết hàm riêng **trong chính service đó**.

## Frontend

| Đường | Phục vụ |
|---|---|
| `/` và mọi đường không khớp | `public/app2/index.html` (React 19 + Vite, nguồn ở `web/`) |
| `/app2`, `/app2/*` | y hệt — đường dẫn lịch sử, asset build ra đó nên giữ |

**Chỉ còn một frontend.** SPA vanilla ES module ở `public/js` (phục vụ tại `/app`)
đã gỡ hẳn ngày 2026-08-26 — xem [ADR 0006](../adr/0006-go-spa-vanilla-cu.md).

Vite băm nội dung vào tên file asset (`assets/index-<hash>.js`) nên asset phục vụ
`immutable` an toàn, còn `index.html` phục vụ `no-cache`. Không còn `?v=` gõ tay.

**Engine lưới** — clipboard, IME tiếng Việt, round-trip Excel — sống ở
`web/src/lib/clipboard.ts`, là port thuần của bản vanilla đã tôi luyện nhiều năm.
`tests/gridClipboard.test.js` (76 bài) phủ chính module này.

## Xử lý nền

`src/queue.ts` khai năm hàng đợi: `export`, `email`, `webhook`, `notify`,
`maintenance`. Worker (`src/worker.ts`) đăng ký processor cho cả năm.

Không có `REDIS_URL` thì `runOrQueue()` **chạy nội tuyến** ngay trong request —
tiện cho dev, nhưng ở production nghĩa là việc nặng nằm trên luồng chính.

Xuất file có đường riêng: `src/exportQueue.ts` chạy trong **worker thread** với
cổng giới hạn đồng thời có **trần hàng đợi**; đầy thì trả 503 + `Retry-After`
thay vì để request treo tới lúc proxy bỏ cuộc.

## Realtime

`src/sse.ts`. Có `REDIS_URL` thì sự kiện đi qua kênh Pub/Sub nên **lan được giữa
nhiều instance**.

**Một ngoại lệ quan trọng:** bản đồ *presence* ("ai đang mở báo giá nào") là
`Map` **trong tiến trình**, KHÔNG qua Redis. Chạy nhiều replica thì người dùng
trên replica A không thấy người trên replica B. Đây là hạn chế đã biết, chưa sửa.

## Dữ liệu nằm ở đâu

| Nơi | Giữ gì |
|---|---|
| PostgreSQL | toàn bộ dữ liệu nghiệp vụ; tiền dùng `Decimal`, không dùng float |
| PostgreSQL (đã mã hoá) | CCCD, số tài khoản, lương — AES-256-GCM bằng `PII_ENC_KEY` |
| Kho object | ảnh chứng từ thanh toán, tệp đính kèm, bản xuất |
| Redis | phiên, hàng đợi, bộ đếm rate-limit, kênh Pub/Sub |

CSDL chỉ giữ **khoá object + SHA-256**, không giữ nội dung file. Hệ quả trực
tiếp: bản dump CSDL một mình **không** khôi phục được — xem
[operations/BACKUP_RESTORE.md](../operations/BACKUP_RESTORE.md).

## Quyết định và lý do

| Quyết định | Vì sao |
|---|---|
| Monolith, không microservice | một người vận hành; ranh giới module giải quyết được vấn đề tổ chức mã mà không thêm gánh nặng vận hành |
| Ghép XML vào mẫu .xlsx thật | kế toán cần **file của họ**, không phải "file có cùng con số" |
| SSE, không WebSocket | luồng một chiều là đủ; SSE đi qua proxy dễ hơn và tự reconnect |
| BullMQ trên Redis | Redis đã có sẵn cho phiên; thêm Kafka cho khối lượng này là vô cớ |
| Prisma, không viết SQL tay | an toàn kiểu + migration; chỗ nào cần thì dùng raw query |
| Chạy artifact đã biên dịch | production không cần trình biên dịch; Docker/Compose/Helm/k8s dùng CHUNG một lệnh |
