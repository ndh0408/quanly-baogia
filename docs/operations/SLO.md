# SLO — mục tiêu mức dịch vụ

Đây là hệ thống **nội bộ của hai công ty**, không phải dịch vụ bán ra ngoài. Người
dùng là nhân viên kinh doanh, nhân sự và kế toán, dùng trong giờ hành chính, ở
Việt Nam. SLO dưới đây được đặt cho đúng quy mô đó — không có "bốn số chín", vì
đội vận hành là **một người** và không có ai trực đêm.

> Mỗi dòng ghi rõ mục tiêu đó **đã được đo** hay còn là **giả định**. Một SLO chưa
> đo được thì vẫn có ích (nó nói ta quan tâm điều gì), nhưng đừng báo cáo nó như
> sự thật.

## Mục tiêu dịch vụ

| Mục | Mục tiêu | Đo bằng | Trạng thái |
|---|---|---|---|
| Sẵn sàng (giờ làm việc) | ≥ 99,5% | tỉ lệ `/livez` thành công | giả định |
| Độ trễ API p95 | < 300 ms | `http_request_duration_seconds` | giả định — chưa có dữ liệu production |
| Lưu báo giá p95 | < 2 s (báo giá thường) | `http_request_duration_seconds{route="/:id",method="PUT"}` | giả định |
| Đăng nhập p95 | < 1 s | `http_request_duration_seconds{route="/login"}` | giả định; bcrypt cost 12 là phần lớn thời gian |
| Xuất file p95 | < 10 s | `export_duration_seconds` | giả định |
| Tỉ lệ 5xx | < 0,5% | `http_requests_total{status=~"5.."}` | giả định |

Cả sáu dòng đều là **giả định**: repo nay đã có một Prometheus dựng được bằng một
lệnh (`infra/observability/`, giữ 15 ngày số liệu), nhưng nó **chưa bật ở
production** nên chưa có chuỗi số liệu thật nào đủ dài. Việc đầu tiên cần làm là
bật ngăn xếp đó, để metric chạy hai tuần, rồi quay lại đặt mục tiêu theo phân vị
thật thay vì theo cảm tính.

Số đo hiệu năng cũ nằm ở
[docs/archive/performance/PERFORMANCE_BENCHMARK.md](../archive/performance/PERFORMANCE_BENCHMARK.md) —
**là số LỊCH SỬ**, đo trên máy dev, không dùng làm cơ sở cho SLO production.

## Mục tiêu sao lưu / khôi phục

Ngưỡng của nhóm này nằm trong `scripts/backup/backup-watchdog.sh` (mỗi 6 giờ, alert khi vượt) —
**nhưng watchdog CHƯA được cài trên production** (đo 2026-09-22: chỉ có timer `quanly-backup` và
`quanly-restore-test`; không có timer kho object, không có bản sao ngoài máy). Nên cột "Chốt bởi" dưới
đây là chốt **có trong repo**, chưa phải chốt đang chạy. Trạng thái thật: bảng đầu
[DISASTER_RECOVERY.md](DISASTER_RECOVERY.md).

| Mục | Mục tiêu | Chốt bởi |
|---|---|---|
| RPO (mất tối đa bao nhiêu dữ liệu) | ≤ 24h — **production chưa đạt** cho kho object và khi mất host | lịch dump 02:00 + kho object 02:30 + off-host (hai thứ sau chưa có trên production) |
| RTO (bao lâu chạy lại được) | ~30 phút khôi phục CSDL | đo trên DEV, xem DISASTER_RECOVERY.md |
| Backup CSDL thành công gần nhất | < 26h | watchdog |
| Sao lưu kho object gần nhất | < 26h | watchdog |
| Diễn tập khôi phục ĐẦY ĐỦ gần nhất | < 8 ngày | watchdog |

"Diễn tập ĐẦY ĐỦ" nghĩa là `restore-drill.sh`: nạp dump vào CSDL tạm **và** chứng
minh `PII_ENC_KEY` giải mã được **và** đối chiếu SHA-256 của chứng từ. Một bản
backup chưa khôi phục thử thì chưa phải bản backup.

## Truy vấn đo

