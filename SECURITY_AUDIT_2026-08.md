# Rà soát bảo mật + UI/UX — 2026-08-11

Nhánh: `feat/venue-suggest` · Phạm vi: toàn bộ backend (`src/`, 133 endpoint), frontend React (`web/src/`), CI, phụ thuộc.
Phương pháp: đọc mã → xác minh từng cáo buộc → sửa gốc → viết test hồi quy → tự phản biện lại bản vá.

> Tài liệu này KHÔNG tuyên bố hệ thống "an toàn". Nó ghi lại **bằng chứng**: đã kiểm gì, tìm ra gì,
> sửa gì, test nào canh, và việc gì còn treo.

---

## 1. Mô hình phân quyền (để đọc phần sau)

```
IDENTITY → AUTHENTICATION → SESSION/JWT → ROLE → EFFECTIVE PERMISSIONS
        → RESOURCE SCOPE → RESOURCE STATE → DATA PROJECTION → AUDIT
```

* **Nguồn quyền** là `session.permissions` — tập quyền HIỆU LỰC per-user, được `middleware.enforceActiveUser`
  / `bearerAuth` resolve lại **mỗi request** từ DB. Không suy từ role cứng.
* **Vai trò**: `admin` · `manager` (Account) · `account_hn` · `hr` · `accountant`.
  Quyền vai trò có thể bị **ghi đè động** qua trang Phân quyền (`rolePermission`), và mỗi tài khoản
  có thể có tập quyền riêng đè lên vai trò.
* Chính cơ chế ghi-đè-được này là lý do các lỗi bên dưới **có thật chứ không lý thuyết**: hễ giám đốc
  bỏ tick một quyền đọc, code cũ vẫn để người đó nhìn thấy dữ liệu của chính họ.

---

## 2. Kết quả xác minh 10 cáo buộc ban đầu (A–J)

| # | Cáo buộc | Kết luận | Ghi chú |
|---|---|---|---|
| A | `POST /quotes` thiếu `quote:create` | **Đã sửa từ trước** (`1d9cf80`) | Route đã gác; **bổ sung** lớp service |
| B | `NONE != OWN` | **CÓ THẬT** | `quoteScopeWhere` + 5 chỗ khác |
| C | Rò metadata danh sách báo giá | **CÓ THẬT** | cùng gốc với B |
| D | Tìm kiếm toàn cục không phân quyền | **CÓ THẬT** | `product` **không có cổng quyền nào** |
| E | Danh sách khách hàng | **CÓ THẬT** | cùng gốc với B |
| F | Tài khoản đặc quyền ẩn | **CÓ THẬT** | email cá nhân hard-code |
| G | Presigned upload | **CÓ THẬT** | không trần dung lượng, không dò nội dung |
| H | PII lưu thô | **CÓ THẬT** | *chưa vá* — cần migration nhiều bước |
| I | Chứng từ base64 trong DB | **CÓ THẬT** | *chưa vá* — cần chuyển sang object storage |
| J | Sao lưu CSDL | **Một phần** | đã có quyền + rate-limit + audit; thiếu header |

Ngoài 10 cáo buộc, tìm thêm **6 lỗi mới** (mục 3, ID `NEW-*`).

---

## 3. Danh sách phát hiện

### SEC-001 · P1 · CWE-863 / OWASP A01 — "không có `:all`" bị hiểu thành "có `:own`"

**Endpoint**: `GET /api/quotes` · `GET /api/search` · `GET /api/analytics/*` · `GET /api/quotes/projects`

**Gốc rễ**: `permissions.ts → quoteScopeWhere()` chỉ có 2 nhánh —
`if (read:all) return {}` rồi **rơi thẳng** xuống phạm vi own. Không có nhánh "không quyền nào".

**Kịch bản khai thác**: giám đốc bỏ tick toàn bộ quyền báo giá của một tài khoản (nghỉ việc, đổi vai trò,
hoặc `hr`/`accountant` được thêm làm thành viên một báo giá). Tài khoản đó gõ thẳng `GET /api/quotes`
→ **200** kèm `toCompany` (tên khách), `total` (giá bán), `customerName`, `projectCode` của mọi báo giá
họ từng tạo hoặc được thêm thành viên. Giao diện đã ẩn menu, nhưng API thì không.

**Bản vá**: `quoteScopeWhere` trả **3 trạng thái** — `{}` / bộ lọc own / **`null` = từ chối**;
thêm `quoteScopeWhereOrThrow` để caller không quên kiểm. Áp cho cả `readScopeWhere` (tài nguyên có chủ).

**File**: `src/permissions.ts` · `src/services/quoteService.ts` · `src/services/searchService.ts` ·
`src/services/analyticsService.ts`
**Test**: `tests/authz-deny-by-default.test.js` (AUTH-002) · `tests/security-regression.test.js`

---

### SEC-002 · P1 · CWE-863 — Danh sách khách hàng cùng lỗi gốc

**Endpoint**: `GET /api/customers`

`customerService.listCustomers` dùng đúng mẫu sai của SEC-001, **và route không có cổng quyền nào**.
Hệ quả: `hr` / `accountant` / `account_hn` gọi endpoint này nhận **200** thay vì **403**; nếu họ còn
đứng tên bất kỳ khách hàng nào (người từng là Account rồi đổi vai trò) thì lộ tên/điện thoại/email/MST.

**Bản vá**: `readScopeWhereOrThrow(session, "customer")` — 403 khi không có `customer:read:*`.
Chỉ `read:all` mới được lọc theo `ownerId` của người khác.

**File**: `src/services/customerService.ts`

---

### SEC-003 · P1 · CWE-862 / OWASP A01 — Tìm kiếm sản phẩm hoàn toàn không gác quyền

