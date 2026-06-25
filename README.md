# Quản Lý Báo Giá - Gia Nguyễn

Web nội bộ quản lý báo giá theo đúng mẫu Excel của công ty (Gia Nguyễn & Colorfull).

- **5 vai trò:** **Admin** (Giám đốc) · **Account** (làm báo giá — vai trò `manager`, nhãn đổi từ "Quản lý" → "Account" để khỏi nhầm "Quản trị") · **Account Hà Nội** (`account_hn` — chỉ điền giá Hà Nội) · **Nhân sự** (`hr` — chỉ XEM hồ sơ nhân sự) · **Kế toán** (`accountant` — xem hồ sơ + đánh dấu thanh toán). Vai trò "Nhân viên" đã bỏ từ 2026-06-15.
- Ngoài báo giá, app còn **module Nhân sự** (`hr`/`accountant`): hồ sơ nhân công theo dự án + danh bạ nhân viên, có đánh dấu **thanh toán** (Kế toán) / **xác nhận đã ký** (Admin).
- Tạo / sửa / nhân bản báo giá nhiều sheet, tự tính VAT + Tổng cộng (**cập nhật realtime** khi gõ).
- **Vòng đời báo giá KHÔNG còn duyệt nội bộ** (bỏ Trình duyệt / Hàng chờ duyệt từ 2026-06-22). "Duyệt" thật = **quyết định của khách**: **Nháp → ✓ Khách chốt (Đã chốt) / ✗ Khách không chốt (Không chốt)**. Gửi cho khách = tải Excel/PDF.
- **Xuất Excel** giống y hệt mẫu công ty (GN không ngày / GN có ngày / CLF) — giữ logo, font, viền, ô gộp.
- **Trang Quản lý dự án:** theo dõi báo giá **đã chốt** theo bố cục sheet/hoá đơn — chi tiết bên dưới.

## Tính năng nổi bật (editor báo giá)

- **Công thức kiểu Excel** ở ô số: `=5x3`, **`=SUM(H3:H8)`**, **tham chiếu ô `=G3*E3`** — bấm/kéo ô để chèn tham chiếu, có **thanh công thức (fx)** + gợi ý tên hàm. (Gõ tiếng Việt bằng bộ gõ OpenKey/Unikey: nhấn Enter để chốt từ **không** làm nhảy ô.) Ô có công thức hiện **dấu `ƒ` ở góc trên‑phải**; **bấm vào `ƒ` để xem công thức đã nhập + kết quả — ai cũng xem được, kể cả tài khoản chỉ‑xem và trên điện thoại** (phục vụ kiểm tra/quản lý "họ đánh gì").
- **Bên gửi tự theo Công ty:**
  - Ô **Công ty** bị khoá ở màn sửa (đã chọn lúc tạo báo giá).
  - Ô **Địa chỉ bên gửi** chỉ-đọc, luôn tự lấy theo địa chỉ Công ty.
  - Người gửi / Chức danh / Điện thoại bên gửi: nhập tay, chảy thẳng vào Excel.
- **Bên nhận (khách hàng)** có đủ: Tên KH, Người liên hệ, Email, **Điện thoại**, **Địa chỉ** — tất cả ra Excel.
- **Nhóm / Nhóm con / Hàng con / Dòng thông tin**:
  - "+ Thêm nhóm (A,B…)": nhóm chính, có Thành Tiền nhóm (×Số Lượng nếu bật).
  - **"+ Thêm nhóm con"**: tổng riêng, **KHÔNG cộng vào nhóm chính**, nhưng **vẫn vào Tổng cộng** báo giá (thụt lề + dấu ↳). Dùng để quản lý chi phí/biến thể trong 1 nhóm. **Khi xuất Excel:** nhóm con hiển thị **giống hệt trên màn hình** — **không chiếm chữ A/B/C** của nhóm chính, có dấu ↳ + nền nhạt hơn (thứ tự chữ nhóm không bị lệch).
  - Nút `↳` thêm **hàng con** trong 1 hạng mục; "+ Thêm dòng thông tin" cho dòng ghi chú (không tính tiền). Giảm giá = nhập đơn giá **âm**.
- **Bảng nội bộ theo sheet** (Chi Phí HCM / Báo Giá Hà Nội / Phí Khách Hàng): lưới riêng để quản lý chi phí — **KHÔNG xuất Excel**, tổng đổ sang trang Quản lý dự án.
  - **Duyệt theo HÀNG** ở **Chi Phí HCM + Phí Khách Hàng**: mỗi hàng có ô "Duyệt" — **CHỈ Admin** tick được (Account chỉ xem). **Chỉ hàng đã duyệt mới cộng vào Tổng** (kèm ngày duyệt). Chặn ở **server** theo `rid` từng hàng + đóng dấu ngày/người duyệt — Account không thể tự duyệt qua API.
