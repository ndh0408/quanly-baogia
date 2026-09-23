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

Bảng dưới đây là **toàn bộ 33 metric** do `src/observability.ts` khai. Nguồn sự
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
| `bullmq_jobs` | Gauge | queue, state | độ sâu 5 hàng đợi nền, theo trạng thái. **App VÀ worker cùng phát** (đọc cùng Redis) → gộp bằng `max by (queue, state)`, đừng `sum` |
| `bullmq_jobs_failed_total` | Counter | queue | job nền hỏng HẲN (hết lượt thử) — theo sự kiện; chỉ worker phát. Cảnh báo `QuanlyJobNenThatBai` dùng `increase(...[15m])` |
| `dependency_calls_total` | Counter | dep, status | lượt gọi SMTP / Telegram / kho object, `ok` hay `error` (404 của kho object là `ok`) |
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
| `config_missing` | Gauge | key | 1 = biến bắt buộc-ở-production CHƯA đặt. Nhãn `key`: `REDIS_URL` · `S3_ENDPOINT` · `S3_ACCESS_KEY` · `S3_SECRET_KEY` · `SMTP_HOST` · `PII_ENC_KEY`. **Chỉ phát khi `NODE_ENV=production`** |
| `backup_last_success_timestamp_seconds` | Gauge | kind | lần sao lưu thành công gần nhất (`db` · `objects` · `offhost_db` · `offhost_objects` · `drill`; 0 = chưa từng). Đọc từ tệp trạng thái do `scripts/backup/*` ghi trên host — **chỉ app phát**, và chỉ khi đặt `BACKUP_STATUS_FILE` |
| `backup_offhost_configured` | Gauge | scope | 1 = đã cấu hình đích sao lưu ngoài máy; **0 = mọi bản sao nằm trên cùng host**. Thiếu tệp trạng thái thì KHÔNG có chuỗi nào |

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

`HEALTH_METRICS=0` (nhận cả `false`/`off`/`no`) **KHÔNG ĐĂNG KÝ** năm gauge này — tức
`/metrics` không có dòng nào cho chúng, chứ **không phải** phát số 0. Đây là điểm dễ
hiểu ngược, và hiểu ngược thì hậu quả nặng: nếu tắt mà vẫn phát `db_up 0` thì quy tắc
critical `db_up == 0` sẽ kêu suốt ngày đêm trên một Postgres hoàn toàn khoẻ — mà một
cảnh báo kêu oan là một cảnh báo sẽ bị tắt. Ca mất sạch tín hiệu do
`QuanlyKhongConTargetNao` (`absent()`) lo, không phải do các gauge này.

`config_missing` **không** nằm sau nút đó: nó chỉ đọc cấu hình, không ping gì, nên
tắt phép đo sức khoẻ không có lý do gì làm mất nó.

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
Nó scrape **bốn** job:

| Job | Target | Vì sao cần |
|---|---|---|
| `quanly-app` | `app:3000/metrics` | lưu lượng, độ trễ, 5xx, SSE, sức khoẻ phụ thuộc, trạng thái sao lưu |
| `quanly-worker` | `worker:9091/metrics` | `export_*` và `bullmq_jobs` có số **thật** ở đây — job chạy trong tiến trình worker, không phải tiến trình API |
| `prometheus` | chính nó | tự giám sát |
| `alertmanager` | `alertmanager:9093` | `alertmanager_notifications_failed_total` → cảnh báo `QuanlyCanhBaoGuiThatBai` |

**App VÀ worker cùng phát** `bullmq_jobs`, `export_*`, `sse_*` (cùng module metric; hàng đợi đọc cùng
Redis). Quy tắc và panel phải gộp bằng `max`, và `sse_*` phải lọc `service="app"` — `sum` là cộng đôi,
còn worker phát `sse_backplane_up 0` thường trực (audit 2026-09-22, GAP1-02 / OBS-05).

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

## Ngăn xếp quan sát (Prometheus + Alertmanager + Loki + Grafana) — ĐANG CHẠY trên production

**Hiện trạng (nguồn duy nhất — SLO.md, TECHNOLOGY_DECISIONS.md, SECURITY_MODEL.md trỏ về đây):**
ngăn xếp `infra/observability/` bật trên production từ **2026-09-16** (Prometheus v3.1.0, Alertmanager
v0.28.1, Grafana 11.4.0, Loki/Promtail 3.3.2); Alertmanager gửi cảnh báo vào **nhóm Telegram** từ
**2026-09-17**. Bảng điều khiển đặt **log cùng trang với metric**, kèm panel trạng thái sao lưu.

