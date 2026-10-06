# DR Runbook — QuanLY (khôi phục thảm họa)

## ⚠️ Trạng thái production ĐÃ ĐO (2026-09-22) — đọc TRƯỚC mọi mục bên dưới

Phần còn lại của tài liệu mô tả **cơ chế có trong repo**. Production **chưa chạy đủ** cơ chế đó. Người
trực lúc sự cố phải biết mình đang có gì THẬT, không phải repo hứa gì:

| Hạng mục | Repo có | Production đo ngày 2026-09-22 |
|---|---|---|
| Dump CSDL hằng đêm (`quanly-backup`, 02:00 UTC) | có | ✅ chạy, ghi `/opt/quanly-backups` **trên cùng máy** |
| Restore-test hằng tuần (`quanly-restore-test`) | có | ✅ chạy thành công (chỉ CSDL, nạp vào chính instance Postgres đó) |
| Bản sao **ngoài máy** (NAS hoặc rclone crypt) | có (tuỳ chọn) | ❌ **KHÔNG CÓ** — `/etc/quanly-backup.env` không có `NAS_*` |
| Sao lưu **kho object** (`quanly-backup-objects`) | có | ❌ **KHÔNG CÓ timer** — ảnh chứng từ thanh toán nhân sự **không có bản sao nào** |
| Diễn tập đầy đủ (`quanly-restore-drill`) | có | ❌ không có timer |
| Watchdog độ tươi (`quanly-backup-watchdog`) | có | ❌ không có timer |
| Script trên host = script trong repo | — | ❌ `/opt/quanly/backup-db.sh` **khác md5** với repo |
| Proxmox backup cả VM lên NAS | chỉ là lời khẳng định trong tài liệu cũ | ❓ **chưa kiểm chứng được** từ repo |

Hệ quả, nói thẳng: **mất máy "coolify" (đĩa hỏng, cháy, ransomware) là mất CSDL cùng mọi bản dump, và
mất vĩnh viễn toàn bộ ảnh chứng từ.** RPO khi mất host hiện là **vô hạn**, không phải 24h.

Việc chủ repo phải làm tay trên host để đóng khoảng trống này: mục **"Đưa production về đúng cơ chế"**
trong [BACKUP_RESTORE.md](BACKUP_RESTORE.md). Cập nhật bảng này (kèm ngày đo) sau mỗi lần thay đổi.

## Mục tiêu
- **RPO** (mất tối đa bao nhiêu data) — **mục tiêu**: ≤ 24h (backup hằng ngày 02:00) — hoặc tới lần deploy gần nhất nếu mới deploy. **Thực tế hôm nay** (bảng trên): ≤ 24h cho CSDL **khi host còn sống**; vô hạn khi mất host; vô hạn cho kho object.
- **RTO** (thời gian khôi phục): ≤ 1h cho khôi phục DB; ≤ 4h nếu phải dựng lại VM.

## Backup tự động (cài bằng `scripts/backup/install-backup.sh`)
- **Lịch:** `quanly-backup.timer` hằng ngày 02:00 → `pg_dump` (read-only) → `gzip` → `/opt/quanly-backups/quanly-<ngày>.sql.gz`, giữ **14 bản** local.
- **Off-host — hai đích, cấu hình đích nào đẩy đích đó** (chi tiết: [BACKUP_RESTORE.md](BACKUP_RESTORE.md), mục Off-host):
  - **NAS** trong LAN (`NAS_*`, docker smbclient) — bản **thô**, và vẫn cùng toà nhà: off-host, chưa phải off-site.
  - **rclone remote kiểu `crypt`** (`OFFHOST_RCLONE_*`) — mã hoá phía máy trước khi rời host, đích ngoài toà nhà (R2/B2/S3…). Remote không phải crypt thì script **từ chối** đẩy.
  - **Chưa cấu hình đích nào** (tình trạng production hôm nay): backup vẫn chạy, exit 0, nhưng log in `OFFHOST-CHUA-CAU-HINH` và metric `backup_offhost_configured{scope="host"} 0`. Không gửi Telegram mỗi đêm (chủ repo chốt 2026-09-23).
  - Lời khẳng định cũ "Proxmox backup cả VM lên NAS → 2 lớp off-host" **chưa được kiểm chứng**: repo không có gì chứng minh, và audit 2026-09-22 không đo được. Nếu có thật, ghi lịch + lần khôi phục thử gần nhất vào đây.
- **Restore-test:** `quanly-restore-test.timer` hằng tuần → nạp dump mới nhất vào DB tạm + đếm User/Quote → DROP. Lỗi → **alert Telegram**.
- **Alert:** mọi lỗi backup/restore-test → Telegram (cấu hình `TELEGRAM_BOT_TOKEN`+`TELEGRAM_ALERT_CHAT`).

## Khôi phục DB (mất data / rollback hỏng)

Hai giả định ngầm của bản trước đều SAI và đều cắn đúng lúc 2 giờ sáng (audit 2026-09-22, DOC-06):
**app/worker vẫn chạy trong lúc nạp** (DROP TABLE chờ khoá của app, còn app chèn dữ liệu xen vào bảng
vừa tạo lại → trạng thái trộn cũ/mới), và **dump nào cũng có `--clean`** (dump trước-deploy tạo trước
2026-09-23 KHÔNG có → lệnh CREATE đầu tiên gặp "already exists" và `ON_ERROR_STOP` dừng ngay).

```bash
cd /opt/stacks/quanly/quanly
# 0. DỪNG app + worker — không ai được ghi vào CSDL trong lúc nạp.
docker compose -f docker-compose.prod.yml stop app worker
# 1. Chọn bản backup (local, hoặc kéo từ off-host — mục "Kéo bản off-host về" trong BACKUP_RESTORE.md)
ls -lt /opt/quanly-backups/quanly-*.sql.gz ~/quanly-backups/predeploy-*.sql.gz
# 2. (khuyến nghị) chụp hiện trạng trước khi ghi đè
docker exec quanly-postgres pg_dump -U quanly -d quanly --no-owner --clean --if-exists | gzip > /opt/quanly-backups/before-restore-$(date +%F-%H%M%S).sql.gz
# 3. Nạp lại. Kiểm dump có --clean không (có DROP ở đầu tệp):
gunzip -c <TỆP>.sql.gz | head -200 | grep -c '^DROP '
#   3a. > 0 (dump hằng đêm; dump trước-deploy từ 2026-09-23) VÀ dump tạo SAU migration mới nhất đang chạy → nạp thẳng,
#       trong MỘT giao dịch (lỗi giữa chừng thì rollback sạch, không để lại CSDL mất nửa khoá / index):
gunzip -c <TỆP>.sql.gz | docker exec -i quanly-postgres psql -U quanly -d quanly -v ON_ERROR_STOP=1 --single-transaction
#   3b. = 0 (dump trước-deploy CŨ, không --clean), HOẶC dump tạo TRƯỚC một migration thêm khoá ngoại trỏ vào bảng có sẵn
#       (xem chú thích dưới khối lệnh) → tạo lại CSDL rỗng rồi nạp (bước 2 đã chụp hiện trạng):
docker exec quanly-postgres psql -U quanly -d postgres -v ON_ERROR_STOP=1 -c 'DROP DATABASE quanly;' -c 'CREATE DATABASE quanly OWNER quanly;'
gunzip -c <TỆP>.sql.gz | docker exec -i quanly-postgres psql -U quanly -d quanly -v ON_ERROR_STOP=1 --single-transaction
# 4. Kiểm
docker exec quanly-postgres psql -U quanly -d quanly -tAc 'SELECT count(*) FROM "User";'
# 4b. Dump CŨ hơn bản app đang chạy → nâng schema TRƯỚC khi dựng app (app mới cần bảng mà dump chưa có):
docker compose -f docker-compose.prod.yml run --rm app npx prisma migrate deploy
# 5. Dựng lại app + worker (--force-recreate: xem DEPLOYMENT.md#rollback vì sao `up -d` trần không đủ)
docker compose -f docker-compose.prod.yml up -d --force-recreate app worker
```

