# Dọn mã dự án cũ — chạy tay MỘT lần sau khi deploy bản "mã cấp lúc khách chốt"

Chủ repo 2026-11-25: *"tạo mới chưa duyệt thì không có mã nào, duyệt khách chốt thì mới tạo mã dự án nhé, để khỏi
rác mã dự án"*. Từ bản này:

- Báo giá MỚI / Nhân bản / Bản mới **không có mã dự án** (`Quote.projectCode = null`) — giao diện, tên file và ô mã
  trong file Excel/PDF hiện **`NHÁP <số báo giá>`**.
- Mã được cấp khi **khách chốt** (`POST /api/quotes/:id/mark-converted`), trong cùng transaction với việc chốt, theo
  tiền tố của **người tạo** báo giá + năm lúc chốt; chốt hỏng thì không tiêu số. "Bản mới" của một dự án nhớ gốc
  (`Quote.projectRootId`) và khi chốt **lấy lại mã của dự án + phiên bản kế tiếp** — xem `src/maDuAn.ts`.

Dữ liệu CŨ thì vẫn mang mã cấp lúc tạo. Công cụ `dist/tools/donMaDuAn.js` (mã nguồn `src/tools/donMaDuAn.ts`,
luật ở `src/maDuAnDonDep.ts`) dọn nó — **không phải migration**, deploy không tự chạy:

| Việc | Áp cho |
|---|---|
| **Gỡ mã → NHÁP** | mọi báo giá chưa chốt (Nháp, Không chốt, các trạng thái cũ) và mọi báo giá đã xoá mềm. Bản nháp là phiên bản mới của dự án đã chốt GIỮ liên kết gốc → chốt lại lấy đúng mã dự án |
| **Đánh lại liền số** | báo giá ĐÃ CHỐT, theo từng (tiền tố, năm), giữ thứ tự số cũ: 001, 004, 006 → 001, 002, 003. Các phiên bản cùng mã cũ nhận cùng mã mới (số phiên bản giữ nguyên) |
| **Chỉ liệt kê** | mã KIỂU CŨ — không khớp `<tiền tố hiện tại của người tạo><YY>_<NNN>` (vd `GN26026` của người không có tiền tố, hoặc tiền tố người tạo đã đổi). Không đổi; số của chúng được né khi đánh lại. Chủ repo quyết từng mã |
| **Bộ đếm** | `QuoteCounter` (tiền tố người dùng, năm) về số lớn nhất còn lại. Tiền tố trùng tiền tố SỐ BÁO GIÁ của công ty thì KHÔNG sửa (hai bộ đếm dùng chung hàng) — chỉ ghi chú |
| **Đi theo mã** | `Quote.searchText`; `PersonnelRecord.projectCode` (mã sản xuất lưu cứng `<mã>[_vN][_NN]`) + `searchText` |
| **Giữ nguyên** | `QuoteVersion.payload` và `AuditEvent` (lịch sử). Mã hóa đơn đầu ra / mã sản xuất của sheet dựng lúc đọc nên tự theo mã mới; khoản chi kế toán không lưu mã |

Mỗi báo giá / hồ sơ nhân sự đổi có một dòng Nhật ký (`quote.ma-du-an.don` / `personnel.ma-du-an.don`, người làm =
hệ thống) ghi mã cũ → mới. Chạy lần hai không đổi gì.

> ⚠️ **Đổi mã của báo giá ĐÃ CHỐT là đổi chuỗi đã có thể in lên chứng từ gửi khách** (hóa đơn, PO, biên bản).
> Bảng `--kiem` gắn **⚠** cho mọi báo giá sắp đổi mã mà đã có số HĐ / ngày HĐ / đã thu / số PO / đã gửi chứng từ /
> khoản chi kế toán. Chủ repo phải duyệt bảng TRƯỚC khi `--ap-dung`.

Làm trên **dev trước** (`docker-compose.staging.yml`), production sau.

## 1. Kiểm (chỉ đọc) — gửi bảng cho chủ repo

```bash
cd /opt/stacks/quanly/quanly
# dev: thay docker-compose.prod.yml bằng docker-compose.staging.yml
docker compose -f docker-compose.prod.yml exec -T app node dist/tools/donMaDuAn.js --kiem > ~/don-ma-du-an-kiem-$(date +%F).txt
echo "thoát $?"   # 1 = còn việc (bình thường lần đầu), 0 = đã sạch, 2 = lỗi
```

