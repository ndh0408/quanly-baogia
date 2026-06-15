# Code Review — Toàn bộ source (74 file)

_Tự động review per-file (đã tính tới các fix/hardening trong phiên). Điểm /100._

## Cập nhật review — phiên 2026-06-15 (copy/paste + nhóm con + trang Quản lý dự án)

Review lại bằng nhiều luồng (3 reviewer song song) cho phần code mới/đổi của phiên. **Lỗi đã tìm thấy & ĐÃ SỬA:**

| # | Mức | File | Vấn đề | Đã sửa |
|---|---|---|---|---|
| 1 | **Bảo mật (IDOR)** | `src/routes/quotes.routes.js` — `POST /sheets/:sheetId/sign` | Người có `canSign` có thể ký BẤT KỲ sheetId (id tuần tự, kể cả báo giá nháp/đã xoá) — không kiểm tra phạm vi. | Thêm guard: chỉ ký được sheet của báo giá **đã duyệt & chưa xoá**. |
| 2 | Bảo mật (nhẹ) | `quotes.routes.js` — body `signed` | `z.coerce.boolean` biến chuỗi `"false"` → `true` (ký nhầm). | Đổi sang `z.boolean()` (không coerce). |
| 3 | Đúng/Hỏng dữ liệu | `public/grid-clipboard.js` — `looksLikeExportPaste` | Dùng OR → dán bảng Excel ngoài có tiêu đề cột 1 là 1–2 chữ ("TT"/"KL") bị hiểu nhầm thành nhóm → hỏng cấu trúc. | Đổi sang AND + chữ nhóm phải là **1 ký tự HOA** + phải có cột STT thừa. Thêm 2 unit test chặn. |
| 4 | Đúng (Excel) | `src/excel.js` — `wrapLines` | Chiều cao hàng không chặn trên → vượt giới hạn 409 pt của Excel (file out-of-spec, hàng vẫn bị cắt). | Chặn `Math.min(409, …)`. |
| 5 | Đúng (Excel) | `src/excel.js` — vòng đo chiều cao | Hàng con (sub) tính chiều cao theo ô tên (đã bị gộp lên dòng cha, không hiện) → hàng cao vô ích. | Tính `effKind` trước, bỏ qua tên với hàng `sub`. |

**Đã xem xét & GIỮ NGUYÊN (đúng thiết kế, không phải lỗi):**
- Tổng nhóm chính KHÔNG gồm các mục của nhóm con (reviewer tưởng là lỗi) — đây đúng yêu cầu "nhóm con không cộng vào nhóm chính" và **khớp đúng màn hình editor**.
- `canSign` cho xem TẤT CẢ dự án đã duyệt — đúng yêu cầu (admin + người ký xem hết, quản lý thường chỉ xem của mình).
- Lọc/ô chọn ở trang dự án có `escapeHtml` đầy đủ — không có XSS; cổng client chỉ là hiển thị, server mới là nguồn quyết định.

Kết quả sau sửa: **lint 0 lỗi · test 128 pass** (gồm test parser RFC-4180, dựng lại nhóm, và chặn nhận nhầm bảng ngoài).

## Bảng tổng

| File | Quality | Security | Maintainability | Enterprise |
|---|---|---|---|---|
| src/app.js | 88 | 90 | 84 | 86 |
| src/server.js | 83 | 90 | 85 | 83 |
| src/config.js | 86 | 90 | 85 | 84 |
| src/db.js | 80 | 84 | 78 | 80 |
| src/middleware.js | 88 | 92 | 87 | 88 |
| src/logger.js | 85 | 84 | 86 | 84 |
| src/observability.js | 82 | 85 | 83 | 82 |
| C:\Users\Admin\Desktop\QuanLY\src\authCore.js | 88 | 90 | 85 | 86 |
| C:\Users\Admin\Desktop\QuanLY\src\jwt.js | 85 | 88 | 84 | 85 |
| C:\Users\Admin\Desktop\QuanLY\src\mfa.js | 89 | 87 | 90 | 87 |
| C:\Users\Admin\Desktop\QuanLY\src\sessions.js | 82 | 80 | 86 | 82 |
| src/permissions.js | 90 | 92 | 88 | 87 |
| src/validators.js | 88 | 93 | 86 | 86 |
| src/money.js | 89 | 95 | 87 | 88 |
| C:\Users\Admin\Desktop\QuanLY\src\routes\quotes.routes.js | 83 | 80 | 82 | 80 |
| src/quoteNumber.js | 84 | 92 | 82 | 80 |
| src/quoteVersion.js | 82 | 95 | 83 | 81 |
| src/codeAllocator.js | 83 | 92 | 80 | 80 |
| src/approval.js | 79 | 85 | 76 | 78 |
| src/audit.js | 84 | 80 | 86 | 82 |
| C:\Users\Admin\Desktop\QuanLY\src\excel.js | 74 | 86 | 66 | 72 |
| C:\Users\Admin\Desktop\QuanLY\src\exportQueue.js | 88 | 92 | 86 | 85 |
| C:\Users\Admin\Desktop\QuanLY\src\exportWorker.js | 90 | 92 | 90 | 88 |
| src/xlsxStitcher.js | 75 | 90 | 62 | 70 |
| src/templateConfigs.js | 85 | 95 | 82 | 82 |
| src/pdf.js | 76 | 95 | 82 | 78 |
| src/routes/auth.routes.js | 87 | 92 | 84 | 85 |
| src/routes/users.routes.js | 83 | 90 | 80 | 83 |
| src/routes/customers.routes.js | 84 | 91 | 84 | 85 |
| src/routes/products.routes.js | 84 | 86 | 85 | 84 |
| C:\Users\Admin\Desktop\QuanLY\src\routes\admin.routes.js | 78 | 80 | 82 | 78 |
| C:\Users\Admin\Desktop\QuanLY\src\routes\analytics.routes.js | 85 | 90 | 85 | 84 |
| C:\Users\Admin\Desktop\QuanLY\src\routes\approvals.routes.js | 83 | 82 | 85 | 82 |
| C:\Users\Admin\Desktop\QuanLY\src\routes\audit.routes.js | 90 | 92 | 90 | 89 |
| C:\Users\Admin\Desktop\QuanLY\src\routes\export.routes.js | 87 | 90 | 86 | 87 |
| C:\Users\Admin\Desktop\QuanLY\src\routes\files.routes.js | 89 | 91 | 89 | 89 |
| src/routes/billing.routes.js | 82 | 85 | 83 | 80 |
| src/routes/gdpr.routes.js | 80 | 86 | 78 | 82 |
| src/routes/apiKeys.routes.js | 84 | 88 | 86 | 84 |
| src/routes/mfa.routes.js | 84 | 83 | 86 | 82 |
| src/routes/notifications.routes.js | 89 | 92 | 90 | 88 |
| src/routes/permissions.routes.js | 91 | 92 | 92 | 90 |
| src/routes/meta.routes.js | 83 | 88 | 85 | 84 |
| src/routes/settings.routes.js | 76 | 70 | 80 | 72 |
| src/routes/search.routes.js | 85 | 84 | 85 | 82 |
| src/routes/jobs.routes.js | 88 | 90 | 88 | 87 |
| src/routes/stream.routes.js | 90 | 90 | 92 | 88 |
| src/routes/webhooks.routes.js | 83 | 84 | 84 | 83 |
| src/queue.js | 85 | 90 | 84 | 82 |
| src/worker.js | 84 | 90 | 82 | 83 |
| src/webhooks.js | 90 | 95 | 88 | 90 |
| src/storage.js | 88 | 92 | 88 | 87 |
| src/sse.js | 85 | 90 | 84 | 82 |
| src/notifications.js | 84 | 82 | 85 | 83 |
| src/email.js | 85 | 88 | 84 | 83 |
| src/telegram.js | 84 | 90 | 86 | 84 |
| src/billing.js | 82 | 88 | 78 | 80 |
| C:\Users\Admin\Desktop\QuanLY\public\app.js | 84 | 88 | 72 | 78 |
| public/grid-clipboard.js | 92 | 90 | 93 | 90 |
| public/theme-init.js | 92 | 95 | 90 | 88 |
| prisma/schema.prisma | 88 | 84 | 87 | 85 |
| prisma/seed.js | 84 | 78 | 85 | 80 |
| prisma/backfill-totals.js | 70 | 90 | 78 | 72 |
| eslint.config.js | 86 | 90 | 84 | 84 |
| tests/app.smoke.test.js | 90 | 92 | 88 | 88 |
| tests/excel.test.js | 85 | 92 | 86 | 85 |
| tests/mfa.test.js | 91 | 90 | 92 | 90 |
| tests/money.test.js | 96 | 95 | 96 | 95 |
| tests/permissions.test.js | 94 | 95 | 94 | 93 |
| tests/quoteNumber.test.js | 90 | 90 | 88 | 89 |
| tests/quotes.workflow.test.js | 89 | 92 | 84 | 88 |
| tests/setup.js | 86 | 90 | 86 | 86 |
| tests/validators.test.js | 89 | 90 | 90 | 88 |
| tests/xlsxStitcher.test.js | 92 | 93 | 90 | 91 |
| **TRUNG BÌNH** | **85** | **89** | **85** | **84** |

## Chi tiết từng file

### `src/app.js`  — Clean Code 88/100
**Mục đích:** Factory dựng app Express đầy đủ (helmet/CSP, compression, session PG, CSRF guard theo Origin/Referer, bearer JWT, rate-limit, mount toàn bộ routes, static SPA) nhưng không listen.

**Issues:**
- csrfGuard: nhánh 'không có Origin lẫn Referer' được cho qua hoàn toàn (dòng 76-78). Hợp lý cho curl/SDK, nhưng nghĩa là một browser cũ/edge-case bị strip cả 2 header vẫn lọt — chấp nhận được cho tool nội bộ, nên ghi chú là đánh đổi có chủ ý.
- Thứ tự middleware: metricsMiddleware (dòng 181) chạy TRƯỚC apiLimiter/csrfGuard, nên các request bị 403 CSRF hoặc 429 vẫn được tính vào metrics — đúng mong muốn (đo cả request bị chặn) nhưng nên xác nhận label status phân biệt được.
- app.get('*') (dòng 265) trả index.html cho mọi path không khớp kể cả phần mở rộng file lạ; vì static đặt trước nên ổn, nhưng path traversal-safe do dùng sendFile cố định.
- /metrics đặt trước app.use('/api/', ...) nên không bị rate-limit — chấp nhận được vì có METRICS_TOKEN + bảo vệ mạng.

**Security:**
- csrfGuard so khớp Origin bằng equality với ALLOWED_ORIGINS đã chuẩn hóa lowercase — tốt. Tuy nhiên ALLOWED_ORIGINS chỉ thêm APP_BASE_URL.toLowerCase() (dòng 49) mà KHÔNG strip trailing slash như nhánh CORS_ORIGINS (dòng 52); config.js đã strip trailing slash của APP_BASE_URL (dòng 105) nên thực tế an toàn, nhưng phụ thuộc ngầm vào config — nên strip lại tại chỗ cho phòng thủ.
- session cookie secure=isProd, httpOnly, sameSite=lax — đúng. sameSite=lax + csrfGuard là phòng thủ kép, tốt.
- CSP style-src vẫn còn 'unsafe-inline' (dòng 101) — đã ghi chú lý do (SPA dùng style inline); là rủi ro XSS tồn dư đã biết, không phải lỗi mới.

**Performance:**
- compression.filter gọi res.getHeader('Content-Type') tại request-time khi CT có thể chưa set (dòng 124) — đã xử lý đúng bằng cách check req.path và Accept trước; không phải vấn đề.
- enforceActiveUser (mount dòng 199) query DB trên MỖI request /api/ cho user session-cookie — cần thiết cho RBAC realtime nhưng là 1 round-trip DB/request; cân nhắc cache ngắn (vài giây) nếu tải cao.

**Refactor:**
- Tại dòng 49 thêm .replace(/\/+$/, '') cho APP_BASE_URL để khớp logic chuẩn hóa của CORS_ORIGINS, loại bỏ phụ thuộc ngầm vào config.js.
- Danh sách 20+ import route + 20+ app.use lặp pattern — có thể gom thành mảng [{path, router}] và forEach để giảm trùng lặp và dễ audit thứ tự mount.
- Trích csrfGuard và ALLOWED_ORIGINS ra module riêng (vd security/csrf.js) để app.js gọn và test đơn vị được guard độc lập.

Scores → Quality 88 · Security 90 · Maintainability 84 · Enterprise 86

---

### `src/server.js`  — Clean Code 84/100
**Mục đích:** Entrypoint xử lý mức process: init Sentry, listen HTTP, sweep hết hạn quote định kỳ (có audit), và graceful shutdown.

**Issues:**
- expireStaleQuotes (dòng 19-41): updateMany rồi ghi audit trong vòng lặp KHÔNG nằm trong transaction — nếu process crash giữa chừng, quote đã đổi status nhưng thiếu AuditEvent (audit trail không nhất quán). Với sweep nền thì rủi ro thấp nhưng nên bọc trong prisma.$transaction.
- Vòng lặp audit tuần tự (dòng 31-36) await từng cái; với lô lớn quote hết hạn sẽ chậm — chấp nhận được cho job 6h nhưng có thể Promise.all theo batch.
- unhandledRejection/uncaughtException chỉ log mà KHÔNG thoát process (dòng 61-62) — theo khuyến nghị Node, uncaughtException nên dẫn tới shutdown có kiểm soát vì state có thể đã hỏng; hiện tại process tiếp tục chạy ở trạng thái không xác định.
- Race nhỏ: nếu interval và lần chạy boot (dòng 43-44) chồng lấn khi sweep chạy lâu hơn dự kiến thì có thể chạy song song hai lần — sweep idempotent (validUntil<now) nên hậu quả thấp, nhưng có thể double-audit cùng quote trong cửa sổ hiếm.

**Performance:**
- Audit ghi tuần tự trong vòng lặp (dòng 31-36) — N+1 ghi DB; với lô lớn nên gộp createMany hoặc transaction batch.
- Mỗi lần sweep không phân trang findMany (dòng 22) — nếu tích lũy rất nhiều quote quá hạn (vd sau downtime dài) sẽ nạp toàn bộ id vào bộ nhớ; thực tế ít xảy ra.

**Refactor:**
- Bọc updateMany + các audit vào một prisma.$transaction để đảm bảo tính nhất quán audit↔status.
- Cân nhắc thoát có kiểm soát trong uncaughtException (gọi shutdown thay vì chỉ log), giữ unhandledRejection ở mức log nếu muốn khoan dung.
- Đưa expireStaleQuotes ra module jobs riêng (vd jobs/expireQuotes.js) để server.js chỉ còn lo vòng đời process — đồng nhất với triết lý tách app.js/server.js đã có.
- Thêm cờ 'đang chạy' (mutex boolean) để tránh sweep chồng lấn giữa boot-run và interval.

Scores → Quality 83 · Security 90 · Maintainability 85 · Enterprise 83

---

### `src/config.js`  — Clean Code 85/100
**Mục đích:** Xác thực và chuẩn hóa biến môi trường bằng Zod, ép buộc các yêu cầu bảo mật (SESSION_SECRET/JWT_SECRET/APP_BASE_URL) ở môi trường production.

**Issues:**
- Dòng 8: schema SESSION_SECRET = `.min(32).or(z.string().min(1))` thực chất cho phép MỌI chuỗi không rỗng ở tầng schema; thông điệp lỗi '≥ 32 chars in production' gây hiểu nhầm. Việc ép buộc thật nằm ở dòng 72-80 (đúng về mặt chức năng nhưng schema/message mâu thuẫn).
- Dòng 90: truy cập `config.JWT_SECRET.length` chỉ an toàn vì dòng 86 đã kiểm `process.env.JWT_SECRET` tồn tại; nếu JWT_SECRET được set nhưng < 16 ký tự thì Zod đã chặn trước (min(16)) nên không crash — logic ổn nhưng phụ thuộc ngầm, khó đọc.
- Dòng 42: `S3_FORCE_PATH_STYLE: z.coerce.boolean()` — z.coerce.boolean ép 'false' (chuỗi) thành true (chuỗi không rỗng = truthy); nếu ai đó đặt S3_FORCE_PATH_STYLE=false sẽ vẫn ra true. Cần parse thủ công ('false'/'0' → false).

**Security:**
- Không có lỗ hổng nghiêm trọng: production ép SESSION_SECRET ≥32, JWT_SECRET riêng biệt ≥32 và khác SESSION_SECRET, APP_BASE_URL bắt buộc (chống poison reset link). MFA_ENC_KEY chỉ min(16) — nên nâng khuyến nghị ≥32 cho AES-256-GCM (dòng 56) dù key được dẫn xuất hash.

**Refactor:**
- Thay z.coerce.boolean() ở S3_FORCE_PATH_STYLE bằng z.enum(['true','false']).transform hoặc preprocess để tránh bẫy 'false'→true.
- Làm rõ schema SESSION_SECRET: dùng một validation thống nhất theo NODE_ENV (superRefine) thay vì .or() gây hiểu nhầm rồi kiểm lại ở cuối file.
- Gom các khối kiểm tra production (dòng 72-103) vào một hàm assertProdSecrets() để dễ test.

Scores → Quality 86 · Security 90 · Maintainability 85 · Enterprise 84

---

### `src/db.js`  — Clean Code 80/100
**Mục đích:** Khởi tạo PrismaClient, cài middleware soft-delete toàn cục (delete→update deletedAt, auto-filter deletedAt:null) và phát realtime change feed qua SSE.

**Issues:**
- Dòng 6-9: ternary `isProd ? [...] : [...]` có HAI nhánh GIỐNG HỆT NHAU — dead code, ternary vô nghĩa; nên rút gọn thành một mảng.
- Dòng 26-39: khi action='deleteMany' đổi thành 'updateMany' nhưng KHÔNG kèm filter deletedAt:null trong where → một soft-delete hàng loạt có thể 'xóa lại' (set deletedAt mới) các bản ghi đã xóa trước, ghi đè timestamp gốc (thường vô hại nhưng làm sai lịch sử/purge-by-age).
- Dòng 80-90: middleware realtime bọc MỌI write của Quote/Customer/User; với createMany/updateMany, `result` là {count} không có `id` → emitChange phát id=undefined (client phải refetch toàn bộ). Chấp nhận được nhưng nên ghi chú.
- $use là API middleware Prisma đã bị deprecate (khuyến nghị chuyển sang Client Extensions $extends ở Prisma 5+); vẫn chạy trên 5.22 nhưng là nợ kỹ thuật cho lần nâng cấp tới.

**Security:**
- Soft-delete dựa vào caller truyền `hardDelete:true`/`includeDeleted:true` ở top-level args; cờ được strip an toàn (dòng 62-69) nên không rò sang Prisma. Rủi ro: nếu input người dùng được spread thẳng vào args (ở route khác) có thể bị inject `includeDeleted`/`hardDelete` để lách soft-delete — cần đảm bảo các route không spread req.body vào args (kiểm ở tầng route, không phải file này).

**Performance:**
- Dòng 85: import('./sse.js') động được gọi cho mỗi write — Node cache module nên chi phí gần như chỉ là 1 promise; chấp nhận được nhưng có thể cache reference emitChange sau lần đầu để bỏ overhead .then mỗi lần.

**Refactor:**
- Bỏ ternary trùng lặp ở log config (dòng 6-9) → một mảng [{warn},{error}].
- Thêm `where.deletedAt` filter cho nhánh deleteMany→updateMany để không ghi đè bản ghi đã xóa.
- Cache emitChange sau lần import đầu tiên (module-level let) để tránh tạo promise mỗi write.
- Lên kế hoạch migrate $use → prisma.$extends({ query }) khi nâng Prisma.

Scores → Quality 80 · Security 84 · Maintainability 78 · Enterprise 80

---

### `src/middleware.js`  — Clean Code 88/100
**Mục đích:** Tập hợp middleware Express: requestId, xác thực Bearer JWT, requireAuth/requireRole, enforceActiveUser (reload trạng thái tài khoản), asyncHandler, notFound và errorHandler ánh xạ lỗi Prisma/Multer.

