# Kiểm thử

## Tháp kiểm thử của repo này

```
     ┌──────────────────────────────────┐
     │ Tích hợp (supertest + PG + MinIO)│  lái ứng dụng THẬT
     ├──────────────────────────────────┤
     │ Đơn vị (toán tiền, phân quyền,   │  thuần, chạy đâu cũng được
     │ excel, clipboard, mã hoá…)       │
     └──────────────────────────────────┘
```

Chưa có E2E trình duyệt trong CI. `playwright` có trong devDependencies nhưng
không bộ test nào dùng — xem mục "Chưa được kiểm" bên dưới.

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

csrfGuard đòi `X-CSRF-Token` cho mọi thao tác ghi bằng phiên cookie. Cả hai SPA
tự lo trong lớp bọc fetch của mình; supertest thì **đi vòng** qua lớp đó.

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
```

## Chưa được kiểm

Nói thẳng:

- **Chưa có E2E trình duyệt.** Không có test nào chạy engine lưới thật trong
  trình duyệt thật, nên clipboard, IME và undo/redo **chỉ được bảo vệ bởi test
  đơn vị** trên hàm phân tích — không phải bởi hành vi thật của trình duyệt.
- **Chưa có test hiệu năng/tải.** Số trong `docs/archive/performance/` là lịch sử.
- **Chưa có test khôi phục trong CI.** Diễn tập khôi phục chạy trên host
  production theo systemd timer, không chạy ở CI.
