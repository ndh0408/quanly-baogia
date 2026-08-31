# Ngăn xếp quan sát (tuỳ chọn)

> **Không bật mặc định.** `docs/architecture/TECHNOLOGY_DECISIONS.md` xếp "gom log tập trung" là
> `DEFER`: production hiện là MỘT VM và `docker logs` còn đủ. Thư mục này để lúc cần thì là một
> lệnh, không phải một dự án.

```text
ứng dụng (pino → stdout)              ứng dụng /metrics  ←── app:3000
   ↓  Docker json-file                worker  /metrics  ←── worker:9091
promtail  ── đọc /var/lib/docker/containers/*/*-json.log        ↑
   ↓                                                    Bearer METRICS_TOKEN
Loki  ────────────────┐                                        ↑
                      ├──→ Grafana  ← bảng điều khiển   Prometheus ──┐
Prometheus  ──────────┘     (metric + log CÙNG một trang)            │
                                                    nạp infra/prometheus/alerts.yaml
```

## Chạy

```bash
# .env trên máy chủ PHẢI có METRICS_TOKEN và GRAFANA_PASSWORD.
# Thiếu METRICS_TOKEN thì lệnh dừng ngay — cố ý, xem mục "Prometheus" bên dưới.
docker compose \
  -f docker-compose.prod.yml \
  -f infra/observability/docker-compose.observability.yml \
  up -d prometheus loki promtail grafana

# Grafana chỉ nghe trên loopback của VM:
ssh -L 3001:127.0.0.1:3001 coolify-ts   # rồi mở http://127.0.0.1:3001

# Prometheus KHÔNG publish cổng nào (giao diện 9090 không có xác thực). Xem trạng thái quy tắc:
docker compose exec prometheus wget -qO- http://127.0.0.1:9090/api/v1/rules
```

## Prometheus

Trước khi có service này, repo đã có metric ứng dụng, quy tắc cảnh báo đã qua `promtool test
rules`, và một bảng Grafana 9 panel — mà **không một định nghĩa máy chủ Prometheus nào ở bất kỳ
đâu**. Nghĩa là không môi trường nào thu thập được số liệu, không cảnh báo nào KÊU ĐƯỢC, và
datasource của Grafana trỏ vào hư không. Mọi cổng CI vẫn xanh suốt thời gian đó — đó đúng là dạng
hỏng tệ nhất của một hệ giám sát.

**Số liệu HIỆN TẠI** (đo lại bằng lệnh, đừng chép tay — số ở đây trôi rất nhanh):

```bash
grep -oE 'name: "[a-z_]+"' src/observability.ts | wc -l   # 22 metric ứng dụng
grep -c '^      - alert:' infra/prometheus/alerts.yaml    # 19 quy tắc cảnh báo
```

Trước đợt 2026-08-27 hai con số này là **14 metric và 14 quy tắc**. Đợt đó thêm 7 metric
(`db_up`, `disk_free_bytes`, `disk_total_bytes`, `redis_configured`, `redis_up`, `sse_events`,
`sse_reconnects`) và 3 quy tắc (`QuanlyCsdlKhongToiDuoc`, `QuanlyDiaSapDay`, `QuanlyRedisChet`).

* Cấu hình: [`prometheus.yml`](prometheus.yml) — scrape `app:3000` và `worker:9091`, giữ 15 ngày.
* Quy tắc: **mount thẳng** `infra/prometheus/alerts.yaml`, không chép. Hai bản của cùng một tập quy
  tắc là hai bản sẽ trôi khỏi nhau, và `npm run check:alerts` chỉ kiểm bản gốc.
* Xác thực: `/metrics` ở production trả **404** khi thiếu `METRICS_TOKEN` và **401** khi Bearer sai
  (`src/app.ts`, `src/worker.ts`). Prometheus **không** nội suy biến môi trường trong file cấu
  hình, nên token đi bằng đường TỆP: khối `secrets:` của compose bày `METRICS_TOKEN` ra
  `/run/secrets/metrics_token`, và `prometheus.yml` đọc bằng `credentials_file`.
  Cần Docker Compose ≥ 2.24 (nguồn secret dạng `environment:`); bản cũ hơn thì đổi sang
  `file: ./secrets/metrics-token`.
