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
partial unique, mọi ràng buộc `CHECK`, bảng nối m2m ngầm `_QuoteMembers`) được
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

`PRISMA_LOG_QUERIES` **không được bật ở production**: câu SQL kèm tham số, tức
tên khách, số điện thoại và mọi thứ người dùng gõ vào ô tìm kiếm sẽ nằm trong
nhật ký.

## Cấu hình kết nối và transaction

| Biến | Mặc định | Vì sao đáng quan tâm |
|---|---|---|
| `DB_POOL_MAX` | 20 | Mặc định của Prisma là 10/tiến trình — dễ thành nút thắt |
| `DB_TX_MAX_WAIT` | — | Cũng là `connectionTimeoutMillis` của pool. node-pg mặc định chờ **vô hạn** khi pool cạn, tức mọi request (kể cả `/readyz` và đăng nhập) xếp hàng không có trần |
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
