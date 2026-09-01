# Sao lưu và khôi phục

> Quy trình khôi phục thảm hoạ chi tiết: [DISASTER_RECOVERY.md](DISASTER_RECOVERY.md).
> Tài liệu này nói về **cơ chế sao lưu** — cái gì chạy, khi nào, và kiểm bằng cách nào.

## Điều quan trọng nhất

**Bản dump CSDL MỘT MÌNH KHÔNG khôi phục được hệ thống.** Từ 2026-08-11, hai loại
dữ liệu đã rời khỏi CSDL:

```
bản dump CSDL   +   PII_ENC_KEY   +   bản sao kho object   =   khôi phục ĐẦY ĐỦ
```

- Thiếu **PII_ENC_KEY** → CCCD / số tài khoản / lương khôi phục ra nhưng **không
  đọc được vĩnh viễn**.
- Thiếu **kho object** → mọi hàng chứng từ thanh toán trỏ vào object không tồn
  tại. Đây là **chứng từ tài chính**.

Khoá phải được cất **ở nơi khác** với bản dump. Để chung một chỗ thì kẻ lấy được
dump lấy luôn khoá (mã hoá thành vô nghĩa), mà mất chỗ đó là mất cả hai.

## Cài đặt

```bash
sudo bash scripts/backup/install-backup.sh
```

Cài script vào `/opt/quanly/`, tạo systemd timer, rồi **chạy thử ngay một lượt**
để verify. Cấu hình đọc từ `/etc/quanly-backup.env` (chmod 600) — script tự tạo
file mẫu nếu chưa có.

## Cái gì chạy, khi nào

| Timer | Lịch | Script | Việc |
|---|---|---|---|
| `quanly-backup` | 02:00 hằng ngày | `backup-db.sh` | `pg_dump` → gzip → checksum → NAS |
| `quanly-backup-objects` | 02:30 hằng ngày | `backup-objects.sh` | gương kho object + manifest SHA-256 |
| `quanly-restore-test` | CN 03:00 | `restore-test.sh` | nạp dump vào CSDL tạm, đếm bản ghi |
| `quanly-restore-drill` | CN 03:30 | `restore-drill.sh` | **diễn tập ĐẦY ĐỦ** (dump + khoá + object) |
| `quanly-backup-watchdog` | mỗi 6h | `backup-watchdog.sh` | canh độ tươi, alert nếu quá hạn |

## Vì sao có watchdog riêng

Mọi script backup chỉ alert **khi chúng chạy và hỏng**. Không cái nào alert được
khi chúng **không chạy**: timer bị disable sau một lần cập nhật hệ thống, host
mất điện đúng khung 02:00, docker daemon chết, ai đó `systemctl stop`.

Chế độ hỏng nguy hiểm nhất của backup là **im lặng** — mọi thứ trông bình thường
cho tới hôm cần khôi phục thì bản mới nhất đã sáu tuần tuổi.

Watchdog soi **dấu thời gian thành công** (`.db-last-success`,
`.objects-last-success`, `.drill-last-success`) và trạng thái enable của từng
timer, nên bắt được cả kiểu chết mà bản thân script backup không bao giờ báo được.

## Những quyết định đáng chú ý trong script

**`backup-db.sh` ghi ra `.partial` rồi mới đổi tên.** Ghi thẳng vào tên cuối cùng
là sai: mất điện giữa chừng để lại một `.sql.gz` **cụt** nhưng đủ lớn để qua kiểm
cỡ, `ls -1t` coi nó là "bản mới nhất", và bước retention có thể xoá mất bản TỐT
cũ hơn. Đổi tên trên cùng filesystem là thao tác nguyên tử. Ngoài ra `gzip -t`
bắt được file cụt mà kiểm cỡ bỏ lọt (dump 500MB đứt ở 300MB).

**`backup-objects.sh` KHÔNG dùng `mc mirror --remove`.** Cộng dồn, không lan
truyền xoá: bucket bị xoá nhầm hay bị mã hoá tống tiền thì bản sao lưu vẫn **giữ
vật**. Đó là khác biệt giữa một *bản sao lưu* và một *bản chép*.

**Retention chạy SAU khi bản mới đã hoàn chỉnh.** Không bao giờ xoá bản cũ dựa
trên một lượt backup còn chưa chắc thành công. `backup-objects.sh` chỉ dọn
manifest — **không bao giờ tự xoá bản gương**, vì bản gương chính là toàn bộ bản
sao lưu.

**Kiểm chỗ trống đĩa trước khi dump.** Backup làm đầy đĩa thì kéo sập luôn
Postgres đang chạy cùng host — sự cố lớn hơn nhiều so với việc bỏ một lượt backup.

## Kiểm tra thủ công

```bash
systemctl list-timers 'quanly-*'          # lịch còn chạy không
/opt/quanly/backup-watchdog.sh            # mọi thứ còn tươi không (exit 1 = có vấn đề)
/opt/quanly/restore-drill.sh              # diễn tập đầy đủ ngay bây giờ
ls -lt /opt/quanly-backups/               # xem hiện có gì
```

`restore-drill.sh` **không đụng CSDL thật** — nó tạo và xoá một CSDL tạm riêng.
