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

Bảng dưới đây là **toàn bộ 21 metric** do `src/observability.ts` khai. Nguồn sự
thật là file đó — `scripts/ci/check-alerts.mjs` đối chiếu mọi quy tắc cảnh báo và
mọi panel Grafana với nó, nên metric đổi tên mà quên sửa là cổng CI đỏ.

| Tên | Loại | Nhãn | Nhìn để biết |
|---|---|---|---|
| `http_requests_total` | Counter | method, route, status | lưu lượng, tỉ lệ lỗi |
| `http_request_duration_seconds` | Histogram | method, route, status | độ trễ theo phân vị |
| `export_jobs_total` | Counter | format, status | xuất file thành/bại |
| `export_active_workers` | Gauge | — | worker xuất file đang chạy |
| `export_queue_depth` | Gauge | — | đang xếp hàng bao sâu |
| `export_max_active_workers` | Gauge | — | **trần** `EXPORT_MAX_ACTIVE` (mẫu số tính bão hoà) |
| `export_max_queue_depth` | Gauge | — | **trần** `EXPORT_MAX_PENDING` (mẫu số tính bão hoà) |
| `export_rejected_total` | Counter | reason | **lượt bị từ chối vì hết công suất** |
| `export_duration_seconds` | Histogram | format, path | thời gian sinh file (worker vs nội tuyến) |
| `bullmq_jobs` | Gauge | queue, state | độ sâu 5 hàng đợi nền, theo trạng thái |
| `sse_clients` | Gauge | — | số kết nối realtime đang mở |
| `sse_reconnects` | Counter | — | nhịp **nối lại** — đường realtime có chập chờn không |
| `sse_events` | Counter | event | số khung sự kiện **giao thành công** |
| `sse_backplane_up` | Gauge | — | backplane Redis của SSE có đang chạy |
| `sse_backplane_mode` | Gauge | mode | chế độ đang chạy: `redis` hay `local` |
| `sse_backplane_errors_total` | Counter | op | PUBLISH qua Redis thất bại |
| `db_up` | Gauge | — | Postgres có trả lời `SELECT 1` không |
| `redis_configured` | Gauge | — | tiến trình này **có** `REDIS_URL` hay không |
| `redis_up` | Gauge | — | có kết nối Redis nào ở trạng thái ready |
| `disk_free_bytes` | Gauge | mountpoint | byte trống của hệ tệp `DISK_METRICS_PATH` |
| `disk_total_bytes` | Gauge | mountpoint | **mẫu số** để tính tỉ lệ trống |

Cộng thêm metric mặc định của `prom-client` (CPU, bộ nhớ, event loop, GC).

`quote_operations_total` **đã bị gỡ** — nó được khai mà không chỗ nào `.inc()`,
nên `/metrics` phát ra 0 vĩnh viễn và số 0 đó đọc thành "không có báo giá nào
được tạo/duyệt/gửi". Đừng khai lại nếu chưa có chỗ tăng.

`export_rejected_total` tăng nghĩa là **người dùng đang bị từ chối**, không phải
"hệ thống hơi bận". Chạm tới nó thì nâng `EXPORT_MAX_ACTIVE` hoặc tách worker
riêng, đừng bảo người dùng thử lại.

### Ba metric SSE của §18 — quan hệ tên

§18 gọi tên `sse_connections` · `sse_reconnects` · `sse_events`. Trong mã:

| Tên ở §18 | Tên thật | Ghi chú |
|---|---|---|
| `sse_connections` | **`sse_clients`** | cùng một số (kết nối đang mở). Giữ tên cũ vì bảng Grafana + quy tắc cảnh báo đang dùng nó; đổi tên là thay đổi phá vỡ |
| `sse_reconnects` | `sse_reconnects` | trùng tên |
| `sse_events` | `sse_events` | trùng tên |

`sse_reconnects` là **số suy luận, không phải số đo chính xác** — và chỗ này phải
nói thật. `EventSource` chỉ gửi `Last-Event-ID` khi máy chủ đã gửi trường `id:`,
mà `src/sse.ts` không gửi `id:` bao giờ; client (`web/src/components/Shell.tsx`)
cũng không kèm dấu hiệu nào. Nên định nghĩa đang dùng là: **một lượt kết nối được
tính là nối lại khi tài khoản đó vừa rớt về 0 kết nối trong `SSE_RECONNECT_WINDOW_MS`
(mặc định 90 giây) trước đó**. Mở thêm tab không tính; đi ăn trưa rồi quay lại
không tính. Đọc nó là *"đường realtime có đang chập chờn không"*, đừng đọc là
*"tổng số lần nối lại"*.