Bảng gồm: id báo giá · trạng thái · việc · mã cũ → mã mới (hoặc → `NHÁP <số BG>`) · gốc dự án · tiêu đề · khách ·
cảnh báo; rồi hồ sơ nhân sự đổi theo, hồ sơ trỏ vào mã bị gỡ (chỉ liệt kê — vốn đã không tra được hợp đồng), bộ đếm
cũ → mới, và dòng TÓM TẮT. Gửi nguyên tệp cho chủ repo; **chờ duyệt**, đặc biệt các dòng ⚠ và nhóm MÃ KIỂU CŨ.

Muốn thử trên một vài người trước: thêm `--chi-nguoi-tao <id>,<id>` (chỉ báo giá do những người đó tạo, bộ đếm của
tiền tố của họ).

## 2. Áp dụng — sau khi chủ repo duyệt

Chọn giờ vắng. **Dừng app + worker** trong lúc chạy: khi đó bước lùi (mục 4) là nạp lại bản backup, không mất gì.

```bash
cd /opt/stacks/quanly/quanly
docker compose -f docker-compose.prod.yml stop app worker
# 1) BACKUP ngay trước khi ghi (đúng lệnh của DISASTER_RECOVERY.md, có --clean)
docker exec quanly-postgres pg_dump -U quanly -d quanly --no-owner --clean --if-exists | gzip > /opt/quanly-backups/truoc-don-ma-du-an-$(date +%F-%H%M%S).sql.gz
ls -l /opt/quanly-backups/truoc-don-ma-du-an-*.sql.gz   # tệp phải > 0 byte
# 2) Áp dụng — chạy bằng image app với app đang dừng
docker compose -f docker-compose.prod.yml run --rm app node dist/tools/donMaDuAn.js --ap-dung | tee ~/don-ma-du-an-ap-dung-$(date +%F).txt
echo "thoát $?"   # PHẢI 0: công cụ tự lập lại kế hoạch sau khi ghi, còn việc thì thoát 1
# 3) Kiểm lại lần nữa (phải "✓ sạch", thoát 0)
docker compose -f docker-compose.prod.yml run --rm app node dist/tools/donMaDuAn.js --kiem
docker compose -f docker-compose.prod.yml up -d --force-recreate app worker
```

Toàn bộ ghi trong **một** transaction (khoá `Quote`, `PersonnelRecord`, `QuoteCounter` ở chế độ EXCLUSIVE — đọc vẫn
chạy, ghi phải chờ), nên lỗi giữa chừng là không đổi gì. Đổi mã đi hai pha (mã tạm → mã đích) nên không vướng ràng
buộc `@@unique([projectCode, projectVersion])` giữa chừng.

## 3. Kiểm trên giao diện

- Danh sách báo giá: báo giá chưa chốt hiện `NHÁP <số BG>`; đã chốt hiện mã mới liền số.
- Trang Quản lý dự án / Hóa đơn đầu ra: mã sản xuất theo mã mới; hàng ⚠ đối chiếu với kế toán.
- Trang Nhân sự: các hồ sơ trong bảng "đổi mã sản xuất theo" vẫn tra ra Số HĐ bán / tiền trước thuế.
- Nhật ký: lọc `quote.ma-du-an.don`.
- Thử chốt một báo giá nháp: nhận mã kế tiếp đúng tiền tố (bộ đếm đã về số lớn nhất còn lại).

Nhắc người dùng tải lại trang (tab đang mở còn hiện mã cũ tới khi tải lại; lần Lưu từ tab cũ không ghi đè mã).

## 4. Lùi

**Chưa mở lại app (app vẫn dừng)** — nạp lại bản backup vừa chụp, không mất gì:

```bash
gunzip -c /opt/quanly-backups/truoc-don-ma-du-an-<THỜI ĐIỂM>.sql.gz | docker exec -i quanly-postgres psql -U quanly -d quanly -v ON_ERROR_STOP=1 --single-transaction
docker compose -f docker-compose.prod.yml up -d --force-recreate app worker
```

