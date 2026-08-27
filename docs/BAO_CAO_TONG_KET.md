# Báo cáo tổng kết — rà soát, siết chặt và dọn dẹp toàn hệ

> Định dạng theo §53 của MASTER PROMPT (mục A–L).
> **Nguồn sự thật là MÃ NGUỒN.** Mọi con số dưới đây đo được lại bằng một lệnh, và lệnh đó ghi kèm.
> Chốt cuối: `npm run verify` — **34/34 cổng xanh**, exit 0.

---

## A. Executive Summary

**Trước.** Một hệ quản lý báo giá đang chạy thật, kiến trúc lành mạnh (React SPA → Express →
Service → Prisma → PostgreSQL, cộng Redis/BullMQ/SSE), 137 endpoint, tiền dùng `Decimal`. Nhưng
lớp *bảo đảm* thì mỏng ở đúng những chỗ đắt nhất: `ci.yml` khai đủ cổng mà **chưa bao giờ chạy**
(tài khoản không bật GitHub Actions), không có E2E, không có quy tắc cảnh báo, không ai đo đường
lưu báo giá, và bản thân `npm run verify` có năm lỗ khiến nó xanh trong khi không kiểm gì.

**Sau.** Cổng kiểm là thứ **chạy được và đỏ được**: 13 bước, 34 khẳng định, gồm dựng + smoke image
Docker thật, smoke giao diện Chromium 18 bước đi hết luồng người dùng, `EXPLAIN ANALYZE` trên câu
SQL Prisma thật sự chạy, quét bảo mật thật, và bốn luật ranh giới tầng. Đường lưu báo giá lần đầu
được **đo**, rồi mới sửa: 10.000 dòng đi từ 3.255 ms xuống 931 ms. Bộ test đi từ ~1.271 lên
**1.410 bài backend + 251 bài web** (đo lại 2026-08-27 sau đợt vá, `npm run verify` xanh trọn).

**Điều đáng nói nhất không phải các bản vá — mà là ba lỗi mà chính việc viết cổng kiểm mới lộ ra:**

1. **Bundle giao cho người dùng là BẢN DEV của React.** Vite quyết dev-hay-prod theo `NODE_ENV`
   của tiến trình build, mà chính `verify-local.sh` export `NODE_ENV=test` — nên `npm run verify`
   tự tay dựng bundle dev rồi đem đi smoke. 984.802 byte thay vì 630.482, và `<StrictMode>` của
   bản dev chạy đôi mọi `useEffect`, làm **mất trắng** thông tin người dùng vừa điền qua 3 bước
   wizard tạo báo giá.
2. **Cổng cảnh báo `[A3]` xanh giả từ đầu** — bộ tách tên metric chỉ nhận chữ thường, nên một tên
   metric có chữ hoa là vô hình với nó.
3. **Lượt chạy THẬT đầu tiên của nhóm quét bảo mật** lộ ra `.gitleaks.toml` viết allowlist bằng cú
   pháp gitleaks **bỏ qua**, và `.trivyignore.yaml` ghi ID thiếu tiền tố `AVD-`.

Cả ba đều thuộc một loại: **chốt chặn được KHAI mà không CHẠY**. Đó là chủ đề xuyên suốt đợt này.

---

## B. Findings

Chỉ liệt những phát hiện của lượt gần nhất (8 commit, 74 tệp, +5.252/−197 dòng). Các đợt trước đã
ghi trong `CHANGELOG.md` và `docs/REMAINING_RISKS.md`.

