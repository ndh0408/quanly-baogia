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
