# Kiểm thử

## Tháp kiểm thử của repo này

```
     ┌──────────────────────────────────┐
     │ E2E trình duyệt                  │  Chromium THẬT trên bundle ĐÃ BUILD;
     │ (Playwright · ui-smoke.mjs)      │  chạy ở `npm run verify`, KHÔNG ở CI
     ├──────────────────────────────────┤
     │ Tích hợp (supertest + PG + MinIO)│  lái ứng dụng THẬT
     ├──────────────────────────────────┤
     │ Đơn vị (toán tiền, phân quyền,   │  thuần, chạy đâu cũng được
     │ excel, clipboard, mã hoá…)       │
     └──────────────────────────────────┘
```

Ba tầng, và tầng trên cùng **có thật** — không phải kế hoạch. `playwright` nằm trong
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
động nổi không" nằm ở `scripts/ci/docker-smoke.sh` (bước `[11/13]`), chạy container
`NODE_ENV=production` thật. Hai script chia nhau hai vế.

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
bài vitest nào bắt được (web/ chạy `environment: "node"`, repo không cài jsdom), vì không bài nào nạp bundle ĐÃ BUILD qua Express thật.

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
npm run web:test                          # test đơn vị frontend
npm run smoke:ui                          # E2E Chromium thật (cần build + Postgres)
```

## Chưa được kiểm

Nói thẳng:

- **E2E trình duyệt CÓ, nhưng KHÔNG chạy trong CI.** `.github/workflows/ci.yml`
  không có bước nào gọi `ui-smoke`, nên một thay đổi làm trắng màn hình vẫn xanh
  trên GitHub và chỉ bị bắt khi có người chạy `npm run verify` trên máy mình.
- **`ui-smoke` KHÔNG đụng tới clipboard, IME và undo/redo.** Nó gõ phím thường
  (`keyboard.type` + `Enter`); không dán, không gõ Telex, không bấm Ctrl+Z. Cả ba
  đường nay đều có bài kiểm đơn vị ở tầng dưới, nhưng CHỈ trên hàm thuần:
  - clipboard → `tests/gridClipboard.test.js`, đơn vị, trên 13 hàm thuần của
    `web/src/lib/clipboard.ts`;
  - IME tiếng Việt → `web/src/lib/imeGuard.test.ts`, đơn vị, trên `dangGoIME`
    của `web/src/lib/gridShared.ts`;
  - undo/redo (Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z) → `web/src/lib/gridUndo.test.ts`,
    đơn vị (20 ca), trên `createUndoStack`/`undoRedoKey` của
    `web/src/lib/gridUndo.ts`. Có từ 2026-08-27; trước đó không có gì.
- **Undo/redo: ngăn xếp có bài kiểm, dây nối trong component thì KHÔNG.** Phần
  thuần đã tách ra `web/src/lib/gridUndo.ts` và được
  `web/src/lib/gridUndo.test.ts` phủ 20 ca (vòng lùi/tiến, ba lối phím, trần 100
  mốc, `dropMark()` khi Esc, mỗi lưới một ngăn xếp riêng). Nhưng **không bài kiểm
  nào chạy qua `web/src/components/GridTable.tsx`**: `web/` không có
  `vitest.config.*` và `web/vite.config.ts` không khai khối `test`, nên vitest
  chạy ở environment mặc định `"node"` — không có `document`, và `jsdom`/
  `happy-dom` (peer tuỳ chọn của vitest) lẫn `@testing-library/*` đều **không
  được cài**. Nên vẫn hở: 19 chỗ gọi `pushUndo()` có đặt đúng chỗ không (chụp
  TRƯỚC khi ghi vào `items`), `snap()`/`restore()`, và việc component có thật sự
  hỏi `undoRedoKey` rồi tôn trọng cờ `editable` hay không. `ui-smoke` cũng vẫn
  không bấm Ctrl+Z lần nào. Chi tiết:
  [../REMAINING_RISKS.md](../REMAINING_RISKS.md).
- **Chưa có test hiệu năng/tải.** Số trong `docs/archive/performance/` là lịch sử.
- **Chưa có test khôi phục trong CI.** Diễn tập khôi phục chạy trên host
  production theo systemd timer, không chạy ở CI.