`sse_events` đếm **khung giao thành công**, mỗi kết nối một lần — broadcast tới 50
tab là +50. Khung bị bỏ vì áp lực ngược (`ghiAnToan` trả `false`) **không** được
tính: đó là sự kiện đã mất. Keepalive và dòng `: connected` cũng không tính (chúng
không có trường `event:`). Nhãn `event` được chuẩn hoá về một tập hữu hạn, tên lạ
gộp vào `khac` — `publish`/`broadcast` là hàm export nên lấy thẳng tham số làm
nhãn là mở đường cho nổ cardinality.

### db_up / redis_up / disk_* — đo lúc nào

Cả năm được đo **ngay lúc scrape** trong `collect()` của `prom-client`, không phải
bằng `setInterval` (interval sẽ chạy trong mọi tiến trình test, rò handle và đập
vào CSDL/Redis dù không ai đọc). Kết quả được nhớ tạm 5 giây và mỗi phép đo bị cắt
ở 2 giây, nên **một phụ thuộc chết không bao giờ làm `/metrics` treo hay trả 500**
— phần số liệu còn lại vẫn về nguyên vẹn.

Ba khác biệt cần nhớ khi đọc số:

* `db_up = 0` gồm cả "quá 2 giây chưa xong". Cố ý: `SELECT 1` mà chậm thế thì với
  người dùng, CSDL đã hỏng rồi.
* `redis_up` chỉ có nghĩa khi `redis_configured = 1`. Chạy không Redis là cấu hình
  **hợp lệ** (`REDIS_URL` là `.optional()`), nên quy tắc cảnh báo phải gác hai vế.
* `disk_*` **không phát chuỗi nào** khi `statfs` thất bại, thay vì phát số 0 — số 0
  ở đây đọc thành "đĩa đầy" và sẽ báo động giả. Đổi điểm đo bằng `DISK_METRICS_PATH`.

## Nhật ký

pino, JSON ra stdout (`src/logger.ts`). Mỗi request có `reqId` — sinh ra hoặc lấy
từ header `x-request-id` — và được dội lại trong response header `X-Request-Id`,
nên có thể lần từ một khiếu nại của người dùng về đúng dòng log.

Mỗi dòng log truy cập có **bảy** trường: `method` · `url` · `res.status` ·
`responseTime` · `reqId` · `userId` (nếu đã đăng nhập) · `role` · `route`.
Lỗi kèm thêm path, status, message, stack.

`route` là **MẪU** route của Express (`/api/quotes/:id`), không phải URL thật.
Khác biệt này quyết định khi gom log: `url` chứa id nên mỗi request là một chuỗi
riêng và không nhóm được "endpoint nào đang chậm". Nó được ghi lại **ngay lúc
handler chạy** (`asyncHandler`, `src/middleware.ts`) chứ không phải lúc ghi log —
Express khôi phục `req.baseUrl` về rỗng khi ngăn xếp router tháo ra, mà đường LỖI
thì luôn tháo, nên đọc muộn sẽ cho `/:id` thay vì `/api/quotes/:id` đúng ở những
request cần điều tra nhất. `tests/xd-log-fields.test.js` canh cả bảy trường.

**Không bao giờ được ghi log**: mật khẩu, JWT, cookie phiên, bí mật MFA, số tài
khoản/CCCD dạng thô. Sentry cũng lược `cookie` và `authorization` trước khi gửi.

## Sentry

Bật khi có `SENTRY_DSN`. Lấy mẫu qua `SENTRY_TRACES_SAMPLE_RATE` (mặc định 0.1)
và `SENTRY_PROFILES_SAMPLE_RATE` (mặc định 0). Cả tiến trình API và worker đều
khởi tạo — job nền hỏng cũng được báo, không chỉ nằm im trong log.

## Scrape

