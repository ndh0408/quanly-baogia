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
| cookie `Secure` đúng | ✅ nhưng **CẦN `TRUST_PROXY`** | `src/app.ts` đặt `secure: isProd`, và express-session CHỈ phát cookie Secure khi `req.secure` — tức phải tin proxy. Thiếu `TRUST_PROXY` là không có cookie phiên nào; `src/server.ts` vì thế từ chối khởi động production khi thiếu biến này |

### Vì sao hai dòng cuối không giống mô tả §40

§40 giả định ứng dụng **suy ra** scheme từ `X-Forwarded-Proto`. Ứng dụng này cố ý **không** làm vậy:

* Liên kết trong email (đặt lại mật khẩu, lời mời) dựng từ **`APP_BASE_URL`**, một hằng cấu hình —
  không bao giờ từ header request. Đây là chốt chặn có chủ đích: `Host`/`X-Forwarded-Proto` do
  client đặt được, và một liên kết đặt lại mật khẩu dựng từ header là lỗ đầu độc liên kết kinh
  điển. (Xem chú thích tại `.env.example`, mục `APP_BASE_URL`.)
* Cờ `Secure` của cookie phiên đến từ `NODE_ENV=production`, không từ `req.secure`. Nên một
  `X-Forwarded-Proto` giả **không** hạ được cờ đó xuống. NHƯNG việc cookie đó có được PHÁT hay không
  thì phụ thuộc `req.secure` (express-session bỏ cookie Secure trên kết nối không an toàn), tức phụ
  thuộc `TRUST_PROXY` — xem dòng "cookie `Secure` đúng" ở bảng trên.

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
| Tunnel ingress | trỏ hostname → **`http://quanly-app:3000`** (container_name, duy nhất) trong mạng `edge` | container không mở cổng ra host. Trỏ `app` (tên service) thì một container KHÁC trên mạng `edge` dùng chung (Coolify/Traefik…) mang alias `app` sẽ được Docker DNS chia vòng — xem mục dưới |
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

### ⚠️ Topology production CHƯA được đối chiếu (audit 2026-09-22, DOC-14 / INFRA-07)

Mọi khẳng định "đúng MỘT chặng proxy" ở trên (và `TRUST_PROXY: "1"` trong `docker-compose.prod.yml`)
là **thiết kế**, chưa phải **phép đo**. Đã đo được: host production có Coolify/Traefik nghe 80/443/8080
(chỉ LAN), và mạng `edge` là mạng external dùng chung. Chưa ai đo tunnel ingress trỏ THẲNG app hay
đi qua Traefik. Nếu có Traefik ở giữa, `req.ip` = IP container proxy cho MỌI người → limiter đăng nhập
gộp cả công ty vào một xô và nhật ký kiểm toán ghi IP proxy.

Việc chủ repo làm tay (chỉ đọc, 5 phút):

```bash
# 1. IP đăng nhập 30 ngày qua — gần như chỉ MỘT IP dạng 172.x/10.x là đang lệch:
docker exec quanly-postgres psql -U quanly -d quanly -c \
  "SELECT ip, count(*) FROM \"LoginAttempt\" WHERE \"createdAt\" > now()-interval '30 days' GROUP BY ip ORDER BY 2 DESC LIMIT 10;"
# 2. Ai đang ở mạng edge, ai mang alias `app`:
docker network inspect edge --format '{{range .Containers}}{{.Name}} {{end}}'
# 3. Cấu hình ingress của tunnel (dashboard Cloudflare Zero Trust → Tunnels → Public hostnames).
```

- Đúng một chặng → ghi ngày đo + kết quả vào đây, và đổi ingress sang `http://quanly-app:3000`.
- Có Traefik ở giữa → đặt `TRUST_PROXY` theo SUBNET của mạng edge (vd `"172.18.0.0/16"`, lấy từ
  `docker network inspect edge`) thay vì số chặng — `src/app.ts` truyền chuỗi thẳng cho Express — rồi
  chạy lại `tests/xb-trust-proxy.test.js`.
