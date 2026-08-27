# Dựng môi trường phát triển

## Yêu cầu

- **Node.js 22+** (xem `.nvmrc` và `engines` trong `package.json`)
- **Docker** (cho Postgres / Redis / MinIO / MailHog ở môi trường dev)

## Các bước

```bash
git clone <repo> && cd quanly-baogia
cp .env.example .env          # đọc kỹ phần đánh dấu [BẮT BUỘC-PROD]
npm ci

docker compose up -d postgres redis minio mailhog

npx prisma generate           # BẮT BUỘC — xem mục Sự cố thường gặp
npx prisma migrate deploy
node prisma/seed.js           # tạo tài khoản admin đầu tiên

npm run dev                   # API tại :3000 (tsx watch)
npm --prefix web run dev      # SPA React (Vite dev server) — tiến trình RIÊNG
```

`npm run dev` **chỉ chạy API**. Frontend React là tiến trình riêng. Chỉ còn
**một** SPA: SPA vanilla cũ ở `public/js` (phục vụ tại `/app`) đã gỡ hẳn
2026-08-26 — xem [ADR 0006](../adr/0006-go-spa-vanilla-cu.md). Bản React đã build
nằm ở `public/app2/` và do chính API phục vụ ở `/`.

Nếu để `ADMIN_PASSWORD` trống, seed sinh mật khẩu mạnh và ghi ra
`.admin-credentials.local` (đã gitignore).

## docker-compose.yml cung cấp gì

| Service | Cổng | Dùng để |
|---|---|---|
| postgres | 5432 | CSDL chính — **và kho phiên đăng nhập** (`connect-pg-simple`, bảng `user_sessions`) |
| redis | 6379 | hàng đợi BullMQ, rate-limit, kênh Pub/Sub của SSE — **không giữ phiên** |
| minio | 9000 (console 9001) | kho object — **ảnh chứng từ thanh toán cần cái này** |
| mailhog | 1025 (UI 8025) | bắt email gửi đi, không gửi ra ngoài thật |

Service `app` nằm sau profile `full`; ở môi trường dev thường chạy app trên host
để có hot reload.

## npm script

| Lệnh | Việc |
|---|---|
| `npm run dev` | API, tsx watch |
| `npm run dev:worker` | worker nền, tsx watch |
| `npm run build` | TypeScript → `dist/` (artifact production) |
| `npm start` | chạy `dist/server.js` — cần `build` trước |
| `npm run worker` | chạy `dist/worker.js` |
| `npm run typecheck` | `tsc --noEmit` cho backend |
| `npm run lint` / `lint:fix` | ESLint |
| `npm run format` | Prettier (**chỉ** json/css/yml — không đụng TS/JS, xem `lint-staged.config.mjs`) |
| `npm test` / `test:run` | Vitest |
| `npm run test:coverage` | Vitest + coverage |
| `npm run web:build` | typecheck + build SPA React |
| `npm run web:test` | test đơn vị frontend |
| `npm run db:migrate` | `prisma migrate dev` (chỉ dev) |
| `npm run db:migrate:deploy` | `prisma migrate deploy` (production) |
| `npm run db:seed` | seed dữ liệu ban đầu |
| `npm run db:studio` | Prisma Studio |
| `npm run pii:backfill` / `:dry` / `pii:verify` | migrate mã hoá PII |
| `npm run proof:migrate` / `:dry` / `proof:verify` | chuyển chứng từ sang kho object |

## Chạy test

```bash
npm run test:run                       # test đơn vị chạy được ngay
```

Test tích hợp cần hạ tầng thật. Đủ bộ:

```bash
export DATABASE_URL="postgresql://quanly:quanly_pwd@127.0.0.1:5432/quanly_test?schema=public"
export REDIS_URL="redis://127.0.0.1:6379"
export S3_ENDPOINT=http://127.0.0.1:9000 S3_ACCESS_KEY=minioadmin S3_SECRET_KEY=minioadmin
export S3_BUCKET=quanly-test S3_FORCE_PATH_STYLE=true
export SESSION_SECRET="test-secret-must-be-long-enough-to-pass-the-zod-validator-yes"
npx prisma migrate deploy
npm run test:run
```

Thiếu hạ tầng thì các bộ đó **tự bỏ qua** — tiện cho máy dev. Ở CI,
`REQUIRE_DB_TESTS=1` biến "bỏ qua" thành **lỗi**, để pipeline không xanh giả.
Chi tiết: [TESTING.md](TESTING.md).

## Sự cố thường gặp

**`typecheck` báo hàng chục lỗi "implicitly has an 'any' type" trong
`src/services/*`** — Prisma Client chưa được sinh. Client sinh ra mới mang theo
kiểu của model; thiếu nó thì mọi callback `tx`, `r`, `v` thành `any` ngầm. Chữa:

```bash
DATABASE_URL="postgresql://build:build@localhost:5432/build" npx prisma generate
```

(URL giả cũng được — `generate` không kết nối CSDL.)

**Test chứng từ thanh toán trả 503** — chưa cấu hình `S3_*`, hoặc MinIO chưa chạy.

**`NoSuchBucket` khi tải ảnh lên** — bucket chưa tồn tại. Server tự tạo lúc khởi
động; `tests/setup.js` tự tạo cho test. Chạy tay thì kiểm MinIO đã lên chưa.

**Thao tác ghi trả 403 `csrf_token_missing`** — client chưa gửi `X-CSRF-Token`.
SPA React tự lo; nếu gọi API bằng curl thì lấy mã ở `GET /api/csrf-token` (hoặc
dùng Bearer, được miễn).

**Sửa `web/src` mà trình duyệt không thấy đổi** — chạy lại `npm run build:web`.
Vite tự băm tên file asset nên không còn phải bump `?v=` bằng tay (SPA cũ dùng `?v=`
đã gỡ 2026-08-26).
