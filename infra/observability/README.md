# Ngăn xếp quan sát (tuỳ chọn)

> **Không bật mặc định.** `docs/architecture/TECHNOLOGY_DECISIONS.md` xếp "gom log tập trung" là
> `DEFER`: production hiện là MỘT VM và `docker logs` còn đủ. Thư mục này để lúc cần thì là một
> lệnh, không phải một dự án.

```text
ứng dụng (pino → stdout)
   ↓  Docker json-file
promtail  ── đọc /var/lib/docker/containers/*/*-json.log
   ↓
Loki  ────────────────┐
                      ├──→ Grafana  ← bảng điều khiển trong repo
Prometheus  ──────────┘     (metric + log CÙNG một trang)
```

## Chạy

```bash
# .env trên máy chủ phải có GRAFANA_PASSWORD
docker compose \
  -f docker-compose.prod.yml \
  -f infra/observability/docker-compose.observability.yml \
  up -d loki promtail grafana

# Grafana chỉ nghe trên loopback của VM:
ssh -L 3001:127.0.0.1:3001 coolify-ts   # rồi mở http://127.0.0.1:3001
```

## Vì sao Promtail đọc file log của Docker, không phải ứng dụng tự đẩy

Ứng dụng **không được** phụ thuộc vào việc hệ log có sống hay không. Đẩy trực tiếp từ tiến trình
nghĩa là Loki chết thì ứng dụng hoặc chặn, hoặc phải tự dựng bộ đệm — thêm một đường hỏng ngay
trong đường phục vụ người dùng. Đọc từ file thì Loki chết là chuyện của Loki: log vẫn nằm nguyên
trên đĩa, Promtail đọc bù khi nó sống lại (`positions.yaml` nhớ đã đọc tới đâu).

Đổi lại, ứng dụng **không cần biết gì** về Loki — không thư viện, không cấu hình, không biến môi
trường. Gỡ cả ngăn xếp này ra thì mã ứng dụng không đổi một dòng.

## Nhãn: ít thôi

Loki đánh index theo **nhãn**, và mỗi tổ hợp nhãn là một "chuỗi". Đặt nhãn theo trường có nhiều giá
trị (`reqId`, `userId`) là cách nhanh nhất để giết một cụm Loki.

Nhãn ở đây: `container`, `stream`, `level`, `route`. Cả bốn đều có ÍT giá trị. `route` là **mẫu**
route (`/api/quotes/:id`), không phải URL — chính vì thế `src/app.ts` mới ghi trường đó ra log
(xem chú thích ở `asyncHandler`, src/middleware.ts).

Tìm theo `reqId` vẫn được, chỉ là quét nội dung thay vì tra index:

```logql
{container="quanly-app"} | json | reqId = "b1a2…"
```

## Bảng điều khiển

`grafana/dashboards/quanly.json` — 9 panel: lưu lượng, tỉ lệ 5xx, độ trễ p50/p95/p99, hàng đợi xuất
file, SSE, BullMQ, và **hai panel Loki đặt cùng trang** (log lỗi gần nhất + số dòng log theo mức).

Đặt log cạnh metric là có chủ ý: thấy bậc thang 5xx rồi phải đọc được ngay dòng log của đúng quãng
đó, không phải mở tab khác rồi tự canh giờ.

Mọi biểu thức PromQL trong tệp này được `scripts/ci/check-alerts.mjs` bước `[A4]` đối chiếu với
`src/observability.ts`: metric bị đổi tên hay gỡ đi thì cổng ĐỎ. Không có lớp đó, một panel trỏ vào
metric đã chết sẽ vẽ đường thẳng bằng 0 và người trực đọc thành "hệ thống đang yên".

## Chưa làm (có chủ ý)

* **Prometheus không nằm trong ngăn xếp này.** Repo đã có metric (`/metrics`) và
  `infra/prometheus/alerts.yaml`; nơi chạy Prometheus là quyết định riêng của hạ tầng. Sửa URL
  trong `grafana/provisioning/datasources/ds.yaml` cho khớp.
* **Không có Alertmanager.** Quy tắc cảnh báo đã có và đã được `promtool test rules` kiểm logic;
  nối chúng vào kênh nào (Telegram/email) là việc của người vận hành.
* **Không giữ log lâu.** Loki chạy cấu hình mặc định (giữ trong volume, không phân tầng). Cần giữ
  theo tháng thì phải cấu hình `limits_config.retention_period` + compactor.