| Mức | Vấn đề | Trạng thái thật | Cách vá | Tệp đổi | Test |
|---|---|---|---|---|---|
| **Cao** | Bundle web là bản DEV của React (phình 65%, `<StrictMode>` chạy đôi effect → mất dữ liệu wizard) | **EXISTS** | Ghim `NODE_ENV=production` cho lệnh build ở hai lớp (đặt biến trước khi trả cấu hình + `define`); chỉ `define` không đủ | `web/vite.config.ts`, `scripts/ci/check-web-bundle.mjs` | cổng `check-web-bundle`, đã kiểm ngược 2 chiều |
| **Cao** | Bàn giao bản nháp Wizard → trình soạn mất trắng khi effect chạy lại | **EXISTS** | Tách bất biến thành `giuBanNhap()`, giữ bản nháp trong ref theo đúng lần mount | `web/src/lib/pendingQuote.ts`, `web/src/pages/QuoteEditor.tsx` | `pendingQuote.test.ts` (4 bài, kiểm ngược: gỡ vá → đỏ) |
| **Cao** | Mất phần đang gõ khi tab sập / máy mất điện (3 lớp sẵn có đều chỉ sống trong RAM tab) | **EXISTS** | Bản nháp cục bộ: gộp 1,2 s, trần 1 MB, hạn 7 ngày, tự bóc ảnh base64 khi quá trần **và nói ra** | `web/src/lib/localDraft.ts` (mới), `QuoteEditor.tsx` | `localDraft.test.ts` (11 bài) + E2E `[U10b]` |
| **Cao** | `check-alerts [A3]` xanh giả với tên metric có chữ hoa | **EXISTS** | Mở rộng bộ tách sang `[a-zA-Z_:]`; thêm bước `[A4]` soi PromQL của bảng điều khiển Grafana | `scripts/ci/check-alerts.mjs` | kiểm ngược 2 tên sai → đỏ đúng |
| **Trung bình** | Trang Mã khách hàng: `ORDER BY createdAt` không index nào phục vụ → Seq Scan + Sort toàn bảng | **EXISTS** | Index PHẦN `WHERE deletedAt IS NULL` cho `createdAt` và `updatedAt` | `prisma/migrations/20260827140000_customer_sort_indexes/` | cổng `explain-hot-paths`, kiểm ngược: gỡ index → đỏ |
| **Trung bình** | Lưu báo giá xoá-tạo-lại MỌI trang: 10.000 dòng = 3,3 s cho một ô sửa | **EXISTS** | Cờ `INCREMENTAL_QUOTE_SAVE` (mặc định TẮT) bỏ qua trang không đổi | `src/quoteSheetDiff.ts` (mới), `src/services/quoteService.ts`, `src/config.ts` | `xc-incremental-quote-save.test.js` (7 bài, chạy CẢ HAI chiều cờ) |
| **Trung bình** | Log request thiếu `route` và `role` → gom log không nhóm được theo endpoint | **EXISTS** | Ghi mẫu route ngay trong `asyncHandler` (thời điểm duy nhất `req.baseUrl` còn đúng cho cả đường lỗi) | `src/middleware.ts`, `src/app.ts` | `xd-log-fields.test.js` (5 bài, dùng pino thật) |
| **Trung bình** | §5 thiếu ca cuối "expired session"; cookie `HttpOnly`/`SameSite` chưa bài nào kiểm | **PARTIALLY FIXED** | Dựng app thứ hai với kho phiên trống → chốt 401 (KHÔNG 403) | `tests/csrf.test.js` | +1 bài (13 tổng) |
| **Trung bình** | Bộ gõ tiếng Việt: điều kiện IME nằm ở 2 nơi, 2 cách viết, **0 bài kiểm** | **EXISTS** | Gộp về `dangGoIME()` thuần | `web/src/lib/gridShared.ts`, `GridTable.tsx`, `Venues.tsx` | `imeGuard.test.ts` (8 bài) |
| **Trung bình** | `TRUST_PROXY` chỉ có chú thích, không bài nào chứng minh hậu quả đặt sai | **PARTIALLY FIXED** | Tài liệu topology + 5 bài đo qua bảng `LoginAttempt` thật | `docs/operations/REVERSE_PROXY.md` | `xb-trust-proxy.test.js` |
| **Trung bình** | Không có sổ phát hành (§46 đòi 4 trường) | **EXISTS** | `deploy.sh` bước `[5b/13]` ghi `RELEASES.log`: SHA · migration ĐANG áp trong CSDL · digest image · mốc UTC máy chủ | `deploy.sh` | chạy thử với `docker` giả |
| **Thấp** | 5 nơi tự tính `Math.ceil(total/size)`; `size=0` ra `Infinity` → JSON `null` | **EXISTS** | `src/pagination.ts`: `phanTrang()` + `skipTake()` (trần lấy từ `config`) | 5 service | `xe-pagination.test.js` (10 bài, đối chiếu với bản chép tay cũ) |
| **Thấp** | `PRISMA_LOG_QUERIES` đọc thẳng `process.env` mà không khai ở đâu | **EXISTS** (cổng `b8-env-drift` bắt) | Ghi vào `.env.example` kèm cảnh báo không bật ở production | `.env.example` | cổng sẵn có |

