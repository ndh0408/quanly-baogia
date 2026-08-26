# Mô hình bảo mật

## Danh tính: hai đường, một nguồn sự thật

| Đường | Dùng cho | Mang bởi |
|---|---|---|
| Phiên cookie | trình duyệt (cả hai SPA) | cookie `qly.sid`, kho phiên trong PG |
| Bearer JWT | client API / script | header `Authorization` |

**Vai trò và quyền KHÔNG BAO GIỜ lấy từ claim trong token.** Cả hai đường đều nạp
lại người dùng từ CSDL trên **mỗi request** (`src/middleware.ts` — `bearerAuth`
cho Bearer, `enforceActiveUser` cho cookie). `signAccessToken` có đặt `role` vào
payload nhưng **không nơi nào đọc nó**.

Hệ quả: admin khoá tài khoản, hạ quyền hay đổi vai trò là có hiệu lực ở **request
kế tiếp**, không phải chờ token hết hạn.

## Vòng đời phiên

- **Đăng nhập** gọi `req.session.regenerate()` **trước** khi gắn danh tính
  (`src/services/authService.ts`) — chống session fixation.
- **Tài khoản bị khoá / vô hiệu hoá** → đường cookie huỷ phiên và trả 401
  `session_revoked`; đường Bearer rơi xuống trạng thái chưa xác thực.
- **Đổi mật khẩu** ghi `passwordChangedAt`, thu hồi toàn bộ refresh token, và:
  - phiên cookie nào có `authAt` **trước** mốc đó bị huỷ ở request kế tiếp;
  - access token nào có `iat` **trước** mốc đó bị bỏ qua.

  Điểm đáng chú ý: chốt chính là **so mốc thời gian**, không phải lệnh `DELETE`
  trên bảng phiên. Lệnh DELETE chỉ chạy với kho phiên PG và còn nuốt lỗi — nó sẽ
  fail-open đúng vào lúc người dùng vừa nói "tôi nghi bị lộ". So mốc thời gian thì
  không fail-open được: thiếu `authAt` cũng bị coi là phiên cũ.

## CSRF

Hai lớp, áp dụng cho **đúng** tập request bị CSRF: thao tác GHI được xác thực
bằng **phiên cookie**.

1. **Origin / Referer** phải nằm trong danh sách cho phép (dựng từ `APP_BASE_URL`
   + `CORS_ORIGINS`, chuẩn hoá về origin thật).
2. **Token đồng bộ hoá gắn với phiên** — `GET /api/csrf-token` cấp, mọi lệnh ghi
   phải gửi lại qua header `X-CSRF-Token`.

Miễn trừ, có chủ ý:
- **Bearer (`req.viaJwt`)** — trình duyệt không tự đính token, nên không CSRF được.
- **Chưa đăng nhập bằng cookie** — không có thông tin đăng nhập nào để lợi dụng;
  nhờ vậy webhook vào và chính lần POST đăng nhập không bị ảnh hưởng.

Bản trước kết thúc bằng `next()` khi **không có** cả Origin lẫn Referer. Lập luận
đi kèm đúng với trình duyệt hiện đại, nhưng nó đặt toàn bộ hàng rào lên một hành
vi mà máy chủ không kiểm soát được, và mặc định của nhánh ấy là **cho qua**.

## Phân quyền

`src/permissions.ts`. Năm vai trò: `admin`, `manager`, `account_hn`, `hr`,
`accountant`, cộng **quyền ghi-đè per-user** (`User.permissions`) được resolve
lại mỗi request.

**Quyền nằm ở SERVER.** Ẩn menu ở frontend là tiện lợi cho người dùng, không phải
phân quyền. Mọi endpoint tự kiểm quyền.

`docs/product/ROLES_PERMISSIONS.md` liệt kê cả 139 endpoint và
`scripts/ci/endpoint-inventory.mjs --check` đối chiếu ở CI — **một endpoint không
có trong ma trận là một endpoint chưa ai soát quyền**.

## PII khi lưu trữ

`src/piiBox.ts` — AES-256-GCM, khoá lấy từ `PII_ENC_KEY`.

| Trường | Trạng thái |
|---|---|
| CCCD, số tài khoản, lương | mã hoá khi `PII_ENC_KEY` được đặt |
| bí mật TOTP (MFA) | mã hoá bằng `MFA_ENC_KEY` (bắt buộc ở production) |

Không đặt `PII_ENC_KEY` → mã hoá **TẮT ÊM**, dữ liệu ghi thô. Ở production việc
này nay có cảnh báo lúc khởi động (`src/config.ts`), và bảng trạng thái tính năng
được in ra log.

> **MẤT KHOÁ = MẤT DỮ LIỆU VĨNH VIỄN.** Đã diễn tập trên DEV: khôi phục dump +
> đúng khoá → giải mã 72/72 trường khớp từng byte; dump + sai khoá →
> `unable to authenticate data`. Khoá phải cất **tách khỏi** bản dump.

## Bí mật

`src/config.ts` là nơi kiểm tra duy nhất. Ở production, thiếu những thứ này thì
tiến trình **thoát ngay**: `DATABASE_URL`, `SESSION_SECRET` (≥32 ký tự),
`JWT_SECRET` (≥32, **khác** SESSION_SECRET), `APP_BASE_URL`, `MFA_ENC_KEY`.

Thiếu những thứ này thì **chạy được nhưng cảnh báo to**: `PII_ENC_KEY`,
`S3_*`, `SMTP_HOST`. Cố ý không exit — làm cả ứng dụng không lên được vì một
tính năng phụ còn tệ hơn, nhưng im lặng thì không được.

`tests/env-example.test.js` chặn `.env.example` trôi khỏi schema và chặn bí mật
thật lọt vào file mẫu.

## Nhật ký kiểm toán

`src/audit.ts` ghi: đăng nhập (thành công/thất bại), đổi mật khẩu, thay đổi MFA,
đổi vai trò, vô hiệu hoá tài khoản, thao tác trên báo giá, duyệt, xuất file, và
thao tác chứng từ thanh toán. Bảng thiên về **chỉ ghi thêm**; job dọn theo
`RETAIN_AUDIT_DAYS` (mặc định 730 ngày).

## ĐÃ BIẾT LÀ CHƯA LÀM

Nói thẳng — đây là hạn chế thật, không phải danh sách mong muốn:

- **`style-src 'unsafe-inline'` vẫn còn bật.** Cả hai SPA render rất nhiều
  `style=""` inline. Bỏ nó đòi refactor hàng trăm chỗ; rủi ro hồi quy giao diện
  cao hơn giá trị bảo mật thu được ở một hệ nội bộ. `script-src` thì đã là
  `'self'` thuần — không có `'unsafe-inline'`, nên script chèn vào bị CSP chặn.
- **Chưa có SSO / OIDC.** Đăng nhập cục bộ. Kiến trúc không cản việc thêm sau.
- **Presence SSE là in-process** — chạy nhiều replica thì danh sách "ai đang sửa"
  không đầy đủ.
- **Chưa có tổng hợp log tập trung.** Log ra stdout; chưa có Loki hay tương đương.
- **Rate limit bỏ qua khi Redis chết.** Đánh đổi có chủ ý (xem
  `src/rateLimit.ts`): lựa chọn còn lại là để mọi request treo. Khoá tài khoản khi
  sai mật khẩu nhiều lần nằm ở **CSDL**, không phụ thuộc Redis, nên lớp chống dò
  mật khẩu quan trọng nhất vẫn còn.
