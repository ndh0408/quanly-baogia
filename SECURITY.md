# Chính sách bảo mật — QuanLY

Đây là **hệ nội bộ đang chạy production** cho hai công ty (Gia Nguyễn + Colorfull), giữ dữ liệu
thật: báo giá, hồ sơ nhân sự (CCCD, số tài khoản, lương), hoá đơn, chứng từ thanh toán.
Không phải phần mềm mã nguồn mở có người dùng ngoài.

## Báo lỗi bảo mật

Gửi riêng cho người phụ trách repo. **Đừng mở issue công khai** và đừng đưa chi tiết khai thác vào
pull request trước khi bản vá được triển khai.

Kèm theo: đường dẫn tệp / endpoint, cách tái hiện, ảnh hưởng bạn quan sát được, và bản vá nếu có.

## Phạm vi

| Trong phạm vi | Ngoài phạm vi |
|---|---|
| Vượt quyền (RBAC), IDOR, rò rỉ dữ liệu giữa các vai | Tấn công từ chối dịch vụ bằng lưu lượng |
| Chèn công thức vào file Excel/CSV gửi khách | Thiếu header trên tên miền không phục vụ ứng dụng |
| CSRF, session fixation, cố định/leo thang phiên | Kết quả quét tự động **không** kèm bằng chứng khai thác |
| Rò rỉ bí mật (log, URL, thông báo lỗi, git history) | Phiên bản thư viện cũ **không** có đường khai thác trong repo này |
| Lỗi mã hoá PII, rò khoá | Kỹ thuật lừa đảo nhân viên |

## Cách hệ thống tự bảo vệ

Chi tiết đầy đủ: [docs/architecture/SECURITY_MODEL.md](docs/architecture/SECURITY_MODEL.md).
Tóm tắt các chốt và **nơi chúng được khoá bằng test**:

| Lớp | Cài đặt | Test khoá lại |
|---|---|---|
| Xác thực | phiên cookie + JWT Bearer; `session.regenerate()` khi đăng nhập | `tests/x8-lo-bao-mat-con-sot.test.js` (§4.1) |
| MFA | TOTP + mã dự phòng, có khoá tài khoản và chống phát lại | `tests/authsess-mfa-*.test.js` |
| CSRF | Origin/Referer + token đồng bộ hoá gắn phiên; Bearer được miễn | `tests/csrf.test.js`, `tests/csrf-token-compare.test.js` |
| Phân quyền | kiểm **phía máy chủ** ở mọi endpoint; ma trận sinh tự động | `scripts/ci/endpoint-inventory.mjs --check-guards` |
| Chèn công thức | `neutralizeFormula` trên mọi đường ghi ô | `tests/x9-chen-cong-thuc-6-vector.test.js` |
| Giới hạn tần suất | 15 limiter tách theo mục đích, đếm chung qua Redis | `tests/mwobs-ratelimit-fallback.test.js` |
| Nhật ký kiểm toán | `AuditEvent` kèm actor / target / IP / **request ID** | `tests/x8-lo-bao-mat-con-sot.test.js` (§42) |
| PII | AES-256-GCM cho CCCD / STK / lương (`src/piiBox.ts`) | `tests/pii-*.test.js` |
| Bí mật | quy ước `*_FILE` để dùng Docker/K8s secrets, Vault | `tests/x7-bi-mat-tu-file.test.js` |

## Chạy cổng bảo mật

```bash
npm run scan          # gitleaks (lịch sử git + cây làm việc) · trivy · semgrep · SBOM
npm run scan:secrets  # chỉ quét bí mật
npm run verify        # toàn bộ 12 cổng, gồm cả cổng bảo mật
```

⚠️ **GitHub Actions không bật trên tài khoản của repo này** — `.github/workflows/ci.yml` chưa bao
giờ chạy. Cổng duy nhất thật sự chạy là cổng gõ tay. Xem [AGENTS.md](AGENTS.md).

## Điều đã biết và CỐ Ý chấp nhận

Ghi đầy đủ trong [docs/REMAINING_RISKS.md](docs/REMAINING_RISKS.md). Hai điều đáng nêu ở đây:

- **Cột PII thô vẫn còn** song song với cột mã hoá. Quyết định của chủ hệ thống: giữ nguyên, ghi rõ
  rủi ro. Một bản dump CSDL vẫn lộ CCCD / STK / lương nếu `PII_ENC_KEY` chưa được đặt.
- **Mật khẩu demo `GiaNguyenDemo2026` phải coi như ĐÃ LỘ** — nó từng nằm trong hai commit
  (`0d5ba969`, `83fc9234`). Đã gỡ khỏi cây làm việc; lịch sử thì không xoá được. Đừng dùng lại.
