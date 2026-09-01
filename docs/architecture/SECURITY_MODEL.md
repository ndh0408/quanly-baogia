# Mô hình bảo mật

## Danh tính: hai đường, một nguồn sự thật

| Đường | Dùng cho | Mang bởi |
|---|---|---|
| Phiên cookie | trình duyệt (app React ở `web/`) | cookie `qly.sid`, kho phiên trong PG |
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

`docs/product/ROLES_PERMISSIONS.md` liệt kê cả 137 endpoint và
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

- **`style-src 'unsafe-inline'` vẫn còn bật** (`src/app.ts`, directive `style-src`).
  `script-src` thì đã là `'self'` thuần — không có `'unsafe-inline'`, nên script
  chèn vào bị CSP chặn. Lộ trình gỡ ở ngay dưới.
- **Chưa có SSO / OIDC.** Đăng nhập cục bộ. Kiến trúc không cản việc thêm sau.
- **Presence SSE là in-process** — chạy nhiều replica thì danh sách "ai đang sửa"
  không đầy đủ.
- **Chưa có tổng hợp log tập trung.** Log ra stdout; chưa có Loki hay tương đương.
- **Rate limit bỏ qua khi Redis chết.** Đánh đổi có chủ ý (xem
  `src/rateLimit.ts`): lựa chọn còn lại là để mọi request treo. Khoá tài khoản khi
  sai mật khẩu nhiều lần nằm ở **CSDL**, không phụ thuộc Redis, nên lớp chống dò
  mật khẩu quan trọng nhất vẫn còn.

## Lộ trình gỡ `style-src 'unsafe-inline'`

### Đếm lại đã, đừng chép lại lời cũ

Bản trước ghi "cả hai SPA render rất nhiều `style=""` inline, bỏ nó đòi refactor
hàng trăm chỗ". Câu đó sai hai lần. SPA vanilla **đã gỡ** từ 2026-08-26
([ADR 0006](../adr/0006-go-spa-vanilla-cu.md)) — chỉ còn một frontend. Và "hàng
trăm chỗ" là đếm nhầm đối tượng:

| Đếm trên `web/src` | Số | Có bị CSP chặn không |
|---|---|---|
| `grep -ro "style=" web/src \| wc -l` | **197** | — |
| trong đó `style={…}` (prop JSX của React) | **194** | **KHÔNG** |
| trong đó `style="…"` (chuỗi HTML gán qua `innerHTML`) | **3** | **CÓ** |

Vì sao 194 chỗ kia không tính: React **không** viết thuộc tính `style` lên DOM. Nó
gán qua CSSOM — `setValueForStyles` ở `node_modules/react-dom/cjs/react-dom-client.production.js`
làm `node.style[tên] = giá trị` / `node.style.setProperty(...)`. CSP điều chỉnh
thuộc tính `style` **do bộ phân tích HTML tạo ra**, không điều chỉnh việc ghi CSSOM
bằng script. Nên số chỗ thật sự vướng CSP hôm nay là **3**, tất cả trong
`web/src/lib/ui.ts` (hai hàm `confirmModal` và `promptModal` dựng khung bằng
`back.innerHTML = \`…\``):

- `web/src/lib/ui.ts:142` — thẻ `<p>` chứa nội dung của `confirmModal` (đặt lề)
- `web/src/lib/ui.ts:175` — thẻ `<p>` chứa nội dung của `promptModal` (đặt lề)
- `web/src/lib/ui.ts:176` — ô `<textarea>` của `promptModal` (bề rộng, viền, cỡ chữ)

(Ba số dòng trên nằm trong phạm vi `npm run check:refs` — trôi là CI báo.)

Cũng đã soát các đường khác và **không có**: không chỗ nào gọi
`setAttribute("style", …)` trong `web/src`; không chỗ nào chèn thẻ `<style>` lúc
chạy; `web/index.html` không có `<style>` hay `style=`; bản build production của
Vite phát CSS ra **file rời nạp bằng `<link>`** (đã hợp `style-src 'self'`), còn
`https://fonts.googleapis.com` phải giữ trong danh sách vì đó là stylesheet của
Google Fonts.

> Cảnh báo về mức độ chắc chắn: toàn bộ đoạn trên là **phân tích tĩnh** — đọc mã
> nguồn `web/src`, `web/index.html`, cấu hình Vite và bản react-dom đang cài. Chưa
> ai chạy thử app với `style-src` đã siết trong trình duyệt thật. Vì vậy bước 5 dưới
> đây **không phải thủ tục**: nó là chỗ duy nhất chứng minh được kết luận này đúng.

### Các bước

1. **Đổi 3 chỗ ở `web/src/lib/ui.ts` thành class.** Thêm `.modal-msg` và `.pm-input`
   vào `web/src/styles.css`, bỏ thuộc tính `style` khỏi hai chuỗi `innerHTML`.
   Quy mô thật: khoảng 10 dòng, không đụng lưới báo giá, không đụng `GridTable`.
