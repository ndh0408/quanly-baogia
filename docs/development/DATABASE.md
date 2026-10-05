# Cơ sở dữ liệu

PostgreSQL, truy cập qua Prisma 7 với driver adapter `@prisma/adapter-pg`
(engine TypeScript, không còn engine Rust). Schema ở `prisma/schema.prisma`;
`prisma.config.ts` là nơi Migrate/CLI đọc `DATABASE_URL` — schema **không còn
khối `url`**.

> **Tài liệu này KHÔNG lặp lại `prisma/migrations/README.md`.**
> File đó là nơi chính thức cho: quy trình `migrate dev` / `migrate deploy`,
> bước baseline một lần trên CSDL production đã có sẵn, danh sách drift được
> phép **đích danh**, cách đo lại drift, và hai khoản migration cố ý hoãn.
> Ở đây là phần bổ sung: **bảng nào nối với bảng nào**, **vì sao có `searchText`
> và index trigram**, và **những cái bẫy làm mất index hoặc mất dữ liệu**.

## Bảng chính

Sơ đồ quan hệ vẽ bằng mermaid:
[architecture/diagrams/data-model.md](../architecture/diagrams/data-model.md).

| Nhóm | Bảng | Ghi chú |
|---|---|---|
| Báo giá | `Quote` · `QuoteSheet` · `QuoteItem` · `QuoteVersion` | Lõi của hệ. `QuoteVersion.payload` là snapshot JSON đầy đủ mỗi lần lưu |
| Mẫu / pháp nhân | `Company` · `QuoteTemplate` | `Company` chỉ là **nhãn pháp nhân để xuất hoá đơn**, KHÔNG phải tenant |
| Bộ đếm | `QuoteCounter` · `CustomerCounter` | Cấp số báo giá / mã khách theo prefix, chống trùng |
| CRM | `Customer` · `CustomerNote` · `FollowUp` | `Customer.ownerId` là chủ sở hữu cho phạm vi `own` |
| Nhân sự | `PersonnelRecord` · `Employee` | Hai domain RIÊNG dù trùng 10 cột thông tin cá nhân |
| Danh mục rạp | `Venue` · `VenueItem` | Kích thước đo sẵn, gợi ý khi gõ hạng mục. **Không xoá mềm** |
| Phân quyền | `User` · `RolePermission` | `User.permissions` là quyền per-user; `RolePermission` ghi đè theo **vai trò** |
| Phiên / token | `user_sessions` · `RefreshToken` · `LoginAttempt` | `user_sessions` do `connect-pg-simple` tự quản, không có model Prisma |
| Vết | `AuditEvent` · `Notification` · `Webhook` · `WebhookDelivery` | `AuditEvent.requestId` nối nhật ký kiểm toán với log ứng dụng |
| Tệp | `UploadObject` | Hai khoá `stagingKey` / `key` — chốt chống TOCTOU của đường presigned |
| Tàn dư | `Product` · `ProductPriceTier` · `Approval` | Không đường GHI nào còn tạo hàng mới. `Product` chỉ còn bị ĐỌC ở tìm kiếm toàn cục và ở bộ đếm trang quản trị; `Approval` chỉ còn bị đọc ở `GET /api/quotes/{id}/approvals`. Nhóm quyền "Sản phẩm" đã bị ẩn khỏi ma trận phân quyền vì tính năng price book chưa bao giờ được làm |

Cột nào có ý nghĩa lạ thì **schema đã chú thích tiếng Việt ngay tại cột đó** —
đọc `prisma/schema.prisma` trước khi đoán.

## Ba quy ước xuyên suốt

### 1. Tiền là `Decimal`, không bao giờ là float

```prisma
subtotal  Decimal @default(0) @db.Decimal(18, 2)
quantity  Decimal @default(0) @db.Decimal(18, 4)
unitPrice Decimal @default(0) @db.Decimal(18, 4)
```

