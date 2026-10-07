# Đường đi của dữ liệu

[ARCHITECTURE.md](ARCHITECTURE.md) trả lời "hệ thống gồm những mảnh nào".
Tài liệu này trả lời câu khác: **một byte đi từ đâu tới đâu**, qua tay ai, và ở
mỗi chặng thì cái gì có thể chặn nó lại.

Bốn đường được mô tả, vì đây là bốn đường mà mọi sự cố cho tới nay đều rơi vào:

1. [Một request thường](#1-một-request-thường-trình-duyệt--postgres) — trình duyệt → Express → service → Prisma → Postgres
2. [Đường realtime SSE](#2-đường-realtime-sse) — máy chủ đẩy ngược về trình duyệt
3. [Đường LƯU báo giá](#3-đường-lưu-báo-giá) — đường phức tạp nhất trong hệ, và là đường duy nhất có thể mất dữ liệu
4. [Đường XUẤT Excel/PDF](#4-đường-xuất-excelpdf) — hai nhánh: đồng bộ và nền

Sơ đồ vẽ bằng mermaid nằm ở [diagrams/](diagrams/). Số liệu dưới đây đọc từ mã
nguồn; đường dẫn file ghi kèm để kiểm lại được.

---

## 1. Một request thường (trình duyệt → Postgres)

### 1.1 Phía trình duyệt — trước khi gói tin rời máy

Mọi lời gọi API đi qua đúng một hàm trong `web/src/lib/api.ts`. Nó làm bốn việc
mà chỗ gọi không phải biết:

| Việc | Chi tiết | Vì sao |
|---|---|---|
| Nén thân | Thân > 256 KB **và** trình duyệt có `CompressionStream` → gzip, đặt `Content-Encoding: gzip` | Trình duyệt tự nén thân TẢI VỀ chứ không tự nén thân GỬI LÊN. Báo giá lớn là JSON vài MB |
| Gắn mã CSRF | Thao tác GHI → thêm header `X-CSRF-Token`, lấy từ `GET /api/csrf-token` và nhớ lại | Xem [ADR 0005](../adr/0005-csrf-token.md) |
| Thử lại CSRF | 403 kèm `code` là `csrf_token_missing`/`csrf_token_invalid` → xin mã mới, thử lại **đúng một lần** | Deploy làm mất phiên ẩn danh; không có bước này thì mọi người đang mở tab phải F5 |
| Báo mất phiên | 401 → phát sự kiện `auth:expired`; `App.tsx` **phủ** hộp đăng nhập lên trên, KHÔNG unmount cây component | Unmount là mất trắng báo giá đang soạn trong state của editor |

### 1.2 Chuỗi middleware — 14 chặng, thứ tự là một phần của thiết kế

Bảng đầy đủ (chặn gì · vì sao ở đúng chỗ đó) nằm ở
[ARCHITECTURE.md](ARCHITECTURE.md#chuỗi-middleware--thứ-tự-là-một-phần-của-thiết-kế).
Ở đây chỉ nhắc bốn chặng có thể **kết thúc** request trước khi nó chạm tới route:

```
helmet → compression → requestId → pino-http → rate limit → decompressBody
  → express.json → session → metrics → bearerAuth → enforceActiveUser → csrfGuard
  → ROUTES → notFound → static → SPA → errorHandler
```

* **`apiLimiter`** (rate limit) — mặc định 120 request/phút (`RATE_LIMIT_API_PER_MIN`), dùng
  kho đếm Redis khi có `REDIS_URL` để nhiều tiến trình chia chung một trần. **Từ 2026-09-08** đứng
  **trước** `decompressBody`/`express.json`, không phải sau `csrfGuard` như trước: nó khoá theo
  `req.ip`, không đọc session/body/cookie, nên an toàn để chạy sớm — và chạy sớm mới có tác dụng,
  vì hai middleware ngay sau giải nén gzip rồi `JSON.parse` tới 16 MB **đồng bộ trên event loop**;
  đứng sau chúng nghĩa là người **chưa đăng nhập** đã tiêu CPU/heap xong việc đó trước khi có bất
  kỳ trần nào chặn.
* **`decompressBody`** (`src/decompressBody.ts`) — chạy **trước** body parser vì nó thay thế luồng
  thân, và **trước** xác thực nên trần của nó ăn theo route chứ không dùng chung: nhóm
  `/api/quotes` là 16 MB, mọi đường khác 2 MB.
* **`enforceActiveUser`** (`src/middleware.ts`) — nạp lại vai trò + tập quyền +
  trạng thái khoá **từ CSDL mỗi request**. Đây là lý do admin khoá một tài khoản
  thì có hiệu lực ở request KẾ TIẾP của người đó, không phải sau khi cookie hết hạn.
* **`csrfGuard`** (`src/app.ts`) — miễn cho client Bearer JWT (trình duyệt không
  tự gắn token), nên phải đứng **sau** `bearerAuth`.

### 1.3 Route → service → Prisma

```
src/routes/*.routes.ts   phân tích tham số · validate (zod) · gọi service · trả JSON
src/services/*.ts        nghiệp vụ: transaction, phân quyền MỨC BẢN GHI, tính toán
src/*.ts                 hạ tầng dùng chung: db · storage · queue · sse · excel · pdf
```

Ranh giới này **đo được**, không phải lời hứa: `scripts/ci/check-architecture.mjs`
chạy trong `npm run verify` với bốn luật (route không chạm thẳng Prisma · service
không cầm `Response`/`NextFunction` · service không import route · không vòng
import giữa các service). Bảy khoản nợ hiện có được khai đích danh trong chính
script đó; file mới vi phạm là ĐỎ. Lý do không đổi cây thư mục cho khớp sơ đồ:
[ADR 0008](../adr/0008-khong-doi-cay-thu-muc-sang-modules.md).

Hai lớp phân quyền, và **không lớp nào thay được lớp kia**:

| Lớp | Ở đâu | Trả lời câu gì |
|---|---|---|
| Năng lực | `requirePermission(...)` ở route | "Tài khoản này được phép làm hành động này không?" |
| Phạm vi bản ghi | `canOnQuote` / `canScoped` / `quoteScopeWhereOrThrow` trong service | "Được phép làm nó **trên bản ghi cụ thể này** không?" |

Bỏ lớp thứ hai là IDOR. Ma trận đầy đủ cho cả 147 endpoint:
[ROLES_PERMISSIONS.md](../product/ROLES_PERMISSIONS.md).

### 1.4 Prisma → Postgres

`src/db.ts` bọc `PrismaClient` bằng **một** extension (`$extends`) làm ba việc
cho MỌI truy vấn:

1. **Xoá mềm** — `delete`/`deleteMany` trên 8 model (`User`, `Company`,
   `QuoteTemplate`, `Quote`, `Customer`, `Product`, `PersonnelRecord`,
   `Employee`) bị đổi thành `update` đặt `deletedAt`. Muốn xoá thật thì truyền
   cờ `hardDelete`.
2. **Lọc ngầm** — mọi `find*`/`count`/`aggregate`/`groupBy` tự thêm
   `where.deletedAt = null` (trừ khi truyền `includeDeleted`). `findUnique` bị
   đổi thành `findFirst` để gắn được filter đó.
3. **Bắn realtime** — sau mỗi lần GHI vào `Quote`/`Customer`/`User`/`QuoteListNote`
   (`RT_ENTITY`), gọi `emitChange` để client đang mở danh sách tự tải lại. Hai bảng khoản chi
   kế toán (`InputInvoiceEntry`/`InputInvoiceProof`) **cố ý không** nằm trong danh sách đó:
   extension phát ngay sau từng câu lệnh, kể cả trước commit và khi transaction rollback — nên
   dịch vụ kế toán phát tay `inputInvoice` đúng một lần SAU commit (mục 3.5).

Kết nối đi qua driver adapter `@prisma/adapter-pg` trên một `pg.Pool`
(`DB_POOL_MAX`, mặc định 20 kết nối). `connectionTimeoutMillis` được đặt bằng
`DB_TX_MAX_WAIT` — node-pg mặc định chờ **vô hạn** khi pool cạn, nghĩa là một
đợt lưu báo giá lớn đồng thời sẽ làm cả `/readyz` lẫn đăng nhập xếp hàng không
có trần thời gian.

Trần transaction là `DB_TX_TIMEOUT` (mặc định 60 giây, không phải 5 giây mặc
định của Prisma) — xem lý do ở [đường lưu báo giá](#3-đường-lưu-báo-giá).

---

## 2. Đường realtime SSE

Chọn SSE chứ không phải WebSocket: [ADR 0004](../adr/0004-sse-not-websocket.md).

### 2.1 Mở kết nối

`web/src/components/Shell.tsx` mở đúng một `EventSource` tới
`GET /api/stream/events` cho cả app, rồi dịch từng loại sự kiện thành sự kiện
`window` để các trang tự nghe:

| Sự kiện SSE | Shell làm gì |
|---|---|
| `changed` | phát `realtime:changed` → trang danh sách tự tải lại |
| `notification` | cập nhật số chưa đọc + phát `realtime:notification` |
| `presence` | phát `realtime:presence` kèm danh sách người đang mở cùng báo giá |
| `session:refresh` | gọi lại `/api/auth/me` (quyền vừa bị admin đổi) |
| `session:revoked` | đăng xuất + tải lại trang |
| `shutdown` | máy chủ đang tắt có kiểm soát; client tự nối lại |

Phía máy chủ, `attach` trong `src/sse.ts`:

* **Kiểm trần TRƯỚC khi đặt header.** `SSE_MAX_PER_USER` (mặc định 10) kết nối
  đồng thời mỗi tài khoản. Đã `flushHeaders` với `text/event-stream` rồi thì
  không còn trả 429 được nữa.
* Keepalive 25 giây một nhịp.
* **Áp lực ngược**: `res.write` trả `false` khi bộ đệm đầy. Khi
  `writableLength` vượt `SSE_MAX_BUFFER` (mặc định 1 000 000 byte) thì
  **huỷ socket**, không phải chỉ bỏ ghi. SSE là dữ liệu gợi ý làm mới màn hình —
  mất vài sự kiện thì client tự re-fetch, còn phình bộ nhớ thì kéo sập cả app.

### 2.2 Fan-out qua nhiều tiến trình

Không có `REDIS_URL` → phát cục bộ, đúng như một broker in-memory. Có
`REDIS_URL` → `publish` đẩy lên kênh `sse:events`, và **subscriber mới là nơi
giao xuống client** (kể cả trên chính tiến trình vừa publish) — nếu publish cũng
tự giao cục bộ thì client nối vào tiến trình đó nhận hai lần.

Publisher và subscriber dùng **hai bộ option khác nhau** (`backplaneOptions`):
subscriber là kết nối dài nên thử lại vô hạn; publisher thì `enableOfflineQueue:
false` + `commandTimeout` — publish của SSE là bắn-và-quên trên đường xử lý
request, xếp hàng vô hạn khi Redis chết chỉ làm phình bộ nhớ để rồi giao một sự
kiện đã lỗi thời.

### 2.3 Compression PHẢI loại trừ SSE

`src/app.ts` khai một `filter` riêng cho `compression`: `/api/stream/events` và
mọi request có `Accept: text/event-stream` đều **không** nén. Compressor gom
buffer, và triệu chứng là kinh điển — "realtime lúc được lúc không".

### 2.4 Presence

`POST /api/stream/presence` với `{ quoteId, action }` (`open`/`heartbeat`/`close`).
Trạng thái sống **trong bộ nhớ tiến trình**, không lưu CSDL. Route kiểm
`canOnQuote(read)` trước — thiếu bước đó thì bất kỳ ai đăng nhập cũng dò được
`quoteId` bất kỳ để biết ai đang sửa và tên hiển thị của họ.

---

## 3. Đường LƯU báo giá

`PUT /api/quotes/:id` → `updateQuote` trong `src/services/quoteService.ts`.
Đây là đường phức tạp nhất trong hệ và là đường **duy nhất** có thể làm mất công
việc của người khác. Mỗi bước dưới đây tồn tại vì một cách mất dữ liệu cụ thể.

### 3.1 Trước transaction

1. **Đọc rút gọn.** `QUOTE_UPDATE_STATE_SELECT` cố ý **không** kéo `images` của
   hạng mục lẫn `extraTables` của sheet — cả hai chứa base64 nặng mà đường lưu
   không đọc tới. Ảnh vẫn về đủ ở phản hồi cuối hàm.
2. **`canEdit`** (`src/quoteUtils.ts`) — mốc khoá là **đã xuất hoá đơn** (`daXuatHoaDon`: có
   `invoiceNo` ở bất kỳ sheet nào) → không ai sửa. Chưa xuất: người có `quote:send` sửa mọi trạng
   thái (kể cả `converted`/`lost`); người không có chỉ sửa `draft`/`rejected`.
3. **Khoá lạc quan lần 1.** Client gửi `baseUpdatedAt` (mốc lúc mở editor); khác
   mốc trong CSDL → 409. Client cũ không gửi → bỏ qua (tương thích ngược).
4. **Tính tiền NGOÀI transaction.** `computeQuoteTotals` chỉ đọc `sheets[].items`
   nên tính trước được, và transaction nhờ đó ngắn nhất có thể.

### 3.2 Trong transaction

```sql
SELECT id FROM "QuoteSheet" WHERE "quoteId" = $1 ORDER BY id FOR UPDATE
```

**Khoá rồi mới đọc.** Có ba đường ghi `QuoteSheet` mà KHÔNG chạm `Quote`:
ghi nhận ý kiến khách (`custStatus`), ký chứng từ (`signedAt`), nhập hoá đơn
(`invoiceNo`/`paidAt`/`poNumber`). Kế toán ghi số hoá đơn xen vào giữa lúc sale
đang bấm Lưu thì `Quote.updatedAt` **không đổi** → khoá lạc quan không thấy gì →
trạng thái mức sheet dựng từ ảnh chụp cũ → **mất số hoá đơn, ngày thanh toán và
chữ ký, im lặng, vẫn trả 200**.

`ORDER BY id` không phải trang trí: `deleteMany` khoá theo thứ tự quét vật lý
(không xác định). Thiếu câu này thì nó và `saveHn` có thể lấy khoá ngược chiều
nhau trên cùng một báo giá → deadlock 40P01 → Prisma P2034.

Ngay sau đó (từ 2026-10-06) **khoá luôn hàng `Quote`** rồi mới đọc khoản kế toán của báo giá:

```sql
SELECT "hnStatus", "hnTables" FROM "Quote" WHERE id = $1 FOR NO KEY UPDATE
-- rồi: đọc InputInvoiceEntry của báo giá (đã chi + ảnh + ngày HĐ + ghi chú — trang Hóa đơn đầu vào)
```

Thứ tự vẫn là `QuoteSheet → Quote`. Kế toán ghi khoản dưới `Quote FOR SHARE` (mục 3.5), nên từ
đây tới lúc commit không ai tích "đã chi" chen vào được — chốt "hàng đã chi không được biến mất"
bên dưới đọc bản TƯƠI. Đọc khoản TRƯỚC khi khoá `Quote` là có khe đua: kế toán tích đúng hàng
đang bị xoá, cả hai cùng thắng, và khoản thành mồ côi. Bảng HN cũng đọc tươi tại đây (không
dùng bản đọc ngoài transaction). `FOR NO KEY UPDATE` chứ không `FOR UPDATE`: vẫn xung đột với `FOR SHARE`
của kế toán và với đường Lưu khác, nhưng tương thích với `FOR KEY SHARE` mà kiểm khoá ngoại xin khi ai đó
thêm ghi chú danh sách (`QuoteListNote`) / thành viên cho CHÍNH báo giá này — `FOR UPDATE` bắt họ treo suốt
lần Lưu (vài giây với báo giá lớn; soát 2026-10-06 DT-1).

Sau khi đã giữ khoá:

| Bước | Làm gì | Chống cái gì |
|---|---|---|
| `chuanHoaRidTrung` | trên bản CSDL đọc tươi (theo thứ tự hiển thị: trang `order` → `id`): `rid` dính khoảng trắng → cắt; bản thứ 2 trở đi của `rid` TRÙNG nhận `rid` mới (bản đầu giữ — chủ của khoản kế toán); bản ở payload ghép theo THỨ TỰ với bản CSDL mà nó thay, nhận đúng `rid` của bản đó | dữ liệu cũ có hai hàng cùng `rid`: mọi luật kế thừa khoá theo `rid` nên cờ duyệt / đã chi / ảnh dời sang hàng kia hoặc rơi im, và chốt "hàng đã chi biến mất" (so tập `rid`) không thấy (soát 2026-10-06 ATDL-1/2) |
| `hangVetThieuRid` | hàng CSDL đã trả / có ảnh (cờ JSON cũ) mà THIẾU `rid` → **400** `hang-da-chi-thieu-ma`, cả lần Lưu | `sanitizeExtraTables` cấp `rid` mới SAU reconcile → lần Lưu xoá im cờ + bản ảnh duy nhất. Chữa bằng `backfillKhoanChi --sua-rid` (DISASTER_RECOVERY.md) |
| `tachRidTrung` | hàng thứ hai trở đi cùng `rid` trong một phía (`sheet` = HCM + Phí KH mọi trang · `hn`) nhận `rid` mới; hàng đầu giữ | hai hàng tranh một khoản kế toán |
| `reconcileExtraApprovals` | không có `quote:internal:approve` → lấy lại cờ duyệt từ CSDL theo `rid` | tự đóng dấu duyệt cho hàng của chính mình |
| `reconcileExtraPayments` | bốn cờ cũ `paid`/`paidAt`/`paidById`/`paidProof` trong JSON hàng **đóng băng**: luôn chép lại từ CSDL theo `rid`, cho MỌI người (zod cũng đã cắt); hàng mới / bản sao `rid` luôn chưa chi · đổi số lượng / đơn giá / số ngày của hàng ĐÃ CHI (trạng thái hiệu lực: khoản thắng cờ JSON) mà không có `invoice:input:pay` → 400 | tự đánh dấu đã chi, tự nhét ảnh chứng từ, chép `rid` của hàng đã chi sang hàng bịa 50 triệu |
| `carrySheetState` | bê trạng thái mức sheet sang bản mới | Lưu = XOÁ sheet + TẠO LẠI; không bê là mất sạch mỗi lần bấm Lưu |
| `hangDaChiBiMat` | hàng ĐÃ CHI có ở bản CSDL mà vắng ở payload → **400** `hang-da-chi` nêu tên. So TẬP `rid` của cả phía, nên chuyển bảng / "Chuyển loại" / chuyển trang vẫn hợp lệ | xoá hàng / bảng / trang có tiền đã chi; client cũ gửi `extraTables: []` |
| `hnTablesDeGhi` (payload có `hnTables`) | trên bản `Quote.hnTables` đọc TƯƠI (Quote đã khoá): `chotHnTables` — phần HN đã gửi duyệt / đã duyệt mà khác CSDL → 409, trừ người có `quote:hn:manage`; rồi tách `rid` trùng, đóng băng cờ đã chi, `reconcileHnApprovals`, chốt hàng đã chi như trên | quản lý lưu đè lên giá Hà Nội đã duyệt; reconcile trên bản đọc NGOÀI transaction (một lần ghi HN chen giữa bị đè bằng cờ cũ) |
| ghi tăng dần (tuỳ chọn) | `INCREMENTAL_QUOTE_SAVE` bật → trang **không đổi một byte** thì giữ nguyên, không xoá-tạo-lại | số đo ở [QUOTE_SAVE_PERFORMANCE.md](QUOTE_SAVE_PERFORMANCE.md) |
| `chotKhoaLacQuan` | `UPDATE "Quote" SET "updatedAt"="updatedAt" WHERE id=$1 AND "updatedAt"=$2` | hai người bấm Lưu chồng nhau: lần kiểm NGOÀI transaction lọt cả hai |
| `tx.quote.update(... sheets.create)` | ghi bản mới | |
| `snapshotQuoteVersion` | chụp `QuoteVersion` | lịch sử phiên bản + diff |

Các chốt "hàng đã chi" ném **400** chứ không 409: 409 ở màn soạn mở hộp "người khác vừa lưu" và
gợi ý tải lại (mất phần chưa lưu), còn 400 chỉ toast và **giữ** phần đang soạn — xoá DÒNG thì
Ctrl+Z cứu được; xoá bảng / trang có hàng đã chi thì trình duyệt chặn ngay từ đầu (cờ `paid` của
lớp phủ khoản kế toán). Cùng luật áp ở `ghiVungNoiBoDuocGiao` (account phụ không có vùng `main`),
`saveHn` (mục 3.4) và `deleteQuote` (báo giá có khoản đã chi — xét MỌI bản của `rid` trùng và cả hàng
thiếu `rid` — → 400 `bao-gia-co-khoan-da-chi`; đọc lại trạng thái, kiểm và xoá mềm trong CÙNG transaction
dưới `Quote FOR NO KEY UPDATE`).

Câu chốt khoá lạc quan dùng `$executeRaw` chứ **không** dùng
`tx.quote.updateMany`: extension realtime coi `updateMany` là WRITE nên mỗi lần
Lưu sẽ bắn hai sự kiện SSE thay vì một — và tệ hơn, khi guard ném 409 thì
transaction rollback nhưng sự kiện đã bắn rồi, tức một lần Lưu **thất bại** vẫn
bắt mọi client đang mở danh sách tải lại.

### 3.3 Vì sao trần transaction là 60 giây

Cả gói việc trên nằm trong **một** transaction: xoá sạch sheet → tạo lại toàn bộ
item → đọc lại qua `QUOTE_INCLUDE` → snapshot phiên bản. Trần payload cho phép
60 trang × 1000 dòng, nên báo giá lớn chạm mốc 5 giây mặc định của Prisma là
rollback — người dùng mất trắng lần sửa. Nới trần là **giảm nhẹ**; thu nhỏ
transaction mới là chữa gốc.

`DB_TX_TIMEOUT` đi qua `src/config.ts` chứ không đọc thẳng `process.env` vì đơn
vị là **mili-giây** và rất dễ bị hiểu thành giây: đặt nhầm thành 5 sẽ làm mọi
lần Lưu chết P2028 trong khi tiến trình vẫn khởi động bình thường.

### 3.4 Nhánh riêng: Account Hà Nội

`PUT /api/quotes/:id/hn` → `saveHn` trong `src/hnWorkflow.ts`. Từ 2026-09-15 nó
chỉ ghi **một cột**: `Quote.hnTables` (cấp báo giá). Nó **không** còn đụng
`QuoteSheet` nào — đó là điểm khác quan trọng nhất so với bản trước, vốn ghi
`extraTables` loại `"hanoi"` của từng trang.

Khoá: chỉ `SELECT id FROM "Quote" … FOR UPDATE`, và **không** lấy khoá
`QuoteSheet` sau đó. Mọi đường ghi khác lấy khoá theo thứ tự `QuoteSheet → Quote`
(`updateQuote`, `ghiVungNoiBoDuocGiao`), còn dịch vụ kế toán chỉ xin `Quote FOR SHARE` và
không bao giờ khoá `QuoteSheet` (mục 3.5) — nên lấy ngược chiều là deadlock. Sau khi giữ khoá,
`saveHn` mới đọc khoản kế toán của báo giá, chuẩn hoá `rid` trùng (`chuanHoaRidTrung`, như mục 3.2), từ
chối hàng đã trả thiếu `rid` (400 `hang-da-chi-thieu-ma`), đóng băng cờ đã chi (không còn nhánh "ai có quyền
thanh toán thì được đổi cờ") và chặn làm mất hàng ĐÃ CHI (400 `hang-da-chi`).
Dùng `$queryRaw` chứ không `updateMany`: extension realtime ở `src/db.ts` coi
`updateMany` là WRITE nên bắn thêm một sự kiện SSE, mà SSE đã bắn thì rollback
không rút lại được.

**Khoá lạc quan chốt theo `hnRev`, không theo `Quote.updatedAt`.** `hnRev` là
băm của vân tay bảng Hà Nội (`quoteUtils.vanTayHn` → `hnRevCua`) và cố ý bỏ qua
`paidProof` / `rid` / `paid*` / `approved*` — những trường server sở hữu hoặc
sinh lại mỗi lần sanitize, nếu tính vào thì so bản CSDL với chính nó cũng ra
khác. Client nhận `hnRev` ở `GET` rồi gửi trả nguyên văn qua `baseHnRev`.
Vì sao không dùng `updatedAt`: nó đổi mỗi lần **chủ báo giá** lưu bất cứ thứ gì,
mà màn account HN **không có bản nháp cục bộ** — một lần 409 oan là mất trắng.
Tab mở trước lần deploy này chỉ gửi `baseUpdatedAt`; đường đó vẫn được tôn trọng
khi thiếu `baseHnRev`.

Chi tiết vòng đời và ai làm được gì: [QUOTE_WORKFLOW.md](../product/QUOTE_WORKFLOW.md).

### 3.5 Ghi khoản chi kế toán — KHÔNG phải đường Lưu báo giá

`PUT /api/quotes/input-invoices/:quoteId/:side/:rid` → `ghiKhoanChi` trong
`src/services/inputInvoiceService.ts` (trang Hóa đơn đầu vào, từ 2026-10-06). Kế toán tích "đã chi"
+ ảnh chứng từ, ghi ngày HĐ + ghi chú cho MỘT hàng bảng nội bộ. Dữ liệu ở bảng riêng
`InputInvoiceEntry` / `InputInvoiceProof` — vì sao bảng riêng: [diagrams/data-model.md](diagrams/data-model.md).

```
quyền theo TỪNG TRƯỜNG (invoice:input:pay · invoice:edit) → thiếu là 403, chưa đụng CSDL
soát ảnh (regex + giải base64 + magic bytes + sha256) TRƯỚC transaction — không giữ khoá lúc làm việc CPU
BEGIN
  SELECT … FROM "Quote" WHERE id = $q FOR SHARE        ← SQL thô: không qua extension, không phát SSE, không bump
  đọc hàng của phía bằng SQL đã cắt ảnh → tìm theo rid (0 → mồ côi / 404 · >1 → 409 hang-trung-ma)
  chưa có khoản → INSERT … ON CONFLICT DO NOTHING (gieo từ cờ JSON cũ nếu có)
  SELECT … FROM "InputInvoiceEntry" … FOR UPDATE      ← hai kế toán cùng khoản xếp hàng ở đây
  version ≠ baseVersion → 409 khoan-chi-da-doi
  áp thay đổi · ảnh mới INSERT, ảnh cũ chỉ đặt retiredAt · version + 1
COMMIT
emitChange("inputInvoice") đúng một lần · audit quote.internal.pay / unpay / ke-toan (không chép ảnh)
```

Không ghi `Quote` hay `QuoteSheet`: `Quote.updatedAt` (mốc khoá lạc quan của màn soạn) không đổi nên
người đang soạn báo giá không ăn 409; không sinh `QuoteVersion`.

**Thứ tự khoá (KT-5)** là thứ làm hai đường này không bao giờ deadlock và không bao giờ mất khoản:

| Đường | Thứ tự |
|---|---|
| Lưu báo giá (`updateQuote`, `ghiVungNoiBoDuocGiao`) | `QuoteSheet` FOR UPDATE → `Quote` FOR NO KEY UPDATE → **rồi mới** đọc khoản |
| `saveHn` · `deleteQuote` | `Quote` FOR UPDATE · `Quote` FOR NO KEY UPDATE → rồi mới đọc khoản |
| Dịch vụ kế toán, công cụ `backfillKhoanChi` (`--ghi`, `--xac-nhan`) | `Quote` FOR SHARE → đọc hàng → khoản FOR UPDATE; **không bao giờ** khoá `QuoteSheet` |
| `backfillKhoanChi --sua-rid` (ghi trường `rid` của JSON hàng) | như đường Lưu: `QuoteSheet` FOR UPDATE → `Quote` FOR NO KEY UPDATE |

`FOR SHARE` không chặn kế toán khác (tương thích nhau) nhưng xung đột với `FOR UPDATE` / `FOR NO KEY UPDATE` của đường Lưu:
Lưu đang giữ `Quote` thì kế toán chờ rồi đọc bản đã commit (hàng vừa bị xoá → 404, không tạo khoản);
kế toán đang giữ thì Lưu chờ rồi đọc thấy khoản vừa tích (xoá đúng hàng đó → 400). Đường Lưu chỉ ĐỌC
hai bảng, nên quên thứ tự này ở một đường Lưu viết mới thì có khe đua — vẫn không mất bằng chứng (đường
Lưu không ghi bảng) nhưng hàng đã chi có thể biến khỏi báo giá. Chốt bằng `tests/hddv-dong-thoi.test.js`.

**Đọc:** `GET /input-invoices` hợp các hàng đủ điều kiện với các hàng đã có dữ liệu kế toán mà nay "Cần
chú ý"; mọi phản hồi báo giá đầy đủ (`GET /:id`, `PUT /:id`, luồng HN…) và danh sách của tài khoản chi
phí đi qua **lớp phủ** (`phuKeToan`) — hàng có khoản mang `paid` / `paidAt` / `paidById` /
`hasPaidProof` theo khoản, hàng chưa có khoản giữ cờ JSON cũ (luật duy nhất: `trangThaiHieuLuc`,
`src/khoanChi.ts`). Không phản hồi nào mang ảnh — ảnh chỉ ra qua `GET …/proof`.

---

## 4. Đường XUẤT Excel/PDF

Hai nhánh, **cùng một bộ kiểm quyền**, khác nhau ở chỗ sinh file.

### 4.1 Nhánh đồng bộ — `GET /api/export/:id.xlsx` · `.pdf`

```
requireAuth
  → requirePermission(quote:export)      ← năng lực, KHÔNG suy ra từ quyền đọc
  → createLimiter("export", 30/phút)
  → canOnQuote(read, quote)               ← chống IDOR
  → exportTooBig?  > 100 trang HOẶC > 20 000 dòng → 413, mời sang đường nền
  → runExportJob(...)                     ← cổng đồng thời + worker thread
  → buildQuoteBuffer / renderQuotePdf
  → res.end(buf) + Cache-Control: no-store, private
  → audit("quote.export")
```

`requirePermission(quote:export)` đứng riêng vì `account_hn` **có**
`quote:read:own` (do là thành viên báo giá được giao) — thiếu cổng này thì tài
khoản chỉ được thấy bảng Hà Nội lại tải về được toàn bộ bảng giá.

`Cache-Control: no-store, private` cũng không phải thừa: Cloudflare cache theo
đuôi `.xlsx`, và file này là bản của riêng một người.

**Cổng đồng thời** (`src/exportQueue.ts`): `EXPORT_MAX_ACTIVE` (mặc định 3) việc
chạy cùng lúc, `EXPORT_MAX_PENDING` (mặc định 20) chỗ xếp hàng, quá thì 503 kèm
`Retry-After` — "máy chủ hết công suất", không phải 429 "bạn gửi quá nhiều".
Việc sinh file chạy trong `worker_threads` với trần `EXPORT_GEN_TIMEOUT_MS`
(mặc định 30 giây); đường nội tuyến chỉ là dự phòng khi không dựng được worker.

Có **hai tín hiệu huỷ**: `res` phát `close` (khách đóng tab) và hạn chót 60 giây
(`EXPORT_REQUEST_DEADLINE_MS`) cho socket chết mà không gửi FIN — chuyện thường
qua tunnel/NAT. Không có chốt thứ hai thì một suất trong trần 3 bị giữ vô thời hạn.

**Sinh file Excel** (`src/excel.ts`): mỗi sheet được đổ dữ liệu vào **đúng file
mẫu của công ty** (`templates/*.xlsx`, đọc một lần rồi cache bytes), rồi
`stitchXlsxBuffers` (`src/xlsxStitcher.ts`) ghép ở mức OOXML/zip. Ghép ở mức zip
chứ không chép ô-qua-ô vì chép ô làm mất phông, theme, viền, ô gộp, neo ảnh —
tức mất đúng thứ khiến file trông như file của công ty.

**Bảng nội bộ không bao giờ vào Excel** — không phải nhờ một bộ lọc, mà vì
`src/excel.ts` chỉ đọc `sheet.items`; `extraTables` không hề xuất hiện trong file
đó. Đây là ràng buộc nghiệp vụ cứng nhất của hệ (chi phí HCM, giá Hà Nội, phí
khách hàng không được lọt ra ngoài).

### 4.2 Nhánh nền — `POST /api/quotes/:id/export`

```
requireAuth → limiter 10/phút → canOnQuote(read) → requirePermission(quote:export)
  → hàng đợi BullMQ có sẵn?   không → 503 code=export_async_unavailable
  → kho object có sẵn?        không → 503 cùng code
  → q.add(..., deduplication)
  → 202 { jobId, queue, format }
```

Client poll `GET /api/jobs/export/:id`. Chỉ **hàng đợi export** được poll: các
hàng đợi khác (email/webhook/telegram) mang địa chỉ người nhận, URL đích và bí
mật trong `job.data`. Và chỉ người đã tạo job (hoặc người có `quote:read:all`)
đọc được kết quả — `returnvalue` chứa URL tải đã ký.

**Khoá gộp có `updatedAt` trong đó.** BullMQ giữ job đã xong tới 6 giờ, và TTL
của khoá `deduplication` không tự hết hiệu lực khi job kết thúc. Không đưa mốc
sửa đổi vào khoá thì trong 30 giây sau khi xuất xong, một lượt xuất lại **hợp lệ**
(người dùng vừa sửa báo giá) bị gộp vào job cũ và nhận về **đúng file cũ**.

Worker (`src/worker.ts`) sinh file, `putObject` lên kho S3 với khoá
`exports/<số báo giá>-<mốc>.<đuôi>`, rồi trả về URL `presignDownload` hạn 24
giờ. **Không** nhồi file vào giá trị trả về của job: một file 5 MB thành ~6,7 MB
base64, và nơi giữ giá trị đó là Redis.

Hai đường có **hai bộ trần khác nhau**, và đó là cố ý:

| | trang | dòng |
|---|---|---|
| đồng bộ (`MAX_EXPORT_SHEETS` / `MAX_EXPORT_ITEMS`) | 100 | 20 000 |
| nền (`MAX_SAVE_SHEETS` / `MAX_ASYNC_EXPORT_ITEMS`) | 60 | 60 000 |
| LƯU (`MAX_SAVE_SHEETS` × `MAX_SAVE_ITEMS_PER_SHEET`) | 60 | 60 000 |

Trần **dòng** của đường nền bằng đúng trần LƯU để không tồn tại báo giá nào
**lưu được mà không xuất được** — đó là ngõ cụt mà người dùng không tự thoát ra
được. Trần **trang** thì đường nền hẹp hơn vì nó ăn theo trần lưu.

---

## Cái tài liệu này KHÔNG mô tả

* Đường nhập Excel (`POST /api/quotes/import-excel`) — xem lập luận "vì sao
  không đẩy qua BullMQ" ở [TECHNOLOGY_DECISIONS.md](TECHNOLOGY_DECISIONS.md).
* Đường tải tệp lên (`/api/files`: `sign-upload` → PUT thẳng S3 → `finalize`) —
  mô hình hai khoá `stagingKey`/`key` được giải thích ngay trong
  `prisma/schema.prisma` ở model `UploadObject`.
* Đường xác thực (đăng nhập, MFA, refresh token, thu hồi phiên) —
  [SECURITY_MODEL.md](SECURITY_MODEL.md).