- **Ngày thi công**: ô chọn ngày, **chỉ quản lý nội bộ — KHÔNG xuất Excel** (hiện ở trang Quản lý dự án).
- **Lưới kiểu Excel — copy/paste chuẩn mọi thiết bị/bộ gõ:** dùng **sự kiện copy/cut/paste của trình duyệt** (không phải bắt phím) nên chạy ổn trên **macOS/Safari/Firefox, chuột phải, cảm ứng, và cả khi mở bằng IP nội bộ (http)**. Có:
  - **Dán hiểu ô nhiều dòng** của Excel (parser RFC‑4180, có unit test) — không vỡ hàng.
  - **Dán nguyên bảng báo giá** mà app đã xuất ra (copy cả cột STT) → **tự dựng lại nhóm lớn (A/B) + nhóm con + hàng con + dòng thông tin**, map đúng cột (xem [public/grid-clipboard.js](public/grid-clipboard.js)). Dán khi đang ở dòng nhóm/nhóm con → chèn item ngay dưới.
  - **Dán 1 giá trị ra cả vùng đang chọn**; copy ra Excel/Word kèm bảng (text/html). Số kiểu VN (`1.234`) đọc đúng = 1234.
  - **Người chỉ‑xem cũng copy được** dữ liệu ra (ô read‑only, không sửa/cắt/dán).
  - **Ctrl+Z/Y, fill‑down (Ctrl+D)** — hoàn tác chạy ngay cả sau khi dán/cắt/fill. Chữ dài tự **xuống hàng** để dễ đọc (không vào Excel).
- Nhiều **sheet** trong 1 báo giá; mỗi sheet 1 template; xuất ra 1 file Excel nhiều sheet (ghép bằng XML/zip, xem [src/xlsxStitcher.js](src/xlsxStitcher.js)).
- **Responsive**: dùng tốt trên điện thoại / máy tính bảng / desktop.

## Trang Quản lý dự án

Theo dõi các báo giá **đã chốt** (`status = converted`) theo bố cục bảng sản xuất/hoá đơn:

- **Phân quyền xem:** **Chỉ Admin** → xem **TẤT CẢ** dự án đã chốt. **Account** (và user có **"Ký chứng từ"** `User.canSign`) → **CHỈ XEM** dự án đã chốt **do chính mình tạo** (lọc ở server theo người tạo). Menu hiện cho Admin + Account; **`account_hn` KHÔNG thấy** (cũng bị chặn route + API analytics).
- Mỗi **sheet** của báo giá = 1 dòng; báo giá nhiều sheet → Mã Sản Xuất thêm hậu tố `_1/_2…`, Hạng Mục = tên sheet.
- **Tìm kiếm + bộ lọc:** ô tìm (phim / mã sản xuất / khách / account) + lọc theo **Account** (người tạo) và **Mã khách hàng**; tổng + bảng cập nhật theo bộ lọc.
- **Khóa cố định 4 cột đầu** (Status · Phim · Hạng Mục · Báo Giá): cuộn ngang xem các cột hoá đơn/thanh toán phía sau mà 4 cột này luôn hiển thị để đối chiếu.
- Cột tự lấy từ báo giá: **Báo Giá** (trước VAT) · **Thành Tiền VAT** · **Mã Sản Xuất** (projectCode) · **Cty Xuất Hoá Đơn** (theo công ty của template sheet) · **Ngày Thi Công** · **Team client** (mã KH) · **Account** (người tạo).
- **Chi Phí HCM / Báo Giá Hà Nội / Phí Khách Hàng** = TỔNG các *bảng nội bộ* cùng loại của sheet đó. **HCM + Phí KH chỉ tính các hàng Admin đã DUYỆT**; Hà Nội tính tất cả.
- **Ký Chứng từ** (theo từng sheet): **Admin ký mọi dự án**; user được bật **"Được ký chứng từ"** (cột `User.canSign`) **chỉ ký dự án do mình tạo**; ký xong hiện "✓ Đã Ký" (kèm tên + ngày).
- Cột hoá đơn/thanh toán/chứng từ còn lại để "—" (giai đoạn sau cho nhập).