Cột tiền dùng 2 chữ số thập phân; số lượng và đơn giá dùng 4 (file Excel ngoài
chứng minh có nơi dùng số gốc bốn chữ số — cờ `QuoteItem.quantityExact` bật thì
phép tính giữ đủ 4). Phía mã, `D()` trong `src/money.ts` là cửa duy nhất để đưa
một giá trị bất kỳ về `Prisma.Decimal`.

Đổi một cột tiền sang `Float` hay `Number` là mất chính xác **âm thầm** — không
có test nào bắt được ngay, và cái sai chỉ hiện ra ở tổng của một báo giá lớn.

### 2. Xoá mềm là hành vi MẶC ĐỊNH của 8 model

`User` · `Company` · `QuoteTemplate` · `Quote` · `Customer` · `Product` ·
`PersonnelRecord` · `Employee`.

Extension trong `src/db.ts` đổi `delete`/`deleteMany` thành `update` đặt
`deletedAt`, và tự thêm `where.deletedAt = null` vào mọi truy vấn đọc. Hai hệ quả
phải nhớ khi viết truy vấn:

* `findUnique` bị đổi thành `findFirst` (để gắn được filter). Nếu cần hàng đã
  xoá, truyền cờ `includeDeleted`; cần xoá thật, truyền cờ `hardDelete`.
* **Ràng buộc `@unique` toàn cục vẫn tính cả hàng đã xoá mềm.** Đây là lý do các
  đường kiểm trùng trả 409 kèm chữ "thuộc bản đã xoá" thay vì 500 khó hiểu. Bản
  vá triệt để (partial unique cho `username`/`email`/`code`/`sku`) nằm ở mục
  *Deferred* của `prisma/migrations/README.md`.

⚠️ Codebase **không** soft-delete bên trong `$transaction`, và điều đó là cố ý:
extension gọi `base.<model>.update()` để đổi thao tác, tức là một lời gọi **ngoài**
transaction. Cần soft-delete trong transaction thì phải xử khác, đừng cho rằng
extension che được.

### 3. Nợ kỹ thuật được KHAI, không được tha

Bảy route đang chạm thẳng Prisma (thay vì đi qua service) nằm trong danh sách
khai báo của `scripts/ci/check-architecture.mjs`, mỗi mục một dòng lý do. Route
mới chạm Prisma là ĐỎ; mục nợ đã trả mà quên gỡ khỏi danh sách cũng ĐỎ.

## `searchText` và index trigram — vì sao tồn tại

### Vấn đề

Người dùng gõ "nguyen duc" để tìm "Nguyễn Đức", hoặc gõ sai dấu. Và mọi ô tìm
kiếm đều là `ILIKE '%q%'` — **có wildcard dẫn đầu**, thứ mà btree không phục vụ
được: Postgres rơi thẳng về quét tuần tự toàn bảng.

### Cách chữa: hai lớp

**Lớp 1 — cột `searchText` chuẩn hoá.** `normalizeSearch` trong `src/searchText.ts`
bỏ dấu (NFD rồi xoá ký tự tổ hợp), thay `đ` thành `d`, hạ chữ thường, và biến mọi
ký tự ngoài `[a-z0-9 ]` thành khoảng trắng. Kết quả ghi vào cột `searchText` của
`Quote`, `Customer`, `PersonnelRecord` mỗi lần tạo/sửa.

**Cùng một hàm được dùng cho cả lúc GHI lẫn lúc TRUY VẤN** — đó là toàn bộ lý do
nó khớp 100%. Hai hàm chuẩn hoá riêng cho hai phía là hai hàm sẽ trôi khỏi nhau.

`searchTextFilter` có một chi tiết dễ mất khi refactor: nếu từ khoá chuẩn hoá ra
**rỗng** (người dùng chỉ gõ ký tự đặc biệt) thì nó trả về một token không bao giờ
khớp, chứ không trả `contains: ""` — cái sau là `LIKE '%%'`, tức **nuốt cả danh
sách** trong phạm vi quyền của người đó.