**Đã mở lại app và có người làm việc** — nạp cả bản backup là mất mọi thứ ghi sau đó. Chỉ lấy lại các cột mã từ bản
backup, cho đúng những hàng công cụ đã đổi (Nhật ký) mà mã hiện tại VẪN là mã công cụ đã đặt (hàng nào đã được chốt
lại / đổi tiếp sau đó thì không đụng):

```bash
docker exec quanly-postgres psql -U quanly -d postgres -v ON_ERROR_STOP=1 -c 'CREATE DATABASE quanly_lui OWNER quanly;'
gunzip -c /opt/quanly-backups/truoc-don-ma-du-an-<THỜI ĐIỂM>.sql.gz | docker exec -i quanly-postgres psql -U quanly -d quanly_lui -v ON_ERROR_STOP=1 --single-transaction -q
docker exec quanly-postgres psql -U quanly -d quanly_lui -v ON_ERROR_STOP=1 \
  -c "\copy (SELECT id, \"projectCode\", \"projectRootId\", \"searchText\" FROM \"Quote\") TO '/tmp/lui_q.csv' CSV" \
  -c "\copy (SELECT id, \"projectCode\", \"searchText\" FROM \"PersonnelRecord\") TO '/tmp/lui_p.csv' CSV" \
  -c "\copy (SELECT prefix, year, value FROM \"QuoteCounter\") TO '/tmp/lui_c.csv' CSV"
docker exec -i quanly-postgres psql -U quanly -d quanly -v ON_ERROR_STOP=1 --single-transaction <<'SQL'
LOCK TABLE "Quote", "PersonnelRecord", "QuoteCounter" IN EXCLUSIVE MODE;
CREATE TEMP TABLE lui_q (id int, "projectCode" text, "projectRootId" int, "searchText" text);
CREATE TEMP TABLE lui_p (id int, "projectCode" text, "searchText" text);
CREATE TEMP TABLE lui_c (prefix text, year int, value int);
\copy lui_q FROM '/tmp/lui_q.csv' CSV
\copy lui_p FROM '/tmp/lui_p.csv' CSV
\copy lui_c FROM '/tmp/lui_c.csv' CSV
CREATE TEMP TABLE can_lui AS
  SELECT DISTINCT ON (a."resourceId") a."resourceId"::int AS id, a.after->>'projectCode' AS ma_cong_cu
  FROM "AuditEvent" a WHERE a.action = 'quote.ma-du-an.don' ORDER BY a."resourceId", a.id DESC;
-- Pha 1 → mã tạm (tránh đụng @@unique giữa chừng), pha 2 → giá trị trong bản backup.
UPDATE "Quote" q SET "projectCode" = '__LUI__' || q.id FROM can_lui c
  WHERE c.id = q.id AND q."projectCode" IS NOT DISTINCT FROM c.ma_cong_cu;
UPDATE "Quote" q SET "projectCode" = l."projectCode", "projectRootId" = l."projectRootId", "searchText" = l."searchText"
  FROM lui_q l WHERE l.id = q.id AND q."projectCode" = '__LUI__' || q.id;
UPDATE "PersonnelRecord" p SET "projectCode" = l."projectCode", "searchText" = l."searchText"
  FROM lui_p l, "AuditEvent" a
  WHERE l.id = p.id AND a.action = 'personnel.ma-du-an.don' AND a."resourceId" = p.id::text
    AND p."projectCode" IS NOT DISTINCT FROM a.after->>'projectCode';
-- Bộ đếm chỉ TĂNG lại về số cũ, không bao giờ lùi dưới số đã cấp sau khi dọn.
UPDATE "QuoteCounter" c SET value = GREATEST(c.value, l.value) FROM lui_c l WHERE l.prefix = c.prefix AND l.year = c.year;
SQL
docker exec quanly-postgres psql -U quanly -d postgres -c 'DROP DATABASE quanly_lui;'
```

Lệnh nạp lỗi `duplicate key … Quote_projectCode_projectVersion_key` nghĩa là sau khi dọn đã có báo giá được chốt và
nhận đúng một mã cũ sắp trả về — giao dịch tự huỷ, không đổi gì; báo chủ repo quyết hàng đó trước rồi chạy lại.
