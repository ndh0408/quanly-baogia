# Phiên bản API và chính sách ngừng hỗ trợ

> §9 đòi *chuẩn bị* kiến trúc `/api/v1/`, **không** đòi viết lại 138 endpoint chỉ để gắn số. Và nó
> nói thẳng điều kiện: *"Nếu SPA và backend release cùng nhau thì `/api` cũ có thể giữ."*
>
> Ở repo này SPA và backend **nằm trong cùng một image** và deploy cùng một lệnh. Nên tài liệu này
> ghi lại **quyết định**, **điều kiện kích hoạt**, và **cái đã sẵn sàng** — chứ không thêm một bề
> mặt API thứ hai mà hôm nay không có ai gọi.

## Hai lớp, và lớp thứ hai chưa tồn tại

| | `/api/*` | `/api/v1/*` |
|---|---|---|
| trạng thái | **đang chạy** | **chưa dựng** — có chủ ý |
| ai gọi | duy nhất SPA trong cùng image | dành cho tích hợp NGOÀI (chưa có) |
| cam kết tương thích | **không có** — đổi cùng lúc với SPA | có, theo chính sách dưới |
| khi nào dựng | — | khi có consumer đầu tiên ngoài repo này |

### Vì sao chưa dựng

Một bề mặt API thứ hai **không phải là một dòng cấu hình**: nó là 138 endpoint nữa phải nằm trong
ma trận phân quyền (`docs/product/ROLES_PERMISSIONS.md`), nữa phải được `endpoint-inventory --check`
soát, và nữa phải được nhớ tới trong mọi lần rà bảo mật sau này. Dựng nó cho **không consumer nào**
là nhân đôi bề mặt tấn công để đổi lấy một dòng đánh dấu trong tài liệu.

Chi phí dựng SAU cũng không cao hơn dựng TRƯỚC — xem "Sẵn sàng đến đâu" bên dưới.

### Điều kiện kích hoạt

Dựng `/api/v1` khi **bất kỳ** điều nào xảy ra:

1. Có client NGOÀI repo này gọi API (đối tác, script kế toán, ứng dụng di động riêng).
2. Cần đổi hình dạng phản hồi của một endpoint mà **không** thể deploy client cùng lúc.
3. Bán/mở API cho khách hàng.

## Sẵn sàng đến đâu

Những điều kiện thật sự khó của việc gắn phiên bản thì repo **đã đạt**:

| §9 đòi | trạng thái | ở đâu |
|---|---|---|
| error envelope thống nhất | ✅ **đã có** | `errorHandler` (`src/middleware.ts`) trả `{ error, code?, reqId }` cho MỌI lỗi |
| request ID trong phản hồi | ✅ **đã có** | `reqId` trong thân, và header `X-Request-Id` (`requestId`, `src/middleware.ts`) |
| KHÔNG trả stack trace | ✅ **đã có** | 5xx bị thay bằng "Lỗi server"; stack chỉ vào log, không vào phản hồi |
| HTTP status đúng nghĩa | ✅ **đã có** | mã Prisma được map (P2002→409, P2025→404, P2028→503+Retry-After…) thay vì 500 mù |
| lỗi validate thống nhất | ✅ **đã có** | `validate()` trả `{ error, details: [{ path, message }] }` — zod v4, thông báo tiếng Việt |
| lỗi xác thực thống nhất | ✅ **đã có** | 401 chưa đăng nhập · 403 không đủ quyền · 403 kèm `code: "csrf_*"` cho CSRF |
| phân trang thống nhất | ⚠️ **hai hình dạng** | xem dưới |

Nghĩa là việc dựng `/api/v1` sau này chỉ còn là **gắn thêm mount**, không phải thiết kế lại hợp
đồng. Đó chính là "chuẩn bị architecture".

### Cách gắn khi tới lúc

1. Mount lặp lại các router dưới tiền tố `/api/v1` **sau** toàn bộ chuỗi gác hiện có
   (`bearerAuth` → `enforceActiveUser` → `csrfGuard` → `apiLimiter` đều gắn ở `app.use("/api/", …)`
   nên tự phủ `/api/v1/`).
2. Nhân đôi hai middleware gắn theo ĐƯỜNG DẪN CỤ THỂ — nếu quên, lưu báo giá lớn qua v1 sẽ 413:
   `decompressBody(16MB)` và `express.json({ limit: "16mb" })`, cả hai đang gắn ở
   `["/api/quotes", "/api/quotes/*"]`.
