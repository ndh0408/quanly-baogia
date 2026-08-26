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

### Drift ĐƯỢC PHÉP — danh sách ĐÍCH DANH, do NOT drop

`prisma migrate dev` / `migrate diff` báo các object dưới đây là "drift" vì Prisma không biểu
diễn được chúng. Đó là **chờ đợi**, không phải lỗi. Mọi thứ KHÔNG có trong danh sách này mà bị
báo drift đều là schema.prisma đang thiếu khai báo — **sửa schema.prisma**, đừng chạy
`migrate dev` rồi commit file `DROP INDEX` nó sinh ra.

| Object | Loại | Vì sao không biểu diễn được |
|---|---|---|
| `Customer_taxCode_idx` | partial btree (`WHERE "taxCode" IS NOT NULL`) | Prisma không có partial index |
| `Approval_pending_queue_idx` | partial btree | nt |
| `Quote_createdAt_live_idx`, `Quote_createdById_createdAt_live_idx`, `Quote_projectCode_live_idx`, `Quote_quoteDate_live_idx`, `Quote_total_live_idx` | partial btree (`WHERE "deletedAt" IS NULL`) | nt |
| `Customer_name_trgm`, `Customer_taxCode_trgm`, `Customer_searchText_trgm_idx`, `Product_name_trgm`, `Product_sku_trgm`, `Quote_title_trgm`, `Quote_toCompany_trgm`, `Quote_quoteNumber_trgm`, `Quote_searchText_trgm_idx`, `PersonnelRecord_searchText_trgm_idx` | GIN trigram | `gin_trgm_ops` |
| `Venue_tags_idx` | GIN trên mảng | |
| Mọi ràng buộc `CHECK` (tiền ≥ 0, `kind` hợp lệ…) | CHECK | Prisma không có CHECK |

Ngược lại, index **btree THƯỜNG** thì Prisma biểu diễn được ⇒ phải khai `@@index` trong
`prisma/schema.prisma` NGAY khi viết migration tạo nó. `tests/vdb-schema-index-drift.test.js`
chốt điều này cho các ca đã từng trôi.

## Deferred (apply in a maintenance window, NOT auto-deployed)

Ba phát hiện audit CỐ Ý chưa migrate ở đây vì chúng high-churn trên hệ đang chạy và mức
khẩn thấp hơn — ghi lại để làm trong một cửa sổ bảo trì có kế hoạch:

- **Partial-unique on soft-delete columns** (username/email/code/sku): would let a
  soft-deleted value be reused. Mitigated in code (dup-checks now return a clean 409
  "thuộc bản đã xoá" instead of a 500). Full fix needs dropping the global `@unique`
  + converting `findUnique`→`findFirst` + raw-SQL partial unique.
- **Partial-unique on `Customer.taxCode`** (`CREATE UNIQUE INDEX CONCURRENTLY
  "Customer_taxCode_live_key" ON "Customer"("taxCode") WHERE "taxCode" IS NOT NULL AND
  "deletedAt" IS NULL;` + `DROP INDEX "Customer_taxCode_idx";`). `createCustomer`/`updateCustomer`
  trong `src/services/customerService.ts` đang là check-then-write NGOÀI transaction ⇒ hai người
  nhập cùng một MST trong cùng vài mili-giây tạo được hai hàng Customer. Chưa áp vì:
  (1) phải dọn trùng trước — `SELECT "taxCode", count(*) FROM "Customer" WHERE "taxCode" IS NOT NULL
  AND "deletedAt" IS NULL GROUP BY 1 HAVING count(*) > 1;` — nếu prod còn trùng thì migration
  NGÃ và chặn deploy; (2) phải vá KÈM `customerService.ts`: bọc `prisma.customer.create`/`update`
  bằng try/catch mã P2002 để trả 409 tiếng Việt như hiện nay, không thì đua thành 500.
  Ràng buộc phải có `deletedAt IS NULL` mới khớp hành vi hiện tại (check ở service chạy qua
  extension soft-delete nên KHÔNG thấy khách đã xoá mềm).
- **Int→BigInt PK on QuoteItem/QuoteSheet**: overflow is decades away for this
  workload; the change is high-churn (BigInt isn't JSON-serializable). Better paired
  with switching the editor save from delete-all+recreate to diff-update.

## Before applying on production

Always take a backup first (`pg_dump -Fc`) — a migration is the one operation
that can change/drop data. (Daily backup task `QuanLY-DB-Backup` already runs.)
