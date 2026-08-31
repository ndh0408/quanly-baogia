# Kiểm thử

## Tháp kiểm thử của repo này

```
     ┌──────────────────────────────────┐
     │ E2E trình duyệt                  │  Chromium THẬT trên bundle ĐÃ BUILD;
     │ (Playwright · ui-smoke.mjs)      │  chạy ở `npm run verify`, KHÔNG ở CI
     ├──────────────────────────────────┤
     │ Tích hợp (supertest + PG + MinIO)│  lái ứng dụng THẬT
     ├──────────────────────────────────┤
     │ Component React (jsdom)          │  render component THẬT, bắn phím THẬT;
     │ (*.component.test.tsx)           │  OPT-IN TỪNG TỆP — xem mục ngay dưới
     ├──────────────────────────────────┤
     │ Đơn vị (toán tiền, phân quyền,   │  thuần, chạy đâu cũng được
     │ excel, clipboard, mã hoá…)       │
     └──────────────────────────────────┘
```

Bốn tầng, và tầng trên cùng **có thật** — không phải kế hoạch. `playwright` nằm trong
khối `devDependencies` của `package.json` và có đúng một chỗ dùng:
`scripts/ci/ui-smoke.mjs` (`import { chromium } from "playwright"`). Chốt
`tests/ch3-npm-manifest.test.js` đòi mọi `devDependencies` phải được cấu hình/script
dùng thật, và `playwright` qua được chốt đó **nhờ** file này.

> **Sửa ngày 2026-08-27.** Bản trước của mục này viết `playwright` "đã bị gỡ vì không
> file nào trong repo dùng tới nó" và bảo muốn có E2E thì phải cài lại. Sai ở cả hai
> vế: gói vẫn còn trong `package.json`, và tầng E2E đã chạy từ trước. Giữ lại câu này
> để không ai "sửa" ngược lại theo trí nhớ cũ.

Khác biệt duy nhất cần nhớ: tầng E2E **không chạy trong GitHub Actions**.
`.github/workflows/ci.yml` không có bước nào gọi nó. Nó là bước `[12/13]` của
`scripts/verify-local.sh`, tức chỉ chạy khi có người gõ `npm run verify` trên máy
mình. Xem hai mục ngay dưới.

## Tầng E2E trình duyệt — `npm run smoke:ui`

```bash
npm run smoke:ui                          # = node scripts/ci/ui-smoke.mjs
node scripts/ci/ui-smoke.mjs --hien       # mở cửa sổ Chromium (gỡ lỗi trên máy có màn hình)
```

**Cần trước khi chạy:** `dist/server.js` (`npm run build`) và
`public/app2/index.html` (`npm run web:build`) — bước `[U0]` dừng ngay nếu thiếu;
một Postgres đang chạy (script ghi fixture thẳng qua Prisma); và một bản Chromium.
Chromium được tìm theo thứ tự `SMOKE_CHROMIUM` → thư mục `PLAYWRIGHT_BROWSERS_PATH`
→ bản Playwright tự quản (`npx playwright install`).

**Vì sao chạy ở `NODE_ENV=development`, có chủ ý:** cookie phiên đặt
`secure: isProd`, nên ở production cookie chỉ đi qua HTTPS và một lượt smoke qua
`http://127.0.0.1` sẽ không bao giờ giữ được phiên. Vế "cấu hình production có khởi
động nổi không" nằm ở hai script khác, cùng chạy `NODE_ENV=production` thật:
`scripts/ci/smoke-dist.sh` (bước `[10b/13]`, chạy artifact `dist/` trần) và
`scripts/ci/docker-smoke.sh` (bước `[11/13]`, chạy trong container). Ba script chia
nhau ba vế — xem mục dưới để biết vì sao hai vế production không gộp làm một.

**18 bước, đi hết một luồng người dùng thật:**

