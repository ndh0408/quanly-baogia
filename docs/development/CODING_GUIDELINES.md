# Quy ước viết mã

Đây **không** phải một style guide chép từ internet. Mọi mục dưới đây rút ra từ
mã đang chạy, và phần lớn có một sự cố thật đứng sau.

> **Quy ước bất di bất dịch nằm ở [AGENTS.md](../../AGENTS.md).** File này không
> lặp lại nó, mà giải thích **vì sao** và chỉ chỗ trong mã để đối chiếu. Khi hai
> file mâu thuẫn, `AGENTS.md` đúng.

---

## 1. Tiền là `Decimal`. Không có ngoại lệ.

```ts
import { D } from "./money.js";
const tong = D(a).mul(D(b));       // đúng
const tong = Number(a) * Number(b); // SAI — mất chính xác, âm thầm
```

`D()` trong `src/money.ts` là **cửa duy nhất** đưa một giá trị bất kỳ (Decimal,
number, string, null) về `Prisma.Decimal`. Cột CSDL là `Decimal(18, 2)` cho tiền
và `Decimal(18, 4)` cho số lượng/đơn giá.

Vì sao khắt khe: cái sai của float không nổ ra ở dòng đầu tiên. Nó xuất hiện ở
**tổng** của một báo giá lớn, sau nhiều phép cộng — tức ở đúng con số khách hàng
nhìn thấy, và không test đơn vị nào bắt được nếu bạn không nghĩ tới nó.

Chỗ **được phép** dùng `number`: hiển thị và xuất file (`src/excel.ts`,
`src/pdf.ts` đọc qua `Number()`), vì tới đó phép tính đã xong.

## 2. zod v4 — dùng tham số `error`, KHÔNG dùng `invalid_type_error`

```ts
// đúng (v4)
z.coerce.number({ error: "Số lượng phải là số" }).gte(-1e12, "Số lượng không hợp lệ")

// SAI (v3) — bị BỎ QUA ÂM THẦM, thông báo tiếng Anh lọt ra giao diện
z.coerce.number({ invalid_type_error: "Số lượng phải là số" })
```

Cú pháp v3 (`invalid_type_error`, `required_error`, `errorMap`) **không báo lỗi**
ở v4 — nó chỉ không có tác dụng, và người dùng cuối nhận một câu tiếng Anh kiểu
"Invalid input: expected number". Grep toàn repo hiện **không còn** chỗ nào dùng
cú pháp cũ; giữ nguyên như vậy.

Có một lớp lưới an toàn: `viZodErrorMap` trong `src/zodErrorMap.ts` dịch mọi
thông báo mặc định của zod sang tiếng Việt, cài một lần bằng
`z.config({ customError })` trong `src/validators.ts`. Lời nhắn riêng của từng
rule **vẫn thắng** lưới này — nên hãy viết lời nhắn riêng khi câu chung không đủ
rõ cho người dùng.

Lưới đó cài trong **thân module** (sau các `import`), là cố ý: tới lúc đó
`src/config.ts` đã phân tích xong `process.env`, nên lỗi cấu hình lúc khởi động
giữ nguyên văn bản dành cho **người vận hành**, không bị dịch sang câu dành cho
người dùng cuối.

Validate ở route bằng `validate({ body, query, params })` — nó `parse` và **gán
lại** `req.body`/`req.query`/`req.params`, nên mọi `coerce`/`transform`/`default`
trong schema có hiệu lực với handler. Thất bại → 400 kèm `details` là danh sách
`{ path, message }`.

## 3. Ranh giới `routes/` → `services/` → Prisma

```
src/routes/*.routes.ts   HTTP: phân tích, validate, requirePermission, gọi service, trả JSON
src/services/*.ts        nghiệp vụ: transaction, phân quyền MỨC BẢN GHI, tính toán
src/*.ts                 hạ tầng dùng chung: db · storage · queue · sse · excel · pdf …
```

**Không có lớp repository.** Service gọi thẳng Prisma — Prisma đã là lớp trừu
tượng hoá truy cập dữ liệu, bọc thêm một lớp chuyển tiếp chỉ thêm file và thêm
chỗ lệch ([ADR 0001](../adr/0001-modular-monolith.md)).

Ranh giới này **đo được**, không phải lời hứa. `scripts/ci/check-architecture.mjs`
chạy trong `npm run verify` với bốn luật:

| Luật | Nội dung |
|---|---|
| K1 | route không chạm thẳng Prisma |
| K2 | service không cầm `Response`/`NextFunction` — service trả **dữ liệu**, route mới nói HTTP |
| K3 | service không import route (phụ thuộc một chiều) |
| K4 | không vòng import giữa các service |

Bảy khoản nợ hiện có được khai đích danh trong chính script đó, mỗi mục một dòng
lý do. **File mới vi phạm là ĐỎ. Mục nợ đã trả mà quên gỡ khỏi danh sách cũng
ĐỎ** — một mục chết ở lại sẽ che một file trùng tên xuất hiện sau này.

Vì sao không đổi cây thư mục sang `src/modules/<domain>/`:
[ADR 0008](../adr/0008-khong-doi-cay-thu-muc-sang-modules.md).
Vì sao cây `web/src` cũng giữ nguyên:
[ADR 0009](../adr/0009-khong-doi-cay-thu-muc-frontend.md).

## 4. Phân quyền là HAI lớp, và không lớp nào thay được lớp kia

```ts
// Ở ROUTE — năng lực: "được phép làm hành động này không?"
router.post("/", requirePermission(P.QUOTE_CREATE), ...)

// Trong SERVICE — phạm vi bản ghi: "được phép làm nó TRÊN BẢN GHI NÀY không?"
if (!canOnQuote(req.session, "update", existing)) throw httpError(403, "…");
```

Bỏ lớp phạm vi là **IDOR**. Bỏ lớp năng lực thì ví dụ này xảy ra: `account_hn` có
`quote:read:own` (vì được thêm làm thành viên báo giá được giao), nên nếu đường
xuất file chỉ kiểm quyền đọc thì tài khoản chỉ được thấy bảng Hà Nội lại tải về
được toàn bộ bảng giá.

Cho danh sách, dùng `quoteScopeWhereOrThrow` / `readScopeWhereOrThrow` chứ đừng
tự viết `where`. Hai hàm đó **fail closed**: không có quyền đọc nào → ném 403,
chứ không rơi xuống phạm vi `own`. Chúng có `Throw` ở tên chính vì bản không-throw
từng bị dùng rồi quên kiểm `null`.

**Kiểm QUYỀN, đừng kiểm chuỗi vai trò.** So `session.role === "account_hn"` là
sai từ khi quyền cấp được per-user: một manager được cấp riêng `quote:hn:fill` sẽ
nhận editor rút gọn nhưng **không** bị chặn ở đường lưu chính, và bấm Lưu là gửi
payload thiếu toàn bộ sheet — **xoá trắng báo giá**.

Endpoint mới **phải** được thêm vào [ma trận phân quyền](../product/ROLES_PERMISSIONS.md);
`scripts/ci/endpoint-inventory.mjs --check` làm đỏ pipeline nếu quên. Một endpoint
không có trong ma trận là một endpoint **chưa ai soát quyền**.

## 5. Lỗi: ném `status`, để `errorHandler` dịch

```ts
const httpError = (status: number, message: string) =>
  Object.assign(new Error(message), { status });
```

`errorHandler` trong `src/middleware.ts` dịch mã lỗi Prisma thành HTTP có nghĩa,
và **giấu** thông điệp của mọi 5xx — trừ 503 kèm `retryAfter`:

| Mã Prisma | HTTP | Vì sao không để nó thành 500 |
|---|---|---|
| `P2002` trùng khoá | 409 | Đua ghi, không phải hỏng hệ thống |
| `P2025` không thấy | 404 | |
| `P2003` FK | 409 | Bản ghi đang được tham chiếu |
| `P2028` transaction hết giờ | 503 + `Retry-After` | Báo giá quá lớn cho một lần ghi. Trả 500 là **giấu mất cách thoát** (tách bớt trang) và bắn báo động giả sang Sentry |
| `P2024` cạn pool | 503 + `Retry-After` | Quá tải thoáng qua |
| `P2034` deadlock | 409 | Hai người ghi cùng lúc — cùng nghĩa với 409 khoá lạc quan |

Ngoại lệ "503 kèm `retryAfter` thì KHÔNG giấu" là có chủ đích: cặp đó chỉ do
chính mã của hệ thống đặt ra để nói "đang quá tải, thử lại sau". Giấu nó sau
"Lỗi server" là xoá đúng phần thông tin người dùng cần để tự thoát.

