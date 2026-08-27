# Bảng quyết định công nghệ

> Phụ lục §1 của MASTER PROMPT đòi: audit **từng thành phần**, kết luận
> `KEEP / UPGRADE / REFACTOR / REPLACE / REMOVE / DEFER`, kèm lý do và rủi ro migration.
>
> Khung đánh giá (Phụ lục, phần mở đầu): reliability · security · performance · maintainability ·
> developer experience · operational complexity · scalability · cost · business requirements ·
> migration risk.
>
> Nguyên tắc chi phối (Phụ lục §19): **không trả lời được "vấn đề ĐO ĐƯỢC nào đang tồn tại" thì
> KHÔNG migrate.** Đa số dòng dưới đây là `KEEP` — và đó là kết luận, không phải sự lười.

**Phiên bản trong bảng lấy từ `package.json` / `web/package.json` tại thời điểm soát.**
Chúng sẽ trôi; con số chính xác luôn đọc từ file gốc.

## Ứng dụng

| Component | Current | Decision | Target | Reason | Migration Risk |
|---|---|---|---|---|---|
| React | 19.0 (SPA, Vite) | **KEEP** | — | Ứng dụng nghiệp vụ nội bộ, **có xác thực**, không cần SSR/SEO. Phụ lục §11 cấm đổi sang Next.js đúng cảnh này. Lưới báo giá là DOM thủ công hiệu năng cao — đổi framework là viết lại nó. | — |
| Vite | 8.1 | **KEEP** | — | Build 16 file test web + bundle production trong vài giây. Không có vấn đề đo được. | — |
| Express | 4.21 | **KEEP** | — | Phụ lục §11 cấm đổi sang NestJS chỉ vì DI/modules. Ranh giới module đạt được bằng cấu trúc thư mục TypeScript. Express 5 thì `DEFER` (xem dưới). | — |
| Express | 4.21 | **DEFER** | Express 5 | Express 5 đổi cách xử lý lỗi async và pattern route. Lợi ích thật: bỏ được `asyncHandler`. Chưa đủ để đánh đổi rủi ro trên 137 endpoint. Xem lại khi Express 4 hết hỗ trợ. | Trung bình — mọi route phải test lại |
| TypeScript | 5.7 | **KEEP** | — | `strict` đã bật, typecheck chạy trong cổng. | — |
| Zod | 4.4 | **KEEP** | — | Đã migrate v3→v4 (cú pháp v3 bị **bỏ qua âm thầm** và làm lọt thông báo tiếng Anh ra giao diện — xem AGENTS.md). | — |
| @tanstack/react-query | 5.10 | **KEEP** | — | Đang gánh cache + invalidation của SPA. | — |

## Dữ liệu

| Component | Current | Decision | Target | Reason | Migration Risk |
|---|---|---|---|---|---|
| PostgreSQL | 16-alpine | **KEEP** | — | Phụ lục §9: không đổi sang MongoDB/DynamoDB cho dữ liệu giao dịch. Tiền dùng `Decimal`; ràng buộc và transaction là yêu cầu nghiệp vụ. | — |
| Prisma | 7.8 | **KEEP** | — | Phụ lục §10: chỉ thay ORM khi có vấn đề **mang tính hệ thống**. Hot path chậm thì dùng raw query của chính Prisma, không bỏ Prisma. | — |
| Tìm kiếm | Postgres GIN + pg_trgm + `searchText` bỏ dấu | **KEEP** | — | Phụ lục §14: chỉ thêm Elasticsearch khi benchmark chứng minh Postgres không đáp ứng. Chưa có benchmark nào cho thấy thế. ⚠️ 11 index GIN này tạo bằng **SQL thô** — `prisma migrate dev` sẽ muốn DROP chúng ở mọi lần chạy; `scripts/ci/check-destructive-sql.mjs` chặn. | — |
| Redis (ioredis 5.11) | session · BullMQ · Pub/Sub · rate-limit | **KEEP** | — | Phụ lục §5: đúng bốn use case được khuyến nghị. **Không** dùng làm cache tuỳ tiện, **không** làm primary database. | — |
| Mã hoá PII | AES-256-GCM (`src/piiBox.ts`) | **KEEP** | — | Khoá ngoài CSDL, có bản HMAC mù để tra cứu. ⚠️ Cột thô vẫn song song — **quyết định của chủ hệ thống là giữ nguyên**, ghi rõ ở `docs/REMAINING_RISKS.md`. | — |

