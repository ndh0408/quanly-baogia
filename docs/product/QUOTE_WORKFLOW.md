# Vòng đời báo giá

Ai làm được gì, ở trạng thái nào, và cái gì chặn cái gì.

> **Đọc kỹ chỗ này trước:** vòng đời **không phải** "nháp → duyệt → thanh toán".
> Luồng duyệt **nội bộ** (`submitQuote` / `approveQuote` / `rejectQuote`) đã bị bỏ
> ngày 2026-06-22. Trong hệ hiện tại, "duyệt" là quyết định của **khách hàng**,
> và nó nằm trên một trục hoàn toàn khác với `Quote.status`.

Đối chiếu quyền: [ROLES_PERMISSIONS.md](ROLES_PERMISSIONS.md) (ma trận của mọi
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
   KHÔNG xoá được   xoá mềm được
   sửa được tới khi XUẤT HOÁ ĐƠN (có invoiceNo) — người có quote:send
```

### Ai được làm gì

| Hành động | Quyền năng lực | Điều kiện thêm |
|---|---|---|
| Tạo | `quote:create` | — |
| Xem | `quote:read:own` (chủ **hoặc** thành viên) hoặc `quote:read:all` | — |
| Sửa | `quote:update:own` / `:all` | `canEdit`: Khoá sửa = đã có `invoiceNo` ở bất kỳ sheet nào (`daXuatHoaDon`, `src/quoteUtils.ts`) → cấm mọi người. Chưa xuất hoá đơn: người có `quote:send` sửa được **mọi** trạng thái kể cả `converted`/`lost`; người không có `quote:send` chỉ sửa `draft`/`rejected`. (Từ 2026-09-07 — khách chốt không còn là mốc khoá; tài liệu cũ ghi "bất biến" là sai, audit 2026-09-22 DOC-04) |
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

Báo giá **đã xuất hoá đơn** (có ít nhất một sheet mang số HĐ — `daXuatHoaDon`) thì
endpoint trả **409**: cùng mốc khoá với `canEdit`, vì đổi ý kiến khách sau khi chốt sẽ
tính lại `convertedTotal`, tức đổi doanh thu sau khi con số đã ra chứng từ kế toán.

`Quote.status` **không** tự đổi theo. Nó chỉ đổi khi người phụ trách bấm Chốt /
Không chốt ở trục 1. Đó là cố ý: ý kiến của khách trên một sheet không phải quyết
định thương mại về cả báo giá.

---

## Trục 3 — giá Hà Nội

Luồng riêng cho vai trò **Account Hà Nội**. Tiền Hà Nội là chi phí **nội bộ**:
nó nằm ở `Quote.hnTables` — một cột JSON ở **cấp báo giá** — nên **không bao giờ
vào file Excel gửi khách**.

> **Đổi chỗ từ 2026-09-15.** Trước đó bảng Hà Nội nằm trong
> `QuoteSheet.extraTables` với `category = "hanoi"`, tức account HN phải làm việc
> *bên trong* cấu trúc trang của chủ báo giá. Ba hệ quả đã đo được:
> màn của họ in cả **tên từng trang** (lộ cấu trúc báo giá cho người chỉ được
> giao điền giá); mỗi lần chủ bấm Lưu là **mọi `QuoteSheet.id` đổi** (lưu = xoá
> trang rồi tạo lại) nên họ gõ nửa tiếng rồi nhận 409 "hãy tải lại trang"; và chủ
> xoá một trang là bảng HN trên trang đó **chết theo**.
>
> Nay account HN có **không gian riêng, phẳng**: tự thêm/đặt tên/xoá sheet, dán
> từ Excel, nhập tệp Excel, công thức — đúng bộ của lưới báo giá chính
> (`web/src/components/HnTables.tsx`, dùng chung cho cả màn của chủ). Thông tin
> khách **kế thừa** từ báo giá gốc, họ không điền và không thấy.
>
> Khoá lạc quan của đường `PUT /api/quotes/:id/hn` chốt theo **`hnRev`** — vân
> tay của riêng bảng Hà Nội — chứ **không** theo `Quote.updatedAt`. Chủ báo giá
> lưu phần khác thì `hnRev` không đổi, account HN vẫn lưu được; chỉ khi bảng HN
> thật sự bị người khác sửa mới có 409. Quan trọng vì màn HN **không có bản nháp
> cục bộ**, nên một lần 409 oan là mất trắng phần vừa gõ.

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
`presentQuote` với cờ `hnOnly` chỉ giữ lại phần Hà Nội (`Quote.hnTables`, cấp báo giá — không còn
nằm trong từng trang). Không tạo báo
giá, không thấy báo giá của người khác, **không export**.

---

## Trục 4 — chứng từ, hoá đơn, thanh toán

Chỉ mở **sau khi báo giá đã `converted`**. Hai endpoint ký chứng từ và hoá đơn đầu ra
dưới đây từ chối (403) nếu `quote.status` khác `converted` hoặc báo giá đã xoá mềm. (Khoản
chi ở trang Hóa đơn đầu vào — mục cuối của trục này — thì KHÔNG theo `quote.status`: nó theo
trạng thái **duyệt** của từng hàng bảng nội bộ.)

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

Trang **Hóa đơn đầu vào** tách nguyên tử theo đúng khuôn đó, trên một route khác
(`PUT /api/quotes/input-invoices/{quoteId}/{side}/{rid}` — mục "Đã chi từng hàng bảng nội bộ"
bên dưới):

| Trường bị đụng | Quyền cần |
|---|---|
| `paid` (đã chi — tiền RA), `paidProof` (ảnh ủy nhiệm chi) | `invoice:input:pay` |
| `invoiceDate` (Ngày hóa đơn), `accountingNote` (Ghi chú kế toán) | `invoice:edit` |

Vào route cần `invoice:page`; thiếu quyền của **bất kỳ** trường nào gửi lên → 403 và không ghi
gì. `invoice:pay` (ngày THU tiền — tiền VÀO) **không** dùng cho tiền RA, và `invoice:manage` bắc
cầu ra `edit` + `pay` nhưng không ra `invoice:input:pay`.

**Tình trạng hoá đơn được SUY RA, không lưu:**

| Điều kiện | Tình trạng |
|---|---|
| đã chốt, chưa có `invoiceNo` | Hoá đơn |
| có `invoiceNo` | Thanh toán |
| có `invoiceNo` **và** `paidAt` | Done |

Hai trang đọc **cùng một nguồn dữ liệu**: trang **Hóa đơn đầu ra** (`invoice:page`; tên cũ
"Hoá đơn", route vẫn là `#/invoices`) là nơi kế toán **nhập**; trang **Quản lý dự án**
(`invoice:read`) là nơi tham chiếu, chỉ xem. Nhập một chỗ, hiện cả hai.

Từ 2026-09-30 có thêm trang **Hóa đơn đầu vào** (`#/invoices-in`, cùng cổng `invoice:page`,
`GET /api/quotes/input-invoices`), liệt kê mọi **hàng bảng nội bộ đã duyệt** — mỗi hàng là một
khoản chi kế toán phải đòi hoá đơn đầu vào. "Đã duyệt" có hai dạng: Chi phí HCM / Phí khách hàng
duyệt **theo hàng** (`item.approved`, quyền `quote:internal:approve`); Báo giá Hà Nội duyệt ở
**mức báo giá** (`Quote.hnStatus = approved` — cờ `approved*` của từng hàng HN không phải nguồn sự
thật). Luật chọn hàng + tính tiền ở `src/inputInvoices.ts` (dùng đúng `extraTableSum`); danh sách
không bao giờ mang ảnh ủy nhiệm chi. Hàng chưa duyệt không cộng vào tổng báo giá nên không xuất
hiện — trừ hàng đã có dữ liệu kế toán, hiện ở mục "Cần chú ý" (cùng hàng không còn trong báo giá
và hàng của báo giá đã xoá). Từ 2026-10-06 trang **không còn chỉ xem**: kế toán ghi khoản chi của
từng hàng ngay tại đây (mục kế tiếp).

### Đã chi từng hàng bảng nội bộ — kế toán, ở trang Hóa đơn đầu vào

Khác hẳn hoá đơn ở trên (tiền VÀO, theo trang báo giá). Đây là chi phí **nội bộ** (HCM / HN /
phí khách) — tiền RA, tích theo **từng hàng**. Từ 2026-10-06 việc này thuộc về **kế toán**, làm
ngay trên trang Hóa đơn đầu vào (chủ repo: "cái thanh toán bên đó là cho kế toán, không nằm trong
kia nữa"):

```
PUT /api/quotes/input-invoices/{quoteId}/{side}/{rid}         invoice:page vào; quyền theo từng trường (bảng trên)
GET /api/quotes/input-invoices/{quoteId}/{side}/{rid}/proof   invoice:page + invoice:input:pay
```

* `side` = `sheet` (Chi phí HCM + Phí KH của mọi trang — gộp để "Chuyển loại" hcm↔khach không làm
  khoản mồ côi) | `hn` (`Quote.hnTables`). `rid` là mã nội bộ bền của hàng; không định vị theo
  `sheetId` vì Lưu báo giá = xoá trang rồi tạo lại.
* Dữ liệu ở bảng riêng `InputInvoiceEntry` (khoản) + `InputInvoiceProof` (ảnh, **chỉ thêm**): ghi
  **không** bump `Quote.updatedAt` (người đang soạn báo giá không ăn 409), không sinh `QuoteVersion`,
  có khoá lạc quan riêng của khoản (`baseVersion` lệch → 409 `khoan-chi-da-doi`).
* **TÍCH MỚI** chỉ cho hàng đã duyệt (HCM / Phí KH theo hàng; HN khi `hnStatus = approved`) → không
  thì 409 `hang-chua-duyet`. Khoản đã có thì sửa / bỏ tích / gỡ ảnh được kể cả khi hàng đã rời tập
  đó (bỏ duyệt, trả lại / giao lại HN, hàng bị xoá) — hàng hiện ở mục "Cần chú ý".
* Ảnh ủy nhiệm chi là **PII bên thứ ba**: chỉ `invoice:input:pay` xem; mỗi lần xem ghi
  `quote.internal.proof-view`. Thay / gỡ / bỏ tích chỉ **rút** ảnh vào lịch sử (`retiredAt`), không xoá.
* Bốn route cũ (`POST /{id}/extra/{sheetId}/{rid}/pay`, `GET …/proof`, `POST /{id}/hn/{rid}/pay`,
  `GET /{id}/hn/{rid}/proof` — quyền `quote:internal:pay` / `quote:internal:view`) **đã gỡ**: bundle cũ
  gọi vào nhận 404, không ghi gì. Màn soạn báo giá không còn cột / nút thanh toán; màn tài khoản chi phí
  (`quote:internal:view`) chỉ còn đọc "✓ Đã TT · ngày"; `quote:internal:pay` không còn tác dụng.
* Đường Lưu báo giá **đóng băng** bốn cờ cũ `paid/paidAt/paidById/paidProof` trong JSON hàng và chặn
  làm mất hàng ĐÃ CHI — bất biến 7 bên dưới.

**Kế toán vẫn không thấy báo giá** (không có `quote:read:*`; `GET /api/quotes/{id}` → 403), nhưng ghi
được trường kế toán của **hàng đã duyệt** — phạm vi `global` có chủ ý, như trang Hóa đơn đầu ra.
Phản hồi chỉ mang trường kế toán của đúng khoản đó: không tổng tiền báo giá, không thông tin khách,
không ảnh.

---

## Vai trò mặc định — ai chạm được trục nào

Đây là **mặc định** trong `src/permissions.ts`. Quyền cấp được **per-user** ở
trang Phân quyền, và ghi đè được theo **vai trò** qua bảng `RolePermission`, nên
một tài khoản cụ thể có thể khác bảng này. `admin` **luôn full**, không ghi đè
được (chống tự khoá).

| Vai trò | Nhãn | Trục 1 | Trục 2 | Trục 3 | Trục 4 |
|---|---|---|---|---|---|
| `admin` | Quản trị | toàn quyền, mọi báo giá | ✓ | giao/duyệt HN | ký mọi dự án, sửa + thu tiền; Hóa đơn đầu vào: như kế toán |
| `manager` | Account | tạo/sửa/xoá **của mình**, chốt/không chốt | ✓ | giao/duyệt HN | — (trừ khi được cấp riêng) |
| `account_hn` | Account HN | chỉ đọc/ghi báo giá **được giao**, view bị lược | — | **điền + gửi duyệt** | — |
| `hr` | Nhân sự | — | — | — | — |
| `accountant` | Kế toán | — | — | — | trang Hóa đơn đầu ra: sửa + đánh dấu thu tiền; trang Hóa đơn đầu vào: tích đã chi + ảnh chứng từ, ngày HĐ, ghi chú KT |

`hr` và `accountant` **không thấy báo giá**. Quyền mặc định của họ nằm ở domain
nhân sự: `hr` chỉ có `personnel:read:all`; `accountant` có thêm
`personnel:pay`, `personnel:accounting-note`, và bộ `invoice:page`/`edit`/`pay`/`input:pay`.
Kế toán không thấy báo giá, nhưng ghi trường kế toán của hàng đã duyệt ở trang Hóa đơn đầu vào
(phạm vi `global` có chủ ý — xem mục trên). Vai trò `accountant` đã bị ghi đè quyền (bảng
`RolePermission`) hoặc kế toán có tập quyền riêng thì **không tự nhận** `invoice:input:pay` — admin
phải tích tay ở trang Phân quyền.

---

## Bất biến — thứ không được phá

1. **`converted` không xoá được**, kể cả `quote:delete:all` (`deleteQuote`). Nó là dữ liệu KPI và
   là gốc của luồng hoá đơn. **Nhưng SỬA được** bởi người có `quote:send` cho tới khi xuất hoá đơn:
   Khoá sửa = đã có `invoiceNo` ở bất kỳ sheet nào (`daXuatHoaDon`, `src/quoteUtils.ts`). Tức con số của một báo giá đã chốt CÓ THỂ còn đổi — đối chiếu doanh thu/KPI phải tính tới
   điều đó. (Tài liệu trước 2026-09-23 ghi "converted là bất biến, không sửa" — sai từ 2026-09-07.)
2. **Bảng nội bộ không lọt vào Excel gửi khách.** Được bảo vệ bằng kiến trúc chứ
   không bằng bộ lọc: `src/excel.ts` chỉ đọc `sheet.items`, còn `extraTables`
   không hề xuất hiện trong file đó.
3. **`quote:export` là năng lực riêng**, không suy ra từ quyền đọc.
4. **Trạng thái do server sở hữu thì phải lấy lại từ CSDL** trước khi ghi: cờ
   duyệt hàng nội bộ, bốn cờ thanh toán cũ trong JSON hàng (từ 2026-10-06 **đóng băng** cho
   mọi người — không ai đổi được qua đường Lưu), bảng HN đã chốt. Xem
   [DATA_FLOW.md](../architecture/DATA_FLOW.md#32-trong-transaction) — thiếu bước
   này thì client tự đóng dấu duyệt và tự đánh dấu đã trả tiền cho chính mình.
5. **Trạng thái mức sheet phải được BÊ sang bản mới** mỗi lần Lưu (Lưu = xoá
   sheet + tạo lại). Chữ ký, số hoá đơn, ngày thanh toán, ý kiến khách đều sống
   ở đó.
6. **Đổi khách hàng (danh mục) đi qua cùng cổng sửa báo giá, cộng một lớp riêng.** Khách mới phải
   tồn tại (chưa xoá) và người đổi phải `customer:read` được nó (`kiemKhachDuocGan`, cả lúc tạo) — không thì đoán
   id là gắn được khách của người khác rồi đọc mã + tên qua phản hồi. Lớp này chỉ chạy khi `customerId` **đổi**:
   màn soạn gửi lại cả báo giá mỗi lần Lưu, kể cả `customerId` cũ (khách đã chuyển chủ / bị xoá sau khi gắn
   vẫn phải Lưu được). Đã xuất hoá đơn thì khoá như mọi trường khác; account phụ không có vùng "Báo giá chính"
   bị gỡ `customerId` khỏi payload (`FIELD_VUNG_MAIN`). Nhật ký `quote.update` ghi mã + tên khách trước/sau.
7. **Khoản kế toán chỉ ghi qua trang Hóa đơn đầu vào, và hàng ĐÃ CHI không biến mất qua đường Lưu.**
   Đường Lưu báo giá, nhân bản, luồng HN, GDPR, bản chụp phiên bản đều **không** ghi
   `InputInvoiceEntry` / `InputInvoiceProof`. "Đã chi" là trạng thái **hiệu lực** — khoản thắng cờ JSON
   cũ (`trangThaiHieuLuc`, `src/khoanChi.ts`), nên khoản kế toán đã bỏ tích không chặn oan. Xoá hàng /
   bảng / trang có hàng đã chi → **400** `hang-da-chi` nêu tên hàng; xoá mềm báo giá có khoản đã chi →
   400 `bao-gia-co-khoan-da-chi`; người không có `invoice:input:pay` đổi số lượng / đơn giá / số ngày
   của hàng đã chi → 400; dữ liệu cũ có hàng đã trả THIẾU mã nội bộ (`rid`) → cả lần Lưu bị từ chối, 400
   `hang-da-chi-thieu-ma` (lưu sẽ cấp mã mới và xoá im cờ + ảnh — quản trị chạy `backfillKhoanChi --sua-rid`).
   Hai hàng TRÙNG `rid` thì lần Lưu tự tách, mỗi hàng giữ cờ của chính nó. Là 400 chứ không phải 409: 409 ở
   màn soạn mở hộp "người khác vừa lưu" và gợi ý tải lại, còn 400 chỉ toast và **giữ** phần đang soạn. Nạp
   Excel mà làm mất hàng đã chi (Thay toàn bộ, xoá sheet) bị chặn ngay ở hộp nạp. Đường Lưu khoá `Quote`
   (FOR NO KEY UPDATE) **trước** khi đọc khoản, kế toán ghi dưới `Quote FOR SHARE` — đường Lưu viết mới
   phải theo đúng thứ tự này.

## Cái tài liệu này KHÔNG mô tả

* Cách tính tiền (nhóm, hệ số ngày, làm tròn) — đọc `src/money.ts`.
* Cấp số báo giá và mã dự án — `src/quoteNumber.ts`, `src/codeAllocator.ts`.
* Hai đường xuất file — [DATA_FLOW.md](../architecture/DATA_FLOW.md#4-đường-xuất-excelpdf).
* Ma trận quyền đầy đủ theo endpoint — [ROLES_PERMISSIONS.md](ROLES_PERMISSIONS.md).
