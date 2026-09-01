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
| Vite | 8.1 | **KEEP** | — | Build 22 file test web + bundle production trong vài giây. Không có vấn đề đo được. | — |
| Express | 4.21 | **KEEP** | — | Phụ lục §11 cấm đổi sang NestJS chỉ vì DI/modules. Ranh giới module đạt được bằng cấu trúc thư mục TypeScript. Express 5 thì `DEFER` (xem dưới). | — |
| Express | 4.21 | **DEFER** | Express 5 | Express 5 đổi cách xử lý lỗi async và pattern route. Lợi ích thật: bỏ được `asyncHandler`. Chưa đủ để đánh đổi rủi ro trên 138 endpoint. Xem lại khi Express 4 hết hỗ trợ. | Trung bình — mọi route phải test lại |
| TypeScript | 5.7 | **KEEP** | — | `strict` đã bật, typecheck chạy trong cổng. | — |
| Zod | 4.4 | **KEEP** | — | Đã migrate v3→v4 (cú pháp v3 bị **bỏ qua âm thầm** và làm lọt thông báo tiếng Anh ra giao diện — xem AGENTS.md). | — |
| @tanstack/react-query | 5.10 | **KEEP** | — | Đang gánh cache + invalidation của SPA. | — |

## Dữ liệu

