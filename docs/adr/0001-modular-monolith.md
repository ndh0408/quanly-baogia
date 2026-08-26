# ADR 0001 — Modular monolith, không microservice

**Trạng thái:** đã chấp nhận · **Bối cảnh:** từ đầu, ghi lại 2026-08

## Bối cảnh

Hệ thống nội bộ của hai công ty. Người dùng vài chục, đồng thời cao nhất là lúc
làm báo giá cuối tháng. Đội phát triển và vận hành: **một người**.

## Quyết định

Một tiến trình API + một tiến trình worker, dùng chung mã nguồn và một CSDL.
Ranh giới bằng **thư mục** (`routes/` → `services/` → Prisma), không bằng ranh
giới mạng.

## Lý do

Cái mà microservice đổi lấy là: ranh giới triển khai độc lập, scale độc lập, sở
hữu theo đội. **Không nhu cầu nào trong đó tồn tại ở đây** — không có đội thứ
hai, không có thành phần nào cần scale khác phần còn lại, không có ràng buộc
tuân thủ nào đòi tách biệt.

Cái phải trả thì có thật ngay lập tức: giao dịch phân tán thay cho `BEGIN`, lần
vết qua nhiều tiến trình, nhiều pipeline, nhiều thứ để vá lỗi bảo mật, và nhiều
thứ có thể chết lúc 2 giờ sáng cho đúng một người trực.

Worker tách ra thành tiến trình riêng vì lý do khác: việc nặng CPU (sinh Excel,
PDF) không được chiếm event loop phục vụ request. Đó là **tách tiến trình**,
không phải microservice — nó dùng chung mã nguồn và chung CSDL.

## Hệ quả

- Deploy là một artifact. Rollback là một thao tác.
- Ranh giới module do quy ước giữ, không do trình biên dịch — dễ trôi, nên
  `routes → services → Prisma` phải được soát khi review.
- Muốn scale ngang thì scale cả app; hiện đủ dùng.
- Nếu sau này có phần thật sự cần vòng đời riêng, tách nó ra **lúc đó**, với lý
  do cụ thể — không tách trước.