---

## C. False Positives / Already Fixed

Ghi đầy đủ ở `docs/REMAINING_RISKS.md`, mục **"ĐÃ BÁC BỎ — đừng vá lại"**. Tóm tắt:

| Phát hiện | Vì sao bác bỏ |
|---|---|
| `invoiceLink` là lỗ XSS `javascript:` | **Hai** lớp chặn có sẵn: React 19 chặn `javascript:` trong `href`, và zod ở route đã ép `^https?://`. Tôi **đã sửa "phòng xa" rồi REVERT** — đó là sửa mã đang đúng, vi phạm §0/§50 |
| semgrep "partially analyzes" → mù cả tệp | Đo được: vùng mù là **khu vực quanh lỗi cú pháp**, không phải cả tệp |
| `tsx` lọt vào ảnh production | Đúng chỗ: `prisma.config.ts` là TypeScript và Prisma CLI phải nạp được lúc `migrate deploy` **trong container** |

Và **tài liệu lỗi thời** — loại nhãn §0 đòi mà repo trước đây không có chỗ nào: hai bản audit/bench
lưu trữ, ba chú thích trỏ số dòng đã trôi, và chính đoạn "PHASE 4 hụt hẳn" trong
`REMAINING_RISKS.md` (nay đã đối chiếu lại — cả 5 mục đã đóng từ các đợt trước).

---

## D. Architecture Changes

**Không đổi cây thư mục sang `src/modules/`.** Lý do đầy đủ ở
[ADR 0008](adr/0008-khong-doi-cay-thu-muc-sang-modules.md), áp đúng **bảy câu của Phụ lục §19** lên
chính đề xuất đó. Sáu trên bảy câu ra kết quả xấu hoặc rỗng — trong đó câu quyết định *"vấn đề ĐO
ĐƯỢC nào đang tồn tại"* là **rỗng**. §19 nói rõ ca này: **DO NOT MIGRATE**.

Thay vào đó, **ranh giới được khoá bằng cổng chạy được** (`scripts/ci/check-architecture.mjs`):

| Luật | Nội dung | Đo hôm nay |
|---|---|---|
| `[K1]` | route không chạm thẳng Prisma | 7 tệp cũ **khai nợ kèm lý do từng cái**; tệp mới là ĐỎ |
| `[K2]` | service không cầm `Response`/`NextFunction` | 19/19 sạch |
| `[K3]` | service không import route | sạch |
| `[K4]` | không vòng import giữa các service | sạch |

Đổi tên thư mục **không ngăn được gì**: một `import { prisma }` viết vào controller ngày mai vẫn
biên dịch, vẫn chạy, vẫn qua mọi test. Thư mục là cách *sắp xếp*; thứ giữ ranh giới là một phép
kiểm chạy được.

**Ranh giới mới thứ hai — phân trang.** `src/pagination.ts` là nơi độc nhất dựng phong bì
`{ data, meta }`, và `skipTake()` đặt trần `size` **cùng chỗ** với phép tính `skip` nên không
endpoint nào "quên" nó.