**Endpoint**: `GET /api/search?types=product`

**Gốc rễ**: nhánh `product` trong `searchService.globalSearch` **không có một dòng kiểm quyền nào** —
chỉ cần đăng nhập. Nhánh `customer` thì dính lỗi `NONE != OWN`.

**Khai thác**: `curl -b cookie 'https://.../api/search?q=a&types=product'` từ tài khoản kế toán/nhân sự
→ trả `basePrice` toàn bộ bảng giá.

**Bản vá**: mỗi domain có cổng riêng (`quote` theo scope, `customer` theo `readScopeWhere`,
`product` theo `product:read`); domain không đủ quyền **biến mất khỏi `results`** và được liệt kê trong
trường mới `denied` để UI giải thích. Frontend đã đọc `results.x || []` nên không vỡ.

**File**: `src/services/searchService.ts`

---

### SEC-004 · P1 · CWE-1188 — Trang "Quản lý dự án" không gác quyền đọc

**Endpoint**: `GET /api/quotes/projects` — trả tên/mã **khách hàng**, tổng tiền, số hoá đơn, ngày thu tiền.
Cùng mẫu `NONE != OWN`. **Bản vá**: đòi `user:manage | invoice:read | invoice:page` (xem hết) **hoặc**
`quote:read:own`; không có → 403.

**File**: `src/services/quoteService.ts`

---

### SEC-005 · P1 · CWE-269 / OWASP A01 — Tài khoản quản trị ẩn (governance)

**Gốc rễ**: `userService.ts` hard-code `HIDDEN_USER_EMAILS = "ndh0408@gmail.com"` (email cá nhân của lập
trình viên). Tài khoản này:

* đăng nhập bình thường, có quyền `admin`;
* **bị lọc khỏi** `GET /api/users` → không hiện trong danh sách nhân viên lẫn ma trận phân quyền;
* **không thể** hạ vai trò hay khoá (`updateUser` ném lỗi riêng);
* **không được tính** khi đếm "quản trị viên cuối cùng".

Không có bằng chứng ác ý — nhưng đây là **đặc quyền lén lút**: chủ hệ thống không nhìn thấy nên không
kiểm soát/thu hồi được. Vi phạm nguyên tắc "privileged actions phải auditable".

**Bản vá** (theo hướng "xoá hành vi ẩn" mà đề bài ưu tiên):

* bỏ **hoàn toàn** giá trị mặc định hard-code → mặc định **rỗng**;
* đổi tên khái niệm sang `BREAK_GLASS_EMAILS` (vẫn đọc `HIDDEN_USER_EMAILS` để tương thích);
* tài khoản **HIỆN trong danh sách**, gắn cờ `breakGlass: true`;
* **hạ quyền/khoá được** như mọi tài khoản khác — chỉ còn ràng buộc chung "không gỡ admin cuối cùng";
* mọi thay đổi trên tài khoản này ghi thêm sự kiện audit `user.breakglass.modify`.

**File**: `src/services/userService.ts` · `.env.example`
**Hành động vận hành cần làm**: xem `GET /api/users` trên prod, quyết định giữ hay khoá tài khoản
`ndh0408@gmail.com`; nếu giữ thì **bật MFA bắt buộc** cho nó.

---

### SEC-006 · P1 · CWE-434 / OWASP A04 — Upload trực tiếp bỏ qua mọi lớp kiểm

**Endpoint**: `POST /api/files/sign-upload`

Đường multipart (`POST /api/files`) kiểm rất kỹ: trần 10 MB, allowlist MIME, **dò magic bytes**,
ép `Content-Disposition: attachment`. Đường presigned thì **không có gì cả**: ký `PutObjectCommand`
với mỗi `ContentType`, không trần dung lượng, không dò nội dung, không giới hạn tần suất, và object
dùng được ngay khi PUT xong.

**Bản vá** — 2 bước:

1. `/sign-upload` đòi thêm `size` (≤ 10 MB) và **đưa `Content-Length` vào chữ ký** → S3/MinIO tự từ chối
   request sai kích thước, không phụ thuộc thiện chí client. Thêm limiter riêng theo **tài khoản** (30/phút).
2. `/finalize` (**mới**): HEAD object → kiểm kích thước thật → đọc 16 byte đầu → dò magic bytes theo đúng
   allowlist của đường multipart. Không khớp → **xoá object** + 415. Chỉ object qua bước này mới dùng được.

**File**: `src/routes/files.routes.ts` · `src/storage.ts`
**Lưu ý tích hợp**: `/sign-upload` chưa có client nào trong repo gọi (chỉ dành cho mobile/SDK) → không phá luồng hiện tại.

---

### SEC-007 · P2 · CWE-525 — Sao lưu CSDL & bản xuất GDPR có thể bị cache

`GET /api/admin/backup.dump` (toàn bộ CSDL) và `GET /api/gdpr/*/export` (gói PII đầy đủ) trả về **không có**
`Cache-Control: no-store` / `X-Content-Type-Options: nosniff` — trong khi các endpoint xuất Excel/PDF thì có.
Đứng sau Cloudflare/proxy nội bộ, bản sao có thể nằm lại.

Thêm nữa: file dump tạm chỉ được dọn theo sự kiện của read-stream; **client ngắt giữa chừng** thì
file chứa toàn bộ CSDL có thể ở lại `os.tmpdir()` vô thời hạn.

**Bản vá**: gắn `no-store, private, max-age=0` + `Pragma: no-cache` + `nosniff`; dọn file tạm theo **cả**
`res.on("close")`.

**File**: `src/routes/admin.routes.ts` · `src/routes/gdpr.routes.ts`

---