> **Dump tạo TRƯỚC `20261006090000_input_invoice_entries` (hoặc `20260930120000_quote_list_note`) — gồm cả dump
> trước-deploy của chính lượt deploy đó: KHÔNG dùng 3a.** `--clean` gỡ đối tượng theo thứ tự nó biết lúc dump:
> mọi khoá ngoại, rồi index, rồi khoá chính. Dump cũ không biết `InputInvoiceEntry_quoteId_fkey` /
> `QuoteListNote_quoteId_fkey`, nên tới `DROP CONSTRAINT "Quote_pkey"` thì lỗi vì khoá ngoại mới còn trỏ vào —
> thiếu `--single-transaction` là khoảng 160 câu trước đó ĐÃ commit (mất FK, index unique, khoá chính của
> `user_sessions`, `User`…; đăng nhập hỏng). Dùng 3b. Và nhớ: nạp dump trước-deploy là **mất mọi khoản kế toán
> ghi từ lúc deploy** — chỉ làm khi sự cố thật sự đòi; muốn "lùi bản" thì xem mục "Khoản chi kế toán → 2. Lùi ảnh".

## Dựng lại toàn bộ (mất host)
Thứ tự: (nếu Proxmox thật sự có backup VM — xem bảng đầu tài liệu, **chưa kiểm chứng**) restore VM coolify **→** (hoặc) dựng VM mới + cài Docker **→** `git clone` repo (GitHub là nơi lưu trữ mã — mọi commit đang chạy phải đã được push) **→** điền `.env` từ **kho khoá của chủ repo** — khoá cần để dựng lại server được giữ NGOÀI repo, ở kho khoá riêng của chủ repo, và không bao giờ vào git (không lấy từ máy cũ, vì mất máy là mất luôn `.env` trên đó): `POSTGRES_PASSWORD`, `REDIS_PASSWORD`, `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`, `S3_*`, `PII_ENC_KEY`, `MFA_ENC_KEY`, `SESSION_SECRET`, `JWT_SECRET`… **→** `docker compose -f docker-compose.prod.yml up -d postgres redis minio` (ảnh MinIO kéo từ **quay.io** — Docker Hub đã gỡ `minio/*`) **→** kéo bản off-host về (BACKUP_RESTORE.md) **→** restore DB (mục trên) **→** khôi phục kho object (mục "Thứ tự khôi phục" bên dưới, bước 3) **→** `prisma migrate deploy` **→** `up -d app worker` **→** verify `/livez` + `/readyz` **→** cài lại cloudflared tunnel **→** `install-backup.sh`.

> Không có bản off-host thì mục này **không thực hiện được** — xem bảng trạng thái đầu tài liệu.

## Lưu ý
- Backup `pg_dump` KHÔNG đụng app đang chạy (read-only, có advisory-lock của Postgres).
- File backup chứa **toàn bộ PII** → NAS/thư mục backup phải hạn chế quyền (chmod 600, share riêng).
  Từ 2026-10-06 nó chứa cả ảnh ủy nhiệm chi của khoản chi hàng nội bộ (`InputInvoiceProof`, base64 thô).
- Kiểm `systemctl list-timers quanly-*` để chắc lịch đang chạy.

## Khoản chi kế toán (trang Hóa đơn đầu vào) — tiền kiểm, chuyển dữ liệu sau deploy, lùi ảnh

Áp cho bản phát hành có migration `20261006090000_input_invoice_entries` (đợt 2026-10-06). Từ bản đó "đã
chi" + ảnh chứng từ + ngày HĐ + ghi chú KT của từng hàng bảng nội bộ nằm ở bảng `InputInvoiceEntry` /
`InputInvoiceProof`; bốn cờ cũ `paid/paidAt/paidById/paidProof` trong JSON hàng **đóng băng** và chỉ còn
là nguồn dự phòng cho hàng chưa có khoản. Ảnh nằm TRONG Postgres — dump CSDL mang theo, không phụ thuộc
kho object. Migration chỉ THÊM bảng (xem `prisma/migrations/README.md`).

### 0. Tiền kiểm CHỈ ĐỌC — trước deploy, trên dev rồi production

Chạy trên host (`ssh staging-ts` cho dev, `ssh coolify-ts` cho production). Phiên đặt
`default_transaction_read_only` nên không câu nào ghi được. Mọi phép duyệt JSON bọc `CASE jsonb_typeof`
như mã (`src/bangNoiBoSql.ts`) — gặp phần tử không phải mảng / object thì bỏ qua thay vì vỡ câu truy vấn.