**`/api/v1` — chuẩn bị, không dựng.** [API_VERSIONING.md](architecture/API_VERSIONING.md) ghi:
điều kiện kích hoạt, cách gắn (kể cả hai middleware gắn theo đường dẫn cụ thể rất dễ quên), và
chính sách ngừng hỗ trợ 6 tháng dùng header `Deprecation`/`Sunset` (RFC 8594). Sáu trên bảy điều
kiện khó của việc gắn phiên bản **đã đạt sẵn** (error envelope, reqId, không stack trace, map mã
Prisma, lỗi validate, lỗi xác thực) — nên dựng sau rẻ đúng bằng dựng trước, mà không phải gánh một
bề mặt tấn công thứ hai không có ai gọi.

---

## E. Security Changes

* **§5 CSRF** — bộ 7 ca của prompt nay đủ. Ca cuối ("expired session") dựng đúng cảnh vận hành:
  cookie còn chữ ký hợp lệ nhưng **bản ghi phiên đã mất**. Chốt: phải **401, KHÔNG 403** — vì
  `web/src/lib/api.ts` bắt đúng 401 để phủ hộp đăng nhập lại mà không unmount trình soạn; trả 403 là
  người dùng nhận câu "CSRF" vô nghĩa **và mất phần đang gõ**. Tiện thể chốt `HttpOnly` +
  `SameSite=Lax` của cookie phiên — hai thuộc tính thiết kế §5 dựa vào nhưng trước đây chỉ tồn tại
  trong chú thích.
* **§40 trust proxy** — 5 bài đo qua bảng `LoginAttempt` thật (cột `ip` cũng chính là khoá mà lớp
  chống dò mật khẩu đếm theo). Một bài **cố ý chứng minh hậu quả** của `TRUST_PROXY=true`: IP do
  client tự khai **thắng**. Con số "1, không phải true" trong `.env.example` nay có bằng chứng đi kèm.
* **§27 không log bí mật** — `xd-log-fields.test.js` dùng **pino thật** ghi vào bộ nhớ, nên vế
  "không được log" chạy qua đúng lớp `redactConfig` của production, không phải một logger giả.
* **§46 sổ phát hành** — mỗi lần deploy ghi một dòng JSON vào `RELEASES.log`. `migration` lấy từ
  hàng mới nhất trong `_prisma_migrations` của CSDL THẬT, không phải thư mục mới nhất trong repo:
  hai cái lệch nhau đúng lúc migrate hỏng giữa chừng, và đó là lúc cần sổ này nhất.
* **§13 quét bảo mật** — chạy thật trong `verify` bước `[13/13]`: gitleaks (cả lịch sử git **và**
  cây làm việc — hai lượt khác nhau, `detect` chỉ soi commit), trivy, semgrep, SBOM.

---

## F. Performance

### Đo trước, rồi mới quyết — đúng điều kiện §16

§16 cho phép **không** làm nếu benchmark chứng minh phức tạp > lợi ích. Nên bước đầu là bộ đo, không
phải mã mới: `npm run bench:quote-save` (Postgres cục bộ, 5 lần mỗi kích cỡ, lấy trung vị).

**Kịch bản: sửa ĐÚNG MỘT ô rồi bấm Lưu.**

| dòng | trang | TRƯỚC | SAU | trang giữ nguyên | chênh |
|---:|---:|---:|---:|---:|---:|
| 100 | 1 | 80,8 ms | 78,8 ms | 0/1 | — |
| 1 000 | 1 | 341,3 ms | 360,9 ms | 0/1 | **−6% (chậm hơn)** |
| 2 000 | 2 | 651,9 ms | 434,8 ms | 1/2 | **1,5×** |
| 5 000 | 5 | 1 536,3 ms | 493,1 ms | 4/5 | **3,1×** |
| 10 000 | 10 | 3 255,1 ms | 930,7 ms | 9/10 | **3,5×** |

