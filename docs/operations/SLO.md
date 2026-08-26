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

Cả sáu dòng đều là **giả định**: chưa có Prometheus scrape production nào chạy đủ
lâu để rút ra số thật. Việc đầu tiên cần làm là để metric chạy hai tuần rồi quay
lại đặt mục tiêu theo phân vị thật, thay vì theo cảm tính.

Số đo hiệu năng cũ nằm ở
[docs/archive/performance/PERFORMANCE_BENCHMARK.md](../archive/performance/PERFORMANCE_BENCHMARK.md) —
**là số LỊCH SỬ**, đo trên máy dev, không dùng làm cơ sở cho SLO production.

## Mục tiêu sao lưu / khôi phục

Khác với nhóm trên, nhóm này **đã được đo và có chốt tự động** — ngưỡng nằm trong
`scripts/backup/backup-watchdog.sh`, chạy mỗi 6 giờ và alert khi vượt.

| Mục | Mục tiêu | Chốt bởi |
|---|---|---|
| RPO (mất tối đa bao nhiêu dữ liệu) | ≤ 24h | lịch dump 02:00 + kho object 02:30 |
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
```

## Cảnh báo NÊN đặt

Chưa cái nào được cấu hình — đây là danh sách việc cần làm, không phải mô tả
hiện trạng.

| Cảnh báo | Điều kiện | Vì sao |
|---|---|---|
| App chết | `up{job="quanly"} == 0` quá 2 phút | mất dịch vụ |
| 5xx cao | tỉ lệ 5xx > 2% trong 10 phút | hỏng thật, không phải nhiễu |
| CSDL không tới được | `/readyz` hỏng 3 lần liên tiếp | app còn sống nhưng vô dụng |
| Hàng đợi xuất file đầy | `export_rejected_total` tăng | người dùng đang bị từ chối |
| Backup quá hạn | watchdog exit ≠ 0 | **đã có**, qua Telegram |

Ba dòng đầu cần Prometheus + Alertmanager, hiện **chưa dựng**. Backup thì đã có
đường alert riêng qua Telegram, không phụ thuộc Prometheus — cố ý, vì đó là thứ
không được phép im lặng.

## Ngân sách lỗi, với đội một người

99,5% trong giờ làm việc (~200 giờ/tháng) là **một tiếng chết mỗi tháng**. Con số
đó chọn có chủ đích: nó đủ rộng để một lần deploy hỏng + rollback không "tiêu"
hết tháng, và đủ hẹp để hai lần như thế trong một tháng là tín hiệu phải dừng lại
sửa nền tảng thay vì đẩy tính năng.
