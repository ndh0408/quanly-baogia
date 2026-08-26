# Database migrations

This project uses **Prisma Migrate** (`prisma migrate deploy`) — NOT `prisma db push`.
`db push` has no history, no review, and can silently drop columns/data. Every
schema change must go through a migration that is committed to git.

## Day-to-day

1. Edit `prisma/schema.prisma`.
2. Create the migration locally against a dev DB:
   ```
   npx prisma migrate dev --name describe_your_change
   ```
3. Commit the new folder under `prisma/migrations/`.
4. CI / production apply it with `npx prisma migrate deploy`.

## ⚠️ One-time baseline on the EXISTING production database

The production database (gianguyen.cloud) was originally created with
`prisma db push`, so its tables already exist. The very first `migrate deploy`
would try to re-create them and fail. Mark the baseline as already-applied
**once** on that database, then deploy normally afterwards:

```bash
# point DATABASE_URL at production, then:
npx prisma migrate resolve --applied 0_init
# from now on:
npx prisma migrate deploy
```

A brand-new/empty database needs no resolve step — `migrate deploy` creates
everything from `0_init` directly.

## Migrations in this repo

- `0_init` — baseline (full schema).
- `20260613000001_integrity_fks_indexes` — adds the previously-missing FK
  constraints (NOT VALID → VALIDATE, with orphan cleanup first so it can't fail on
  prod), `createdAt`/`updatedAt` on config tables, money/kind CHECK constraints, and
  partial btree indexes for sort/aggregate gaps. Safe on the live DB.