| Bước | Kiểm gì |
|---|---|
| `U0` | artifact có sẵn (`dist/server.js`, `public/app2/index.html`) |
| `U1` | dựng fixture: 2 user (`admin` + `account_hn`) + công ty + mẫu + khách + báo giá |
| `U2` | khởi động máy chủ **từ `dist/`**, không phải `tsx` |
| `U3` | mở Chromium, gắn hai sổ ghi: lỗi console + request hỏng |
| `U4`–`U5` | màn đăng nhập → đăng nhập |
| `U6`–`U7` | danh sách báo giá → mở trình soạn, lưới Excel dựng được |
| `U8` | **gõ vào ô đơn giá → Thành Tiền tính lại** (kiểm ngược đã đo: cộng 1 đồng vào `lineAmount` của `shared/quote-math.ts` thì bước này ĐỎ) |
| `U9` | bấm Lưu — số vừa gõ phải đi tới CSDL |
| `U10` | tải lại trang — bundle nạp lại được, phiên còn, số đã lưu còn |
| `U10b` | mất tab giữa chừng — bản nháp cục bộ cứu được phần chưa lưu |
| `U11`–`U12` | wizard 3 bước tạo báo giá mới → lưu bản mới (POST tạo bản ghi thật) |
| `U13` | xuất Excel từ menu ⋯ — file thật, không phải trang HTML |
| `U14` | đăng xuất |
| `U15` | phân quyền: `account_hn` gọi thẳng API của admin và phải nhận đúng 403 |
| `U16` | **console sạch + không request nào hỏng, suốt cả lượt chạy** |

`U16` là chốt đắt giá nhất: một smoke chỉ hỏi "có thấy chữ X không" vẫn xanh trong
khi console đỏ rực, mà console đỏ chính là chỗ asset 404, `ChunkLoadError`, CSP chặn
bundle của chính mình, và lỗi React lúc mount cả cây hiện ra. Bốn lớp lỗi đó không
bài vitest nào bắt được — kể cả tầng component chạy jsdom, vì không bài nào nạp bundle
ĐÃ BUILD qua Express thật. jsdom dựng lại DOM trong tiến trình; nó không tải asset,
không thi hành CSP, không có mạng.

Bốn ngoại lệ được khai tường minh (không tha rộng): `/api/stream/events` bị
`ERR_ABORTED` (SSE là kết nối sống mãi, đóng tab là kết thúc bình thường); `401` ở
`/api/auth/me` trước khi đăng nhập; máy chủ NGOÀI (`fonts.googleapis.com`) — vẫn được
liệt kê nhưng không làm đỏ, vì mạng của máy chạy không thuộc quyền bộ test; và cặp
`<mã> <đường dẫn>` mà `U15` cố ý gọi ra.

**Dữ liệu:** tự tạo với tiền tố `uismoke-<pid>` và **xoá cứng trong `finally`** —
dọn theo `companyId` chứ không chỉ theo tiền tố tên, vì báo giá do wizard tạo mang
số do máy chủ sinh. Không đụng dữ liệu sẵn có, không phụ thuộc seed. Khi đỏ thì ghi
ảnh màn hình vào `.ui-smoke/` kèm 1500 ký tự cuối của log máy chủ.

**Khi nào bước `[12/13]` tự bỏ qua:** chạy `npm run verify:nhanh` (`--nhanh` không
build web nên sẽ kiểm nhầm bundle của lần build trước), hoặc gói `playwright` chưa
được cài — lúc đó verify in một dòng **vàng** và đi tiếp, không đỏ.

## Tầng artifact production — `bash scripts/ci/smoke-dist.sh`

```bash
DATABASE_URL=... REDIS_URL=... bash scripts/ci/smoke-dist.sh
```

Chạy ĐÚNG hai lệnh mà Docker/Compose/Helm/k8s sẽ chạy — `node dist/server.js` và
`node dist/worker.js` — ở `NODE_ENV=production`, trên cây làm việc hiện tại, không
cần docker. Là bước `[10b/13]` của `scripts/verify-local.sh`; **chạy cả ở
`--nhanh`** vì nó tốn vài giây chứ không phải vài chục (bước `[11/13]` phải dựng
image nên mới bị `--nhanh` bỏ qua).

**Vì sao không gộp vào `smoke-image.sh`.** Năm khẳng định dưới đây chỉ có ở đây —
`smoke-image.sh` không kiểm cái nào:

| Kiểm gì | Lớp lỗi nó bắt |
|---|---|
| `/api/health` | route sức khoẻ của ứng dụng (khác `/livez` hạ tầng) chết sau khi biên dịch |
| `/style.css` trả `200` | `rootDir`/`outDir` sai → `__dirname/../public` trỏ lệch → **toàn bộ frontend 404 âm thầm** trong khi typecheck vẫn xanh. Xem bảng trong [../operations/DEPLOYMENT.md](../operations/DEPLOYMENT.md) |
| `/metrics` trả `401` khi không có token, và trả số liệu khi có | `METRICS_TOKEN` đã đặt mà cổng token không được mắc — số liệu nội bộ mở toang |
| `/api/auth/login` trả `401`, **không phải** `5xx` | đường đăng nhập vỡ ở bản đã biên dịch: `5xx` và `401` trông giống nhau trên biểu đồ, khác hẳn với người dùng |
| worker thoát sau `SIGTERM` | rolling update cắt ngang job đang chạy vì worker không nghe tín hiệu dừng |

**Trước 2026-08-31 script này KHÔNG BAO GIỜ CHẠY.** Nó chỉ được gọi ở
`.github/workflows/ci.yml:217`, mà Actions không bật trên tài khoản này. Lượt chạy tay
đầu tiên lộ ra ngay một lỗi: script gán `PORT=3999` nhưng **không `export`**, nên tiến
trình con `node dist/server.js` bind cổng mặc định `3000` của chính nó còn script gõ cửa
`3999`. Trong CI thì không thấy, vì khối `env:` của bước đã export sẵn — đúng hình dạng
của một cổng chỉ chạy được ở một nơi duy nhất.

## Tầng component React — jsdom, và nó **OPT-IN TỪNG TỆP**

> **Đọc mục này TRƯỚC khi viết bài kiểm mới trong `web/`.** Người viết sau rất dễ tưởng
> mọi test của `web/` đều có DOM. **Không.** Mặc định vẫn là `"node"`, và một bài dùng
> `document` mà quên khai docblock sẽ chết bằng `document is not defined` — lỗi trông
> như bài kiểm sai, chứ không chỉ ra rằng thiếu một dòng cấu hình.

Cách bật DOM cho một tệp: đặt docblock ở **dòng 1**, trước mọi `import`.

```ts
/** @vitest-environment jsdom */
import { createRoot } from "react-dom/client";
```

Ba điều cố ý, đừng "sửa" ngược:

1. **`web/vite.config.ts` KHÔNG khai khối `test`**, và `web/` không có
   `vitest.config.*`. Nên environment mặc định của `web/` là `"node"` và
   **mọi tệp không khai docblock vẫn chạy thuần**. Đừng đặt
   `test: { environment: "jsdom" }` cho cả `web/`: nó bọc một DOM giả quanh những bài
   đang cố tình chạy không có DOM, và làm mất chính lớp bảo đảm *"hàm này không đụng
   `document`"* — thứ khiến `web/src/lib/*` an toàn khi dùng lại ở nơi khác. Chi phí
   cũng có thật: dựng jsdom tốn thời gian cho từng tệp, và tuyệt đại đa số bài không cần.
2. **Chỉ `jsdom` được cài, KHÔNG có `@testing-library/*`.** Bài kiểm dùng `createRoot`
   + `act` của chính React 19 và bắn `KeyboardEvent` **gốc** vào phần tử. React uỷ quyền
   sự kiện ở gốc cây, nên phím bắn kiểu này đi đúng đường phím thật đi. Giữ dấu chân phụ
   thuộc ở một gói là có chủ ý — `tests/ch3-npm-manifest.test.js` đòi mọi
   `devDependencies` phải có người dùng thật.
3. **`jsdom` không lọt vào ảnh production.** Stage `webbuild` chạy `npm ci` để BUILD;
   stage runtime chỉ lấy kết quả đã build — `Dockerfile:98` là
   `COPY --from=webbuild /app/public/app2 ./public/app2`, không copy `node_modules` nào.