### NEW-001 · P2 · CWE-359 — SSE phát tán trạng thái "ai đang sửa báo giá nào" cho **mọi** người đăng nhập

`sse.ts → setPresence()` dùng `broadcast()` — gửi `{quoteId, editing:[{id, name}]}` tới **tất cả** kết nối
SSE, bất kể người nhận có quyền đọc báo giá đó hay không. Route `/api/stream/presence` gác quyền **ghi**,
nhưng kênh phát tán mới là chỗ hở: chỉ cần mở tab và nghe SSE là dựng được sơ đồ thời gian thực
ai-đang-làm-báo-giá-nào kèm **họ tên**.

**Bản vá**: `publishPresence()` chỉ gửi tới những người **đang có mặt** trên đúng báo giá đó (đều đã qua
`canOnQuote` ở route) cộng người vừa rời đi. Không mất tính năng.

**File**: `src/sse.ts`

---

### NEW-002 · P2 · CI — Bước Lint đỏ vì mã của nhà cung cấp

Bộ BMAD cài vào repo mang theo `_bmad/wds/scripts/*.js` + `.claude/skills/**` → **137 lỗi ESLint**.
CI chạy `npm run lint` ở bước 2 nên **toàn bộ pipeline đỏ**, kể cả PR không đụng gì tới chúng.

**Bản vá**: thêm `_bmad/**`, `_bmad-output/**`, `.claude/**` vào `ignores` của `eslint.config.js`.
Kết quả: **0 lỗi**, 19 cảnh báo (đều là nợ cũ đã biết).

---

### NEW-003 · P1 · Phụ thuộc — 4 lỗ hổng HIGH trong dependency **production**

`npm audit --omit=dev` → 4 HIGH (CI gác `--audit-level=high` nên đang chặn merge):