Thông điệp lỗi **viết cho người dùng cuối**: nói họ phải làm gì, đừng chỉ nói cái
gì hỏng. So sánh hai câu cho cùng một tình huống:

* ✗ "Xuất nền chưa được cấu hình."
* ✓ "Xuất nền chưa dùng được (chưa cấu hình hàng đợi/Redis). Báo giá này quá lớn
  để tải trực tiếp — hãy nhờ quản trị viên bật hàng đợi, hoặc tách bớt sheet rồi
  tải lại."

Và kèm `code` khi client cần **phân biệt** nguyên nhân (`export_async_unavailable`,
`csrf_token_missing`, `sse_too_many`). Không có `code` thì giao diện chỉ còn cách
so khớp chuỗi tiếng Việt — thứ sẽ vỡ ngay lần sửa câu chữ đầu tiên.

## 6. Đặt tên: tiếng Việt cho nội bộ, tiếng Anh cho ranh giới

Đây là quy ước **thật** của repo, không phải sở thích:

| Ở đâu | Ngôn ngữ | Ví dụ có thật |
|---|---|---|
| Tên hàm/biến **nội bộ** một file | tiếng Việt không dấu | `ghiAnToan`, `nhanSuKien`, `chotKhoaLacQuan`, `coSheetChet`, `sheetsTuoi`, `tinHieuHuy`, `daXuLyHuy`, `sinhFileXuat`, `chanBaoGiaQuaLon` |
| Tên **export** dùng chéo module | tiếng Anh | `updateQuote`, `computeQuoteTotals`, `canOnQuote`, `resolveUserPermissions` |
| Tên miền nghiệp vụ, cột CSDL, key quyền | tiếng Anh | `QuoteSheet`, `extraTables`, `quote:internal:pay` |
| Chuỗi hiển thị, thông điệp lỗi, chú thích | **tiếng Việt** | |