**Tệp đang có ở tầng này** (tính đến 2026-08-28, đúng một):
`web/src/components/GridTable.component.test.tsx` — **42 bài**, dựng `<GridTable />` thật
để kiểm dây nối bàn phím: hoàn tác/làm lại, cổng `editable`, cổng IME, Shift+mũi tên, và
bất biến *"mốc hoàn tác phải được chụp TRƯỚC khi ghi vào `items`"*. `loadCatalog` — lối ra
mạng duy nhất của component — bị chặn bằng `vi.mock`; mọi hàm thuần khác vẫn chạy bản thật.

```bash
cd web && npx vitest run src/components/GridTable.component.test.tsx
```

**Giới hạn của tầng này — biết trước để đừng phí công.** jsdom không có layout
(`getBoundingClientRect` trả toàn số 0), không có `ResizeObserver`, không có `matchMedia`,
không có `ClipboardEvent` lẫn `DataTransfer`, và **không giải mã ảnh** (`Image.onload`
không bao giờ bắn). Nên mọi thứ cần đo đạc thật — vị trí dropdown, bề rộng cột, kéo-thả,
chọn vùng bằng chuột, nén ảnh qua canvas — **không** kiểm được ở đây; chúng thuộc tầng E2E
hoặc chưa có cổng. Danh sách chính xác chỗ nào còn hở:
[../REMAINING_RISKS.md](../REMAINING_RISKS.md).

## Nhóm test

| Nhóm | File tiêu biểu | Cần hạ tầng |
|---|---|---|
| Toán tiền | `money.test.js`, `quoteUtils.test.js`, `quoteFormula.test.js` | không |
| Excel / OOXML | `excel.test.js`, `excelImport.test.js`, `xlsxStitcher.test.js`, `excel-snapshot.test.js` | không |
| Lưới / clipboard | `gridClipboard.test.js` | không |
| Mã hoá | `piiBox.test.js`, `secretbox.test.js`, `mfa.test.js` | không |
| An toàn đầu vào | `zipSafety.test.js`, `decompressBody.test.js`, `validators.test.js` | không |
| Cổng xuất file | `exportQueue.test.js` | không |
| So khớp cấu hình | `env-example.test.js` | không |
| So sánh mã CSRF | `csrf-token-compare.test.js` | không |
| Phân quyền | `permissions.test.js`, `role-permissions.test.js`, `per-user-permissions.test.js` | có (một phần) |
| Hồi quy bảo mật | `security-regression.test.js`, `security-regression-2.test.js`, `authz-deny-by-default.test.js` | có |
| CSRF đầu-cuối | `csrf.test.js` | Postgres |
| Luồng báo giá | `quotes.workflow.test.js`, `quote-negative-total.test.js`, `quote-realtime.test.js` | Postgres |
| Nhân sự / rạp | `personnel*.test.js`, `venues.test.js` | Postgres (+ MinIO cho chứng từ) |

## Test bỏ qua khi thiếu hạ tầng — và vì sao CI không xanh giả

Mẫu dùng chung:

```js
const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "User" LIMIT 1')
  .then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") throw new Error(...);

describe.runIf(dbAvailable)("…", () => { … });
```

Trên máy dev không có Postgres, bộ test **bỏ qua** cho gọn. Ở CI,
`REQUIRE_DB_TESTS=1` khiến chính việc thiếu hạ tầng trở thành **lỗi**. Không có
chốt này thì một CI thiếu CSDL vẫn xanh trong khi **không kiểm gì** về phân quyền.

Điều tương tự áp cho kho object: `personnel-fields.test.js` yêu cầu `S3_*` khi
`REQUIRE_DB_TESTS=1`, để đường ghi/đọc **chứng từ tài chính** không lặng lẽ trôi
ra ngoài phạm vi kiểm thử.

## `tests/helpers/agent.js`

csrfGuard đòi `X-CSRF-Token` cho mọi thao tác ghi bằng phiên cookie. SPA — nay chỉ
còn **MỘT**, bản React; SPA vanilla đã gỡ, xem
[adr/0006-go-spa-vanilla-cu.md](../adr/0006-go-spa-vanilla-cu.md) — tự lo trong lớp
bọc fetch của nó (`web/src/lib/api.ts`); supertest thì **đi vòng** qua lớp đó.

`agentWithCsrf(app)` cho agent test làm đúng việc mà SPA làm. Dùng nó cho **mọi**
test tích hợp.

