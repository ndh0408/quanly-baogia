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

## Chốt chặn — đừng vô hiệu hoá

⚠️ **GitHub Actions KHÔNG bật trên tài khoản của repo này.** `.github/workflows/ci.yml` khai
đầy đủ nhưng **chưa bao giờ chạy**. Mọi câu kiểu "cứ đẩy lên, CI sẽ bắt" đều SAI ở đây. Cổng
duy nhất thật sự chạy là cổng bạn gõ tay: `npm run verify`.

Cái giá của việc đó không phải giả định: lượt chạy thật đầu tiên của job `security` (2026-08-27)
lộ ra `.gitleaks.toml` viết allowlist bằng cú pháp gitleaks BỎ QUA, và `.trivyignore.yaml` ghi ID
thiếu tiền tố — hai chốt mà repo tưởng mình đang có.

Mỗi cái dưới đây ra đời từ một lỗi có thật.

| Chốt | Bắt gì |
|---|---|
| `scripts/ci/endpoint-inventory.mjs --check` | Endpoint mới chưa vào ma trận phân quyền = **chưa ai soát quyền** |
| `scripts/ci/check-runtime-command.sh` | Docker/Compose/Helm/k8s khởi động lệch nhau (đã từng làm mọi pod chết vòng lặp) |
| `scripts/ci/smoke-dist.sh` | Artifact production không boot được, hoặc đường dẫn tài nguyên sai sau khi biên dịch |
| `scripts/ci/smoke-image.sh` | Image production: boot, `/livez` + `/readyz`, SPA phục vụ được, phông PDF, prisma CLI, không có mã nguồn/đồ nghề test, **0 dòng stack trong log khởi động**. `scripts/ci/docker-smoke.sh` dựng image từ cây làm việc rồi gọi nó — **mọi khẳng định về image nằm ở `smoke-image.sh`**, đừng nhân đôi |
| `scripts/ci/ui-smoke.mjs` | Chromium thật, 18 bước đi hết luồng người dùng: đăng nhập → danh sách → sửa ô → **Lưu** → tải lại + đọc lại số đã lưu → **mất tab giữa chừng: khôi phục bản nháp cục bộ** → **tạo báo giá qua wizard 3 bước** → lưu bản mới → **xuất Excel** (kiểm cả byte "PK" của gói OOXML) → **đăng xuất** → **kiểm quyền** bằng tài khoản `account_hn` (menu, hash gõ thẳng, và 403 ở MÁY CHỦ) → 0 lỗi console. Không tầng nào dưới nó thấy lớp lỗi này: tầng component chạy jsdom (dựng lại DOM trong tiến trình, không tải asset, không thi hành CSP, không có mạng), chỉ E2E mới nạp bundle ĐÃ BUILD qua Express thật |
| `scripts/ci/check-web-bundle.mjs` | Bundle giao cho người dùng là **bản DEV của React**. Vite quyết dev-hay-prod theo `NODE_ENV` của máy đang build, mà chính `verify-local.sh` export `NODE_ENV=test` — nên trước 2026-08-27 `npm run verify` đẻ ra bundle dev (984.802 byte thay vì 630.482) rồi đem đi smoke |
| `scripts/ci/check-helm.mjs` | Chart render ra manifest hỏng: tag di động, mật khẩu rỗng, `secretKeyRef` trỏ khoá không tồn tại. `helm lint` KHÔNG render nên không thấy gì |
| `scripts/ci/check-alerts.mjs` | Quy tắc cảnh báo sai **logic** (`promtool test rules`) hoặc trỏ vào metric đã đổi tên. Bước `[A4]` soi luôn PromQL trong bảng điều khiển Grafana — panel trỏ vào metric đã chết vẽ đường 0 và người trực đọc thành "hệ thống đang yên" |
| `scripts/db/explain-hot-paths.mjs` | Truy vấn nóng QUÉT TUẦN TỰ bảng lớn. Dựng 5.000 dòng thật, nghe câu SQL Prisma THẬT SỰ chạy rồi `EXPLAIN ANALYZE` nó. Đã tìm ra một index thiếu thật (trang Mã khách hàng sắp theo `createdAt` mà không có index nào phục vụ) |
| `scripts/ci/security-scan.sh` | Bí mật trong mã **và trong lịch sử git**, lỗ hổng HIGH/CRITICAL có bản vá, mẫu nguy hiểm (semgrep), SBOM |
| `scripts/ci/check-line-refs.mjs` | Chú thích trỏ `file:dòng` vào hư không (số dòng trôi mỗi lần ai đó thêm dòng) |
| `scripts/ci/check-doc-numbers.mjs --check` | **Con số trong tài liệu trôi khỏi mã nguồn.** `check-line-refs` chỉ kiểm tham chiếu `file:dòng` có trỏ vào chỗ có thật — nó KHÔNG nhìn con số. Cổng này đo chín đại lượng từ mã nguồn (quy tắc cảnh báo, nhóm quy tắc, bài `promtool`, bước ui-smoke, metric, endpoint, ADR, tệp test backend, tệp test web) rồi đối chiếu với mọi tài liệu trong cây, và in kèm lệnh shell để tự đo lại. **Viết số vào tài liệu thì đọc quy ước ngay dưới bảng trước** |
| `scripts/ci/check-architecture.mjs` | Ranh giới tầng nhoè đi: route chạm thẳng Prisma, service tự trả HTTP, phụ thuộc ngược chiều, vòng import. 7 khoản nợ hiện có được KHAI kèm lý do — file mới thì ĐỎ ([ADR 0008](docs/adr/0008-khong-doi-cay-thu-muc-sang-modules.md)) |
| `scripts/ci/check-shell-strict.mjs` | Script shell thiếu `set -euo pipefail` — lỗi giữa chừng đi tiếp im lặng (đã từng nuốt trọn một lượt migration hỏng) |
| `scripts/ci/check-deps.mjs` | Phụ thuộc lệch giữa `package.json` và `package-lock.json`, hoặc gói chỉ-dev lọt vào `dependencies` |
| `scripts/ci/repo-stats.mjs --check` | README công bố số liệu sai (đã từng ghi hai số model mâu thuẫn nhau) |
| `tests/env-example.test.js` | `.env.example` thiếu biến mà production BẮT BUỘC phải có |
| `REQUIRE_DB_TESTS=1` | Cổng xanh trong khi test tích hợp lặng lẽ bỏ qua |

