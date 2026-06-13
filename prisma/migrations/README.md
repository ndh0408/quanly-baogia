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

> The trigram + partial + CHECK objects are not expressible in the Prisma schema,
> so `prisma migrate dev` will report them as drift. That is expected — do NOT drop them.

## Deferred (apply in a maintenance window, NOT auto-deployed)

Two audit findings were intentionally NOT migrated here because they are high-churn
on a live system and lower urgency — documented for a planned maintenance window:

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