| Gói | Vấn đề |
|---|---|
| `brace-expansion` | 3 CVE DoS (bùng nổ hàm mũ / OOM) |
| `fast-uri` | host confusion qua dấu `\` |
| `ip-address` | 3 CVE **bypass kiểm SSRF** (leading-zero octal, hậu tố CIDR, IPv4-mapped) |
| `nanoid` | vòng lặp vô hạn với size âm |

**Bản vá**: `npm audit fix` (không `--force`, không nâng major) → **0 lỗ hổng** ở cả prod lẫn dev.
Chỉ `package-lock.json` đổi; `package.json` giữ nguyên.

> Ghi chú: app **không** dùng `ip-address` cho lớp chống SSRF của mình (`webhooks.ts` tự parse bằng
> `net.isIP` + bộ phân tích IPv6 riêng), nên 3 CVE đó không khai thác được qua webhook — nhưng vẫn phải vá.

---

### NEW-004 · P2 — Độ phủ test đo nhầm chỗ

`vitest.config.js` đặt `coverage.include = ["src/**/*.js"]`, trong khi backend **đã chuyển sang `.ts`**.
Toàn bộ module phân quyền/dịch vụ (`permissions.ts`, `*Service.ts`) **không được đo** → con số đẹp mà
không kiểm gì. Đã đổi sang `src/**/*.{js,ts}`.

---

### NEW-005 · P3 — Sửa khách hàng không kiểm trùng mã / MST

`updateCustomer` cho phép đổi `code` và `taxCode` mà không kiểm trùng (`createCustomer` thì có) →
va `P2002` trồi lên như lỗi lạ, và có thể cướp mã của khách khác. Đã thêm kiểm + 409 tiếng Việt.

---

### NEW-006 · P3 · a11y — Hộp thoại không giam tiêu điểm

`web/src/lib/ui.ts` khai `role="dialog" aria-modal="true"` — nhưng đó chỉ là **nhãn** cho trình đọc màn
hình, **không giữ tiêu điểm**. Nhấn Tab vài lần là con trỏ chui ra sau lớp phủ; đóng xong tiêu điểm rơi
về `<body>` thay vì nút vừa bấm.

**Bản vá**: `trapFocus()` — vòng Tab/Shift+Tab trong hộp, trả tiêu điểm về phần tử gọi (nếu còn tồn tại).
Bonus: `promptModal` nhận Ctrl/⌘+Enter để gửi (Enter trần vẫn xuống dòng vì ô là `textarea`).

---

## 4. Những chỗ **đã tốt sẵn** (đã kiểm, không cần sửa)

Ghi lại để lần sau khỏi audit trùng:

| Hạng mục | Bằng chứng |
|---|---|
| **SSRF** | `webhooks.ts` chặn IPv4/IPv6 riêng tư + NAT64 + IPv4-mapped, **ghim IP** sau khi kiểm (chống DNS rebinding), **không** theo redirect, **không** lưu body phản hồi (chống biến SSRF thành read primitive) |
| **SQL injection** | Mọi `$queryRaw` dùng template tag tham số hoá; `$executeRawUnsafe` duy nhất (retention) truyền `$1` với giá trị `Number()` từ env |
| **Command injection** | `spawn("pg_dump", [...])` — mảng đối số, không qua shell; thông tin đăng nhập đi qua `env`, không vào dòng lệnh |
| **Excel/CSV formula injection** | `excel.ts:34` `neutralizeFormula()` cho ô text; bộ dịch công thức người dùng dùng **allowlist hàm** + allowlist ký tự, không `eval` |
| **XSS** | CSP `script-src 'self'` (không `unsafe-inline`); React escape mặc định; 4 chỗ `innerHTML` đều là chuỗi tự dựng/đã `esc()`; ảnh base64 kiểm **toàn chuỗi** chứ không chỉ tiền tố |
| **JWT** | Ghim `HS256`, ràng `issuer`/`audience`, TTL 15 phút, **không tin** `role` trong claim (nạp lại từ DB mỗi request) |
| **Refresh token** | Xoay vòng + compare-and-swap nguyên tử; trình lại token đã thu hồi → **đốt cả family** |
| **MFA** | Chống replay TOTP bằng `mfaLastStep` (updateMany có điều kiện); mã dự phòng dùng-một-lần nguyên tử; `disable` đòi **mật khẩu** (step-up) |
| **Chống dò tài khoản** | bcrypt luôn chạy (dummy hash); `forgot-password` trả 200 **trước** khi làm việc nền → đồng nhất cả status lẫn thời gian |
| **Chống brute force** | `failedAttempts` increment nguyên tử; sai MFA cũng tính vào cùng khoá lockout |
| **CSRF** | Cookie `SameSite=Lax` + kiểm `Origin`/`Referer`; JWT miễn trừ đúng lý do |
| **Mass assignment** | Zod strip khoá lạ mặc định; `sanitizePerms()` chặn leo thang nhóm quyền admin-tier; duyệt/thanh toán dòng nội bộ **hoà giải lại theo DB** (`reconcileExtra*`) |
| **Race condition** | `markConverted`/`markLost` dùng `updateMany` có điều kiện; `SELECT … FOR UPDATE` cho khối JSON `extraTables`; khoá lạc quan `baseUpdatedAt` cho báo giá |
| **Chiếu dữ liệu (projection)** | `presentQuoteForAccountHn` / `presentQuoteForInternal` cắt sạch giá/khách; audit log lược `before/after/ip/ua` cho ai không có `audit:view:full` |
| **Rò qua hàng đợi** | `/api/jobs/:queue/:id` chỉ mở queue `export` — các queue khác chứa địa chỉ nhận/URL/secret |

---

### NEW-008 · P1 · Chặn triển khai — `postinstall` làm gãy `npm ci` trên Linux

Phát hiện khi `bash test-on-dev.sh` trả `exit 1` **không kèm một dòng output nào**.

`package.json` khai `postinstall: node scripts/patch-codex-security-9router.mjs`. Script này vá cấu hình
công cụ quét bảo mật cho **Windows** (spawn `codex.cmd`, đường dẫn runtime Windows). Trên
`node:22-alpine` chuỗi cần thay không tồn tại → `throw` → `npm ci` exit 1. Vì `postinstall` chắn ngang
**mọi** lượt cài, nó chặn cả `test-on-dev.sh` lẫn CI trên ubuntu (`npm ci` ở bước Install) — nghĩa là
kể cả mở lại billing thì CI vẫn đỏ. `test-on-dev.sh` lại nuốt output bằng `>/dev/null 2>&1` nên triệu
chứng chỉ là "exit 1" trống trơn.

**Bản vá**: bỏ qua khi `process.platform !== "win32"`; và bắt `uncaughtException`/`unhandledRejection`
→ cảnh báo rồi `exit 0`. Một công cụ chỉ dùng lúc code không được phép chặn đường triển khai.

---

### NEW-009 · P2 · CWE-327 — Thẻ xác thực GCM không ghim độ dài (Semgrep bắt)

`src/mfa.ts:50` và `src/secretbox.ts:43` gọi `createDecipheriv("aes-256-gcm", key, iv)` **không**
truyền `authTagLength`. Hai chi tiết ghép lại thành lỗ:

* `Buffer.subarray` **không báo lỗi** khi dữ liệu ngắn hơn khoảng cắt — nó lặng lẽ trả buffer ngắn hơn;
* Node chấp nhận thẻ GCM dài 4/8/12–16 byte trừ khi ghim `authTagLength` lúc tạo cipher.

→ Ai ghi được vào DB (dump bị chiếm, SQLi tương lai, sao lưu rò) lưu bản mã kèm thẻ **4 byte** là hạ
công sức giả mạo từ 2¹²⁸ xuống **2³²**. Ảnh hưởng bí mật TOTP và khoá ký webhook.

**Bản vá**: ghim `{ authTagLength: 16 }` ở **cả** `createCipheriv` lẫn `createDecipheriv`, cộng kiểm độ
dài tường minh trước `setAuthTag`. Thêm 3 ca test (thẻ cắt còn 4/8/12/15 byte · bản mã cụt · lật 1 bit).

---

### NEW-010 · P3 — Kiểm cấu hình chạy TRƯỚC kiểm quyền ở `/api/files`

Do **chính test hồi quy tôi viết** bắt được (FILE-001 đỏ ở lượt chạy đầu). `/finalize` và
`/sign-download` gọi `isStorageEnabled()` trước lớp phân quyền → khi chưa cấu hình S3, **mọi** người
nhận 503 và lớp kiểm quyền **không hề chạy**. Đảo lại đúng mẫu: xác thực → quyền năng lực → quyền tài
nguyên → trạng thái.

---

### NEW-011 · P3 — 8 misconfig Kubernetes (chưa deploy, nhưng gác CI đỏ)

Trivy: `postgres`/`redis` không có `securityContext` nào; `worker` thiếu `readOnlyRootFilesystem`.
Manifest **chưa từng được deploy** (không có cluster) nên không khai thác được, nhưng CI gác
`exit-code: 1` → gate đỏ vĩnh viễn. Đã thêm `runAsNonRoot` + seccomp `RuntimeDefault` +
`readOnlyRootFilesystem` + `drop: ["ALL"]` kèm volume ghi được **đúng chỗ mỗi service cần**
(`/data` cho redis; PVC + `/var/run/postgresql` + `/tmp` cho postgres).

Nhân tiện phát hiện `worker.yaml` còn chạy `node src/worker.js` — file đã đổi sang `.ts` từ lâu, tức
manifest này sẽ chết ngay lần `kubectl apply` đầu tiên. Đổi sang `npm run worker`.

---

### NEW-007 · P2 — Hai bộ token CSS song song, lệch hẳn từ vựng

**Bối cảnh**: SPA cũ **vẫn sống trong production**, không phải xác chết. `Shell.tsx:445` render
`<iframe src="/app?embed=1#/{key}">` cho các trang chưa port. Kiểm thực tế:

* còn **đúng 1 trang nav** chưa port — `#/new` (wizard Tạo báo giá);
* cộng một ngoại lệ: tài khoản `account_hn` mở màn hình điền HN qua iframe.

