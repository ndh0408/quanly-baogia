> ⚠️ **TÀI LIỆU CŨ — KHÔNG DÙNG.** Phương án IIS dưới đây được soạn trước khi khảo sát máy chủ thật.
> Thực tế máy chủ **không dùng IIS** mà chạy qua **Cloudflare Tunnel + pm2** (port 5000).
> Quy trình deploy/cập nhật đúng: xem **README.md › mục Production** và các script `deploy/windows/q0..q5*.ps1`.

# Deploy QuanLY lên Windows Server (thay app C# ở gianguyen.cloud)

Hướng dẫn dựng app **QuanLY (Node.js)** trên Windows Server, đứng sau **IIS reverse proxy**,
dùng **PostgreSQL** (có sẵn) + **Memurai** (Redis cho Windows), chạy như **Windows Service**.

```
Internet ──► IIS (gianguyen.cloud, 443/SSL) ──proxy──► 127.0.0.1:3000 (Node: server.js)
                                                         + worker.js (xử lý nền)
                                                         │
                                              PostgreSQL  +  Memurai(Redis)
```

---

## 0. Chuẩn bị trên server (cài 1 lần)

| Thành phần | Bắt buộc | Cách cài |
|---|---|---|
| **Node.js LTS (≥18)** | ✅ | https://nodejs.org → bản LTS .msi |
| **PostgreSQL** | ✅ | Đã có sẵn (theo xác nhận) |
| **Memurai (Redis)** | ✅ | `choco install memurai-developer -y` hoặc MSI: https://www.memurai.com/get-memurai |
| **URL Rewrite 2.1** | ✅ | https://www.iis.net/downloads/microsoft/url-rewrite |
| **ARR 3.0** | ✅ | https://www.iis.net/downloads/microsoft/application-request-routing |
| **NSSM** | ✅ | Script tự tải |
| **Git** (tuỳ chọn) | ⚪ | Để `git clone`/`git pull` lấy code |

> Không cần Visual Studio Build Tools — toàn bộ thư viện đều pure-JS.

### Đưa code lên server
Chọn 1 trong 2:
- **Git:** `git clone <repo-url> C:\apps\quanly` (rồi `git checkout <branch>`).
- **Copy tay:** nén thư mục `QuanLY` (BỎ `node_modules`, `.env`, `.git` nếu muốn nhẹ), copy qua RDP, giải nén vào `C:\apps\quanly`.

Các bước dưới giả định app nằm ở **`C:\apps\quanly`**.

---

## 1. Tạo database

Mở **PowerShell (Administrator)**:

```powershell
cd C:\apps\quanly
.\deploy\windows\1-setup-database.ps1 -DbPassword "DatMatKhauManhVaoDay"
# Script sẽ hỏi mật khẩu superuser 'postgres'.
```

Tạo role `quanly` + database `quanly`, cấp quyền schema `public`. Chạy lại nhiều lần vô hại.

---

## 2. Cài app + tạo schema + seed admin

```powershell
cd C:\apps\quanly
.\deploy\windows\2-deploy-app.ps1 -DbPassword "DatMatKhauManhVaoDay"
```

Script này:
- Kiểm tra Node ≥ 18.
- **Tự tạo `.env`** (nếu chưa có) và **sinh sẵn `SESSION_SECRET` + `JWT_SECRET`** mạnh, khác nhau.
- `npm ci` → `prisma generate` → `prisma migrate deploy` (tạo bảng theo migration history; tự baseline nếu là DB cũ từng dùng `db push`) → `node prisma/seed.js`.

> Mật khẩu admin lần đầu nằm ở **`C:\apps\quanly\.admin-credentials.local`**.
> Đăng nhập xong **đổi mật khẩu ngay** (nút trong app) rồi **xóa file** đó.

Muốn chỉnh tay `.env`: xem mẫu `deploy\windows\.env.production.example`.

---

## 3. Dựng Windows Service (web + worker)

```powershell
cd C:\apps\quanly
.\deploy\windows\3-install-services.ps1 -AppDir C:\apps\quanly
```