```bash
docker exec -i quanly-postgres psql -U quanly -d quanly -v ON_ERROR_STOP=1 <<'SQL'
SET default_transaction_read_only = on;
-- (a1) phía "sheet" (Chi phí HCM + Phí KH mọi trang): đã trả · có ảnh · dấu vết mà thiếu rid · đã trả mà chưa duyệt · đã trả ở báo giá đã xoá mềm
WITH h AS (
  SELECT q."deletedAt" IS NOT NULL AS da_xoa, it.v AS it
    FROM "QuoteSheet" s JOIN "Quote" q ON q.id = s."quoteId",
         jsonb_array_elements(CASE WHEN jsonb_typeof(s."extraTables") = 'array' THEN s."extraTables" ELSE '[]'::jsonb END) t(v),
         jsonb_array_elements(CASE WHEN jsonb_typeof(t.v) = 'object' AND jsonb_typeof(t.v->'items') = 'array' THEN t.v->'items' ELSE '[]'::jsonb END) it(v)
   WHERE t.v->>'category' IN ('hcm', 'khach') AND jsonb_typeof(it.v) = 'object')
SELECT count(*) FILTER (WHERE it->>'paid' = 'true') AS da_tra,
       count(*) FILTER (WHERE coalesce(it->>'paidProof', '') <> '') AS co_anh,
       count(*) FILTER (WHERE (it->>'paid' = 'true' OR coalesce(it->>'paidProof', '') <> '') AND coalesce(trim(it->>'rid'), '') = '') AS vet_thieu_rid,
       count(*) FILTER (WHERE it->>'paid' = 'true' AND it->>'approved' IS DISTINCT FROM 'true') AS da_tra_chua_duyet,
       count(*) FILTER (WHERE it->>'paid' = 'true' AND da_xoa) AS da_tra_bao_gia_da_xoa
  FROM h;
-- (a2) rid TRÙNG trong phía "sheet" của một báo giá (so sau khi cắt khoảng trắng — đường Lưu coi "w1 " là "w1")
SELECT s."quoteId", trim(it.v->>'rid') AS rid, count(*) AS so_lan
  FROM "QuoteSheet" s,
       jsonb_array_elements(CASE WHEN jsonb_typeof(s."extraTables") = 'array' THEN s."extraTables" ELSE '[]'::jsonb END) t(v),
       jsonb_array_elements(CASE WHEN jsonb_typeof(t.v) = 'object' AND jsonb_typeof(t.v->'items') = 'array' THEN t.v->'items' ELSE '[]'::jsonb END) it(v)
 WHERE t.v->>'category' IN ('hcm', 'khach') AND jsonb_typeof(it.v) = 'object' AND coalesce(trim(it.v->>'rid'), '') <> ''
 GROUP BY s."quoteId", trim(it.v->>'rid') HAVING count(*) > 1;
-- (a3) phía "hn" (Quote.hnTables): cùng các số như (a1), "chưa duyệt" = hnStatus khác approved
WITH h AS (
  SELECT q."hnStatus", q."deletedAt" IS NOT NULL AS da_xoa, it.v AS it
    FROM "Quote" q,
         jsonb_array_elements(CASE WHEN jsonb_typeof(q."hnTables") = 'array' THEN q."hnTables" ELSE '[]'::jsonb END) t(v),
         jsonb_array_elements(CASE WHEN jsonb_typeof(t.v) = 'object' AND jsonb_typeof(t.v->'items') = 'array' THEN t.v->'items' ELSE '[]'::jsonb END) it(v)
   WHERE jsonb_typeof(it.v) = 'object')
SELECT count(*) FILTER (WHERE it->>'paid' = 'true') AS da_tra,
       count(*) FILTER (WHERE coalesce(it->>'paidProof', '') <> '') AS co_anh,
       count(*) FILTER (WHERE (it->>'paid' = 'true' OR coalesce(it->>'paidProof', '') <> '') AND coalesce(trim(it->>'rid'), '') = '') AS vet_thieu_rid,
       count(*) FILTER (WHERE it->>'paid' = 'true' AND "hnStatus" IS DISTINCT FROM 'approved') AS da_tra_hn_chua_duyet,
       count(*) FILTER (WHERE it->>'paid' = 'true' AND da_xoa) AS da_tra_bao_gia_da_xoa
  FROM h;
-- (a4) rid TRÙNG trong phía "hn"
SELECT q.id AS "quoteId", trim(it.v->>'rid') AS rid, count(*) AS so_lan
  FROM "Quote" q,
       jsonb_array_elements(CASE WHEN jsonb_typeof(q."hnTables") = 'array' THEN q."hnTables" ELSE '[]'::jsonb END) t(v),
       jsonb_array_elements(CASE WHEN jsonb_typeof(t.v) = 'object' AND jsonb_typeof(t.v->'items') = 'array' THEN t.v->'items' ELSE '[]'::jsonb END) it(v)
 WHERE jsonb_typeof(it.v) = 'object' AND coalesce(trim(it.v->>'rid'), '') <> ''
 GROUP BY q.id, trim(it.v->>'rid') HAVING count(*) > 1;
-- (a5) bản CŨ của bảng Hà Nội còn trong TRANG (category hanoi) mang cờ trả / ảnh
SELECT s."quoteId", s.id AS "sheetId", it.v->>'rid' AS rid, it.v->>'name' AS ten
  FROM "QuoteSheet" s,
       jsonb_array_elements(CASE WHEN jsonb_typeof(s."extraTables") = 'array' THEN s."extraTables" ELSE '[]'::jsonb END) t(v),
       jsonb_array_elements(CASE WHEN jsonb_typeof(t.v) = 'object' AND jsonb_typeof(t.v->'items') = 'array' THEN t.v->'items' ELSE '[]'::jsonb END) it(v)
 WHERE t.v->>'category' = 'hanoi' AND jsonb_typeof(it.v) = 'object'
   AND (it.v->>'paid' = 'true' OR coalesce(it.v->>'paidProof', '') <> '');
-- (b) ghi đè quyền theo vai + tài khoản có tập quyền riêng đụng tới trang hoá đơn / bảng nội bộ
SELECT role, permissions FROM "RolePermission";
SELECT id, role, active, permissions FROM "User"
 WHERE "deletedAt" IS NULL AND cardinality(permissions) > 0
   AND (role = 'accountant' OR permissions && ARRAY['invoice:page','invoice:pay','invoice:edit','invoice:manage','quote:internal:pay','quote:internal:view']);
-- (c) cỡ cột JSON nội bộ
SELECT max(octet_length("extraTables"::text)) AS max_byte, sum(octet_length("extraTables"::text)) AS tong_byte FROM "QuoteSheet";
SELECT max(octet_length("hnTables"::text))    AS max_byte, sum(octet_length("hnTables"::text))    AS tong_byte FROM "Quote";
SQL
```

Ghi số vào mô tả PR. Hai tình huống phải báo chủ repo TRƯỚC khi lên production:

* (a) có hàng **ĐÃ TRẢ** thiếu / trùng `rid` (`vet_thieu_rid` > 0, hoặc (a2)/(a4) có dòng) → các hàng đó chỉ hiện,
  chỉ đọc ở trang Hóa đơn đầu vào cho tới khi chuẩn hoá mã bằng `--sua-rid` ở bước 1 (sau pg_dump). Hàng THIẾU rid
  mà còn cờ / ảnh cũ: đường Lưu **từ chối** cả báo giá đó (400 `hang-da-chi-thieu-ma`) — lưu lúc đó sẽ cấp rid mới
  và xoá im cờ + bản ảnh DUY NHẤT; đừng tìm cách lách. Hàng TRÙNG rid thì lần Lưu kế tự tách (mỗi hàng giữ cờ của
  chính nó), nhưng `--sua-rid` làm ngay cho cả loạt, khỏi chờ người soạn.
* (b) có hàng `RolePermission` cho `accountant`, hoặc kế toán có tập quyền riêng → khoá mới
  `invoice:input:pay` KHÔNG tự tới (ghi đè thay hẳn bộ mặc định). Admin phải tích ô "Hóa đơn đầu vào: tích
  ĐÃ CHI + ảnh chứng từ" ở trang Phân quyền / Quản lý nhân viên NGAY sau deploy — qua giao diện, không
  sửa bằng SQL.

### 1. Ngay sau deploy — chép cờ cũ sang bảng: khô → (`--sua-rid`) → `--ghi` → `--kiem`

`deploy.sh` đã dump CSDL ở bước [1/6] (`~/quanly-backups/predeploy-*.sql.gz`). Ngay sau bước [5/6]
(recreate), trên host, **từ trong container app** (công cụ đã biên dịch vào `dist/`, có sẵn trong image —
`scripts/` thì không):