* `${METRICS_TOKEN:?…}` làm `compose up` **dừng ngay** khi thiếu token. Cố ý: một Prometheus scrape
  ra 404 là một hệ giám sát mù mà không có gì báo lỗi.
* Ràng buộc giữa các file (tên job phải khớp `quanly.*`, đường mount phải khớp `rule_files:`, uid
  datasource phải khớp bảng điều khiển) được khoá bằng `tests/xf-observability-gaps.test.js`.

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

`[A4]` soi TÊN METRIC, **không** soi URL của datasource — nên nó KHÔNG bắt được lỗi đã có ở
`provisioning/datasources/ds.yaml`: URL viết dạng `${PROMETHEUS_URL:-http://prometheus:9090}`, mà
Grafana nội suy kiểu `os.ExpandEnv` (hiểu `$VAR` và `${VAR}`, **không** hiểu dạng-có-mặc-định của
shell) nên nó nở ra chuỗi RỖNG. Nay URL viết thẳng `http://prometheus:9090`; ràng buộc được khoá
bằng `tests/xf-observability-gaps.test.js`.

## KHÔNG CÓ ALERTMANAGER — cảnh báo dừng ở đâu

Đây là thứ dễ đọc nhầm nhất trong cả thư mục, nên nói thẳng:

> 19 quy tắc trong `infra/prometheus/alerts.yaml` **được Prometheus đánh giá thật** và **chuyển sang
> trạng thái `firing` thật**. Rồi chúng **DỪNG LẠI** ở giao diện Prometheus (`/alerts`,
> `/api/v1/alerts`). **Không Telegram. Không email. Không ai bị đánh thức.**

Tức là ngăn xếp này cho bạn "có cảnh báo" theo nghĩa **kỹ thuật**, chưa phải theo nghĩa **vận
hành**. Muốn biết một cảnh báo đang kêu thì vẫn phải có người MỞ ra xem — đúng cái vấn đề mà cảnh
báo sinh ra để giải quyết.

Đường báo động **duy nhất đang chạy thật** trong repo là backup watchdog qua Telegram
(`scripts/backup/backup-watchdog.sh`, chạy mỗi 6 giờ bằng cron của hệ điều hành). Nó **cố ý** không
đi qua Prometheus: một hệ giám sát chết không được phép làm im luôn cả báo động về sao lưu.

**Cách đóng khoảng cách**: thêm một service `alertmanager` vào file compose ở đây, rồi bỏ chú thích
khối `alerting:` trong [`prometheus.yml`](prometheus.yml) (đã để sẵn chỗ + địa chỉ
`alertmanager:9093`). Nối vào cùng bot Telegram mà watchdog đang dùng là hợp lý nhất — một kênh, một
chỗ để tắt tiếng khi đang bảo trì.

## Chưa làm (có chủ ý)

* **Chưa chạy thử bằng Docker thật.** Cấu hình đã qua `promtool check config --syntax-only`,
  `promtool check rules`, `promtool test rules` và `docker compose config`. Nhưng chưa ai `up` cả
  ngăn xếp lên để xem Prometheus có thật sự scrape được `/metrics` qua bearer token hay không.
* **Không có Alertmanager** — xem mục ngay trên.
* **Không giữ log lâu.** Loki chạy cấu hình mặc định (giữ trong volume, không phân tầng). Cần giữ
  theo tháng thì phải cấu hình `limits_config.retention_period` + compactor.
* **Prometheus giữ 15 ngày.** Đủ để điều tra sự cố và để rút phân vị thật cho
  `docs/operations/SLO.md`. Muốn giữ lâu hơn thì cân đĩa của VM trước — và nhớ rằng
  `QuanlyDiaSapDay` sẽ là thứ kêu nếu quên.
