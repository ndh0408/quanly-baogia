# Quản Lý Báo Giá - Gia Nguyễn

Web nội bộ quản lý báo giá theo đúng mẫu Excel của công ty (Gia Nguyễn & Colorfull).

- 3 cấp tài khoản: **Admin (Giám đốc)** / **Quản lý** / **Nhân viên**
- Tạo / sửa / nhân bản báo giá nhiều sheet, tự tính VAT + Tổng cộng
- Quy trình duyệt 1 cấp: Nhân viên tạo nháp → trình duyệt → **Admin** duyệt
- **Xuất Excel** giống y hệt mẫu công ty (GN không ngày / GN có ngày / CLF) — giữ logo, font, viền, ô gộp

## Tính năng nổi bật (editor báo giá)

- **Nhập công thức kiểu Excel** ở ô *Số lượng* / *Đơn giá*: gõ `=5x3` → 15 (hỗ trợ `+ - * / x ( )`, số thập phân `,`).
- **Bên gửi tự theo Công ty:**
  - Ô **Công ty** bị khoá ở màn sửa (đã chọn lúc tạo báo giá).
  - Ô **Địa chỉ bên gửi** chỉ-đọc, luôn tự lấy theo địa chỉ Công ty.
  - Người gửi / Chức danh / Điện thoại bên gửi: nhập tay, chảy thẳng vào Excel.
- **Bên nhận (khách hàng)** có đủ: Tên KH, Người liên hệ, Email, **Điện thoại**, **Địa chỉ** — tất cả ra Excel.
- **Hàng con + dòng thông tin**: nút `↳` thêm hàng con trong 1 hạng mục; "+ Thêm dòng thông tin" cho dòng ghi chú chương trình (không tính tiền). Giảm giá = nhập đơn giá **âm**.
- **Lưới kiểu Excel**: chọn vùng, copy/paste từ Excel, Ctrl+Z/Y, fill-down.
- Nhiều **sheet** trong 1 báo giá; mỗi sheet 1 template; xuất ra 1 file Excel nhiều sheet (ghép bằng XML/zip, xem [src/xlsxStitcher.js](src/xlsxStitcher.js)).

## Stack
- **Backend:** Node.js + Express + Prisma + PostgreSQL
- **Auth:** session (lưu trong DB) + bcrypt; có hỗ trợ JWT bearer cho API
- **Excel export:** ExcelJS (+ ghép nhiều sheet bằng zip XML)
- **Frontend:** HTML/CSS/JS thuần (không cần build) — `public/`
- **Hàng đợi nền (tuỳ chọn):** BullMQ + Redis (email/webhook/telegram chạy nền). Không có Redis thì xử lý inline.

---

## 🚀 Production — đang chạy thật tại https://gianguyen.cloud

Kiến trúc thực tế (KHÔNG phải IIS):

```
Internet → Cloudflare (TLS) → cloudflared tunnel "gianguyen-tunnel" → 127.0.0.1:5000
                                                                         │
                                          Node (pm2: "quanly", src/server.js)
                                                                         │
                                          PostgreSQL 16 (db "quanly")
```

- **Máy chủ:** Windows (truy cập qua SSH alias `ServerWindows`). App đặt tại `C:\Projects\quanly`.
- **Tiến trình:** chạy bằng **pm2** (process tên `quanly`, port **5000**), tự khởi động lại sau reboot (`pm2 save` + pm2-windows-startup).
- **Domain/SSL:** Cloudflare Tunnel lo hết — **không cần IIS, không cần cài SSL**. Ingress `gianguyen.cloud → 127.0.0.1:5000` (file `~/.cloudflared/config.yml` trên máy chủ).
- **DB:** PostgreSQL 16 sẵn trên máy, database `quanly` + role `quanly` (riêng, không đụng app khác).
- **Redis/worker:** tắt (chạy không cần). Bật sau nếu cần xử lý nền.

### Triển khai / cập nhật phiên bản mới

Script provisioning lần đầu nằm ở [deploy/windows/](deploy/windows/) (`q0`→`q5`: đẩy code, tạo DB+`.env`, cài đặt, smoke-test, cutover, verify login).

Cập nhật code về sau (chạy trên máy chủ, trong `C:\Projects\quanly`):

```powershell
# 1. Đưa code mới lên (scp/copy đè) hoặc git pull
# 2. Cài deps + (nếu đổi schema) áp migration:
npm ci --include=dev
npx prisma migrate deploy  # áp migration mới (KHÔNG dùng db push)
# 3. Khởi động lại web:
pm2 restart quanly
```

> **Lần đầu chuyển DB prod (vốn tạo bằng `db push`) sang migrations**: chạy MỘT lần
> `npx prisma migrate resolve --applied 0_init` để baseline, rồi `migrate deploy` mới chạy được.
> Luôn `pg_dump` backup trước khi áp migration. Chi tiết: [prisma/migrations/README.md](prisma/migrations/README.md).

> Đổi file **frontend** (`public/app.js`, `public/index.html`): chỉ cần copy đè, **không cần** `pm2 restart`. Nhớ **tăng `?v=` trong index.html** để vượt cache Cloudflare; người dùng **Ctrl+F5**.
> Đổi file **template Excel** (`templates/*.xlsx`) hoặc `src/*.js`: copy đè; file template không cần restart, code `src/*.js` thì `pm2 restart quanly`.