**Issues:**
- Dòng 6-9 requestId: tin tưởng header `x-request-id` do client gửi mà không sanitize/giới hạn độ dài — client có thể đưa chuỗi rất dài hoặc ký tự lạ làm bẩn log/header phản hồi. Nên giới hạn độ dài và charset (hoặc chỉ chấp nhận khi đứng sau proxy tin cậy).
- Dòng 83: `req.baseUrl + (req.route?.path || '')` (lưu ý: đây là observability) — không áp dụng ở file này.
- enforceActiveUser (dòng 71-91) và bearerAuth (dòng 26-29) đều SELECT user mỗi request — đúng về bảo mật nhưng tạo 1 truy vấn DB/request cho mọi /api/* (xem perf).

**Security:**
- Đây là điểm mạnh: bearerAuth (dòng 22-32) và enforceActiveUser (dòng 71-91) đều reload role/active/lockedUntil từ DB, KHÔNG tin claim trong token → lock/ban/demote có hiệu lực ngay (trong TTL). Đúng chuẩn.
- errorHandler (dòng 126,139): chỉ lộ message khi status<500, còn 500 trả 'Lỗi server' generic — không rò stack/PII ra client. Tốt.
- Nhỏ: requireRole không phân biệt 'chưa đăng nhập' đã được xử lý nhưng nếu req.session.role bị undefined (token hợp lệ nhưng enforce chưa chạy) sẽ trả 403 thay vì 401 — chỉ ảnh hưởng thông điệp, không phải lỗ hổng.

**Performance:**
- Mỗi request /api/* tốn 1 query user (enforceActiveUser hoặc bearerAuth) — với app nội bộ là chấp nhận được, nhưng có thể cache ngắn (vd 5-10s theo userId) để giảm tải DB cho route đọc nhiều.

**Refactor:**
- Sanitize/giới hạn x-request-id (regex ^[\w-]{1,128}$, fallback randomUUID) để tránh log injection.
- Gộp logic 'reload user + reject locked/inactive' của bearerAuth và enforceActiveUser vào một helper dùng chung để tránh trùng lặp tiêu chí kiểm tra (active/lockedUntil).
- Cân nhắc trả 401 thay 403 khi role undefined để thông điệp chính xác hơn.

Scores → Quality 88 · Security 92 · Maintainability 87 · Enterprise 88

---

### `src/logger.js`  — Clean Code 86/100
**Mục đích:** Cấu hình logger Pino với redaction các trường nhạy cảm (cookie, authorization, password*) và pretty-print ở môi trường dev.

**Issues:**
- Đọc trực tiếp process.env.NODE_ENV/LOG_LEVEL thay vì import từ config.js đã validate — nguy cơ lệch nguồn cấu hình (config.js có thể default LOG_LEVEL khác). Có lý do hợp lệ: logger phải nạp được TRƯỚC config (config.js không import logger, nhưng db.js/observability.js import cả hai) — tránh vòng phụ thuộc. Nên ghi chú rõ điều này.

**Security:**
- Redact paths phủ cookie, authorization và *.password/*.passwordHash/*.newPassword/*.oldPassword với remove:true — tốt. Cân nhắc bổ sung các đường dẫn nhạy cảm khác có thể xuất hiện trong log: *.token, *.refreshToken, *.secret, *.otp, *.mfaSecret, *.resetToken, req.body.password (Pino redact dùng wildcard 1 cấp '*.password' KHÔNG bắt được req.body.password lồng sâu — cần thêm 'req.body.password' hoặc dùng '**.password' nếu phiên bản hỗ trợ).

**Refactor:**
- Mở rộng danh sách redact: thêm '*.token','*.refreshToken','*.accessToken','*.secret','*.otp','*.mfaSecret','*.resetToken' và đường dẫn lồng cho password (vd 'req.body.password','*.user.password').
- Thêm comment giải thích vì sao đọc process.env trực tiếp (tránh circular import với config).

Scores → Quality 85 · Security 84 · Maintainability 86 · Enterprise 84

---

### `src/observability.js`  — Clean Code 82/100
**Mục đích:** Tích hợp Sentry (capture lỗi, strip cookie/auth) và Prometheus (registry, counters/histogram/gauge, middleware đo latency); no-op khi thiếu env.

**Issues:**
- Dòng 83: nhãn `route` = `req.route?.path || req.baseUrl + (req.route?.path || '') || 'unknown'` — với request KHÔNG khớp route (404, file tĩnh, hoặc URL có path-param chưa được Express chuẩn hóa), nhãn có thể lấy req.baseUrl thô gây CARDINALITY EXPLOSION trong Prometheus (mỗi URL khác nhau = 1 time series). Cần fallback 'unknown'/'unmatched' chứ không phải URL thô.
- Dòng 16-17: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0.1) — nếu env là chuỗi không phải số sẽ ra NaN làm Sentry hiểu là 0/lỗi; nên parse + clamp [0,1].
- metricsMiddleware mount bằng app.use toàn cục (app.js:181) trước router — req.route chỉ có giá trị tại thời điểm 'finish' (sau handler), nên với route khớp thì OK; rủi ro chỉ ở route KHÔNG khớp.

**Security:**
- beforeSend (dòng 18-25) xóa cookie + authorization khỏi event Sentry — tốt. Lưu ý không strip body/query có thể chứa token (vd ?token= trong reset link); cân nhắc lọc thêm.
- /metrics token check (app.js:186) dùng so sánh chuỗi `!==` không hằng-thời-gian (timing). Mức rủi ro thấp (sau network policy + nội bộ) nhưng nên dùng crypto.timingSafeEqual.

**Performance:**
- Cardinality của nhãn route (dòng 83) là vấn đề perf/ổn định Prometheus chính: URL thô làm phình số time series, tốn bộ nhớ exporter và làm chậm scrape. Phải chuẩn hóa nhãn route về tập hữu hạn.

**Refactor:**
- Sửa dòng 83: route = req.route?.path ? (req.baseUrl + req.route.path) : 'unmatched'; loại bỏ nhánh ghép req.baseUrl khi không có route.path.
- Clamp tracesSampleRate/profilesSampleRate về [0,1] và xử lý NaN.
- Strip thêm query string nhạy cảm trong Sentry beforeSend (token/secret) và cân nhắc đặt sendDefaultPii:false.
- Dùng crypto.timingSafeEqual cho việc so sánh METRICS_TOKEN (ở app.js).

Scores → Quality 82 · Security 85 · Maintainability 83 · Enterprise 82

---

### `C:\Users\Admin\Desktop\QuanLY\src\authCore.js`  — Clean Code 88/100
**Mục đích:** Xác thực thông tin đăng nhập dùng chung cho cả luồng cookie-session (/login) và JWT (/token), gồm lockout, MFA và telemetry.

**Issues:**
- Chuỗi thao tác login (increment failedAttempts, lock, reset counters) gồm nhiều prisma.update riêng lẻ không bọc trong $transaction — nếu lỗi giữa chừng (vd increment thành công nhưng set lockedUntil fail) trạng thái sẽ không nhất quán; tuy hiếm nhưng nên gom bằng transaction.
- Khi MFA backup code đúng nhưng updateMany trả count=0 (race: code đã bị tiêu thụ song song), reason audit ghi 'bad_mfa' (dòng 100-103) — hơi gây nhầm lẫn khi điều tra (thực ra là single-use race chứ không phải mã sai), nên phân biệt reason.
- consumeBackupCode (dòng 88) được gọi rồi mới updateMany — phần khớp được tính 2 lần (1 lần trong consumeBackupCode để lấy hit.matched, 1 lần qua guard has). Đúng về logic nhưng có thể thêm comment rõ rằng hit.matched là entry gốc (hash hoặc plaintext) để guard chính xác.

**Security:**
- lastLoginIp lấy từ X-Forwarded-For (clientIp dòng 19-21) — chỉ đáng tin nếu app chạy sau reverse proxy đã set 'trust proxy' và strip header từ client; nếu không, IP audit có thể bị giả mạo. Với tool nội bộ sau Cloudflare Tunnel thì chấp nhận được nhưng nên xác nhận trust proxy được cấu hình.

**Performance:**
- Trường hợp khóa tài khoản thực thi 2 lần prisma.user.update tuần tự (dòng 57 và 64) — có thể gộp thành 1 update tính lockedUntil ngay khi increment, giảm 1 round-trip DB ở đường thất bại.

**Refactor:**
- Bọc các bước cập nhật trạng thái lockout/reset bằng prisma.$transaction để đảm bảo nguyên tử và giảm round-trip.
- Tách reason 'mfa_backup_race' khỏi 'bad_mfa' để telemetry chính xác hơn.
- Cân nhắc trích MFA verify thành helper riêng (verifyMfa(user, mfaToken)) để hàm authenticateCredentials ngắn hơn và dễ test đơn vị.

Scores → Quality 88 · Security 90 · Maintainability 85 · Enterprise 86

---

### `C:\Users\Admin\Desktop\QuanLY\src\jwt.js`  — Clean Code 84/100
**Mục đích:** Chiến lược access token (JWT HS256 ngắn hạn) + refresh token (opaque, lưu hash, có rotation và phát hiện replay theo family).

**Issues:**
- ttlSeconds (dòng 16-23) được định nghĩa nhưng KHÔNG dùng ở đâu (đã grep toàn src) — dead code, nên xóa hoặc dùng để tính expiresAt nhất quán như comment gợi ý.
- rotateRefreshToken: kiểm tra user.active (dòng 89-91) diễn ra SAU khi đã revoke token cũ và issue token mới (dòng 86-87) → nếu user bị deactivate, token cũ đã bị burn và token mới đã được tạo trong DB rồi mới throw; tuy không trả token mới ra ngoài nhưng để lại refreshToken 'rác' active trong DB cho user đã khóa. Nên check user.active TRƯỚC khi rotate.
- Toàn bộ chuỗi rotate (find → revoke cũ → issue mới → check user) không nằm trong $transaction; giữa revoke và issue nếu lỗi sẽ làm mất refresh token của user (không còn token hợp lệ, phải đăng nhập lại) — không phải lỗ hổng nhưng ảnh hưởng UX/độ bền.

**Security:**
- JWT_SECRET fallback về SESSION_SECRET khi không set (config.js dòng 97) — ở production config.js đã chặn (dòng 86-91), nên chấp nhận; chỉ là rủi ro nếu ai đó chạy 'NODE_ENV!=production' trên server thật.
- Refresh token rotation/replay-family-revoke đã đúng chuẩn; access token đã pin algorithms HS256 + issuer/audience (dòng 39-43) — tốt. Không có lỗ hổng còn lại đáng kể.

**Performance:**
- RefreshToken lookup theo tokenHash (findUnique) — đảm bảo cột tokenHash có unique index (cần thiết cho findUnique); nếu chưa có sẽ là full scan. Kiểm tra schema (ngoài file này).

**Refactor:**
- Xóa hàm ttlSeconds chết hoặc thực sự dùng nó để tính JWT_REFRESH_TTL thay vì hằng số 86400_000 hardcode (dòng 54).
- Di chuyển kiểm tra user.active lên trước bước revoke/issue trong rotateRefreshToken.
- Bọc rotate trong prisma.$transaction (revoke cũ + issue mới) để tránh trạng thái mất token nửa chừng.
- Trích các Error có status thành một helper authError(status, msg) để giảm lặp Object.assign.

Scores → Quality 85 · Security 88 · Maintainability 84 · Enterprise 85

---

### `C:\Users\Admin\Desktop\QuanLY\src\mfa.js`  — Clean Code 89/100
**Mục đích:** Mã hóa secret TOTP (AES-256-GCM) và băm backup code (SHA-256) khi lưu, kèm tương thích ngược với dữ liệu plaintext cũ.

**Issues:**
- decryptSecret fail-closed trả null khi key sai/corrupt (dòng 53-56) — hợp lý, nhưng caller authCore truyền null vào speakeasy.totp.verify({secret:null}) → speakeasy có thể throw hoặc verify=false; hành vi hiện là verify trả false (an toàn) nhưng nên xác nhận và có comment để tránh regress.
- eq() (dòng 67-69) tạo Buffer.from(a) rồi mới so độ dài — nếu a/b không phải chuỗi base/hex hợp lệ vẫn ok vì chỉ so byte; không vấn đề logic.

**Security:**
- Backup code so sánh nhánh plaintext (entry.length!==64, dòng 84) dùng eq(entry.toUpperCase(), code) — vẫn timing-safe qua timingSafeEqual; nhưng có nhánh length-check sớm (ba.length===bb.length) làm lộ thông tin độ dài (không đáng kể với backup code cố định 10 ký tự).
- MFA_ENC_KEY không set → secret TOTP lưu PLAINTEXT (dòng 24-27), chỉ cảnh báo log một lần. Đây là quyết định tương thích ngược có chủ đích, nhưng với production thực sự nên ép buộc (config.js để optional). Khuyến nghị nâng thành lỗi cứng ở production giống JWT_SECRET.
- encryptSecret dùng IV ngẫu nhiên 12 byte + GCM tag — đúng chuẩn. Khóa derive bằng SHA-256(MFA_ENC_KEY) (dòng 17) chấp nhận được cho tool nội bộ (lý tưởng dùng HKDF/scrypt nhưng không bắt buộc).

**Refactor:**
- Thêm validation ở config production buộc MFA_ENC_KEY phải set (song song với JWT_SECRET) để loại bỏ đường plaintext silent.
- consumeBackupCode: cân nhắc dùng hằng prefix length thay 'magic numbers' 64/10 (đặt HASH_HEX_LEN, LEGACY_CODE_LEN) cho rõ nghĩa (dòng 83-84).
- Có thể derive khóa bằng scrypt/HKDF thay SHA-256 thuần nếu muốn nâng cấp về sau.

Scores → Quality 89 · Security 87 · Maintainability 90 · Enterprise 87

---

### `C:\Users\Admin\Desktop\QuanLY\src\sessions.js`  — Clean Code 83/100
**Mục đích:** Hủy toàn bộ cookie session (connect-pg-simple) của một user khi đổi/đặt lại mật khẩu, có thể giữ lại session hiện tại của caller.

**Issues:**
- keepSid mặc định null → khi không truyền, điều kiện 'sid <> ""' (dòng 16) luôn đúng nên xóa hết session kể cả của caller; đây là hành vi mong muốn khi gọi không kèm keepSid, nhưng comment nên nêu rõ rằng null = xóa tất cả.
- $executeRaw truy vấn cột JSON 'sess ->> userId' cast ::int — phụ thuộc cấu trúc session lưu userId là số; nếu userId là chuỗi/UUID cast ::int sẽ throw và bị nuốt vào catch, khiến session KHÔNG bị hủy mà chỉ log error → đây là security control im lặng thất bại. Cần xác nhận kiểu userId khớp schema.
- Lỗi chỉ log chứ không re-throw (dòng 17-21); nếu việc hủy session là bắt buộc bảo mật, caller (đổi mật khẩu) sẽ nghĩ là thành công dù session cũ vẫn sống. Cân nhắc trả về số rows đã xóa hoặc ném lỗi để caller biết.

**Security:**
- Fail-soft (chỉ log) trên một security control: nếu DELETE thất bại (vd cast lỗi, bảng thiếu), session bị đánh cắp vẫn tồn tại sau khi đổi mật khẩu mà không ai biết. Khuyến nghị trả kết quả/đếm rows để caller có thể cảnh báo hoặc chặn.
- Tên bảng/cột user_sessions và 'sess' được hardcode — đúng với connect-pg-simple; tham số hóa qua $executeRaw template (an toàn injection).

**Performance:**
- DELETE dùng biểu thức (sess ->> 'userId')::int trên mọi hàng → không dùng index, full scan bảng session. Với lượng session nhỏ của tool nội bộ thì không sao; nếu cần, thêm functional index trên (sess ->> 'userId').

**Refactor:**
- Trả về result.count (số session đã hủy) thay vì void để caller xác minh control thực thi.
- Bổ sung comment làm rõ keepSid=null nghĩa là xóa toàn bộ.
- Xác nhận kiểu dữ liệu userId trong session JSON để cast ::int không âm thầm fail; nếu là chuỗi, bỏ ::int và so sánh text.

Scores → Quality 82 · Security 80 · Maintainability 86 · Enterprise 82

---

### `src/permissions.js`  — Clean Code 90/100
**Mục đích:** Hệ thống RBAC tập trung: danh mục quyền, ánh xạ vai trò→quyền, và các helper kiểm tra quyền (can/canOnQuote/quoteScopeWhere/canScoped) + middleware requirePermission.

**Issues:**
- canOnQuote (dòng 162) đọc session.userId mà không kiểm tra null; nếu gọi với session không có userId thì so sánh quote.createdById === undefined có thể cho false an toàn, nhưng nên guard rõ ràng để tránh phụ thuộc ngầm vào middleware xác thực phía trên.
- QUOTE_MEMBER_ACTIONS (dòng 155) bao gồm 'submit' nhưng comment dòng 154 nói 'view + edit + submit' — nhất quán; tuy nhiên member được quyền 'update' đầy đủ giống chủ sở hữu, đây là quyết định nghiệp vụ cần đảm bảo đúng ý (member có thể sửa báo giá của người khác).
- permissionsForRole và roleCan có logic mở rộng :all→:own lặp lại ở 3 chỗ (roleCan dòng 138-140, permissionsForRole dòng 209-211); nên trích xuất 1 helper expandOwn() để tránh phân kỳ về sau.

**Security:**
- requirePermission kiểm tra 401 trước 403 đúng chuẩn; không phát hiện lỗ hổng. Lưu ý: canOnQuote dựa vào quote.members được nạp đầy đủ — nếu route quên include members thì sẽ từ chối nhầm (fail-closed, an toàn).

**Performance:**
- ROLE_PERMISSIONS dùng Set nên tra cứu O(1) — tốt. quoteScopeWhere tạo mảng OR mỗi lần gọi nhưng không đáng kể.

**Refactor:**
- Trích helper expandOwnPermissions(set) dùng chung cho roleCan và permissionsForRole.
- Thêm guard `if (session?.userId == null) return false` đầu canOnQuote và canScoped để rõ ràng fail-closed.
- Cân nhắc đóng băng (Object.freeze) PERMISSIONS và ROLE_PERMISSIONS để tránh sửa runtime.

Scores → Quality 90 · Security 92 · Maintainability 88 · Enterprise 87

---

### `src/validators.js`  — Clean Code 88/100
**Mục đích:** Định nghĩa toàn bộ schema Zod (login, user, quote create/update, list query, logo base64) và middleware validate() để parse + thay thế req.body/query/params.

**Issues:**
- senderName dùng lại schema `title` (dòng 45) — đúng về giới hạn (max 120, trim) nhưng tên biến gây hiểu nhầm; nên đặt schema riêng `senderName` cho rõ ngữ nghĩa.
- itemSchema.label giới hạn max(12) (dòng 85) khá nhỏ và không có comment giải thích (có lẽ là nhãn STT/ký hiệu) — nên ghi chú lý do.
- QuoteCreateSchema.toEmail (dòng 110) chỉ giới hạn độ dài, không validate định dạng email (.email()) — chấp nhận chuỗi rác; nếu chủ ý cho phép nhập tự do thì ổn, nhưng nên thống nhất với UserInviteSchema vốn dùng .email().
- validate() ghi đè req.query bằng object đã parse (dòng 188) — trên Express 5 req.query là getter chỉ-đọc, gán trực tiếp sẽ throw; cần xác nhận đang dùng Express 4. Nếu nâng cấp Express 5 đây là bug.
- discount giới hạn max 1e12 trùng với quantity/unitPrice; hợp lý nhưng không có ràng buộc discount ≤ tổng tại tầng schema (được clamp ở money.js — chấp nhận được).

**Security:**
- customerLogoSchema (dòng 75-80) đã neo regex toàn chuỗi base64 ^data:image/...;base64,[A-Za-z0-9+/]+={0,2}$ chặn markup chèn vào <img src> (chống stored XSS) — đã được vá đúng, không còn lỗ hổng.
- username regex (dòng 16) allowlist ký tự an toàn; password yêu cầu chữ+số. Không phát hiện vấn đề.
- Giới hạn độ dài rõ ràng trên mọi field giúp chống payload bom — tốt. customerLogo cap ~3.5MB hợp lý.

**Performance:**
- Regex base64 chạy trên chuỗi tới ~3.5MB mỗi request có logo — chi phí O(n) tuyến tính, chấp nhận được nhưng là điểm cần lưu ý nếu nhiều request đồng thời; có thể kiểm tra prefix + độ dài bội số 4 trước khi chạy full regex.

**Refactor:**
- Tạo schema email dùng chung (z.string().email().max(...)) và áp cho toEmail nếu muốn validate định dạng.
- Đặt schema riêng senderName thay vì alias `title`.
- Bọc validate() để chỉ gán lại req.query qua Object.defineProperty hoặc dùng res.locals nhằm tương thích Express 5 sau này.
- Trích các magic number (3_500_000, 1e12, 2015) thành hằng số đặt tên trong config.

Scores → Quality 88 · Security 93 · Maintainability 86 · Enterprise 86

---

### `src/money.js`  — Clean Code 89/100
**Mục đích:** Tiện ích tiền tệ dùng Prisma.Decimal: helper D() ép kiểu an toàn, computeQuoteTotals() tính lại subtotal/VAT/discount/total theo sheet, và totalsToJson() chuyển Decimal sang số cho JSON.

**Issues:**
- Biến mult (dòng 30-32) là trạng thái cuốn theo: một dòng 'section' đặt mult và áp cho mọi item phía sau cho đến section kế tiếp. Đúng ý đồ 'nhóm', nhưng nếu sheet có item trước section đầu tiên thì các item đó dùng mult=1 (đúng), còn nếu mong muốn mỗi section chỉ nhân item con của riêng nó thì logic 'cuốn đến hết sheet' có thể gây nhân nhầm khi trộn item ngoài nhóm sau một section — cần test trường hợp section nằm giữa sheet.
- Dòng 52: discount = discInput.greaterThan(gross) ? gross : (discInput.lessThan(0) ? 0 : discInput). discInput đã được làm tròn nhưng không bị chặn âm trước đó; nhánh xử lý âm đúng, song schema (validators) đã chặn discount ≥ 0 nên nhánh lessThan(0) gần như chết — vô hại, chỉ thừa.
- computeQuoteTotals giả định quote.vatPercent/discount tồn tại; D() xử lý null an toàn nên ổn, nhưng quote.sheets/items thiếu sẽ trả subtotal 0 (fail-safe).
- Số ngày (days) khi = 0 được coi như null (qty×price) nhờ days.gt(0) — đúng với comment, nhưng days âm về lý thuyết qua schema (nonnegative) bị chặn; an toàn.

**Performance:**
- Dùng Decimal cho mọi phép tính là chính xác nhưng nặng hơn số thường; với báo giá ≤20 sheet × ≤500 item (tối đa ~10k phép tính Decimal) vẫn chấp nhận được. Không cần tối ưu.
- totalsToJson dùng toNumber() có thể mất chính xác khi tổng vượt 2^53 (đã ghi chú); với VND tổng lớn (hàng nghìn tỷ) về lý thuyết có rủi ro hiển thị — nên cân nhắc trả chuỗi cho field total nếu cần độ chính xác tuyệt đối ở UI.

**Refactor:**
- Bỏ nhánh discInput.lessThan(0) (dòng 52) hoặc thay bằng Decimal.max(0, Decimal.min(gross, discInput)) cho gọn và rõ ý 'clamp [0, gross]'.
- Tách logic 'section multiplier' ra hàm/đối tượng có chú thích để dễ kiểm thử, hoặc reset mult về 1 một cách tường minh khi kết thúc một nhóm nếu nghiệp vụ yêu cầu.
- Cân nhắc trả total/subtotal dạng string trong totalsToJson cho client xử lý số lớn (Intl/BigInt) nếu giá trị có thể rất lớn.

Scores → Quality 89 · Security 95 · Maintainability 87 · Enterprise 88

---

### `C:\Users\Admin\Desktop\QuanLY\src\routes\quotes.routes.js`  — Clean Code 84/100
**Mục đích:** Router CRUD + vòng đời báo giá (tạo/sửa/xóa mềm, trình duyệt/duyệt/từ chối, gửi, chốt/thua, version, thành viên, nhân bản) với RBAC theo phạm vi và snapshot tổng tiền.

**Issues:**
- duplicate (L864-954): cấp quoteNumber/projectCode (L880, L893) NGOÀI transaction rồi mới create đơn lẻ — nếu create lỗi (vd P2002) thì số đã cấp bị 'cháy'/tạo gap. Route CREATE (L343-359) đã sửa bằng transaction + retry P2002 nhưng duplicate KHÔNG được áp dụng cùng cách. Nên bọc nextQuoteNumber + create trong $transaction và retry P2002.
- duplicate (L883-890): với sameProject=false vẫn đặt title '... (copy)' nhưng không có cờ status hợp lệ khác; với sameProject=true tính newVersion qua aggregate projectVersion nhưng aggregate KHÔNG dùng includeDeleted nên báo giá đã xóa mềm cùng projectCode không tính → có thể trùng projectVersion với bản đã xóa (lỗi tiềm ẩn nếu có ràng buộc unique trên (projectCode, projectVersion)).
- duplicate (L880, L893): không kiểm tra template còn active/thuộc company như CREATE/UPDATE (templatesBelongToCompany) — nếu template nguồn đã ngừng dùng, bản sao vẫn tham chiếu templateId cũ.
- mark-lost (L725-746): KHÔNG cho phép đánh dấu 'thua' khi status='converted' (đúng) nhưng cho phép ở mọi trạng thái khác kể cả 'draft'/'pending' — báo giá đang chờ duyệt có thể bị nhảy thẳng sang 'lost', để lại Approval row pending mồ côi (không dọn như reject). Nên giới hạn trạng thái nguồn và/hoặc dọn approval pending.
- next-number (L209-228): chỉ là preview, giá trị có thể lệch với số thực cấp khi lưu (đã ghi chú trong response 'Số thực sẽ cấp khi lưu') — không phải bug nhưng client phải hiểu rõ.
- UPDATE reopened (L431-434): khi quay về draft đã clear approvedById nhưng KHÔNG dọn các Approval row pending của version cũ; submit sau đó gọi startApprovalChain (deleteMany theo quoteId+versionNo mới) nên thường ổn, song nếu versionNo không đổi (currentVersion chỉ tăng khi priceAffecting) có thể còn row cũ — cần xác nhận startApprovalChain dùng đúng versionNo mới.

**Security:**
- mark-lost (L725-746) KHÔNG có requirePermission cấp workflow như mark-converted (yêu cầu QUOTE_SEND, L701). Chỉ dựa canOnQuote(update) → một employee là member có thể đánh dấu 'lost' báo giá ĐÃ duyệt/đã gửi. 'lost' là trạng thái terminal ảnh hưởng báo cáo win/loss → bất đối xứng quyền so với mark-converted. Nên yêu cầu quyền tương đương hoặc giới hạn theo trạng thái.
- presentQuote dùng QUOTE_INCLUDE (L67) trả members kèm username trong mọi response chi tiết (get-one/approve/reject/send/convert/duplicate) — lộ login identifier nội bộ; mâu thuẫn với assignable-users (L238) cố tình giấu username. Chấp nhận được cho tool nội bộ nhưng nên đồng bộ (bỏ username khỏi members khi trả ra ngoài).
- approve self-approve override (L562-565): admin được tự duyệt báo giá mình tạo (có ghi audit selfApproved). Đây là chủ ý (segregation of duties với cửa thoát admin) — chấp nhận cho single-tenant.

**Performance:**
- GET '/:id', UPDATE, submit, approve, reject, send, convert, lost, duplicate đều dùng QUOTE_INCLUDE nặng (company + customer + tất cả sheets + items + template mỗi sheet + 3 quan hệ user). Với báo giá nhiều sheet/dòng, payload lớn và load sâu trên mọi mutation. List view đã tối ưu (QUOTE_LIST_SELECT slim, L101) — tốt; nhưng các mutation re-fetch full include 2 lần ở approve/reject (update trong tx rồi findFirst lại L602/L653).
- approve/reject: nextPendingLevel + hasEarlierPending + canApproveLevel là các query tuần tự NGOÀI transaction trước khi vào tx (L567-574) → vài round-trip thêm; chấp nhận được vì tải thấp.
- templatesBelongToCompany chạy 1 query findMany cho mỗi CREATE/UPDATE có sheets — hợp lý.

**Refactor:**
- Bọc duplicate trong $transaction giống CREATE: cấp nextQuoteNumber + nextProjectCode + create + snapshotQuoteVersion atomically, retry P2002 khi số tự cấp trùng. Hiện duplicate cũng KHÔNG gọi snapshotQuoteVersion → bản sao mới thiếu version 'create' ban đầu (CREATE có gọi L349).
- Trích một helper terminalStateGuard(existing, allowedFrom[]) dùng chung cho submit/approve/reject/send/convert/lost thay vì lặp lại kiểm tra status + thông báo lỗi.
- send (L685), mark-converted (L713), mark-lost (L738) nên dùng updateMany với điều kiện status nguồn (như approve/reject) để có optimistic guard chống TOCTOU thay vì check-then-update không atomic.
- Gom logic re-serialize Decimal (presentQuote/presentQuoteRow) — buildSheetsCreate trùng lặp giữa CREATE/UPDATE (qua helper, tốt) và duplicate (L927-947, copy thủ công khác chuẩn hóa). Cho duplicate dùng lại buildSheetsCreate để đồng nhất sanitize (slice label 12, normalize \r\n).
- Tách versionNo dùng trong startApprovalChain/Approval khỏi currentVersion một cách rõ ràng, ghi chú bất biến (cosmetic edit giữ versionNo) thành hằng/JSDoc tập trung để tránh hiểu nhầm tương lai.

Scores → Quality 83 · Security 80 · Maintainability 82 · Enterprise 80

---

### `src/quoteNumber.js`  — Clean Code 86/100
**Mục đích:** Cấp số báo giá (GN26001) và mã dự án theo nhân viên (FE_A26_001) bằng counter nguyên tử qua upsert+increment.

**Issues:**
- nextProjectCode dùng year=0 cố định nên counter KHÔNG reset/đặt theo năm — mã dự án không có thành phần năm, tăng vô hạn (có thể vượt 999 và padStart 3 mất ý nghĩa). Cần xác nhận đây là chủ ý.
- nextQuoteNumber và nextProjectCode dùng padStart(3) → tràn định dạng khi value > 999 (NNNN). Không có guard/cảnh báo khi vượt ngưỡng.
- nextProjectCode tại call site duplicate (quotes.routes.js:893) được gọi NGOÀI transaction của quote.create kế tiếp → nếu create lỗi, mã dự án bị 'đốt' (gap). nextQuoteNumber được truyền tx ở create chính nhưng nhánh duplicate này thì không.
- Không validate prefix (rỗng/null) trong nextProjectCode; prefix null sẽ tạo counter '_001' và mã 'null_001'.

**Refactor:**
- Gom 3 hàm allocator (quoteNumber, projectCode, customerCode trong codeAllocator.js) vào 1 helper chung allocate(table, prefix, year, pad) để tránh lặp logic upsert.
- Truyền db=tx cho nextProjectCode ở nhánh duplicate (quotes.routes.js:893) để chia sẻ transaction, tránh gap mã.
- Thêm guard khi value vượt 10^pad để log/cảnh báo thay vì lặng lẽ tràn định dạng.

Scores → Quality 84 · Security 92 · Maintainability 82 · Enterprise 80

---

### `src/quoteVersion.js`  — Clean Code 84/100
**Mục đích:** Chụp snapshot trạng thái báo giá (sheets+items) vào QuoteVersion và tính diff nông giữa hai payload version.

**Issues:**
- Truy cập trực tiếp q.vatPercent/subtotal/vat/total.toString() — nếu các cột này nullable (chưa tính total) sẽ ném TypeError 'Cannot read toString of null'. Nên dùng ?.toString() ?? null như đã làm cho days.
- diffVersions dùng JSON.stringify so sánh → nhạy với thứ tự key của object; với mảng sheets/items thì OK vì thứ tự ổn định, nhưng nếu payload thêm object không xác định thứ tự sẽ báo 'changed' sai.
- versionNo = currentVersion ?? 0: upsert ghi đè snapshot cùng versionNo (đúng theo comment cho cosmetic edits) nhưng nghĩa là lịch sử bản 'cosmetic' bị mất — chấp nhận được nhưng nên ghi chú rõ trade-off này.

**Performance:**
- Mỗi snapshot load lại toàn bộ sheets+items rồi map sang JSON — chấp nhận với quy mô nội bộ; nếu báo giá rất lớn (nhiều trăm item) thì payload JSON phình to, cân nhắc giới hạn.

**Refactor:**
- Bọc tất cả .toString() của Decimal nullable bằng helper an toàn dec(v)=>v?.toString()??null để tránh crash.
- Tách hàm buildVersionPayload(q) riêng để tái dùng/test độc lập với phần upsert.
- diffVersions: cân nhắc bỏ qua key 'reason' khi diff để không nhiễu kết quả so sánh nội dung.

Scores → Quality 82 · Security 95 · Maintainability 83 · Enterprise 81

---

### `src/codeAllocator.js`  — Clean Code 85/100
**Mục đích:** Cấp mã khách hàng (KH260001) bằng counter nguyên tử upsert+increment theo (prefix, năm).

**Issues:**
- Không nhận tham số db=tx như quoteNumber.js → không thể chia sẻ transaction với customer.create; nếu create khách hàng lỗi sau khi đã cấp mã thì mã bị 'đốt' (gap). Nên thêm param db=prisma cho nhất quán.
- padStart(4) → tràn định dạng khi >9999 khách/năm (ít khả năng với tool nội bộ nhưng vẫn nên có guard).
- Trùng lặp gần như nguyên văn với nextQuoteNumber — nên gộp.

**Refactor:**
- Thêm tham số db=prisma và dùng trong call site tạo khách hàng để cấp mã trong cùng transaction.
- Hợp nhất với allocator dùng chung (xem quoteNumber.js) để loại bỏ trùng lặp.

Scores → Quality 83 · Security 92 · Maintainability 80 · Enterprise 80

---

### `src/approval.js`  — Clean Code 78/100
**Mục đích:** Engine phê duyệt báo giá: hiện đã đơn giản hóa thành 1 bước (chỉ admin/Giám đốc duyệt), kèm các helper kiểm tra chuỗi level.

**Issues:**
- findMatrixForAmount (dòng 18-29) là DEAD CODE: workflow đã rút gọn 1 bước, không còn dùng ma trận amount; grep xác nhận chỉ định nghĩa, không gọi. Comment đầu file vẫn mô tả 'amount bands/levels' không khớp logic hiện tại → gây hiểu nhầm.
- startApprovalChain: deleteMany rồi create KHÔNG nằm trong cùng một transaction nếu caller không truyền tx — có cửa sổ ngắn không có row nào. Nên bọc trong db.$transaction hoặc yêu cầu caller truyền tx.
- canApproveLevel nhận 4 tham số nhưng bỏ qua hết (chỉ check userRole) — chữ ký giữ lại cho tương thích nhưng dễ gây nhầm là có kiểm tra level/quote.
- hasEarlierPending và nextPendingLevel dùng prisma global (không nhận db=tx) trong khi các hàm khác có — không nhất quán khi gọi trong transaction duyệt.

**Security:**
- canApproveLevel chỉ so sánh chuỗi userRole==='admin'; đúng cho single-tenant nhưng cần đảm bảo route gọi truyền role đã xác thực server-side (không lấy từ client). Đây là điểm kiểm soát quyền duy nhất nên cần test bao phủ.

**Refactor:**
- Xóa findMatrixForAmount + cập nhật comment đầu file cho khớp workflow 1 bước (giảm rủi ro tái kích hoạt nhầm logic ma trận).
- Cho hasEarlierPending/nextPendingLevel nhận db=prisma để chạy được trong transaction duyệt.
- Bọc startApprovalChain (deleteMany+create) trong transaction để tránh khoảng trống không có approval row.

Scores → Quality 79 · Security 85 · Maintainability 76 · Enterprise 78

---

### `src/audit.js`  — Clean Code 85/100
**Mục đích:** Ghi sự kiện audit bất biến (best-effort, không bao giờ ném lỗi) và helper diff nông các trường scalar.

**Issues:**
- ip lấy từ ctx.headers['x-forwarded-for'] khi không có ctx.ip — nếu app đứng sau proxy nhưng không set 'trust proxy' đúng, giá trị này có thể bị client giả mạo (audit IP không đáng tin). Nên ưu tiên req.ip (đã được Express xử lý theo trust proxy) và không fallback sang header thô.
- before/after lưu nguyên đối tượng vào JSON — nếu before/after chứa trường nhạy cảm (password hash, mfaSecret) sẽ bị ghi vào audit log. Nên có allowlist/redact field nhạy cảm trước khi truyền vào.
- diff dùng JSON.stringify để so sánh — nhạy thứ tự key với object lồng; với scalar thì ổn.

**Security:**
- Khả năng giả mạo IP qua x-forwarded-for nếu trust proxy cấu hình sai (xem trên).
- Nguy cơ ghi dữ liệu nhạy cảm vào audit nếu caller truyền object thô có hash/secret vào before/after — cần redact tại nguồn hoặc trong audit().

**Refactor:**
- Ưu tiên ctx.ip (Express đã chuẩn hóa theo trust proxy) thay vì parse x-forwarded-for thủ công.
- Thêm danh sách trường nhạy cảm để redact tự động trong opts.before/after trước khi create.
- Tách Number(actorId)/String(resourceId) thành helper normalize để dùng lại.

Scores → Quality 84 · Security 80 · Maintainability 86 · Enterprise 82

---

### `C:\Users\Admin\Desktop\QuanLY\src\excel.js`  — Clean Code 72/100
**Mục đích:** Sinh file .xlsx báo giá: nạp template (cache RAM), điền dữ liệu từng sheet, xử lý nhóm/hàng con/section, totals, rồi stitch nhiều sheet + sheet tổng.

**Issues:**
- L727: `vatVal = Math.round(subtotalAll * vatPct) / 100` làm tròn VAT ở sheet tổng nhưng `fillSheetData` (L464/511) lại dùng `subtotal*vatPct/100` KHÔNG làm tròn → VAT trên sheet tổng có thể lệch vài đồng so với từng sheet. Nên thống nhất công thức.
- L734: 'Thành tiền' sheet tổng = subtotalAll + vatVal - discount, dùng vatVal đã làm tròn; còn từng sheet total (L488) dùng VAT chưa làm tròn → grand total có thể không khớp tổng các sheet.
- L255/L476 `ws.duplicateRow(..., true)` rồi vẫn dựa vào style template; với template preserveStructure khi n>slotCount (L252) nhánh duplicate vẫn chạy do điều kiện else-if — nhưng preserveStructure đã ăn nhánh đầu nên OK; chỉ là logic n>slotCount ở preserveStructure bị bỏ (mục dư bị cắt âm thầm, không cảnh báo).
- L438 điều kiện merge `r2 - r1 !== span - 1` bỏ qua merge khi hàng không liền kề (do splice) — đúng hướng nhưng khi đó STT/tên của sub vẫn null → ô trống không merge, dữ liệu nhìn như mất; nên fallback ghi STT vào hàng đầu nhóm.
- L470-482 discount chỉ render khi `onlySheet`; multi-sheet thì discount nằm ở sheet tổng — đúng thiết kế, nhưng nếu showTotals=false (L846) sheet tổng KHÔNG được tạo nên discount của bản multi-sheet biến mất hoàn toàn (không hiện ở đâu).
- L344 `gmult = Math.max(1, Number(it.quantity)||1)` cho section: nếu quantity=0 vẫn nhân 1 — hợp lý nhưng khác cột quantity hiển thị (L343 ghi null khi 0) → SL hiển thị trống nhưng vẫn nhân 1, dễ gây hiểu nhầm.

**Security:**
- Đã có neutralizeFormula (L30) chống CSV/formula injection cho mọi setCell — tốt. Lưu ý: các ô ghi trực tiếp bằng `ws.getCell().value=` (vd L349 notes section, L403 amount, L711-712 summary st.name) KHÔNG đi qua neutralizeFormula; st.name là tên sheet do người dùng đặt → nếu bắt đầu bằng = có thể thành formula trong sheet Tổng (rủi ro thấp, nội bộ).
- insertCustomerLogo (L80) chỉ chấp nhận data:image png/jpe?g/gif base64 qua regex — ổn; Buffer.from base64 lỗi đã try/catch.

**Performance:**
- Template cache (L14-19) đọc đĩa 1 lần/sheet — tốt. Buffer cache không giới hạn nhưng số template hữu hạn nên chấp nhận được.
- L227/L230 JSON.parse(JSON.stringify(style)) lặp cho mỗi cột × mỗi hàng item (styleRow) — O(cols×rows) deep clone; với bảng lớn có thể tốn CPU, nhưng đã chạy trong worker thread nên không chặn event loop.
- buildQuoteBuffer ghi từng sheet ra buffer riêng rồi stitch (L839-854) — nhiều lần writeBuffer; chấp nhận để giữ style chuẩn.

**Refactor:**
- Tách hàm tính VAT/total dùng chung cho cả per-sheet và summary để loại bỏ chênh lệch làm tròn (L464/511 vs L727/734).
- Bọc các ô ghi trực tiếp `.value=` cho text người dùng (st.name, notes) qua neutralizeFormula để nhất quán chống formula injection.
- Đưa các hằng style summary (font Times New Roman, màu FFFFCC99/FFC00000, border) ra constant/helper thay vì lặp inline ở addSummarySheet.
- Cân nhắc cảnh báo/log khi preserveStructure mà n>slotCount (mục bị cắt) để tránh mất dữ liệu im lặng.

Scores → Quality 74 · Security 86 · Maintainability 66 · Enterprise 72

---

### `C:\Users\Admin\Desktop\QuanLY\src\exportQueue.js`  — Clean Code 88/100
**Mục đích:** Điều phối sinh export: ưu tiên worker thread (giới hạn 3 worker đồng thời) với timeout + kiểm tra buffer hợp lệ, fallback về hàng đợi inline tuần tự có cap 8 (degrade 429).

**Issues:**
- L19 `chain.then(fn, fn)` chạy fn cả khi job trước reject — đúng ý 'không chặn chain'; nhưng `chain = result.then(()=>{},()=>{})` nuốt mọi lỗi, OK. Lưu ý pending++ trước await acquire nên cap chỉ tính job inline, không tính worker — đặt tên/ý nghĩa MAX_PENDING chỉ cho fallback (đã ghi chú).
- L37 releaseWorkerSlot: nếu acquireWorkerSlot reject (không xảy ra ở đây vì luôn resolve) thì counter lệch; hiện an toàn.
- generateInWorker (L39) không giới hạn workerData.quote size — quote rất lớn vẫn structured-clone vào worker; chấp nhận với công cụ nội bộ.

**Performance:**
- Tạo Worker mới mỗi lần (L42) thay vì worker pool tái sử dụng — chi phí spawn ~chục ms mỗi export; với tải thấp nội bộ chấp nhận, nhưng pool sẽ tiết kiệm CPU nếu export nhiều.
- looksValid (L52) chỉ kiểm magic bytes — rẻ, tốt. timeout 30s + terminate (L43-44) tránh worker treo giữ slot.

**Refactor:**
- Cân nhắc worker pool (piscina hoặc tự quản) thay vì spawn-per-job để giảm overhead khi tải cao.
- Trích MAX_PENDING/MAX_WORKERS/timeout ra config/env để chỉnh theo môi trường prod.

Scores → Quality 88 · Security 92 · Maintainability 86 · Enterprise 85

---

### `C:\Users\Admin\Desktop\QuanLY\src\exportWorker.js`  — Clean Code 90/100
**Mục đích:** Worker thread thực thi sinh buffer xlsx/pdf off main-loop, nhận quote serialized qua workerData, trả ArrayBuffer (transfer, không copy), báo lỗi về parent để fallback.

**Issues:**
- L7 không có guard `parentPort` null — trong ngữ cảnh worker luôn tồn tại nên an toàn; nếu file vô tình import ở main thread sẽ ném lỗi khó hiểu (chấp nhận).
- Không bắt unhandledRejection/uncaughtException ngoài try (vd lỗi đồng bộ khi import) — nhưng phần sinh nằm trong async IIFE try/catch nên các lỗi runtime chính đều được báo về parent.

**Performance:**
- Transfer ArrayBuffer (L14-15) tránh copy buffer lớn — tối ưu tốt. `buf.buffer.slice(...)` tạo 1 bản cắt đúng vùng (cần thiết vì Buffer có thể là view của pool) — hợp lý.

**Refactor:**
- Có thể thêm `process.on('unhandledRejection')` để chắc chắn mọi lỗi đều postMessage về parent thay vì để worker exit code != 0 (đã được parent xử lý qua sự kiện exit nên không bắt buộc).

Scores → Quality 90 · Security 92 · Maintainability 90 · Enterprise 88

---

### `src/xlsxStitcher.js`  — Clean Code 72/100
**Mục đích:** Ghép nhiều file xlsx 1-sheet thành 1 workbook nhiều sheet ở mức OOXML/zip để giữ nguyên style, font, ảnh.

**Issues:**
- Toàn bộ logic dựa trên regex để parse/sửa XML (styles, sheet, rels, content-types). Rất giòn: nếu ExcelJS đổi định dạng output (vd thêm namespace prefix x:, hoặc cell t="s" có thuộc tính sau >v<) thì remap shared-string/style sẽ sai âm thầm. Đây là rủi ro bảo trì lớn nhất của file.
- remapSheetXml (dòng 89): regex cho t="s" giả định <v> ngay sau thẻ <c ... t="s"> và không có inline formula; cell có <f> hoặc thuộc tính khác giữa sẽ không khớp -> shared string ref không bị dịch -> sai chữ. Với template hiện tại OK nhưng đáng ghi chú.
- copyDrawingsAndImages chỉ xử lý 1 drawing/sheet (drawingRel = sheetRels.find(.../drawing), dòng 184) và 1 file media theo từng số; nhiều drawing trên cùng 1 sheet sẽ mất. Đúng cho template hiện tại nhưng là giả định ngầm.
- Cập nhật baseDrawingMax/baseImageMax bằng cách cộng dồn srcMax (dòng 395-396) thay vì dùng offset cố định theo từng nguồn; nếu nguồn có image đánh số không liên tục (vd chỉ image3) thì offset có thể chồng lấn ở vòng lặp sau. Hiếm xảy ra với template tự sinh nhưng là lỗi tiềm ẩn.
- remapXf chỉ replace lần đầu mỗi attribute (không cờ /g) — đúng vì mỗi xf chỉ có 1 fontId/fillId/... nhưng phụ thuộc giả định.
- buildSection bỏ count cũ trong attrs rồi tự thêm count mới, nhưng các attr khác (vd cellXfs không có; numFmts buildSection không truyền extraAttrs) — numFmts mất mọi attr gốc, chấp nhận được vì numFmts chỉ có count.

**Security:**
- Tên sheet và giá trị được escapeXmlAttr trước khi nhúng vào workbook.xml (addSheetEntry/renameSheet) nên không có XML injection từ sheetNames. Drawing/media buffer copy nguyên khối, không thực thi — an toàn. Đây là tool nội bộ, input từ file template tin cậy.

**Performance:**
- Mỗi buffer được JSZip.loadAsync và regex toàn bộ chuỗi XML; với template nhỏ (vài KB) không đáng kể. Đã chạy trong worker_threads ở tầng excel.js nên không chặn event loop.
- Nhiều .replace toàn cục trên chuỗi lớn lặp lại theo từng sheet — chấp nhận được ở quy mô vài sheet.

**Refactor:**
- Bổ sung comment/cảnh báo rằng module này chỉ hỗ trợ output do ExcelJS sinh ra (không namespace prefix, 1 drawing/sheet) để người sau không mở rộng nhầm.
- Tách hằng URL relationship/content-type ra một object dùng chung (đang lặp chuỗi dài http://schemas... nhiều chỗ).
- Cân nhắc unit test snapshot: stitch 2 buffer mẫu rồi mở lại bằng ExcelJS để khẳng định không hỏng — bảo hiểm cho regex giòn.
- newSheetNum param truyền vào copyDrawingsAndImages (dòng 176/389) không được dùng bên trong — bỏ tham số thừa.

Scores → Quality 75 · Security 90 · Maintainability 62 · Enterprise 70

---

### `src/templateConfigs.js`  — Clean Code 84/100
**Mục đích:** Khai báo cấu hình layout (ô header, cột item, dòng tổng, công thức, cleanup) cho từng template Excel báo giá.

**Issues:**
- Hàm titleFormat của unibenfood (dòng 226-237) lặp y hệt baoGiaTitle đã định nghĩa ở đầu file — nên dùng lại baoGiaTitle thay vì copy logic normalize diacritics (clofull/marico đã dùng chung baoGiaTitle).
- displayName của unibenfood là "GN (có ngày)" trong khi marico_decor là "GN (không ngày)" và sheetName unibenfood là "Quotation" — đặt tên dễ gây nhầm giữa GN và Unibenfood; chỉ là nhãn nhưng nên thống nhất.
- totals.discount thiếu rowOffset (marico không có discount; clofull/uniben có) — đã xác nhận ở excel.js dòng 474-475 discountRow = vatRow + 1 nên KHÔNG phải bug; chỉ là cấu trúc không đồng nhất với các total khác, nên ghi comment để tránh hiểu nhầm.
- Các magic cell reference (vd C4/C5, I12-I18, extraCellsToClear) gắn cứng theo file template; nếu template .xlsx bị chỉnh tay thì lệch âm thầm — vốn dĩ bản chất của file config, đã có comment giải thích tốt.

**Refactor:**
- Thay titleFormat inline của unibenfood bằng baoGiaTitle (loại bỏ ~12 dòng trùng).
- Trích các regex/columns chung (stt/name/unit/quantity/unitPrice/amount/notes) đã lặp 3 lần — có thể dùng helper tạo cột mặc định rồi override, giảm trùng lặp.
- Thêm chú thích nhất quán cho discount (không có rowOffset vì chèn động sau VAT).

Scores → Quality 85 · Security 95 · Maintainability 82 · Enterprise 82

---

### `src/pdf.js`  — Clean Code 80/100
**Mục đích:** Sinh PDF báo giá bằng pdfkit (font Times Unicode cho tiếng Việt, bảng item, dòng tổng).

**Issues:**
- drawItemsTable không xử lý ngắt trang: bảng dài hơn 1 trang A4 sẽ tràn/đè vì y tự tăng không kiểm tra doc.page.height (dòng 168). Với báo giá nhiều dòng item đây là lỗi hiển thị thật.
- rowH ước lượng số dòng bằng text.split('\n').length (dòng 152) chứ không tính text wrap thực tế của pdfkit; tên hạng mục dài bị wrap sẽ tràn ra ngoài ô (chỉ tính ký tự \n, không tính chiều rộng cột 200pt).
- Tổng (sub/vat/total) lấy trực tiếp từ quote (dòng 94-97) chứ không cộng lại từ items của các sheet — nếu quote.subtotal lệch với items thì PDF và Excel có thể khác nhau; chấp nhận vì backend là nguồn sự thật, nhưng đáng lưu ý.
- fmt = Number(n).toLocaleString('vi-VN') (dòng 26): nếu n là null/undefined -> Number(null)=0 OK, nhưng chuỗi không parse được -> 'NaN'; các call site đều đã Number() phía trên nên thực tế an toàn.
- doc.text(...continued:true) ở dòng 57-58 dựa vào cùng dòng cho Số/Ngày; nếu quoteNumber quá dài có thể đẩy layout, nhỏ nhặt.

**Security:**
- Mọi dữ liệu quote (title, names, notes, contact) được pdfkit render dưới dạng text thuần — không có injection/HTML, an toàn. Đường dẫn font cố định trong repo, không nhận input ngoài.

**Performance:**
- checkFontsOnce cache kết quả existsSync (tốt). registerFonts gọi existsSync(italic) mỗi lần render (dòng 32) — không đáng kể nhưng có thể cache cùng checkFontsOnce.
- Render đồng bộ trong Promise, dồn buffer vào mảng — phù hợp cho báo giá kích thước nhỏ.

**Refactor:**
- Thêm phân trang trong drawItemsTable: trước khi vẽ mỗi row, nếu y + rowH > doc.page.height - margin thì doc.addPage() và vẽ lại header bảng. Đây là cải tiến quan trọng nhất.
- Cache trạng thái italic font cùng hasUnicodeFont để khỏi gọi existsSync lặp.
- Tách hằng cols (layout bảng) ra module-level để tái dùng/test, và tính tableW một lần.

Scores → Quality 76 · Security 95 · Maintainability 82 · Enterprise 78

---

### `src/routes/auth.routes.js`  — Clean Code 86/100
**Mục đích:** Xác thực: đăng nhập phiên cookie, JWT token (cấp/refresh/revoke), đổi mật khẩu, quên mật khẩu, mời/kích hoạt tài khoản.

**Issues:**
- /profile (dòng 113-114): title/senderName chỉ ghi khi !== undefined, nhưng schema dùng .optional().or(z.literal('').transform(()=>null)); khi client gửi '' thì set null (đúng), nhưng khi bỏ field thì giữ nguyên — hành vi không đối xứng với displayName/phone (phone luôn ghi). Cần làm rõ/ thống nhất ngữ nghĩa partial-update.
- /me select có mfaEnabled, lastLoginAt nhưng /profile trả về không có lastLoginAt — payload user không nhất quán giữa các endpoint, dễ gây lệch state ở SPA.
- /change-password (dòng 130): findUnique theo session.userId không kiểm tra user còn tồn tại (giả định luôn có vì đã requireAuth); nếu user bị purge giữa chừng sẽ NPE ở bcrypt.compare(user.passwordHash). Hiếm nhưng nên guard null.
- /forgot-password: audit() chạy trong background sau khi res đã gửi — nếu req object bị tái sử dụng/giải phóng có thể thiếu context; chấp nhận được nhưng nên truyền snapshot ip/userId thay vì req.

**Security:**
- Không có lỗ hổng rõ ràng. Các điểm hardening đã đúng: regenerate session chống fixation, skipSuccessfulRequests cho login limiter, APP_BASE_URL cho link reset (chống host-header poisoning), backup code 10-hex + single-use qua authCore, revoke toàn bộ session/refresh khi đổi/đặt lại mật khẩu, forgot-password luôn 200 + xử lý nền chống enumeration (kể cả timing).
- Minor: /token/refresh và /token/revoke không có rate limit riêng — refresh token endpoint có thể bị brute (dù token 20+ ký tự ngẫu nhiên, rủi ro thấp). Cân nhắc limiter nhẹ.
- Minor: HTML email reset (dòng 261) nhúng url trực tiếp; url chỉ chứa token hex từ randomBytes nên an toàn, nhưng nên dùng cùng escHtml như users.routes.js để nhất quán phòng thủ.

**Refactor:**
- Trích hàm dùng chung loginSession(req, user) gói regenerate+set fields+save (lặp y hệt ở /login và /accept-invite).
- Gộp helper hashInvite + findInvitee đang trùng với users.routes.js — đưa vào module invites.js dùng chung.
- Chuẩn hoá một userPublic(user) serializer duy nhất để mọi endpoint trả cùng shape (id/username/displayName/role/phone/title/senderName/permissions).

Scores → Quality 87 · Security 92 · Maintainability 84 · Enterprise 85

---

### `src/routes/users.routes.js`  — Clean Code 82/100
**Mục đích:** Quản trị người dùng (chỉ admin): liệt kê, mời/gửi lại lời mời, tạo, cập nhật, xóa mềm; kèm dọn membership và thu hồi phiên.

**Issues:**
- POST / (tạo user thủ công, dòng 117-127): không nhận projectCode dù invite có; và create không gửi audit diff như update. Nhỏ nhưng thiếu nhất quán field set so với /invite.
- PUT /:id: nếu body chỉ có active=false mà role không đổi, nhánh dòng 162 dọn membership đúng; nhưng nếu before.active đã false và set lại false thì bỏ qua (đúng). Logic ổn nhưng phức tạp — nên tách thành hàm applyUserSideEffects(before, after).
- DELETE /:id (dòng 191): so sánh id === req.session.userId — id đã coerce thành number qua idParam, session.userId cũng number nên OK; xác nhận kiểu nhất quán ở nơi khác.
- resend-invite/update/delete: findFirst({where:{id}}) dựa middleware tự thêm deletedAt:null nên user đã xóa mềm sẽ trả 404 (đúng), nhưng /:id/resend-invite dùng findFirst còn create dùng includeDeleted — nên ghi rõ ý đồ để người sau không nhầm.

**Security:**
- Toàn router gắn requireRole('admin') (dòng 16) — tốt. Email invite đã escHtml displayName/url chống XSS trong mail client.
- Minor: inviteUrl được trả về trong response JSON (dòng 82,103) — chứa token reset hợp lệ. Với công cụ nội bộ single-tenant chỉ admin gọi thì chấp nhận, nhưng token này sẽ lọt vào log/proxy nếu có; cân nhắc không trả url khi email gửi thành công.
- revokeAllForUser + destroyAllSessions khi admin reset mật khẩu (dòng 155-158) — containment đúng.

**Performance:**
- GET / (dòng 51): select inviteTokenHash chỉ để tính pending rồi loại bỏ — kéo hash về app rồi map; với số user nội bộ nhỏ không đáng kể, có thể thay bằng cờ tính ở DB hoặc select boolean.
- PUT /:id nhánh deactivate: findMany quote rồi update set:[] — 2 query; có thể chỉ cần update set:[] và đếm qua _count nếu cần audit, nhưng giữ để có quoteIds cho audit là hợp lý.

**Refactor:**
- Tách applyUserUpdateSideEffects(req, before, after, {password}) khỏi handler PUT để giảm độ dài và phân nhánh.
- Đưa hashInvite/escHtml/inviteLink/sendInviteEmail vào module dùng chung với auth.routes.js (đang trùng lặp).
- Bổ sung diff(before, after) (đã import diff ở dòng 9 nhưng không dùng) vào audit user.update — hiện comment 'log diff explicitly' nhưng không thực sự log diff.

Scores → Quality 83 · Security 90 · Maintainability 80 · Enterprise 83

---

### `src/routes/customers.routes.js`  — Clean Code 85/100
**Mục đích:** CRM khách hàng: CRUD có phân quyền theo chủ sở hữu (own/all), tìm kiếm/phân trang, ghi chú và lịch follow-up.

**Issues:**
- GET /:id (dòng 139-150): query 2 lần — loadAuthorizedCustomer đã findFirst lấy customer, rồi findFirst lại để include notes/followUps; lãng phí 1 round-trip. Nên cho loadAuthorizedCustomer nhận tham số include hoặc tái dùng kết quả.
- POST / dedupe taxCode (dòng 117-119): chỉ check trong các bản chưa xóa mềm; nếu MST trùng với khách đã xóa sẽ không cảnh báo (có thể đúng ý đồ, nhưng khác cách xử lý code/sku ở file khác dùng includeDeleted — không nhất quán).
- PUT /:id: data = {...req.body} rồi update; CustomerUpdate.partial() cho phép gửi code — không có dedupe code/taxCode khi đổi qua PUT (chỉ POST kiểm). Đổi code/taxCode trùng sẽ ném 500 từ ràng buộc DB thay vì 409.
- POST /:id/notes & /follow-ups yêu cầu action 'manage' để thêm note — nhưng người chỉ có quyền 'read' khách của người khác không ghi được note (hợp lý); cần xác nhận đây là ý đồ nghiệp vụ.

**Security:**
- Phân quyền tốt: loadAuthorizedCustomer + canScoped chặn IDOR; list ép ownerId=userId khi không có read:all; create/update ép/loại ownerId khi không có manage:all (chống leo quyền gán chủ sở hữu).
- follow-ups/:fid/done (dòng 220-228): kiểm tra assignee HOẶC canScoped manage trên customer — đúng, chặn người ngoài đánh dấu done.
- Minor: tìm kiếm q dùng contains trên nhiều cột; an toàn với Prisma (tham số hóa). Không thấy injection.

**Performance:**
- GET /:id double-query (như trên).
- GET / dùng count + findMany song song (tốt). Tìm kiếm contains mode insensitive trên name/code/email không có index có thể chậm khi bảng lớn — với quy mô nội bộ ổn; cân nhắc index nếu tăng trưởng.

**Refactor:**
- loadAuthorizedCustomer(req, res, action, { include }) trả về customer đã include để GET /:id chỉ 1 query.
- Tách hàm dedupe code/taxCode dùng chung cho cả POST và PUT để PUT cũng trả 409 thay vì 500.
- Gom CustomerCreate/Update vào validators.js cho nhất quán với các route khác (auth/users import schema từ validators).

Scores → Quality 84 · Security 91 · Maintainability 84 · Enterprise 85

---

### `src/routes/products.routes.js`  — Clean Code 84/100
**Mục đích:** Danh mục sản phẩm: CRUD (cần product:manage), bậc giá, ẩn giá vốn/biên LN theo quyền, tìm kiếm/phân trang.

**Issues:**
- present() (dòng 55): margin = basePrice && costPrice ? ... : null — nếu costPrice = 0 (giá vốn 0, hợp lệ) thì margin trả null thay vì 100%. Điều kiện nên là basePrice > 0 thôi, không phụ thuộc costPrice truthy.
- GET /:id (dòng 136) trả showCost theo quyền — đúng; nhưng POST/PUT (dòng 123,169) luôn present showCost:true bất kể quyền người tạo có PRODUCT_READ_COST hay không. Vì cần PRODUCT_MANAGE mới vào được, và (theo permissions.js dòng 85) các role manage thường kèm read:cost, nhưng không đảm bảo tuyệt đối — người có manage mà không có read:cost vẫn thấy costPrice/margin trong response create/update. Rò rỉ nhẹ trường bảo mật.
- POST / (dòng 118): priceTiers.map giả định priceTiers luôn là mảng — schema default([]) nên an toàn; OK.
- GET /categories không phân trang/giới hạn (distinct) — số category nhỏ nên ổn.

**Security:**
- costPrice/margin được gate đúng ở list & get qua PRODUCT_READ_COST. Điểm yếu duy nhất: response của create/update ép showCost:true (xem issues) — nên dùng showCost: can(req.session, P.PRODUCT_READ_COST) cho nhất quán.
- Mutations đều yêu cầu requirePermission(P.PRODUCT_MANAGE) — tốt. List/get chỉ cần requireAuth (đọc danh mục cho mọi nhân viên) — hợp lý.

**Performance:**
- PUT /:id: deleteMany tiers rồi create lại toàn bộ trong transaction — đơn giản, đúng; với số tier ≤10 không đáng lo.
- GET / contains trên sku/name không index — chấp nhận ở quy mô nội bộ.

**Refactor:**
- Sửa điều kiện margin: const m = Number(p.basePrice) > 0 ? ((base-cost)/base*100) : null.
- Dùng showCost theo quyền cho mọi response (create/update/get/list) — trích một hàm presentForSession(p, req).
- Đưa schema Create/Update/PriceTier vào validators.js để đồng bộ với các route khác.
- Tách helper upsertPriceTiers(tx, productId, tiers) dùng chung POST/PUT.

Scores → Quality 84 · Security 86 · Maintainability 85 · Enterprise 84

---

### `C:\Users\Admin\Desktop\QuanLY\src\routes\admin.routes.js`  — Clean Code 80/100
**Mục đích:** Route admin: sao lưu DB (pg_dump streaming), thống kê số bản ghi, và purge cứng các bản ghi đã soft-delete quá hạn.

**Issues:**
- Backup (dòng 53): audit() chỉ được gọi SAU khi spawn pg_dump và đã pipe stdout vào res — vì proc chạy bất đồng bộ, audit thực thi gần như tức thì nhưng nếu pg_dump lỗi sớm (close code!=0) thì sự kiện 'admin.backup' vẫn được ghi như thể thành công. Nên ghi audit theo kết quả (thành công khi code===0).
- Backup: res được pipe trực tiếp nhưng nếu client ngắt kết nối (res 'close'), tiến trình pg_dump không bị kill → process zombie tiêu tốn tài nguyên DB. Nên thêm res.on('close', () => proc.kill()).
- Backup: lỗi pg_dump trả nguyên văn err stderr về client (dòng 45/50) — có thể lộ chi tiết kết nối/đường dẫn nội bộ; chỉ nên log chi tiết, trả thông báo chung.
- Stats: $queryRaw bảng user_sessions hardcode tên bảng — nếu schema đổi tên sẽ âm thầm trả 0 (đã .catch). Chấp nhận được nhưng dễ che giấu lỗi thật.

**Security:**
- Mật khẩu DB được truyền qua biến môi trường PGPASSWORD cho tiến trình con (dòng 34) — chuẩn và an toàn hơn dòng lệnh; OK. Lưu ý phụ: thông điệp lỗi pg_dump lộ ra client có thể chứa host/db (dòng 45,50).

**Performance:**
- Không có giới hạn đồng thời cho backup — nhiều admin gọi /backup.dump cùng lúc sẽ tạo nhiều pg_dump nặng song song. Cân nhắc lock/single-flight.

**Refactor:**
- Di chuyển audit vào nhánh proc.on('close', code===0) để phản ánh đúng kết quả; thêm proc.kill() khi res đóng.
- Bọc trả lỗi pg_dump thành thông báo chung, log chi tiết qua logger.
- Purge: tốt — dùng quan hệ none guard và để lỗi nổi lên handler; có thể bọc toàn bộ steps trong một $transaction để all-or-nothing.

Scores → Quality 78 · Security 80 · Maintainability 82 · Enterprise 78

---

### `C:\Users\Admin\Desktop\QuanLY\src\routes\analytics.routes.js`  — Clean Code 86/100
**Mục đích:** Route analytics: KPI tổng quan, doanh thu theo ngày, top sales, và funnel theo trạng thái, đều áp scope theo vai trò.

**Issues:**
- overview/top-sales/funnel dùng Prisma groupBy/aggregate/count → middleware db.js tự thêm deletedAt:null nên không rò bản ghi đã xóa (đã xác minh). OK.
- revenue-by-day dùng $queryRaw nên KHÔNG hưởng middleware soft-delete; tác giả đã tự thêm 'AND deletedAt IS NULL' (dòng 95) → nhất quán. Tốt.
- top-sales (dòng 109): scope dùng QUOTE_READ_ALL (admin) → manager/employee chỉ thấy hàng của chính họ; nhưng overview/funnel dùng quoteScopeWhere (gồm cả member). Khác biệt logic scope giữa các endpoint dễ gây nhầm cho người dùng (manager là member của quote sẽ thấy trong overview nhưng không trong top-sales). Cần thống nhất/ghi rõ chủ đích.
- overview expiringSoon (dòng 49-55): không áp khoảng [from,to] mà chỉ áp scope + cửa sổ 7 ngày tới — đúng chủ đích nhưng tài liệu period gây hiểu nhầm rằng KPI nằm trong period.
- Tất cả tổng tiền dùng Number(_sum.total) — total là Decimal; với giá trị rất lớn có thể mất chính xác float, song với quy mô nội bộ chấp nhận được.

**Security:**
- revenue-by-day: fragment scope dùng Prisma.sql tham số hóa createdById (dòng 88) → không SQL injection. Tên cột/bảng hardcode an toàn.

**Performance:**
- top-sales: groupBy rồi findMany user theo id — N nhỏ (<=50) nên OK; không vấn đề.
- Các query dựa vào index trên (status, createdAt, deletedAt); đảm bảo partial index đã có (theo context đã thêm) để groupBy/aggregate nhanh.

**Refactor:**
- Thống nhất hàm scope: hoặc dùng quoteScopeWhere cho cả top-sales/revenue-by-day, hoặc tách rõ 'leaderboard chỉ tính quote mình tạo' và ghi chú lý do.
- Tách helper period→where dùng chung để giảm lặp defaultRange + spread.

Scores → Quality 85 · Security 90 · Maintainability 85 · Enterprise 84

---

### `C:\Users\Admin\Desktop\QuanLY\src\routes\approvals.routes.js`  — Clean Code 84/100
**Mục đích:** Route phê duyệt: CRUD ma trận phê duyệt (admin) và hàng đợi phê duyệt đang chờ cho Director.

**Issues:**
- PUT /matrix/:id (dòng 65): với MatrixCreate.partial(), nếu body có 'levels' nó sẽ ghi đè toàn bộ mảng levels (Prisma set scalar JSON) — đúng nếu levels là cột JSON; nhưng nếu là quan hệ con thì cần xử lý nested. Cần xác nhận schema (giả định JSON → OK).
- PUT/POST: minAmount/maxAmount chuyển qua D() (Decimal). PUT chỉ xử lý khi !==undefined; nếu client gửi maxAmount:null (bỏ trần) thì nhánh dòng 65 bỏ qua (vì ===null) → giá trị null vẫn được spread vào data và ghi null. OK nhưng logic hơi tinh tế, nên comment.
- GET /matrix (dòng 29): không có requireRole — bất kỳ user đăng nhập nào cũng xem được ma trận phê duyệt. Có thể là chủ đích (employee cần biết ngưỡng) nhưng nên xác nhận; ghi tiền/ngưỡng nội bộ cho mọi vai trò.
- Queue (dòng 100-106): convert Decimal→Number cho subtotal/vat/total/vatPercent nhưng KHÔNG convert min/max của quote khác; nhất quán trong phạm vi quote nên OK.
- Queue dùng take:100 cố định, không phân trang — nếu hàng đợi >100 sẽ bị cắt im lặng.

**Security:**
- GET /matrix mở cho mọi vai trò đã đăng nhập (chỉ requireAuth) — cân nhắc giới hạn manager/admin nếu ngưỡng tiền là nhạy cảm.

**Performance:**
- Queue include quote→company→createdBy cho tối đa 100 hàng: ổn. Không vấn đề.

**Refactor:**
- Thêm phân trang (page/size) cho /queue thay vì take:100 cứng.
- Tách hàm normalizeMatrixMoney(body) dùng chung cho POST/PUT để giảm lặp logic D().
- Cân nhắc requireRole('admin'/'manager') cho GET /matrix nếu ngưỡng là nội bộ.

Scores → Quality 83 · Security 82 · Maintainability 85 · Enterprise 82

---

### `C:\Users\Admin\Desktop\QuanLY\src\routes\audit.routes.js`  — Clean Code 90/100
**Mục đích:** Route xem nhật ký audit có lọc/phân trang; manager thấy who/what/when, admin thấy thêm before/after/IP/UA.

**Issues:**
- BigInt id→string (dòng 57) đúng; nhưng các trường before/after có thể là JSON chứa BigInt khác → JSON.stringify mặc định sẽ ném nếu payload chứa BigInt. Cần đảm bảo audit lưu plain JSON (thường là vậy) — rủi ro thấp.
- Phân trang count + findMany song song: nếu total=0 thì pageCount=0 (Math.ceil(0/size)=0) — OK.
- Lọc 'action'/'resource' khớp tuyệt đối (equals), không hỗ trợ tìm gần đúng; chấp nhận được cho audit.

**Security:**
- Least-privilege tốt: strip before/after/ip/userAgent cho non-admin (dòng 58-63) — giảm rò PII. Đúng hướng.
- Quyền route gắn với PERMISSIONS.AUDIT_VIEW khớp nav gate — nhất quán RBAC.

**Performance:**
- count(where) + findMany(where) trên auditEvent: với bảng audit lớn, count có thể chậm khi không có index phù hợp trên (createdAt, actorId, resource). Đảm bảo có index; cân nhắc keyset pagination cho bảng rất lớn.

**Refactor:**
- Tách hàm buildWhere(query) cho dễ test.
- Cân nhắc trả pageCount=Math.max(1, ...) hoặc giữ nguyên 0 nhưng tài liệu hóa.

Scores → Quality 90 · Security 92 · Maintainability 90 · Enterprise 89

---

### `C:\Users\Admin\Desktop\QuanLY\src\routes\export.routes.js`  — Clean Code 88/100
**Mục đích:** Route xuất báo giá ra XLSX/PDF qua worker thread (có fallback inline), kèm kiểm tra quyền đọc quote.

**Issues:**
- Thứ tự kiểm tra: findFirst rồi canOnQuote — đúng (404 trước, 403 sau). Tốt.
- res.end(buf) sau khi set Content-Length=buf.length: nếu buf không phải Buffer (worker trả Uint8Array/ArrayBuffer) thì .length có thể không khớp byte. Xác nhận runExportJob luôn trả Buffer.
- audit() gọi sau res.end (dòng 54,92): nếu audit ném lỗi, response đã gửi → asyncHandler bắt nhưng không thể gửi 500; lỗi audit chỉ được log. Chấp nhận được nhưng có thể mất bản ghi audit khi export thành công.
- PDF path tạo pdfQuote convert Decimal nhưng sheets.items bên trong vẫn là Decimal thô — renderQuotePdf/plain() phải tự xử lý; comment plain() nói đã chuẩn hóa qua JSON nên OK cho worker, còn fallback inline dùng pdfQuote (chỉ convert cấp trên). Kiểm tra renderQuotePdf đọc item.total qua Number().

**Security:**
- safeName sanitize quoteNumber bằng allowlist [A-Za-z0-9_-] (dòng 48,87) → chống header/path injection trong Content-Disposition. Tốt.
- Quyền dựa trên canOnQuote(read) — không IDOR. members select id để hỗ trợ check member. Đúng.

**Performance:**
- Export chạy trong worker_threads tránh chặn event loop. Tốt. Lưu ý: không có Content-Length cho stream lớn nhưng dùng buffer toàn bộ trong RAM (10MB+ quote nhiều sheet) — chấp nhận với quy mô nội bộ.
- Hai handler xlsx/pdf lặp gần như nguyên khối include quote — có thể trùng truy vấn.

**Refactor:**
- Tách hàm loadQuoteForExport(id) dùng chung cho cả xlsx và pdf (include giống hệt nhau).
- Đảm bảo runExportJob trả Buffer; nếu không, ép Buffer.from trước khi set Content-Length.
- Cân nhắc audit trước res.end (await) để không mất bản ghi, hoặc fire-and-forget có log rõ.

Scores → Quality 87 · Security 90 · Maintainability 86 · Enterprise 87

---

### `C:\Users\Admin\Desktop\QuanLY\src\routes\files.routes.js`  — Clean Code 90/100
**Mục đích:** Route file: upload (kiểm magic bytes + allowlist), ký URL download/upload theo namespace key, và xóa (admin).

**Issues:**
- canAccessKey exports regex (dòng 59): ^exports/(.+)-\d+\.(xlsx|pdf)$ — '(.+)' tham lam có thể khớp quoteNumber chứa dấu '-' và số, nhưng nếu quoteNumber bản thân kết thúc bằng '-<số>' thì m[1] có thể bắt sai. Rủi ro thấp do tra cứu chính xác quoteNumber; vẫn nên neo định dạng chặt hơn.
- sign-download: key do client cung cấp tự do (max 500) nhưng canAccessKey chặn theo namespace — non-admin chỉ ký được logos/, uploads/u<self>/, exports thuộc quote mình đọc được. Tốt; không path traversal vì chỉ dùng làm object key (không filesystem).
- delete (dòng 135) chỉ admin, không kiểm tra key tồn tại/namespace — admin có thể xóa bất kỳ object nào kể cả logo dùng chung; chấp nhận với vai trò admin nhưng không audit-able theo chủ sở hữu.
- sniffType: nếu MIME khai báo sai, vòng lặp thử mọi sniffer rồi gán theo nội dung — nhưng fileFilter (dòng 30) đã loại file có mimetype ngoài allowlist trước khi tới đây; nghĩa là file thực sự khớp nội dung nhưng khai sai MIME hợp lệ vẫn qua. Hành vi hợp lý.

**Security:**
- Chống XSS lưu trữ tốt: contentDisposition:'attachment', contentType là MIME allowlist (không phải client), không cho text/html/svg (dòng 90,122). Tốt.
- Key upload luôn server-sinh trong namespace uploads/u<userId>/ → không ghi đè object người khác (dòng 70). Tốt.
- Magic-byte sniff cho PNG/JPEG/WEBP/PDF/XLSX (dòng 18-23) — XLSX/DOCX cùng là zip PK; một file .docx độc hại đổi tên có thể qua sniff XLSX (cùng magic) nhưng contentType ép thành xlsx và disposition attachment nên rủi ro thấp.
- originalName được encodeURIComponent + cắt 200 (dòng 92) trước khi lưu metadata → an toàn.

**Performance:**
- memoryStorage giữ toàn bộ file (tối đa 10MB) trong RAM trước khi putObject — với 1 file/req và giới hạn 10MB là ổn.
- canAccessKey exports thực hiện 1 query DB cho mỗi lần ký download — chấp nhận được.

**Refactor:**
- Neo regex exports chặt hơn hoặc lưu mapping key→quoteId thay vì parse quoteNumber từ key.
- Cân nhắc audit cho delete kèm namespace/owner để truy vết admin xóa logo dùng chung.
- Trích ALLOWED_TYPES/sniff sang module storage chung nếu dùng lại ở nơi khác.

Scores → Quality 89 · Security 91 · Maintainability 89 · Enterprise 89

---

### `src/routes/billing.routes.js`  — Clean Code 82/100
**Mục đích:** API quản lý gói cước Stripe: catalog gói, subscription hiện tại, usage/quota, checkout, và webhook Stripe.

**Issues:**
- Webhook handler (dòng 140-159) không idempotent ở tầng route: Stripe gửi lại event (at-least-once) sẽ gọi applyStripeSubscription nhiều lần — cần đảm bảo hàm này idempotent hoặc lưu event.id đã xử lý (dedupe table).
- GET /usage trộn 'exports30d' từ usageSum('exports.run') nhưng quotes30d tính bằng count 30 ngày — hai metric dùng nguồn/khung thời gian khác nhau, nhãn 'quotesPerMonth' vs '30 ngày trượt' dễ gây nhầm.
- POST /plans (dòng 47) tạo plan trực tiếp từ req.body — nếu schema thêm field sẽ ghi nguyên khối; hiện validate đủ nên chấp nhận được, nhưng dùng req.body làm data của Prisma create là pattern dễ rò field về sau.

**Security:**
- Webhook chỉ cấu hình khi STRIPE_WEBHOOK_SECRET tồn tại; nếu thiếu trả 503 (đúng). Không có lỗ hổng rõ ràng vì chữ ký được verify bằng constructEvent.

**Refactor:**
- Tách hàm serialize plan (priceMonth/priceYear -> Number) thành helper dùng chung cho /plans, /subscription, /usage thay vì lặp 3 lần.
- Thêm bảng/processedEvents để dedupe webhook event.id, hoặc kiểm tra trong applyStripeSubscription.

Scores → Quality 82 · Security 85 · Maintainability 83 · Enterprise 80

---

### `src/routes/gdpr.routes.js`  — Clean Code 80/100
**Mục đích:** Tuân thủ GDPR: xuất dữ liệu cá nhân (self/admin) và xoá-mềm/anonymize tài khoản (self/admin).

**Issues:**
- Trong /me/export (dòng 66-71) gọi res.end(...) RỒI mới await audit(...) — audit chạy sau khi response đã đóng; nếu audit throw thì asyncHandler không thể gửi lỗi (response đã end). Nên audit trước khi end, hoặc bọc try/catch. Tương tự /users/:id/export.
- exportUser tải quotes kèm sheets.items không giới hạn — user nhiều báo giá lớn có thể tạo payload rất lớn (OOM/timeout); auditEvents/notifications đã take 5000 nhưng quotes/customers thì không.
- Anonymize đặt username = `deleted-${id}-${Date.now()}` — không có ràng buộc unique fail-safe nếu cùng id xoá 2 lần (đã chặn double-self-delete gián tiếp qua active:false nhưng không tường minh).

**Security:**
- exportUser trả refreshTokens (id/family/ip/userAgent) — không phải secret token thật nên ổn; chỉ là metadata. Chấp nhận được cho DSAR.

**Performance:**
- Không phân trang/streaming khi export; với user có nhiều quote+sheet+item, JSON.stringify toàn bộ trong RAM có thể nặng.

**Refactor:**
- Gộp logic anonymize self/admin (dòng 99-148) thành 1 helper anonymizeUser(id) để loại trùng lặp gần như y hệt.
- Đặt audit trước res.end trong cả 2 route export.
- Cân nhắc giới hạn take cho quotes/customers hoặc stream NDJSON.

Scores → Quality 80 · Security 86 · Maintainability 78 · Enterprise 82

---

### `src/routes/apiKeys.routes.js`  — Clean Code 85/100
**Mục đích:** Quản lý API key (admin): liệt kê, tạo (trả key 1 lần, lưu hash SHA-256), thu hồi (soft-disable).

**Issues:**
- DELETE /:id dùng prisma.apiKey.update không bắt lỗi — id không tồn tại sẽ ném P2025 -> 500 thay vì 404. Nên dùng updateMany hoặc findUnique trước, hoặc .catch.
- DELETE thực chất là disable (active:false) nhưng route là DELETE — semantics ổn cho audit nhưng audit action 'apikey.revoke' nên kèm tên/ngữ cảnh.

**Security:**
- Key dùng SHA-256 không salt làm keyHash (dòng 41) — chấp nhận được vì key có entropy cao (randomBytes 24), không brute-force được; không cần KDF chậm. Không phải lỗ hổng.
- Không giới hạn số lượng key/expiry bắt buộc — minor; admin-only.

**Refactor:**
- DELETE: chuyển sang updateMany({ where:{id, active:true} }) và trả 404 nếu count=0 để phản hồi đúng.
- Thêm endpoint rotate key (tạo mới + disable cũ) nếu cần vận hành lâu dài.

Scores → Quality 84 · Security 88 · Maintainability 86 · Enterprise 84

---

### `src/routes/mfa.routes.js`  — Clean Code 84/100
**Mục đích:** Thiết lập/bật/tắt MFA TOTP: setup tạo secret+QR, enable xác minh & lưu secret mã hoá + backup codes hash, disable bằng TOTP hoặc backup code.

**Issues:**
- POST /setup và /enable đọc user bằng findUnique nhưng không kiểm tra user tồn tại trước khi truy cập user.mfaEnabled (dòng 26-27, 47-48) — nếu session trỏ tới user đã xoá thì user=null -> TypeError 500. Nên guard null.
- Disable bằng backup code (dòng 81) gọi consumeBackupCode chỉ để xác thực nhưng không dùng 'remaining' (hợp lý vì disable xoá hết codes), tuy nhiên đọc kỹ thì OK.
- Không có rate-limit cục bộ ở /enable, /disable cho việc đoán mã (window:1) — nếu lớp middleware/rate-limit toàn cục không phủ thì có thể brute TOTP; nên xác nhận rate-limit áp lên router này.

**Security:**
- Không yêu cầu nhập lại mật khẩu khi bật/tắt MFA — kẻ chiếm session có thể tắt MFA bằng backup code đang hiển thị; cân nhắc step-up auth (re-enter password) cho disable.
- Secret mã hoá AES-256-GCM at-rest (đã hardening), backup code hash SHA-256, fail-closed khi key xoay — thiết kế tốt.

**Refactor:**
- Thêm null-check user ở cả 3 handler (hoặc helper getSessionUser ném 401 nếu mất).
- Bổ sung re-authentication (password) cho /disable.
- Đảm bảo rate-limiter áp cho /enable, /disable.

Scores → Quality 84 · Security 83 · Maintainability 86 · Enterprise 82

---

### `src/routes/notifications.routes.js`  — Clean Code 90/100
**Mục đích:** Thông báo của người dùng: liệt kê (phân trang/lọc unread), đếm chưa đọc, đánh dấu đã đọc 1 cái / tất cả.

**Issues:**
- Không có lỗi logic đáng kể. updateMany scope theo userId nên không IDOR.
- z.coerce.boolean() ở query 'unread': mọi chuỗi non-empty (kể cả 'false','0') đều coerce thành true — 'unread=false' vẫn lọc unread. Nên dùng enum/transform rõ ràng (vd chỉ chấp nhận '1'/'true').

**Performance:**
- count + findMany song song qua Promise.all (tốt). Với bảng lớn nên có index (userId, readAt, createdAt) — đã có partial index theo ghi chú session.

**Refactor:**
- Chuẩn hoá parse boolean cho 'unread' (transform 'true'/'1' -> true, mặc định false).

Scores → Quality 89 · Security 92 · Maintainability 90 · Enterprise 88

---

### `src/routes/permissions.routes.js`  — Clean Code 92/100
**Mục đích:** Phơi catalog quyền + ma trận role→permission (cho màn Phân quyền) và quyền hiệu lực của chính người gọi.

**Issues:**
- Import PERMISSIONS/PERMISSION_GROUPS... tách thành 2 câu import từ cùng module './permissions.js' (dòng 3-7) — gộp lại 1 import cho gọn.
- Không có bug logic; read-only, tĩnh.

**Security:**
- /catalog yêu cầu USER_MANAGE (đúng); /me chỉ trả quyền của bản thân (an toàn).

**Refactor:**
- Gộp 2 import từ ../permissions.js thành một.
- Cân nhắc cache JSON catalog (tĩnh) nếu được gọi thường xuyên — không bắt buộc.

Scores → Quality 91 · Security 92 · Maintainability 92 · Enterprise 90

---

### `src/routes/meta.routes.js`  — Clean Code 84/100
**Mục đích:** Metadata cho UI: danh sách công ty + template (kèm layout cột Chi Tiết/Số Ngày) và template theo companyId.

**Issues:**
- GET /templates: parseInt(req.query.companyId,10) không validate; companyId không phải số -> NaN, where.companyId=NaN khiến Prisma ném lỗi -> 500. Nên dùng validate({query}) với z.coerce.number().int().optional() và bỏ filter nếu undefined.
- templateLayout gọi getConfig(t.code) cho TỪNG template trên mỗi request (companies có thể N templates) — nếu getConfig không cache sẽ lặp lại; theo ghi chú session đã có template cache nên chấp nhận được.

**Performance:**
- withLayout chạy getConfig per-template; xác nhận getConfig dùng cache (đã có template cache trong session) để tránh đọc/parse lặp.

**Refactor:**
- Thêm validate query cho /templates (companyId optional int).
- Trả layout từ một map đã tính sẵn nếu danh sách template cố định.

Scores → Quality 83 · Security 88 · Maintainability 85 · Enterprise 84

---

### `src/routes/settings.routes.js`  — Clean Code 76/100
**Mục đích:** Cài đặt hệ thống dạng key→value JSON: đọc tất cả/đọc theo key (mọi user), ghi/xoá (chỉ admin).

**Issues:**
- PUT /:key dùng body: z.any() — chấp nhận bất kỳ JSON nào, không giới hạn kích thước/độ sâu; admin-only nhưng vẫn nên giới hạn payload size để tránh lưu blob lớn.
- GET / trả TẤT CẢ settings cho mọi user đã đăng nhập — nếu có key nhạy cảm (vd cấu hình tích hợp, token) sẽ lộ. Cần phân loại key public vs admin-only hoặc whitelist key đọc công khai.

**Security:**
- Stored-data injection: value lưu nguyên (z.any) và GET / phơi cho mọi user; nếu client render value không escape -> stored XSS. Nên kiểm soát loại value và escape phía client.
- GET / không lọc key nhạy cảm — rủi ro lộ cấu hình nếu sau này lưu secret vào settings.

**Refactor:**
- Định nghĩa allowlist key 'public-readable'; các key khác chỉ admin đọc.
- Thay z.any() bằng schema theo key (hoặc ít nhất giới hạn kích thước JSON).
- DELETE đang nuốt lỗi bằng .catch(()=>{}) rồi vẫn trả ok — nếu key không tồn tại vẫn ghi audit 'settings.delete'; cân nhắc trả 404 khi không có gì bị xoá.

Scores → Quality 76 · Security 70 · Maintainability 80 · Enterprise 72

---

### `src/routes/search.routes.js`  — Clean Code 85/100
**Mục đích:** Tìm kiếm đa thực thể (quote/customer/product) bằng ILIKE, có áp scope quyền cho quote và customer.

**Issues:**
- Product search KHÔNG áp scope quyền (dòng 77-91) — mọi user đã đăng nhập đều tìm/thấy toàn bộ product; nếu product là dữ liệu chung thì OK, nhưng nên xác nhận chủ ý.
- types parse bằng split(',') không lọc giá trị lạ — type không hợp lệ bị bỏ qua êm (ổn), nhưng không trả lỗi cho input sai.

**Security:**
- quoteScopeWhere + custScope áp đúng IDOR cho quote/customer (tốt). Product thiếu scope — chỉ là vấn đề nếu product nhạy cảm theo người dùng.

**Performance:**
- Mỗi nhánh dùng nhiều OR contains insensitive trên cột text — không dùng index (sequential scan) khi dữ liệu lớn; ghi chú trong file đã đề xuất tsvector/Meilisearch. Chấp nhận cho quy mô nội bộ.

**Refactor:**
- Nếu product cần scope, thêm điều kiện ownerId/visibility.
- Tách 3 nhánh tìm kiếm thành các hàm searchQuotes/searchCustomers/searchProducts để dễ test.

Scores → Quality 85 · Security 84 · Maintainability 85 · Enterprise 82

---

### `src/routes/jobs.routes.js`  — Clean Code 88/100
**Mục đích:** Export bất đồng bộ qua queue: enqueue export báo giá (có authz theo quyền xem quote) và poll trạng thái job (có authz theo người yêu cầu).

**Issues:**
- GET /jobs/:queue/:id trả về toàn bộ job.data và job.returnvalue — job.data chứa requestedBy, returnvalue có thể chứa presigned URL; authz đã chặn người không phải owner/read-all (tốt). OK.
- requireAuth áp per-route (đã giải thích bằng comment) — đúng vì mount ở /api root.
- Không kiểm tra :queue có nằm trong danh sách QUEUES hợp lệ trước getQueue — getQueue trả null thì 404 (ổn), nhưng nên enum hoá queue.

**Security:**
- Authz IDOR đã xử lý ở cả enqueue (canOnQuote read) và poll (requestedBy hoặc QUOTE_READ_ALL) — tốt, đúng như mục tiêu hardening.

**Refactor:**
- Ràng buộc :queue bằng z.enum(Object.values(QUEUES)) thay cho string tự do.
- Cân nhắc chỉ trả subset của returnvalue/data cần cho client thay vì dump nguyên.

Scores → Quality 88 · Security 90 · Maintainability 88 · Enterprise 87

---

### `src/routes/stream.routes.js`  — Clean Code 92/100
**Mục đích:** Kênh SSE realtime: gắn kết nối /events cho user đã đăng nhập (đẩy thông báo/sự kiện).

**Issues:**
- Mỏng, chỉ uỷ thác cho attach() trong sse.js — không có vấn đề tại đây. Cần đảm bảo attach xử lý heartbeat/cleanup khi client ngắt (ngoài phạm vi file).

**Security:**
- requireAuth áp đúng; attach nhận userId từ session để cô lập kênh theo user (an toàn nếu sse.js không broadcast chéo).

**Performance:**
- SSE giữ kết nối lâu — rủi ro về số connection nếu nhiều client; quản lý ở sse.js (ngoài file).

**Refactor:**
- Không cần — giữ mỏng. Đảm bảo sse.js có heartbeat + dọn listener (kiểm tra riêng).

Scores → Quality 90 · Security 90 · Maintainability 92 · Enterprise 88

---

### `src/routes/webhooks.routes.js`  — Clean Code 83/100
**Mục đích:** CRUD webhook (admin): tạo/sửa có chặn SSRF (assertPublicHttpUrl), liệt kê, xem deliveries; secret tự sinh nếu thiếu.

**Issues:**
- GET / (dòng 24-27) trả nguyên row webhook gồm cả trường secret — admin-only nhưng phơi secret ra UI/list là không cần thiết; nên select bỏ secret (chỉ trả khi tạo, hoặc che). POST/PUT cũng res.json(row) gồm secret (POST hợp lý vì cần đưa secret 1 lần; PUT thì không nên).
- DELETE dùng prisma.webhook.delete không bắt lỗi — id không tồn tại -> P2025 500 thay vì 404 (idParam đã validate dương nhưng không đảm bảo tồn tại).
- PUT với Create.partial() cho phép cập nhật 'secret' tuỳ ý — chấp nhận được cho admin nhưng nên tách route rotate-secret riêng.

**Security:**
- Chống SSRF tốt: assertPublicHttpUrl chặn private/loopback/metadata + pin IP khi giao, không follow redirect, không echo body (chỉ len) — đúng hardening.
- Lộ secret qua GET list/PUT response: với admin nội bộ rủi ro thấp, nhưng nên mask để tránh ghi log/expose vô tình.

**Refactor:**
- Thêm select loại bỏ secret ở GET / (và PUT response), chỉ trả secret duy nhất khi POST tạo.
- DELETE: dùng deleteMany hoặc try/catch trả 404 khi không có bản ghi.
- Tách endpoint POST /:id/rotate-secret riêng thay vì cho sửa secret qua PUT chung.

Scores → Quality 83 · Security 84 · Maintainability 84 · Enterprise 83

---

### `src/queue.js`  — Clean Code 84/100
**Mục đích:** Lớp trừu tượng hàng đợi BullMQ/Redis với cơ chế chạy nội tuyến (inline) khi không có REDIS_URL cho môi trường dev.

**Issues:**
- runOrQueue khi inline (dòng 49-55) chạy job ngay trong tiến trình request, đồng bộ — một export xlsx/pdf lớn sẽ block event loop của web server. Hành vi này khác hẳn so với chạy qua Redis (off-thread), dễ gây nhầm lẫn về hiệu năng giữa dev/prod.
- Inline fallback không có retry/backoff như defaultJobOptions (attempts:3), nên ngữ nghĩa khác nhau giữa hai chế độ — lỗi tạm thời sẽ throw ngay thay vì retry.
- Không có hàm đóng kết nối Redis/queue khi shutdown ở phía web (chỉ worker.js xử lý SIGTERM cho workers); connection IORedis có thể giữ tiến trình.

**Performance:**
- Inline execution chặn event loop cho job nặng (export). Trong prod luôn có Redis nên ít rủi ro, nhưng nên log cảnh báo rõ khi rơi vào nhánh inline cho job thuộc EXPORT.

**Refactor:**
- Tách map QUEUES lên đầu file trước getQueue cho dễ đọc (hiện khai báo sau).
- Thêm hàm closeQueues()/quit() để gọi khi graceful shutdown của web process.
- Cân nhắc thống nhất ngữ nghĩa retry giữa inline và queued (ví dụ inline cũng bọc try nhẹ hoặc ghi rõ là best-effort).

Scores → Quality 85 · Security 90 · Maintainability 84 · Enterprise 82

---

### `src/worker.js`  — Clean Code 83/100
**Mục đích:** Tiến trình worker BullMQ: định nghĩa map processors (export xlsx/pdf, email, webhook, telegram) và khởi chạy worker đăng ký theo từng queue.

**Issues:**
- Detect entrypoint ở dòng 89 dùng process.argv[1].replaceAll('\\','/') — phụ thuộc đường dẫn, dễ hỏng khi chạy qua npm script/symlink/pm2; nên ưu tiên cờ rõ ràng WORKER_MODE (đã có) và coi suy luận đường dẫn là phụ.
- buildQuoteBuffer/renderQuotePdf chạy trong worker — nếu các hàm này dùng worker_threads bên trong thì OK; nhưng nếu nặng CPU và concurrency=4 thì một worker process có thể bão hòa CPU. Nên tách concurrency cho EXPORT thấp hơn so với email/notify.
- Nhánh trả về 'inline: buf.toString(base64)' (dòng 42,70) khi không có storage: payload base64 lớn sẽ nằm trong kết quả job lưu ở Redis (removeOnComplete:1000) — có thể phình bộ nhớ Redis. Trong prod luôn bật storage nên rủi ro thấp.

**Security:**
- metadata.requestedBy/quoteId được ép String và đưa vào S3 metadata — an toàn. Không thấy lỗ hổng.

**Performance:**
- Concurrency chung (mặc định 4) áp cho cả EXPORT (CPU-bound) lẫn EMAIL/NOTIFY (IO-bound) — nên cấu hình concurrency riêng theo queue.
- Hai handler xlsx/pdf trùng lặp logic truy vấn quote + nhánh storage/inline; có thể trích hàm dùng chung loadQuote(quoteId) và persistExport(key, buf, type).

**Refactor:**
- Trích helper loadQuoteForExport(quoteId) và uploadAndPresign(key, buf, contentType, meta) để khử trùng lặp giữa xlsx và pdf.
- Cho phép map concurrency theo queue: { export: 1-2, email: 8, notify: 8 }.
- SIGINT cũng nên được xử lý cùng SIGTERM cho graceful shutdown khi chạy local.

Scores → Quality 84 · Security 90 · Maintainability 82 · Enterprise 83

---

### `src/webhooks.js`  — Clean Code 90/100
**Mục đích:** Hệ thống webhook ra ngoài: chống SSRF (chặn IP nội bộ + ghim IP đã phân giải), ký HMAC, phát sự kiện và giao nhận có ghi log.

**Issues:**
- emit() (dòng 137-138) load TẤT CẢ webhook active rồi filter trong JS theo events.includes(event). Với nhiều webhook sẽ kém hiệu quả; có thể lọc ngay ở DB bằng has: event trên trường String[] (Postgres array). Nhỏ ở quy mô hiện tại.
- assertPublicHttpUrl chỉ ghim addrs[0] (dòng 77); nếu host phân giải nhiều IP và IP[0] sau đó không kết nối được, không thử IP khác — chấp nhận được vì ưu tiên an toàn, nhưng giảm độ bền.
- postToPinnedIp không giới hạn kích thước response đọc; tuy chỉ đếm độ dài (không buffer) nên an toàn về bộ nhớ, nhưng một server cố tình stream vô hạn sẽ giữ kết nối tới khi timeout 15s — chấp nhận được.

**Security:**
- SSRF được xử lý rất tốt: chặn private/reserved/CGNAT/link-local/IPv4-mapped, ép https ở prod, ghim IP chống DNS rebinding, không follow redirect, không echo body response (chỉ len). Đây là điểm mạnh.
- Lưu ý nhỏ: deliverWebhook re-resolve qua assertPublicHttpUrl mỗi lần giao nhận (tốt cho an toàn TOCTOU). Không có vấn đề.
- h.secret dùng làm khóa HMAC lấy thẳng từ DB — đảm bảo secret đủ ngẫu nhiên khi tạo webhook (kiểm tra ở route tạo, ngoài phạm vi file này).

**Performance:**
- emit() nạp toàn bộ webhook active mỗi lần phát sự kiện (không cache, không lọc DB theo event). Nên dùng where events.has event hoặc cache danh sách webhook ngắn hạn.

**Refactor:**
- Lọc webhook ngay ở Prisma: prisma.webhook.findMany({ where: { active: true, events: { has: event } } }).
- Tách postToPinnedIp ra module net riêng để tái dùng cho các fetch server-side khác cần chống SSRF (vd kiểm tra logo URL).
- Thêm giới hạn body response đọc (vd hủy nếu len vượt ngưỡng) để phòng abuse.

Scores → Quality 90 · Security 95 · Maintainability 88 · Enterprise 90

---

### `src/storage.js`  — Clean Code 89/100
**Mục đích:** Lớp bao S3 (MinIO/AWS): upload/download/delete/head, presign tải xuống/tải lên với mặc định Content-Disposition attachment để chống XSS lưu trữ.

**Issues:**
- presignUpload (dòng 96-100) không ép ContentDisposition/giới hạn — đây là URL ký để client PUT trực tiếp; cần đảm bảo phía route gọi nó kiểm soát key + contentType chặt (allowlist) vì client tự upload nội dung. Trong phạm vi file thì không tự kiểm soát được.
- ensureBucket dùng catch trống để suy luận bucket không tồn tại — HeadBucket có thể fail vì lý do khác (quyền, mạng) rồi nhảy sang CreateBucket gây lỗi khó hiểu. Nên phân biệt mã lỗi 404 vs 403.
- putObject mặc định attachment là tốt, nhưng caller logo (ảnh hiển thị inline) phải nhớ truyền contentDisposition phù hợp — dễ quên (xem refactor).

**Security:**
- Tốt: mặc định ContentDisposition=attachment ở putObject và presignDownload (sanitize filename qua regex) — phòng stored-XSS hiệu quả.
- ResponseContentDisposition nhúng safeName đã lọc [^A-Za-z0-9._-] nên không thể header-inject. An toàn.

**Refactor:**
- Trong ensureBucket, kiểm tra e.$metadata?.httpStatusCode/e.name để chỉ tạo bucket khi 404; còn 403 thì log và trả false thay vì thử tạo.
- Cân nhắc một presignDisplayUrl riêng cho ảnh (inline) thay vì truyền cờ inline rải rác, để mặc định an toàn vẫn là attachment.

Scores → Quality 88 · Security 92 · Maintainability 88 · Enterprise 87

---

### `src/sse.js`  — Clean Code 86/100
**Mục đích:** Broker Server-Sent Events trong bộ nhớ, theo userId: attach/publish/broadcast cùng các tiện ích revoke/refresh phiên và emitChange cho realtime refresh.

**Issues:**
- In-memory subscribers → không hoạt động đa instance (đã ghi chú ở dòng 2). Với prod single-instance qua pm2 thì OK; nếu scale ngang phải chuyển sang Redis pub/sub.
- Không giới hạn số kết nối SSE trên mỗi user — một client mở nhiều tab/bug reconnect có thể tích lũy nhiều res. Keepalive 25s mỗi kết nối, nhưng req.on('close') có dọn dẹp nên rò rỉ thấp.
- broadcast/emitChange gửi tới MỌI user; emitChange chỉ là gợi ý refresh (client tự fetch theo quyền) nên an toàn về dữ liệu, nhưng tạo nhiễu/tải khi nhiều client. Chấp nhận ở quy mô nội bộ.

**Security:**
- publish theo userId đúng (không lộ chéo). emitChange chỉ gửi metadata entity/action/id (id ép String) — không lộ nội dung nhạy cảm; client re-fetch qua API phân quyền. An toàn.
- Cần đảm bảo route gắn attach() đã xác thực userId (ngoài phạm vi file).

**Performance:**
- Mỗi keepalive là một setInterval riêng cho mỗi kết nối; với rất nhiều kết nối số timer tăng tuyến tính. Có thể dùng một interval chung quét toàn bộ. Nhỏ ở quy mô hiện tại.

**Refactor:**
- Gộp keepalive vào một interval toàn cục thay vì một interval/kết nối.
- Thêm giới hạn tối đa kết nối/user và dọn các res đã ghi lỗi (hiện catch nuốt lỗi mà không gỡ res chết).
- Khi write lỗi trong publish/broadcast, nên gỡ res khỏi set thay vì chỉ bỏ qua, để tránh giữ socket chết.

Scores → Quality 85 · Security 90 · Maintainability 84 · Enterprise 82

---

### `src/notifications.js`  — Clean Code 85/100
**Mục đích:** Tạo thông báo in-app (nguồn sự thật + đẩy SSE) và fan-out email/telegram theo tùy chọn kênh và liên hệ của người dùng.

**Issues:**
- shouldDeliver (dòng 64): pref==='important' chỉ gửi khi notif.important; nghĩa là 'important' KHÔNG bao gồm các thông báo thường — đúng ý đồ, nhưng tên 'important' dễ hiểu nhầm là 'gửi cả quan trọng lẫn thường'. Nên ghi rõ trong tài liệu UI.
- prefs lấy từ Setting 'notif.channels' (.value là Json) mà không kiểm tra kiểu — nếu value không phải object (vd null/string) thì prefs.email undefined → shouldDeliver(undefined) trả false (an toàn, không gửi), nhưng nên chuẩn hóa.
- email/telegram được runOrQueue tuần tự với await (dòng 67, 81); nếu chạy inline (no Redis) sẽ làm notify chậm. Trong prod có queue nên off-thread.

**Security:**
- escapeHtml áp cho title/body/link trong email HTML — tốt, chống injection vào email. Lưu ý: link được escape làm thuộc tính href, nếu link là 'javascript:...' vẫn lọt vào href (escapeHtml không chặn scheme). Nên kiểm tra link bắt đầu http(s) trước khi render thẻ a.
- Telegram text dùng parse_mode Markdown với title/body chưa escape ký tự Markdown — không phải lỗ hổng bảo mật nghiêm trọng nhưng có thể vỡ định dạng/diễn giải sai (xem telegram.js).

**Performance:**
- Hai truy vấn Setting (notif.channels và telegram.user.<id>) tách rời; truy vấn telegram được gọi cả khi prefs.telegram='off' (vẫn đọc Setting trước khi check shouldDeliver). Nên kiểm tra shouldDeliver(prefs.telegram) TRƯỚC khi truy vấn telegram.user.<id> để tiết kiệm 1 query.

**Refactor:**
- Validate scheme của notif.link (chỉ cho http/https) trước khi nhúng vào href email.
- Đảo thứ tự: chỉ truy vấn telegram.user.<id> khi shouldDeliver(prefs.telegram) là true.
- Chuẩn hóa prefs: const prefs = (typeof v==='object' && v) ? v : default.

Scores → Quality 84 · Security 82 · Maintainability 85 · Enterprise 83

---

### `src/email.js`  — Clean Code 86/100
**Mục đích:** Lớp gửi email qua nodemailer/SMTP, no-op khi thiếu SMTP_HOST, không bao giờ throw (chỉ log và trả kết quả).

**Issues:**
- init() đặt configured=true ngay cả khi không có host (dòng 9), nên nếu SMTP được cấu hình sau khi tiến trình đã chạy (ít gặp) sẽ không re-init. Chấp nhận được vì config qua env lúc boot.
- Đọc trực tiếp process.env (SMTP_*) thay vì qua module config tập trung — không nhất quán với phần còn lại của codebase (telegram/billing dùng config.js).
- Không gọi transporter.verify() lúc khởi tạo nên lỗi cấu hình SMTP chỉ lộ ra khi gửi email đầu tiên.

**Security:**
- from mặc định 'noreply@example.local' khi thiếu SMTP_FROM — vô hại nhưng nên cảnh báo cấu hình.
- Không có vấn đề bảo mật đáng kể; nội dung HTML do caller chịu trách nhiệm escape (notifications.js đã escape).

**Refactor:**
- Chuyển đọc SMTP_* qua module config.js để thống nhất và validate.
- Cân nhắc transporter.verify() khi init (best-effort, log) để phát hiện sai cấu hình sớm.
- Pool kết nối (pool:true) nếu khối lượng email tăng.

Scores → Quality 85 · Security 88 · Maintainability 84 · Enterprise 83

---

### `src/telegram.js`  — Clean Code 86/100
**Mục đích:** Gửi tin nhắn Telegram qua Bot API với timeout 8s, no-op khi thiếu TELEGRAM_BOT_TOKEN, không throw.

**Issues:**
- parse_mode mặc định 'Markdown' (legacy) với text chứa ký tự đặc biệt (_, *, [, `) chưa escape — dễ gây lỗi 'can't parse entities' từ Telegram, làm rớt thông báo. Nên dùng MarkdownV2 + escape, hoặc parse_mode HTML + escape, hoặc gửi plain text nếu không cần định dạng.
- Không retry ở tầng này (dựa vào BullMQ attempts khi qua queue); khi chạy inline thì mất tin nếu lỗi tạm thời.
- Không validate chatId.

**Security:**
- Token nằm trong URL request tới api.telegram.org qua HTTPS — chuẩn của Telegram, chấp nhận được. Không log token. An toàn.
- disable_web_page_preview:true tốt (tránh server Telegram fetch link người dùng).

**Refactor:**
- Thêm hàm escape cho Markdown/MarkdownV2 và áp cho text trước khi gửi, hoặc đổi sang parse_mode='HTML' với escape thống nhất với email.
- Cho phép truyền parseMode='none'/undefined để gửi plain text an toàn cho nội dung do người dùng nhập.

Scores → Quality 84 · Security 90 · Maintainability 86 · Enterprise 84

---

### `src/billing.js`  — Clean Code 82/100
**Mục đích:** Lớp bao Stripe (no-op khi thiếu key): ghi/aggregate usage, lấy subscription đang hoạt động, kiểm tra quota và đồng bộ subscription từ event Stripe.

**Issues:**
- Quan trọng (maintainability): apiVersion ghim '2024-12-18.acacia' (dòng 14) nhưng package stripe là ^22.x. Từ API version 2025 (basil) trở đi, current_period_end/current_period_start ĐÃ bị bỏ khỏi đối tượng Subscription và chuyển vào subscription items. Code applyStripeSubscription đọc stripeSub.current_period_end (dòng 88,97) hiện CHỈ chạy được vì còn ghim apiVersion cũ; khi nâng apiVersion sẽ trả undefined → currentPeriodEnd luôn null. Cần ghi chú/khoá rõ ràng và có kế hoạch migrate sang items[].current_period_end.
- checkQuota dùng used < limit (dòng 70) — đây là kiểm tra TRƯỚC khi tạo; ngữ cảnh gọi cần chắc chắn gọi trước khi thêm bản ghi, nếu không sẽ off-by-one (cho phép vượt 1).
- usageSum default window 30 ngày cố định; recordUsage là fire-and-forget nuốt lỗi (chấp nhận với metric không quan trọng).

**Security:**
- applyStripeSubscription nên CHỈ được gọi sau khi verify chữ ký Stripe webhook (xác minh ở route webhook Stripe, ngoài phạm vi file). Bản thân hàm tin tưởng dữ liệu stripeSub đầu vào.
- Không lộ secret; getStripe gated theo key. An toàn trong phạm vi file.

**Performance:**
- checkQuota gọi getActiveSubscription (1 query) + 1 count tùy field — hợp lý. count quote theo cửa sổ 30 ngày cần index trên createdAt (kiểm tra schema; session này đã thêm partial indexes).

**Refactor:**
- Đọc current_period_end/current_period_start từ stripeSub.items.data[0] để tương thích API mới, hoặc thêm fallback: stripeSub.current_period_end ?? stripeSub.items.data[0]?.current_period_end.
- Đưa apiVersion vào config/hằng số có comment rõ ràng về ràng buộc trường period.
- Trích map field->đếm trong checkQuota thành bảng tra để dễ mở rộng metric.

Scores → Quality 82 · Security 88 · Maintainability 78 · Enterprise 80

---

### `C:\Users\Admin\Desktop\QuanLY\public\app.js`  — Clean Code 82/100
**Mục đích:** SPA một-file (no-build) cho toàn bộ frontend quản lý báo giá: router hash, login/MFA/onboard, danh sách, wizard tạo báo giá, editor lưới kiểu Excel, preview xlsx, dashboard, CRM khách hàng, nhân viên, duyệt, thông báo, audit, phân quyền, modal/SSE realtime.

**Issues:**
- Dead/unreachable code: renderProducts(), editProduct(), renderSettings() và openMatrixBuilder() được định nghĩa nhưng renderMain() (dòng 671-685) KHÔNG route tới 'products' hay 'settings', và không có mục nav nào trỏ tới — toàn bộ UI Sản phẩm + Quy tắc duyệt (matrix) không thể truy cập từ ứng dụng. Hoặc thiếu nav/route, hoặc nên xóa.
- parseInt thiếu radix nhiều nơi: pickCustomer (dòng 2885 `parseInt(d.dataset.id)`), renderCustomers (2854 `parseInt(b.dataset.edit)`, ngầm trong del), renderProducts (2956). Khác với phần editor đều dùng radix 10 — không nhất quán; rủi ro thấp với id số nhưng nên thống nhất `parseInt(x, 10)`.
- state._managers cache (dòng 941-950) chỉ load 1 lần cho cả vòng đời SPA; nếu admin thêm/đổi quản lý trong phiên, picklist 'Quản lý phụ trách'/'Người gửi' trong wizard sẽ cũ cho tới khi reload trang.
- Trong drawList (dòng 814-815) start/end tính theo PAGE_SIZE cố định; nếu server trả size khác request thì nhãn 'Hiển thị x–y' có thể lệch (phụ thuộc server tôn trọng size).
- renderEditor: nút 'Đánh dấu đã chốt' (btn-convert) chỉ hiện khi can('quote:send') (dòng 1328) — gắn convert vào quyền 'send' hơi gượng về mặt ngữ nghĩa (server vẫn là nguồn chân lý nên không phải lỗ hổng, chỉ là UI dễ gây nhầm).
- promptModal/confirmModal dựa vào onClose(wasSaved) + cờ resolved/done để phân biệt hủy vs lưu — logic đúng nhưng tinh tế; dễ vỡ nếu sau này ai sửa luồng close() của openModal.

**Security:**
- openPasswordModal (dòng 2619): ô 'Mật khẩu mới' dùng type="text" nên mật khẩu admin đặt cho nhân viên hiển thị plaintext trên màn hình (shoulder-surfing); nên dùng type="password" (có thể kèm nút hiện/ẩn). Rủi ro thấp (chỉ admin, nội bộ) nhưng không nhất quán với các form mật khẩu khác.
- Logo khách được nhúng từ FileReader (dòng 1108) và đẩy thẳng vào state rồi gửi server; client chỉ chặn >2MB và accept=image/png,jpeg. safeLogoSrc() đã chặn render data-URL không phải ảnh nên không có XSS phía client — cần đảm bảo server cũng validate (ngoài phạm vi file này).

**Performance:**
- drawItems làm tbody.innerHTML lại toàn bộ + rebind listener cho mỗi input/textarea trên mỗi thao tác cấu trúc (thêm/xóa/undo/paste). Với báo giá rất nhiều dòng (vài trăm) sẽ chậm dần. Đã được giảm thiểu hợp lý: gõ trong ô chỉ cập nhật cell amount + summary tại chỗ, không redraw; chấp nhận được cho quy mô nội bộ.
- renderQuoteSummary được dựng lại toàn bộ innerHTML trên mỗi keystroke số (updateSummary→refreshPreview). Nhỏ, có debounce cho preview (80ms) nên ổn.

**Refactor:**
- Tách app.js (3369 dòng) thành nhiều module theo trang (list/editor/users/dashboard…) — no-build vẫn dùng được ES modules `<script type=module>`; sẽ giảm tải nhận thức và rủi ro xung đột biến global (window._gst, _fto, _ct, _pt, _cpt…).
- Gom các biến debounce gắn trên window (_gst,_fto,_ct,_pt,_cpt,_gsKeysWired…) vào một namespace (vd state._timers) để tránh ô nhiễm global và rò rỉ giữa các trang.
- Trích một helper chung cho mẫu list+toolbar+debounce-search (renderCustomers/renderProducts/renderAuditLog lặp gần như y hệt logic reload+search 300ms).
- Chuẩn hóa toàn bộ parseInt(...,10); hoặc dùng Number() cho dataset id.
- Quyết định dứt khoát với renderProducts/renderSettings/openMatrixBuilder: thêm route+nav (kèm can()) hoặc xóa để giảm dead code và mặt tấn công.

Scores → Quality 84 · Security 88 · Maintainability 72 · Enterprise 78

---

### `public/grid-clipboard.js`  — Clean Code 92/100

Module THUẦN (không DOM, không side-effect) tách riêng để unit-test phần khó của copy/paste lưới.

**Tốt:**
- `parseClipboardTSV` là máy trạng thái RFC-4180 đầy đủ (field có dấu ngoặc kép, xuống dòng/tab nhúng, `""` escape, CRLF/CR/LF, bỏ BOM, bỏ dòng trống cuối) → dán đúng ô nhiều dòng của Excel/Sheets.
- `parseLooseNumber` xử lý cả định dạng VN lẫn US, có bản vá lỗi tiền `1.234`→1234 (nghìn VN, không phải 1.234).
- `reconstructExportRows` dựng lại nhóm/nhóm con/hàng con/dòng-thông-tin từ bảng app xuất ra theo đúng quy luật export; `looksLikeExportPaste` chỉ kích hoạt khi chắc chắn (chữ nhóm 1 ký tự HOA + có cột STT thừa, dán từ cột đầu) → tránh nhận nhầm bảng ngoài.
- Có 27+ unit test (tests/gridClipboard.test.js) phủ parser, serialize round-trip, số VN/US, dựng lại nhóm với đúng dữ liệu thật, và chặn false-positive.

**Security:**
- `cellsToHTML` có `htmlEsc` (& < >) cho nội dung `<td>`; chỉ dùng cho `clipboardData.setData("text/html")` (copy ra ngoài), KHÔNG đẩy vào innerHTML → không có XSS.

**Refactor (nhỏ):**
- `reconstructExportRows`: dòng gán lại `it.quantity` cho section/subsection là dư (đã gán trong vòng `roles.forEach`) — vô hại, có thể bỏ cho gọn.

Scores → Quality 92 · Security 90 · Maintainability 93 · Enterprise 90

---

### `public/theme-init.js`  — Clean Code 90/100
**Mục đích:** Áp theme đã lưu/OS trước khi render lần đầu để tránh nháy màu (FOUC); cố tình tách thành script ngoài để CSP bỏ 'unsafe-inline'.

**Issues:**
- Dùng matchMedia trần (window ngầm định) thay vì window.matchMedia — vẫn chạy nhưng kém tường minh; nếu môi trường không có matchMedia (SSR/test) sẽ ném và rơi vào catch im lặng.
- Không validate giá trị localStorage 'theme' (chỉ kỳ vọng dark/light) — nếu bị set giá trị lạ thì data-theme nhận giá trị đó; tác động thấp vì chỉ là attribute CSS.

**Refactor:**
- Thêm whitelist: const t = (saved === 'dark' || saved === 'light') ? saved : (prefersDark ? 'dark' : 'light').
- Dùng window.matchMedia tường minh cho rõ ràng.

Scores → Quality 92 · Security 95 · Maintainability 90 · Enterprise 88

---

### `prisma/schema.prisma`  — Clean Code 88/100
**Mục đích:** Schema Prisma/Postgres cho app báo giá: User/MFA/refresh token, Company/Template, CRM, Product, Quote+Sheet+Item+Version, Approval matrix, Notification, Audit, Billing scaffold, Webhook, ApiKey, session store.

**Issues:**
- Customer.code @unique là global nhưng counter (CustomerCounter) theo prefix+year — nếu reset/đổi prefix có thể đụng unique; chấp nhận được với single-tenant nhưng cần biết.
- Một số FK không khai onDelete rõ ràng và mặc định Restrict: Quote.companyId, Quote.customerId, QuoteSheet.templateId, Quote.createdById/approvedById, Approval.approverId, AuditEvent.actorId — nghĩa là không xóa cứng được Company/Template/User còn tham chiếu (đúng ý đồ giữ toàn vẹn, nhưng nên ghi chú để tránh nhầm là thiếu sót).
- Quote.discount có cột riêng nhưng money.js clamp discount khi tính total; nếu ghi total mà không đồng bộ cột discount sẽ lệch dữ liệu (xem backfill-totals.js).
- Webhook.secret và mfaSecret lưu plaintext trong DB — mfa được mô tả 'MFA-at-rest' đã mã hoá ở tầng app; cần đảm bảo secret/mfaSecret thực sự được mã hoá trước khi ghi (schema không thể hiện, chỉ là String).
- AuditEvent không có index theo (createdAt) đơn lẻ cho truy vấn theo thời gian toàn cục; hiện chỉ có composite — thường đủ.

**Security:**
- mfaSecret/mfaBackupCodes và Webhook.secret/ApiKey không thể hiện mã hoá ở schema — phải dựa vào tầng app mã hoá at-rest (đã làm trong session này); xác nhận mọi đường ghi đều đi qua lớp mã hoá.
- RefreshToken.tokenHash @unique tốt; nhưng family chỉ là String không ràng buộc — đảm bảo logic revoke-family đúng (ngoài phạm vi schema).

**Performance:**
- Bộ index khá đầy đủ (partial/composite, sort Desc cho cursor). Không thấy index thừa rõ rệt; @@index([name]) trên Customer/Product/Quote-less là full-scan-friendly nhưng chỉ hữu ích nếu query prefix/ILIKE có hỗ trợ — cân nhắc pg_trgm GIN nếu tìm kiếm theo tên nhiều.
- Quote có 7 @@index — ghi (insert/update) sẽ tốn hơn; với khối lượng nội bộ thì ổn.

**Refactor:**
- Khai báo onDelete tường minh (Restrict/SetNull) cho mọi FK còn để mặc định, kèm comment, để ý đồ rõ ràng.
- Cân nhắc GIN/pg_trgm index cho tìm kiếm theo name nếu UI có search mờ.
- Thêm comment ở mfaSecret/Webhook.secret nhắc rõ 'lưu dạng đã mã hoá' để người sau không ghi plaintext.

Scores → Quality 88 · Security 84 · Maintainability 87 · Enterprise 85

---

### `prisma/seed.js`  — Clean Code 82/100
**Mục đích:** Seed dữ liệu khởi tạo: tạo admin (sinh mật khẩu ngẫu nhiên ghi ra file .local chmod 600 thay vì stdout), upsert công ty Gia Nguyễn + Colorfull, templates, và setting kênh thông báo.

**Issues:**
- generatePassword(): base64url(12 byte) rồi replace /[_-]/g thành 'x' — làm giảm entropy (gộp 2 ký tự về 'x') và lệch phân phối; vẫn đủ mạnh thực tế nhưng có thể sinh chuỗi chỉ chữ thường+số nếu không có chữ hoa; phần '+A1' chèn cứng để thoả policy. Nên dùng bộ ký tự an toàn rõ ràng hơn.
- writeFileSync dùng flag 'wx' (fail nếu file tồn tại) trong nhánh generated — nếu file .admin-credentials.local còn sót từ lần trước, seed sẽ ném lỗi và thoát; có thể gây khó chịu khi re-seed. Cân nhắc thông báo rõ ràng/ghi đè an toàn.
- Nếu generated nhưng tạo user thành công rồi writeFileSync ném (vd permission) → admin đã tồn tại trong DB nhưng không ai biết mật khẩu; nên ghi file TRƯỚC khi create hoặc bọc try/catch để in hướng dẫn reset.
- Không xử lý ADMIN_EMAIL; User.email @unique optional nên không sao, nhưng admin seed không có email để nhận invite/khôi phục.
- BCRYPT_COST đọc từ env không validate (Number('abc') -> NaN -> bcrypt mặc định/throw).

**Security:**
- chmod 0o600 không có tác dụng trên Windows (NTFS ACL) — môi trường prod là Windows theo memory; file mật khẩu có thể không thực sự bị giới hạn quyền. Cần cảnh báo hoặc set ACL bằng icacls trên Windows.
- Mật khẩu admin nằm ở dạng plaintext trong file .local — đúng thiết kế (đọc 1 lần rồi xóa) nhưng phụ thuộc người dùng xóa thủ công; không tự xóa/expire.

**Refactor:**
- Sinh mật khẩu từ bảng ký tự xác định (gồm hoa/thường/số) đảm bảo thoả policy mà không bóp méo entropy; tránh replace mất ngẫu nhiên.
- Ghi file credentials trước khi create user, hoặc bọc try/catch để khi ghi lỗi vẫn in hướng dẫn dùng change-password/reset.
- Trên Windows dùng icacls để giới hạn ACL file credentials thay vì chỉ chmod.
- Validate Number(BCRYPT_COST) và fallback 12 nếu NaN.

Scores → Quality 84 · Security 78 · Maintainability 85 · Enterprise 80

---

### `prisma/backfill-totals.js`  — Clean Code 72/100
**Mục đích:** Script một lần: tính lại và lưu subtotal/vat/total cho mọi báo giá từ items (sửa các bản ghi legacy có total=0 khiến analytics báo doanh thu 0).

**Issues:**
- BUG đồng bộ: computeQuoteTotals trả về cả 'discount' (đã clamp) và total đã trừ discount, nhưng update chỉ ghi subtotal/vat/total — KHÔNG ghi cột Quote.discount. Nếu cột discount cũ bị lệch với discount thực dùng để tính total, dữ liệu sẽ mâu thuẫn (total phản ánh discount đã clamp còn cột discount giữ giá trị cũ). Nên ghi luôn data.discount: t.discount để nhất quán.
- So sánh 'same' chỉ kiểm subtotal/vat/total mà bỏ qua discount — một báo giá có discount cần re-clamp vẫn bị coi là 'same' và không được sửa.
- findMany không phân trang/không batch — với DB lớn sẽ nạp toàn bộ quotes + sheets + items vào RAM (one-off nên chấp nhận, nhưng nên ghi chú).
- Cập nhật tuần tự từng quote (await trong vòng lặp) — chậm trên lượng lớn; có thể gom transaction/batch.

**Performance:**
- Tải tất cả quote+sheets+items một lần (không cursor/pagination) → đỉnh bộ nhớ cao nếu dữ liệu lớn.
- Update từng dòng tuần tự, không gộp $transaction/batch → nhiều round-trip DB.

**Refactor:**
- Thêm data: { subtotal: t.subtotal, vat: t.vat, discount: t.discount, total: t.total } để khôi phục cả discount đã clamp.
- Đưa discount vào điều kiện 'same' (so sánh q.discount.equals(t.discount)).
- Phân trang theo cursor (vd take 500) và/hoặc gom update vào prisma.$transaction theo lô để giảm bộ nhớ và round-trip.
- In tổng kết kèm số quote có thay đổi discount.

Scores → Quality 70 · Security 90 · Maintainability 78 · Enterprise 72

---

### `eslint.config.js`  — Clean Code 86/100
**Mục đích:** ESLint flat config: lỗi = bug thật (biến undefined), cảnh báo = vệ sinh code (unused/dead code); cấu hình riêng cho src/prisma, public (browser SPA) và tests.

**Issues:**
- no-empty cho phép allowEmptyCatch=true ở src/public nhưng cấu hình tests không có rule no-empty (kế thừa từ recommended -> no-empty là error không cho empty catch) — tests có thể bị bắt lỗi catch rỗng khác với src; minor không nhất quán.
- eqeqeq để 'warn' (smart) thay vì error — CI chỉ fail trên error nên loose-equality vẫn lọt qua; với codebase đã harden nên cân nhắc nâng lên error.
- Không có cấu hình cho file .mjs/.cjs ngoài patterns đã liệt kê (vd scripts ở root khác src/prisma) — file js ở root khác eslint.config/vitest.config sẽ không khớp config nào -> dùng default recommended với env mặc định (có thể thiếu globals.node).
- Lặp lại khối rules (no-unused-vars/no-empty/eqeqeq) ở nhiều block — có thể tách thành shared rules object.

**Refactor:**
- Trích rule chung (no-unused-vars/no-empty/eqeqeq) ra một hằng dùng lại để tránh lặp.
- Cân nhắc nâng eqeqeq lên 'error' nếu muốn CI chặn loose-equality.
- Bổ sung pattern cho mọi *.js ở root (scripts) để tránh file rơi ngoài cấu hình ngôn ngữ Node.
- Đồng bộ rule no-empty cho block tests để nhất quán với src.

Scores → Quality 86 · Security 90 · Maintainability 84 · Enterprise 84

---

### `tests/app.smoke.test.js`  — Clean Code 90/100
**Mục đích:** Smoke test không cần DB: kiểm chứng app factory ráp đủ middleware/route (helmet, session, auth gate, CSRF origin guard, 404 JSON).

**Issues:**
- Test 'allows same-origin' (dòng 66) phụ thuộc ngầm APP_BASE_URL = http://localhost:3000, nhưng tests/setup.js không set env này — nếu config mặc định khác, test sẽ giòn. Nên set APP_BASE_URL tường minh trong setup hoặc trong test.
- Các assert kiểu not.toBe(403) (dòng 67,72) khá lỏng: chỉ chứng minh 'không bị CSRF chặn' chứ không khẳng định hành vi cụ thể (vd 401 do chưa đăng nhập). Chấp nhận được cho smoke nhưng dễ che lỗi.

**Refactor:**
- Đặt APP_BASE_URL trong tests/setup.js để các assertion same-origin không phụ thuộc giá trị mặc định ngầm.
- Cân nhắc thêm 1 assert dương cho header HSTS/Referrer-Policy nếu CSP đã được kiểm thì các header bảo mật khác cũng nên có 1 dòng kiểm.

Scores → Quality 90 · Security 92 · Maintainability 88 · Enterprise 88

---

### `tests/excel.test.js`  — Clean Code 86/100
**Mục đích:** Kiểm thử sinh file .xlsx: buildQuoteBuffer từ quote số thường, quote đã JSON-serialize (an toàn worker_thread), template CLF, và đường đi worker thật qua runExportJob.

**Issues:**
- runExportJob (dòng 48) nhận callback fallback () => buildQuoteBuffer(makeQuote()) tạo MỘT quote mới khác — nếu worker thread fail và rơi vào fallback, test vẫn xanh mà không phát hiện worker hỏng. Nên cho fallback throw để bắt buộc đi đúng đường worker, hoặc assert riêng rằng worker đã chạy.
- isXlsx chỉ kiểm header 'PK' + length > 2000 (dòng 24): không xác nhận nội dung (số tiền, sheet name). Đủ cho smoke nhưng không bắt được lỗi điền sai cell.

**Performance:**
- Test worker (dòng 47-50) timeout 20s và spawn worker_thread thật — chậm; chấp nhận được vì đây là test plumbing duy nhất.

**Refactor:**
- Cho fallback của runExportJob ném lỗi (vd () => { throw new Error('worker path not used') }) để đảm bảo test thực sự đi qua worker.
- Tách makeQuote thành fixture dùng chung với quotes.workflow nếu trùng cấu trúc, giảm lặp.

Scores → Quality 85 · Security 92 · Maintainability 86 · Enterprise 85

---

### `tests/mfa.test.js`  — Clean Code 92/100
**Mục đích:** Kiểm thử mã hóa MFA secret at-rest (AES-GCM, prefix enc:v1, IV ngẫu nhiên, tương thích plaintext cũ) và backup code (hash, consume, case-insensitive legacy).

**Issues:**
- MFA_ENC_KEY set trong beforeAll (dòng 7) trước dynamic import — đúng thứ tự, nhưng nếu một test file khác đã import src/mfa.js trước và module cache config, key có thể không được đọc. Hiện ổn vì import động trong beforeAll, nhưng phụ thuộc thứ tự module hóa.

**Refactor:**
- Thêm 1 test cho ciphertext bị giả mạo (sửa 1 byte) phải ném lỗi giải mã — chứng minh tính toàn vẹn của GCM, hiện chưa cover.
- Thêm test khi MFA_ENC_KEY thiếu/đổi: decryptSecret với key sai phải fail rõ ràng, không trả rác.

Scores → Quality 91 · Security 90 · Maintainability 92 · Enterprise 90

---

### `tests/money.test.js`  — Clean Code 96/100
**Mục đích:** Kiểm thử lõi tính tiền bằng Decimal: subtotal/VAT/total, nhân days, gộp nhiều sheet, không trôi số float, chiết khấu (clamp/âm/sau VAT), dòng giá âm, section + groupSubtotal.

**Issues:**
- Bộ test rất kỹ và bao phủ tốt các biên (clamp discount, float drift, negative line, groupSubtotal reset). Không phát hiện lỗi.
- Chính sách 'VAT trên full subtotal, discount sau VAT' (dòng 128-136) được test khóa cứng — tốt cho regression; cần đảm bảo đây đúng là chính sách nghiệp vụ mong muốn (đã có comment xác nhận).

**Refactor:**
- Cân nhắc thêm test với vatPercent là chuỗi/decimal lẻ (vd 8.5) để chốt làm tròn VAT.
- Thêm 1 case quantity hoặc unitPrice null/undefined trong item để chốt hành vi D() trong luồng tổng hợp.

Scores → Quality 96 · Security 95 · Maintainability 96 · Enterprise 95

---

### `tests/permissions.test.js`  — Clean Code 94/100
**Mục đích:** Snapshot ma trận RBAC: roleCan theo role×permission, canOnQuote (owner/member/stranger/admin), quoteScopeWhere, canScoped cho customer, permissionsForRole.

**Issues:**
- Bao phủ RBAC rất tốt theo kiểu table-driven; bất kỳ thay đổi mở rộng quyền sẽ làm gãy 1 dòng — đúng mục tiêu chống rò rỉ cross-salesperson.
- Thiếu case 'admin' trong canScoped (chỉ test manager/employee dòng 128-136): nên xác nhận admin quản lý mọi customer để khóa hành vi.

**Refactor:**
- Thêm hàng canScoped cho admin (manage any customer) để hoàn thiện ma trận.
- Thêm test canOnQuote với action không hợp lệ (vd 'frobnicate') phải trả false — chốt fail-closed.

Scores → Quality 94 · Security 95 · Maintainability 94 · Enterprise 93

---

### `tests/quoteNumber.test.js`  — Clean Code 90/100
**Mục đích:** Kiểm thử counter cấp số báo giá nguyên tử (DB-backed): cấp tuần tự và an toàn khi cấp đồng thời 25 lần không trùng.

**Issues:**
- Probe DB top-level await (dòng 8) để runIf — gọn, nhưng nếu QuoteCounter chưa migrate, suite skip im lặng; tốt cho dev nhưng CI cần chắc DB sẵn sàng kẻo skip nhầm mất coverage.
- Test tuần tự (dòng 24-32) giả định counter bắt đầu từ 001 sau deleteMany — phụ thuộc cleanup beforeAll chạy đúng; nếu một lần chạy trước để rác cùng năm/prefix 'TST' mà cleanup .catch nuốt lỗi, có thể lệch. Rủi ro thấp.

**Refactor:**
- Cân nhắc dùng prefix ngẫu nhiên theo thời gian (như TAG ở workflow test) thay vì 'TST'/'TSC' cố định để tránh va chạm giữa các lần chạy song song.
- Trong CI nên fail rõ nếu isDbAvailable=false thay vì skip, để không vô tình mất kiểm thử concurrency.

Scores → Quality 90 · Security 90 · Maintainability 88 · Enterprise 89

---

### `tests/quotes.workflow.test.js`  — Clean Code 88/100
**Mục đích:** Integration vòng đời báo giá qua app thật (supertest): create→submit→approve, guard terminal-state (converted), RBAC scoping, regression chỉnh sửa pending/discount/status filter.

**Issues:**
- Bộ integration rất giá trị, cover nhiều regression thực (orphan approval, discount-only PUT, converted immutable). Không thấy lỗi logic.
- Cleanup afterAll (dòng 69-84) phụ thuộc thứ tự xóa FK thủ công (approval→notification→quote...); nếu thêm bảng quan hệ mới sẽ dễ vỡ. Cân nhắc xóa theo cascade hoặc transaction.
- afterAll không bọc try/finally và không $disconnect — nếu một deleteMany ném lỗi, các bước sau bỏ qua, để lại rác test trong DB.
- Test 'converted cannot be deleted' (dòng 184-187) chỉ assert >=400, khá lỏng; nên chốt mã cụ thể (403).

**Performance:**
- bcrypt cost 4 (dòng 32) hợp lý cho test speed.
- Nhiều round-trip HTTP tuần tự trong 1 describe lifecycle chia sẻ quoteId — đúng bản chất integration, không tối ưu thêm được nhiều.

**Refactor:**
- Bọc afterAll trong try/finally và gọi prisma.$disconnect() ở finally để tránh treo kết nối và rò rác khi cleanup lỗi.
- Siết assert ở test xóa converted thành toBe(403) thay vì >=400.
- Trích quotePayload/makeUser thành helper dùng chung nếu các integration test khác xuất hiện.

Scores → Quality 89 · Security 92 · Maintainability 84 · Enterprise 88

---

### `tests/setup.js`  — Clean Code 88/100
**Mục đích:** Đặt env mặc định tối thiểu (NODE_ENV, DATABASE_URL, SESSION_SECRET, LOG_LEVEL) để config.js không fail-fast khi chạy test.

**Issues:**
- Không set APP_BASE_URL dù app.smoke.test.js kiểm tra CSRF same-origin với http://localhost:3000 — nếu mặc định config khác sẽ giòn (xem note ở app.smoke).
- Không set MFA_ENC_KEY ở đây (mfa.test tự set); chấp nhận được nhưng tập trung env test vào 1 chỗ sẽ rõ hơn.

**Security:**
- SESSION_SECRET test (dòng 4) chỉ dùng cho môi trường test với ||= nên không ghi đè giá trị thật — an toàn. Không phải lỗ hổng.

**Refactor:**
- Thêm process.env.APP_BASE_URL ||= "http://localhost:3000" để cố định kỳ vọng CSRF same-origin và làm test smoke ổn định.
- Gom MFA_ENC_KEY và các env tùy chọn khác vào setup với ||= để các test không tự set rải rác.

Scores → Quality 86 · Security 90 · Maintainability 86 · Enterprise 86

---

### `tests/validators.test.js`  — Clean Code 90/100
**Mục đích:** Kiểm thử schema Zod: Login, ChangePassword (độ mạnh), UserCreate (enum role/username), QuoteCreate (>=1 sheet, ép kiểu số), ListQuery (mặc định + chặn size quá lớn).

**Issues:**
- Bao phủ các nhánh chính tốt. Thiếu vài biên: ChangePasswordSchema không test newPassword quá dài hoặc trùng oldPassword (nếu có rule); UserCreate không test password yếu.
- ListQuerySchema không test order không hợp lệ hay sort cột không cho phép (whitelist) — nếu validator có whitelist sort, nên chốt để chống injection cột.

**Refactor:**
- Thêm test sort/order với giá trị ngoài whitelist phải bị từ chối (chống lạm dụng orderBy động).
- Thêm test QuoteCreate từ chối quantity/unitPrice âm nếu chính sách không cho (hiện money.test cho phép dòng âm — cần thống nhất ranh giới giữa validator và tính toán).

Scores → Quality 89 · Security 90 · Maintainability 90 · Enterprise 88

---

### `tests/xlsxStitcher.test.js`  — Clean Code 92/100
**Mục đích:** Kiểm thử ghép nhiều buffer .xlsx thành 1 workbook (XML/zip stitching): tên sheet, giữ tiếng Việt, không còn definedName ngoài, sheetId tuần tự, không trùng/mất font family.

**Issues:**
- Bộ test bám sát đúng các cạm bẫy của stitching (definedName external '[3]DATA', sheetId, font family) — rất sát rủi ro thực. Không thấy lỗi.
- Regex parse XML (dòng 52-67) giòn nếu định dạng output đổi (vd <sheet> có thuộc tính xuống dòng); chấp nhận được vì kiểm output ExcelJS ổn định.

**Refactor:**
- Thêm case ghép sheet trùng tên (collision) để chốt hành vi đặt tên (rename hay throw).
- Thêm case 1 buffer có nhiều worksheet để xác nhận chỉ lấy sheet đầu/đúng sheet như thiết kế.

Scores → Quality 92 · Security 93 · Maintainability 90 · Enterprise 91

---