**Lớp 2 — GIN trigram index.**

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX "Quote_searchText_trgm_idx" ON "Quote" USING gin ("searchText" gin_trgm_ops);
```

`pg_trgm` cắt chuỗi thành bộ ba ký tự và đánh index chúng, nhờ đó `ILIKE '%q%'`
được index phục vụ thay vì quét tuần tự.

⚠️ **`CREATE EXTENSION` cần quyền cao.** Nếu vai trò CSDL của ứng dụng không phải
superuser thì DBA phải chạy `CREATE EXTENSION pg_trgm;` **một lần** trước, nếu
không migration đó rollback. Migration tạo index trigram được tách riêng khỏi
migration ràng buộc toàn vẹn **chính vì lý do này**: một cái hỏng không kéo cái
kia hỏng theo.

Backfill cho hàng cũ: `prisma/backfill-searchtext.mjs`.

## ⚠️ `prisma migrate dev` XOÁ index tạo bằng SQL thô

Đây là cái bẫy tốn nhiều thời gian nhất trong repo này.

Prisma sinh migration bằng cách so `schema.prisma` với CSDL. Object nào **Prisma
không biểu diễn được** thì nó thấy là "thừa trong CSDL" và sinh câu `DROP INDEX`.
Chạy `npx prisma migrate dev` rồi commit thẳng file nó đẻ ra là **xoá mất index
sản xuất** — và mọi thứ vẫn xanh, chỉ có truy vấn chậm dần.

Danh sách object rơi vào diện này (GIN trigram, GIN trên mảng, partial btree,
partial unique, mọi ràng buộc `CHECK`) được
liệt kê **đích danh** ở `prisma/migrations/README.md`, mục "Drift ĐƯỢC PHÉP".

**Cái gì KHÔNG có trong danh sách đó mà bị báo drift thì là `schema.prisma` đang
thiếu khai báo — sửa schema, đừng commit file `DROP INDEX`.**

Hai chốt chặn đã có, và chúng chặn hai thứ khác nhau:

| Chốt | Chặn gì |
|---|---|
| `tests/vdb-schema-index-drift.test.js` | So tập drift THỰC TẾ (dựng CSDL nháp, `migrate deploy`, `migrate diff`) với hằng số `DRIFT_DUOC_PHEP` **bằng đúng, cả hai chiều**. Nên hai nơi không lặng lẽ trôi khỏi nhau |
| cùng bài test đó | Quét **mọi** `CREATE INDEX` btree thường trong `prisma/migrations/**/migration.sql` và đòi mỗi cái có `@@index`/`@@unique` khớp danh sách cột trong schema |

Nghĩa là luật rất gọn:

* Index **btree thường** → Prisma biểu diễn được → **phải** khai `@@index` trong
  `schema.prisma` NGAY khi viết migration tạo nó.
* Index **không biểu diễn được** (GIN, partial, CHECK) → thêm vào bảng "Drift
  ĐƯỢC PHÉP" **và** vào hằng số `DRIFT_DUOC_PHEP`, cùng lúc.

Một ca thật đã xảy ra: cột `RolePermission.permissions` được migration tạo với
`DEFAULT ARRAY[]::TEXT[]` nhưng schema quên `@default([])`. Prisma **khai được**
default cho scalar list, nên đó là drift THẬT chứ không phải giới hạn của công
cụ — cách sửa đúng là bổ sung vào schema, không phải miễn trừ nó.

## Cái bẫy thứ hai: `CREATE INDEX CONCURRENTLY` bị đứt

Trên production đang tải, vài migration ghi sẵn bản `CONCURRENTLY` để chạy tay
rồi `prisma migrate resolve --applied ...`. Nhưng `CREATE INDEX CONCURRENTLY` bị
đứt giữa chừng (deadlock, huỷ phiên, hết đĩa) để lại một index **INVALID mang
đúng tên đó**. Sau đó `CREATE INDEX IF NOT EXISTS` trong migration thấy tên đã
tồn tại nên bỏ qua, `migrate deploy` báo thành công, và hệ thống chạy tiếp với
một index không dùng được.

**Bắt buộc kiểm trước khi `migrate resolve`:**

```sql
SELECT c.relname FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE NOT i.indisvalid;
```

Có tên nào trong đó → `DROP INDEX` rồi tạo lại, đừng resolve.

## Truy vấn nóng — đo, đừng đoán

```bash
npm run db:explain      # scripts/db/explain-hot-paths.mjs
```

Script dựng 5 000 hàng thật, bật `PRISMA_LOG_QUERIES`, **nghe câu SQL Prisma
thật sự chạy**, rồi `EXPLAIN ANALYZE` chính câu đó. Chép tay câu SQL mình *nghĩ*
Prisma sinh ra thì vài tháng sau ta đang EXPLAIN một truy vấn không còn ai chạy.
Nó đã tìm ra một index thiếu thật (trang Mã khách hàng sắp theo `createdAt` mà
không có index nào phục vụ).

Dữ liệu thử có `createdAt` **hoán vị** so với thứ tự chèn (correlation ≈ 0), và
trang SÂU chỉ bỏ qua ~10% số hàng dựng. Giá của một Index Scan đọc nhiều hàng do
thứ tự vật lý của bảng quyết định, mà thứ tự đó do lượt trước và autovacuum định
đoạt: trước đây trang 100 (bỏ qua 40% bảng) lật sang Seq Scan mỗi khi autovacuum
rơi vào giữa lúc script đang chèn — bộ hoạch định chọn đúng, cổng đỏ vì lịch sử
của bảng chứ không vì thiếu index. Khi đỏ, chẩn đoán (SQL, nút Seq Scan với số
hàng ước lượng/thật, thống kê bảng, correlation của cột sắp xếp, kế hoạch bị gạt
đi) ra **stderr** — `verify-local.sh` đổ stdout vào `/dev/null`.

Mỗi báo giá thử có **trang** (`QuoteSheet`, `TRANG_MOI_BAO_GIA`): validator đòi ≥ 1
trang mỗi báo giá, nên ở CSDL thật bảng này luôn lớn ít nhất bằng bảng `Quote`.
Trước 2026-09-29 script không dựng trang nào, và cổng không thấy danh sách báo giá
gộp **toàn bảng** `QuoteSheet` để đếm trang: `_count: { sheets }` của Prisma thành
`LEFT JOIN (SELECT "quoteId", COUNT(*) … GROUP BY "quoteId")`, mà Postgres không
đẩy được khoá JOIN vào subquery có `GROUP BY` — không index nào cứu được. Nay
`listQuotes` đếm trang riêng, chỉ cho id của trang đang xem (`soTrangTheoBaoGia`).

Câu đếm trang đó (`SELECT COUNT(*) … GROUP BY "quoteId"`) từng lọt vào miễn trừ
"đếm tổng" của cổng — mục ấy tha **mọi** câu mở đầu bằng `COUNT(*)` trên **mọi**
bảng, nên câu đếm trang có quét cả bảng `QuoteSheet` thì cổng vẫn xanh. Nay mỗi mục
miễn trừ (`CHAP_NHAN`) nêu đúng một bảng: đếm tổng chỉ được tha theo khuôn
`prisma.count` của `Quote` và `Customer`. Cổng đo thêm danh sách báo giá bằng phiên
**không** có quyền bảng nội bộ — phiên của phần lớn nhân viên, nơi câu đếm trang là
câu duy nhất chạm `QuoteSheet` (phiên toàn quyền còn chạy câu bảng nội bộ, cũng đi
index của `QuoteSheet`, và gỡ index thì câu ĐÓ đỏ trước). Khi đỏ, cổng liệt kê mọi
câu quét tuần tự của đường đó, không chỉ câu tệ nhất.

Cổng chỉ chạy khi được gọi thẳng (`laTepChinh` so **đường thật** của `argv[1]` với
`import.meta.url`): gọi qua junction/symlink bằng đường tuyệt đối thì bản so chuỗi
cũ thoát 0 mà không in gì, trông y hệt cổng xanh.

`PRISMA_LOG_QUERIES` **không được bật ở production**: câu SQL kèm tham số, tức
tên khách, số điện thoại và mọi thứ người dùng gõ vào ô tìm kiếm sẽ nằm trong
nhật ký.

## Cấu hình kết nối và transaction

| Biến | Mặc định | Vì sao đáng quan tâm |
|---|---|---|
| `DB_POOL_MAX` | 20 | Mặc định của Prisma là 10/tiến trình — dễ thành nút thắt |
| `DB_TX_MAX_WAIT` | 10 000 | Cũng là `connectionTimeoutMillis` của pool. node-pg tự nó mặc định chờ **vô hạn** khi pool cạn, tức mọi request (kể cả `/readyz` và đăng nhập) xếp hàng không có trần — `config.ts` đặt trần 10 000 để không rơi vào đó |
| `DB_TX_TIMEOUT` | 60 000 | Đơn vị là **mili-giây**. Mặc định 5 giây của Prisma quá ngắn cho đường lưu báo giá lớn |

Cả ba đi qua `src/config.ts` chứ không đọc thẳng `process.env`: gõ
`DB_TX_TIMEOUT=5` (5 mili-giây) sẽ làm mọi lần Lưu chết P2028 trong khi tiến
trình vẫn khởi động bình thường. Qua config thì gõ sai là **thoát ngay kèm tên
biến**.

## Trước khi chạy migration trên production

1. **Sao lưu trước** (`pg_dump -Fc`). Migration là thao tác duy nhất có thể
   đổi/xoá dữ liệu.
2. Migration đụng dữ liệu thì diễn tập bằng `scripts/db/migration-rehearsal.sh`.
3. Production dùng `prisma migrate deploy`. **`db push` bị chặn cứng** trong
   `package.json` — nó không có lịch sử, không soát được, và xoá được cột.

## Truy vấn kiểm dữ liệu (chỉ đọc)

Mục này chỉ chứa câu `SELECT`. **Không câu nào ở đây được phép sửa dữ liệu**, và không
nên chạy chúng trên CSDL thật khi chưa có lý do: chạy trên bản khôi phục hoặc CSDL dev
trước (quy trình repo: dev trước, production sau). Cần chạy trên production thì bọc trong
giao dịch chỉ-đọc, để lỡ tay gõ nhầm cũng không ghi được:

```sql
BEGIN READ ONLY;
-- câu SELECT ở đây
ROLLBACK;
```

### Kiểm báo giá cũ tắt Thành Tiền nhóm mà có nhóm SL > 1

**Vì sao cần.** `sheetSubtotalGrouped` (web) và `src/money.ts` (máy chủ) chỉ nhân Số
Lượng nhóm vào tiền các mục con khi `QuoteSheet.groupSubtotal` BẬT. Báo giá lưu trước khi
có luật "tự bật + khoá" (2026-09-30) có thể ở trạng thái "tắt + nhóm SL > 1": tổng đã lưu
KHÔNG nhân hệ số nhóm. Lưới mới không tự tạo ra trạng thái này nữa (gõ · dán · điền · gợi ý
danh mục · nhập Excel đều tự bật ô), nhưng dữ liệu cũ vẫn còn, và **mở ra không tự bật** —
nên phải tìm bằng SQL. Câu (1) liệt kê đúng những nhóm đó để người phụ trách xem từng báo giá.

**"SL > 1" là theo SỐ ĐANG HIỆN, không theo số thô** — đúng `M.groupMult` (định nghĩa ở
`shared/quote-math.ts`, web dùng qua `web/src/lib/quoteMath.ts`):
`groupMult(it) = Math.max(1, qtyForAmount(it) || 1)`, tức nhóm nhân thật ⇔ `qtyForAmount(it) > 1`.
`qtyForAmount` rẽ HAI nhánh theo cờ `quantityExact` của chính dòng nhóm:

| Dòng nhóm | `qtyForAmount` (= số đang hiện) | Nhóm nhân thật (> 1) khi |
|---|---|---|
| `quantityExact = false` | `qtyRound`: làm tròn nửa-lên **1 số lẻ** | SL ≥ **1,05** (1,04 hiện "1" → ×1; 1,05 hiện "1,1" → ×1,1) |
| `quantityExact = true` | `qtyExact`: làm tròn nửa-lên **4 số lẻ** | SL ≥ 1,00005 — cột `Decimal(18,4)` nên là SL **> 1** (1,0001 đã nhân thật) |

`src/money.ts` làm tròn y như vậy (Decimal `ROUND_HALF_UP`, 4 hoặc 1 số lẻ theo `quantityExact`).
Mỗi câu dưới tính cột `slHien` bằng CHÍNH công thức đó rồi lọc `slHien > 1`. Đừng làm tròn 1 số
lẻ cho MỌI dòng: dòng `quantityExact` có SL từ 1,0001 đến 1,0499 làm tròn 1 số lẻ ra "1", nhưng
vẫn nhân thật — sẽ bị bỏ sót.

```sql
-- (1) Trang chính: QuoteSheet + QuoteItem (hai bảng thật). Cột quantity là Decimal(18,4), nên round()
--     của Postgres (nửa xa số 0) ra đúng số của qtyRound / qtyExact và của ROUND_HALF_UP ở src/money.ts.
WITH nhom AS (
  SELECT q.id AS "quoteId", q."quoteNumber", q.status,
         s.id AS "sheetId", s."order" AS "thuTuSheet", s.name AS "tenSheet",
         g.id AS "itemId", g."order" AS "thuTuDong", g.kind, g.label, g.name AS "tenNhom",
         g.quantity AS "slLuu", g."quantityExact",
         CASE WHEN g."quantityExact" THEN round(g.quantity, 4) ELSE round(g.quantity, 1) END AS "slHien"   -- = qtyForAmount
  FROM "QuoteSheet" s
  JOIN "Quote" q     ON q.id = s."quoteId" AND q."deletedAt" IS NULL      -- bỏ báo giá đã xoá mềm
  JOIN "QuoteItem" g ON g."sheetId" = s.id
  WHERE s."groupSubtotal" = false
    AND g.kind IN ('section', 'subsection')
)
SELECT * FROM nhom
WHERE "slHien" > 1                                                         -- = groupMult(it) > 1
ORDER BY "quoteId", "thuTuSheet", "thuTuDong";
```

**Bảng nội bộ (2) và (3) chỉ để biết, không sai tiền.** Chi phí HCM · Phí khách hàng
(`QuoteSheet.extraTables`) và Hà Nội (`Quote.hnTables`) nằm trong JSON, mỗi bảng có cờ
`groupSubtotal` riêng. Nhưng tổng của chúng (`extraTableSum` ở `web/src/components/ExtraTables.tsx`
và `src/quoteUtils.ts`) KHÔNG bao giờ nhân hệ số nhóm dù cờ bật hay tắt: cờ chỉ quyết định ô
Thành Tiền của dòng nhóm (và công thức tham chiếu tới ô đó) có hiện số hay để trống. Nên "tắt +
nhóm SL > 1" ở đó không làm sai con số nào đã lưu — hai câu dưới chỉ cho biết còn bao nhiêu bảng
ở trạng thái đó, không cần xử lý gì.

Số lượng trong JSON là số JS chưa ép về 4 số lẻ, nên `slHien` của (2) và (3) chép NGUYÊN công
thức `qtyRound` / `qtyExact`, kể cả số khử nhiễu `+1e-6` / `+1e-8` (`floor(x + 0,5)` là
`Math.round` với số không âm): ngưỡng thật là 1,0499999 và 1,000049999999, không phải 1,05 và
1,00005. Chỉ một số nằm ĐÚNG ranh giới tới sai số dấu phẩy động (vd đúng 1,0499999) là JS và SQL có
thể nói khác nhau. Cột jsonb là cột TỰ DO (có thể là `null`, object, chuỗi; `items` có thể không
phải mảng; phần tử có thể không phải object) nên mọi `jsonb_array_elements` đều có rào
`jsonb_typeof` — cùng lối với `bangNoiBoTheoSheet` ở `src/services/quoteService.ts`; một dòng dữ
liệu lạ không làm cả câu lỗi. Cờ thiếu / `null` coi như tắt; `quantity` không phải số thì bỏ qua
(máy chủ luôn lưu số — `sanitizeExtraTables` — nên chỉ gặp ở dữ liệu rất cũ).

```sql
-- (2) Bảng nội bộ của trang (QuoteSheet.extraTables) — mỗi phần tử: { category, name, groupSubtotal, items[] }
WITH bang_tat AS (
  SELECT q."quoteNumber", s.id AS "sheetId", b.tbl
  FROM "QuoteSheet" s
  JOIN "Quote" q ON q.id = s."quoteId" AND q."deletedAt" IS NULL
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(s."extraTables") = 'array' THEN s."extraTables" ELSE '[]'::jsonb END) AS b(tbl)
  WHERE jsonb_typeof(b.tbl) = 'object'
    AND b.tbl->>'category' IS DISTINCT FROM 'hanoi'             -- bản cũ của bảng Hà Nội còn nằm lại trong trang: app bỏ qua, bản thật ở Quote.hnTables
    AND (b.tbl->'groupSubtotal') IS DISTINCT FROM 'true'::jsonb  -- cờ tắt / thiếu / null
), dong AS (
  SELECT t."quoteNumber", t."sheetId", 'extraTables:' || COALESCE(t.tbl->>'category', '?') AS "nguon",
         t.tbl->>'name' AS "tenBang", it.item->>'kind' AS kind, it.item->>'name' AS "tenNhom",
         CASE WHEN jsonb_typeof(it.item->'quantity') = 'number' THEN (it.item->>'quantity')::numeric END AS sl,
         COALESCE(it.item->'quantityExact' = 'true'::jsonb, false) AS chinh_xac
  FROM bang_tat t
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(t.tbl->'items') = 'array' THEN t.tbl->'items' ELSE '[]'::jsonb END) AS it(item)
  WHERE jsonb_typeof(it.item) = 'object'
), hien AS (
  SELECT d.*, sign(sl) * CASE WHEN chinh_xac THEN floor(abs(sl) * 10000 + 0.00000001 + 0.5) / 10000   -- = qtyExact
                              ELSE floor(abs(sl) * 10 + 0.000001 + 0.5) / 10 END AS "slHien"         -- = qtyRound
  FROM dong d
)
SELECT * FROM hien
WHERE kind IN ('section', 'subsection')
  AND "slHien" > 1                                                         -- = groupMult(it) > 1