**Con số quyết định** (vì sao ghi tăng dần là đúng chỗ cần chạm): **98% thời gian nằm ở ghi CSDL**,
không phải zod/`Decimal`. Nếu ngược lại thì §16 tự trả lời là "đừng làm".

**Cái giá, nói thẳng:** báo giá một trang chậm hơn ~6% — nó trả tiền cho lần đọc so sánh mà không có
gì để bỏ qua. Đánh đổi có chủ ý; kích cỡ đó vốn đã đủ nhanh.

**Cột "trang giữ nguyên" là bằng chứng trực tiếp**, không suy từ thời gian: trang bị xoá-tạo-lại thì
`QuoteSheet.id` mới, trang được giữ thì id cũ.

Chi tiết + phân rã (`snapshotQuoteVersion` chiếm 13–16%; lần đọc so sánh chỉ 93 ms ở 10.000 dòng):
[QUOTE_SAVE_PERFORMANCE.md](architecture/QUOTE_SAVE_PERFORMANCE.md).

### Truy vấn

`npm run db:explain` dựng 5.000 dòng, `ANALYZE`, rồi `EXPLAIN ANALYZE` **câu SQL Prisma thật sự
chạy** (nghe qua `ngheTruyVan` ở `src/db.ts`). Nó tìm ra ngay một index thiếu. Ngưỡng đỏ tính theo
**số dòng ĐỌC THẬT** (ra + bị lọc bỏ, nhân số vòng) — `Actual Rows` một mình bỏ lọt đúng những lần
quét đắt nhất.

---

## G. DR (sao lưu / khôi phục)

| Hạng mục | Trạng thái |
|---|---|
| Sao lưu CSDL tự động | ✅ `scripts/backup/backup-db.sh`, có watchdog Telegram |
| Sao lưu kho object | ✅ `scripts/backup/backup-objects.sh` |
| Diễn tập khôi phục | ✅ `scripts/backup/restore-test.sh` |
| Kiểm toàn vẹn | ✅ `src/tools/verifyIntegrity.ts` |
| Diễn tập migration | ✅ `scripts/db/migration-rehearsal.sh` (đã vá lỗi nuốt migration hỏng qua `\| grep \| tail` không có `pipefail`) |
| **Bản sao NGOÀI máy chủ** | ⚠️ **chưa có bằng chứng chạy thật trên VM** — script có, nhưng không mã nào làm thay được một lượt chạy thật |

Ô cuối là **ô §52 duy nhất còn hở**, và nó được ghi đúng như vậy trong `REMAINING_RISKS.md` thay vì
tô xanh.

---

## H. Files Deleted/Moved

Lượt này **không xoá/di chuyển tệp nào**. (Các đợt trước đã gỡ SPA vanilla cũ — xem
[ADR 0006](adr/0006-go-spa-vanilla-cu.md) — và tái cấu trúc `docs/`.)

Tệp **mới** đáng chú ý:

| Tệp | Vì sao tồn tại |
|---|---|
| `src/quoteSheetDiff.ts` | so trang sắp ghi với trang đang có; **sai thì phải sai về phía "khác nhau"** |
| `src/pagination.ts` | một chỗ dựng phong bì phân trang + trần `size` |
| `web/src/lib/localDraft.ts` | lưới cuối chống mất phần đang gõ |
| `scripts/bench/quote-save-bench.mjs` | §16 đòi benchmark trước/sau |
| `scripts/db/explain-hot-paths.mjs` | §17 `EXPLAIN ANALYZE` — và là **cổng**, không phải báo cáo |
| `scripts/ci/check-architecture.mjs` | §2 ranh giới tầng |
| `scripts/ci/check-web-bundle.mjs` | chặn bundle DEV lọt ra production |
| `infra/observability/**` | §27 Loki + Promtail + Grafana (opt-in) |
| `prisma/migrations/20260827140000_customer_sort_indexes/` | index còn thiếu |