```promql
# Tỉ lệ 5xx trong 5 phút
sum(rate(http_requests_total{status=~"5.."}[5m]))
  / sum(rate(http_requests_total[5m]))

# Độ trễ API p95
histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[5m])) by (le))

# Độ trễ lưu báo giá p95
histogram_quantile(0.95,
  sum(rate(http_request_duration_seconds_bucket{method="PUT"}[5m])) by (le))

# Xuất file p95 (tách đường worker / nội tuyến)
histogram_quantile(0.95, sum(rate(export_duration_seconds_bucket[5m])) by (le, path))

# Xuất file bị TỪ CHỐI vì hết công suất — chạm ngưỡng này nghĩa là cần nâng
# EXPORT_MAX_ACTIVE hoặc tách worker riêng, không phải "người dùng thử lại đi"
sum(rate(export_rejected_total[15m]))

# Hàng đợi xuất file đang sâu bao nhiêu
export_queue_depth

# Sức khoẻ phụ thuộc (đo NGAY LÚC SCRAPE, xem src/observability.ts)
# HEALTH_METRICS=0 làm cả năm gauge dưới đây KHÔNG PHÁT CHUỖI NÀO (không phải phát 0) — chọn im
# lặng, không phải chọn báo động giả. Xem .env.example tại chỗ khai HEALTH_METRICS.
db_up                                    # 1 = Postgres trả lời SELECT 1
redis_configured == 1 and redis_up == 0  # có cấu hình Redis nhưng không nối được
disk_free_bytes / disk_total_bytes       # tỉ lệ trống của hệ tệp

# Cấu hình bắt buộc ở production còn THIẾU (chỉ phát khi NODE_ENV=production)
config_missing == 1                      # nhãn `key` = tên biến môi trường chưa đặt
config_missing{key="REDIS_URL"} == 1     # ca mà `redis_configured == 1 and ...` ở trên KHÔNG bắt được

# Đường realtime có chập chờn không (§18)
sse_clients                              # số kết nối SSE đang mở (= "sse_connections" của §18)
rate(sse_reconnects[15m])                # nhịp NỐI LẠI — tăng đột biến = proxy cắt, hoặc áp lực ngược
sum by (event) (rate(sse_events[5m]))    # lưu lượng sự kiện thật sự giao được
```

## Cảnh báo

**26 quy tắc đã được VIẾT và đã qua `promtool check rules` + `promtool test rules`**
— chúng nằm ở [`infra/prometheus/alerts.yaml`](../../infra/prometheus/alerts.yaml),
bài kiểm logic ở `infra/prometheus/alerts.test.yaml`, cổng CI là
`npm run check:alerts`. Bản trước của tài liệu này viết "chưa cái nào được cấu
hình", và câu đó **nói ngược mã nguồn**.

Nhưng phải phân biệt ba mức, vì gộp chúng lại là cách tự lừa mình:

| Mức | Trạng thái |
|---|---|
| Quy tắc **được viết + kiểm logic** | ✅ 26 quy tắc, cổng `npm run check:alerts` chặn hồi quy |
| Có Prometheus **để nạp** chúng | ✅ `infra/observability/` (Prometheus + Loki + Promtail + Grafana) — **ĐANG CHẠY trên production từ 2026-09-16**, ba target đều `up` |
| Có ai **bị đánh thức** khi chúng kêu | ✅ Alertmanager → **nhóm Telegram** từ 2026-09-17 (hiện trạng: [MONITORING.md](MONITORING.md)). ⚠️ Chưa có giám sát từ NGOÀI — xem dưới |