## Nền tảng chạy

| Component | Current | Decision | Target | Reason | Migration Risk |
|---|---|---|---|---|---|
| Node.js | 22 (`.nvmrc`) | **KEEP** | — | LTS. | — |
| Chạy production | `node dist/*.js` | **ĐÃ MIGRATE** ✔ | từ `tsx src/*.ts` | Phụ lục §3. Trước đây Docker chạy qua `tsx` còn Helm gọi `node src/server.js` (**file không tồn tại** → pod chết vòng lặp). Nay bốn đường triển khai dùng **chung một artifact**. Khoá bằng `scripts/ci/check-runtime-command.sh` + `scripts/ci/smoke-image.sh`. | Đã hoàn tất |
| BullMQ | 5.77 | **KEEP** | — | Phụ lục §13: không thêm Kafka/RabbitMQ/NATS cho một ứng dụng nghiệp vụ nội bộ. | — |
| Nhập Excel | `node:worker_threads` **trong tiến trình API** | **REFACTOR** | BullMQ | Phụ lục §4 nói job nặng nên đi qua hàng đợi. Hiện nhập chạy worker-thread trong API: **không** retry, **không** hiển thị tiến độ, chết theo tiến trình API. Xuất file thì đã qua BullMQ. | Trung bình — đổi hợp đồng API của trang nhập |
| SSE | Express + Redis Pub/Sub | **KEEP** | — | Phụ lục §6: một chiều là đủ, không đổi sang WebSocket. Backplane Redis đã có nên chạy được nhiều replica. | — |
| ExcelJS + ghép OOXML thủ công | 4.4 | **KEEP** | — | `src/xlsxStitcher.ts` ghép XML để giữ **file mẫu của công ty** (logo, phông, viền, ô gộp, vùng in). Thư viện sinh workbook mới sẽ làm mất chính thứ đó. | — |
| PDFKit | 0.18 | **KEEP** | — | Đủ dùng. Phông DejaVu nhúng trong image cho dấu tiếng Việt. | — |

## Vận hành

| Component | Current | Decision | Target | Reason | Migration Risk |
|---|---|---|---|---|---|
| Docker | multi-stage, non-root, tini, healthcheck | **KEEP** | — | Ảnh nền là `ARG NODE_IMAGE` → production ghim digest bằng `--build-arg`. | — |
| Docker Compose | production hiện tại | **KEEP** | — | Phụ lục §15 Level 1: hợp SME. Đã ghi rõ **VM là single point of failure**. | — |
| Helm / Kubernetes | chart có, chưa dùng ở production | **KEEP (chưa kích hoạt)** | — | Phụ lục §15 Level 3: chỉ khi quy mô vận hành xứng đáng. Chart phải **thật sự render được** — `scripts/ci/check-helm.mjs` chốt bằng kubeconform + 4 bất biến. | — |
| Ảnh production | `quanly-app:prod` (**tag di động**) | **DEFER** | digest bất biến | Phụ lục §18 đòi artifact bất biến. Đường digest đã có (`IMAGE_REF=…@sha256:`) nhưng **mặc định vẫn dựng trên VM** — quyết định của chủ hệ thống. | Thấp khi bật |
| Log | Pino → stdout | **KEEP** | — | Có `requestId` xuyên suốt; nhật ký kiểm toán nay cũng mang mã đó. | — |
| Gom log tập trung | **chưa có** | **DEFER** | Loki + Grafana | Phụ lục §16 khuyến nghị. Chưa dựng vì production một VM, `docker logs` còn đủ. Cần khi lên Level 2 (nhiều instance). | Thấp |
| Metrics | Prometheus (`prom-client` 15.1) | **KEEP** | — | 13 metric riêng + bộ mặc định. `/metrics` gác bằng Bearer, **404 ở production nếu thiếu token**. | — |
| Cảnh báo | 14 rule ở `infra/prometheus/alerts.yaml` | **KEEP (chưa kích hoạt)** | — | Có bài `promtool test rules` chốt logic. ⚠️ **Chưa Prometheus nào scrape** — file đã sẵn sàng, chưa phải thứ đang bảo vệ hệ thống. | — |
| Sentry | 10.55 | **KEEP** | — | Phụ lục §16: giữ cho lỗi ứng dụng, không dựng chồng 3–4 hệ giám sát. | — |
| Bí mật | `.env` + quy ước `*_FILE` | **KEEP** | — | Phụ lục §17: `*_FILE` cho Docker secrets / K8s Secret / Vault mà không đổi cách triển khai. ⚠️ Chưa đường triển khai nào dùng. | — |
| Kho object | S3 API (`@aws-sdk/client-s3` 3.x) | **KEEP** | — | Phụ lục §7: có lớp trừu tượng `src/storage.ts`, không hard-code nhà cung cấp. | — |

