# DR Runbook — QuanLY (khôi phục thảm họa)

## Mục tiêu
- **RPO** (mất tối đa bao nhiêu data): ≤ 24h (backup hằng ngày 02:00) — hoặc tới lần deploy gần nhất nếu mới deploy.
- **RTO** (thời gian khôi phục): ≤ 1h cho khôi phục DB; ≤ 4h nếu phải dựng lại VM.

## Backup tự động (cài bằng `scripts/backup/install-backup.sh`)
- **Lịch:** `quanly-backup.timer` hằng ngày 02:00 → `pg_dump` (read-only) → `gzip` → `/opt/quanly-backups/quanly-<ngày>.sql.gz`, giữ **14 bản** local.
- **Off-host:** nếu điền `NAS_*` trong `/etc/quanly-backup.env` → đẩy lên **NAS Synology** (192.168.1.100) qua docker smbclient (host coolify CŨNG được Proxmox backup cả VM lên NAS → 2 lớp off-host).
- **Restore-test:** `quanly-restore-test.timer` hằng tuần → nạp dump mới nhất vào DB tạm + đếm User/Quote → DROP. Lỗi → **alert Telegram**.
- **Alert:** mọi lỗi backup/restore-test → Telegram (cấu hình `TELEGRAM_BOT_TOKEN`+`TELEGRAM_ALERT_CHAT`).

## Khôi phục DB (mất data / rollback hỏng)
```bash
# 1. Chọn bản backup (local hoặc kéo từ NAS)
ls -lt /opt/quanly-backups/quanly-*.sql.gz
# 2. (khuyến nghị) dump hiện trạng trước khi ghi đè
docker exec quanly-postgres pg_dump -U quanly -d quanly | gzip > /opt/quanly-backups/before-restore-$(date +%F-%H%M%S).sql.gz
# 3. Nạp lại (dump tạo bằng --clean --if-exists nên tự DROP+CREATE object)
gunzip -c /opt/quanly-backups/quanly-<NGÀY>.sql.gz | docker exec -i quanly-postgres psql -U quanly -d quanly -v ON_ERROR_STOP=1
# 4. Kiểm
docker exec quanly-postgres psql -U quanly -d quanly -tAc 'SELECT count(*) FROM "User";'
# 5. Khởi động lại app để dọn cache/pool
cd /opt/stacks/quanly/quanly && docker compose -f docker-compose.prod.yml restart app worker
```

## Dựng lại toàn bộ (mất host)
Thứ tự: Proxmox restore VM coolify từ NAS **→** (hoặc) dựng VM mới + cài Docker + Coolify **→** `git clone` repo **→** điền `.env` (secret) + `docker-compose.prod.yml` (đã trong repo, secret qua `${VAR}`) **→** `docker compose up -d postgres redis` **→** restore DB (mục trên) **→** `prisma migrate deploy` **→** `up -d app worker` **→** verify `/livez` **→** cài lại cloudflared tunnel **→** `install-backup.sh`.

## Lưu ý
- Backup `pg_dump` KHÔNG đụng app đang chạy (read-only, có advisory-lock của Postgres).
- File backup chứa **toàn bộ PII** → NAS/thư mục backup phải hạn chế quyền (chmod 600, share riêng).
- Kiểm `systemctl list-timers quanly-*` để chắc lịch đang chạy.

---

## ⚠️ TỪ 2026-08-11: SAO LƯU CSDL MỘT MÌNH KHÔNG CÒN KHÔI PHỤC ĐƯỢC

Trước đây bản dump Postgres chứa đủ mọi thứ. Nay **không còn đúng** — hai loại dữ liệu đã rời khỏi CSDL:

| Dữ liệu | Nằm ở đâu | Không có nó thì sao |
|---|---|---|
| CCCD · số tài khoản · lương | vẫn trong CSDL nhưng **đã mã hoá** bằng `PII_ENC_KEY` | dump khôi phục xong nhưng ba trường này **không đọc được vĩnh viễn** |
| Ảnh chứng từ thanh toán | **kho object** (`payment-proofs/…`), CSDL chỉ giữ khoá + hash | hàng dữ liệu trỏ vào object không tồn tại |

**Khôi phục đầy đủ cần ĐỦ BA THỨ:**

```
bản dump CSDL   +   PII_ENC_KEY   +   bản sao kho object
```

Đây không phải suy đoán — đã diễn tập trên DEV ngày 2026-08-11:

* khôi phục dump + **đúng** khoá → giải mã 72/72 trường, khớp bản gốc từng byte;
* khôi phục dump + **sai** khoá → `unable to authenticate data`, dữ liệu mất trắng.

### Sao lưu khoá mã hoá

`PII_ENC_KEY` **phải** được sao lưu **tách khỏi** nơi để bản dump CSDL. Để chung một chỗ thì kẻ lấy
được bản dump cũng lấy luôn khoá — mã hoá thành vô nghĩa; mà mất chỗ đó thì mất cả hai.

* Nơi lưu: trình quản lý bí mật của tổ chức, hoặc phong bì niêm phong cất két (khoá không dài).
* Mỗi môi trường một khoá riêng. Khoá DEV **không** dùng cho production.

### Xoay `PII_ENC_KEY`

Đổi biến môi trường rồi khởi động lại = **toàn bộ dữ liệu cũ hoá đá**. Xoay khoá là một quy trình
bốn bước, và trong suốt quy trình đó ứng dụng vẫn phục vụ bình thường:

```bash
# 1. Đặt THÊM khoá cũ bên cạnh khoá mới, rồi khởi động lại (đọc chấp nhận cả hai khoá,
#    ghi mới luôn dùng khoá mới). Chưa xoay gì cả — chỉ mở cửa sổ chuyển tiếp.
PII_ENC_KEY=<khoá MỚI>
PII_ENC_KEY_OLD=<khoá CŨ>

# 2. Mã hoá lại toàn bộ hàng đã mã hoá. Chạy lại được, đứt giữa chừng thì chạy lại.
#    KHÔNG đụng cột thô. Bản ghi nào không giải được bằng CẢ HAI khoá → script báo đỏ và
#    bỏ qua nguyên hàng (không để lại bản ghi nửa khoá cũ nửa khoá mới).
node --import tsx scripts/migration/pii-backfill.mjs --rotate

# 3. GỠ PII_ENC_KEY_OLD, khởi động lại.
# 4. Chứng minh khoá mới tự đứng được — còn hàng nào mã bằng khoá cũ là bước này báo đỏ.
npm run pii:verify
```

Đừng gỡ `PII_ENC_KEY_OLD` khi bước 2 chưa báo `✓`. Trong lúc cửa sổ còn mở, mỗi lần đọc trúng hàng
chưa xoay sẽ ghi một dòng `warn` — đó là cách biết còn tồn đọng. Chỉ khi bước 4 đạt mới **huỷ** khoá
cũ khỏi kho bí mật.

> `docs/operations/INCIDENT_RESPONSE.md` (mục "Khi nào leo thang") vẫn ghi **"Đừng xoay
> `PII_ENC_KEY`"** — câu đó có từ thời chưa có `--rotate` và cần được thay bằng con trỏ về đây.

### Sao lưu kho object

`scripts/backup/backup-objects.sh` — chạy hằng ngày 02:30 qua `quanly-backup-objects.timer`
(cài bằng `scripts/backup/install-backup.sh`).

* **Cộng dồn, KHÔNG lan truyền xoá.** `mc mirror` không dùng `--remove`: bucket bị xoá nhầm hay bị mã
  hoá tống tiền thì bản sao lưu vẫn GIỮ vật. Đây là khác biệt giữa *bản sao lưu* và *bản chép*.