```bash
cd /opt/stacks/quanly/quanly
# dev: thay docker-compose.prod.yml bằng docker-compose.staging.yml
docker compose -f docker-compose.prod.yml exec app node dist/tools/backfillKhoanChi.js          # 1) KHÔ: chỉ in kế hoạch + chỗ lệch, không ghi
# 1b) CHỈ khi bước 1 in dòng thieu-rid / trung-rid: chuẩn hoá mã — xem trước, rồi ghi (chỉ trường rid; cờ + ảnh giữ nguyên)
docker compose -f docker-compose.prod.yml exec app node dist/tools/backfillKhoanChi.js --sua-rid --kho
docker compose -f docker-compose.prod.yml exec app node dist/tools/backfillKhoanChi.js --sua-rid
docker compose -f docker-compose.prod.yml exec app node dist/tools/backfillKhoanChi.js --ghi    # 2) chỉ THÊM khoản (+ ảnh nguồn json-cu); không đụng một byte JSON
docker compose -f docker-compose.prod.yml exec app node dist/tools/backfillKhoanChi.js --kiem   # 3) PHẢI thoát 0
echo "backfillKhoanChi --kiem thoát $?"
```

Mỗi dòng in ra là một JSON có trường `loai`. `--ghi` chạy lại bao nhiêu lần cũng được (`ON CONFLICT DO
NOTHING`, không bao giờ ghi đè khoản đã có). `--sua-rid` là chế độ DUY NHẤT ghi JSON hàng, và chỉ ghi trường
`rid`: hàng thiếu rid và bản thứ 2 trở đi của rid trùng (theo thứ tự hiển thị — bản đầu giữ rid, là chủ của
khoản) nhận rid mới, rid dính khoảng trắng được cắt; mỗi báo giá đổi một dòng nhật ký `quote.internal.ke-toan`
(`nguon: "sua-rid"`) và bump `updatedAt` (ai đang mở bản cũ sẽ nhận 409 khi Lưu thay vì gửi lại rid cũ). Chạy lại
không đổi gì. `--kiem` khác 0 thì:

| `loai` | Nghĩa | Làm gì |
|---|---|---|
| `can-chep` | hàng JSON đã trả / có ảnh mà chưa có khoản | chạy lại `--ghi` |
| `thieu-rid` | hàng có dấu vết mà THIẾU rid — không định vị được khoản; đường Lưu từ chối báo giá đó (400 `hang-da-chi-thieu-ma`) | `--sua-rid --kho` → `--sua-rid` → `--ghi` → `--kiem`. **Không** nhờ ai bấm Lưu thay |
| `trung-rid` | rid trùng trong một phía, ít nhất một bản có dấu vết — chỉ bản ĐẦU được chép | `--sua-rid` → `--ghi` → `--kiem` (lần Lưu kế của người soạn cũng tự tách, mỗi hàng giữ cờ của chính nó) |
| `lech-legacySeed` | cờ JSON hiện tại khác cờ lúc tạo khoản — bản app CŨ đã ghi JSON sau khi khoản có (khe migrate → recreate, hoặc lúc lùi ảnh) | rà tay ở trang Hóa đơn đầu vào (mục 3), rồi `--xac-nhan quoteId:side:rid,…` |
| `hanoi-cu-trong-trang` | bản cũ của bảng HN còn trong trang mang cờ trả mà `Quote.hnTables` không có | rà tay, báo chủ repo |

Rồi: báo người dùng bấm "Tải bản mới" (hoặc Ctrl+Shift+R) để rời bundle cũ — bundle cũ gọi route thanh
toán đã gỡ thì nhận 404, không ghi được gì. Thử trên dev phải gỡ service worker trước, không thì đang thử
bundle cũ.

**Theo dõi một–hai tuần sau production:** Nhật ký lọc `quote.internal.*` (pay · unpay · ke-toan ·
proof-view); log cảnh báo 4xx mang mã `hang-da-chi` / `bao-gia-co-khoan-da-chi` (chốt có làm vướng người
soạn không); `--kiem` mỗi tuần; cỡ bảng ảnh:

```bash
docker exec quanly-postgres psql -U quanly -d quanly -tAc 'SELECT count(*), pg_size_pretty(sum(octet_length("dataUrl"))::bigint) FROM "InputInvoiceProof";'
```

### 2. Lùi ảnh

`bash deploy.sh rollback prod` chỉ lùi **ảnh**, không lùi schema — và thế là đủ: migration chỉ thêm bảng,
app cũ không biết hai bảng nên không xoá chúng; "Dọn rác" của app cũ gặp FK `RESTRICT` thì hỏng ồn ào
(409) chứ không xoá.

Trong lúc app cũ chạy, phải biết trước:

* **Mọi khoản ghi SAU ngày chuyển VÔ HÌNH với app cũ.** App cũ chỉ đọc cờ JSON (đã đóng băng từ ngày
  chuyển): khoản tích sau đó hiện "chưa trả", khoản đã bỏ tích có thể vẫn hiện "đã trả". Dữ liệu không mất
  — nó nằm nguyên trong bảng, chờ bản mới.
* App cũ có lại cột / nút Thanh toán ở màn soạn và route `/pay`. Mỗi lần ai tích ở đó là một dòng phải rà
  tay khi tiến lại — dặn mọi người tránh tích trong lúc lùi nếu không bắt buộc.
* **KHÔNG DROP** hai bảng khi đã có dữ liệu, và **KHÔNG** khôi phục dump trước-deploy để "lùi": làm vậy là
  mất mọi khoản ghi từ lúc deploy. Lùi schema chỉ khi cả hai bảng RỖNG — `prisma/migrations/README.md`.

### 3. Tiến lại sau khi đã lùi

Deploy lại bản mới, rồi ngay sau recreate chạy `--ghi` (bắt hàng mà app cũ vừa tích, chưa có khoản) và
`--kiem`. Dòng `lech-legacySeed` = app cũ đã đổi cờ JSON của hàng ĐÃ có khoản: mở trang Hóa đơn đầu vào,
đối chiếu với nhật ký `quote.internal.pay` / `unpay` mà app cũ ghi trong lúc lùi, rồi sửa khoản bằng tay
(tích / bỏ tích / đính ảnh). `legacySeed` là ảnh chụp lúc tạo khoản và cờ JSON đã bị app cũ đổi, nên các
dòng đó **không tự biến mất** sau khi rà xong — rà xong dòng nào thì đánh dấu đã rà:

```bash
docker compose -f docker-compose.prod.yml exec app node dist/tools/backfillKhoanChi.js --xac-nhan 12:sheet:abc,12:hn:def
```

Lệnh chỉ ghi `legacySeed` = cờ JSON hiện tại của đúng các dòng đó — KHÔNG đổi khoản (đã chi, ảnh, ngày HĐ,
ghi chú), không đụng JSON; mỗi dòng một nhật ký `quote.internal.ke-toan` (`nguon: "xac-nhan"`, trước / sau là
hạt giống). Khoá sai dạng hoặc không thấy hàng / khoản thì in "bỏ qua" và thoát 1. Xong thì `--kiem` về 0.

---

## ⚠️ TỪ 2026-08-11: SAO LƯU CSDL MỘT MÌNH KHÔNG CÒN KHÔI PHỤC ĐƯỢC

Trước đây bản dump Postgres chứa đủ mọi thứ. Nay **không còn đúng** — hai loại dữ liệu đã rời khỏi CSDL:

| Dữ liệu | Nằm ở đâu | Không có nó thì sao |
|---|---|---|
| CCCD · số tài khoản · lương | vẫn trong CSDL nhưng **đã mã hoá** bằng `PII_ENC_KEY` | dump khôi phục xong nhưng ba trường này **không đọc được vĩnh viễn** |
| Ảnh chứng từ thanh toán | **kho object** (`payment-proofs/…`), CSDL chỉ giữ khoá + hash | hàng dữ liệu trỏ vào object không tồn tại |

Ngoại lệ CÓ CHỦ Ý (từ 2026-10-06): ảnh ủy nhiệm chi của **khoản chi hàng bảng nội bộ** (trang Hóa đơn đầu
vào, bảng `InputInvoiceProof`) nằm **trong** CSDL, không ở kho object — vì kho object production chưa có bản
sao nào (bảng đầu tài liệu). Dump CSDL mang theo chúng; mục "Khoản chi kế toán" ở trên.

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

* Nơi lưu: khoá cần để dựng lại server được giữ **ngoài repo, ở kho khoá của chủ repo** (đã sao
  lưu riêng, không bao giờ vào git — tuyệt đối không ghi giá trị khoá vào bất kỳ tệp nào trong repo).
  Kho đó phải nằm ở nơi KHÁC máy production và khác nơi để bản dump.
* Mỗi môi trường một khoá riêng. Khoá DEV **không** dùng cho production.

### Xoay `PII_ENC_KEY`

Đổi biến môi trường rồi khởi động lại = **toàn bộ dữ liệu cũ hoá đá**. Xoay khoá là một quy trình
bốn bước, và trong suốt quy trình đó ứng dụng vẫn phục vụ bình thường.

> **Chạy TỪ TRONG container app đang chạy.** Cả hai lệnh dưới đây là artifact đã biên dịch trong
> `dist/` nên có sẵn trong image production.
>
> Bản trước của runbook này gọi script trong `scripts/migration/` qua tsx, và một npm script — **cả
> hai đều MODULE_NOT_FOUND trong container**: tầng runtime của Dockerfile chỉ COPY `node_modules`,
> `prisma`, `package.json`, `dist`, `public`, `templates`; không có `scripts/`, không có `src/`, và
> `tsx` là devDependency. (Cố ý KHÔNG chép lại nguyên văn hai lệnh hỏng đó ở đây — người đọc lướt
> copy nhầm là mất thêm một vòng lúc 2 giờ sáng.) Đó đúng là lỗi mà `src/tools/verifyIntegrity.ts`
> đã sửa một lần cho diễn tập khôi phục, rồi lặp lại ở runbook này.
>
> ```bash
> docker compose -f docker-compose.prod.yml exec app node dist/tools/piiRotate.js
> ```

```bash
# 1. Đặt THÊM khoá cũ bên cạnh khoá mới, rồi khởi động lại (đọc chấp nhận cả hai khoá,
#    ghi mới luôn dùng khoá mới). Chưa xoay gì cả — chỉ mở cửa sổ chuyển tiếp.
PII_ENC_KEY=<khoá MỚI>
PII_ENC_KEY_OLD=<khoá CŨ>

# 2. Mã hoá lại toàn bộ hàng đã mã hoá. Chạy lại được, đứt giữa chừng thì chạy lại.
#    KHÔNG đụng cột thô. Bản ghi nào không giải được bằng CẢ HAI khoá → báo đỏ và bỏ qua
#    nguyên hàng (không để lại bản ghi nửa khoá cũ nửa khoá mới).
#    Ghi CÓ ĐIỀU KIỆN: hàng nào bị người dùng sửa giữa chừng thì bỏ qua thay vì ghi đè —
#    hàng đó đã mang khoá mới rồi. Thêm --dry-run để chỉ đếm.
node dist/tools/piiRotate.js

# 3. GỠ PII_ENC_KEY_OLD khỏi môi trường, khởi động lại.
#    BẮT BUỘC làm trước bước 4 — xem cảnh báo bên dưới.
# 4. Chứng minh khoá MỚI TỰ ĐỨNG ĐƯỢC.
node dist/tools/verifyIntegrity.js --pii
```

> ### ⚠️ Bước 3 phải làm TRƯỚC bước 4 — không có ngoại lệ
>
> `decryptPii` **cố ý** thử khoá mới rồi rơi về `PII_ENC_KEY_OLD` — đó chính là thứ làm cho cửa sổ
> chuyển tiếp không gây gián đoạn. Nhưng nó cũng có nghĩa là: chạy bước 4 khi khoá cũ VẪN CÒN trong
> môi trường thì bước kiểm **báo đạt kể cả khi không một hàng nào được mã lại**.
>
> Đó không phải tình huống hiếm — nó gần như chắc chắn xảy ra, vì bước 2 vừa bắt buộc phải có
> `PII_ENC_KEY_OLD`, nên chạy bước 4 từ cùng shell / cùng file `.env` là chuyện tự nhiên nhất. Rồi
> khoá cũ bị huỷ, và những hàng chưa xoay **không bao giờ giải lại được**.
>
> Nay có ba lớp chặn: `piiRotate.js` in ra đúng thứ tự này khi chạy xong;
> `scripts/migration/pii-backfill.mjs --verify` **từ chối chạy** khi `PII_ENC_KEY_OLD` còn đặt; và
> `verifyIntegrity.js --pii` **đếm riêng** số trường còn nằm ở khoá cũ rồi báo ✖ nếu cửa sổ xoay
> không còn mở.

Đừng gỡ `PII_ENC_KEY_OLD` khi bước 2 chưa chạy xong. Trong lúc cửa sổ còn mở, mỗi lần đọc trúng hàng
chưa xoay sẽ ghi một dòng `warn` — đó là cách biết còn tồn đọng. Chỉ khi bước 4 đạt mới **huỷ** khoá
cũ khỏi kho bí mật.

> [`docs/operations/INCIDENT_RESPONSE.md`](INCIDENT_RESPONSE.md) (mục "Khi nào leo thang") trỏ về
> đúng quy trình bốn bước này khi cần xoay `PII_ENC_KEY` lúc xử lý sự cố.

### Sao lưu kho object

`scripts/backup/backup-objects.sh` — chạy hằng ngày 02:30 qua `quanly-backup-objects.timer`
(cài bằng `scripts/backup/install-backup.sh`).

* **Cộng dồn, KHÔNG lan truyền xoá.** `mc mirror` không dùng `--remove`: bucket bị xoá nhầm hay bị mã
  hoá tống tiền thì bản sao lưu vẫn GIỮ vật. Đây là khác biệt giữa *bản sao lưu* và *bản chép*.
* **Manifest SHA-256** mỗi lượt (`objects-manifest-<ngày>.tsv`) — về sau đối chiếu được bản gương có
  đúng nội dung không, chứ không chỉ đúng số file.
* **Đối chiếu số lượng** bucket ↔ bản gương ngay sau khi mirror; thiếu object là dừng + alert.
* **Off-host**: NAS như bản dump CSDL (đóng gói `.tar.gz` khi bản gương còn dưới ngưỡng
  `OBJ_TARBALL_MAX_MB`, vượt ngưỡng thì chỉ đẩy manifest), và/hoặc rclone crypt (`rclone copy`
  cộng dồn bản gương + manifest, rồi `cryptcheck`). Chưa cấu hình → log `OFFHOST-CHUA-CAU-HINH`.
