# Ngăn xếp quan sát

> **Đang chạy trên production** từ 2026-09-16 (Alertmanager → Telegram từ 2026-09-17) — xem mục
> "Ngăn xếp quan sát" trong `docs/operations/MONITORING.md`, nguồn duy nhất về hiện trạng. Bản trước
> của dòng này ghi "không bật mặc định", mâu thuẫn với chính mục cuối tệp (audit 2026-09-22, DOC-08).
>
> Biến cần trong `.env` của máy (ngoài METRICS_TOKEN/GRAFANA_PASSWORD/SMTP_*/TELEGRAM_*):
> `QUANLY_ENV` (prod | staging | dev — in đầu mọi cảnh báo) và `HEARTBEAT_URL` (URL ping của dịch vụ
> giám sát NGOÀI; trống = không có ai bên ngoài biết khi cả máy chết).

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
grep -oE 'name: "[a-z_]+"' src/observability.ts | wc -l   # 33 metric ứng dụng
grep -c '^      - alert:' infra/prometheus/alerts.yaml    # 26 quy tắc cảnh báo
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

## ⚠️ MOUNT THƯ MỤC, KHÔNG MOUNT TỆP LẺ

Mọi cấu hình trong ngăn xếp này vào container bằng **mount thư mục**. Đây không phải sở thích —
mount tệp lẻ đã gây ra một lỗi **im lặng** trên production, và nó được tìm ra ngày 2026-09-16:

> Sau khi `deploy.sh` ship tệp `prometheus.yml` đã bỏ chú thích khối `alerting:`, Prometheus vẫn
> đọc **bản cũ**. `POST /-/reload` cũng không cứu được. Tệp trên đĩa đúng, tệp trong container sai.

Nguyên nhân: `deploy.sh` ship bằng `git archive | tar x`, tức nó **thay** tệp (inode mới) chứ không
sửa tại chỗ. Bind-mount một **tệp** gắn vào inode, nên tệp mới không bao giờ tới được container.
Bind-mount một **thư mục** thì mỗi lần mở tệp là một lần tra lại tên, nên bản mới hiện ra ngay.

Đo trực tiếp trên VM production, hai mount cạnh nhau, cùng một phép thay tệp:

```
mount TỆP LẺ   → container thấy: CU
mount THƯ MỤC  → container thấy: MOI
```

Hệ quả rộng hơn — và đây mới là phần đáng lo: `infra/prometheus/alerts.yaml` trước đó **cũng** là
mount tệp lẻ. Nghĩa là **mọi thay đổi quy tắc cảnh báo từ trước tới nay chưa từng tới được
Prometheus đang chạy**, và không có gì báo lỗi: container vẫn khoẻ, target vẫn `up`, bảng vẫn vẽ.

Ràng buộc này nay được khoá bằng một cổng kiểm tổng quát trong
`tests/am-canh-bao-den-nguoi.test.js`: **không service nào được mount một tệp có phần mở rộng**
(`.yml`, `.yaml`, `.sh`, `.tpl`, `.json`, `.conf`, `.toml`, `.ini`). Và các bài cạnh đó không so
chuỗi đường dẫn nữa mà **giải** đường dẫn trong container ngược về tệp trong repo, rồi kiểm tệp đó
có thật.

**Khi sửa cấu hình của ngăn xếp này, nhớ dựng lại container** (`up -d --force-recreate <service>`)
nếu nó đang chạy từ trước lúc đổi sang mount thư mục — bản thân việc đổi kiểu mount cũng cần một
lần dựng lại mới có hiệu lực.

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

## ALERTMANAGER — cảnh báo đi tới đâu

**TRƯỚC 2026-09-16**, mục này mang tiêu đề "KHÔNG CÓ ALERTMANAGER" và nói thẳng rằng 22 quy tắc <!-- so-lich-su -->
được đánh giá thật, chuyển sang `firing` thật, rồi **DỪNG LẠI** ở giao diện Prometheus — không
email, không ai bị đánh thức. Đó là "có cảnh báo" theo nghĩa **kỹ thuật**, chưa phải theo nghĩa
**vận hành**.

Nay khoảng cách đó đã đóng: cảnh báo đi ra **email**, qua **chính máy chủ SMTP mà ứng dụng đang
dùng để gửi thư thật**. Không dựng kênh mới — một kênh đã chạy và đã có người đọc thì đáng tin hơn
một kênh vừa dựng mà chưa ai thử.