2. **Dựng chốt chặn tái phát trước khi siết CSP.** Thêm một bước vào
   `scripts/ci/` chặn chuỗi `style="` xuất hiện trong `web/src` (chỉ cấm dạng chuỗi
   HTML — `style={{` của React vẫn cho). Không có chốt này thì bước 1 sẽ trôi lại
   sau vài PR và CSP siết rồi sẽ vỡ giao diện lúc nào không biết.
3. **Bỏ `'unsafe-inline'`** khỏi `style-src` trong `src/app.ts`, để lại
   `["'self'", "https://fonts.googleapis.com"]`. Đồng thời sửa comment ngay trên
   khối `helmet(...)` — nó đang giải thích lý do cũ.
4. **Khoá bằng test.** `tests/app.smoke.test.js` đã có bài kiểm CSP cho
   `object-src 'none'` và `frame-ancestors 'self'`; thêm một assertion cùng chỗ:
   `style-src` **không** chứa `'unsafe-inline'`.
5. **Kiểm chứng bằng trình duyệt thật, không chỉ bằng test đơn vị.**
   `npm run smoke:ui` (`scripts/ci/ui-smoke.mjs`) đã mở trình duyệt thật và **đỏ khi
   có bất kỳ lỗi console nào** — một vi phạm CSP (*"Refused to apply inline style"*)
   tự khắc làm hỏng lượt chạy, không cần thêm assertion. Lượt smoke hiện tại **đã
   đi qua `confirmModal`** (`scripts/ci/ui-smoke.mjs:359` bấm `[data-yes]` của hộp
   "Có thay đổi chưa lưu từ lần trước"), tức dòng 142 đã được phủ. Còn thiếu đúng
   **`promptModal`** — hộp nhập lý do "không chốt", nơi có hai chỗ còn lại. Thêm một
   chặng chạm vào nó là đủ. Một ô lệch định dạng là hồi quy giao diện thật, và người
   dùng sẽ gặp trước khi ta biết.

**Bước lui, nếu bước 5 lòi ra chỗ chưa tìm thấy:** giữ `style-src` có
`'unsafe-inline'` làm nền, thêm `style-src-elem 'self' https://fonts.googleapis.com`
để ít nhất chặn thẻ `<style>` chèn vào. Nói thẳng giới hạn: trình duyệt không hỗ trợ
các directive `-elem`/`-attr` sẽ **bỏ qua** chúng và rơi về `style-src`, nên bước lui
này chỉ siết được trên trình duyệt mới — phải đo tỷ lệ trình duyệt thực tế của công
ty trước khi coi nó là một lớp phòng thủ, chứ không phải một cái ô cho vui.

### Khi nào thì đáng làm

Việc này **chưa được xếp lịch**, và đây là lý do — để người sau xét lại chứ không
phải để bào chữa.

Với `script-src 'self'` thuần, thứ `'unsafe-inline'` của `style-src` còn cho phép là
**giả mạo giao diện** và **rò dữ liệu qua bộ chọn CSS**. Cả hai đều đòi kẻ tấn công
**trước hết phải chèn được HTML** vào trang — mà hôm nay mọi đường render HTML đều
đi qua `esc()` hoặc `textContent`, và React tự thoát chuỗi. Nghĩa là nó là lớp
phòng thủ **thứ hai** cho một lỗ **chưa tồn tại**, trên một hệ nội bộ, người dùng đã
xác thực, số lượng nhỏ.

Kéo nó lên đầu hàng đợi khi **một trong bốn điều sau** thành đúng:

1. **Có người ngoài công ty vào được** — link xem báo giá cho khách, cổng đối tác,
   SSO liên thông. Bề mặt tấn công đổi chất, không phải đổi lượng.
2. **Xuất hiện chỗ render HTML do người dùng nhập** — soạn thảo có định dạng, chữ ký
   email nhúng, ghi chú cho phép thẻ. Đây là lúc "lỗ chưa tồn tại" trở thành có thật.
3. **Có yêu cầu kiểm định bên ngoài** đòi CSP không `'unsafe-inline'` (khách hàng
   lớn, bảo hiểm mạng, chứng chỉ).
4. **Có ai đó vốn đã phải sửa `web/src/lib/ui.ts`** vì việc khác — lúc đó bước 1 tốn
   thêm chừng 10 dòng, rẻ hơn hẳn so với mở một nhánh riêng cho nó.

Trước khi có một trong bốn điều đó, viết `'unsafe-inline'` vào danh sách nợ là đủ;
làm sớm chỉ đổi một rủi ro giả thuyết lấy một rủi ro hồi quy giao diện có thật.