**Trên Compose**: ngăn xếp ở `infra/observability/` đã có sẵn một service
`prometheus` được cấu hình đầy đủ — xem
[`infra/observability/prometheus.yml`](../../infra/observability/prometheus.yml).
Nó scrape **hai** target:

| Job | Target | Vì sao cần |
|---|---|---|
| `quanly-app` | `app:3000/metrics` | lưu lượng, độ trễ, 5xx, SSE, sức khoẻ phụ thuộc |
| `quanly-worker` | `worker:9091/metrics` | `export_*` và `bullmq_jobs` có số **thật** ở đây — job chạy trong tiến trình worker, không phải tiến trình API |

Tên job **phải** khớp `quanly.*`: bốn quy tắc trong `alerts.yaml` lọc theo tiền tố
đó. `tests/xf-observability-gaps.test.js` khoá lại ràng buộc này.

Token đi vào Prometheus bằng **đường tệp** (`credentials_file:
/run/secrets/metrics_token`, do khối `secrets:` của compose bày ra từ
`METRICS_TOKEN` trong `.env`) — Prometheus **không** nội suy biến môi trường trong
file cấu hình. Thiếu `METRICS_TOKEN` thì `compose up` dừng ngay, cố ý: một
Prometheus scrape ra 404 là một hệ giám sát mù không báo lỗi ở đâu cả.

**Trên k8s/Helm**: chart gắn sẵn annotation `prometheus.io/scrape` khi
`metrics.enabled`. Có prometheus-operator thì bật `metrics.serviceMonitor.enabled`
(nhớ đặt `secrets.METRICS_TOKEN`, chart sẽ `fail` nếu quên).

## Ngăn xếp quan sát (Prometheus + Loki + Grafana) — có sẵn, chưa bật

`infra/observability/` chứa nguyên một ngăn xếp chạy được: **Prometheus** + Loki +
Promtail + Grafana, kèm bảng điều khiển 9 panel trong đó **log nằm cùng trang với
metric**.

```bash
# .env của máy chủ phải có METRICS_TOKEN và GRAFANA_PASSWORD
docker compose -f docker-compose.prod.yml \
  -f infra/observability/docker-compose.observability.yml up -d
```

Promtail đọc file log JSON của Docker, **không** phải ứng dụng tự đẩy — Loki chết
thì log vẫn nằm trên đĩa và Promtail đọc bù, còn ứng dụng thì không biết Loki tồn
tại. Chi tiết + lý do chọn nhãn: [infra/observability/README.md](../../infra/observability/README.md).

Chưa bật mặc định vì production là một VM và ba container nữa ăn RAM của chính
ứng dụng — xem hàng "Gom log tập trung" trong
[TECHNOLOGY_DECISIONS.md](../architecture/TECHNOLOGY_DECISIONS.md).

## Việc còn treo
- **Ngăn xếp quan sát chưa bật ở production.** Định nghĩa Prometheus đã có trong
  repo và dựng được bằng một lệnh, nhưng chưa ai bật nó trên VM — nên chưa có
  chuỗi số liệu thật nào, và mọi mục tiêu độ trễ trong [SLO.md](SLO.md) còn là
  giả định. Chưa bật vì production là **một VM** và bốn container nữa ăn RAM của
  chính ứng dụng (xem
  [TECHNOLOGY_DECISIONS.md](../architecture/TECHNOLOGY_DECISIONS.md)).
- **Chưa có Alertmanager — cảnh báo dừng ở giao diện Prometheus.** 17 quy tắc sẽ
  chuyển sang `firing` và nằm ở `/alerts`; **không** Telegram, **không** email,
  **không ai bị đánh thức**. Khối `alerting:` trong
  `infra/observability/prometheus.yml` đã để sẵn chỗ nối. Alert duy nhất đang
  chạy thật là backup watchdog qua Telegram — cố ý tách riêng, vì đó là thứ không
  được phép im lặng ngay cả khi hệ giám sát chết.
- **Ngăn xếp chưa được chạy thử bằng Docker thật.** Cấu hình đã qua
  `promtool check config --syntax-only`, `promtool check rules`, `promtool test
  rules` và `docker compose config`; nhưng chưa ai `up` nó lên và xem Prometheus
  có scrape được `/metrics` qua bearer token hay không.