Lý do rất thực dụng: tên nội bộ mô tả **ý định nghiệp vụ** (`coSheetChet` — "có
sheet đã chết"), và ý định đó vốn được nghĩ bằng tiếng Việt; dịch nó sang tiếng
Anh làm mất sắc thái mà không được gì. Còn tên đi qua ranh giới thì phải khớp với
tên miền, tên bảng, tên quyền — vốn đã là tiếng Anh.

**Đừng đổi tên hàng loạt theo hướng nào cả.** Một diff đổi tên không đổi hành vi
là một diff không test nào chứng minh được là đúng.

## 7. Chú thích giải thích VÌ SAO

Cái gì thì đọc mã cũng ra. Vì sao thì không — và "vì sao" là thứ mất đi khi người
viết rời dự án.

```ts
// ✗ Kiểm số kết nối rồi trả 429.
// ✓ KIỂM TRẦN TRƯỚC khi đặt header: đã flushHeaders với text/event-stream thì không còn trả 429 được.
```

Chú thích tốt trong repo này thường có ba phần: **hiện tượng đã đo được** → **cơ
chế** → **hệ quả nếu làm khác**. Ví dụ mẫu: khối trên `SSE_MAX_BUFFER` trong
`src/sse.ts`, khối trên `deduplication` trong `src/routes/jobs.routes.ts`, khối
trên `SELECT … FOR UPDATE` trong `src/services/quoteService.ts`.

Được phép viết chú thích dài. Không được phép viết chú thích **sai** — chú thích
mô tả hành vi đã đổi còn tệ hơn không có chú thích, vì nó trông có thẩm quyền.

**Trỏ bằng TÊN, đừng trỏ bằng SỐ DÒNG.** Số dòng trôi mỗi lần ai đó thêm một
dòng ở file đích, và không có gì báo. `scripts/ci/check-line-refs.mjs` bắt những
tham chiếu `file:dòng` đã trôi vào chỗ **không thể** là đích (dòng trống, một dấu
`}` lẻ, quá cuối file) — nhưng nó chỉ bắt được ca rõ ràng. Trỏ bằng tên hàm/hằng
thì grep ra được và không bao giờ trôi.

## 8. Prettier KHÔNG đụng `.ts` / `.tsx` / `.js`

`lint-staged.config.mjs` chỉ chạy `prettier --write` cho `{json,css,yml,yaml}`.
Mã nguồn thì chỉ `eslint --fix`.

House style dùng one-liner có chủ đích (bảng hằng số, guard clause, dòng
`if (…) return …;`). Để prettier bung dòng là một diff khổng lồ **không đổi một
hành vi nào**, và là conflict với mọi nhánh đang mở.

ESLint (`eslint.config.js`) theo triết lý: **error = bug thật** (biến chưa khai
báo, mẫu không an toàn), **warning = vệ sinh** (biến thừa, mã chết) siết dần theo
thời gian. `@typescript-eslint/no-explicit-any` **tắt** — codebase dùng `any` có
chủ đích ở ranh giới Prisma và `req.query`. `react-hooks/rules-of-hooks` là
**error** (bắt bug thật), `exhaustive-deps` chỉ **warn** (có chỗ cố ý bỏ dep, đã
đánh dấu `eslint-disable` tại chỗ).

Pre-commit còn chạy `tsc --noEmit` cho backend và/hoặc app web tuỳ theo bạn đụng
file nào.

## 9. Test: phải ĐỎ được trên mã cũ

* Test đi **cùng commit** với bản sửa.
* Test đó phải **đỏ trên mã cũ**. Một bài test không bao giờ đỏ được thì không
  bảo vệ gì — nó chỉ làm cổng kiểm chạy lâu hơn.
* **Tái hiện lỗi trước khi sửa.** "Có vẻ sai" không đủ; phải chỉ ra được đầu vào
  nào cho ra kết quả sai nào.
* **Nói đúng mức độ.** Lỗi tiềm ẩn không với tới được thì ghi là tiềm ẩn, đừng
  gọi là sự cố đang xảy ra.

Chi tiết cách chạy, cách đặt tên, và những gì không test được trên máy Windows:
[TESTING.md](TESTING.md).

⚠️ **GitHub Actions không bật trên tài khoản của repo này.** Mọi câu kiểu "cứ đẩy
lên, CI sẽ bắt" đều SAI ở đây. Cổng duy nhất thật sự chạy là cổng bạn gõ tay:

```bash
npm run verify        # 13 bước, khoảng 9 phút
npm run verify:nhanh  # vòng lặp sửa nhanh
```

## 10. Danh sách "tuyệt đối không phá"

Chép nguyên từ [AGENTS.md](../../AGENTS.md) vì đây là chỗ dễ vô tình đạp trúng
nhất khi refactor:

* Engine lưới báo giá: **clipboard** (copy/cut/paste bằng sự kiện trình duyệt,
  KHÔNG bắt phím), **phân tích RFC-4180**, **IME tiếng Việt** (Enter chốt từ
  trong OpenKey/Unikey không được nhảy ô), **Ctrl+Z/Y**, chọn nhiều ô, fill-down.
* **Round-trip Excel**: dán lại bảng do chính app xuất ra phải dựng lại đúng cấp
  nhóm / nhóm con / dòng con / dòng thông tin.
* **Mẫu Excel**: xuất ra phải là **file của công ty** — logo, phông, viền, ô gộp,
  vùng in. Đó là lý do `src/xlsxStitcher.ts` ghép XML thay vì sinh workbook mới.
* **Công thức**: `=5x3`, `=SUM(H3:H8)`, tham chiếu ô, `$` tuyệt đối.
* **Bảng nội bộ** (chi phí HCM / báo giá HN / phí khách) **không được** lọt vào
  file Excel gửi khách.

Cái cuối được bảo vệ bằng kiến trúc chứ không bằng bộ lọc: `src/excel.ts` chỉ đọc
`sheet.items`, và `extraTables` **không xuất hiện trong file đó**. Giữ nguyên
tính chất đó — đừng "tiện tay" truyền `extraTables` vào đường xuất.

## 11. Migration an toàn

* Production dùng `prisma migrate deploy`. `db push` **bị chặn cứng** trong
  `package.json` — nó không có lịch sử, không soát được, và xoá được cột.
* Thay đổi đụng dữ liệu → diễn tập bằng `scripts/db/migration-rehearsal.sh`.
* `prisma migrate dev` **sinh câu `DROP INDEX`** cho mọi index mà Prisma không
  biểu diễn được (GIN trigram, partial btree, CHECK). Đừng commit thẳng file nó
  đẻ ra — xem [DATABASE.md](DATABASE.md#-prisma-migrate-dev-xoá-index-tạo-bằng-sql-thô).
