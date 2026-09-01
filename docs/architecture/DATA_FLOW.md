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
helmet → compression → requestId → pino-http → decompressBody → express.json
  → session → metrics → bearerAuth → enforceActiveUser → csrfGuard → rate limit
  → ROUTES → notFound → static → SPA → errorHandler
```

* **`decompressBody`** (`src/decompressBody.ts`) — chạy **trước** xác thực, nên
  trần của nó ăn theo route chứ không dùng chung: nhóm `/api/quotes` là 16 MB,
  mọi đường khác 2 MB. Dùng chung 16 MB nghĩa là người **chưa đăng nhập** bơm
  được 16 MB vào bất kỳ endpoint nào.
* **`enforceActiveUser`** (`src/middleware.ts`) — nạp lại vai trò + tập quyền +
  trạng thái khoá **từ CSDL mỗi request**. Đây là lý do admin khoá một tài khoản
  thì có hiệu lực ở request KẾ TIẾP của người đó, không phải sau khi cookie hết hạn.
* **`csrfGuard`** (`src/app.ts`) — miễn cho client Bearer JWT (trình duyệt không
  tự gắn token), nên phải đứng **sau** `bearerAuth`.
* **`apiLimiter`** — mặc định 120 request/phút (`RATE_LIMIT_API_PER_MIN`), dùng
  kho đếm Redis khi có `REDIS_URL` để nhiều tiến trình chia chung một trần.

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

Bỏ lớp thứ hai là IDOR. Ma trận đầy đủ cho cả 138 endpoint:
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
3. **Bắn realtime** — sau mỗi lần GHI vào `Quote`/`Customer`/`User`, gọi
   `emitChange` để client đang mở danh sách tự tải lại.

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
2. **`canEdit`** (`src/quoteUtils.ts`) — `converted`/`lost` là **bất biến**,
   không ai sửa được. Người không có `quote:send` chỉ sửa được `draft`/`rejected`.
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

Sau khi đã giữ khoá:

| Bước | Làm gì | Chống cái gì |
|---|---|---|
| `reconcileExtraApprovals` | không có `quote:internal:approve` → lấy lại cờ duyệt từ CSDL theo `rid` | tự đóng dấu duyệt cho hàng của chính mình |
| `reconcileExtraPayments` | không có `quote:internal:pay` → lấy lại `paid`/`paidAt`/`paidById`/`paidProof` | tự đánh dấu đã thanh toán, tự nhét ảnh chứng từ |
| `carrySheetState` | bê trạng thái mức sheet sang bản mới | Lưu = XOÁ sheet + TẠO LẠI; không bê là mất sạch mỗi lần bấm Lưu |
| `reconcileHanoiTables` | không có `quote:hn:manage` → lấy lại bảng "hanoi" đã chốt | quản lý lưu đè lên giá Hà Nội đã duyệt |
| ghi tăng dần (tuỳ chọn) | `INCREMENTAL_QUOTE_SAVE` bật → trang **không đổi một byte** thì giữ nguyên, không xoá-tạo-lại | số đo ở [QUOTE_SAVE_PERFORMANCE.md](QUOTE_SAVE_PERFORMANCE.md) |
| `chotKhoaLacQuan` | `UPDATE "Quote" SET "updatedAt"="updatedAt" WHERE id=$1 AND "updatedAt"=$2` | hai người bấm Lưu chồng nhau: lần kiểm NGOÀI transaction lọt cả hai |
| `tx.quote.update(... sheets.create)` | ghi bản mới | |
| `snapshotQuoteVersion` | chụp `QuoteVersion` | lịch sử phiên bản + diff |

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

`PUT /api/quotes/:id/hn` → `saveHn` trong `src/hnWorkflow.ts`. Chỉ ghi bảng
`extraTables` loại `"hanoi"` của từng sheet, chép nguyên phần `hcm`/`khach`.
Lấy **cùng** khoá `FOR UPDATE` trên `QuoteSheet` theo **cùng thứ tự** với
`updateQuote`, và bump `Quote.updatedAt` ở cuối để khoá lạc quan của quản lý
nhìn thấy phần HN vừa lưu.

Chi tiết vòng đời và ai làm được gì: [QUOTE_WORKFLOW.md](../product/QUOTE_WORKFLOW.md).

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