---

## I. Documentation

Tài liệu **chuẩn** (canonical) sau đợt này:

| Tệp | Nội dung |
|---|---|
| `AGENTS.md` | quy ước kỹ thuật + **bảng chốt chặn** (mỗi cái ra đời từ một lỗi có thật) |
| `docs/architecture/QUOTE_SAVE_PERFORMANCE.md` | **mới** — đo trước/sau đường lưu, và vì sao chọn mức trang |
| `docs/architecture/API_VERSIONING.md` | **mới** — `/api` vs `/api/v1`, chính sách ngừng hỗ trợ, chuẩn phân trang |
| `docs/adr/0008-…-modules.md` | **mới** — bảy câu §19 áp lên đề xuất đổi cây thư mục |
| `docs/operations/REVERSE_PROXY.md` | **mới** — topology Cloudflare, 5 bảo đảm §40, cấu hình cần giữ |
| `infra/observability/README.md` | **mới** — vì sao Promtail đọc file log thay vì ứng dụng tự đẩy |
| `docs/operations/MONITORING.md` | cập nhật: 7 trường log, mục Loki |
| `docs/REMAINING_RISKS.md` | cập nhật: hai mục nhãn mới (**bác bỏ** / **lỗi thời**), đối chiếu lại PHASE 4 |
| `docs/architecture/TECHNOLOGY_DECISIONS.md` | cập nhật: Excel import xếp lại `KEEP` kèm lập luận §19 |
| **8/8 ADR** | mỗi cái nay có mục **"Đường lùi"** (trước: 0/8) |

---

## J. Test Results

```bash
npm run verify                     # 13 bước · 34 khẳng định · TẤT CẢ XANH · exit 0
```

| Lệnh | Kết quả |
|---|---|
| `npx vitest run` (backend) | **177 tệp · 1 410 bài xanh · 4 bỏ qua** — đo lại 2026-08-27 trong lượt `npm run verify` trọn (có PostgreSQL, Redis, MinIO và Docker). Vòng soát cùng ngày thêm `tests/xf-observability-gaps.test.js`, `web/src/lib/gridUndo.test.ts` và `gridSelect.test.ts` |
| `npx vitest run` trong `web/` | **21 tệp · 251 bài xanh** (environment `node`, KHÔNG jsdom — `web/vite.config.ts` không khai khối `test`) |
| `npm run smoke:ui` | **18/18 bước xanh** · 0 lỗi console · 0 request hỏng ở origin của mình |
| `bash scripts/ci/docker-smoke.sh` | image dựng + chạy thật, **0 dòng stack trong log khởi động** |
| `npm run scan` | gitleaks (lịch sử + cây làm việc) · trivy · semgrep · SBOM |
| `npm run db:explain` | không truy vấn nào quét tuần tự bảng ≥1.000 dòng |
| `npm run check:arch` | 4/4 luật ranh giới xanh |
| `npm run check:alerts` | `promtool check rules` + `test rules` + metric có thật (cảnh báo **và** bảng điều khiển) |
| `npm run bench:quote-save` | bảng ở mục F |

**Mọi cổng mới đều đã kiểm ngược** — cố tình làm hỏng rồi xác nhận nó ĐỎ, sau đó khôi phục. Ba lần
kiểm ngược đó bắt được ba cổng **xanh giả do chính tôi vừa viết**; chúng được vá trước khi giữ lại.

---

## K. Remaining Risks

Không che giấu. Đầy đủ ở `docs/REMAINING_RISKS.md`; những mục còn mở đáng kể:

1. **Bản sao lưu ngoài máy chủ chưa chạy thật trên VM.** Ô §52 duy nhất còn hở. Cần một lượt chạy
   tay, không code nào thay được.