## Xác thực

| Component | Current | Decision | Target | Reason | Migration Risk |
|---|---|---|---|---|---|
| Phiên | `express-session` + `connect-pg-simple` | **KEEP** | — | `regenerate()` khi đăng nhập (chống session fixation), có TTL tuyệt đối. | — |
| JWT | `jsonwebtoken` 9.0 cho client Bearer | **KEEP** | — | Bearer được **miễn CSRF** có chủ ý — trình duyệt không tự đính kèm nó. | — |
| MFA | TOTP (`speakeasy` 2.0) + mã dự phòng | **KEEP** | — | Bí mật mã hoá at-rest bằng `MFA_ENC_KEY`; production **từ chối khởi động** nếu thiếu. | — |
| SSO / OIDC | **chưa có** | **DEFER** | OIDC (Entra ID / Google / Okta / Keycloak) | Phụ lục §8: không chuyển khi business chưa cần — hai công ty, tài khoản nội bộ. Nhưng **không được thiết kế chặn đường**: xem `docs/adr/0007-san-sang-cho-oidc.md`. | Trung bình |

## Kiểm thử & CI

| Component | Current | Decision | Target | Reason | Migration Risk |
|---|---|---|---|---|---|
| Vitest | 4.1 (backend + web) | **KEEP** | — | Một runner cho cả hai phía. | — |
| Playwright | 1.62 | **KEEP** | — | Dùng cho smoke giao diện chạy **cục bộ** (`scripts/ci/ui-smoke.mjs`), không phải bộ E2E đầy đủ. | — |
| GitHub Actions | `ci.yml` có, **chưa bao giờ chạy** | **REPLACE** ✔ | `npm run verify` cục bộ | Tài khoản không bật Actions. Lượt chạy thật đầu tiên của job `security` lộ ra **hai chốt vô tác dụng** (`.gitleaks.toml` sai cú pháp allowlist, `.trivyignore.yaml` sai tiền tố ID). Cổng thật nay là 12 bước gõ tay. | Đã hoàn tất |
| gitleaks · trivy · semgrep | ghim theo tag, chạy qua Docker | **KEEP** | — | Phụ lục §22: không phụ thuộc `latest` cho image quét. | — |
| Ký ảnh (Cosign) | **chưa có** | **DEFER** | Cosign + OIDC | §22 nói "nếu infrastructure hỗ trợ". Không có registry nào đang phát hành ảnh đã ký, và production dựng ảnh **trên VM** — không có gì để ký. Bật cùng lúc với đường digest. | Thấp |

---

## Tổng kết theo quyết định

| Quyết định | Số mục | Ghi chú |
|---|---|---|
| KEEP | 24 | Không có vấn đề đo được nào biện minh cho việc thay |
| ĐÃ MIGRATE ✔ | 2 | tsx → dist/ · CI GitHub → cổng cục bộ |
| DEFER | 5 | Express 5 · Loki/Grafana · digest bất biến · OIDC · Cosign |
| REFACTOR | 1 | Nhập Excel → BullMQ |
| REPLACE | 0 | |
| REMOVE | 0 | SPA vanilla cũ đã gỡ trước đợt này (`docs/adr/0006`) |
