# ADR 0006 — Gỡ hẳn SPA vanilla cũ (`public/js`, phục vụ tại `/app`)

- **Ngày**: 2026-08-26
- **Trạng thái**: Đã áp dụng
- **Thay thế**: quyết định "giữ cả hai SPA làm đường lui" ghi trong `src/app.ts` (2026-07-06)

## Bối cảnh

Repo có hai frontend cùng nói chuyện với một API:

| Đường | App | Nguồn |
|---|---|---|
| `/` (và mọi đường không khớp) | React 19 + Vite | `web/src` |
| `/app`, `/app/*` | vanilla ES module | `public/js`, `public/app.js` |

Ngày 2026-07-06, gốc `/` chuyển sang phục vụ React cho **mọi** môi trường. SPA cũ
được giữ lại làm "đường lui — không xoá gì, chỉ đổi mặc định".

Bảy tuần sau, kiểm lại trạng thái thật:

- React **không có một liên kết nào** trỏ về `/app` (grep toàn `web/src` sạch).
  Không ai đi tới đó từ trong ứng dụng — chỉ tới được bằng cách tự gõ URL.
- SPA cũ còn đúng **2 trang** (`js/pages/admin.js`, `js/pages/quotes.js`, ~4.583
  dòng). React có **17 trang**, phủ hết và nhiều hơn.
- Nhưng nó **vẫn chạy được**: cùng cookie phiên, cùng CSRF, cùng `/api/*`. Ai gõ
  `/app` là vào được editor báo giá thật, ghi vào dữ liệu thật.

## Vấn đề

Đường lui đó **không tương đương** đường chính. Nó mang hai lỗi mất dữ liệu mà
React không có:

1. **Ghi đè im lặng lần lưu của người khác.** `public/js/editor.js:389` dựng
   payload lưu mà **không gửi `baseUpdatedAt`**. `updateQuote` chỉ so khoá lạc
   quan khi trường đó có mặt (`src/services/quoteService.ts`), nên mọi lần lưu từ
   `/app` **không bao giờ** kích hoạt kiểm tra — hai người sửa cùng báo giá thì
   người bấm sau ghi đè người bấm trước, không có 409, không cảnh báo.
   React thì gửi (`web/src/pages/QuoteEditor.tsx:230`).

2. **Mất số hoá đơn / ngày thanh toán / chữ ký / duyệt khách.** Cùng chỗ đó,
   payload sheet **không có `id: s.id`**. Lưu báo giá = xoá sheet rồi tạo lại, nên
   `updateQuote` phải bê `SHEET_CARRY_FIELDS` (`invoiceNo`, `paidAt`, `signedAt`,
   `custStatus`, `poNumber`, `hnInvoiceNo`… — 22 trường ở
   `src/quoteUtils.ts:278`) sang bản mới. Không có `id`, nó phải ghép **theo vị
   trí**; thêm sheet, xoá sheet hay đổi thứ tự là các mốc đó bê nhầm sheet hoặc
   mất trắng.

Vá hai lỗi này nghĩa là sửa `public/js/editor.js`, bump `?v=` ở mọi file import
nó, viết test hồi quy cho một engine lưới song song — tất cả để bảo trì một bản
sao thứ hai của thứ React đã làm đúng.

## Quyết định

Gỡ hẳn:

- Xoá `public/js/`, `public/app.js`, `public/index.html`, `public/theme-init.js`,
  `public/grid-clipboard.js`.
- Bỏ route `/app` · `/app/*` và hàm `sendOld` trong `src/app.ts`.
- Giữ `public/style.css` — nó **không** thuộc SPA cũ: React import nó qua Vite
  (`web/src/main.tsx:9`), nên Vite tự băm và cache-bust.

Không có lớp tương thích, không có cờ bật/tắt. Một frontend, một đường.

## Hệ quả

**Được:**

- Hai lỗi mất dữ liệu ở trên biến mất vì đường đi tới chúng không còn.
- Bề mặt tấn công hẹp lại: mọi endpoint `/api/*` giờ chỉ có một client hợp lệ.
- `?v=` gõ tay biến mất khỏi quy ước repo — Vite băm nội dung vào tên file asset.
- ~4.583 dòng ES module + một `index.html` không còn phải giữ đồng bộ với API.

**Mất:**

- Không còn đường lui nếu bản build React hỏng. Đổi lại bằng: `index.html` phục
  vụ `no-cache` nên rollback ảnh Docker là có hiệu lực ngay, và
  `docs/operations/DEPLOYMENT.md` đã có quy trình rollback theo digest.

**Lớp phủ test — không tụt:**

- `tests/gridClipboard.test.js` (76 bài) trỏ từ `public/grid-clipboard.js` sang
  `web/src/lib/clipboard.ts`. Bản React là port **thuần** và export đúng **13 hàm
  y hệt**, nên không sửa một assertion nào. Đây vẫn là lớp phủ duy nhất cho logic
  clipboard của lưới.
- `tests/util.test.js` xoá cùng `public/js/util.js`. Ba bài còn ý nghĩa
  (`fmtMoney`, `statusLabel`, `groupLetter` — các hàm này sống ở
  `shared/quote-math.ts` và React đang dùng) **chuyển sang**
  `web/src/lib/quoteMath.test.ts`. Các bài còn lại (`escapeHtml`, `nl2br`,
  `safeLogoSrc`, `baoGiaTitleJS`, `pvRows`, `pvAmount`) test đúng những hàm dựng
  HTML của SPA cũ — chúng chết cùng mã mà chúng phủ.

## Vì sao không chọn cách khác

**Giữ file, khoá `/app` sau biến môi trường.** Vẫn phải giữ 4.583 dòng đồng bộ
với API mỗi lần đổi schema, để đổi lấy một đường lui chưa ai từng dùng và vốn
đã không tương đương.

**Giữ nguyên và vá đầy đủ.** Tốn công viết test hồi quy cho engine lưới thứ hai,
với thứ đằng nào cũng nên xoá. Chi phí bảo trì vĩnh viễn, lợi ích một lần.

## Đường lùi

`git revert` commit gỡ, rồi deploy. SPA cũ là **tệp tĩnh** (`public/*.js`, `public/*.html`) — không
có migration, không có trạng thái, không có bảng nào để dọn. Đó là lý do quyết định này an toàn:
đường lùi là một lệnh git.

Cái phải kiểm sau khi lùi: iframe `/app?embed=1#/new` từng là đường DUY NHẤT còn phụ thuộc SPA cũ và
nó **đi vòng qua cổng `denied`** của Shell (xem chú thích ở `web/src/components/Shell.tsx`). Lùi mà
không dựng lại cổng đó là mở lại một lỗ phân quyền, không chỉ là bật lại một trang cũ.