Ngoại lệ duy nhất: `tests/csrf.test.js` cố ý dùng `request.agent(app)` **trần** để
tự dựng từng tình huống (thiếu mã, mã sai, mã của phiên khác). Đừng đổi file đó.

## Quy ước

- **TAG theo timestamp** cho mọi bản ghi test: ``const TAG = `pf${Date.now()}` `` —
  test chạy song song và trên CSDL dùng chung không giẫm lên nhau.
- **Dọn trong `afterAll`**, dùng `hardDelete: true` (extension Prisma mặc định là
  xoá mềm).
- **`describe.runIf(dbAvailable)`**, không dùng `describe.skip`.
- Lái ứng dụng **thật** qua `createApp()` + supertest, không mock service.

## Chạy

```bash
npm run test:run                          # tất cả
npx vitest run tests/csrf.test.js         # một file
npx vitest run -t "tổng âm"               # một ca theo tên
npm run test:coverage                     # kèm coverage
npm run web:test                          # test frontend: đơn vị + tầng component jsdom
npm run smoke:ui                          # E2E Chromium thật (cần build + Postgres)
npm run docnum                            # số liệu tài liệu có khớp mã nguồn không

DATABASE_URL=... REDIS_URL=... \
  bash scripts/ci/smoke-dist.sh           # artifact dist/ chạy thật (cần build + Postgres + Redis)
```

## Chưa được kiểm

Nói thẳng:

- **E2E trình duyệt CÓ, nhưng KHÔNG chạy trong CI.** `.github/workflows/ci.yml`
  không có bước nào gọi `ui-smoke`, nên một thay đổi làm trắng màn hình vẫn xanh
  trên GitHub và chỉ bị bắt khi có người chạy `npm run verify` trên máy mình.
- **`ui-smoke` KHÔNG đụng tới clipboard, IME và undo/redo.** Nó gõ phím thường
  (`keyboard.type` + `Enter`); không dán, không gõ Telex, không bấm Ctrl+Z. Ba
  đường đó nay có cổng ở tầng THẤP HƠN, không phải ở E2E:
  - clipboard → `tests/gridClipboard.test.js`, đơn vị, trên 13 hàm thuần của
    `web/src/lib/clipboard.ts`; chiều DÁN trong component có bài kiểm ở tầng
    jsdom, chiều COPY/CUT (`onCopyCut`) thì **chưa**;
  - IME tiếng Việt → `web/src/lib/imeGuard.test.ts`, đơn vị, trên `dangGoIME`
    của `web/src/lib/gridShared.ts`, cộng cổng IME trong component ở tầng jsdom;
  - undo/redo (Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z) → `web/src/lib/gridUndo.test.ts`,
    đơn vị (20 ca), trên `createUndoStack`/`undoRedoKey` của
    `web/src/lib/gridUndo.ts`, cộng dây nối bàn phím thật ở tầng jsdom.
- **Undo/redo: dây nối trong component NAY có cổng, phần cần layout/ảnh thật thì
  KHÔNG.** `web/src/components/GridTable.component.test.tsx` (42 bài, 2026-08-28)
  dựng `<GridTable />` thật và đo được rằng **18 trong 19** chỗ gọi `pushUndo()`
  đều chụp ảnh TRƯỚC khi ghi vào `items`. Còn hở: `addImages`
  (`web/src/components/GridTable.tsx:1642` — `fileToImg` chờ `Image.onload`, mà
  jsdom không giải mã ảnh nên promise treo), `onCopyCut`, chọn vùng bằng chuột, và
  mọi thứ cần layout thật. `ui-smoke` cũng vẫn không bấm Ctrl+Z lần nào. Danh
  sách đầy đủ: [../REMAINING_RISKS.md](../REMAINING_RISKS.md).
- **Ba component còn lại chưa có bài kiểm mức component nào** —
  `web/src/components/ExtraTables.tsx`, `web/src/components/Shell.tsx`,
  `web/src/components/ImportExcelModal.tsx`.
- **Chưa có test hiệu năng/tải.** Số trong `docs/archive/performance/` là lịch sử.
- **Chưa có test khôi phục trong CI.** Diễn tập khôi phục chạy trên host
  production theo systemd timer, không chạy ở CI.
