# Sao lưu và khôi phục

> Quy trình khôi phục thảm hoạ chi tiết: [DISASTER_RECOVERY.md](DISASTER_RECOVERY.md).
> Tài liệu này nói về **cơ chế sao lưu** — cái gì chạy, khi nào, và kiểm bằng cách nào.

## ⚠️ Trạng thái production đã đo (2026-09-22) — TÁCH khỏi phần "cơ chế có trong repo"

| | Production hôm nay |
|---|---|
| Timer đang có | **2/5**: `quanly-backup` (02:00 UTC) và `quanly-restore-test` (hằng tuần, chạy thành công) |
| Bản dump CSDL | `/opt/quanly-backups` **trên cùng máy** với Postgres |
| Bản sao ngoài máy | **KHÔNG CÓ** — `/etc/quanly-backup.env` không có `NAS_*` (chưa có đích rclone) |
| Kho object (ảnh chứng từ) | **KHÔNG có bản sao nào** — không có timer `quanly-backup-objects` |
| Watchdog, diễn tập đầy đủ | không có timer |
| Script trên host | `/opt/quanly/backup-db.sh` **khác md5** với repo — mọi bản vá trong repo chưa tới host |

Mọi mục bên dưới mô tả thứ **repo** làm được khi đã cài đúng. Chưa cài thì nó chưa bảo vệ gì. Việc
phải làm tay: mục [Đưa production về đúng cơ chế](#đưa-production-về-đúng-cơ-chế).

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

Khoá phải được cất **ở nơi khác** với bản dump — khoá cần để dựng lại server được giữ ngoài repo, ở
kho khoá của chủ repo (không bao giờ vào git). Để chung một chỗ thì kẻ lấy được
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
| `quanly-backup` | 02:00 hằng ngày | `backup-db.sh` | `pg_dump` → gzip → checksum → (off-host **nếu cấu hình**: NAS và/hoặc rclone crypt) |
| `quanly-backup-objects` | 02:30 hằng ngày | `backup-objects.sh` | gương kho object + manifest SHA-256 → (off-host nếu cấu hình) |
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
`.objects-last-success`, `.drill-last-success`, và `.offhost-{db,objects}-last-success`
khi đã cấu hình off-host) và trạng thái enable của từng timer, nên bắt được cả kiểu
chết mà bản thân script backup không bao giờ báo được.

## Off-host

Bản sao nằm cùng máy chỉ chống được lỗi LOGIC (xoá nhầm, migrate hỏng). Nó không chống được đĩa hỏng,
cháy, ransomware hay mất máy — mọi bản cùng chết một lượt. Hai đích, độc lập, cấu hình đích nào thì
đẩy đích đó (logic chung ở `scripts/backup/offhost-lib.sh`):

| Đích | Biến trong `/etc/quanly-backup.env` | Mã hoá | Ngoài toà nhà |
|---|---|---|---|
| NAS (SMB, docker smbclient) | `NAS_SHARE` `NAS_USER` `NAS_PASS` `NAS_SUBDIR` | ❌ bản thô | ❌ cùng LAN |
| rclone remote kiểu **crypt** (R2/B2/S3/SFTP… bọc crypt) | `OFFHOST_RCLONE_REMOTE` `OFFHOST_RCLONE_CONFIG` `OFFHOST_KEEP_DAYS` | ✅ phía máy (NaCl secretbox) | ✅ |

**Hành vi khi CHƯA cấu hình đích nào** (chủ repo chốt 2026-09-23): lượt backup vẫn exit 0 — bản local
vẫn là bản sao lưu tốt — nhưng in `OFFHOST-CHUA-CAU-HINH` vào journal, ghi
`backup_offhost_configured{scope="host"} 0` vào `/var/lib/quanly-backup/quanly_backup.prom` (app phơi
ra `/metrics` qua `BACKUP_STATUS_FILE`), và watchdog nói ra ở dòng tóm tắt. **Không** gửi Telegram mỗi
đêm. **Đã cấu hình mà đẩy hỏng** thì khác: Telegram + unit systemd `failed`, watchdog cảnh báo khi dấu
off-host cũ quá 26h.

**Đích rclone PHẢI là remote kiểu `crypt`.** Script đọc `rclone listremotes --long`; remote khai trong
`OFFHOST_RCLONE_REMOTE` mà không phải `crypt` thì **từ chối đẩy** (dump chứa CCCD/số tài khoản/lương —
không được rời máy ở dạng thô). Mỗi tệp đẩy xong được `rclone cryptcheck` đối chiếu băm với bản gốc
mà không cần tải về; đã diễn tập bằng docker thật ngày 2026-09-23 (sửa 1 byte bản ngoài → cryptcheck
thoát 1). rclone chạy trong container ghim digest (`RCLONE_IMAGE`), tệp cấu hình mount **read-only**.

### Cài đích rclone crypt (chủ repo làm tay trên host)

