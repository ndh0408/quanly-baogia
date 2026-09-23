# Ma trận phân quyền — toàn bộ 141 endpoint

Chốt ngày 2026-08-11, nhánh `feat/venue-suggest`. Phụ lục của [docs/archive/audits/SECURITY_AUDIT_2026-08.md](../archive/audits/SECURITY_AUDIT_2026-08.md).

**Mục tiêu**: không còn endpoint nào ở trạng thái `UNKNOWN`. Mọi dòng dưới đây đã được đối chiếu với mã nguồn.

> ### Con số này được SINH TỰ ĐỘNG, không đếm tay
>
> ```bash
> node scripts/ci/endpoint-inventory.mjs          # bảng đầy đủ
> node scripts/ci/endpoint-inventory.mjs --check  # CI: lệch số → exit 1
> ```
>
> **Vì sao**: README từng ghi *141 endpoint*, bản đầu của chính tài liệu này ghi *133*. Cả hai đều
> đếm tay nên cả hai đều sai — con số thật là **138** (130 trong router + 8 khai báo thẳng trên
> `app`). Bản 133 đã bỏ sót các route phục vụ SPA vì tôi chỉ nhớ 4 endpoint hạ tầng.
>
> Từ 139 xuống 137 ngày 2026-08-26: bỏ `GET /app` và `GET /app/*` khi gỡ SPA vanilla cũ
> Từ 137 lên 138 ngày 2026-09-01: thêm `POST /users/:id/mfa-reset` — đường phục hồi cho
> người mất cả điện thoại lẫn mã dự phòng (trước đó chỉ chữa được bằng SQL tay trên production).
> (xem [ADR 0006](../adr/0006-go-spa-vanilla-cu.md)).
>
> CI chạy `--check`; thêm/xoá route mà quên cập nhật bảng này là **đỏ pipeline**. Một endpoint không
> có trong ma trận là một endpoint chưa ai soát quyền.

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
| POST | `/login` | ✗ | — | — | — | khoá tài khoản + MFA · **một thông điệp chung cho mọi thất bại** | — | AUTH-007 | **VÁ** |
| POST | `/logout` | ✗ | — | self | — | — | — | `app.smoke` | OK |
| GET | `/me` | ✓ | — | self | — | — | PII | — | OK |
| POST | `/profile` | ✓ | — | self | ghim `session.userId` | — | PII | — | OK |
| POST | `/change-password` | ✓ | — | self | đòi mật khẩu cũ | thu hồi refresh token + huỷ mọi phiên khác + **xoay định danh phiên của mình** | SEC | SESSION-001 | **VÁ** |
| POST | `/token` | ✗ | — | — | — | như `/login` (dùng chung authCore) | SEC | AUTH-007 | **VÁ** |
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
| GET | `/next-number` | ✓ | `quote:create` | — | — | — | — | AUTHZ-007 | **VÁ** |
| GET | `/assignable-users` | ✓ | `quote:create` | global | — | chỉ user `active` | PII | — | OK |
| GET | `/projects` | ✓ | `user:manage`\|`invoice:read`\|`invoice:page` **hoặc** `quote:read:own` | all/own | — | chỉ `converted` | $ PII | AUTH-005 | **VÁ** |
| POST | `/sheets/:sheetId/sign` | ✓ | `quote:sign:all`\|`:own` | all/own | qua `sheet.quote.createdById` | chỉ `converted`, chưa xoá | — | — | OK |
| POST | `/sheets/:sheetId/customer-decision` | ✓ | `quote:send` | own | `canOnQuote(update)` | chưa xoá | — | — | OK |
| PUT | `/sheets/:sheetId/invoice` | ✓ | `invoice:read`\|`page` vào; `invoice:edit`/`pay` **theo từng field** | global | qua sheet→quote | chỉ `converted` | $ | — | OK |
| POST | `/:id/extra/:sheetId/:rid/pay` | ✓ | `quote:internal:pay` | all/own ⁴ | `assertQuoteInScope` → `canOnQuote(read)` **+** sheet phải thuộc `:id` | `FOR UPDATE` khoá hàng · báo giá xoá mềm → 404 | $ | `rbacscope-extra-idor` | **VÁ** |
| GET | `/:id/extra/:sheetId/:rid/proof` | ✓ | `internal:view`\|`internal:pay` | all/own ⁴ | `assertQuoteInScope` → `canOnQuote(read)` **+** sheet phải thuộc `:id` | báo giá xoá mềm → 404 · ghi audit `quote.internal.proof-view` | **PII** | `rbacscope-extra-idor` | **VÁ** |
| POST | `/:id/hn/:rid/pay` | ✓ | `quote:internal:pay` | all/own ⁴ | `assertQuoteInScope` → `canOnQuote(read)` **+** phạm vi `hanoi` (account phụ) | hàng bảng HN nằm ở `Quote.hnTables` nên KHÔNG có `:sheetId` · `FOR UPDATE` khoá hàng Quote | $ | `quote-hn-cap-bao-gia` | OK |
| GET | `/:id/hn/:rid/proof` | ✓ | `internal:view`\|`internal:pay` | all/own ⁴ | `assertQuoteInScope` → `canOnQuote(read)` | ghi audit `quote.internal.proof-view` (cờ `hn`) | **PII** | `quote-hn-cap-bao-gia` | OK |
| GET | `/hn/accounts` | ✓ | `quote:hn:manage` | global | — | chỉ user `active` | PII | — | OK |
| GET | `/:id` | ✓ | `quote:read:*` | all/own | `canOnQuote(read)` | — | $ PII | AUTH-002 | OK |
| POST | `/` | ✓ | `quote:create` | — | route **+** service | — | — | AUTH-001 | **VÁ** |
| PUT | `/:id` | ✓ | `quote:update:*` | all/own | `canEdit` | terminal bất biến + khoá lạc quan | $ | `quotes.workflow` | OK |
| POST | `/:id/hn/assign` | ✓ | `quote:hn:manage` | own | `canOnQuote(update)` | — | — | — | OK |
| PUT | `/:id/hn` | ✓ | `quote:hn:fill` | được-giao | `hnAssigneeId === me` | chặn khi đã gửi/duyệt | $ | — | OK |
| POST | `/:id/hn/submit` | ✓ | `quote:hn:fill` | được-giao | `hnAssigneeId === me` | chỉ `assigned`/`rejected` | — | — | OK |
| POST | `/:id/hn/review` | ✓ | `quote:hn:manage` | own | `canOnQuote(update)` | chỉ `submitted` | — | — | OK |
| POST | `/:id/mark-converted` | ✓ | `quote:send` | all/own | `canOnQuote(update)` | CAS chống đua terminal · **account phụ 403** | $ | `quotes.workflow` | OK |
| POST | `/:id/mark-lost` | ✓ | `quote:send` | all/own | `canOnQuote(update)` | CAS chống đua terminal · **account phụ 403** | — | `quotes.workflow` | OK |
| GET | `/:id/versions` | ✓ | `quote:read:*` | all/own | `loadAuthorizedQuote` | — | $ | — | OK |
| GET | `/:id/versions/:v` | ✓ | `quote:read:*` | all/own | `loadAuthorizedQuote` | — | $ | — | OK |
| GET | `/:id/versions/:a/diff/:b` | ✓ | `quote:read:*` | all/own | `loadAuthorizedQuote` | — | $ | — | OK |
| GET | `/:id/approvals` | ✓ | `quote:read:*` | all/own | `loadAuthorizedQuote` | — | — | — | OK |
| PUT | `/:id/members` | ✓ | người tạo **hoặc** `quote:update:all` | own | so `createdById` | nhận `members[{userId,scopes}]` (client cũ gửi `memberIds` = đủ 4 vùng) | PII | — | OK |
| DELETE | `/:id` | ✓ | `quote:delete:*` | all/own | `canOnQuote(delete)` | **`converted` không ai xoá được** | — | `quotes.workflow` | OK |
| POST | `/:id/duplicate` | ✓ | `quote:create` **và** đọc được nguồn | own | `canOnQuote(read)` | **account phụ 403** (bản sao sẽ đứng tên người bấm + mang mã dự án của họ) | $ | — | OK |