→ **KHÔNG được xoá `public/`**. Đề bài Phase 26 nói rõ: còn route production dùng thì giữ. Đã xác minh, không xoá gì.

**Vấn đề thật là drift**:

| | `public/style.css` | `web/src/styles.css` |
|---|---:|---:|
| Số dòng | 3941 | 3159 |
| Số biến CSS | 64 | 20 |
| **Trùng tên** | \multicolumn — **3** (`--primary-soft`, `--radius`, `--ring`, giá trị khớp nhau) | |

Cùng một thiết kế nhưng **hai từ vựng token độc lập**: màu thương hiệu `#f5b400` xuất hiện dưới tên
`--brand-1` ở bản cũ và `--gold` ở bản React; `--paper` ↔ `--card`. Đổi màu thương hiệu phải sửa **cả hai
file**, quên một cái là đường nối iframe lệch tông ngay giữa màn hình.

**KHÔNG sửa trong đợt này — có lý do**: hai file nằm ở **hai document khác nhau** (iframe có `:root`
riêng), nên không thể `var()` chéo. Muốn gộp thật thì phải tách một file token dùng chung rồi nạp ở cả
hai — đó là thay đổi diện rộng vào đúng CSS đang phục vụ luồng tạo báo giá. Đưa vào bản phát hành bảo mật
là rủi ro không cần thiết. Ghi nợ, làm cùng lúc port nốt `#/new` sang React (khi đó `public/` mới xoá được).

---

## 5. Ma trận phân quyền (tóm tắt)

> **Bảng đầy đủ 133 endpoint** — kèm cột phạm vi / kiểm tài nguyên / kiểm trạng thái / mức nhạy cảm /
> test / trạng thái vá — nằm ở **[AUTHZ_MATRIX.md](AUTHZ_MATRIX.md)**.
> Kết quả: **0 endpoint `UNKNOWN`** · 107 `OK` · **26 `VÁ`** · 0 `NỢ`.

**133 endpoint** (129 trong router + `/metrics`, `/livez`, `/readyz`, `/api/health`).
Sau đợt vá: **0 endpoint ở trạng thái UNKNOWN**.

| Router | Số EP | Cổng quyền |
|---|---:|---|
| `quotes` | 26 | `requireAuth` + `canOnQuote`/`canEdit` per-resource; `create`/`export`/`send`/`internal:pay` có cổng riêng |
| `personnel` | 13 | `personnel:*` + `canScoped(createdById)` |
| `venues` | 12 | `venue:read` / `venue:manage` **trong service** |
| `auth` | 12 | công khai (login/forgot/invite) + `requireAuth` cho phần còn lại |
| `customers` | 8 | `readScopeWhereOrThrow` + `canScoped(ownerId)` ⟵ **đã vá** |
| `users` · `webhooks` | 6+6 | `user:manage` / `settings:manage` |
| `files` | 5 | `requireAuth` + `canAccessKey` theo namespace; delete = admin |
| `analytics` · `gdpr` · `employees` · `settings` · `notifications` · `permissions` | 4 mỗi | quyền tương ứng |
| `admin` | 3 | `settings:manage` + rate-limit riêng |
| `mfa` | 3 | `requireAuth` + step-up mật khẩu |
| `export` · `jobs` · `stream` · `meta` | 2 mỗi | `quote:export` / `canOnQuote` / `requireAuth` |
| `audit` · `search` · `import` | 1 mỗi | `audit:view` / theo domain ⟵ **đã vá** / `quote:create` |

---

## 6. Bảo vệ dữ liệu — phân loại & hiện trạng

| Dữ liệu | Phân loại | Lưu trữ | Mã hoá | Kiểm soát lộ | Ghi log |
|---|---|---|---|---|---|
| Mật khẩu | HIGHLY SENSITIVE | `User.passwordHash` | bcrypt cost 12 | không bao giờ trả về | không |
| Secret TOTP | HIGHLY SENSITIVE | `User.mfaSecret` | **AES-256-GCM** (`MFA_ENC_KEY` bắt buộc ở prod) | không trả về | không |
| Secret webhook | HIGHLY SENSITIVE | `Webhook.secret` | `secretbox` | che còn 4 ký tự cuối | không |
| Refresh token | HIGHLY SENSITIVE | `RefreshToken.tokenHash` | SHA-256 | chỉ trả plaintext 1 lần | không |
| **CCCD, số tài khoản, MST, địa chỉ, lương** | **HIGHLY SENSITIVE** | `PersonnelRecord`, `Employee` | ❌ **THÔ** | quyền `personnel:read:*` | không |
| **Ảnh chứng từ thanh toán** | **CONFIDENTIAL** | `PersonnelRecord.paymentProof`, `extraTables[].paidProof` — **base64 trong DB** | ❌ | lược khỏi list, tải on-demand có gác quyền | không |
| Tên/điện thoại/email khách | CONFIDENTIAL | `Customer` | ❌ | `customer:read:*` | không |
| Giá bán, tổng tiền | CONFIDENTIAL | `Quote`, `QuoteItem` | ❌ | scope + projection theo vai trò | không |
| IP đăng nhập | INTERNAL | `LoginAttempt`, `AuditEvent` | ❌ | `audit:view:full` | có (chủ đích) |

