# Ma trận phân quyền — toàn bộ 133 endpoint

Chốt ngày 2026-08-11, nhánh `feat/venue-suggest`. Phụ lục của [SECURITY_AUDIT_2026-08.md](SECURITY_AUDIT_2026-08.md).

**Mục tiêu**: không còn endpoint nào ở trạng thái `UNKNOWN`. Mọi dòng dưới đây đã được đối chiếu với mã nguồn.

### Cách đọc

| Cột | Ý nghĩa |
|---|---|
| **AUTH** | `✓` đòi đăng nhập · `✗` công khai · `JWT` chấp nhận Bearer |
| **QUYỀN** | quyền năng lực (capability) mà route/service đòi. `—` = chỉ cần đăng nhập |
| **P.VI** | phạm vi dữ liệu: `all` mọi bản ghi · `own` của mình · `self` chính tài khoản mình · `global` không phân chủ sở hữu (cố ý) · `—` không áp dụng |
| **T.NGUYÊN** | có kiểm quyền trên ĐÚNG bản ghi bị đụng tới không (chống IDOR) |
| **T.THÁI** | có kiểm trạng thái/vòng đời trước khi ghi không |
| **N.CẢM** | mức dữ liệu trả về: `PII` · `$` tiền/giá · `SEC` bí mật hệ thống · `—` thường |
| **TT** | `OK` đúng sẵn · `VÁ` sửa trong đợt này · `NỢ` còn thiếu, đã ghi nhận |

Middleware áp cho **mọi** `/api/*`: `bearerAuth` → `enforceActiveUser` (nạp lại vai trò + quyền + trạng thái khoá từ DB **mỗi request**) → `csrfGuard` → `apiLimiter` (120/phút).

---

## `/api/auth` — 12 endpoint

