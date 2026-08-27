# Cloudflare Tunnel, trust proxy và IP client

> Trả lời đúng một câu hỏi: **IP nào được coi là IP của người dùng, và ai quyết định điều đó.**
> Sai ở đây không làm gì hỏng ngay — nó chỉ lặng lẽ vô hiệu hoá giới hạn theo IP và làm mọi dòng
> nhật ký điều tra sự cố trỏ vào địa chỉ bịa.

## Topology thật

```text
Người dùng
   │  HTTPS (chứng chỉ của Cloudflare)
   ▼
Cloudflare edge            ← chấm dứt TLS, đặt CF-Connecting-IP
   │  đường hầm ra (không mở cổng vào trên VM)
   ▼
cloudflared (trên VM)      ← thêm địa chỉ của nó vào X-Forwarded-For
   │  HTTP, mạng docker `edge`
   ▼
container `app` (Express)
```

VM **không mở cổng 80/443 ra Internet**. Mọi luồng vào đi qua đường hầm mà `cloudflared` chủ động
mở ra ngoài. Xem `docker-compose.prod.yml` (mạng `edge` là external, do stack cloudflared tạo).

## Một chặng, không phải "tin tất cả"

`src/app.ts` đọc `TRUST_PROXY` và gọi `app.set("trust proxy", …)`. Giá trị production là **`"1"`**
(đặt tường minh trong `docker-compose.prod.yml`, không phó mặc `.env` trên máy chủ).

| giá trị | Express hiểu là | dùng khi |
|---|---|---|
| không đặt | không tin ai — `req.ip` là IP của socket | chạy trực tiếp, không có proxy |
| `1` | tin **đúng một** chặng gần nhất | ✅ topology ở trên |
| `true` | tin **mọi** chặng trong `X-Forwarded-For` | ❌ không bao giờ, ở đây |

Vì sao `true` là sai: `X-Forwarded-For` là một header **cộng dồn**. Client tự đặt được phần bên
trái; `cloudflared` chỉ *nối thêm* vào bên phải. Tin mọi chặng nghĩa là lấy phần **trái cùng** —
tức lấy đúng chuỗi do client viết ra.

`tests/xb-trust-proxy.test.js` chốt cả bốn hành vi này bằng bảng `LoginAttempt` thật (cột `ip` do
`clientIp(req)` ghi, và cũng là khoá mà lớp chống dò mật khẩu đếm theo), trong đó có một bài cố ý
chứng minh **hậu quả** của `true`: IP giả thắng.

## Năm bảo đảm §40 đòi, và trạng thái thật

| bảo đảm | trạng thái | bằng chứng |
|---|---|---|
| IP client đúng | ✅ | `TRUST_PROXY=1` + `tests/xb-trust-proxy.test.js` |
| rate limit đếm đúng IP | ✅ | `src/rateLimit.ts` dùng khoá mặc định của `express-rate-limit` = `req.ip`, tức cùng nguồn |
| header giả không lách được | ✅ | bài "client chèn nhiều chặng giả" — chỉ chặng phải cùng thắng |
| phát hiện HTTPS đúng | ⚠️ **không dùng tới** | xem bên dưới |
| cookie `Secure` đúng | ✅ nhưng **không phụ thuộc proxy** | `src/app.ts` đặt `secure: isProd` — theo `NODE_ENV`, không theo `req.secure` |

### Vì sao hai dòng cuối không giống mô tả §40

§40 giả định ứng dụng **suy ra** scheme từ `X-Forwarded-Proto`. Ứng dụng này cố ý **không** làm vậy:

* Liên kết trong email (đặt lại mật khẩu, lời mời) dựng từ **`APP_BASE_URL`**, một hằng cấu hình —
  không bao giờ từ header request. Đây là chốt chặn có chủ đích: `Host`/`X-Forwarded-Proto` do
  client đặt được, và một liên kết đặt lại mật khẩu dựng từ header là lỗ đầu độc liên kết kinh
  điển. (Xem chú thích tại `.env.example`, mục `APP_BASE_URL`.)
* Cờ `Secure` của cookie phiên đến từ `NODE_ENV=production`, không từ `req.secure`. Nên một
  `X-Forwarded-Proto` giả **không** hạ được cờ đó xuống.

Kết quả: `req.secure` gần như không được đọc ở đâu. Đó là trạng thái AN TOÀN HƠN mô tả trong §40,
không phải thiếu sót — nhưng ghi ra đây để lần sau ai định dùng `req.protocol` thì biết mình đang
bật lại một đường phụ thuộc header.

## Cấu hình phía Cloudflare cần giữ

Những mục dưới đây nằm ở bảng điều khiển Cloudflare, **không** ở repo — nên chúng phải được ghi lại
ở đâu đó, và đây là chỗ đó.

| mục | giá trị | vì sao |
|---|---|---|
| SSL/TLS mode | **Full (strict)** hoặc Full | "Flexible" khiến Cloudflare gọi ngược về bằng HTTP thuần và mọi trang thành HTTP ở chặng trong |
| Always Use HTTPS | bật | người dùng gõ `http://` vẫn được nâng lên |
| Tunnel ingress | trỏ hostname → `http://app:3000` trong mạng `edge` | container không mở cổng ra host |
| Proxy status (đám mây cam) | **Proxied** | tắt là lộ IP gốc VM và mất luôn lớp chặn của Cloudflare |
| WAF / Bot Fight Mode | tuỳ chọn | nếu bật, nhớ chừa `/api/stream/events` — SSE là kết nối SỐNG LÂU, dễ bị chấm là bất thường |
| Cache | **bỏ qua `/api/*`** | phản hồi API là dữ liệu riêng từng người; đã có `Cache-Control: no-store, private` ở các route nhạy cảm nhưng đừng dựa vào một lớp |

### Nếu đổi topology

Thêm một chặng nữa phía trước (ví dụ Nginx trên VM giữa `cloudflared` và container) thì
`TRUST_PROXY` phải thành `"2"`. Quên đổi là `req.ip` trở thành IP của Nginx — **giống nhau cho mọi
người dùng** — và toàn bộ giới hạn theo IP gộp vào một xô: một người gõ nhiều là khoá cả công ty.
Bỏ bớt một chặng mà không hạ số xuống thì ngược lại: client tự khai IP được.

Đổi số này xong **phải chạy lại `tests/xb-trust-proxy.test.js`** — bài test dựng app với từng giá
trị nên nó nói được ngay giá trị mới có đúng không.