```bash
# 1. Tạo bucket ở nhà cung cấp NGOÀI toà nhà (vd Cloudflare R2 / Backblaze B2) và một khoá
#    CHỈ có quyền GHI + ĐỌC (không quyền xoá nếu nhà cung cấp cho phép) — kẻ chiếm máy không xoá
#    được bản ngoài. Đặt vòng đời (lifecycle) giữ ~90 ngày ở PHÍA BUCKET.
# 2. Viết cấu hình (tương tác, trong container — host không phải cài rclone):
sudo install -m 600 /dev/null /etc/quanly-rclone.conf
sudo docker run --rm -it -v /etc/quanly-rclone.conf:/cfg/rclone.conf \
  rclone/rclone:1.75.1@sha256:45401ad7410db1d67ffdb58e19059ad20b0d8e0285a60e38bbec55cc1019c7a5 \
  --config /cfg/rclone.conf config
#    - remote thứ nhất, vd `r2`, kiểu s3 (provider Cloudflare/…): khoá ở bước 1.
#    - remote thứ hai TÊN `quanly-offsite`, kiểu `crypt`, remote = `r2:<bucket>/quanly`,
#      filename_encryption = off (tên tệp không nhạy cảm, khôi phục dễ tra), đặt password + password2.
# 3. KÝ GỬI password + password2 của crypt vào kho khoá của chủ repo (ngoài repo, không bao giờ vào
#    git), CÙNG PII_ENC_KEY, MFA_ENC_KEY, POSTGRES_PASSWORD, MINIO_ROOT_* — TÁCH khỏi máy này. Mất máy mà không còn mật khẩu
#    crypt thì bản off-host là một khối mã không mở được.
# 4. Khai trong /etc/quanly-backup.env:
#      OFFHOST_RCLONE_REMOTE=quanly-offsite:
#      OFFHOST_RCLONE_CONFIG=/etc/quanly-rclone.conf
#      OFFHOST_KEEP_DAYS=0        # 0 = không xoá từ máy này (vòng đời do bucket lo)
# 5. Chạy thử một lượt và đọc kết quả:
sudo /opt/quanly/backup-db.sh && sudo /opt/quanly/backup-objects.sh && sudo /opt/quanly/backup-watchdog.sh
cat /var/lib/quanly-backup/quanly_backup.prom
```

### Kéo bản off-host về (khi mất máy)

```bash
# Trên máy MỚI: dựng lại /etc/quanly-rclone.conf từ kho khoá của chủ repo (cùng password/password2 crypt).
R="docker run --rm -v /etc/quanly-rclone.conf:/cfg/rclone.conf:ro -v /opt/quanly-backups:/data \
   rclone/rclone:1.75.1@sha256:45401ad7410db1d67ffdb58e19059ad20b0d8e0285a60e38bbec55cc1019c7a5 --config /cfg/rclone.conf"
$R lsl quanly-offsite:db | sort -k2,3 | tail -5                    # bản dump mới nhất
$R copy quanly-offsite:db/<quanly-NGÀY.sql.gz> /data/ && $R copy quanly-offsite:db/<quanly-NGÀY.sql.gz>.sha256 /data/
( cd /opt/quanly-backups && [ "$(sha256sum <quanly-NGÀY.sql.gz> | cut -d' ' -f1)" = "$(cat <quanly-NGÀY.sql.gz>.sha256)" ] && echo KHỚP )
$R copy quanly-offsite:objects /data/objects                      # bản gương kho object
```

Rồi làm tiếp theo [DISASTER_RECOVERY.md](DISASTER_RECOVERY.md) (khôi phục DB, rồi bước 3 "Khôi phục kho object").

## Đưa production về đúng cơ chế

Việc **chủ repo làm tay** trên host (agent không được ssh production). Theo thứ tự:

1. **Đối chiếu bản trên host với repo TRƯỚC khi cài đè** — bản trên host khác md5, có thể chứa bản vá
   chưa về repo: `diff /opt/quanly/backup-db.sh <repo>/scripts/backup/backup-db.sh`. Có gì chỉ ở host
   thì đưa về repo trước. (`deploy.sh` nay in cảnh báo khi hai bản lệch — xem DEPLOYMENT.md.)
2. Điền `/etc/quanly-backup.env`: `TELEGRAM_*`, `PII_ENC_KEY` (cho diễn tập), và **đích off-host** (mục
   trên). `S3_*` có thể để trống — `backup-objects.sh` tự đọc từ container app.
3. `sudo INSTALL_SKIP_DRILL=1 bash scripts/backup/install-backup.sh` từ thư mục repo đã deploy
   (`/opt/stacks/quanly/quanly`). `INSTALL_SKIP_DRILL=1` hoãn lượt diễn tập đầy đủ (nó dựng container +
   bucket TẠM trên chính máy prod) sang lịch CN 03:30; bỏ cờ nếu chạy ngoài giờ làm việc.
4. Kiểm: `systemctl list-timers 'quanly-*'` phải ra **5** timer;
   `cat /var/lib/quanly-backup/quanly_backup.prom`; `ls /opt/quanly-backups/.objects-last-success`.
5. Ký gửi khoá (bước 3 của mục rclone) nếu chưa làm.
6. Cập nhật bảng "Trạng thái production đã đo" ở đầu tài liệu này và DISASTER_RECOVERY.md, kèm ngày.

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