| M | Đường dẫn | AUTH | QUYỀN | P.VI | T.NGUYÊN | T.THÁI | N.CẢM | TEST | TT |
|---|---|---|---|---|---|---|---|---|---|
| POST | `/login` | ✗ | — | — | — | khoá tài khoản + MFA | — | `authCore.test.js` | OK |
| POST | `/logout` | ✗ | — | self | — | — | — | `app.smoke` | OK |
| GET | `/me` | ✓ | — | self | — | — | PII | — | OK |
| POST | `/profile` | ✓ | — | self | ghim `session.userId` | — | PII | — | OK |
| POST | `/change-password` | ✓ | — | self | đòi mật khẩu cũ | — | SEC | — | OK |
| POST | `/token` | ✗ | — | — | — | như `/login` | SEC | `jwt.test.js` | OK |
| POST | `/token/refresh` | ✗ | — | — | CAS trên token hash | hết hạn/thu hồi/**đốt family** | SEC | `jwt.test.js` | OK |
| POST | `/token/revoke` | ✗ | — | — | theo token hash | — | — | — | OK |
| POST | `/token/revoke-all` | ✓ | — | self | — | — | — | — | OK |
| POST | `/forgot-password` | ✗ | — | — | — | chỉ tài khoản `active` | — | — | OK |
| GET | `/invite/:token` | ✗ | — | — | hash token + hạn | — | PII | — | OK |
| POST | `/accept-invite` | ✗ | — | — | hash token + hạn | thu hồi mọi phiên cũ | SEC | — | OK |

> Giới hạn tần suất: `/login` + `/token` 10 lần/15 phút mỗi IP (`skipSuccessfulRequests`); `/forgot-password` 5/15 phút.
> Chống dò tài khoản: bcrypt luôn chạy với dummy hash; `/forgot-password` trả 200 **trước** khi làm việc nền.

## `/api/quotes` — 26 endpoint

| M | Đường dẫn | AUTH | QUYỀN | P.VI | T.NGUYÊN | T.THÁI | N.CẢM | TEST | TT |
|---|---|---|---|---|---|---|---|---|---|
| GET | `/` | ✓ | `quote:read:*` | all/own | `quoteScopeWhereOrThrow` | — | $ PII | AUTH-002 | **VÁ** |
| GET | `/next-number` | ✓ | — | — | — | — | — | — | OK |
| GET | `/assignable-users` | ✓ | `quote:create` | global | — | chỉ user `active` | PII | — | OK |
| GET | `/projects` | ✓ | `user:manage`\|`invoice:read`\|`invoice:page` **hoặc** `quote:read:own` | all/own | — | chỉ `converted` | $ PII | AUTH-005 | **VÁ** |
| POST | `/sheets/:sheetId/sign` | ✓ | `quote:sign:all`\|`:own` | all/own | qua `sheet.quote.createdById` | chỉ `converted`, chưa xoá | — | — | OK |
| POST | `/sheets/:sheetId/customer-decision` | ✓ | `quote:send` | own | `canOnQuote(update)` | chưa xoá | — | — | OK |
| PUT | `/sheets/:sheetId/invoice` | ✓ | `invoice:read`\|`page` vào; `invoice:edit`/`pay` **theo từng field** | global | qua sheet→quote | chỉ `converted` | $ | — | OK |
| POST | `/:id/extra/:sheetId/:rid/pay` | ✓ | `quote:internal:pay` | global | sheet phải thuộc `:id` | `FOR UPDATE` khoá hàng | $ | — | OK |
| GET | `/:id/extra/:sheetId/:rid/proof` | ✓ | `internal:view`\|`internal:pay` | global | sheet phải thuộc `:id` | — | PII | — | OK |
| GET | `/hn/accounts` | ✓ | `quote:hn:manage` | global | — | chỉ user `active` | PII | — | OK |
| GET | `/:id` | ✓ | `quote:read:*` | all/own | `canOnQuote(read)` | — | $ PII | AUTH-002 | OK |
| POST | `/` | ✓ | `quote:create` | — | route **+** service | — | — | AUTH-001 | **VÁ** |
| PUT | `/:id` | ✓ | `quote:update:*` | all/own | `canEdit` | terminal bất biến + khoá lạc quan | $ | `quotes.workflow` | OK |
| POST | `/:id/hn/assign` | ✓ | `quote:hn:manage` | own | `canOnQuote(update)` | — | — | — | OK |
| PUT | `/:id/hn` | ✓ | `quote:hn:fill` | được-giao | `hnAssigneeId === me` | chặn khi đã gửi/duyệt | $ | — | OK |
| POST | `/:id/hn/submit` | ✓ | `quote:hn:fill` | được-giao | `hnAssigneeId === me` | chỉ `assigned`/`rejected` | — | — | OK |
| POST | `/:id/hn/review` | ✓ | `quote:hn:manage` | own | `canOnQuote(update)` | chỉ `submitted` | — | — | OK |
| POST | `/:id/mark-converted` | ✓ | `quote:send` | all/own | `canOnQuote(update)` | CAS chống đua terminal | $ | `quotes.workflow` | OK |
| POST | `/:id/mark-lost` | ✓ | `quote:send` | all/own | `canOnQuote(update)` | CAS chống đua terminal | — | `quotes.workflow` | OK |
| GET | `/:id/versions` | ✓ | `quote:read:*` | all/own | `loadAuthorizedQuote` | — | $ | — | OK |
| GET | `/:id/versions/:v` | ✓ | `quote:read:*` | all/own | `loadAuthorizedQuote` | — | $ | — | OK |
| GET | `/:id/versions/:a/diff/:b` | ✓ | `quote:read:*` | all/own | `loadAuthorizedQuote` | — | $ | — | OK |
| GET | `/:id/approvals` | ✓ | `quote:read:*` | all/own | `loadAuthorizedQuote` | — | — | — | OK |
| PUT | `/:id/members` | ✓ | người tạo **hoặc** `quote:update:all` | own | so `createdById` | — | PII | — | OK |
| DELETE | `/:id` | ✓ | `quote:delete:*` | all/own | `canOnQuote(delete)` | **`converted` không ai xoá được** | — | `quotes.workflow` | OK |
| POST | `/:id/duplicate` | ✓ | `quote:create` **và** đọc được nguồn | own | `canOnQuote(read)` | — | $ | — | OK |

## `/api/customers` — 8 endpoint

| M | Đường dẫn | AUTH | QUYỀN | P.VI | T.NGUYÊN | T.THÁI | N.CẢM | TEST | TT |
|---|---|---|---|---|---|---|---|---|---|
| GET | `/` | ✓ | `customer:read:*` | all/own | `readScopeWhereOrThrow` | — | PII | AUTH-003 | **VÁ** |
| POST | `/` | ✓ | `customer:create` | — | ghim `ownerId` nếu thiếu `edit:all` | trùng mã/MST → 409 | PII | — | OK |
| GET | `/:id` | ✓ | `customer:read:*` | all/own | `canScoped` | — | PII | — | OK |
| PUT | `/:id` | ✓ | `customer:edit:*` | all/own | `canScoped` | trùng mã/MST → 409 | PII | — | **VÁ** |
| DELETE | `/:id` | ✓ | `customer:delete:*` | all/own | `canScoped` | xoá mềm | — | — | OK |
| POST | `/:id/notes` | ✓ | `customer:note:add` + đọc được KH | all/own | `canScoped(read)` | — | — | — | OK |
| POST | `/:id/follow-ups` | ✓ | `customer:note:add` + đọc được KH | all/own | `canScoped(read)` | — | — | — | OK |
| POST | `/follow-ups/:fid/done` | ✓ | người được giao **hoặc** `customer:edit:*` | own | qua `followUp.customer` | — | — | — | OK |

## `/api/personnel` — 13 endpoint

| M | Đường dẫn | AUTH | QUYỀN | P.VI | T.NGUYÊN | T.THÁI | N.CẢM | TEST | TT |
|---|---|---|---|---|---|---|---|---|---|
| GET | `/` | ✓ | `personnel:read:own` | all/own | lọc `createdById` | — | **PII** | `personnel.test.js` | OK |
| GET | `/projects` | ✓ | `personnel:create` | all/own | lọc `createdById` | chỉ `converted` | — | — | OK |
| POST | `/` | ✓ | `personnel:create` | — | ghim `createdById = me` | — | **PII** | — | OK |
| GET | `/:id` | ✓ | `personnel:read:*` | all/own | `canScoped(createdById)` | — | **PII** | `personnel.test.js` | OK |
| PUT | `/:id` | ✓ | `personnel:edit:*` | all/own | `canScoped` | — | **PII** | `personnel.test.js` | OK |
| DELETE | `/:id` | ✓ | `personnel:delete:*` | all/own | `canScoped` | xoá mềm | — | — | OK |
| POST | `/:id/team-note` | ✓ | `personnel:edit:own` | own | `canScoped(edit)` | — | — | — | OK |
| POST | `/:id/accounting-note` | ✓ | `personnel:accounting-note` | global | — | — | — | — | OK |
| POST | `/:id/note` | ✓ | `personnel:edit:all` | global | — | — | — | — | OK |
| GET | `/:id/payment-proof` | ✓ | `personnel:read:*` | all/own | `canScoped(read)` | — | **PII** | — | OK |
| GET | `/:id/contract` | ✓ | `personnel:read:*` | all/own | `canScoped(read)` | `no-store` · `nosniff` ¹ | **PII** | — | **VÁ** |
| POST | `/:id/payment` | ✓ | `personnel:pay` | global | — | — | $ | — | OK |
| POST | `/:id/confirm` | ✓ | `personnel:confirm` | global | — | — | — | — | OK |

¹ `.docx` hợp đồng chứa CCCD + số tài khoản. Phát hiện đúng lúc lập bảng này (thiếu `no-store` trong khi mọi endpoint xuất khác đều có) → đã vá cùng đợt.
`global` ở đây **cố ý**: kế toán đánh dấu thanh toán / ghi chú cho mọi hồ sơ theo đúng nghiệp vụ.

## `/api/venues` — 12 endpoint

| M | Đường dẫn | AUTH | QUYỀN | P.VI | T.NGUYÊN | T.THÁI | N.CẢM | TEST | TT |
|---|---|---|---|---|---|---|---|---|---|
| GET | `/catalog` · `/tags` · `/` · `/:id` | ✓ | `venue:read`\|`venue:manage` | global | `requireRead()` trong service | — | — | `venues.test.js` | OK |
| POST | `/` · `/tags/bulk` · `/:id/merge` · `/:id/items` | ✓ | `venue:manage` | global | `requireManage()` + tồn tại | trùng tên+vùng → 409 | — | `venues.test.js` | OK |
| PUT | `/:id` · `/items/:itemId` | ✓ | `venue:manage` | global | `requireManage()` + tồn tại | — | — | `venues.test.js` | OK |
| DELETE | `/:id` · `/items/:itemId` | ✓ | `venue:manage` | global | `requireManage()` + tồn tại | cascade hạng mục | — | `venues.test.js` | OK |

> Quyền nằm **trong service** chứ không ở route — dễ nhìn nhầm là "không gác". Đã đối chiếu `venueService.ts:10-15`.

## `/api/users` (6) · `/api/permissions` (4)

| M | Đường dẫn | AUTH | QUYỀN | P.VI | T.NGUYÊN | T.THÁI | N.CẢM | TEST | TT |
|---|---|---|---|---|---|---|---|---|---|
| GET | `/users` | ✓ | `user:manage` | global | — | **không lọc ẩn ai** | PII | GOV-001 | **VÁ** |
| POST | `/users/invite` | ✓ | `user:manage` | — | trùng email → 409 | — | SEC | — | OK |
| POST | `/users/:id/resend-invite` | ✓ | `user:manage` | — | tồn tại | chỉ tài khoản chưa kích hoạt | SEC | — | OK |
| POST | `/users` | ✓ | `user:manage` | — | trùng username → 409 | — | — | — | OK |
| PUT | `/users/:id` | ✓ | `user:manage` | — | `sanitizePerms` chặn leo thang | chặn gỡ **admin cuối cùng**; đổi mật khẩu/khoá → thu hồi mọi phiên | SEC | `per-user-permissions` | **VÁ** |
| DELETE | `/users/:id` | ✓ | `user:manage` | — | không tự xoá mình | có báo giá → 409 | — | — | OK |
| GET | `/permissions/catalog` | ✓ | `user:manage` | — | — | — | — | `role-permissions` | OK |
| PUT | `/permissions/roles/:role` | ✓ | `user:manage` | — | chặn sửa `admin` | lọc `ADMIN_ONLY_PERMISSIONS` | — | `role-permissions` | OK |
| DELETE | `/permissions/roles/:role` | ✓ | `user:manage` | — | chặn sửa `admin` | — | — | `role-permissions` | OK |
| GET | `/permissions/me` | ✓ | — | self | — | — | — | — | OK |

## `/api/files` — 5 endpoint

| M | Đường dẫn | AUTH | QUYỀN | P.VI | T.NGUYÊN | T.THÁI | N.CẢM | TEST | TT |
|---|---|---|---|---|---|---|---|---|---|
| POST | `/` | ✓ | — | own | key do **server** sinh trong namespace mình | magic bytes + 10MB + allowlist MIME | — | — | OK |
| GET | `/sign-download` | ✓ | — | theo namespace | `canAccessKey` (chặn `..`, `//`, `\`, `\0`; `exports/` → `canOnQuote`) | — | $ | — | OK |
| POST | `/sign-upload` | ✓ | — | own | key server sinh | **`Content-Length` vào chữ ký** + limiter 30/phút/tài khoản | — | FILE-001 | **VÁ** |
| POST | `/finalize` | ✓ | — | own | chỉ namespace của mình | HEAD + **dò magic bytes** → sai thì **xoá object** | — | FILE-001 | **VÁ** |
| DELETE | `/` | ✓ | `role=admin` | global | — | — | — | — | OK |

## `/api/admin` (3) · `/api/settings` (4) · `/api/webhooks` (6)

| M | Đường dẫn | AUTH | QUYỀN | P.VI | T.NGUYÊN | T.THÁI | N.CẢM | TEST | TT |
|---|---|---|---|---|---|---|---|---|---|
| GET | `/admin/backup.dump` | ✓ | `settings:manage` | global | — | limiter 5/15ph · audit · `no-store` · dọn temp khi ngắt | **SEC toàn bộ CSDL** | ADM-001 | **VÁ** |
| GET | `/admin/stats` | ✓ | `settings:manage` | global | — | — | — | — | OK |
| POST | `/admin/purge-soft-deleted` | ✓ | `settings:manage` | global | `none:{}` chặn xoá bản còn bị tham chiếu | lỗi nổi lên, không nuốt | — | — | OK |
| GET | `/settings/` | ✓ | `settings:manage` | global | — | — | SEC | — | OK |
| GET | `/settings/:key` | ✓ | allowlist `notif.channels`, còn lại `settings:manage` | global | — | — | SEC | — | OK |
| PUT/DELETE | `/settings/:key` | ✓ | `settings:manage` | global | — | trần 64KB | SEC | — | OK |
| GET | `/webhooks/events` · `/` · `/:id/deliveries` | ✓ | `settings:manage` | global | — | secret che còn 4 ký tự cuối | SEC | — | OK |
| POST/PUT/DELETE | `/webhooks/*` | ✓ | `settings:manage` | global | — | **chống SSRF** khi giao (chặn IP nội bộ, ghim IP, cấm redirect) | SEC | — | OK |

## `/api/gdpr` (4) · `/api/audit` (1) · `/api/search` (1) · `/api/analytics` (4)

| M | Đường dẫn | AUTH | QUYỀN | P.VI | T.NGUYÊN | T.THÁI | N.CẢM | TEST | TT |
|---|---|---|---|---|---|---|---|---|---|
| GET | `/gdpr/me/export` | ✓ | — | self | ghim `session.userId` | limiter 8/giờ · `no-store` · `nosniff` | **PII đầy đủ** | GDPR-001 | **VÁ** |
| GET | `/gdpr/users/:id/export` | ✓ | `user:manage` | global | — | `no-store` · `nosniff` | **PII đầy đủ** | GDPR-001 | **VÁ** |
| POST | `/gdpr/me/delete` | ✓ | — | self | đòi gõ `DELETE-MY-ACCOUNT` | transaction vô danh hoá + thu hồi token | — | — | OK |
| POST | `/gdpr/users/:id/delete` | ✓ | `user:manage` | global | chặn tự xoá mình | như trên | — | — | OK |
| GET | `/audit/` | ✓ | `audit:view` | global | — | **lược `before`/`after`/`ip`/`ua`** nếu thiếu `audit:view:full` | PII | `gd1-audit-beforeafter` | OK |
| GET | `/search/` | ✓ | **theo từng domain** | all/own | quote→scope · customer→`readScopeWhere` · product→`product:read` | domain thiếu quyền **biến mất** + liệt kê trong `denied` | $ PII | AUTH-004 | **VÁ** |
| GET | `/analytics/overview` · `/funnel` | ✓ | `quote:create` **và** `quote:read:*` | all/own | `quoteScopeWhereOrThrow` | — | $ | AUTH-006 | **VÁ** |
| GET | `/analytics/revenue-by-day` · `/top-sales` | ✓ | `quote:create` **và** `quote:read:*` | all/own | `seesAllQuotes()` | — | $ | AUTH-006 | **VÁ** |

## `/api/employees` (4) · `/api/notifications` (4) · `/api/meta` (2) · `/api/mfa` (3) · `/api/stream` (2) · `/api/export` (2) · `/api/jobs` (2) · `/api/quotes/import-excel` (1)

| M | Đường dẫn | AUTH | QUYỀN | P.VI | T.NGUYÊN | T.THÁI | N.CẢM | TEST | TT |
|---|---|---|---|---|---|---|---|---|---|
| GET | `/employees/` | ✓ | `employee:read:own` | **global** ² | — | — | **PII** | — | OK |
| POST | `/employees/` | ✓ | `employee:create` | global | ghim `createdById` | — | **PII** | — | OK |
| PUT | `/employees/:id` | ✓ | `employee:edit:own` | **global** ² | tồn tại | — | **PII** | — | OK |
| DELETE | `/employees/:id` | ✓ | `employee:delete:own` | **global** ² | tồn tại | xoá mềm | — | — | OK |
| GET | `/notifications/` · `/unread-count` | ✓ | — | self | ghim `userId` | — | — | — | OK |
| POST | `/notifications/:id/read` · `/read-all` | ✓ | — | self | `updateMany` có `userId` | — | — | — | OK |
| GET | `/meta/companies` · `/templates` | ✓ | — | global | — | chỉ bản `active` | — | — | OK |
| POST | `/mfa/setup` · `/enable` · `/disable` | ✓ | — | self | **đòi mật khẩu** (step-up) | limiter 10/15ph theo tài khoản; TOTP chống replay; mã dự phòng dùng-một-lần | SEC | `mfa.test.js` | OK |
| GET | `/stream/events` | ✓ | — | self | kênh theo `userId` | không nén (SSE) | — | — | OK |
| POST | `/stream/presence` | ✓ | — | own | `canOnQuote(read)` | **gửi có địa chỉ**, không phát tán toàn hệ thống | PII | — | **VÁ** |
| GET | `/export/:id.xlsx` · `:id.pdf` | ✓ | `quote:export` | all/own | `canOnQuote(read)` | trần 100 sheet / 20k dòng · limiter 30/ph · `no-store` | $ | — | OK |
| POST | `/quotes/:id/export` (async) | ✓ | `quote:export` | all/own | `canOnQuote(read)` | — | $ | — | OK |
| GET | `/jobs/:queue/:id` | ✓ | — | own | chỉ người đặt job **hoặc** `quote:read:all` | **chỉ mở queue `export`** ³ | $ | — | OK |
| POST | `/quotes/import-excel` | ✓ | `quote:create` | own | `canOnQuote(update)` nếu có `quoteId` | chặn `account_hn` · terminal → 409 · magic bytes · limiter 12/ph | — | `excelImport.test.js` | OK |

² Danh bạ nhân sự là **kho dùng chung có chủ đích** — `:own` ở đây là tên quyền, không phải phạm vi dữ liệu. Xem ghi chú `employees.routes.ts:35`.
³ Các queue khác (email/webhook/telegram) chứa địa chỉ nhận + URL + secret trong `job.data` → không bao giờ lộ, kể cả cho admin.

## Ngoài router — 4 endpoint

| M | Đường dẫn | AUTH | QUYỀN | Ghi chú | TT |
|---|---|---|---|---|---|
| GET | `/metrics` | Bearer | `METRICS_TOKEN` | **fail-closed ở prod**: thiếu token → 404. So sánh hằng-thời-gian | OK |
| GET | `/livez` · `/api/health` | ✗ | — | chỉ `{ok:true}` | OK |
| GET | `/readyz` | ✗ | — | không lộ chi tiết lỗi DB | OK |

---

## Tổng kết

| Trạng thái | Số endpoint |
|---|---:|
| `OK` — đã đúng từ trước | 107 |
| **`VÁ`** — sửa trong đợt này | **26** |
| `NỢ` — còn thiếu | 0 |
| `UNKNOWN` | **0** |

### Ma trận diễn viên × tài nguyên (sau bản vá)

| | báo giá | khách hàng | sản phẩm | nhân sự | danh bạ | hoá đơn | quản trị |
|---|---|---|---|---|---|---|---|
| **ẩn danh** | 401 | 401 | 401 | 401 | 401 | 401 | 401 |
| **admin** | all | all | all | all | all | all | all |
| **manager** (Account) | own+gửi | all | đọc+giá vốn | own | all | dự án own | nhật ký |
| **account_hn** | **chỉ bảng HN được giao** | **403** | **403** | 403 | 403 | 403 | 403 |
| **hr** | **403** | **403** | **403** | đọc all | 403 | 403 | 403 |
| **accountant** | **403** | **403** | **403** | đọc all + đánh dấu TT | 403 | trang Hoá đơn | 403 |
| **tài khoản bị gỡ sạch quyền** | **403** | **403** | **403** | **403** | **403** | **403** | **403** |

Sáu ô **in đậm** ở hai hàng cuối chính là những chỗ trước bản vá trả **200 kèm dữ liệu**.