### Viết số vào tài liệu — quy ước khai SỐ LỊCH SỬ

`check-doc-numbers` soi **mọi** con số trong tài liệu, kể cả con số bạn cố ý viết về quá khứ
("trước đợt vá là 14 metric"). Repo này GIỮ những con số đó — chúng là bản ghi, không phải lỗi.
Nên trước khi viết, phải biết cách khai, nếu không cổng sẽ chặn bạn mà bạn không hiểu vì sao.

Ba cách khai một con số lịch sử, dùng cách nào cũng được:

1. **Mốc bằng lời** — đặt một cụm như `trước đợt` · `trước đó` · `trước đây` · `từng ghi` ·
   `từng là` · `bản trước` · `bản cũ` · `ảnh chụp` · `số của mốc` · `lúc Phase` · `đã đo lúc`
   vào **trước** con số, trong cùng đoạn văn. Mốc làm mờ mọi con số đứng SAU nó.
2. **Nhãn tường minh** `<!-- so-lich-su -->` trên chính dòng đó, hoặc dòng ngay trước.
3. **Dạng tỉ lệ `N/M`** — "8/8 ADR", "137/137 endpoint". Đây là lời khai "đã xử lý N trong M
   của LÚC ĐÓ", nên cổng bỏ qua cả cụm.

Hai hệ quả dễ vấp:

- **Mốc chỉ về PHÍA TRƯỚC.** Số hiện tại đứng TRƯỚC mốc vẫn bị soi — đó là chủ ý, vì người ta
  hay viết "hiện có 17 quy tắc; trước đợt 2026-08-27 là 14". Nếu bạn đặt số hiện tại SAU một
  mốc, nó sẽ bị bỏ qua và **cổng mất răng ở đúng chỗ đó**.
- **Đoạn văn cắt tại dòng trống, dòng bảng `|`, tiêu đề `#`, mục danh sách.** Một mốc trong ô
  bảng chỉ mờ đúng hàng đó, không lan xuống cả bảng. Ngược lại: viết một mốc trong văn xuôi vì
  lý do KHÔNG liên quan tới số liệu ("Trước đây chúng tôi dùng Grafana Cloud") vẫn làm mờ mọi
  con số sau nó trong cùng đoạn. Muốn giữ răng thì đặt số hiện tại TRƯỚC mốc, hoặc tách đoạn.

Không khai được vì con số thật sự sai? Thì **sửa con số**, đừng khai lịch sử để cho qua. Chạy
`npm run docnum` để xem toàn bộ số đo cùng lệnh shell tương đương của từng đại lượng.

## Trước khi coi là xong

```bash
npm run verify          # 13 bước — chạy HẾT, khoảng 9 phút
npm run verify:nhanh    # vòng lặp sửa nhanh: bỏ test/build web, smoke image, smoke giao diện, quét bảo mật
```

`verify` cần Postgres + Redis + MinIO cục bộ (nó tự kiểm và **dừng ngay** nếu thiếu — một dòng
"skipped" trông y hệt một dòng xanh). Nó cũng **từ chối chạy** nếu `DATABASE_URL`/`REDIS_URL`/
`S3_*` không trông như hạ tầng test: bộ test có `deleteMany` và `obliterate`, chạy nhầm lên
production là mất dữ liệu chứ không phải bất tiện.

Chạy riêng từng cổng khi cần: `npm run check:helm` · `npm run check:alerts` · `npm run check:refs`
· `npm run smoke:image` · `npm run smoke:ui` · `npm run scan` · `npm run sbom`

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