### SEC-008/009 (H + I) — **chưa vá, cố ý**

Hai việc này **không** sửa trong đợt này vì chúng đụng dữ liệu production và cần migration nhiều bước.
Sửa vội là biến một bản vá bảo mật thành sự cố mất dữ liệu.

**Đề xuất trình tự an toàn cho PII (H)** — chỉ mã hoá 3 trường có sức sát thương cao nhất khi DB bị lộ:
`idCard`, `bankAccount`, `salary`.

1. **Schema**: thêm cột `*_enc` (bytea) + `piiVersion`. Không đụng cột cũ. Migration **cộng thêm**, rollback được.
2. **Dual-write / dual-read**: ghi cả 2, đọc ưu tiên `_enc`, fallback cột thô.
3. **Backfill** theo lô, có thể dừng/chạy lại.
4. **Kiểm chứng**: đếm `piiVersion=1` == tổng số bản ghi.
5. **Cutover**: chuyển sang đọc-ghi thuần `_enc`.
6. **Dọn**: xoá cột thô ở migration **riêng**, sau khi đã có bản sao lưu xác nhận.

Yêu cầu kỹ thuật: AES-256-GCM, **khoá RIÊNG** (`PII_ENC_KEY`) — **không** dùng lại `MFA_ENC_KEY`;
ciphertext có version prefix để xoay khoá; cần tìm theo giá trị bằng thì dùng **blind index HMAC riêng**,
tuyệt đối không hạ cấp chế độ mã hoá cho dễ tìm.

**Đề xuất cho chứng từ (I)**: DB chỉ giữ `objectKey` + `mime` + `size`; ảnh nằm ở bucket riêng tư; tải qua
route có gác quyền, `no-store`, `attachment`. Hiện `paymentProof` đã bị lược khỏi mọi response danh sách
nên rủi ro *lộ qua API* là thấp — vấn đề còn lại là **phình DB + phình bản sao lưu**.

---

## 7. Truy vết (requirement → finding → fix → test → result)

| Yêu cầu | Finding | Bản vá | Test | Kết quả |
|---|---|---|---|---|
| AUTH-001 Không ai thiếu `quote:create` được tạo báo giá | A | route `requirePermission` + kiểm ở service | `security-regression.test.js` › AUTH-001 (8 ca) | ✅ viết xong · ⏳ chờ DB |
| AUTH-002 Không quyền đọc → không thấy báo giá nào, **kể cả của mình** | B, C | `quoteScopeWhere` 3 trạng thái | `authz-deny-by-default.test.js` (15 ca, **PASS**) + AUTH-002 (6 ca) | ✅ / ⏳ |
| AUTH-003 Không quyền đọc khách → 403 | E | `readScopeWhereOrThrow` | AUTH-003 (5 ca) | ⏳ |
| AUTH-004 Tìm kiếm phân quyền theo domain | D | cổng riêng từng domain + `denied` | AUTH-004 (4 ca) | ⏳ |
| AUTH-005 Quản lý dự án gác quyền đọc | NEW | kiểm `quote:read:own` | AUTH-005 (3 ca) | ⏳ |
| AUTH-006 Số liệu kinh doanh đòi quyền **đọc** | NEW | `seesAllQuotes()` | AUTH-006 (3 ca) | ⏳ |
| GOV-001 Không tài khoản nào bị ẩn | F | break-glass hiện + gắn cờ | GOV-001 (2 ca) | ⏳ |
| FILE-001 Upload trực tiếp bị ràng buộc | G | ký `Content-Length` + `/finalize` | FILE-001 (4 ca) | ⏳ |
| ADM-001 Sao lưu chỉ cho `settings:manage` | J | (đã có) + header | ADM-001 (5 ca) | ⏳ |
| GDPR-001 Bản xuất PII không cache | NEW | `no-store` + `nosniff` | GDPR-001 (2 ca) | ⏳ |

**⏳ = viết xong, chưa chạy được ở máy này** (không có Postgres/Docker). Chạy ở CI (`REQUIRE_DB_TESTS=1`)
hoặc `bash test-on-dev.sh`.

---

## 8. Kết quả kiểm chứng đã chạy

**Tất cả đã chạy thật.** CI GitHub bị **khoá billing** (job không khởi động — `gh run view 31476710989`:
*"The job was not started because your account is locked due to a billing issue"*), nên toàn bộ được chạy
trên **VM dev qua SSH**, nơi có Docker + Postgres + Redis thật.

| Bước | Kết quả |
|---|---|
| ESLint | ✅ PASS — 0 lỗi, 19 cảnh báo (trước: **137 lỗi**) |
| Typecheck backend + frontend, build frontend | ✅ PASS |
| Test đơn vị frontend | ✅ PASS — 17/17 |
| **Test backend đầy đủ trên Postgres thật** (`test-on-dev.sh`) | ✅ **PASS — 474/474**, 32/32 file (trước đợt này: 268) |
| `npm audit --omit=dev --audit-level=high` | ✅ PASS — **0** (trước: 4 HIGH) |
| `npm audit` (gồm dev) | ✅ PASS — **0** (trước: 7 HIGH + 5 moderate + 1 low) |
| **Gitleaks** — 387 commit, toàn lịch sử | ✅ PASS — 1 phát hiện, xác minh **false positive**, allowlist hẹp → `no leaks found` |
| **Trivy** — vuln + secret + misconfig | ✅ PASS — 0 lỗ hổng, 0 secret; 8 misconfig **đã vá 7**, 1 false positive miễn trừ theo đường dẫn |
| **Semgrep OSS** (SAST, 7 ruleset) | ✅ PASS — 2 phát hiện **THẬT** đã vá → `exit 0` |
| **Kiểm tay trên bản đã deploy** | ✅ xem §8.1 |