ORDER BY "quoteNumber", "sheetId";

-- (3) Bảng Hà Nội ở cấp báo giá (Quote.hnTables) — cùng khuôn, không có sheet
WITH bang_tat AS (
  SELECT q."quoteNumber", b.tbl
  FROM "Quote" q
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(q."hnTables") = 'array' THEN q."hnTables" ELSE '[]'::jsonb END) AS b(tbl)
  WHERE q."deletedAt" IS NULL
    AND jsonb_typeof(b.tbl) = 'object'
    AND (b.tbl->'groupSubtotal') IS DISTINCT FROM 'true'::jsonb  -- cờ tắt / thiếu / null
), dong AS (
  SELECT t."quoteNumber", 'hnTables' AS "nguon", t.tbl->>'name' AS "tenBang",
         it.item->>'kind' AS kind, it.item->>'name' AS "tenNhom",
         CASE WHEN jsonb_typeof(it.item->'quantity') = 'number' THEN (it.item->>'quantity')::numeric END AS sl,
         COALESCE(it.item->'quantityExact' = 'true'::jsonb, false) AS chinh_xac
  FROM bang_tat t
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(t.tbl->'items') = 'array' THEN t.tbl->'items' ELSE '[]'::jsonb END) AS it(item)
  WHERE jsonb_typeof(it.item) = 'object'
), hien AS (
  SELECT d.*, sign(sl) * CASE WHEN chinh_xac THEN floor(abs(sl) * 10000 + 0.00000001 + 0.5) / 10000   -- = qtyExact
                              ELSE floor(abs(sl) * 10 + 0.000001 + 0.5) / 10 END AS "slHien"         -- = qtyRound
  FROM dong d
)
SELECT * FROM hien
WHERE kind IN ('section', 'subsection')
  AND "slHien" > 1                                                         -- = groupMult(it) > 1
