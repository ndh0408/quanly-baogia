# Quan sát hệ thống

## Endpoint sức khoẻ

| Endpoint | Kiểm gì | Dùng cho |
|---|---|---|
| `/livez` | tiến trình còn phục vụ HTTP | liveness probe · healthcheck Docker |
| `/readyz` | **chạm được Postgres** (`SELECT 1`) | readiness probe |
| `/api/health` | như `/livez`, kèm mốc thời gian | kiểm bằng tay |

Khác biệt quan trọng: `/livez` **không** chạm CSDL. Cố ý — CSDL chập chờn phải
khiến pod bị **rút khỏi luồng** (readiness đỏ), chứ không phải bị **giết và khởi
động lại** (liveness đỏ). Restart không chữa được một CSDL đang chết.

`/readyz` không bao giờ lộ chi tiết lỗi CSDL — endpoint này không cần xác thực.

## Metrics

`GET /metrics`, định dạng Prometheus.

**Bảo vệ**: đặt `METRICS_TOKEN` thì cần `Authorization: Bearer <token>`, so sánh
hằng-thời-gian. Ở production **không đặt token → trả 404** (fail-closed): không
có nó, tên route, lưu lượng, tỉ lệ lỗi và mức tiêu tài nguyên lộ ra cho bất kỳ ai
chạm tới được.

### Metric có thật

| Tên | Loại | Nhãn | Nhìn để biết |
|---|---|---|---|
| `http_requests_total` | Counter | method, route, status | lưu lượng, tỉ lệ lỗi |
| `http_request_duration_seconds` | Histogram | method, route, status | độ trễ theo phân vị |
| `quote_operations_total` | Counter | op, status | nhịp nghiệp vụ |
| `export_jobs_total` | Counter | format, status | xuất file thành/bại |
| `export_active_workers` | Gauge | — | worker xuất file đang chạy |
| `export_queue_depth` | Gauge | — | đang xếp hàng bao sâu |
| `export_rejected_total` | Counter | reason | **lượt bị từ chối vì hết công suất** |
| `export_duration_seconds` | Histogram | format, path | thời gian sinh file (worker vs nội tuyến) |
| `sse_clients` | Gauge | — | số kết nối realtime đang mở |

Cộng thêm metric mặc định của `prom-client` (CPU, bộ nhớ, event loop, GC).

`export_rejected_total` tăng nghĩa là **người dùng đang bị từ chối**, không phải
"hệ thống hơi bận". Chạm tới nó thì nâng `EXPORT_MAX_ACTIVE` hoặc tách worker
riêng, đừng bảo người dùng thử lại.

## Nhật ký

pino, JSON ra stdout (`src/logger.ts`). Mỗi request có `reqId` — sinh ra hoặc lấy
từ header `x-request-id` — và được dội lại trong response header `X-Request-Id`,
nên có thể lần từ một khiếu nại của người dùng về đúng dòng log.

Mỗi dòng log truy cập có: method, url, status, `reqId`, `userId` (nếu đã đăng
nhập). Lỗi kèm thêm path, status, message, stack.

**Không bao giờ được ghi log**: mật khẩu, JWT, cookie phiên, bí mật MFA, số tài
khoản/CCCD dạng thô. Sentry cũng lược `cookie` và `authorization` trước khi gửi.

## Sentry

Bật khi có `SENTRY_DSN`. Lấy mẫu qua `SENTRY_TRACES_SAMPLE_RATE` (mặc định 0.1)
và `SENTRY_PROFILES_SAMPLE_RATE` (mặc định 0). Cả tiến trình API và worker đều
khởi tạo — job nền hỏng cũng được báo, không chỉ nằm im trong log.

## Scrape

Chart Helm gắn sẵn annotation `prometheus.io/scrape` khi `metrics.enabled`. Có
prometheus-operator thì bật `metrics.serviceMonitor.enabled`.

Trên Compose thì trỏ Prometheus vào cổng app kèm bearer token.

## Việc còn treo

- **Chưa có tổng hợp log tập trung.** Log ra stdout và dừng ở đó. Muốn tìm việc
  đã xảy ra tuần trước thì phải `docker logs` trên host — mất khi container bị
  recreate. Loki hoặc tương đương là bước tiếp theo.
- **Chưa có Prometheus/Grafana chạy production.** Metric có sẵn nhưng chưa ai
  scrape, nên mọi mục tiêu độ trễ trong [SLO.md](SLO.md) còn là giả định.
- **Chưa có Alertmanager.** Alert duy nhất đang chạy thật là backup watchdog qua
  Telegram — cố ý tách riêng, vì đó là thứ không được phép im lặng.