| Cảnh báo | Quy tắc | Mức |
|---|---|---|
| Không scrape được `/metrics` | `QuanlyMetricsKhongScrapeDuoc` (`up == 0`, 3m) | critical |
| Mất sạch target | `QuanlyKhongConTargetNao` (`absent(up{…})`, 10m) | critical |
| 5xx cao | `QuanlyTiLeLoi5xxCao` (> 2% trong 10m) | critical |
| Độ trễ p95 cao | `QuanlyDoTreP95Cao` (> 2s trong 15m) | warning |
| **CSDL không tới được** | `QuanlyCsdlKhongToiDuoc` (`db_up == 0`, 3m) | critical |
| **Redis không tới được** | `QuanlyRedisChet` (`redis_configured == 1 and redis_up == 0`, 3m) | critical |
| **Đĩa sắp đầy** | `QuanlyDiaSapDay` (`disk_free_bytes / disk_total_bytes < 0,10`, 15m) | critical |
| **Production thiếu cấu hình bắt buộc** | `QuanlyThieuCauHinhBatBuoc` (`config_missing{key!="PII_ENC_KEY"} == 1`, 30m) | warning |
| **PII đang ghi THÔ** | `QuanlyPiiGhiTho` (`config_missing{key="PII_ENC_KEY"} == 1`, 30m) | critical |
| Backplane SSE chết | `QuanlySseBackplaneChet` | critical |
| PUBLISH SSE thất bại | `QuanlySsePublishThatBai` | warning |
| Hàng đợi xuất file đầy | `QuanlyHangDoiXuatDay` | critical |
| Xuất file bị từ chối | `QuanlyXuatFileBiTuChoi` | warning |
| Worker xuất file căng cứng | `QuanlyWorkerXuatCangCung` | warning |
| Job nền chất đống | `QuanlyJobNenChatDong` | warning |
| Job nền thất bại | `QuanlyJobNenThatBai` | warning |
| Không worker nào chạy job | `QuanlyKhongCoWorkerNao` | critical |
| Tiến trình khởi động lại liên tục | `QuanlyTienTrinhKhoiDongLaiLienTuc` | critical |
| Tiến trình vừa khởi động lại MỘT lần (deploy, heap-OOM, sập) | `QuanlyTienTrinhVuaKhoiDongLai` | warning |
| Phụ thuộc ngoài lỗi (SMTP / Telegram / kho object) | `QuanlyPhuThuocNgoaiLoi` | warning |
| Alertmanager gửi thất bại | `QuanlyCanhBaoGuiThatBai` | warning |
| Nhịp tim ra dịch vụ ngoài (LUÔN kêu, không tới người) | `QuanlyWatchdog` | heartbeat |
| Event loop nghẽn | `QuanlyEventLoopNgheN` | warning |
| Backup quá hạn | `scripts/backup/backup-watchdog.sh` | ⚠️ **CHƯA cài trên production** (đo 2026-09-22) — xem BACKUP_RESTORE.md |

Ba dòng in đậm là bổ sung của §28 và chúng lấp đúng ba điểm mù: `up` vẫn bằng 1
khi CSDL chết (tiến trình Node vẫn trả `/metrics`); quy tắc Redis cũ chỉ nói về
*backplane SSE* nên bản triển khai không dùng backplane im lặng dù Redis đang giữ
hàng đợi/rate-limit/Pub-Sub SSE; và đĩa đầy không sinh 5xx nào cho tới đúng lúc Postgres
không ghi nổi WAL — lúc đó đã mất dữ liệu.

Hai dòng `config_missing` là lớp bù cho §10. §10 đòi production **fail-fast** khi
thiếu Redis/storage credentials; `src/config.ts` cố ý chỉ `console.warn` vì "làm cả
ứng dụng không khởi động vì một tính năng phụ còn tệ hơn". Lập luận đó đúng, nhưng
nó chỉ đứng vững nếu có lớp bù — mà lớp bù cũ là một dòng log lúc khởi động, trôi
mất sau lần cuộn log đầu tiên. Đáng chú ý: `QuanlyRedisChet` **không** bắt được ca
này, vì nó gác trên `redis_configured == 1` còn "quên đặt REDIS_URL" cho ra
`redis_configured = 0` — quy tắc cũ tự loại trừ đúng ca nguy hiểm nhất. Bài kiểm
`"Production QUÊN REDIS_URL … → PHẢI kêu"` trong `alerts.test.yaml` khoá cả hai vế đó.

### Cảnh báo dừng lại ở đâu (đọc kỹ)

Bản trước của mục này ghi "không có Alertmanager" — đã lỗi thời từ 2026-09-17 (audit 2026-09-22,
DOC-08). Hiện trạng duy nhất nằm ở [MONITORING.md](MONITORING.md): Prometheus → Alertmanager → nhóm
Telegram, trên CHÍNH máy production.

Chỗ hở còn lại là **giám sát từ ngoài**: VM chết, docker chết, tunnel chết hay Alertmanager hỏng thì
không cảnh báo nào được gửi. Repo đã có nhịp tim (`QuanlyWatchdog` + route `nhip-tim`); chủ repo cần
đặt `HEARTBEAT_URL` và một HTTP check ngoài vào `/livez` (MONITORING.md). Backup watchdog (đường báo
động cố ý tách khỏi Prometheus) **chưa được cài** trên production.

## Ngân sách lỗi, với đội một người

99,5% trong giờ làm việc (~200 giờ/tháng) là **một tiếng chết mỗi tháng**. Con số
đó chọn có chủ đích: nó đủ rộng để một lần deploy hỏng + rollback không "tiêu"
hết tháng, và đủ hẹp để hai lần như thế trong một tháng là tín hiệu phải dừng lại
sửa nền tảng thay vì đẩy tính năng.