⁴ `quote:internal:*` là **năng lực**, không phải phạm vi. Phạm vi báo giá do `assertQuoteInScope`
(`src/services/quoteService.ts`) áp. Hàm này **cố ý** hỏi action `read` cho **cả** đường ghi `/pay`:
`quote:internal:pay` mới là cổng GHI, còn `read` chỉ trả lời "được đụng tới báo giá nào". Siết lên
`canOnQuote(update)` sẽ khoá đúng tài khoản chi phí (chỉ có `quote:read:own`; tư cách thành viên
không suy ra `quote:update:*`) — đó là đổi **chính sách**, và `rbacscope-extra-idor` đã chốt hành vi
hiện tại lại để lần sau ai đổi thì thấy đỏ.

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

## `/api/users` (7) · `/api/permissions` (4)

| M | Đường dẫn | AUTH | QUYỀN | P.VI | T.NGUYÊN | T.THÁI | N.CẢM | TEST | TT |
|---|---|---|---|---|---|---|---|---|---|
| GET | `/users` | ✓ | `user:manage` | global | — | **không lọc ẩn ai** | PII | GOV-001 | **VÁ** |
| POST | `/users/invite` | ✓ | `user:manage` | — | trùng email → 409 | — | SEC | — | OK |
| POST | `/users/:id/resend-invite` | ✓ | `user:manage` | — | tồn tại | chỉ tài khoản chưa kích hoạt | SEC | — | OK |
| POST | `/users` | ✓ | `user:manage` | — | trùng username → 409 | — | — | — | OK |
| PUT | `/users/:id` | ✓ | `user:manage` | — | `sanitizePerms` chặn leo thang | chặn gỡ **admin cuối cùng**; đổi mật khẩu/khoá → thu hồi mọi phiên | SEC | `per-user-permissions` | **VÁ** |
| DELETE | `/users/:id` | ✓ | `user:manage` | — | không tự xoá mình | có báo giá → 409 | — | — | OK |
| POST | `/users/:id/mfa-reset` | ✓ | `user:manage` | — | tài khoản tồn tại; chưa bật MFA → 400 | gỡ cờ + xoá bí mật/mã dự phòng, **thu hồi mọi phiên** của người đó | SEC | `mfa-reset` | OK |
| GET | `/permissions/catalog` | ✓ | `user:manage` | — | — | — | — | `role-permissions` | OK |
| PUT | `/permissions/roles/:role` | ✓ | `user:manage` | — | chặn sửa `admin` | lọc `ADMIN_ONLY_PERMISSIONS` | — | `role-permissions` | OK |
| DELETE | `/permissions/roles/:role` | ✓ | `user:manage` | — | chặn sửa `admin` | — | — | `role-permissions` | OK |
| GET | `/permissions/me` | ✓ | — | self | — | trả quyền **hiệu lực của phiên**, khớp `/auth/me` | — | PERM-001 | **VÁ** |