## Stack
- **Backend:** **TypeScript 100%** (chạy bằng `tsx`, không cần build) + Express + Prisma + PostgreSQL. **Kiến trúc tầng**: routes MỎNG (validate → service → res) → services (`src/services/*` + `src/quoteService.ts`: logic nghiệp vụ + phân quyền + audit + prisma). Handler thao tác I/O (export stream, pg_dump, cookie) giữ ở route.
- **Auth:** session (lưu DB) + JWT (access + refresh, có xoay vòng & thu hồi cả họ token) + bcrypt; **MFA (TOTP)** + mã dự phòng dùng-một-lần
- **Excel export:** ExcelJS (+ ghép nhiều sheet bằng zip XML)
- **Frontend — 2 lớp** (xem mục [Frontend: SPA cũ → React](#frontend-spa-cũ--react-đã-port-100)):
  - **SPA cũ:** HTML/CSS/JS thuần, **không cần build** — `public/` (vẫn phục vụ trên production `gianguyen.cloud`).
  - **App React mới:** **React 19 + Vite + TypeScript** trong `web/`, build ra `public/app2/`. **Đã port xong 100%** mọi màn (gồm editor báo giá kiểu Excel) — chạy ở `/` trên DEV/staging, không còn iframe. Dùng **TanStack Query** (cache + realtime qua SSE invalidate) + **code-split** (lazy-load editor/wizard → bundle chính nhẹ).
- **Hàng đợi nền (tuỳ chọn):** BullMQ + Redis (email/webhook/telegram chạy nền). Không có Redis thì xử lý inline.

## Frontend: SPA cũ → React (đã port 100%)

App đang chạy **song song 2 frontend** trên cùng 1 server Express, để chuyển đổi an toàn không downtime:

| | SPA cũ (`public/`) | App React mới (`web/` → `public/app2/`) |
|---|---|---|
| Công nghệ | HTML/CSS/JS thuần, hash-router, **no-build** | React 19 + Vite + TypeScript |
| Phục vụ tại | `gianguyen.cloud` (production) | `/app2` (mọi nơi) **và `/`** trên DEV/staging/`*.ts.net` |
| Trạng thái | ổn định, đang dùng thật | **đã port xong 100%** (mọi trang + editor báo giá + wizard + luồng Account HN), **không còn iframe** |

- **Định tuyến** ([src/app.js](src/app.js)): `/app2/*` luôn trả app React; `"/"` trả React nếu host là DEV/staging (`isStagingHost`: khớp `dev.` / `staging` / `*.ts.net`), ngược lại trả SPA cũ. → **Production vẫn là SPA**, DEV/staging chạy React để kiểm thử trước khi flip.
- **Design-system dùng chung:** React nạp thẳng `/style.css` của SPA + font Be Vietnam Pro → giao diện **giống y** app cũ. Money-math (`web/src/quoteMath.ts`) **byte-identical** với `src/money.js` → tổng trên màn = DB = Excel.
- **Build:** `public/app2/` là **artifact build, KHÔNG commit** (gitignored) — sinh lại bằng `npm run web:build` (hoặc `cd web && npm run build`, có `tsc --noEmit` chặn lỗi type). Mã nguồn React nằm ở **`web/src/`** (đã commit đầy đủ).
- **Hiện-đại-hóa (nhánh `chore/modernization`):** backend → **100% TypeScript + kiến trúc tầng**; gói **`shared/quote-math.ts`** (1 nguồn toán tiền dùng chung BE↔FE); frontend **TanStack Query** + **code-split**; CI gác `typecheck`/`web:build`/`web:test`; **optimistic-lock** chống mất dữ liệu khi 2 người sửa; `prisma migrate deploy` vào `deploy.sh`. Verify: **268 integration + ~50 e2e** (chạy `bash test-on-dev.sh`). *(Nâng Prisma 5→7 để đợt riêng — soft-delete trong transaction cần thư viện chuyên.)*

---

## 🚀 Production — https://gianguyen.cloud

Chạy bằng **Docker (docker-compose)** trên host do **Coolify** quản lý, sau **Cloudflare Tunnel** (TLS ở edge).

```
Internet → Cloudflare (TLS) → cloudflared tunnel → quanly-app:3000  (container)
                                                      ├─ quanly-worker    (BullMQ: export / email / webhook / telegram)
                                                      ├─ quanly-postgres  (PostgreSQL 16)  ← chỉ mạng nội bộ
                                                      └─ quanly-redis     (Redis 7)         ← chỉ mạng nội bộ
```

- **Image:** build từ [`Dockerfile`](Dockerfile) (multi-stage, chạy **non-root**, `npm ci --omit=dev`); `app` và `worker` dùng chung image.
- **Mạng:** Postgres/Redis **không expose ra ngoài** (chỉ docker network nội bộ); chỉ `app:3000` đi ra qua Cloudflare tunnel — không publish cổng nào lên host.
- **Cache:** `public/app.js` & `style.css` phục vụ `immutable` → **BẮT BUỘC tăng `?v=`** trong `public/index.html` mỗi khi đổi nội dung (không tái dùng `?v=` cũ → kẹt cache).
- **Migrations:** KHÔNG tự chạy (CMD = `node src/server.js`); chạy `prisma migrate deploy` riêng trong container dùng-rồi-bỏ. **Luôn `pg_dump` backup trước khi migrate** ([prisma/migrations/README.md](prisma/migrations/README.md)).
- **Bí mật** (`.env`, `docker-compose.prod.yml`) chỉ nằm trên host — **không** commit vào repo.

> Quy trình deploy chi tiết (archive → ship → build → migrate → recreate → verify, kèm retag rollback) giữ trong **ops runbook nội bộ** (không đưa vào repo vì chứa địa chỉ máy chủ + bí mật).

---

## Chạy local (dev)

Yêu cầu: Node.js 20+ và Postgres (dùng Docker cho nhanh).

```powershell
docker compose up -d      # Postgres + Redis (dev local)
npm install
npm run setup             # prisma migrate deploy + seed admin
npm run web:build         # build app React → public/app2 (bỏ qua nếu chỉ động backend/SPA)
npm start                 # http://localhost:3000
```

> SPA cũ ở `http://localhost:3000/` · app React ở `http://localhost:3000/app2/`. Muốn hot-reload React: chạy thêm `cd web && npm run dev` (Vite cổng riêng) song song với `npm start`. Trên DEV/staging (`dev.`/`*.ts.net`) thì `/` tự trả React.

**Tài khoản admin:** username `admin`. Mật khẩu: nếu để trống `ADMIN_PASSWORD` trong `.env`, seed **tự sinh mật khẩu mạnh** và ghi vào `.admin-credentials.local` (đọc 1 lần rồi đổi + xoá file).

> ⚠️ Đổi mật khẩu admin ngay sau lần đăng nhập đầu tiên.

## Lệnh thường dùng

| Lệnh | Mô tả |
|---|---|
| `npm start` | Chạy server (backend, `tsx src/server.js`) |
| `npm run dev` | Dev backend (tsx watch, auto reload) |
| `npm run web:build` | **Build app React** (`web/`) → `public/app2/` — chạy khi đổi `web/src/**` |
| `cd web && npm run dev` | Dev server React (Vite hot-reload, cổng riêng) — cần backend chạy song song |
| `npm run worker` | Chạy worker BullMQ (cần `REDIS_URL`) |
| `npm run typecheck` | Kiểm type backend (`tsc --noEmit`) |
| `npm run lint` | ESLint |
| `npm run db:studio` | Mở Prisma Studio xem DB |
| `npm run db:push` | Cập nhật schema khi sửa `schema.prisma` |
| `npm run db:seed` | Seed admin + công ty + template |
| `npm test` | Chạy test (vitest) |

## Phân quyền

| Vai trò (role) | Tạo / sửa BG | Chốt khách (✓/✗) | Duyệt hàng HCM/Phí KH | Analytics + Quản lý dự án | Quản lý user | Module Nhân sự |
|---|---|---|---|---|---|---|
| **Admin** (Giám đốc) | ✅ (tất cả) | ✅ | ✅ | ✅ (tất cả) | ✅ | Xem/sửa/xóa MỌI hồ sơ + **xác nhận đã ký** |
| **Account** (`manager`) | ✅ (của mình + BG được thêm thành viên) | ✅ | ❌ (chỉ xem) | ✅ (chỉ dự án của mình) | ❌ | Tạo + xem/sửa hồ sơ **của mình** |
| **Account Hà Nội** (`account_hn`) | ❌ — chỉ điền **giá Hà Nội** của BG được giao | ❌ | ❌ | ❌ (bị chặn) | ❌ | ❌ |
| **Nhân sự** (`hr`) | ❌ | ❌ | ❌ | ❌ | ❌ | **Chỉ XEM** mọi hồ sơ (read-only) |
| **Kế toán** (`accountant`) | ❌ | ❌ | ❌ | ❌ | ❌ | Xem mọi hồ sơ + **đánh dấu thanh toán** |

> Vai trò **"Nhân viên" đã bỏ** (xoá khỏi enum `Role`). Báo giá phạm vi theo **người tạo + thành viên** (`Quote.members`); Admin thấy tất cả. **Không còn duyệt nội bộ** — vòng đời chốt theo khách (xem dưới). **Duyệt theo hàng** (chi phí HCM/Phí KH) **chỉ Admin** (chặn ở server). Cờ `User.canSign` ("Được ký chứng từ") cho user (ngoài admin) **ký + xem Quản lý dự án — chỉ với dự án do mình tạo**.

## Trạng thái báo giá
**Nháp** → **Đã chốt** (`converted` — khách đồng ý) **/ Không chốt** (`lost` — khách từ chối). Gửi cho khách = tải Excel/PDF (không phải 1 trạng thái). Dự án "đã chốt" mới hiện ở **Quản lý dự án** + tính **doanh số** + cho **ký chứng từ**.

> Các trạng thái cũ `pending / approved / rejected / sent` đã **ngừng dùng** trong luồng (giữ trong enum `QuoteStatus` để khỏi migration DB — đừng tưởng là bug).

## Account Hà Nội (`account_hn`) — luồng giá Hà Nội

Quản lý **giao** 1 account Hà Nội điền phần **giá Hà Nội** (số nội bộ) của báo giá:

- Account HN chỉ thấy **danh sách BG được giao** (ẩn tiền/khách báo giá chính, ẩn menu Tổng quan / Tạo BG / Quản lý dự án) — cột riêng: **Người giao · Số sheet HN · Tổng HN · trạng thái HN**.
- Màn điền: nhiều **sheet Hà Nội** dạng tab ("+ Thêm sheet"), chọn **Mẫu** (có/không ngày) từng sheet, tổng gộp mọi sheet.
- Luồng: **Được giao → điền → Gửi duyệt → Quản lý duyệt / trả lại** (`hnStatus`: assigned · submitted · approved · rejected). File: [src/hnWorkflow.js](src/hnWorkflow.js).

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
├── public/                   # SPA cũ (no-build, ES modules) + chứa build React
│   ├── index.html            # SPA cũ — nhúng app.js?v=… (bump ?v= để vượt cache)
│   ├── style.css             # design-system DÙNG CHUNG (React cũng nạp file này)
│   ├── app.js                # SPA: entry + hash-router + shell (mỏng)
│   ├── js/                   # SPA đã module hóa:
│   │   ├── util.js               #   helper thuần (format, nhãn, totals)
│   │   ├── core/{state,api}.js   #   state dùng chung + fetch wrapper
│   │   ├── ui.js                 #   toast / modal / theme / skeleton
│   │   ├── preview.js            #   xem trước xlsx
│   │   ├── pages/{admin,quotes}.js  #  các trang
│   │   └── editor.js             #   editor + lưới spreadsheet (drawItems)
│   └── app2/                 # ⚙️ BUILD app React (gitignored — sinh bằng `npm run web:build`)
├── web/                      # 🆕 App React mới (React 19 + Vite + TypeScript)
│   ├── index.html            #   nạp /style.css + font của SPA (giống y app cũ)
│   ├── vite.config.ts        #   base:/app2/  ·  outDir:../public/app2
│   └── src/                  # 28 file .ts/.tsx — màn + engine lưới:
│       ├── Shell.tsx / App.tsx       #   khung + đăng nhập/MFA + định tuyến + SSE
│       ├── QuoteEditor.tsx           #   editor báo giá (port đầy đủ từ editor.js)
│       ├── GridTable.tsx             #   engine lưới kiểu Excel (công thức/dán/undo/fx-bar)
│       ├── NewQuoteWizard.tsx        #   wizard tạo báo giá 3 bước
│       ├── AccountHnView.tsx         #   màn điền giá Hà Nội (account_hn)
│       ├── Personnel.tsx/Employees.tsx  # module Nhân sự
│       ├── quoteMath.ts / formula.ts / clipboard.ts  # toán tiền (byte-identical money.js) + công thức + paste
│       └── …                         #   Customers/Users/Audit/Permissions/Projects/Dashboard/…
├── src/
│   ├── server.js             # Express entry (listen PORT, mặc định 3000)
│   ├── app.js                # khởi tạo Express app (createApp)
│   ├── config.js             # đọc + validate .env (zod)
│   ├── db.js                 # Prisma client (+ soft-delete)
│   ├── excel.js              # Xuất Excel (đổ dữ liệu vào template)
│   ├── templateConfigs.js    # Map field → ô Excel cho từng template
│   ├── xlsxStitcher.js       # Ghép nhiều sheet thành 1 file (zip XML)
│   ├── validators.js         # zod schema cho API
│   └── routes/               # auth, quotes, export, customers, personnel.routes.ts, employees.routes.ts, … (.js + .ts)
├── templates/                # File .xlsx mẫu của công ty
├── Dockerfile                # Image production (multi-stage, non-root)
├── docker-compose.yml        # Postgres + Redis cho dev local
└── .env                      # (không commit)
```
