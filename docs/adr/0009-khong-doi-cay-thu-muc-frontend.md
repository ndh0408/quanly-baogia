# ADR 0009 — Không đổi cây thư mục `web/src` sang `features/`, và nói rõ vì sao

**Trạng thái:** đã chốt · 2026-08-27
**Liên quan:** [ADR 0008 — không đổi cây thư mục backend](0008-khong-doi-cay-thu-muc-sang-modules.md) ·
[ADR 0006 — gỡ SPA vanilla cũ](0006-go-spa-vanilla-cu.md)

## Bối cảnh

§24 của quy ước dự án phác một cây thư mục cho frontend:

```text
web/src/app/  web/src/features/{auth,quotes,projects,hr,accounting}/
web/src/components/ui/  web/src/hooks/  web/src/types/
web/src/lib/api/  web/src/lib/utils/
```

Cây thật phẳng hơn hẳn: `web/src/components/` · `web/src/lib/` · `web/src/pages/`,
cộng ba file ở gốc (`App.tsx`, `main.tsx`, `bench.tsx`).

Backend đã có [ADR 0008](0008-khong-doi-cay-thu-muc-sang-modules.md) trả lời câu
tương tự cho §2. Frontend thì **không có ADR nào** — tức là im lặng. Im lặng
không phải một quyết định hoãn có lý do; nó chỉ là một khoảng trống mà lần rà
soát sau sẽ lại phải đặt lại từ đầu. Tài liệu này lấp khoảng đó, bằng đúng bộ
câu hỏi của §19 và bằng số đo, không bằng khẩu vị.

## Số đo — đo lại được bất cứ lúc nào

Chốt ngày 2026-08-27 trên nhánh `fix/hoan-thien-28-muc`:

```bash
find web/src -type f \( -name '*.ts' -o -name '*.tsx' \) | wc -l       # tổng
ls web/src/pages | grep -v '\.test\.' | wc -l                          # trang
grep -rn 'from "\./\|from "\.\./' web/src --include=*.ts --include=*.tsx | wc -l
grep -rn 'web/src/' --include=*.md --include=*.mjs --include=*.js --include=*.ts . \
  | grep -v node_modules | grep -v '^./web/src' | wc -l
```

| Số đo | Giá trị |
|---|---|
| Tổng file `.ts`/`.tsx` trong `web/src` | **65** (44 không phải test + 21 test) |
| `pages/` | 17 trang + 1 test |
| `components/` | 5 component + 2 test |
| `lib/` | 19 module + 18 test |
| Gốc `web/src/` | `App.tsx` · `main.tsx` · `bench.tsx` |
| Dòng `import` trong `web/src` | 233, trong đó **162 là đường dẫn tương đối** (108 dòng dùng `../`) |
| Bí danh đường dẫn (`paths` trong tsconfig, `resolve.alias` của Vite) | **không có cái nào** |
| Nhắc `web/src/...` từ NGOÀI `web/src` | **123** chỗ (tài liệu, chú thích trong `src/`, tests, `eslint.config.js`, `lint-staged.config.mjs`, `scripts/ci/ui-smoke.mjs`) |
| Commit từng đụng `web/src` | 53 |

Fan-in của từng module `lib/` (bao nhiêu file không-test import nó):

| Module | Nơi dùng | | Module | Nơi dùng |
|---|---|---|---|---|
| `ui` | 21 | | `venueCatalog` | 3 |
| `api` | 21 | | `fields`, `exportQuote`, `pendingQuote` | 2 mỗi cái |
| `format` | 15 | | 9 module còn lại | 1 mỗi cái |
| `gridShared` | 7 | | | |
| `quoteMath` | 6 | | | |
| `query` | 5 | | | |

Đây là con số quyết định, và nó nói ngược lại trực giác "chia theo miền":
**7/19 module `lib/` được dùng chéo miền** (`ui` và `api` gần như mọi file đều
cần). Còn 9 module fan-in bằng 1 thì **5 trong số đó** (`clipboard`, `formula`,
`gridSelect`, `gridUndo`, `rowEdit`) cùng chỉ được dùng bởi **một** file:
`components/GridTable.tsx`.

Nghĩa là cây `features/` sẽ ra thế này: một `shared/` chứa `ui` + `api` +
`format` + `query` + `gridShared` + `quoteMath`, một thư mục con quanh
`GridTable`, và vài file lẻ. Đó không phải chia theo miền — đó là đổi tên
`lib/` thành `shared/` rồi thêm một tầng thư mục.

## Bảy câu của Phụ lục §19