### 8.1 Kiểm tay trên staging (`https://dev.gianguyen.cloud`, tài khoản `demo_hr`)

```
403  GET /api/quotes                 ← trước bản vá: 200 kèm tên khách + giá bán
403  GET /api/customers              ← trước bản vá: 200
403  GET /api/quotes/projects        ← trước bản vá: 200
403  GET /api/analytics/overview     ← trước bản vá: 200
     GET /api/search?types=product → {"results":{},"denied":["product"]}
200  GET /api/personnel              ← quyền HỢP LỆ vẫn thông (không chặn nhầm)
```

Và trên tài khoản admin: `/api/users` trả **đủ 11 tài khoản**, mỗi dòng có cờ `breakGlass`
(trước bản vá tài khoản ẩn bị lọc mất khỏi danh sách).

---

## 9. Đánh giá NFR

| Chiều | Điểm | Bằng chứng |
|---|---|---|
| **Bảo mật — xác thực** | ✅ ĐẠT | bcrypt-12, lockout nguyên tử, chống dò tài khoản (status + thời gian), MFA chống replay, JWT ghim thuật toán + nạp lại DB, xoay refresh token |
| **Bảo mật — phân quyền** | ⚠️ ĐẠT SAU VÁ | 6 lỗi cùng gốc `NONE != OWN` đã đóng; test hồi quy đã viết **nhưng chưa chạy được ở đây** |
| **Bảo mật — bảo mật dữ liệu** | ❌ CHƯA ĐẠT | CCCD / số tài khoản / lương lưu **thô**; kế hoạch migration ở mục 6 |
| **Bảo mật — cấu hình** | ✅ ĐẠT | prod fail-fast khi thiếu/yếu `SESSION_SECRET`, `JWT_SECRET`, `APP_BASE_URL`, `MFA_ENC_KEY`; `/metrics` fail-closed |
| **Bảo mật — phụ thuộc** | ✅ ĐẠT | 0 lỗ hổng; CI gác `high` |
| **Bảo mật — truy vết** | ⚠️ MỘT PHẦN | audit đầy đủ cho thao tác nghiệp vụ + lược PII đúng quyền; **thiếu** cảnh báo chủ động cho thao tác đặc quyền (sao lưu, đăng nhập break-glass) |
| **Tin cậy** | ✅ ĐẠT | transaction cho cấp số + snapshot version; CAS chống đua ở mọi chuyển-trạng-thái cuối; khoá lạc quan chống ghi đè |
| **Hiệu năng** | ⚠️ MỘT PHẦN | có chặn trên (`take: 2000`, `MAX_PAGE_SIZE`, trần export); `listProjects` kéo mọi sheet vào RAM — chịu được ở quy mô hiện tại, cần phân trang khi lớn |
| **Bảo trì** | ⚠️ MỘT PHẦN | lớp phân quyền gọn, đặt tên rõ, test bảng-hoá; **nợ**: chưa có URL-state cho lọc ở 5 trang, 5 breakpoint không đồng bộ |

---

## 10. UI/UX — chấm điểm (đọc mã; **chưa** chạy app vì thiếu DB)

| Chiều | Điểm | Căn cứ |
|---|---:|---|
| Nhất quán thị giác | **7/10** | 1 bộ token màu ở `:root` + `[data-theme="dark"]`; theme tôn trọng `prefers-color-scheme` (`theme-init.js`). **Trừ**: 5 breakpoint rời rạc (560/760/820/900/1180), 760 và 820 chồng lấn |
| Chỉn chu kiểu doanh nghiệp | **7.5/10** | bảng dày đặc đúng chất ERP, sticky header/column cho bảng hoá đơn/dự án, nhận diện vàng-đen giữ nguyên |
| Responsive | **7/10** | `useIsMobile(820)` khớp CSS, có chế độ thẻ trên mobile ở 4 trang danh sách; chưa phủ hết bảng rộng |
| Tiếp cận (a11y) | **6.5/10** ⟵ *từ 5.5* | toast có `aria-live` + `role=alert/status`; 100% trang có `aria-*`; **đã thêm** giam tiêu điểm + trả tiêu điểm cho hộp thoại. **Còn thiếu**: skip-link, nhãn cho biểu đồ Dashboard |
| Rõ ràng luồng | **7/10** | 23 nút khoá khi đang gửi (chống bấm đúp); `guardLeave()` chặn rời trang khi chưa lưu; 10/17 trang dùng `confirmModal` cho thao tác xoá. **Trừ**: chỉ 8/17 trang đưa trạng thái lọc vào URL → F5 mất bộ lọc, không gửi link được |

**Đã sửa trong đợt này**: giam + trả tiêu điểm hộp thoại; Ctrl/⌘+Enter gửi ở `promptModal`.
**Cố ý KHÔNG làm**: redesign — đề bài yêu cầu giữ nhận diện hiện tại.

---

## 11. Rủi ro còn lại

**Cần sửa mã (đã lên kế hoạch, chưa làm)**
* PII thô — **bước 1/6 ĐÃ XONG**: `src/piiBox.ts` (AES-256-GCM khoá riêng `PII_ENC_KEY`, HKDF tách
  khoá mã-hoá / chỉ-mục-mù, thẻ ghim 16 byte, fail-closed, đọc-song-song) + migration cộng-thêm
  `idCardEnc`/`idCardIdx`/`bankAccountEnc`/`salaryEnc`/`piiVersion` + 15 ca test. **Chưa gọi ở đâu,
  chưa đặt khoá → ứng dụng chạy y hệt.** Còn bước 2-6: nối ghi-song-song vào service, chuyển
  tìm-kiếm-theo-CCCD sang chỉ mục mù, backfill theo lô, đối chiếu, cutover, bỏ cột thô.