### Rollback (về app C# cũ)
```powershell
pm2 stop quanly
Set-Service gianguyen -StartupType Automatic
Start-Service gianguyen
```

---

## Chạy local (dev)

Yêu cầu: Node.js 18+ và Postgres (dùng Docker cho nhanh).

```powershell
docker compose up -d      # Postgres + Redis + MinIO local
npm install
npm run setup             # prisma migrate deploy + seed admin
npm start                 # http://localhost:3000
```

**Tài khoản admin:** username `admin`. Mật khẩu: nếu để trống `ADMIN_PASSWORD` trong `.env`, seed **tự sinh mật khẩu mạnh** và ghi vào `.admin-credentials.local` (đọc 1 lần rồi đổi + xoá file).

> ⚠️ Đổi mật khẩu admin ngay sau lần đăng nhập đầu tiên.

## Lệnh thường dùng

| Lệnh | Mô tả |
|---|---|
| `npm start` | Chạy production |
| `npm run dev` | Dev mode (auto reload) |
| `npm run worker` | Chạy worker BullMQ (cần `REDIS_URL`) |
| `npm run db:studio` | Mở Prisma Studio xem DB |
| `npm run db:push` | Cập nhật schema khi sửa `schema.prisma` |
| `npm run db:seed` | Seed admin + công ty + template |
| `npm test` | Chạy test (vitest) |

## Phân quyền

| Quyền | Tạo BG | Sửa BG mình/được thêm | Sửa BG người khác | Duyệt | Quản lý user |
|---|---|---|---|---|---|
| Nhân viên | ✅ | ✅ (khi nháp/từ chối) | ❌ | ❌ | ❌ |
| Quản lý | ✅ | ✅ | chỉ BG được thêm | ❌ | ❌ |
| Admin (Giám đốc) | ✅ | ✅ | ✅ (tất cả) | ✅ | ✅ |

> Báo giá phạm vi theo **người tạo + thành viên** (`Quote.members`). Admin thấy tất cả. Duyệt là **1 cấp, chỉ Admin**.

## Trạng thái báo giá
**Nháp → Chờ duyệt → Đã duyệt** (có thể *Đã gửi* / *Đã chốt* / *Không chốt* / *Hết hạn*); **Bị từ chối** → sửa rồi trình lại.

## Mẫu Excel & cấu hình template

Mỗi template ánh xạ field báo giá → ô Excel trong [src/templateConfigs.js](src/templateConfigs.js); writer ở [src/excel.js](src/excel.js).

| Template (code) | File | Đặc điểm |
|---|---|---|
| GN không ngày (`marico_decor`) | `templates/GN_KhongNgay.xlsx` | Header tiếng Việt 1 dòng, không có cột Số ngày |
| GN có ngày (`unibenfood`) | `templates/Unibenfood.xlsx` | Có cột **Số ngày**; header đã dọn về 1 dòng tiếng Việt |
| CLF (`clofull_decor`) | `templates/CLF_KhongNgay.xlsx` | Có cột Chi Tiết; khối "Kính gửi" + letterhead người gửi ở ô F1 |

Ánh xạ "Bên gửi" / "Bên nhận" vào Excel:
- **GN không ngày:** khách C2/C3 + **Tel C4 / Add C5**; người gửi F3 (tên _ chức danh) / SĐT F4 / địa chỉ F5.
- **GN có ngày:** khách C1/C2 + **Tel C3 / Add C4**; người gửi E2 / SĐT E3 / địa chỉ E4.
- **CLF:** khối "Kính gửi" (F3) gồm Cty + người liên hệ + **ĐT** + **Đ/c** + Email; letterhead người gửi (F1) gồm tên công ty + địa chỉ + tên - chức danh - SĐT.

## Cấu trúc thư mục

```
.
├── prisma/
│   ├── schema.prisma         # Schema DB
│   └── seed.js               # Seed admin + công ty + template
├── public/                   # Frontend tĩnh (không build)
│   ├── index.html            # nhúng app.js?v=… (bump version để vượt cache)
│   ├── style.css
│   └── app.js                # toàn bộ SPA (editor, lưới Excel, công thức…)
├── src/
│   ├── server.js             # Express entry (listen PORT, mặc định 5000 ở prod)
│   ├── config.js             # đọc + validate .env (zod)
│   ├── db.js                 # Prisma client
│   ├── excel.js              # Xuất Excel (đổ dữ liệu vào template)
│   ├── templateConfigs.js    # Map field → ô Excel cho từng template
│   ├── xlsxStitcher.js       # Ghép nhiều sheet thành 1 file (zip XML)
│   ├── validators.js         # zod schema cho API
│   └── routes/               # auth, quotes, export, customers, products, …
├── templates/                # File .xlsx mẫu của công ty
├── deploy/windows/           # Script provisioning + cập nhật cho máy chủ Windows
│   ├── q0..q5*.ps1           # Quy trình deploy (pm2 + Cloudflare tunnel)
│   └── DEPLOY.md             # (cũ — phương án IIS, KHÔNG dùng; xem mục Production ở trên)
├── docker-compose.yml        # Postgres/Redis/MinIO cho dev local
└── .env
```