## `/api/files` — 5 endpoint

| M | Đường dẫn | AUTH | QUYỀN | P.VI | T.NGUYÊN | T.THÁI | N.CẢM | TEST | TT |
|---|---|---|---|---|---|---|---|---|---|
| POST | `/` | ✓ | `file:upload` | own | key do **server** sinh trong namespace mình | magic bytes + **cấu trúc zip** (xlsx) + 10MB + allowlist · ghi bản ghi `finalized` | — | FILE-002 | **VÁ** |
| GET | `/sign-download` | ✓ | — *(cố ý: đường ĐỌC, `canAccessKey` là chốt phạm vi)* | theo namespace | `canAccessKey` (chặn `..`, `//`, `\`, `\0`; `exports/` → `canOnQuote`) | — | $ | — | OK |
| POST | `/sign-upload` | ✓ | `file:upload` | own | key server sinh | **`Content-Length` vào chữ ký** + limiter 30/ph/tài khoản + trần 20 phiên `pending` + tạo bản ghi TRƯỚC khi ký | — | FILE-001 | **VÁ** |
| POST | `/finalize` | ✓ | `file:upload` | own | bản ghi `UploadObject` + chủ sở hữu | HEAD → khớp kích thước+kiểu đã ký → magic bytes → cấu trúc zip → **CAS `pending`→`finalized`**; sai thì xoá object + `rejected` | — | FILE-001 · FILE-002 | **VÁ** |
| DELETE | `/` | ✓ | `role=admin` | global | — | — | — | — | OK |

## `/api/admin` (3) · `/api/settings` (4) · `/api/webhooks` (6)

| M | Đường dẫn | AUTH | QUYỀN | P.VI | T.NGUYÊN | T.THÁI | N.CẢM | TEST | TT |
|---|---|---|---|---|---|---|---|---|---|
| POST | `/admin/backup.dump` | ✓ | `settings:manage` | global | — | limiter 5/15ph · audit · `no-store` · dọn temp khi ngắt · POST để qua cổng CSRF | **SEC toàn bộ CSDL** | ADM-001 | **VÁ** |
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

## `/api/employees` (4) · `/api/notifications` (4) · `/api/meta` (2) · `/api/mfa` (3) · `/api/stream` (2) · `/api/export` (2) · `/api/jobs` (3) · `/api/quotes/import-excel` (1)

| M | Đường dẫn | AUTH | QUYỀN | P.VI | T.NGUYÊN | T.THÁI | N.CẢM | TEST | TT |
|---|---|---|---|---|---|---|---|---|---|
| GET | `/employees/` | ✓ | `employee:read:own` | all/own | `readScopeWhereOrThrow(…, "createdById")` | — | **PII** | `rbacscope-employee-directory` | **VÁ** |
| POST | `/employees/` | ✓ | `employee:create` | global | ghim `createdById` | — | **PII** | — | OK |
| PUT | `/employees/:id` | ✓ | `employee:edit:own` | all/own ² | tồn tại **+** `assertEmployeeInReadScope` → `canScoped(employee, read)` | — | **PII** | `rbacscope-employee-directory` | **VÁ** |
| DELETE | `/employees/:id` | ✓ | `employee:delete:own` | all/own ² | tồn tại **+** `assertEmployeeInReadScope` | xoá mềm | — | `rbacscope-employee-directory` | **VÁ** |
| GET | `/notifications/` · `/unread-count` | ✓ | — | self | ghim `userId` | — | — | — | OK |
| POST | `/notifications/:id/read` · `/read-all` | ✓ | — | self | `updateMany` có `userId` | — | — | — | OK |
| GET | `/meta/companies` · `/templates` | ✓ | — | global | — | chỉ bản `active` · **projection tối thiểu** (bỏ `filePath`/`logoPath`) | — | AUTHZ-008 | **VÁ** |
| POST | `/mfa/setup` · `/enable` · `/disable` | ✓ | — | self | **đòi mật khẩu** (step-up) | limiter 10/15ph theo tài khoản; TOTP chống replay; mã dự phòng dùng-một-lần | SEC | `mfa.test.js` | OK |
| GET | `/stream/events` | ✓ | — | self | kênh theo `userId` | không nén (SSE) | — | — | OK |
| POST | `/stream/presence` | ✓ | — | own | `canOnQuote(read)` | **gửi có địa chỉ**, không phát tán toàn hệ thống | PII | — | **VÁ** |
| GET | `/export/:id.xlsx` · `:id.pdf` | ✓ | `quote:export` | all/own | `canOnQuote(read)` | trần 100 sheet / 20k dòng · limiter 30/ph · `no-store` | $ | — | OK |
| POST | `/quotes/:id/export` (async) | ✓ | `quote:export` | all/own | `canOnQuote(read)` | — | $ | — | OK |
| GET | `/jobs/:queue/:id` | ✓ | — | own | chỉ người đặt job **hoặc** (`quote:read:all` **+** `quote:export`) | **chỉ mở queue `export`** ³ · `url` trả về là đường cùng origin `…/file` | $ | `xn-tai-file-xuat-nen-qua-app` | OK |
| GET | `/jobs/:queue/:id/file` | ✓ | — | own | **cùng hàm gác** với dòng trên (`layJobXuat`) | chỉ khoá `exports/…` · stream từ kho qua app (kho không lộ ra Internet) | $ | `xn-tai-file-xuat-nen-qua-app` | OK |
| POST | `/quotes/import-excel` | ✓ | `quote:create` | own | `canOnQuote(update)` nếu có `quoteId` | chặn `account_hn` · terminal → 409 · magic bytes · limiter 12/ph | — | `excelImport.test.js` | OK |

² Danh bạ nhân sự **vẫn là kho dùng chung khi GHI** cho mọi tài khoản Account thật, nhưng phạm vi ghi
bám theo **phạm vi ĐỌC**, không theo `employee:edit:*`. `:own` trong TÊN QUYỀN `employee:edit:own` /
`employee:delete:own` vẫn không phải phạm vi dữ liệu; phạm vi dữ liệu do `assertEmployeeInReadScope`
(`src/services/employeeService.ts`) áp bằng `employee:read:*`. Vì EMPLOYEE nền — và MANAGER/ADMIN kế
thừa — đều có `employee:read:all` (`src/permissions.ts:266`), sửa/xoá chéo **không đổi**; chỉ tập
quyền per-user bị bó về `employee:read:own` mới hết PUT/DELETE mục người khác. Bỏ chốt đó thì `PUT`
chính là một kênh **ĐỌC PII đầy đủ** — nó trả bản ghi đã giải mã và body rỗng `{}` vẫn hợp lệ, nên
chặn `GET` mà để ngỏ `PUT` là hàng rào rỗng. Xem `src/routes/employees.routes.ts`.

³ Các queue khác (email/webhook/telegram) chứa địa chỉ nhận + URL + secret trong `job.data` → không bao giờ lộ, kể cả cho admin.

## Ngoài router — 8 endpoint

Nhóm này **bị bỏ sót ở bản ma trận đầu** (chỉ liệt kê 4). Chúng không phục vụ dữ liệu nghiệp vụ,
nhưng "không có dữ liệu" phải là kết luận sau khi kiểm, không phải lý do để không liệt kê.

| M | Đường dẫn | AUTH | QUYỀN | Ghi chú | TT |
|---|---|---|---|---|---|
| GET | `/metrics` | Bearer | `METRICS_TOKEN` | **fail-closed ở prod**: thiếu token → 404. So sánh hằng-thời-gian | OK |
| GET | `/api/csrf-token` | ✗ | — | Cấp mã chống giả mạo GẮN VỚI PHIÊN gọi nó. Công khai một cách CÓ CHỦ Ý: mã chỉ có giá trị với đúng phiên nhận nó, nên lấy được mã của phiên MÌNH không giúp gì cho việc giả mạo phiên NGƯỜI KHÁC. `no-store` để proxy/CDN không phát mã của người này cho người kia | OK |
| GET | `/livez` · `/api/health` | ✗ | — | chỉ `{ok:true}` | OK |
| GET | `/readyz` | ✗ | — | không lộ chi tiết lỗi DB | OK |
| GET | `/app2` · `/app2/*` | ✗ | — | trả `public/app2/index.html` (vỏ SPA React) — như trên | OK |
| GET | `*` (đón mọi đường còn lại) | ✗ | — | vỏ SPA React. Đặt SAU `notFound` nên `/api/*` không tồn tại vẫn trả **404 JSON**, không rơi vào vỏ SPA | OK |

---

## Tổng kết

| Trạng thái | Số endpoint |
|---|---:|
| `OK` — đã đúng từ trước | 106 |
| **`VÁ`** — sửa trong hai đợt rà soát | **32** |
| `NỢ` — còn thiếu | 0 |
| `UNKNOWN` | **0** |

Đợt 2 vá thêm 7 endpoint: `/api/files/sign-download` · `/api/files/finalize` · `/api/files/` (trạng
thái tải lên là ràng buộc thật, không còn là quy ước) · `/api/auth/login` + `/api/auth/token` (bỏ
oracle phân loại tài khoản) · `/api/auth/change-password` (xoay định danh phiên) ·
`/api/permissions/me` (quyền hiệu lực thay vì quyền vai trò) · `/api/quotes/next-number` +
`/api/meta/*` (least privilege).

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
| **account phụ** (được thêm vào 1 báo giá) | xem đủ · sửa đúng vùng được tick | theo quyền riêng | theo quyền riêng | theo quyền riêng | theo quyền riêng | **403** (lọc `createdById`) | theo quyền riêng |

Sáu ô **in đậm** ở hai hàng `hr` / `accountant` chính là những chỗ trước bản vá trả **200 kèm dữ liệu**.

### Phần "Báo Giá Hà Nội" — từ 2026-09-15 ở CẤP BÁO GIÁ

`Quote.hnTables` (migration `20260915140000`), KHÔNG còn nằm trong `QuoteSheet.extraTables` với
`category:"hanoi"`. Ba lý do, cả ba là lỗi thật đã xảy ra:

| Chỗ lưu cũ (theo TRANG) | Hệ quả |
|---|---|
| Màn account HN lặp theo trang của chủ, trả kèm `sheetName`/`sheetId` | Người chỉ được giao ĐIỀN GIÁ biết luôn báo giá có mấy trang và tên từng trang |
| Lưu phải ghép theo `sheetId`, mà lưu báo giá là **xoá trang rồi tạo lại** | Chủ bấm Lưu một lần là account HN gõ xong nhận 409 "hãy tải lại trang" |
| Bảng HN sống trong hàng `QuoteSheet` | Chủ xoá một trang là bảng HN trên trang đó **chết theo, im lặng** |

Hợp đồng mới:

- Account HN có **không gian riêng, phẳng**: tự thêm/xoá/đặt tên sheet, dán và **nhập từ Excel**,
  công thức + thanh công thức (`fxBar`) — cùng bộ lưới với trình soạn báo giá
  (`web/src/components/HnTables.tsx`, dùng chung cho cả màn của chủ).
- **Không thấy** thông tin khách / người gửi / ngày / VAT / lời chào: những thứ đó theo báo giá gốc.
- Chống ghi đè chuyển từ phép suy đoán "trang đã chết" sang **khoá lạc quan thật**: client gửi
  `baseUpdatedAt`, lệch thì 409 kèm lời nhắc chép lại phần vừa gõ.
- Giá HN **đã gửi duyệt/đã duyệt** thì đường lưu báo giá thường trả **409** (trước đây lặng lẽ lấy
  lại bản CSDL rồi trả 200) — trừ người có `quote:hn:manage`.
- Payload hình dạng **cũ** (`hnSheets`) bị **400** kèm hướng dẫn tải lại, KHÔNG hiểu thành "xoá hết
  bảng" — nếu không, một tab cũ bấm Lưu là mất sạch phần Hà Nội.
- Hàng bảng HN có đường thanh toán riêng vì không còn `:sheetId`:
  `POST /:id/hn/:rid/pay` và `GET /:id/hn/:rid/proof`.
- Trang **Quản lý dự án**: tổng HN là một số cho cả báo giá, **dồn vào dòng trang đầu**, các dòng
  sau để 0 — cộng cả cột vẫn ra đúng tổng, không nhân lên theo số trang.

### "Account phụ": phạm vi theo CẶP (người, báo giá)

Hàng cuối bảng trên KHÔNG phải một vai trò — `Role` là thuộc tính của TÀI KHOẢN nên không diễn
đạt được "phụ ở báo giá X, chủ ở báo giá Y" của cùng một người. Nó là hàng `QuoteMember`
(bảng tường minh từ migration `20260915090000`, trước đó là m2m ngầm `_QuoteMembers` chỉ đựng
được MỘT BIT):

| Cột | Ý nghĩa |
|---|---|
| `scopes` | tập con của `main` · `hcm` · `hanoi` · `khach` — **vùng được SỬA**. RỖNG = chỉ xem. Ba khoá cuối trùng tên `QuoteSheet.extraTables[].category`, cố ý, để không phải giữ bảng ánh xạ thứ hai |
| `addedById` / `addedAt` | ai phân công, lúc nào (bảng ngầm cũ không lưu được) |

Ba điều dễ hiểu nhầm:

1. **Membership KHÔNG tự cấp quyền.** Nhánh thành viên trong `canOnQuote` nằm BÊN TRONG
   `if (can(session, quote:<action>:own))`, nên thêm một tài khoản `hr`/`accountant` làm account
   phụ là **vô tác dụng hoàn toàn im lặng**. Đó là chốt bảo mật cố ý
   (`tests/security-regression.test.js`), không phải thiếu sót — giao diện cảnh báo trước bằng cờ
   `coTheLamPhu` của `GET /api/quotes/assignable-users`.
2. **XEM thì không lược gì**, chỉ GHI mới bị lọc. Khác hẳn `account_hn` (bị lược cả view) vì cờ
   của `account_hn` là quyền TOÀN CỤC của phiên, không phải thuộc tính của cặp (người, báo giá).
3. **Báo giá vẫn thuộc về người tạo trong mọi đường**: `createdById`, mã dự án và
   `fromContact/fromTitle/fromPhone` ("Người gửi" in ra Excel) nằm trong vùng `main` và bị GỠ khỏi
   payload nếu account phụ không được giao vùng đó; nhân bản + chốt/huỷ deal thì 403 thẳng.

Thiếu vùng `main` thì đường lưu KHÔNG xoá-tạo-lại sheet mà đi theo khuôn `saveHn` — xem
`ghiVungNoiBoDuocGiao` (`src/services/quoteService.ts`); còn có `main` mà thiếu vài bảng nội bộ thì
`reconcilePhamViTables` lấy lại bản CSDL cho những bảng ngoài phạm vi.