2. **`INCREMENTAL_QUOTE_SAVE` mặc định TẮT** — có chủ ý. Đường lưu là chỗ tiền và trạng thái mức
   trang đi qua; một lỗi so sánh ở đó là mất dữ liệu **âm thầm** (vẫn 200, vẫn "Đã lưu"). Bật ở
   staging trước, dùng thật vài ngày, rồi mới bật production.
3. **Mã hoá PII: cột thô vẫn ghi song song** — **quyết định của chủ hệ thống là giữ nguyên**, chỉ
   ghi rõ rủi ro. Migration bỏ cột thô chưa tồn tại.
4. **Ngăn xếp Loki/Grafana chưa bật ở production** — quyết định vận hành (một VM, ba container nữa
   ăn RAM của chính ứng dụng). Cấu hình đã chạy được, bật là một lệnh.
5. **`snapshotQuoteVersion` chiếm 42–43%** thời gian còn lại sau khi bật cờ ở cỡ 5.000–10.000 dòng.
   Mục tiêu tiếp theo rõ ràng nhất — nhưng nó đụng lịch sử phiên bản, tức đụng khả năng khôi phục,
   nên phải là một đợt riêng có bộ test riêng.
6. **Bảy route còn chạm thẳng Prisma** — đã khai nợ kèm lý do. Đáng tách nhất: `files.routes.ts`
   (9 truy vấn quanh `UploadObject`, thực chất là một service viết thẳng trong route).
7. **Ảnh production vẫn dựng trên VM theo mặc định** — đường kéo theo digest đã có
   (`IMAGE_REF=…@sha256:`), bật là quyết định của chủ hệ thống.
8. **cosign chưa dùng** — không có registry publishing, nên ký ảnh chưa có nơi để kiểm chữ ký.
   Ghi `DEFER` trong bảng công nghệ.

---

## L. Roadmap 12–24 tháng

Chỉ những thứ **thật sự cần**, theo thứ tự.

| Khi nào | Việc | Vì sao bây giờ chưa |
|---|---|---|
| **0–3 tháng** | Chạy thật một lượt sao lưu ra ngoài máy chủ + ghi lại bằng chứng | Ô §52 duy nhất còn hở |
| **0–3 tháng** | Bật `INCREMENTAL_QUOTE_SAVE` ở staging → production | Cần thời gian chạy thật trước khi tin |
| **3–6 tháng** | Thu nhỏ `snapshotQuoteVersion` | Nay là 42% chi phí lưu; nhưng đụng khả năng khôi phục nên cần đợt riêng |
| **3–6 tháng** | Tách `files.routes.ts` thành service | Khoản nợ ranh giới lớn nhất đã khai |
| **6–12 tháng** | Bật Loki/Grafana khi lên nhiều instance | Một VM thì `docker logs` còn đủ |
| **6–12 tháng** | Chuyển sang kéo ảnh theo digest làm mặc định | Cần VM đăng nhập được registry |
| **12–24 tháng** | Dựng `/api/v1` — **chỉ khi** có consumer ngoài repo | Phiên bản là lời hứa với người khác; hứa với không ai thì chỉ còn là chi phí |
| **12–24 tháng** | Express 5 | Bỏ được `asyncHandler`, nhưng phải test lại 137 endpoint. Xem lại khi Express 4 hết hỗ trợ |
| **khi có áp lực TỔ CHỨC** | Ranh giới dọc (`src/modules/`) | Đọc lại bảng bảy câu ở ADR 0008: lúc đó cột "vấn đề đo được" mới không còn rỗng |

**Không đề xuất:** microservices · NestJS · Next.js · Kafka · event sourcing/CQRS · Kubernetes bắt
buộc · MongoDB/DynamoDB cho dữ liệu giao dịch · Elasticsearch. Lý do từng cái ở
[TECHNOLOGY_DECISIONS.md](architecture/TECHNOLOGY_DECISIONS.md).