| câu | trả lời |
|---|---|
| **Why?** | Cho khớp sơ đồ trong §24. Không có yêu cầu nghiệp vụ hay vận hành nào đứng sau. |
| **Vấn đề ĐO ĐƯỢC nào đang tồn tại?** | **Không có.** Không sự cố nào trong 53 commit đụng `web/src` truy về "sai chỗ đặt file". Các lỗi thật ở frontend là lỗi **hành vi** — IME tiếng Việt nhảy ô, 401 xoá trắng báo giá đang soạn, bundle giao cho người dùng là bản DEV của React, proxy trả HTML bị nuốt lỗi. Không lỗi nào trong số đó bị thư mục gây ra, và không lỗi nào được thư mục ngăn. |
| **Vì sao cấu trúc hiện tại không giải quyết được?** | Nó đang giải quyết. 17 trang phẳng với tên tự mô tả (`QuoteEditor`, `Invoices`, `Personnel`) tìm bằng mắt hết trong một màn hình. Cái thật sự thiếu là **cổng kiểm ranh giới cho frontend** — và cổng đó không cần đổi cây thư mục, y như kết luận của ADR 0008 ở backend. |
| **Chi phí migration** | **162 dòng import tương đối** phải viết lại (không có bí danh đường dẫn nào để hấp thụ thay đổi), **21 file test đặt cạnh mã** đi theo, **123 tham chiếu `web/src/...` từ bên ngoài** — trong đó có `scripts/ci/ui-smoke.mjs` và chú thích ở chính `src/` backend — và `git log --follow` gãy ở chỗ đổi tên trên 53 commit lịch sử. Một diff khổng lồ **không đổi một hành vi nào**, tức không bài test nào chứng minh được nó đúng; chỉ có "xanh" chứng minh nó chưa sai. |
| **Chi phí vận hành** | Frontend này **không có cổng kiểm cấu trúc nào** (`scripts/ci/check-architecture.mjs` chỉ soi `src/routes` và `src/services`). Nghĩa là sau khi đổi cây, không có gì giữ cho nó đúng — ba tháng sau lại có một `lib/` mọc ra bên trong một `features/`, và ta quay về đúng chỗ cũ nhưng sâu hơn hai tầng. |
| **Đường lùi** | Revert một commit khổng lồ — về lý thuyết được, thực tế là xung đột với mọi nhánh đang mở. |
| **Lợi ích mong đợi** | Trực quan hơn cho người mới, và gom được mã theo miền. **Thật, nhưng nhỏ ở quy mô này**: 44 file không phải test, một lập trình viên, không có hai đội chạm cùng lúc. |

Sáu trên bảy câu ra kết quả xấu hoặc rỗng. §19 nói rõ trường hợp này:
**DO NOT MIGRATE.**

## Một chi tiết riêng của frontend mà §24 không lường

§24 liệt kê `features/auth`. Nhưng **không có file nào tên `Login`** trong
`web/src/pages`: `Login` và `OnboardPage` là hai hàm **bên trong** `App.tsx`,
cùng file với `ErrorBoundary` và với logic lớp phủ đăng nhập lại khi mất phiên
giữa chừng.

Tách chúng ra thành `features/auth` **không phải** một thao tác di chuyển file —
nó là tách một component đang chia sẻ state (`me`, `matPhien`, `preview`) với
phần còn lại của `App`. Tức là đổi **hành vi**, ở đúng đoạn mã mà một lỗi đã
từng làm **mất trắng báo giá đang soạn**: trước đây mọi 401 gọi `setMe(null)`,
mà ngay dưới có `if (!me) return <Login/>` — nghĩa là cả cây component bị gỡ,
kéo theo state của trình soạn. Bản vá là **giữ cây đang mount và phủ hộp đăng
nhập lên trên**; khối chú thích dài giải thích nó nằm ngay trong `App.tsx`.

Đó là ví dụ điển hình của thứ ADR 0008 gọi tên: sơ đồ được vẽ theo hình dung về
ứng dụng, không theo mã ứng dụng.

## Ranh giới THẬT của frontend này khác với backend

Backend có ranh giới **ngang** rõ ràng (`routes → services → Prisma`), và ADR
0008 khoá nó bằng bốn luật đo được. Frontend thì ranh giới thật là:

```
main.tsx → App.tsx → components/Shell.tsx → pages/* → lib/*
```

`Shell.tsx` **chính là router**: nó import tĩnh 13 trang và `lazy()` 4 trang nặng
(`QuoteEditor`, `NewQuoteWizard`, `AccountHnView`, `InternalQuoteView`). Nghĩa là
luật "component không được import page" — luật đầu tiên ai cũng nghĩ tới — sẽ
**sai ngay từ dòng đầu**, vì ở đây component→page là **thiết kế**, không phải rò rỉ.

Luật đo được thật sự cho cây này, nếu sau này ai muốn viết cổng kiểm, là hai
luật khác — và **cả hai đều phải kèm ngoại lệ, vì mã thật không sạch như luật**:

* **`lib/*` (mã sản phẩm) không import `pages/*` hay `components/*`.** Đo hôm
  nay: **đúng**. Đường import lên trên duy nhất trong mã sản phẩm của `lib/` là
  `lib/quoteMath.ts` re-export `shared/quote-math.ts` — gói dùng chung giữa
  backend và frontend, nằm **ngoài** `web/src`, nên không phải vi phạm tầng.
  ⚠️ Nhưng **file test trong `lib/` thì import ngược lên thoải mái**: năm bài
  test của `GridTable`/`ExtraTables` (`b6-gridMemo`, `gridPaintIndex`,
  `imgSrcGuard`, `b6-formulaRefPaint`, `b6-hnTableRemove`) sống trong `lib/` chứ
  không nằm cạnh component chúng kiểm. Cổng nào cũng phải loại trừ `*.test.*`,
  nếu không nó đỏ ngay ngày đầu.