| tệp | vai trò |
|---|---|
| [`alertmanager.yml.tpl`](alertmanager.yml.tpl) | **bản mẫu**, không chạy trực tiếp được |
| [`alertmanager-entrypoint.sh`](alertmanager-entrypoint.sh) | dựng cấu hình thật từ bản mẫu + `.env`, rồi `exec` |
| khối `alerting:` trong [`prometheus.yml`](prometheus.yml) | trỏ Prometheus vào `alertmanager:9093` |

### Vì sao phải có bước "dựng cấu hình" thay vì một tệp YAML thường

Alertmanager **không nội suy biến môi trường** trong tệp cấu hình — y hệt Prometheus. Điều này đã
được **đo**, không phải suy đoán:

```
docker run -e SMTP_HOST=smtp.gmail.com prom/alertmanager:v0.28.1 --config.file=…
GET /api/v2/status  →  smtp_smarthost: ${SMTP_HOST}:${SMTP_PORT}     ← nguyên văn, chưa thay
amtool check-config …  →  SUCCESS                                     ← vẫn báo xanh
```

Nghĩa là trỏ thẳng `--config.file` vào bản mẫu sẽ cho một Alertmanager **khởi động bình thường**,
**qua mọi phép kiểm cú pháp**, và gửi thư tới một máy chủ tên `${SMTP_HOST}` không tồn tại. Im
lặng — đúng chế độ hỏng mà việc dựng Alertmanager sinh ra để chấm dứt. Nên entrypoint **từ chối
khởi động** nếu thiếu biến bắt buộc hoặc còn sót một `${` nào sau khi thay.

### Biến trong `.env` của máy chủ

| biến | bắt buộc | ghi chú |
|---|---|---|
| `SMTP_HOST` `SMTP_PORT` `SMTP_FROM` | có | dùng chung với ứng dụng |
| `SMTP_USER` | **không** | rỗng → gỡ hẳn `smtp_auth_*` và tắt `smtp_require_tls`. Đúng cho MailHog ở dev, **sai** cho Gmail |
| `SMTP_PASS` | khi có `SMTP_USER` | vào bằng **đường tệp** (`/run/secrets/smtp_password`), không qua phép thay chuỗi |
| `ALERT_EMAIL_TO` | có | bỏ trống thì mặc định về `SMTP_USER`. Nhiều người nhận: ngăn cách bằng dấu phẩy |
| `TELEGRAM_BOT_TOKEN` | không | bật kênh Telegram. Vào bằng **đường tệp** (`/run/secrets/telegram_bot_token`), không qua phép thay chuỗi |
| `TELEGRAM_CHAT_ID` | không | nơi NHẬN cảnh báo. Phải có **cùng lúc** với token, xem dưới |

### Kênh Telegram cho cảnh báo hệ thống (mặc định TẮT)

Có **đủ cả hai** `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` → cảnh báo đi Telegram và khối
`email_configs` bị **gỡ hẳn** khỏi cấu hình dựng ra. Không có cái nào → giữ nguyên email. Có
**đúng một** → entrypoint thoát 78 và container KHÔNG lên: bật nửa vời khiến người ta tin mình có
kênh mà thật ra không có, tệ hơn hẳn việc biết mình chỉ có một kênh.

Vì sao tách khỏi email thay vì gửi cả hai: hộp thư của người vận hành **cũng** là hộp thư nhận
thông báo nghiệp vụ (`src/notifications.ts` — báo giá được duyệt, job xong…). Cảnh báo hệ thống
lẫn vào đó là cảnh báo bị lướt qua. Và 2 giờ sáng thì hộp thư không đánh thức ai.

**Lấy `TELEGRAM_CHAT_ID`:** tạo nhóm → thêm bot vào → gửi một tin bất kỳ → mở
`https://api.telegram.org/bot<TOKEN>/getUpdates` → đọc `message.chat.id`.

**NÊN LÀ MỘT NHÓM, không phải chat riêng.** Chat riêng nghĩa là một chiếc điện thoại để im lặng
là không ai biết hệ thống đang hỏng — đúng chế độ hỏng mà kênh này sinh ra để chặn. Id nhóm là số
**âm**, bắt đầu bằng `-100`.

⚠️ Bật Telegram thì **cảnh báo không còn đi email nữa**. Kênh này trở thành kênh duy nhất, nên
token hết hạn hoặc bot bị xoá là cảnh báo câm — xem `docs/REMAINING_RISKS.md`.