Tạo 2 service tự khởi động cùng máy, tự restart khi crash:
- **QuanLY-Web** → `node src\server.js` (cổng 3000)
- **QuanLY-Worker** → `node src\worker.js` (đặt `WORKER_MODE=true`)

Tự tải NSSM nếu thiếu, cảnh báo nếu Memurai chưa chạy, và kiểm tra `http://127.0.0.1:3000/livez`.

Log chạy ở `C:\apps\quanly\logs\`.

---

## 4. Trỏ IIS (domain + SSL) vào Node

> App C# cũ đang chạy trên một **site IIS** gắn domain `gianguyen.cloud` (đã có cert SSL).
> Bước này giữ nguyên domain + SSL, chỉ đổi web.config để proxy về Node.

```powershell
cd C:\apps\quanly
.\deploy\windows\4-setup-iis-proxy.ps1 -SiteName "gianguyen.cloud" -RepoDir C:\apps\quanly
```

> Không chắc tên site? Chạy `Get-Website | ft Name,State,PhysicalPath` để xem rồi truyền đúng `-SiteName`.

Script: bật ARR proxy → cho phép header `X-Forwarded-Proto` → **backup web.config cũ** (`.csharp-bak`) → đặt web.config reverse-proxy → restart site.

Mở **https://gianguyen.cloud** để kiểm tra.

---

## Kiểm tra nhanh & xử lý lỗi

| Triệu chứng | Nguyên nhân & cách xử lý |
|---|---|
| `502.3` / `Bad Gateway` | Node chưa chạy. `Get-Service QuanLY-Web`; xem `logs\QuanLY-Web.err.log`. |
| Đăng nhập xong **bị đá ra** liên tục | Thiếu `X-Forwarded-Proto: https`. Kiểm tra web.config có block `<serverVariables>`; và `.env` có `TRUST_PROXY=1`. |
| Export Excel/PDF lỗi | Thường do quyền DB/dữ liệu, KHÔNG phải S3 (export chạy đồng bộ). Xem `logs\QuanLY-Web.err.log`. |
| Email/webhook/thông báo không chạy nền | Memurai (6379) chưa chạy → `Get-Service Memurai`; xem `logs\QuanLY-Worker.err.log`. |
| Thông báo realtime (SSE) chậm | ARR buffering: IIS Manager → ARR → Server Proxy Settings → *Response buffer threshold (KB)* = 0. |
| Cần khôi phục app C# | Đổi tên `web.config.csharp-bak` về `web.config`, restart site. |

### Lệnh vận hành thường dùng
```powershell
Get-Service QuanLY-Web, QuanLY-Worker          # xem trạng thái
Restart-Service QuanLY-Web                      # restart web
Get-Content C:\apps\quanly\logs\QuanLY-Web.err.log -Tail 50 -Wait   # theo dõi log
```

### Cập nhật phiên bản mới
```powershell
cd C:\apps\quanly
# Backup TRƯỚC mọi thay đổi schema (migration là thao tác duy nhất có thể đổi/mất dữ liệu):
pg_dump -Fc -d quanly -f "D:\backups\quanly-$(Get-Date -f yyyyMMdd-HHmm).dump"
git pull                                        # hoặc copy đè code mới
npm ci --include=dev
npx prisma migrate deploy                        # áp migration mới (KHÔNG dùng db push)
Restart-Service QuanLY-Web, QuanLY-Worker
```

> **Lần đầu chuyển từ `db push` sang migrations trên DB prod hiện tại**: chạy MỘT lần
> `npx prisma migrate resolve --applied 0_init` để baseline (đánh dấu schema hiện có
> là đã áp), sau đó `migrate deploy` mới hoạt động. Xem `prisma/migrations/README.md`.

---

## Việc nên làm sau khi chạy ổn (production hardening)
- Bật **backup PostgreSQL** định kỳ (pg_dump theo lịch Task Scheduler).
- Cân nhắc đặt `METRICS_TOKEN` để bảo vệ `/metrics`.
- Xóa `.admin-credentials.local` sau khi đổi mật khẩu admin.