- `20260613000002_search_trgm_indexes` — GIN trigram indexes for ILIKE search.
  **Requires the `pg_trgm` extension.** If the app DB role is not a superuser, run
  `CREATE EXTENSION pg_trgm;` once as a superuser BEFORE `migrate deploy`, otherwise
  this migration rolls back (the integrity migration above is unaffected — that's
  why they're split).
- `20260826000001_append_only_createdat_indexes` — index dẫn đầu `createdAt DESC` cho
  `AuditEvent` / `LoginAttempt` / `WebhookDelivery`. Thuần thêm index. Trên prod đang tải thì
  chạy tay bản `CONCURRENTLY` (ghi sẵn trong chính file migration) rồi
  `prisma migrate resolve --applied 20260826000001_append_only_createdat_indexes`.
  ⚠️ **BẮT BUỘC kiểm trước khi `migrate resolve`.** `CREATE INDEX CONCURRENTLY` bị đứt giữa chừng
  (deadlock, huỷ phiên, hết đĩa) để lại một index **INVALID mang ĐÚNG tên đó**. Sau đó
  `CREATE INDEX IF NOT EXISTS` trong migration thấy tên đã tồn tại nên BỎ QUA, `migrate deploy`
  báo thành công, và hệ thống chạy tiếp với một index không dùng được — đúng vấn đề hiệu năng mà
  migration này sinh ra để chữa, nhưng nay còn khó thấy hơn vì mọi thứ đều xanh. Chạy:
  ```sql
  SELECT c.relname FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE NOT i.indisvalid;
  ```
  Có tên nào trong ba index trên → `DROP INDEX` rồi tạo lại, đừng resolve.
- `20260826120000_customer_taxcode_live_unique` — `Customer_taxCode_live_key`: UNIQUE **partial**
  trên `("taxCode") WHERE "taxCode" IS NOT NULL AND "deletedAt" IS NULL`, thay cho
  `Customer_taxCode_idx` (bị DROP trong cùng migration). ⚠️ **Đụng dữ liệu đang có**: migration mở
  đầu bằng một khối `DO $$` dừng ngay và in ra các MST trùng nếu prod còn khách SỐNG trùng mã số
  thuế — dọn trùng trước rồi chạy lại. Bản `CONCURRENTLY` cho prod đang tải ghi sẵn trong chính
  file migration (kèm bước kiểm index INVALID trước khi `migrate resolve`).

### Drift ĐƯỢC PHÉP — danh sách ĐÍCH DANH, do NOT drop

Prisma không biểu diễn được các object dưới đây, nên chúng tồn tại trong CSDL mà không có trong
`schema.prisma`. Đó là **chờ đợi**, không phải lỗi. Mọi thứ KHÔNG có trong danh sách này mà bị
báo drift đều là schema.prisma đang thiếu khai báo — **sửa schema.prisma**, đừng chạy
`migrate dev` rồi commit file `DROP INDEX` nó sinh ra.

> **Danh sách này được ĐO, không phải nhớ.** Lần đo gần nhất: **2026-08-26**, trên Prisma 7.9.1,
> bằng đúng quy trình ở mục "Đo lại drift" bên dưới. Đổi phiên bản Prisma hoặc thêm migration là
> phải đo lại và cập nhật bảng — **cùng lúc** với hằng số `DRIFT_DUOC_PHEP` trong
> `tests/vdb-schema-index-drift.test.js`. Bài test đó so tập trôi thực tế **BẰNG ĐÚNG** danh sách
> này (cả hai chiều), nên hai nơi không thể lặng lẽ trôi khỏi nhau.

| Object | Loại | `migrate diff` có báo? | Ghi chú |
|---|---|---|---|
| `Customer_name_trgm`, `Customer_taxCode_trgm`, `Customer_searchText_trgm_idx`, `Product_name_trgm`, `Product_sku_trgm`, `Quote_title_trgm`, `Quote_toCompany_trgm`, `Quote_quoteNumber_trgm`, `Quote_searchText_trgm_idx`, `PersonnelRecord_searchText_trgm_idx` | GIN trigram (`gin_trgm_ops`) | **CÓ** — "Removed index on columns (…)" | |
| `Venue_tags_idx` | GIN trên mảng | **CÓ** | |
| `_QuoteMembers` (PK + unique `(A, B)`) | bảng nối m2m **NGẦM** (Quote ↔ User) | **CÓ** — "Added primary key…" + "Removed unique index…" | Prisma tự quản bảng này, không có model để khai |
| `Customer_taxCode_live_key` | partial **UNIQUE** btree (`WHERE "taxCode" IS NOT NULL AND "deletedAt" IS NULL`) | không | Chống trùng MST; Prisma không khai được partial unique |
| `Approval_pending_queue_idx` | partial btree (`WHERE "decision" = 'pending'`) | không | |
| `Quote_createdAt_live_idx`, `Quote_createdById_createdAt_live_idx`, `Quote_projectCode_live_idx`, `Quote_quoteDate_live_idx`, `Quote_total_live_idx` | partial btree (`WHERE "deletedAt" IS NULL`) | không | |
| Mọi ràng buộc `CHECK` (tiền ≥ 0, `kind` hợp lệ…) | CHECK | không | Prisma không có CHECK |

`RolePermission.permissions` từng bị báo trôi ("default changed … to `None`") và **đã được sửa**
chứ không miễn trừ: migration 20260625000004 tạo cột với `DEFAULT ARRAY[]::TEXT[]` còn schema thì
quên `@default([])`. Prisma khai được default cho scalar list (xem `User.permissions`), nên đó là
drift THẬT — nay `prisma/schema.prisma` đã khai. Ghi lại ở đây để không ai "miễn trừ" nó lần nữa.

`Customer_taxCode_idx` (partial btree thường) ĐÃ BỊ THAY bởi `Customer_taxCode_live_key` trong
migration `20260826120000` — đừng thêm lại. Mọi truy vấn tra theo MST đều kèm `deletedAt IS NULL`
(extension soft-delete tự thêm) nên rơi đúng predicate của index unique mới.

Cột "`migrate diff` có báo?" quan trọng vì trên Prisma 7.9.1 lệnh này **không nhìn thấy partial
index** (đã kiểm: 7 partial btree ở trên có thật trong `pg_indexes` nhưng không xuất hiện trong đầu
ra diff). Đừng suy ra rằng chúng không tồn tại, và đừng "dọn" chúng.

Ngược lại, index **btree THƯỜNG** thì Prisma biểu diễn được ⇒ phải khai `@@index` trong
`prisma/schema.prisma` NGAY khi viết migration tạo nó. `tests/vdb-schema-index-drift.test.js`
chốt LUẬT này (không chỉ vài ca đã biết): nó quét MỌI `CREATE INDEX` btree thường trong
`prisma/migrations/**/migration.sql` và đòi mỗi cái có `@@index`/`@@unique` khớp danh sách cột.

### Đo lại drift (làm được lại bất cứ lúc nào)

```bash
createdb vdb_shadow                       # CSDL nháp RIÊNG — KHÔNG dùng CSDL test/dev đang chạy
psql -d vdb_shadow -c 'CREATE EXTENSION pg_trgm'
DATABASE_URL=postgresql://…/vdb_shadow npx prisma migrate deploy
DATABASE_URL=postgresql://…/vdb_shadow npx prisma migrate diff \
  --from-config-datasource --to-schema prisma/schema.prisma --exit-code   # exit 2 = có trôi
dropdb vdb_shadow
```

⚠️ Trên Prisma 7 (repo dùng 7.9.1 + `prisma.config.ts`), `migrate diff` **đã bỏ** cờ
`--shadow-database-url` và `--to-schema-datamodel`; `--from-migrations` thì đòi
`datasource.shadowDatabaseUrl` khai trong `prisma.config.ts`. Cú pháp Prisma 5/6 chép ở nơi khác
sẽ báo "unknown or unexpected option". Dùng đúng hai cờ ở trên.

## Deferred (apply in a maintenance window, NOT auto-deployed)

Hai phát hiện audit CỐ Ý chưa migrate ở đây vì chúng high-churn trên hệ đang chạy và mức
khẩn thấp hơn — ghi lại để làm trong một cửa sổ bảo trì có kế hoạch. (Mục thứ ba,
partial-unique cho `Customer.taxCode`, ĐÃ LÀM — xem migration `20260826120000`.)

- **Partial-unique on soft-delete columns** (username/email/code/sku): would let a
  soft-deleted value be reused. Mitigated in code (dup-checks now return a clean 409
  "thuộc bản đã xoá" instead of a 500). Full fix needs dropping the global `@unique`
  + converting `findUnique`→`findFirst` + raw-SQL partial unique.
- **Int→BigInt PK on QuoteItem/QuoteSheet**: overflow is decades away for this
  workload; the change is high-churn (BigInt isn't JSON-serializable). Better paired
  with switching the editor save from delete-all+recreate to diff-update.

## Before applying on production

Always take a backup first (`pg_dump -Fc`) — a migration is the one operation
that can change/drop data. (Daily backup task `QuanLY-DB-Backup` already runs.)