* `S3_*`: đọc từ `/etc/quanly-backup.env`; thiếu thì **đọc từ container app** (`quanly-app`). Không
  lấy được từ cả hai → script dừng và alert, KHÔNG im lặng bỏ qua.
* ⚠️ **Production 2026-09-22 chưa có timer này** (bảng đầu tài liệu) — kho chứng từ chưa từng được sao lưu.

### Versioning kho object — QUYẾT ĐỊNH, không phải bỏ sót

> **Quyết định (2026-08-27): KHÔNG bật versioning làm lớp mặc định.** Lớp chống ghi-đè/xoá-nhầm là
> **bản gương cộng dồn + bản off-host**. `backup-objects.sh` bước `[0/5]` **đo** trạng thái thật của
> bucket mỗi đêm và ghi vào `/opt/quanly-backups/.objects-versioning`, nên đây là quyết định *đo lại
> được*, không phải một giả định để nguyên.

Bốn sự thật đo được, và chỗ đọc lại được từng cái:

| # | Sự thật | Đọc ở đâu |
|---|---|---|
| 1 | Kho object DEV/staging/production đều chạy MinIO **một-node-một-ổ** (`server /data`, đúng một volume `quanly-miniodata`). Theo tài liệu MinIO, chế độ này **không hỗ trợ** versioning / object-lock / replication — không có gì để bật.¹ | `docker-compose.yml`, `docker-compose.staging.yml`, `docker-compose.prod.yml`, service `minio` |
| 2 | Từ 2026-09-08, **production cũng chạy compose có MinIO** (trước đó thì không): `docker-compose.prod.yml` có service `minio`, cùng cấu hình một-node-một-ổ như dev. `/etc/quanly-backup.env` đặt `S3_ENDPOINT=http://minio:9000` trỏ đúng vào container đó qua mạng `internal` — provider không còn là ẩn số đọc từ repo được nữa, nhưng bước `[0/5]` vẫn ĐO lại mỗi đêm thay vì tin vào giả định này, phòng khi ai đó trỏ `S3_ENDPOINT` sang nơi khác qua env. | `docker-compose.prod.yml` |
| 3 | Version nằm **cùng bucket, cùng hệ thống**. Mất bucket / mất host / xoá cả bucket thì mọi version đi theo. Nó chỉ bù được vế "ghi đè hoặc xoá nhầm MỘT object" — vế mà bản gương cộng dồn (`mc mirror` cố ý không có `--remove`) đã phủ. | `scripts/backup/backup-objects.sh` |
| 4 | Bật versioning **không kèm quy tắc hết hạn phiên bản cũ** = dung lượng tăng không trần, đúng vào rủi ro mà cổng "đĩa còn < 500 MB thì dừng" trong chính script này đang canh. | `scripts/backup/backup-objects.sh` |

**Điều kiện để đổi quyết định** (tức là bật) — cần cả ba, không lấy hai:

1. bước `[0/5]` báo trạng thái **khác** `unsupported` (provider hỗ trợ **và** khoá có quyền `PutBucketVersioning`);
2. có quy tắc hết hạn phiên bản cũ (script tự đặt khi bật; nếu đặt hụt thì nó **alert**, không im);
3. đã đo mức tăng dung lượng kho sau **≥ 1 tuần** bật và mức đó còn nằm gọn trong chỗ trống của volume.

```bash
# Bật qua script (lượt backup kế tiếp sẽ bật + đặt hạn giữ phiên bản cũ 30 ngày):
echo 'OBJ_VERSIONING=1'            >> /etc/quanly-backup.env
echo 'OBJ_VERSIONING_KEEP_DAYS=30' >> /etc/quanly-backup.env

# Hoặc bật tay (thay <alias>/<bucket> cho đúng kho của bạn):
mc version enable <alias>/<bucket>
mc ilm rule add --noncurrent-expire-days 30 <alias>/<bucket>

# Trạng thái của lần đo gần nhất — "<epoch><TAB><enabled|suspended|off|unsupported>":
cat /opt/quanly-backups/.objects-versioning
```

⚠️ Versioning **không thay** bản off-host. Bật nó rồi bỏ đích off-host đi là đổi một lớp bảo vệ lấy một lớp
bảo vệ, không phải thêm lớp: cả hai đều nằm trong cùng một kho, và kịch bản mất kho thì cả hai cùng mất.

> ¹ **Nói cho đúng mức độ chắc chắn:** dòng 1 của bảng trên là **giới hạn ghi trong tài liệu MinIO**
> cho chế độ một-node-một-ổ, **không phải** số đo lấy từ chính cụm này (chưa chạy `mc version enable`
> trên MinIO nào — DEV, staging hay production — để xác nhận). Dòng 2, 3, 4 thì đọc thẳng từ file
> trong repo. Nếu tài liệu MinIO sai, hoặc bản phát hành đang dùng đã đổi hành vi, thì **bước `[0/5]`
> sẽ nói ra** — nó hỏi kho thật mỗi đêm và ghi câu trả lời vào `.objects-versioning`. Kết quả đo đó
> là trọng tài, không phải đoạn văn này.

### Thứ tự khôi phục

Sáu bước. Bước 3 trước đây chỉ có đúng một dòng chữ "Khôi phục kho object" mà **không kèm lệnh nào**,
và repo cũng không có script nào làm việc đó — tức runbook hứa một bước không tồn tại, đúng vào lúc
người đọc cần nó nhất. Nay có lệnh thật, và `restore-drill.sh` chạy chính đường này mỗi Chủ nhật
(trên bucket **tạm**) nên nó không thể mục đi mà không ai biết.

**0. Chuẩn bị shell** — mọi lệnh `mc` dưới đây dùng đúng cái hàm mà `backup-objects.sh` dùng:

```bash
set -a; . /etc/quanly-backup.env; set +a
# S3_* không có trong tệp env thì lấy của app (giống backup-objects.sh):
for v in S3_ENDPOINT S3_ACCESS_KEY S3_SECRET_KEY S3_BUCKET; do
  [ -n "${!v:-}" ] || printf -v "$v" '%s' "$(docker exec quanly-app printenv "$v" 2>/dev/null)"
done
# KHÔNG `--network host`: cổng S3 9000 của MinIO chỉ mở trong mạng docker `internal` — gắn `mc` vào
# đúng mạng của quanly-minio (bản trước dùng --network host nên KHÔNG BAO GIỜ với tới được MinIO).
# Ảnh `mc` kéo từ quay.io theo digest: Docker Hub đã gỡ minio/mc (2026-09-23).
NET="$(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{end}}' quanly-minio)"
mc() {
  MC_HOST_q="${S3_ENDPOINT/:\/\//://${S3_ACCESS_KEY}:${S3_SECRET_KEY}@}" \
  docker run --rm --network "$NET" -e MC_HOST_q \
    -v /opt/quanly-backups/objects:/mirror:ro \
    quay.io/minio/mc:RELEASE.2024-11-21T17-21-54Z@sha256:993e8c454a7ec632923f7e3e61adf1d473261da6354cefd641aedd33a2cfe112 "$@"
}
```