| Component | Current | Decision | Target | Reason | Migration Risk |
|---|---|---|---|---|---|
| PostgreSQL | 16-alpine | **KEEP** | — | Phụ lục §9: không đổi sang MongoDB/DynamoDB cho dữ liệu giao dịch. Tiền dùng `Decimal`; ràng buộc và transaction là yêu cầu nghiệp vụ. | — |
| Prisma | 7.8 | **KEEP** | — | Phụ lục §10: chỉ thay ORM khi có vấn đề **mang tính hệ thống**. Hot path chậm thì dùng raw query của chính Prisma, không bỏ Prisma. | — |
| Tìm kiếm | Postgres GIN + pg_trgm + `searchText` bỏ dấu | **KEEP** | — | Phụ lục §14: chỉ thêm Elasticsearch khi benchmark chứng minh Postgres không đáp ứng. Chưa có benchmark nào cho thấy thế. ⚠️ 11 index GIN này tạo bằng **SQL thô** — `prisma migrate dev` sẽ muốn DROP chúng ở mọi lần chạy; `scripts/ci/check-destructive-sql.mjs` chặn. | — |
| Redis (ioredis 5.11) | BullMQ · Pub/Sub (SSE) · rate-limit phân tán | **KEEP** | — | Phụ lục §5: đúng nhóm use case được khuyến nghị. **Không** dùng làm cache tuỳ tiện, **không** làm primary database. ⚠️ Ô *Current* trước đây còn ghi `session` — **sai và đã sửa**: kho phiên là `connect-pg-simple` → bảng `user_sessions` trong Postgres (`src/app.ts`), không có `connect-redis` ở đâu trong repo. Lý do CÓ CHỦ Ý và hệ quả cho DR: [ARCHITECTURE.md § Phiên nằm ở Postgres](ARCHITECTURE.md#phiên-nằm-ở-postgres--có-chủ-ý-không-phải-thiếu-sót). | — |
| Mã hoá PII | AES-256-GCM (`src/piiBox.ts`) | **KEEP** | — | Khoá ngoài CSDL, có bản HMAC mù để tra cứu. ⚠️ Cột thô vẫn song song — **quyết định của chủ hệ thống là giữ nguyên**, ghi rõ ở `docs/REMAINING_RISKS.md`. | — |

## Nền tảng chạy

| Component | Current | Decision | Target | Reason | Migration Risk |
|---|---|---|---|---|---|
| Node.js | 22 (`.nvmrc`) | **KEEP** | — | LTS. | — |
| Build pipeline | `tsc -p tsconfig.build.json` → `dist/` (backend) · Vite → `public/app2/` (web, `base: "/app2/"`) | **KEEP** | — | Hai trình biên dịch cho hai đích, gặp nhau ở **một** artifact: Dockerfile multi-stage chép `dist/` và `public/app2/` vào ảnh cuối rồi `CMD ["node","dist/server.js"]`. Cùng artifact đó chạy ở **cả bốn** đường triển khai (Dockerfile · docker-compose · manifest `infra/k8s/` · Helm chart) — `scripts/ci/check-runtime-command.sh` chặn mọi lệnh khởi động trỏ vào `src/`. Không thêm bundler cho backend: Node chạy thẳng ESM đã biên dịch, và bundling sẽ làm hỏng `import.meta.url` cùng các đường dẫn tới `templates/`, `fonts/`. | — |
| Chạy production | `node dist/*.js` | **ĐÃ MIGRATE** ✔ | từ `tsx src/*.ts` | Phụ lục §3. Trước đây Docker chạy qua `tsx` còn Helm gọi `node src/server.js` (**file không tồn tại** → pod chết vòng lặp). Nay bốn đường triển khai dùng **chung một artifact**. Khoá bằng `scripts/ci/check-runtime-command.sh` + `scripts/ci/smoke-image.sh`. | Đã hoàn tất |
| BullMQ | 5.77 | **KEEP** | — | Phụ lục §13: không thêm Kafka/RabbitMQ/NATS cho một ứng dụng nghiệp vụ nội bộ. | — |
| Nhập Excel | `node:worker_threads` **trong tiến trình API** | **KEEP** (soát lại 2026-08-27, trước đó ghi REFACTOR) | — | Phụ lục §4 nói job nặng nên đi qua hàng đợi, và bảng này từng ghi REFACTOR theo mặt chữ đó. Soát lại đường mã thì danh sách của §4 khớp **kém** với cái đang có: `POST /api/quotes/import-excel` là **XEM TRƯỚC ĐỒNG BỘ** — nó KHÔNG ghi CSDL, kết quả CHÍNH LÀ phản hồi (dữ liệu lưới để người dùng soát rồi mới bấm Lưu). BullMQ sinh ra cho việc bắn-rồi-quên có kết quả là một tệp hoặc một tác dụng phụ. Và những gì §4 thật sự đòi thì đường này **đã có**: rời event loop (worker thread), **concurrency** (`IMPORT_MAX_CONCURRENT`), **queue limit** + từ chối sớm 429 kèm `Retry-After` (`IMPORT_MAX_QUEUED`, `IMPORT_WAIT_MS`), **timeout** (`terminate()` luồng khi hết hạn), trần tệp 10MB, soi mục lục zip trước khi giải nén. Ba mục còn lại của §4 vô nghĩa ở đây: *retry/backoff* (người dùng bấm lại — máy tự thử lại một file hỏng là vô ích), *idempotency/dedup* (không có tác dụng phụ để trùng), *failure retention* (`audit` đã ghi lượt bị từ chối). Đổi sang BullMQ đổi lại **hợp đồng API + UX trang nhập** (tải lên → mã job → hỏi → tải kết quả) và phải cất payload xem trước vài MB ở đâu đó — chi phí thật, đổi lấy lợi ích không đo được. §19: không trả lời được "vấn đề ĐO ĐƯỢC nào đang tồn tại" thì KHÔNG migrate. | — |
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
| Gom log tập trung | cấu hình CÓ SẴN, **chưa bật** | **DEFER (bật được ngay)** | Loki + Promtail + Grafana | Phụ lục §16 khuyến nghị. Ngăn xếp đã viết sẵn ở `infra/observability/` — một lệnh compose overlay là chạy. Chưa bật mặc định vì production một VM và bốn container nữa (Loki · Promtail · Prometheus · Grafana) ăn RAM của chính ứng dụng. Bảng điều khiển đặt log CẠNH metric; mọi PromQL trong đó được `check-alerts.mjs [A4]` đối chiếu với `src/observability.ts`. | Thấp |
| Lưu báo giá (xoá-tạo-lại mọi trang) | full rewrite | **ĐÃ LÀM** ✔ (sau cờ, mặc định TẮT) | bỏ qua trang KHÔNG ĐỔI | §16 đòi benchmark trước/sau — đã đo: 10.000 dòng đi từ 3.255 ms xuống 930 ms (3,5×), 98% thời gian nằm ở ghi CSDL nên đây đúng chỗ cần chạm. Mức TRANG chứ không mức DÒNG: mức dòng đòi id bền + luật ghép dòng, tức một tầng lỗi mới giữa đường tiền bạc. Số liệu đầy đủ: `docs/architecture/QUOTE_SAVE_PERFORMANCE.md`. | Trung bình — nên bật ở staging trước; gỡ biến môi trường là quay lại đường cũ, không cần rollback mã |
| Metrics | Prometheus (`prom-client` 15.1) | **KEEP** | — | 22 metric riêng + bộ mặc định (đếm: `grep -coE 'name: "[a-z_]+"' src/observability.ts`). `/metrics` gác bằng Bearer, **404 ở production nếu thiếu token**. | — |
| Cảnh báo | 19 rule ở `infra/prometheus/alerts.yaml` (`grep -c '^      - alert:' infra/prometheus/alerts.yaml`) | **KEEP (chưa kích hoạt)** | — | Có bài `promtool test rules` chốt logic. Máy chủ Prometheus nay CÓ định nghĩa (`infra/observability/prometheus.yml` mount thẳng tệp quy tắc này), nhưng ngăn xếp quan sát **không bật mặc định** — và vẫn **không có Alertmanager**, nên cảnh báo dừng ở giao diện Prometheus, không đánh thức ai. | — |
| Sentry | 10.55 | **KEEP** | — | Phụ lục §16: giữ cho lỗi ứng dụng, không dựng chồng 3–4 hệ giám sát. | — |
| Bí mật | `.env` + quy ước `*_FILE` | **KEEP** | — | Phụ lục §17: `*_FILE` cho Docker secrets / K8s Secret / Vault mà không đổi cách triển khai. ⚠️ Chưa đường triển khai nào dùng. | — |
| Kho object | S3 API (`@aws-sdk/client-s3` 3.x) | **KEEP** | — | Phụ lục §7: có lớp trừu tượng `src/storage.ts`, không hard-code nhà cung cấp. | — |

## Xác thực

| Component | Current | Decision | Target | Reason | Migration Risk |
|---|---|---|---|---|---|
| Phiên | `express-session` + `connect-pg-simple` (bảng `user_sessions`, **Postgres** — KHÔNG phải Redis) | **KEEP** | — | `regenerate()` khi đăng nhập (chống session fixation), có TTL tuyệt đối. Kho ở Postgres là lựa chọn CÓ CHỦ Ý: phiên sống sót qua lần khởi động lại Redis và nằm sẵn trong bản `pg_dump` (khôi phục kéo theo cả phiên — với điều kiện `SESSION_SECRET` khôi phục y hệt). Kho phiên dựng **pool node-pg thứ hai** (`SESSION_POOL_MAX`, mặc định 4). | — |
| JWT | `jsonwebtoken` 9.0 cho client Bearer | **KEEP** | — | Bearer được **miễn CSRF** có chủ ý — trình duyệt không tự đính kèm nó. | — |
| MFA | TOTP (`speakeasy` 2.0) + mã dự phòng | **KEEP** | — | Bí mật mã hoá at-rest bằng `MFA_ENC_KEY`; production **từ chối khởi động** nếu thiếu. | — |
| SSO / OIDC | **chưa có** | **DEFER** | OIDC (Entra ID / Google / Okta / Keycloak) | Phụ lục §8: không chuyển khi business chưa cần — hai công ty, tài khoản nội bộ. Nhưng **không được thiết kế chặn đường**: xem `docs/adr/0007-san-sang-cho-oidc.md`. | Trung bình |

## Kiểm thử & CI

| Component | Current | Decision | Target | Reason | Migration Risk |
|---|---|---|---|---|---|
| Vitest | 4.1 (backend + web) | **KEEP** | — | Một runner cho cả hai phía. | — |
| Playwright | 1.62 | **KEEP** | — | Dùng cho smoke giao diện chạy **cục bộ** (`scripts/ci/ui-smoke.mjs`), không phải bộ E2E đầy đủ. | — |
| GitHub Actions | `ci.yml` có, **chưa bao giờ chạy** | **REPLACE** ✔ | `npm run verify` cục bộ | Tài khoản không bật Actions. Lượt chạy thật đầu tiên của job `security` lộ ra **hai chốt vô tác dụng** (`.gitleaks.toml` sai cú pháp allowlist, `.trivyignore.yaml` sai tiền tố ID). Cổng thật nay là 13 bước gõ tay. | Đã hoàn tất |
| gitleaks · trivy · semgrep | ghim theo tag, chạy qua Docker | **KEEP** | — | Phụ lục §22: không phụ thuộc `latest` cho image quét. | — |
| Ký ảnh (Cosign) | **chưa có** | **DEFER** | Cosign + OIDC | §22 nói "nếu infrastructure hỗ trợ". Không có registry nào đang phát hành ảnh đã ký, và production dựng ảnh **trên VM** — không có gì để ký. Bật cùng lúc với đường digest. | Thấp |

---

## Tổng kết theo quyết định

| Quyết định | Số mục | Ghi chú |
|---|---|---|
| KEEP | 33 | Không có vấn đề đo được nào biện minh cho việc thay. Hai trong số này là **KEEP (chưa kích hoạt)** — Helm/k8s và 19 rule cảnh báo: có file, chưa phải thứ đang chạy. |
| ĐÃ MIGRATE ✔ | 1 | `tsx src/*.ts` → `node dist/*.js` |
| ĐÃ LÀM ✔ | 1 | Lưu báo giá incremental (sau cờ, **mặc định TẮT**) |
| REPLACE ✔ | 1 | CI GitHub Actions → `npm run verify` cục bộ |
| DEFER | 5 | Express 5 · Loki/Grafana · digest bất biến · OIDC · Cosign |
| REFACTOR | 0 | Trống có chủ ý. Mục duy nhất từng nằm đây — *Nhập Excel → BullMQ* — đã **soát lại 2026-08-27 và chuyển thành KEEP**; lập luận đầy đủ ở dòng “Nhập Excel” của bảng *Nền tảng chạy*. |
| REPLACE (chưa làm) | 0 | |
| REMOVE | 0 | SPA vanilla cũ đã gỡ trước đợt này (`docs/adr/0006`) |
| **Tổng** | **41** | Bằng đúng số dòng quyết định trong các bảng ở trên — lệch là dấu hiệu bảng này đã trôi. |

> Bảng tổng kết này từng ghi `KEEP 24` và `REFACTOR 1` trong khi các bảng ở trên
> đã có 33 dòng KEEP và 0 dòng REFACTOR. Con số **đếm từ bảng chi tiết** mới là
> nguồn sự thật; nếu bạn sửa một dòng ở trên, sửa luôn ở đây.