3. Dạy `scripts/ci/endpoint-inventory.mjs` coi `/api/v1/x` là bí danh của `/api/x` — nếu không,
   ma trận phân quyền sẽ đòi 137 dòng trùng lặp.
4. Viết bài test đối chiếu: mỗi endpoint mẫu phải cho CÙNG mã trạng thái ở cả hai tiền tố khi
   **chưa đăng nhập**, **thiếu mã CSRF**, và **đã đăng nhập** — đó là ba lớp gác mà một mount thêm
   dễ để hở nhất.

## Chính sách ngừng hỗ trợ (áp dụng cho `/api/v1` khi nó tồn tại)

`/api/*` **không** nằm trong chính sách này: nó là API nội bộ, đổi cùng SPA, không hứa gì.

1. **Báo trước 6 tháng** kể từ ngày endpoint được đánh dấu, tính từ thông báo cho consumer.
2. Trong quãng đó, phản hồi mang header:
   ```http
   Deprecation: true
   Sunset: Wed, 01 Jul 2026 00:00:00 GMT
   Link: <https://…/docs/api/v1#thay-the>; rel="deprecation"
   ```
   (`Deprecation` + `Sunset` là RFC 8594 / draft-ietf-httpapi-deprecation-header — dùng chuẩn có
   sẵn để công cụ của consumer tự hiểu, đừng bịa header riêng.)
3. **Thay đổi PHÁ VỠ luôn đi kèm phiên bản mới**, không bao giờ sửa tại chỗ. Phá vỡ gồm: bỏ/đổi tên
   trường, đổi kiểu, siết validate, đổi mã trạng thái, đổi ngữ nghĩa phân trang.
4. **Thêm** trường không phá vỡ — consumer phải bỏ qua trường lạ. Ghi rõ điều đó trong tài liệu API.
5. Ngày tắt thật thì trả **410 Gone** kèm `{ error, code: "endpoint_sunset", reqId }`, KHÔNG phải
   404: 404 đọc thành "gõ sai đường dẫn" và consumer sẽ đi tìm lỗi ở phía họ.

## Phân trang: hai hình dạng, và chuẩn cho cái tiếp theo

Đây là chỗ DUY NHẤT của §9 chưa thống nhất. Nói thẳng thay vì giấu:

| endpoint | hình dạng |
|---|---|
| `GET /api/quotes` | `{ rows, total, page, size }` |
| `GET /api/customers`, `personnel`, `employees`, `venues`… | `{ data, meta: { total, page, size, pageCount } }` |

**Không đổi hình dạng cũ.** Cả hai đang có client thật (`web/src/lib/api.ts`), và đổi để cho "đẹp"
là đúng nghĩa thay đổi phá vỡ trên một API không có phiên bản — tức chính thứ tài liệu này tồn tại
để ngăn.

**Chuẩn cho endpoint MỚI** là hình dạng thứ hai, và có hàm dựng sẵn:

```ts
import { phanTrang } from "./pagination.js";
return phanTrang(rows, total, page, size);   // { data, meta: { total, page, size, pageCount } }
```

`src/pagination.ts` là nơi ĐỘC NHẤT dựng phong bì đó, kèm `skipTake()` áp trần `MAX_PAGE_SIZE`
(lấy từ `config`, không chép số). Ba lý do: hình dạng không trôi theo từng người viết; `pageCount`
được tính một chỗ (chia cho `size = 0` ra `Infinity`, mà `JSON.stringify(Infinity)` là `null` —
client nhận `pageCount: null` không kèm một dòng lỗi nào); và trần `size` nằm CÙNG CHỖ với phép
tính `skip`, nên không có endpoint nào "quên" nó.

## Cái KHÔNG làm, và vì sao

* **Không gắn phiên bản qua header** (`Accept: application/vnd.quanly.v1+json`). Đúng chuẩn hơn về
  lý thuyết, nhưng không dán được vào thanh địa chỉ, không curl nhanh được, và mọi proxy/cache ở
  giữa phải học `Vary: Accept`. Tiền tố đường dẫn thắng ở mọi mặt thực dụng.
* **Không đánh phiên bản theo từng endpoint** (`/api/quotes/v2`). Consumer sẽ phải theo dõi N lịch
  ngừng hỗ trợ thay vì một.
* **Không dựng `/api/v2` trước khi `/api/v1` có người dùng.** Phiên bản là lời hứa với người khác;
  hứa với không ai thì chỉ còn là chi phí.