* **`pages/*` không import lẫn nhau.** Đo hôm nay: **gần đúng, có đúng MỘT ngoại
  lệ** — `pages/Personnel.tsx` import `EMP_FIELDS` từ `pages/Employees.tsx`.

Ngoại lệ đó đáng nói riêng, vì nó là **lập luận mạnh nhất mà đề xuất §24 có**:
hai trang đó cùng miền nhân sự, và trong cây `features/hr/` chúng sẽ nằm cạnh
nhau một cách tự nhiên. Nhưng quy mô của lập luận đó là **một dòng import**. Đổi
162 dòng import để làm cho một dòng trông hợp lý hơn là một cuộc mua bán tồi.

ADR này **không** tạo ra cổng kiểm nào, và nói thẳng như vậy thay vì giả vờ đã
có: hai luật trên hiện chỉ là dữ kiện đo được một lần, không phải bất biến được
canh gác. Viết cổng là một quyết định riêng, rẻ hơn nhiều so với đổi cây thư mục,
và có thể làm bất cứ lúc nào **mà không cần** đụng tới cấu trúc.

## Quyết định

1. **Giữ nguyên cây `web/src`**: `components/` · `lib/` · `pages/` + ba file gốc.
2. **Không thêm bí danh đường dẫn** (`@/…`) chỉ để làm cho việc di chuyển file
   sau này rẻ hơn. Đó là trả chi phí hôm nay cho một thay đổi đã quyết là không làm.
3. **Tách file khi FILE quá lớn, không phải khi thư mục quá phẳng.** Tiêu chí là
   kích thước và số trách nhiệm của một file, không phải hình dạng của cây. Ví
   dụ đang có thật: `components/GridTable.tsx` là **1 884 dòng** — lớn gấp hơn
   hai lần file kế tiếp — và cách xử lý đúng là bóc từng mảnh thuần tuý ra
   `lib/` (đã làm với `clipboard`, `formula`, `rowEdit`, `gridSelect`,
   `gridUndo`), mỗi mảnh kèm test riêng. Việc đó **không cần** `features/`.
4. **Ghi lại điều kiện LẬT quyết định** — xem mục cuối.

## Hệ quả

* §24 **không được đáp ứng theo mặt chữ**, và tài liệu này là nơi ghi lại vì sao.
  Lần rà soát sau đọc cái này thay vì đặt lại câu hỏi từ đầu.
* Frontend **vẫn không có cổng kiểm ranh giới**, và ADR này khai điều đó ra chứ
  không lấp liếm. Hai luật ở mục trên (kèm ngoại lệ đã đo) là bản mô tả sẵn cho
  ai muốn viết cổng — đó là việc rẻ và độc lập với quyết định này.
* Việc tách `GridTable.tsx` tiếp tục theo hướng "bóc logic thuần ra `lib/` kèm
  test", không theo hướng "dựng `features/quotes/`".

## Cái KHÔNG thay đổi

* **Chỉ có MỘT frontend**: `web/src` ([ADR 0006](0006-go-spa-vanilla-cu.md)).
* Test đặt **cạnh** mã (`foo.ts` + `foo.test.ts`), chạy bằng vitest của app web.
* Vite băm nội dung vào tên file asset, nên không có `?v=` gõ tay.

## Đường lùi

Quyết định này **không tạo ra trạng thái nào**: nó không đổi một dòng mã, không
thêm một cổng kiểm, không đụng cấu hình build. Lùi = xoá file này.

Lùi theo hướng NGƯỢC LẠI (thật sự đổi sang `features/`) thì đọc lại bảng bảy câu
trước, đặc biệt cột "vấn đề ĐO ĐƯỢC nào đang tồn tại". Ba dấu hiệu sẽ làm cột đó
hết rỗng, và khi có **bất kỳ** dấu hiệu nào thì nên lật:

1. **Nhiều người chạm `web/src` cùng lúc** và conflict tập trung vào vài file lớn
   (`Shell.tsx`, `GridTable.tsx`) — lúc đó ranh giới dọc mua được thứ thật.
2. **Một miền cần tách ra khỏi ứng dụng** (ví dụ trang Hoá đơn thành app riêng
   cho kế toán) — lúc đó `features/accounting` là bước chuẩn bị, không phải trang trí.
3. **Số trang vượt xa mức nhìn hết trong một màn hình** — 17 thì còn được; gấp
   ba lần thì lập luận "tên tự mô tả là đủ" hết đúng.

Khi lật, làm **từng miền một** và bắt đầu bằng miền có ít import chéo nhất
(đo lại bằng lệnh ở mục "Số đo"), đừng đổi cả cây trong một commit.
