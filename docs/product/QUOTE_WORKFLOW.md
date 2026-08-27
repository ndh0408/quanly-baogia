# Vòng đời báo giá

Ai làm được gì, ở trạng thái nào, và cái gì chặn cái gì.

> **Đọc kỹ chỗ này trước:** vòng đời **không phải** "nháp → duyệt → thanh toán".
> Luồng duyệt **nội bộ** (`submitQuote` / `approveQuote` / `rejectQuote`) đã bị bỏ
> ngày 2026-06-22. Trong hệ hiện tại, "duyệt" là quyết định của **khách hàng**,
> và nó nằm trên một trục hoàn toàn khác với `Quote.status`.

Đối chiếu quyền: [ROLES_PERMISSIONS.md](ROLES_PERMISSIONS.md) (ma trận 137
endpoint). Nguồn sự thật của tài liệu này: `src/permissions.ts`,
`src/quoteUtils.ts`, `src/services/quoteService.ts`, `src/hnWorkflow.ts`.
Sơ đồ: [architecture/diagrams/quote-lifecycle.md](../architecture/diagrams/quote-lifecycle.md).

---

## Bốn trục độc lập

Một báo giá mang **bốn** trạng thái chạy song song. Nhầm chúng với nhau là nguồn
gốc của hầu hết hiểu lầm về hệ này.

| Trục | Lưu ở | Giá trị | Ai đổi |
|---|---|---|---|
| Vòng đời báo giá | `Quote.status` | `draft` → `converted` / `lost` | người có `quote:send` |
| Ý kiến khách, **theo từng sheet** | `QuoteSheet.custStatus` | `null` / `approved` / `rejected` | người có `quote:send` (đánh dấu hộ khách) |
| Giá Hà Nội | `Quote.hnStatus` | `null` → `assigned` → `submitted` → `approved` / `rejected` | `quote:hn:manage` giao & duyệt; `quote:hn:fill` điền & gửi |
| Chứng từ / hoá đơn | các cột trên `QuoteSheet` | suy ra: Hoá đơn → Thanh toán → Done | `invoice:edit` / `invoice:pay` / `quote:sign:*` |

Chỉ trục thứ nhất mới khoá được việc sửa báo giá. Ba trục kia đi riêng.

---

## Trục 1 — vòng đời báo giá

```
        POST /api/quotes
              │
              ▼
        ┌───────────┐   PUT /api/quotes/{id}
        │   draft   │◄──────── sửa (mỗi lần chụp một QuoteVersion)
        └─────┬─────┘
              │
      ┌───────┴────────┐
      ▼                ▼
┌───────────┐    ┌───────────┐
│ converted │    │   lost    │
│ khách CHỐT│    │ không chốt│
└───────────┘    └───────────┘
   BẤT BIẾN         xoá mềm được
   KHÔNG xoá được
```

### Ai được làm gì

| Hành động | Quyền năng lực | Điều kiện thêm |
|---|---|---|
| Tạo | `quote:create` | — |
| Xem | `quote:read:own` (chủ **hoặc** thành viên) hoặc `quote:read:all` | — |
| Sửa | `quote:update:own` / `:all` | `canEdit`: **không** phải `converted`/`lost`. Ai **không** có `quote:send` thì chỉ sửa được `draft`/`rejected` |
| Chốt / Không chốt | `quote:send` | `canOnQuote(update)`; chưa ở trạng thái cuối |
| Xoá | `quote:delete:own` (chỉ `draft`/`rejected`) hoặc `quote:delete:all` | **`converted` thì KHÔNG AI xoá được**, kể cả `delete:all` |
| Nhân bản | `quote:create` **và** đọc được bản nguồn | — |
| Xuất Excel/PDF | `quote:export` | `canOnQuote(read)` |
| Thêm/bớt thành viên | người tạo **hoặc** `quote:update:all` | — |

