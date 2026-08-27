# ADR 0007 — Chưa làm SSO, nhưng không được chặn đường tới OIDC

**Trạng thái:** đã chấp nhận · **Bối cảnh:** 2026-08-27

## Bối cảnh

Prompt §30 và Phụ lục §8 nói cùng một điều, theo hai hướng:

> Không chuyển sang SSO nếu business chưa cần.
> Nhưng **không được thiết kế auth khiến sau này không thể thêm SSO**.

Hiện trạng đo được (`grep -rniE "oidc|openid|entra|keycloak|okta|saml|sso" src/ prisma/schema.prisma`
→ **0 kết quả**): xác thực hoàn toàn là tài khoản nội bộ — `User.username` + `passwordHash` bcrypt,
phiên `express-session`, MFA TOTP, JWT Bearer cho client API.

Business: hai công ty, vài chục người dùng, không có thư mục danh tính doanh nghiệp nào đang chạy.

## Quyết định

**Chưa triển khai OIDC.** Nhưng ghi lại — và kiểm bằng test — ba tính chất khiến việc thêm sau này
là *thêm một nhánh*, không phải *viết lại lớp auth*.

### 1. Cấp phiên đã tách khỏi việc xác minh mật khẩu

`establishSession(req, user)` trong `src/services/authService.ts` nhận một **`SessionSeed`** rồi
`regenerate()` → gán danh tính → `save()`. Nó **không biết** danh tính từ đâu ra.

Hôm nay có **ba** nguồn gọi nó, và chính sự đa dạng đó là bằng chứng cho tính tách rời:

| Nguồn | Danh tính đến từ đâu |
|---|---|
| `POST /api/auth/login` (`src/routes/auth.routes.ts`) | mật khẩu + MFA |
| `acceptInvite` (`src/services/authService.ts`) | token mời qua email |
| `changePassword` (`src/services/authService.ts`) | phiên ĐANG CÓ, cấp lại sau khi đổi mật khẩu |

Không nguồn nào trong ba nguồn ấy giống nhau về cách xác minh, mà cả ba dùng chung đúng một hàm
cấp phiên. Một nguồn thứ tư — callback OIDC — chỉ cần dựng `SessionSeed` từ claim của IdP rồi gọi
cùng hàm đó. Không đụng vào phiên, CSRF, hay RBAC.

### 2. Phân quyền dựa trên vai + quyền trong CSDL, không dựa trên cách đăng nhập

`src/permissions.ts` đọc `session.role` và `session.permissions`. Không chỗ nào hỏi "người này đăng
nhập bằng gì". IdP cấp danh tính; RBAC vẫn của hệ thống này — đúng sơ đồ §30 yêu cầu
(`Identity Provider → OIDC → application user → RBAC`).

### 3. Lối vào khẩn cấp đã có sẵn và độc lập

`BREAK_GLASS_EMAILS` (`src/config.ts`) đã tồn tại. §30 đòi giữ đường đăng nhập nội bộ khi IdP chết —
cơ chế đó không phải dựng thêm, chỉ cần **không gỡ đi**.

## Cái sẽ phải làm khi thực sự thêm OIDC

Ghi ra để lần đó không phải khảo sát lại:

1. `User` cần cặp `(issuer, subject)` — **không** ghép người dùng bằng email (email đổi chủ được;
   ghép theo email là lỗ chiếm tài khoản kinh điển).
2. Chọn thư viện: `openid-client`. Không tự viết luồng OIDC.
3. Cấu hình: `OIDC_ISSUER` / `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` / `OIDC_REDIRECT_URI` — thêm
   vào schema zod ở `src/config.ts`, và **bắt buộc ở production chỉ khi OIDC được bật**.
4. Quyết định chính sách cấp tài khoản: tự tạo khi đăng nhập lần đầu, hay chỉ chấp nhận người đã
   được mời. Với hệ nội bộ, **chỉ-đã-mời** là mặc định đúng.
5. MFA: khi IdP đã làm MFA thì đừng bắt lần hai. Cần một cờ ở mức người dùng ghi "MFA do IdP lo".

## Hệ quả

- Không thêm phụ thuộc, không thêm bề mặt tấn công, hôm nay.
- Ba tính chất trên được khoá bằng `tests/xa-san-sang-oidc.test.js` — ai gộp việc xác minh mật khẩu
  ngược vào `establishSession`, hoặc cho phân quyền phụ thuộc vào cách đăng nhập, sẽ làm nó đỏ.
- Rủi ro còn lại: **chưa từng chạy thử với một IdP thật.** Các tính chất trên là điều kiện *cần*,
  không phải bằng chứng *đủ*.