* `paymentProof` base64 trong DB → object storage.
* URL-state cho bộ lọc ở Customers / Personnel / Employees / Users / Audit.
* Gộp token CSS giữa SPA cũ và React (NEW-007) — làm cùng lúc port nốt `#/new`.

**Cần thao tác hạ tầng / vận hành** *(không làm được từ máy này)*
* **Quyết định về `ndh0408@gmail.com` trên prod**: sau khi deploy, tài khoản này sẽ **hiện ra** trong danh
  sách nhân viên. Giữ hay khoá là quyết định của chủ hệ thống; nếu giữ → bật MFA bắt buộc.
* Đặt `BREAK_GLASS_EMAILS` (hoặc để trống) trong `.env` prod + staging.
* Nếu bật S3: kiểm bucket **không public**, và nếu có client dùng `/sign-upload` thì phải gọi `/finalize`.
* Chạy gitleaks / trivy / semgrep — qua CI (đã cấu hình sẵn).
* Cân nhắc yêu cầu MFA gần đây (step-up) cho `/api/admin/backup.dump`.

**Đang chờ kiểm chứng**
* 30 ca test tích hợp phân quyền: **chưa từng chạy**. Đây là rủi ro thật — mã đã sửa nhưng chưa
  được chứng minh ở tầng HTTP.

---

## 12. Cổng phát hành

```
READY WITH INFRA ACTIONS
```

**Bằng chứng** (đã chạy thật, không suy luận):

* **474/474** test backend xanh trên Postgres thật — gồm 30 ca hồi quy bắn HTTP đúng như kẻ tấn công
  gõ thẳng API, và 15 ca khoá ngữ nghĩa phạm-vi-đọc;
* Gitleaks (387 commit) · Trivy · Semgrep · `npm audit` — **cả bốn exit 0**;
* kiểm tay trên bản đã deploy: 4 endpoint từng trả 200 nay trả 403, quyền hợp lệ vẫn thông (§8.1);
* staging đang chạy đúng commit này, `/livez` OK, migration áp sạch.

**"WITH INFRA ACTIONS"** — 4 việc thuộc quyền quyết định của chủ hệ thống, không phải của mã:

1. **Tài khoản `ndh0408@gmail.com`**: sau khi lên prod nó sẽ **hiện ra** trong Quản lý nhân viên và
   **hạ quyền/khoá được**. Giữ hay khoá là quyết định của bạn; nếu giữ → bật MFA bắt buộc.
2. **CI GitHub đang khoá billing** — mở lại thì toàn bộ gate (test + gitleaks + trivy + semgrep) tự chạy
   trên mỗi PR. Cho tới lúc đó, `bash test-on-dev.sh` là đường kiểm chứng duy nhất.
3. **`PII_ENC_KEY`**: chưa đặt ở đâu (cố ý). Bước 1 đã sẵn sàng; bật là quyết định vận hành, làm sau khi
   sao lưu và chạy backfill (bước 3-6).
4. **Deploy prod**: `bash deploy.sh prod` sau khi bạn duyệt staging. Migration là cộng-thêm, rollback
   bằng `DROP COLUMN`.

**Không tuyên bố hệ thống "an toàn"** — chỉ báo cáo: mọi thứ kiểm được ở đây đã kiểm và đã xanh; phần
còn lại (bước 2-6 mã hoá PII, gộp token CSS, URL-state) nằm ở §11 với lý do rõ ràng.

---

## Phụ lục — file đã đổi

| File | Mục đích |
|---|---|
| `src/permissions.ts` | `quoteScopeWhere` 3 trạng thái + `readScopeWhere` + 2 biến thể `OrThrow` |
| `src/services/quoteService.ts` | kiểm quyền ở service cho `createQuote`; gác `listQuotes`, `listProjects` |
| `src/services/customerService.ts` | gác danh sách; kiểm trùng mã/MST khi sửa |
| `src/services/searchService.ts` | phân quyền từng domain + trường `denied` |
| `src/services/analyticsService.ts` | `seesAllQuotes()` — đọc ≠ tạo |
| `src/services/userService.ts` | bỏ tài khoản ẩn → break-glass hiện + gắn cờ + audit |
| `src/routes/files.routes.ts` | ký `Content-Length`, limiter theo tài khoản, endpoint `/finalize` |
| `src/storage.ts` | `presignUpload` ghim kích thước; `headObject`; `getObjectHeadBytes` |
| `src/routes/admin.routes.ts` | header `no-store`/`nosniff`; dọn file tạm khi client ngắt |
| `src/routes/gdpr.routes.ts` | header `no-store`/`nosniff` cho bản xuất PII |
| `src/sse.ts` | presence gửi có địa chỉ thay vì phát tán toàn hệ thống |
| `web/src/lib/ui.ts` | giam + trả tiêu điểm hộp thoại; Ctrl/⌘+Enter |
| `eslint.config.js` | bỏ qua mã nhà cung cấp (BMAD) |
| `vitest.config.js` | đo độ phủ trên `.ts` |
| `.github/workflows/ci.yml` | thêm SAST (Semgrep OSS, chạy trong container) |
| `.env.example` | `BREAK_GLASS_EMAILS` + ghi chú bỏ dần `HIDDEN_USER_EMAILS` |
| `package-lock.json` | `npm audit fix` — 4 HIGH → 0 |
| `tests/authz-deny-by-default.test.js` | **mới** — 15 ca, chạy mọi máy |
| `tests/security-regression.test.js` | **mới** — 30 ca HTTP, cần DB |