**Thành viên là một đường cấp quyền thật.** Ai được thêm vào `Quote.members` thì
`canOnQuote` cho họ `read` và `update` trên báo giá đó — nhưng **không** cho
`delete`. Đây là cách Account Hà Nội "thấy" báo giá được giao.

**Sửa giá làm tăng `currentVersion`.** Mọi thay đổi đụng `sheets`, `vatPercent`
hoặc `discount` đều bump số phiên bản và chụp một `QuoteVersion`. Với bốn trạng
thái legacy (`pending`/`approved`/`sent`) thì nó còn kéo báo giá về `draft` và
xoá `approvedById` — nhánh này chỉ còn chạy cho dữ liệu cũ.

### Bốn trạng thái LEGACY

`pending` · `approved` · `rejected` · `sent` vẫn còn trong enum `QuoteStatus` và
vẫn có nhãn tiếng Việt trong giao diện, nhưng **không đường ghi nào đặt chúng
nữa**. Chúng ở lại vì CSDL production còn hàng mang giá trị cũ, và vì `canEdit`
/ `deleteQuote` vẫn đối xử `rejected` như `draft` nên hàng cũ vẫn dùng được.

**Đừng viết mã mới đặt bốn trạng thái này.**

---

## Trục 2 — ý kiến khách, theo TỪNG SHEET

Một báo giá nhiều sheet: khách chốt sheet này mà chưa chốt sheet kia. Vì thế
quyết định của khách ghi ở **mức sheet** (`QuoteSheet.custStatus`), tách hẳn khỏi
`Quote.status`.

```
POST /api/quotes/sheets/{sheetId}/customer-decision
        status = "approved" | "rejected" | (rỗng = gỡ đánh dấu)
```

Cần `quote:send` **và** `canOnQuote(update)` trên báo giá. Ghi kèm người đánh
dấu (`custStatusById`), thời điểm, và ghi chú/lý do — rồi vào nhật ký kiểm toán.

`Quote.status` **không** tự đổi theo. Nó chỉ đổi khi người phụ trách bấm Chốt /
Không chốt ở trục 1. Đó là cố ý: ý kiến của khách trên một sheet không phải quyết
định thương mại về cả báo giá.

---

## Trục 3 — giá Hà Nội

Luồng riêng cho vai trò **Account Hà Nội**. Tiền Hà Nội là chi phí **nội bộ**:
nó nằm trong `QuoteSheet.extraTables` với `category` là `"hanoi"`, nên **không
bao giờ vào file Excel gửi khách**.

```
   (null = chưa giao)
        │  assignHn — quote:hn:manage
        ▼
   ┌──────────┐   saveHn (điền tiếp)
   │ assigned │◄────────────┐
   └────┬─────┘             │
        │ submitHn          │ saveHn tự đưa về assigned
        ▼                   │
   ┌───────────┐            │
   │ submitted │            │
   └─────┬─────┘            │
    ┌────┴─────┐            │
    ▼          ▼            │
┌──────────┐ ┌──────────┐   │
│ approved │ │ rejected ├───┘
└──────────┘ └──────────┘
                (kèm hnRejectNote)
```

| Bước | Endpoint | Quyền | Điều kiện |
|---|---|---|---|
| Giao | `POST /api/quotes/{id}/hn/assign` | `quote:hn:manage` + `canOnQuote(update)` | Người nhận phải `active` **và** mang vai trò `account_hn` **hoặc** được cấp riêng `quote:hn:fill` |
| Điền | `PUT /api/quotes/{id}/hn` | `quote:hn:fill` | **`hnAssigneeId` phải là chính mình**; từ chối khi đã `submitted`/`approved` |
| Gửi duyệt | `POST /api/quotes/{id}/hn/submit` | `quote:hn:fill` | chỉ từ `assigned` hoặc `rejected` |
| Duyệt / Trả | `POST /api/quotes/{id}/hn/review` | `quote:hn:manage` + `canOnQuote(update)` | chỉ từ `submitted` |