`SMTP_USER` và `smtp_require_tls` **buộc chặt vào nhau** trong entrypoint: TLS ở đây tồn tại để che
mật khẩu trên đường truyền, nên "có mật khẩu" và "bắt buộc TLS" phải bật/tắt cùng nhau. Cho chỉnh
riêng lẻ là mở đúng cánh cửa dẫn tới một production gửi mật khẩu Gmail qua kết nối trần.

### Nhịp gửi và luật nén im lặng

* `group_by: [alertname, instance]` — gom quá rộng thì một sự cố đang diễn ra sẽ **nuốt mất** cảnh
  báo thứ hai vừa nổ.
* `critical` (11/22 quy tắc) đi nhánh riêng: `group_wait 10s`, nhắc lại mỗi giờ. `warning`:
  `group_wait 30s`, nhắc lại mỗi 4 giờ.
* Hai `inhibit_rules`: `QuanlyCsdlKhongToiDuoc` và `QuanlyTienTrinhKhoiDongLaiLienTuc` **nén** mọi
  `warning` **cùng instance**. CSDL chết thì kéo theo hàng loạt cảnh báo hệ quả (tỉ lệ lỗi, độ trễ,
  pool chờ); gửi hết là chôn nguyên nhân gốc dưới năm lá thư.

### Đã chạy thử thật, không phải chỉ kiểm cú pháp

Dựng MailHog + Alertmanager bằng đúng hai tệp trong thư mục này, đẩy một cảnh báo qua
`POST /api/v2/alerts`, rồi **đọc thư nhận được**: tiêu đề, phần "cách xử lý" và tiếng Việt đều
nguyên vẹn; một cảnh báo `warning` cùng instance với `critical` đang kêu thì ở trạng thái
`suppressed` đúng như luật nén im lặng mô tả.

Đường báo động **thứ hai** vẫn **cố ý** không đi qua Prometheus: backup watchdog qua Telegram
(`scripts/backup/backup-watchdog.sh`, timer mỗi 6 giờ) — ⚠️ **chưa được cài trên production** (đo
2026-09-22), xem docs/operations/BACKUP_RESTORE.md. Một hệ giám sát chết không được
phép làm im luôn cả báo động về sao lưu — kể cả khi hệ giám sát đó nay đã biết gửi email.

## Chưa làm (có chủ ý)

* ~~**Chưa chạy thử bằng Docker thật.**~~ Đã bật trên production ngày 2026-09-16: 3/3 target
  Prometheus `up`, 22 quy tắc được nạp. Phần Alertmanager cũng đã chạy thử end-to-end với MailHog <!-- so-lich-su -->
  (xem mục trên) — thư thật sự tới nơi, không chỉ qua `check-config`.
* ~~**Cảnh báo chỉ có MỘT kênh (email).**~~ Từ 2026-09-17 production và dev đều gửi cảnh báo hệ
  thống vào NHÓM Telegram (bot `@GiaNguyenOpsBot`, `chat_id` âm = nhóm). Đã thử end-to-end trên
  production, không chỉ qua `check-config`: bắn cảnh báo thật vào `/api/v2/alerts` → 0 lỗi gửi, và
  một tin nhắn gửi bằng đúng cặp khoá của production trả `ok: true`.
  Lưu ý kênh này vẫn là **kênh DUY NHẤT** — bật Telegram thì khối email bị gỡ khỏi cấu hình (xem
  cảnh báo ở mục trên). Đổi lại: nhóm có nhiều người đọc, nên một người tắt thông báo không làm
  cả đội mù như hòm thư cá nhân.
* **Chưa có lịch trực.** Mọi cảnh báo đi về cùng một hòm thư, không phân ca, không leo thang.
* **Log giữ 30 ngày.** `loki.yaml` bật compactor + `retention_period: 720h` (audit 2026-09-22,
  OBS-15). Trước đó Loki chạy cấu hình mặc định và không xoá gì — volume lớn mãi trên cùng đĩa với
  CSDL. Đổi cấu hình này thì phải `up -d` lại service loki (deploy.sh không dựng lại ngăn quan sát).
* **Prometheus giữ 15 ngày.** Đủ để điều tra sự cố và để rút phân vị thật cho
  `docs/operations/SLO.md`. Muốn giữ lâu hơn thì cân đĩa của VM trước — và nhớ rằng
  `QuanlyDiaSapDay` sẽ là thứ kêu nếu quên.
