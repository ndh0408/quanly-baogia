# QuanLY — hướng dẫn kỹ thuật (canonical)

Đây là **nguồn duy nhất** cho quy ước làm việc trên repo này. Mọi trợ lý AI và
mọi lập trình viên đọc file này. `CLAUDE.md` chỉ chứa phần riêng của công cụ
Claude Code và trỏ ngược về đây.

**Trả lời bằng tiếng Việt.**

## Hệ thống này là gì

Hệ quản lý nội bộ **đang chạy production** tại `gianguyen.cloud`: báo giá, hồ sơ
nhân sự, theo dõi dự án cho hai công ty (Gia Nguyễn + Colorfull). Brownfield, một
lập trình viên. Node 22 + TypeScript + Express + Prisma + Postgres + Redis, deploy
Docker qua Coolify. Frontend là **React 19 + Vite** ở `web/src`. SPA vanilla cũ
(`public/js`) đã **gỡ hẳn 2026-08-26** — xem
[docs/adr/0006-go-spa-vanilla-cu.md](docs/adr/0006-go-spa-vanilla-cu.md).

Đây là dữ liệu thật của một doanh nghiệp thật. Mọi thay đổi phải giả định là có
người đang dùng ngay lúc này.

## Đọc trước khi sửa

| Việc | Đọc |
|---|---|
| Hiểu hệ thống | [docs/architecture/ARCHITECTURE.md](docs/architecture/ARCHITECTURE.md) |
| Đụng vào auth/quyền | [docs/architecture/SECURITY_MODEL.md](docs/architecture/SECURITY_MODEL.md) |
| Dựng môi trường | [docs/development/SETUP.md](docs/development/SETUP.md) |
| Viết test | [docs/development/TESTING.md](docs/development/TESTING.md) |
| Deploy | [docs/operations/DEPLOYMENT.md](docs/operations/DEPLOYMENT.md) |

## Quy ước bất di bất dịch

- **Đừng đề xuất multi-tenancy/RLS.** Hai công ty dùng chung nhân viên và chung
  dữ liệu; `Company` chỉ là nhãn pháp nhân để xuất hoá đơn.
- **`projectCode` CỐ Ý free-format** theo từng người — đừng chuẩn hoá, đừng thêm FK.
- **zod v4**: cú pháp v3 (`invalid_type_error`, `errorMap`) bị **bỏ qua âm thầm**,
  làm lọt thông báo tiếng Anh ra giao diện. Dùng tham số `error`.
- **Tiền dùng `Decimal`**, không dùng float JS. Đổi sang `Number` là mất chính xác.
- **Frontend chỉ có MỘT**: `web/src`. Vite băm nội dung vào tên file asset nên
  không còn phải bump `?v=` bằng tay như SPA cũ.
- **Prettier KHÔNG đụng `.ts/.tsx/.js`** (xem `lint-staged.config.mjs`). House
  style dùng one-liner có chủ đích; để prettier bung dòng là diff khổng lồ và
  conflict với nhánh song song. Chỉ format `{json,css,yml,yaml}`.
- Test tích hợp không chạy được trên máy Windows của tác giả — dùng
  `bash test-on-dev.sh` (chạy trên VM dev).

## TUYỆT ĐỐI không phá

Đây là hành vi production đã được người dùng dựa vào. Sửa mà không có test hồi
quy là làm hỏng công việc của người khác.

- Engine lưới báo giá: **clipboard** (copy/cut/paste bằng sự kiện trình duyệt,
  KHÔNG bắt phím), **phân tích RFC-4180**, **IME tiếng Việt** (Enter để chốt từ
  trong OpenKey/Unikey không được nhảy ô), **Ctrl+Z/Y**, chọn nhiều ô, fill-down.
- **Round-trip Excel**: dán lại bảng do chính app xuất ra phải dựng lại đúng cấp
  nhóm / nhóm con / dòng con / dòng thông tin.
- **Mẫu Excel**: xuất ra phải là **file của công ty** — logo, phông, viền, ô gộp,
  vùng in. Đó là lý do `src/xlsxStitcher.ts` ghép XML thay vì sinh workbook mới.
- **Công thức**: `=5x3`, `=SUM(H3:H8)`, tham chiếu ô, `$` tuyệt đối.
- **Bảng nội bộ** (chi phí HCM / báo giá HN / phí khách) **không được** lọt vào
  file Excel gửi khách.

## Chốt chặn của CI — đừng vô hiệu hoá

Mỗi cái ra đời từ một lỗi có thật.

| Chốt | Bắt gì |
|---|---|
| `scripts/ci/endpoint-inventory.mjs --check` | Endpoint mới chưa vào ma trận phân quyền = **chưa ai soát quyền** |
| `scripts/ci/check-runtime-command.sh` | Docker/Compose/Helm/k8s khởi động lệch nhau (đã từng làm mọi pod chết vòng lặp) |
| `scripts/ci/smoke-dist.sh` | Artifact production không boot được, hoặc đường dẫn tài nguyên sai sau khi biên dịch |
| `scripts/ci/smoke-image.sh` | Image vừa dựng không chạy được |
| `scripts/ci/repo-stats.mjs --check` | README công bố số liệu sai (đã từng ghi hai số model mâu thuẫn nhau) |
| `tests/env-example.test.js` | `.env.example` thiếu biến mà production BẮT BUỘC phải có |
| `REQUIRE_DB_TESTS=1` | CI xanh trong khi test tích hợp lặng lẽ bỏ qua |

## Trước khi coi là xong

```bash
npm run lint
npm run typecheck
npm run build                       # phải sinh được dist/
npm run test:run                    # cần Postgres + Redis + MinIO cho test tích hợp
npm --prefix web run typecheck
npm run web:test
node scripts/ci/endpoint-inventory.mjs --check
node scripts/ci/repo-stats.mjs --check
bash scripts/ci/check-runtime-command.sh
```

## Cách làm việc mong đợi

- **Đọc mã trước khi kết luận.** Tài liệu audit cũ trong `docs/archive/` là LỊCH
  SỬ — nhiều phát hiện đã được sửa. Đừng vá lại thứ đã vá.
- **Tái hiện lỗi trước khi sửa.** "Có vẻ sai" không đủ; phải chỉ ra được đầu vào
  nào cho ra kết quả sai nào.
- **Test cùng commit với bản sửa**, và test đó phải ĐỎ trên mã cũ. Một test không
  bao giờ đỏ được thì không bảo vệ gì.
- **Nói đúng mức độ.** Lỗi tiềm ẩn không với tới được thì ghi là tiềm ẩn, đừng
  gọi là sự cố đang xảy ra.
- **Migration phải an toàn**: production dùng `prisma migrate deploy`, KHÔNG dùng
  `db push` (nó xoá được cột và dữ liệu). Thay đổi đụng dữ liệu thì diễn tập
  trước bằng `scripts/db/migration-rehearsal.sh`.
- **Comment giải thích VÌ SAO**, không mô tả CÁI GÌ. Cái gì thì đọc code cũng ra.