### Ba chốt chặn đáng biết

**Giao việc cũng thêm người vào `members`** — đó là cách account thấy được báo
giá, vì họ chỉ có `quote:read:own`.

**Người điền phần HN bị chặn ở đường lưu chính.** `PUT /api/quotes/{id}` trả 403
cho bất kỳ ai có `quote:hn:fill`. Không có guard này thì họ nhận editor **chỉ có
phần HN**, bấm Lưu là gửi payload thiếu toàn bộ sheet báo giá chính và **xoá
trắng báo giá**.

**Guard kiểm QUYỀN, không kiểm chuỗi vai trò.** `quote:hn:fill` cấp được per-user
ở trang Phân quyền, nên một `manager` được cấp riêng quyền này cũng phải bị chặn.

### Account Hà Nội thấy gì

Quyền mặc định của vai trò này là **tối thiểu**: `quote:read:own`,
`quote:update:own`, `quote:hn:fill`. Server **lược** dữ liệu trước khi trả:
`presentQuote` với cờ `hnOnly` chỉ giữ lại bảng nội bộ `"hanoi"`. Không tạo báo
giá, không thấy báo giá của người khác, **không export**.

---

## Trục 4 — chứng từ, hoá đơn, thanh toán

Chỉ mở **sau khi báo giá đã `converted`**. Cả hai endpoint dưới đây từ chối
(403) nếu `quote.status` khác `converted` hoặc báo giá đã xoá mềm.

### Ký chứng từ

```
POST /api/quotes/sheets/{sheetId}/sign      { signed: true | false }
```

* `quote:sign:all` — ký **mọi** dự án.
* `quote:sign:own` — chỉ ký dự án **do mình tạo**.
* Cờ `canSign` cũ được **bắc cầu** thành `quote:sign:own` ở middleware, nên tài
  khoản cũ vẫn chạy y như trước.

Ghi lại `signedAt`, `signedById`, và **chụp** `signedByName` tại thời điểm ký —
FK dùng `onDelete: SetNull` nên xoá người ký thì mất liên kết chứ không mất tên.

### Hoá đơn — quyền được TÁCH NGUYÊN TỬ

```
PUT /api/quotes/sheets/{sheetId}/invoice
```

| Trường bị đụng | Quyền cần |
|---|---|
| `paidAt` (ngày thu tiền) | `invoice:pay` |
| `invoiceNo`, `invoiceDate`, `poNumber`, `hnInvoiceNo`, `invoiceLink`, `docSentAt`, `docReturnedAt`, `paymentMethod`, `orderClosedAt`, `invoiceYear`, `invoiceCompany`, `invoiceDesc`, `invoiceNote` | `invoice:edit` |

Tách như vậy để phân được "người này nhập số hoá đơn, người kia đánh dấu đã thu
tiền" — hai việc khác nhau về trách nhiệm. Quyền gộp cũ `invoice:manage` được
bắc cầu thành `invoice:edit` + `invoice:pay`.

**Tình trạng hoá đơn được SUY RA, không lưu:**

| Điều kiện | Tình trạng |
|---|---|
| đã chốt, chưa có `invoiceNo` | Hoá đơn |
| có `invoiceNo` | Thanh toán |
| có `invoiceNo` **và** `paidAt` | Done |

Hai trang đọc **cùng một nguồn dữ liệu**: trang **Hoá đơn** (`invoice:page`) là
nơi kế toán **nhập**; trang **Quản lý dự án** (`invoice:read`) là nơi tham chiếu,
chỉ xem. Nhập một chỗ, hiện cả hai.

### Thanh toán từng hàng bảng nội bộ

Khác hẳn hoá đơn ở trên. Đây là chi phí **nội bộ** (HCM / HN / phí khách), tích
theo **từng hàng**:

```
POST /api/quotes/{id}/extra/{sheetId}/{rid}/pay     quote:internal:pay
GET  /api/quotes/{id}/extra/{sheetId}/{rid}/proof   quote:internal:view | :pay
```

`quote:internal:*` là **năng lực**, không phải phạm vi. Phạm vi báo giá vẫn do
`assertQuoteInScope` áp — thiếu lớp đó thì tài khoản chi phí chỉ cần đổi `{id}`
trên URL là đọc được ảnh uỷ nhiệm chi của **mọi** báo giá. Xem ảnh chứng từ có
ghi audit riêng (`quote.internal.proof-view`) vì đó là dữ liệu PII.

---

## Vai trò mặc định — ai chạm được trục nào

Đây là **mặc định** trong `src/permissions.ts`. Quyền cấp được **per-user** ở
trang Phân quyền, và ghi đè được theo **vai trò** qua bảng `RolePermission`, nên
một tài khoản cụ thể có thể khác bảng này. `admin` **luôn full**, không ghi đè
được (chống tự khoá).

| Vai trò | Nhãn | Trục 1 | Trục 2 | Trục 3 | Trục 4 |
|---|---|---|---|---|---|
| `admin` | Quản trị | toàn quyền, mọi báo giá | ✓ | giao/duyệt HN | ký mọi dự án, sửa + thu tiền |
| `manager` | Account | tạo/sửa/xoá **của mình**, chốt/không chốt | ✓ | giao/duyệt HN | — (trừ khi được cấp riêng) |
| `account_hn` | Account HN | chỉ đọc/ghi báo giá **được giao**, view bị lược | — | **điền + gửi duyệt** | — |
| `hr` | Nhân sự | — | — | — | — |
| `accountant` | Kế toán | — | — | — | trang Hoá đơn: sửa + đánh dấu thu tiền |

`hr` và `accountant` **không thấy báo giá**. Quyền mặc định của họ nằm ở domain
nhân sự: `hr` chỉ có `personnel:read:all`; `accountant` có thêm
`personnel:pay`, `personnel:accounting-note`, và bộ `invoice:page`/`edit`/`pay`.

---

## Bất biến — thứ không được phá

1. **`converted` là bất biến.** Không sửa, không xoá, kể cả `quote:delete:all`.
   Nó là dữ liệu KPI và là gốc của luồng hoá đơn.
2. **Bảng nội bộ không lọt vào Excel gửi khách.** Được bảo vệ bằng kiến trúc chứ
   không bằng bộ lọc: `src/excel.ts` chỉ đọc `sheet.items`, còn `extraTables`
   không hề xuất hiện trong file đó.
3. **`quote:export` là năng lực riêng**, không suy ra từ quyền đọc.
4. **Trạng thái do server sở hữu thì phải lấy lại từ CSDL** trước khi ghi: cờ
   duyệt hàng nội bộ, cờ đã thanh toán, bảng HN đã chốt. Xem
   [DATA_FLOW.md](../architecture/DATA_FLOW.md#32-trong-transaction) — thiếu bước
   này thì client tự đóng dấu duyệt và tự đánh dấu đã trả tiền cho chính mình.
5. **Trạng thái mức sheet phải được BÊ sang bản mới** mỗi lần Lưu (Lưu = xoá
   sheet + tạo lại). Chữ ký, số hoá đơn, ngày thanh toán, ý kiến khách đều sống
   ở đó.

## Cái tài liệu này KHÔNG mô tả

* Cách tính tiền (nhóm, hệ số ngày, làm tròn) — đọc `src/money.ts`.
* Cấp số báo giá và mã dự án — `src/quoteNumber.ts`, `src/codeAllocator.ts`.
* Hai đường xuất file — [DATA_FLOW.md](../architecture/DATA_FLOW.md#4-đường-xuất-excelpdf).
* Ma trận quyền đầy đủ theo endpoint — [ROLES_PERMISSIONS.md](ROLES_PERMISSIONS.md).