Ba lỗ còn mở (audit 2026-09-22), việc chủ repo làm tay:
- **Không có giám sát từ NGOÀI** (OBS-01): mọi mắt xích nằm trên chính máy production. Repo nay có
  nhịp tim `QuanlyWatchdog` + route `nhip-tim` — đặt `HEARTBEAT_URL` (URL ping của healthchecks.io hoặc
  tương đương, cấu hình "báo khi mất nhịp > 5 phút") trong `.env` rồi dựng lại alertmanager. Thêm một
  HTTP check ngoài (UptimeRobot/Cloudflare Health Check) vào `https://gianguyen.cloud/livez` để bắt
  tunnel chết.
- **Nhãn môi trường** (OBS-06): đặt `QUANLY_ENV=prod` (staging: `staging`) trong `.env` của từng máy,
  RỒI tạo lại container Prometheus (`up -d prometheus`, lệnh dưới). Container tạo lại mà `.env` thiếu
  biến thì nhãn là `chua-dat-QUANLY_ENV`; còn container CŨ (tạo trước khi compose có `QUANLY_ENV`) thì
  nhãn `environment` bị **RỖNG** — Prometheus nội suy biến chưa đặt thành chuỗi rỗng. `deploy.sh` [5d/6]
  cảnh báo khi gặp container cũ như vậy.
- **Thay đổi quy tắc tự nạp khi deploy** (OBS-13): `deploy.sh` [5d/6] gửi SIGHUP cho Prometheus, kiểm
  `prometheus_config_last_reload_successful`, và khởi động lại Alertmanager khi bản mẫu đổi. Đổi
  `docker-compose.observability.yml` (vd cấu hình Loki mới) thì vẫn phải `up -d` lại ngăn xếp bằng tay.
- **`HEARTBEAT_URL=` PHẢI có dòng trong `.env`, để trống cũng được.** Secret `heartbeat_url` của
  alertmanager lấy từ biến này; thiếu HẲN dòng thì `up -d` dựng lại alertmanager (danh sách secret đổi)
  rồi container mới KHÔNG start được — `environment variable "HEARTBEAT_URL" required by secret
  "heartbeat_url" is not set` — và từ lúc đó không còn cảnh báo nào được gửi. Kiểm trước (lệnh dưới).

```bash
# .env của máy chủ phải có METRICS_TOKEN và GRAFANA_PASSWORD, và DÒNG HEARTBEAT_URL= (trống được).
# Kiểm TRƯỚC khi up -d — dừng trước khi container alertmanager cũ bị gỡ:
grep -q '^HEARTBEAT_URL=' .env || { echo 'thiếu dòng HEARTBEAT_URL= trong .env (để trống cũng được)'; exit 1; }
docker compose -f docker-compose.prod.yml \
  -f infra/observability/docker-compose.observability.yml up -d
```

Promtail đọc file log JSON của Docker, **không** phải ứng dụng tự đẩy — Loki chết
thì log vẫn nằm trên đĩa và Promtail đọc bù, còn ứng dụng thì không biết Loki tồn
tại. Chi tiết + lý do chọn nhãn: [infra/observability/README.md](../../infra/observability/README.md).

Loki có retention 30 ngày (`infra/observability/loki.yaml`) từ bản vá audit 2026-09-22 (OBS-15) —
trước đó chạy cấu hình mặc định, không xoá log nào, trên cùng đĩa với CSDL.

## Việc còn treo
- **Backup watchdog CHƯA cài trên production** (đo 2026-09-22) — tức đường báo động sao lưu tách
  khỏi Prometheus mà tài liệu cũ gọi là "đang chạy thật" hiện không chạy. Trạng thái sao lưu nay
  cũng hiện trên Grafana qua `backup_*` (khi bộ sao lưu trong repo được cài). Xem
  [BACKUP_RESTORE.md](BACKUP_RESTORE.md).
- **Mục tiêu độ trễ trong [SLO.md](SLO.md) chưa đặt lại theo phân vị thật**, dù Prometheus đã thu số
  liệu từ 2026-09-16 — việc cần làm là rút p95/p99 của 2 tuần rồi sửa SLO.
- **Promtail mount `docker.sock`** (OBS-15, CHƯA sửa): bỏ nó thì mất nhãn `container` mà panel log và
  truy vấn dựa vào; cần chuyển sang Grafana Alloy hoặc relabel theo đường dẫn — việc có kế hoạch,
  không vá vội.