ORDER BY "quoteNumber";
```

> **Đã thử ở đâu.** 2026-10-06: ba câu trên chạy trên PGlite (Postgres nhúng, trong bộ nhớ) với
> bảng và dữ liệu GIẢ dựng theo `prisma/schema.prisma`, và từng dòng trả về được so với CHÍNH
> `groupMult` (chép nguyên từ `shared/quote-math.ts`) — khớp ở mọi ca biên: SL 1,04 (hiện "1") ·
> 1,05 (hiện "1,1") · không-exact 1,0001 (hiện "1") · `quantityExact` 1,0001 / 1,00005 /
> 1,0000499999995 (nhân) và 1,0000499999 (không) · trong JSON 1,04999991 (nhân) và 1,04999989
> (không) · SL âm / 0 · báo giá xoá mềm · cờ đã bật · bảng JSON thiếu cờ hoặc cờ `null` ·
> `quantity` không phải số · cột jsonb là `null` / object / chuỗi · `items` không phải mảng ·
> phần tử không phải object · bản cũ `category = 'hanoi'`; cả ba chạy được trong `BEGIN READ ONLY`.
> **Chưa chạy trên CSDL nào thật.** Chạy ở dev trước, rồi so vài dòng bằng mắt với trình soạn báo
> giá (ô "Hiện Thành Tiền nhóm" và Số Lượng của nhóm) trước khi tin con số đếm.

### ⛔ KHÔNG chạy hàng loạt sửa cờ

Đừng "chữa" kết quả bằng `UPDATE "QuoteSheet" SET "groupSubtotal" = true …` (hay sửa JSON
tương đương). Bật cờ là **đổi tổng** của báo giá đã lưu — có thể đã gửi khách, đã chốt, đã
xuất hoá đơn — và đổi theo hướng TĂNG đúng bằng hệ số nhóm. Ba lý do cụ thể:

1. `QuoteSheet.subtotal` và `Quote.subtotal` / `total` là số **đã vật chất hoá lúc Lưu** (xem
   chú thích ở schema). Sửa cờ bằng SQL thì máy chủ tính ra tổng mới nhưng các cột đã lưu vẫn là
   số cũ: trang Quản lý dự án, danh sách và hoá đơn lệch nhau ngay lập tức.
2. `QuoteVersion.payload` là snapshot JSON của từng lần lưu; sửa cờ ở bảng sống làm phiên bản
   cũ và bản hiện tại nói hai tổng khác nhau mà không có dấu vết nào giải thích.
3. SQL thẳng không đi qua đường ghi `AuditEvent`, nên một lần đổi tiền như vậy không để lại
   nhật ký — trong khi khách có thể đã nhìn thấy con số cũ.

Cách đúng là **từng báo giá, do người phụ trách quyết**: mở ra trong trình soạn (mở ra
không tự bật), tích ô "Hiện Thành Tiền nhóm" hoặc nhập / dán lại Số Lượng nhóm — lưới bật
và khoá ô, bấm Lưu để máy chủ tính lại và ghi phiên bản mới. Nếu chủ repo quyết định sửa
hàng loạt thì đó là một việc RIÊNG: `pg_dump -Fc` trước, danh sách duyệt tay từng báo giá,
đi qua đường lưu của ứng dụng (không SQL thẳng), diễn tập ở dev.