* **Manifest SHA-256** mỗi lượt (`objects-manifest-<ngày>.tsv`) — về sau đối chiếu được bản gương có
  đúng nội dung không, chứ không chỉ đúng số file.
* **Đối chiếu số lượng** bucket ↔ bản gương ngay sau khi mirror; thiếu object là dừng + alert.
* **Off-host** lên NAS như bản dump CSDL (đóng gói `.tar.gz` khi bản gương còn dưới ngưỡng
  `OBJ_TARBALL_MAX_MB`, vượt ngưỡng thì chỉ đẩy manifest và cảnh báo).
* Cần `S3_*` trong `/etc/quanly-backup.env`. Thiếu → script dừng và alert, KHÔNG im lặng bỏ qua.

Đối chiếu tính toàn vẹn sau khi khôi phục:

```bash
npm run proof:verify   # tải object về, so SHA-256 với hash lưu trong CSDL
npm run pii:verify     # giải mã lại toàn bộ PII, đối chiếu cột thô
```

### Thứ tự khôi phục

1. Khôi phục CSDL (mục trên).
2. Đặt `PII_ENC_KEY` **đúng bản** ứng với thời điểm dump.
3. Khôi phục kho object.
4. Chạy `npm run pii:verify` và `npm run proof:verify` — **cả hai phải PASS** trước khi mở cho người dùng.

### RPO / RTO

| | Hiện tại | Ghi chú |
|---|---|---|
| RPO (mất tối đa bao nhiêu dữ liệu) | 24h | dump CSDL 02:00 + kho object 02:30, cùng nhịp hằng ngày |
| RTO (bao lâu chạy lại được) | ~30 phút | đo trên DEV: restore 615 KB mất vài giây; phần lớn thời gian là dựng lại hạ tầng |

## Diễn tập khôi phục tự động

`scripts/backup/restore-drill.sh` — CN 03:30 hằng tuần (`quanly-restore-drill.timer`).

Khác `restore-test.sh` ở chỗ nó kiểm **đủ ba thứ**, không chỉ "dump có nạp được không":

| Bước | Kiểm cái gì | Hỏng thì nghĩa là |
|---|---|---|
| 1 | Tuổi bản dump + checksum | lịch backup đã chết, hoặc file đã hỏng |
| 2 | Nạp vào CSDL **tạm** + đếm bản ghi | dump không dùng được |
| 3 | `pii:verify` với `PII_ENC_KEY` thật | **khoá đang giữ không mở được bản sao lưu** — CCCD/STK/lương sẽ hoá đá |
| 4 | `proof:verify` đối chiếu SHA-256 | object thiếu hoặc sai — chứng từ tài chính đã mất |
| 5 | Bản gương kho object + 20 mẫu ngẫu nhiên | bản sao lưu object hỏng hoặc quá hạn |

Bước 3 và 4 chính là chỗ hỏng âm thầm: bài test cũ vẫn báo PASS trong cả hai tình huống đó.

## Canh độ tươi (watchdog)

`scripts/backup/backup-watchdog.sh` — mỗi 6h (`quanly-backup-watchdog.timer`).

Mọi script backup chỉ alert **khi chúng chạy và hỏng**. Không cái nào alert được khi chúng **không
chạy**: timer bị disable sau một lần cập nhật, host mất điện đúng khung 02:00, docker daemon chết,
ai đó `systemctl stop`. Chế độ hỏng nguy hiểm nhất của backup là im lặng — mọi thứ trông bình thường
cho tới hôm cần khôi phục thì bản mới nhất đã sáu tuần tuổi.

Watchdog soi **dấu thời gian thành công** (`.db-last-success`, `.objects-last-success`,
`.drill-last-success`) và trạng thái enable của từng timer, nên bắt được cả kiểu chết mà bản thân
script backup không bao giờ báo được. Ngưỡng theo `docs/operations/SLO.md`: CSDL < 26h, kho object
< 26h, diễn tập < 8 ngày.
