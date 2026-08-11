# DR Runbook — QuanLY (khôi phục thảm họa)

## Mục tiêu
- **RPO** (mất tối đa bao nhiêu data): ≤ 24h (backup hằng ngày 02:00) — hoặc tới lần deploy gần nhất nếu mới deploy.
- **RTO** (thời gian khôi phục): ≤ 1h cho khôi phục DB; ≤ 4h nếu phải dựng lại VM.

## Backup tự động (cài bằng `scripts/install-backup.sh`)
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
* Xoay khoá: **phải** giải mã bằng khoá cũ rồi mã hoá lại bằng khoá mới (chạy backfill với khoá mới).
  Đổi biến môi trường mà không backfill = toàn bộ dữ liệu cũ hoá đá.
* Mỗi môi trường một khoá riêng. Khoá DEV **không** dùng cho production.

### Sao lưu kho object

Kho object cần cơ chế riêng — bật versioning của bucket, hoặc đồng bộ định kỳ sang NAS. Bản dump CSDL
**không** kéo theo ảnh.

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
| RPO (mất tối đa bao nhiêu dữ liệu) | 24h | theo lịch dump hằng ngày; kho object chưa có lịch riêng |
| RTO (bao lâu chạy lại được) | ~30 phút | đo trên DEV: restore 615 KB mất vài giây; phần lớn thời gian là dựng lại hạ tầng |

**Việc còn treo**: kho object production chưa có lịch sao lưu. Ghi nhận ở đây thay vì để trống —
`payment-proofs/` mất là mất chứng từ tài chính.
