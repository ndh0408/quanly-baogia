# ADR 0008 — Không đổi cây thư mục sang `src/modules/`, mà khoá ranh giới bằng cổng kiểm

**Trạng thái:** đã chốt · 2026-08-27
**Liên quan:** [ADR 0001 — modular monolith](0001-modular-monolith.md)

## Bối cảnh

§2 của quy ước dự án phác một cây thư mục:

```text
src/app/  src/config/  src/modules/<domain>/  src/infrastructure/
src/middleware/  src/jobs/  src/lib/  src/types/
```

Cây thật khác hẳn: `src/routes/` · `src/services/` · `src/types/`, còn hạ tầng (`db.ts`, `queue.ts`,
`storage.ts`, `sse.ts`, `excel.ts`, `pdf.ts`, `observability.ts`) nằm phẳng ở gốc `src/`;
`app.ts` · `config.ts` · `middleware.ts` là FILE ĐƠN chứ không phải thư mục.

Nghĩa là ranh giới hiện tại là **ngang** (theo tầng), còn §2 muốn **dọc** (theo miền nghiệp vụ).

## Vấn đề: một cây thư mục không giữ được gì

Đổi tên thư mục cho khớp sơ đồ **không ngăn được điều gì**. Ngày mai ai đó viết
`import { prisma } from "../../infrastructure/db.js"` vào một controller thì nó vẫn biên dịch, vẫn
chạy, vẫn qua mọi bài test — y hệt như khi viết vào `src/routes/`. Thư mục là cách **sắp xếp**; thứ
giữ ranh giới là một **phép kiểm chạy được**.

Và ranh giới thật sự của repo này **đang được giữ**, chỉ là chưa ai khoá lại: 19/19 service không
cầm `Response`/`NextFunction`, không service nào import ngược lên `routes/`, không vòng phụ thuộc
nào giữa các service. Đó không phải may — đó là ranh giới ADR 0001 khai, và nó đã sống qua 137
endpoint.

## Bảy câu của Phụ lục §19

Phụ lục §19 nói: mọi migration công nghệ phải trả lời được bảy câu, **không trả lời được thì KHÔNG
migrate**. Áp cho chính đề xuất "đổi sang `src/modules/`":

| câu | trả lời |
|---|---|
| **Why?** | Cho khớp sơ đồ trong §2. Không có yêu cầu nghiệp vụ hay vận hành nào đứng sau. |
| **Vấn đề ĐO ĐƯỢC nào đang tồn tại?** | **Không có.** Không sự cố nào truy về "sai chỗ đặt file". Bốn luật ranh giới đo hôm nay đều PASS. |
| **Vì sao cấu trúc hiện tại không giải quyết được?** | Nó ĐANG giải quyết. Cái thiếu là chốt chặn, và chốt chặn không cần đổi cây thư mục. |
| **Chi phí migration** | Đụng gần như mọi file trong `src/` (đường dẫn import), 176 file test, `endpoint-inventory.mjs` (bộ phân tích bám mẫu `src/routes/*.routes.ts`), `lint-staged.config.mjs`, Dockerfile, và mọi chú thích trỏ đường dẫn. Một diff khổng lồ **không đổi một hành vi nào** — tức không bài test nào chứng minh được nó đúng, chỉ có "xanh" chứng minh nó chưa sai. |
| **Chi phí vận hành** | Mọi tài liệu, ADR, chú thích và nhật ký điều tra sự cố cũ trỏ vào đường dẫn không còn tồn tại. `git log --follow` gãy ở chỗ đổi tên. |
| **Đường lùi** | Revert một commit khổng lồ — về lý thuyết được, thực tế là xung đột với mọi nhánh đang mở. |
| **Lợi ích mong đợi** | Trực quan hơn cho người mới. Thật, nhưng nhỏ: repo có 19 service với tên tự mô tả (`quoteService`, `personnelService`…). |

Sáu trên bảy câu ra kết quả xấu hoặc rỗng. §19 nói rõ trường hợp này: **DO NOT MIGRATE.**

## Quyết định

1. **Giữ nguyên cây thư mục.**
2. **Khoá ranh giới bằng `scripts/ci/check-architecture.mjs`** — bốn luật, chạy trong `npm run verify`:
   * `[K1]` route không chạm thẳng Prisma;
   * `[K2]` service không cầm `Response`/`NextFunction` (service trả DỮ LIỆU, route mới nói HTTP);
   * `[K3]` service không import route (phụ thuộc một chiều);
   * `[K4]` không vòng import giữa các service.
3. **Nợ được KHAI, không được tha.** Bảy file route đang chạm Prisma nằm trong `NO_KY_THUAT`, mỗi
   mục một dòng lý do. Route MỚI chạm Prisma là ĐỎ. Mục nợ đã trả mà quên gỡ khỏi danh sách cũng
   ĐỎ — một mục chết ở lại sẽ che một file trùng tên xuất hiện sau này.

## Hệ quả

* Ranh giới lần đầu tiên **đỏ được**. Trước đó nó chỉ là một câu trong ADR 0001.
* Bảy khoản nợ **nhìn thấy được** thay vì nằm im. Đáng tách nhất là `files.routes.ts` (9 truy vấn
  quanh `UploadObject` — thực chất là một service viết thẳng trong route).
* Sơ đồ trong §2 **không được đáp ứng theo mặt chữ**, và tài liệu này là nơi ghi lại vì sao.
* Nếu sau này repo thật sự lớn tới mức cần ranh giới dọc (nhiều đội chạm cùng lúc, hoặc tách một
  miền ra dịch vụ riêng), đọc lại bảng bảy câu ở trên: lúc đó cột "vấn đề ĐO ĐƯỢC" sẽ không còn
  rỗng, và quyết định này nên được lật.

## Cái KHÔNG thay đổi

ADR 0001 vẫn đúng nguyên: không có lớp repository, service gọi thẳng Prisma, ranh giới là
`routes/ → services/ → Prisma`. Tài liệu này chỉ trả lời câu "vậy còn `src/modules/`?" — và đóng
nó lại bằng số, không bằng khẩu vị.

## Đường lùi

Quyết định này **không tạo ra trạng thái nào**: nó thêm một cổng kiểm và không đụng mã ứng dụng.
Lùi = xoá `scripts/ci/check-architecture.mjs` và dòng gọi nó trong `scripts/verify-local.sh`.

Lùi theo hướng NGƯỢC LẠI (thật sự đổi sang `src/modules/`) thì đọc lại bảng bảy câu ở trên trước —
đặc biệt cột "vấn đề ĐO ĐƯỢC nào đang tồn tại". Nếu cột đó vẫn rỗng thì §19 vẫn nói: đừng.
