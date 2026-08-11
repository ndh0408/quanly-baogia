# Quản Lý Báo Giá — quotation & project management platform

An internal web application that replaced a company's Excel-file-passing
workflow for building, versioning and approving customer quotations. It is not
a demo: it is used every working day by the sales, HR and accounting staff of
two Vietnamese companies, and every quotation the business sends to a customer
comes out of it.

> *Tiếng Việt: hệ thống nội bộ quản lý báo giá + hồ sơ nhân sự + theo dõi dự án,
> xuất Excel khớp đúng mẫu công ty. Đang chạy production.*

**358 commits · ~22,000 LOC TypeScript · 28 Prisma models · 141 HTTP endpoints
· 30 test files (~3,600 LOC of tests)**

---

## The two hard problems

Most line-of-business CRUD apps are not interesting. These two parts were.

### 1. Excel output has to be byte-for-byte the company's own template

Accounting would not accept "an Excel file with the same numbers" — it had to be
*their* file: same logo placement, fonts, borders, merged cells, print ranges,
across three different templates (two Gia Nguyễn variants, one Colorfull). A
generated-from-scratch workbook always looked subtly wrong.

So instead of generating workbooks, [`src/xlsxStitcher.ts`](src/xlsxStitcher.ts)
(519 lines) treats the real `.xlsx` templates as what they are — zip archives of
XML — and **splices rows into the template's sheet XML directly**, rewriting
shared strings, merge ranges, row spans and dimension refs, then repacking the
zip. One quotation with several sheets becomes one multi-sheet workbook, each
sheet keeping its own template's formatting. PDF export goes through PDFKit.

### 2. A spreadsheet grid in the browser that Vietnamese typists can actually use

Users came from Excel, so the quote editor is a real grid: Excel-style formulas
(`=5x3`, `=SUM(H3:H8)`, cell references like `=G3*E3`), a formula bar with
function-name hints, `Ctrl+Z/Y`, fill-down, and multi-cell selection.

The parts that took the actual work:

- **Clipboard via browser copy/cut/paste events, not keyboard shortcuts.** Key
  interception breaks on Safari, Firefox, right-click menus, touch devices, and
  Vietnamese IMEs. Using the real clipboard events means paste works everywhere,
  including over plain HTTP on the LAN.
- **An RFC-4180 paste parser** (unit-tested) so pasting multi-line Excel cells
  doesn't shred rows, and Vietnamese number formatting (`1.234`) parses as 1234.
- **Round-tripping its own export**: paste a table this app produced back into
  it, and it reconstructs the group / sub-group / sub-row / info-row hierarchy
  from the flat cells — see [`public/grid-clipboard.js`](public/grid-clipboard.js).
- **IME-safe editing** — pressing Enter to commit a word in OpenKey/Unikey does
  not jump the cursor to the next cell.

## Access control

Five roles (`admin`, `manager`, `account_hn`, `hr`, `accountant`) defined in
[`src/permissions.ts`](src/permissions.ts). Two details worth pointing at:

- **Per-row approval is enforced server-side.** Internal cost rows carry an
  approval checkbox that only `admin` may tick, and only approved rows count
  toward totals. The check is not a UI guard — the server validates the row id
  on every request and stamps who approved it and when, so a `manager` account
  cannot self-approve through the API.
- **Read-only users can still copy data out** but cannot edit, cut or paste —
  the grid distinguishes the two rather than disabling the clipboard wholesale.

## Stack

| Layer | Technology |
|---|---|
| API | Node.js · **TypeScript 5.7** · Express 4 · Zod 4 validation |
| Data | PostgreSQL · **Prisma 7** (28 models) · Redis (ioredis) |
| Auth | JWT access + refresh tokens · bcrypt-hashed credentials · TOTP 2FA (otplib) · role-based permissions |
| Realtime | Server-Sent Events ([`src/sse.ts`](src/sse.ts)) — totals update live as cells are typed |
| Background work | BullMQ workers on Redis |
| Documents | ExcelJS + custom OOXML zip stitching · PDFKit (embedded fonts) · Nodemailer |
| Frontend | React 19 + Vite (`web/`) · vanilla-JS grid engine (`public/`) |
| Testing | **Vitest** (unit + coverage) · **Playwright** (e2e) |
| Ops | Docker + Compose (dev / staging / prod) · **Helm chart** with NetworkPolicy · pino structured logs |
| CI | GitHub Actions — lint, typecheck, web build + test, coverage, `npm audit`, plus a separate security job · Dependabot · husky + lint-staged |

## Beyond quotations

The same app grew two more modules the business needed:

- **HR module** — per-project labour records and a staff directory, where
  `accountant` marks payments and `admin` confirms signed contracts.
- **Project tracking** — closed quotations laid out by sheet/invoice, with
  internal cost grids (HCM cost / Hà Nội quote / customer fees) that are
  deliberately *excluded* from customer-facing Excel output.

Quotation lifecycle is intentionally not an internal approval chain — the only
approval that matters is the customer's: `Draft → Customer confirmed / declined`.
An earlier internal review queue was removed once it proved to be ceremony.

## Documentation

- [`docs/FEATURES.md`](docs/FEATURES.md) — the full feature specification,
  in Vietnamese, written for the people who use the system.
- [`docs/DR-runbook.md`](docs/DR-runbook.md) — disaster-recovery procedure.
- [`docs/HANDOFF.md`](docs/HANDOFF.md) — operational handover notes.
- [`docs/UX_AUDIT_2026-06.md`](docs/UX_AUDIT_2026-06.md) — a UX audit pass and
  what came out of it.

## Running it

```bash
cp .env.example .env        # DATABASE_URL, JWT/session secrets, SMTP
npm ci
npx prisma migrate deploy
npm run dev                 # API + web
npm test                    # Vitest
```

Docker Compose files are provided for dev, staging and production; the Helm
chart under [`infra/helm/quanly`](infra/helm/quanly) deploys app + Postgres +
Redis with an ingress and a NetworkPolicy.

No credentials are committed — everything is read from the environment, and
`.env.example` lists what is required.

## License

Published publicly as a work sample. This is internal business software; it
carries no open-source license and is not intended for reuse. All rights
reserved.