**1. Khôi phục CSDL** — mục "Khôi phục DB" ở đầu tài liệu.

**2. Đặt `PII_ENC_KEY` đúng bản** ứng với thời điểm dump (sai khoá = ba trường PII hoá đá vĩnh viễn).

**3. Khôi phục kho object** — đẩy ngược bản gương lên bucket:

```bash
mc mb -p "q/${S3_BUCKET:-quanly}"                        # 3a. bucket đích phải tồn tại

# 3b. Đẩy lên. CHỌN ĐÚNG MỘT TRONG HAI:
mc mirror --overwrite /mirror "q/${S3_BUCKET:-quanly}"   #   bucket RỖNG/mới dựng → ghi đè thoải mái
mc mirror             /mirror "q/${S3_BUCKET:-quanly}"   #   bucket CÒN dữ liệu   → chỉ vá object thiếu

# 3c. Đối chiếu SHA-256 với manifest mới nhất (in ra dòng nào SAI; im lặng = sạch)
#     MỖI object là MỘT `docker run` → kho lớn thì rất chậm. Lấy mẫu trước cho nhanh:
#       shuf -n 50 "$MAN" > /tmp/mau.tsv   rồi đọc /tmp/mau.tsv thay cho "$MAN".
#     Chạy đủ toàn bộ khi có thời gian, TRƯỚC khi tuyên bố khôi phục xong.
MAN="$(ls -1t /opt/quanly-backups/objects-manifest-*.tsv | head -1)"
while IFS=$'\t' read -r key size want; do
  got="$(mc cat "q/${S3_BUCKET:-quanly}/$key" | sha256sum | cut -d' ' -f1)"
  [ "$got" = "$want" ] || echo "SAI: $key"
done < "$MAN"
```

> ⚠️ **Hai cái bẫy ở bước 3b, đọc trước khi gõ.**
> * `--overwrite` vào một bucket **còn dữ liệu** sẽ đè object mới hơn bằng bản trong backup — mất
>   đúng phần dữ liệu phát sinh sau lần backup cuối. Chỉ dùng khi bucket rỗng hoặc vừa `mb`.
> * Bản gương là **cộng dồn**: nó còn giữ cả object mà retention (`RETAIN_EXPORT_DAYS`,
>   `src/retention.ts`) đã xoá **hợp lệ**. Đẩy nguyên bản gương lên là **hồi sinh dữ liệu đã xoá đúng
>   quy trình** — với dữ liệu người dùng đã yêu cầu xoá thì đó là vi phạm cam kết, không phải "khôi
>   phục dư cho chắc". Sau một lần khôi phục toàn bộ, chạy lại retention.

**4. Smoke test trước khi mở cho người dùng** — app phải LÊN được trên bản vừa khôi phục:

```bash
cd /opt/stacks/quanly/quanly
docker compose -f docker-compose.prod.yml up -d app worker

# Probe TỪ TRONG container. `docker-compose.prod.yml` KHÔNG publish cổng nào ra host (app chỉ nằm
# trên mạng internal/edge sau reverse proxy), nên `curl http://127.0.0.1:3000/...` gõ trên host sẽ
# "connection refused" — và bạn sẽ tưởng app hỏng trong khi nó đang chạy tốt.
# `wget` có sẵn trong image (chính HEALTHCHECK của Dockerfile dùng nó); `curl` thì KHÔNG.
docker compose -f docker-compose.prod.yml exec app wget -q -O - http://127.0.0.1:3000/livez
docker compose -f docker-compose.prod.yml exec app wget -q -O - http://127.0.0.1:3000/readyz
```

`/readyz` trả 200 nghĩa là app kết nối được CSDL vừa khôi phục. Đây đúng là hai probe mà bước 7 của
`restore-drill.sh` chạy tự động mỗi Chủ nhật — chỉ khác là ở đây bạn chạy trên bản thật.

**5. Xác minh toàn vẹn — cả hai phải PASS**, chạy **từ trong container app**:

```bash
docker compose -f docker-compose.prod.yml exec app node dist/tools/verifyIntegrity.js
# hoặc tách: ... verifyIntegrity.js --pii   /   ... verifyIntegrity.js --proof
```

> Bản trước của runbook ghi `npm run pii:verify` / `npm run proof:verify` ở đúng chỗ này. Hai lệnh đó
> **MODULE_NOT_FOUND trong container**: chúng nằm ở `scripts/migration/*.mjs`, import mã TypeScript và
> cần `tsx`, mà image production chỉ có `dist/`. Chúng vẫn dùng được **trên máy dev có repo**, nhưng
> lúc khôi phục thật thì bạn đang đứng trên host production, không phải máy dev. Đây là **lần thứ ba**
> cùng một cái bẫy xuất hiện trong repo (xem `src/tools/verifyIntegrity.ts` và mục xoay khoá ở trên).

**6. Chỉ khi bước 4 và 5 đều xanh** mới mở lại đường vào cho người dùng.

### RPO / RTO

| | Con số | Trạng thái | Ghi chú |
|---|---|---|---|
| RPO (mất tối đa bao nhiêu dữ liệu) | 24h | **mục tiêu, suy ra từ lịch — production CHƯA đạt** | chỉ đúng khi đủ: dump CSDL 02:00 + kho object 02:30 + bản off-host + watchdog. Production 2026-09-22 chỉ có dump CSDL trên cùng máy → RPO khi mất host / cho kho object là **vô hạn** (bảng đầu tài liệu) |
| RTO (bao lâu chạy lại được) | ~30 phút | ⚠️ **số DEV — CHƯA kiểm chứng ở production** | xem ngay bên dưới trước khi trích con số này đi đâu |
| RTO — mục tiêu cam kết | ≤ 1h (khôi phục DB) · ≤ 4h (dựng lại VM) | **mục tiêu, chưa đo** | trùng mục "Mục tiêu" đầu tài liệu |

#### "~30 phút" là số DEV. Nó không nói gì về production.

Con số đó đo **một lần, trên DEV, ngày 2026-08-11**, ở quy mô:

* bản dump `quanly-*.sql.gz` **615 KB** — phần `gunzip | psql` hết **vài giây**;
* kho object DEV, vài object mẫu, **cùng một máy** với CSDL (không qua mạng);
* hạ tầng **đã dựng sẵn**: không dựng lại VM, không cài Docker, không kéo bản sao từ NAS về.

Nó trả lời được câu *"quy trình có chạy được không"*. Nó **không** trả lời được câu *"khôi phục
production mất bao lâu"*, vì cả ba đại lượng chi phối RTO thật đều chưa có số: **cỡ dump
production**, **cỡ kho object production**, **băng thông kéo bản sao từ NAS/Proxmox về**. Với dữ liệu
lớn hơn ba bậc thì phần "vài giây" không giãn ra tuyến tính — nó giãn theo I/O đĩa và theo thời gian
dựng lại index của Postgres.

**Bốn điều kiện để coi RTO là ĐÃ KIỂM CHỨNG ở production** — tính đến 2026-08-27 **chưa đạt cái nào**:

1. một lượt diễn tập **bấm giờ** trên bản sao có cỡ **bằng production** (cả dump lẫn kho object),
   trên máy có cấu hình bằng production;
2. đồng hồ **bắt đầu** từ lúc tuyên bố sự cố (không phải từ lúc bắt đầu gõ `psql`) và **dừng** khi
   `/readyz` trả 200 **và** `node dist/tools/verifyIntegrity.js` PASS cả `--pii` lẫn `--proof`;
3. chạy **≥ 2 lần**, lấy con số **xấu hơn**, ghi lại ngày đo + cỡ dump + số object + cấu hình máy;
4. đo **cả kịch bản mất host** (Proxmox restore VM → dựng lại → khôi phục), không chỉ kịch bản
   "CSDL hỏng, host còn sống".

Cho tới khi đủ bốn điều đó, con số dùng để **cam kết** là mục tiêu **≤ 1h / ≤ 4h** ở đầu tài liệu,
**không phải** "~30 phút". Đừng trích "~30 phút" vào SLA, hợp đồng, hay báo cáo cho ai ngoài đội.

**Cái đang có sẵn để tiến tới đó:** từ 2026-08-27 `restore-drill.sh` **bấm giờ chính nó** và ghi
`/opt/quanly-backups/.drill-last-duration` (`<epoch><TAB><giây>`) sau mỗi lượt ĐẠT. Đó là số đo hằng
tuần ở **đúng cỡ dữ liệu production** cho phần đắt nhất của RTO (nạp lại dump → xác minh → app lên).
Nó là **cận dưới** của RTO, không phải RTO: lượt diễn tập chạy trên host còn sống, hạ tầng đã dựng,
không kéo gì từ NAS về. Một RTO thật **không thể nhỏ hơn** con số đó — nên nếu `.drill-last-duration`
đã vượt 30 phút thì dòng "~30 phút" ở trên sai hiển nhiên, khỏi cần diễn tập gì thêm.

```bash
cat /opt/quanly-backups/.drill-last-duration    # <epoch><TAB><số giây của lượt ĐẠT gần nhất>
```

## Diễn tập khôi phục tự động

`scripts/backup/restore-drill.sh` — CN 03:30 hằng tuần (`quanly-restore-drill.timer`). ⚠️ **Chưa cài
trên production** (đo 2026-09-22) — production chỉ có `restore-test.sh`.

Khác `restore-test.sh` ở chỗ nó kiểm **đủ ba thứ**, không chỉ "dump có nạp được không":

| Bước | Kiểm cái gì | Hỏng thì nghĩa là |
|---|---|---|
| 1 | Tuổi bản dump + checksum | lịch backup đã chết, hoặc file đã hỏng |
| 2 | Nạp vào CSDL **tạm** + đếm bản ghi | dump không dùng được |
| 3 | `verifyIntegrity --pii` với `PII_ENC_KEY` thật | **khoá đang giữ không mở được bản sao lưu** — CCCD/STK/lương sẽ hoá đá |
| 4 | `verifyIntegrity --proof` đối chiếu SHA-256 | object thiếu hoặc sai — chứng từ tài chính đã mất |
| 5 | Bản gương kho object + 20 mẫu ngẫu nhiên **trên đĩa** | bản sao lưu object hỏng hoặc quá hạn |
| 6 | **Đẩy ngược** mẫu object vào **bucket TẠM** rồi `mc cat` đọc lại so SHA-256 | đường KHÔI PHỤC object không chạy được: khoá thiếu quyền, tên khoá vỡ, byte về không nguyên |
| 7 | **Smoke test**: dựng chính image production trên CSDL tạm → `/livez` → `/readyz` → `POST /api/auth/login` (tài khoản không tồn tại, mong đợi 401) | dữ liệu đọc được nhưng **app không chạy được trên nó** — thường là lệch schema giữa dump và image |

Bước 3 và 4 chính là chỗ hỏng âm thầm: bài test cũ vẫn báo PASS trong cả hai tình huống đó.

Bước 6 và 7 thêm ngày 2026-08-27, vì đến trước đó diễn tập chỉ dừng ở chỗ **đọc**: nó chứng minh bản
sao lưu *chưa mục*, chứ chưa lần nào chứng minh *khôi phục được*. Cụ thể là chưa lần nào đẩy một
object ngược vào bucket, và chưa lần nào khởi động ứng dụng trên bản đã khôi phục.

**Ba lớp cách ly — diễn tập không được chạm production**, và cả ba đều có `trap ... EXIT` dọn dẹp:

| Tài nguyên | Diễn tập dùng | Dọn khi thoát |
|---|---|---|
| CSDL | CSDL tạm `quanly_restore_drill` | `DROP DATABASE` |
| Kho object | bucket tạm `${S3_BUCKET}-restore-drill` (có chốt khẳng định `≠` bucket thật) | `mc rb --force` |
| Ứng dụng | container dùng-một-lần, **không publish cổng**, trỏ vào bucket tạm | `docker rm -f` |

Bước 4 là bước **duy nhất** chạm bucket thật, và chỉ **đọc** (GetObject để so hash). Bản gương được
mount **read-only** vào mọi lệnh `mc` của diễn tập.

Chỉnh bước 6 qua `/etc/quanly-backup.env`: `DRILL_RESTORE_N` (mặc định 20 object mẫu),
`DRILL_RESTORE_ALL=1` (đẩy toàn bộ — chậm và tốn chỗ, nên chạy tay có người canh chứ đừng để trong
lịch tuần), `DRILL_RESTORE_MAX_MB` (256), `DRILL_MAX_OBJ_MB` (64), `DRILL_RESTORE_BUCKET` (khi khoá
S3 không có quyền `CreateBucket` thì tạo sẵn một bucket **rỗng** rồi trỏ biến này vào).

> **Giới hạn của bước 6, nói thẳng:** mặc định nó khôi phục một **mẫu**, không phải toàn kho. Nó
> chứng minh **đường** khôi phục chạy được; nó **không** chứng minh 100% object khôi phục được.

## Canh độ tươi (watchdog)

`scripts/backup/backup-watchdog.sh` — mỗi 6h (`quanly-backup-watchdog.timer`). ⚠️ **Chưa cài trên
production** (đo 2026-09-22) — tức "chốt tự động" này hiện KHÔNG canh gì ở đó.

Mọi script backup chỉ alert **khi chúng chạy và hỏng**. Không cái nào alert được khi chúng **không
chạy**: timer bị disable sau một lần cập nhật, host mất điện đúng khung 02:00, docker daemon chết,
ai đó `systemctl stop`. Chế độ hỏng nguy hiểm nhất của backup là im lặng — mọi thứ trông bình thường
cho tới hôm cần khôi phục thì bản mới nhất đã sáu tuần tuổi.

Watchdog soi **dấu thời gian thành công** (`.db-last-success`, `.objects-last-success`,
`.drill-last-success`) và trạng thái enable của từng timer, nên bắt được cả kiểu chết mà bản thân
script backup không bao giờ báo được. Ngưỡng theo `docs/operations/SLO.md`: CSDL < 26h, kho object
< 26h, diễn tập < 8 ngày, bản off-host < 26h (**chỉ khi đã cấu hình** off-host; chưa cấu hình thì
watchdog in cảnh báo vào log và tệp trạng thái chứ không gửi Telegram).
