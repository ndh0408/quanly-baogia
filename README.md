# Quản Lý Báo Giá - Gia Nguyễn

Web nội bộ quản lý báo giá theo mẫu Excel của công ty.

- 3 cấp tài khoản: **Admin** / **Quản lý** / **Nhân viên**
- Tạo / sửa / nhân bản báo giá, tự tính VAT + tổng cộng
- Quy trình duyệt: Nhân viên tạo nháp → trình duyệt → Quản lý/Admin duyệt
- **Xuất Excel** giống y hệt mẫu `Marico_GN2505.xls` (Times New Roman, header cam #FFCC99, merge ô VAT/Tổng cộng)

## Stack
- **Backend:** Node.js + Express + Prisma + PostgreSQL
- **Auth:** session (lưu trong DB) + bcrypt
- **Excel export:** ExcelJS
- **Frontend:** HTML/CSS/JS thuần (không cần build)

## Yêu cầu
- Node.js 18+ (đã có 24 trên máy bạn ✓)
- Docker Desktop (đã có ✓) — dùng để chạy Postgres local

## Khởi chạy lần đầu

```powershell
# 1. Bật Postgres bằng Docker
docker compose up -d

# 2. Cài dependencies
npm install

# 3. Tạo bảng + seed admin
npm run setup

# 4. Chạy server
npm start
```

Mở trình duyệt vào `http://localhost:3000`.

**Tài khoản admin mặc định:**
- Username: `admin`
- Mật khẩu: `admin123`

> ⚠️ Đổi mật khẩu admin ngay sau lần đăng nhập đầu tiên.

## Lệnh thường dùng

| Lệnh | Mô tả |
|---|---|
| `npm start` | Chạy production |
| `npm run dev` | Chạy dev mode (auto reload) |
| `npm run db:studio` | Mở Prisma Studio xem DB |
| `npm run db:push` | Cập nhật schema khi sửa `schema.prisma` |
| `docker compose down` | Tắt Postgres |
| `docker compose down -v` | Tắt + xóa toàn bộ dữ liệu DB |

## Phân quyền

| Quyền | Tạo BG | Sửa BG mình | Sửa BG người khác | Duyệt | Quản lý user |
|---|---|---|---|---|---|
| Nhân viên | ✅ | ✅ (khi nháp/từ chối) | ❌ | ❌ | ❌ |
| Quản lý | ✅ | ✅ | ✅ | ✅ | ❌ |
| Admin | ✅ | ✅ | ✅ | ✅ | ✅ |

## Trạng thái báo giá
1. **Nháp** — nhân viên đang soạn
2. **Chờ duyệt** — đã trình lên quản lý
3. **Đã duyệt** — chính thức, có thể xuất Excel & gửi khách
4. **Bị từ chối** — quản lý trả lại, nhân viên sửa rồi trình lại

## Deploy lên cloud
1. Thay `DATABASE_URL` trỏ về Postgres production (Neon, Supabase, Render, Railway...)
2. Đặt `SESSION_SECRET` thành chuỗi random dài
3. `npm run db:push && npm start`

Khuyến nghị: **Render** hoặc **Railway** (đều có Postgres free tier).

## Cấu trúc thư mục

```
.
├── prisma/
│   ├── schema.prisma     # Schema DB
│   └── seed.js           # Tạo admin lần đầu
├── public/               # Frontend tĩnh
│   ├── index.html
│   ├── style.css
│   └── app.js
├── src/
│   ├── server.js         # Express entry
│   ├── db.js             # Prisma client
│   ├── middleware.js     # Auth middleware
│   ├── excel.js          # Xuất Excel layout Marico
│   └── routes/
│       ├── auth.routes.js
│       ├── users.routes.js
│       ├── quotes.routes.js
│       └── export.routes.js
├── docker-compose.yml    # Postgres local
└── .env
```
