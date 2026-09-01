# Tính năng nghiệp vụ

Tài liệu này mô tả **hệ thống làm được gì cho người dùng**. Nó cố ý **không** nhắc
lại stack, cách dựng máy, bảng lệnh npm hay cây thư mục — những thứ đó nằm ở:

- [README.md](../../README.md) — công nghệ và hai bài toán khó của sản phẩm
- [docs/development/SETUP.md](../development/SETUP.md) — dựng môi trường, bảng npm script
- [docs/architecture/ARCHITECTURE.md](../architecture/ARCHITECTURE.md) — hệ thống ghép lại thế nào
- [docs/product/ROLES_PERMISSIONS.md](ROLES_PERMISSIONS.md) — ai được gọi endpoint nào (138 endpoint)

QuanLY là **công cụ nội bộ** của Gia Nguyễn / Colorfull. Không có khách hàng ngoài,
không có gói cước, không có self-service đăng ký: tài khoản do admin mời.

---

## 1. Báo giá

### 1.1 Vòng đời

```
Nháp (draft) ──┬──► Đã chốt  (converted)  — khách đồng ý
               └──► Không chốt (lost)     — khách từ chối
```

**Không có duyệt nội bộ.** Chuỗi `pending → approved → sent` từng tồn tại đã bị bỏ
khỏi luồng; "duyệt" duy nhất có ý nghĩa là quyết định của khách. Gửi cho khách =
tải Excel/PDF rồi tự gửi, **không phải một trạng thái**.

Bốn giá trị cũ `pending`, `approved`, `rejected`, `sent` **vẫn còn trong enum
`QuoteStatus`** (`prisma/schema.prisma`) để không phải migrate dữ liệu lịch sử —
gặp chúng trong DB hay trong biểu đồ phễu thì đó là **dữ liệu cũ, không phải bug**.

Chỉ báo giá **đã chốt** mới chảy sang trang Quản lý dự án, trang Hoá đơn, số doanh
thu và luồng ký chứng từ.

### 1.2 Trình soạn báo giá — lưới kiểu Excel

Đây là màn hình người dùng ngồi lâu nhất, và là nơi tập trung phần lớn công sức kỹ thuật.

**Công thức.** Ô số nhận công thức mở đầu bằng `=`:

| Viết được | Ví dụ |
|---|---|
| Số học + ngoặc | `=(120+30)*2` |
| Dấu nhân kiểu người Việt | `=5x3`, `=5×3` |
| Phần trăm | `=1200*8%` |
| Tham chiếu ô / dải ô | `=G3*E3`, `=SUM(H3:H8)` |
| Hàm | `SUM · AVERAGE/AVG · PRODUCT · MIN · MAX · ROUND · ROUNDUP · ROUNDDOWN · INT · ABS · CEILING · FLOOR` |

Tham số ngăn bằng `;` (quy ước Excel bản Việt), còn `,` là **dấu thập phân**.
Bấm hoặc kéo chuột lên ô khác để chèn tham chiếu; có thanh công thức (fx) kèm gợi ý
tên hàm. Ô chứa công thức hiện dấu `ƒ` ở góc; bấm vào `ƒ` để xem công thức gốc lẫn
kết quả — **mọi vai trò đều xem được, kể cả tài khoản chỉ-đọc và trên điện thoại**,
vì quản lý cần kiểm "người ta đã gõ gì".
Nguồn: [`web/src/lib/formula.ts`](../../web/src/lib/formula.ts).

**Bộ gõ tiếng Việt.** Lưới không bắt phím thô: nhấn Enter để chốt từ trong
OpenKey/Unikey **không** làm nhảy ô. Đây là ràng buộc tuyệt đối, xem
[AGENTS.md](../../AGENTS.md).

**Copy / paste.** Dùng sự kiện `copy`/`cut`/`paste` của trình duyệt chứ không bắt
tổ hợp phím, nên chạy đúng trên macOS/Safari/Firefox, qua chuột phải, trên màn cảm
ứng, và cả khi mở bằng IP nội bộ (http). Lưới hiểu:

- ô nhiều dòng của Excel (parser RFC-4180, có unit test) — không vỡ hàng;
- **dán lại nguyên bảng mà chính app đã xuất ra** (kèm cột STT) → tự dựng lại
  nhóm lớn, nhóm con, hàng con, dòng thông tin, map đúng cột
  ([`web/src/lib/clipboard.ts`](../../web/src/lib/clipboard.ts));
- dán một giá trị ra cả vùng đang chọn;
- số kiểu Việt (`1.234`) đọc đúng thành 1234;
- copy **ra** Excel/Word giữ được bảng (text/html);
- tài khoản chỉ-đọc vẫn copy dữ liệu ra được (không sửa/cắt/dán).

Có Ctrl+Z / Ctrl+Y và fill-down (Ctrl+D); hoàn tác vẫn đúng sau khi dán/cắt/fill.

### 1.3 Cấu trúc một sheet báo giá

| Loại dòng | Cộng vào nhóm chính | Cộng vào Tổng cộng | Ghi chú |
|---|---|---|---|
| **Nhóm** (A, B, C…) | — | ✅ | có Thành Tiền nhóm, nhân Số Lượng nếu bật |
| **Nhóm con** | ❌ | ✅ | thụt lề + dấu `↳`; **không chiếm chữ A/B/C** |
| **Hàng con** (`↳`) | ✅ | ✅ | chi tiết trong một hạng mục |
| **Dòng thông tin** | ❌ | ❌ | ghi chú thuần, không tính tiền |

Giảm giá = nhập **đơn giá âm**. Khi xuất Excel, nhóm con hiển thị **giống hệt trên
màn hình** (dấu `↳`, nền nhạt hơn, thứ tự chữ nhóm không lệch).

VAT và Tổng cộng cập nhật ngay khi gõ. **Cùng một công thức tiền** chạy ở bốn nơi —
[`shared/quote-math.ts`](../../shared/quote-math.ts) (frontend),
[`src/money.ts`](../../src/money.ts) (backend), [`src/excel.ts`](../../src/excel.ts)
(file Excel) và [`src/pdf.ts`](../../src/pdf.ts) (file PDF) — nên **số trên màn hình
= số trong CSDL = số trong Excel = số trong PDF**.

> Lưu ý cho người bảo trì: **chỉ frontend `import` thẳng `shared/quote-math.ts`**.
> `src/money.ts` tính bằng `Prisma.Decimal` (tiền không dùng float), còn `excel.ts`
> và `pdf.ts` **khai lại công thức tại chỗ** vì runtime chạy trên `src/` nên đường
> dẫn `../shared/quote-math.js` không resolve được trong container. Nghĩa là sửa
> công thức phải sửa **cả bốn nơi**; chốt chặn là bộ **vector vàng**
> `web/src/lib/quoteMath.test.ts` (18 bài, chạy bằng `npm run web:test`).

### 1.4 Bên gửi / bên nhận

- **Công ty** chọn lúc tạo báo giá rồi **khoá** ở màn sửa.
- **Địa chỉ bên gửi** chỉ-đọc, luôn bám theo địa chỉ công ty.
- Người gửi / chức danh / điện thoại bên gửi: nhập tay, chảy thẳng ra Excel.
- **Bên nhận**: tên khách, người liên hệ, email, điện thoại, địa chỉ — tất cả ra Excel.

### 1.5 Bảng nội bộ và duyệt theo hàng

Mỗi sheet báo giá có thêm các **bảng nội bộ** ba loại — **Chi Phí HCM**, **Báo Giá
Hà Nội**, **Phí Khách Hàng**. Chúng là lưới đầy đủ (template, công thức, nhóm,
copy/paste) nhưng **KHÔNG bao giờ xuất ra Excel/PDF cho khách**; tổng từng loại đổ
sang trang Quản lý dự án.

Hai loại **Chi Phí HCM** và **Phí Khách Hàng** có cột **Duyệt** theo từng hàng:

- chỉ người có quyền `quote:internal:approve` tick được (mặc định: admin);
- **chỉ hàng đã duyệt mới cộng vào tổng**, kèm dấu ngày duyệt + người duyệt;
- chốt chặn nằm ở **server**, khớp theo `rid` từng hàng
  (`reconcileExtraApprovals` trong [`src/services/quoteService.ts`](../../src/services/quoteService.ts)) —
  gửi `approved: true` trong payload **không** tự duyệt được.

Riêng từng hàng nội bộ còn đánh dấu được **đã thanh toán** kèm **ảnh chứng từ**
(quyền `quote:internal:pay`). Ảnh ở đây **vẫn là data-URL base64 nằm trong JSON của
sheet** — khác với chứng từ Nhân sự (mục 6) đã chuyển sang kho object. Bù lại nó
không đi kèm mọi lần đọc báo giá: phải gọi riêng
`GET /:id/extra/:sheetId/:rid/proof` mới lấy ảnh.

### 1.6 Danh mục rạp gắn vào lưới

Trong lưới có nút mở **danh mục kích thước theo rạp**: chọn rạp → chọn hạng mục →
chèn thẳng thành các dòng đã điền sẵn tên/đơn vị/kích thước. Khi chèn, **tham chiếu
công thức của các dòng bên dưới được dịch lại** theo số dòng mới thêm.

### 1.7 Nhập từ file Excel

`POST /api/quotes/import-excel` **chỉ đọc**: nó parse file rồi trả bản xem trước
"trước / sau". Người dùng nhìn xong mới bấm "Nạp vào báo giá", và lúc đó dữ liệu
chảy qua **đúng đường lưu cũ** (`PUT /api/quotes/:id`) nên giữ nguyên mọi lớp:
kiểm dữ liệu zod, phân quyền, khoá lạc quan, lưu phiên bản, tính lại tổng ở server.
Cố ý không đẻ thêm đường ghi nào.

### 1.8 Phiên bản, chống ghi đè, làm việc cùng lúc

- Mỗi lần lưu sinh một **`QuoteVersion`** — snapshot đầy đủ trường + sheet + item.
  Xem lại từng bản (`GET /:id/versions/:v`) và **so sánh hai bản** (`/versions/:a/diff/:b`).
- **Khoá lạc quan**: client gửi `baseUpdatedAt` kèm lệnh lưu; ai lưu sau khi người
  khác đã lưu sẽ nhận 409 thay vì âm thầm đè. Trường này ở server là **tuỳ chọn**
  (`src/validators.ts`) — client nào không gửi thì bỏ qua kiểm tra. App React luôn
  gửi; đó chính là lý do SPA vanilla cũ (không gửi) bị gỡ, xem
  [ADR 0006](../adr/0006-go-spa-vanilla-cu.md).
- **Presence qua SSE**: đang mở một báo giá thì thấy "X đang sửa". Đây là trạng thái
  in-process — chạy nhiều replica thì danh sách không đầy đủ (xem
  [SECURITY_MODEL.md](../architecture/SECURITY_MODEL.md)).
- **Thành viên báo giá** (`PUT /:id/members`): người tạo hoặc admin thêm đồng nghiệp
  vào để cùng xem/sửa một báo giá cụ thể.
- Nhân bản báo giá: `POST /:id/duplicate`.

---

## 2. Xuất file

| Đầu ra | Endpoint | Ghi chú |
|---|---|---|
| **Excel** `.xlsx` | `GET /api/export/:id.xlsx` | đổ dữ liệu vào **file mẫu thật của công ty** — giữ logo, font, viền, ô gộp |
| **PDF** | `GET /api/export/:id.pdf` | pdfkit, toán tiền lặp lại **y hệt** Excel/lưới |
| **Hợp đồng dịch vụ** `.docx` | `GET /api/personnel/:id/contract` | sinh từ `templates/hd-dichvu-template.docx` cho hồ sơ nhân sự |

**Bốn mẫu Excel, hai công ty** (bảng ánh xạ ô nằm ở
[`src/templateConfigs.ts`](../../src/templateConfigs.ts), writer ở [`src/excel.ts`](../../src/excel.ts)):

| Mẫu (code) | Công ty | File | Đặc điểm |
|---|---|---|---|
| GN không ngày (`marico_decor`) | Gia Nguyễn | `templates/GN_KhongNgay.xlsx` | header tiếng Việt một dòng, không có cột Số ngày |
| GN có ngày (`unibenfood`) | Gia Nguyễn | `templates/Unibenfood.xlsx` | có cột **Số ngày** |
| GN Banner (`gn_banner`) | Gia Nguyễn | `templates/GN_KhongNgay.xlsx` | cùng file GN không ngày, **khác cách đánh STT** (nhóm con đánh 1,2,3; mục dưới không đánh số) |
| CLF không ngày (`clofull_decor`) | Colorfull | `templates/CLF_KhongNgay.xlsx` | có cột Chi Tiết; khối "Kính gửi" + letterhead người gửi ở F1 |

Ánh xạ bên gửi / bên nhận vào ô Excel:

- **GN không ngày** — khách C2/C3, Tel C4, Địa chỉ C5; người gửi F3 (tên _ chức danh), SĐT F4, địa chỉ F5.
- **GN có ngày** — khách C1/C2, Tel C3, Địa chỉ C4; người gửi E2, SĐT E3, địa chỉ E4.
- **CLF** — khối "Kính gửi" (F3): công ty + người liên hệ + ĐT + Đ/c + email; letterhead (F1): tên công ty + địa chỉ + tên · chức danh · SĐT.

Một báo giá nhiều sheet xuất ra **một file Excel nhiều sheet**, ghép ở mức XML/zip
([`src/xlsxStitcher.ts`](../../src/xlsxStitcher.ts)) để không đụng vào định dạng của mẫu.

**Không xuất ra khách:** bảng nội bộ (HCM / Hà Nội / Phí KH), cột ghi chú nội bộ,
và **Ngày thi công** (`executionDate`) — ngày này chỉ dùng trong app và trang Quản lý dự án.

Có Redis thì việc xuất chạy trên **worker nền** (BullMQ) và client hỏi tiến độ qua
`GET /api/jobs/:queue/:id`; không có Redis thì xử lý inline.

---

## 3. Luồng Account Hà Nội

Vai trò `account_hn` tồn tại để **một người ngoài team báo giá điền phần giá Hà Nội**
mà không nhìn thấy gì khác.

```
Quản lý giao  →  Account HN điền  →  Gửi duyệt  →  Quản lý duyệt / trả lại
  assigned                             submitted        approved / rejected
```

- Account HN **chỉ thấy danh sách báo giá được giao**; giá khách, thông tin khách và
  các menu Tổng quan / Tạo báo giá / Quản lý dự án đều bị ẩn **và bị chặn ở server**
  (không phải chỉ ẩn menu).
- Màn điền có nhiều **sheet Hà Nội** dạng tab, mỗi sheet chọn mẫu riêng, tổng gộp mọi sheet.
- Cột riêng của họ: Người giao · Số sheet HN · Tổng HN · trạng thái HN.

Mã: [`src/hnWorkflow.ts`](../../src/hnWorkflow.ts), màn hình
[`web/src/pages/AccountHnView.tsx`](../../web/src/pages/AccountHnView.tsx).

---

## 4. Quản lý dự án

Theo dõi báo giá **đã chốt** theo bố cục bảng sản xuất/hoá đơn. Mỗi **sheet** = một
dòng; báo giá nhiều sheet thì Mã Sản Xuất thêm hậu tố `_1`/`_2`…, còn Hạng Mục lấy
tên sheet.

**Ai xem được:** ai có `user:manage`, `invoice:read` **hoặc** `invoice:page` thấy
**mọi** dự án đã chốt; người còn lại (điển hình là account chỉ có quyền ký) thấy
**dự án do chính mình tạo** — server tự thêm `createdById = tôi` vào truy vấn, không
phải lọc ở giao diện. `account_hn` bị chặn cả route lẫn API analytics.

Bảng 23 cột. Bốn cột đầu (Trạng thái · Phim · Hạng Mục · Báo Giá) **khoá cố định**
để cuộn ngang vẫn đối chiếu được.

Cột **tự lấy** từ báo giá: Báo Giá (trước VAT) · Thành Tiền VAT · Mã Sản Xuất ·
Cty Xuất Hoá Đơn · Ngày Thi Công · Team client (mã KH) · Account (người tạo).

Cột **tổng hợp**: Chi Phí HCM / Báo Giá Hà Nội / Phí Khách Hàng = tổng các bảng nội
bộ cùng loại của sheet đó — **HCM và Phí KH chỉ tính hàng đã duyệt**, Hà Nội tính tất cả.

**Ký chứng từ** theo từng sheet: `quote:sign:all` ký mọi dự án, `quote:sign:own` chỉ
ký dự án do mình tạo; ký xong hiện "✓ Đã Ký" kèm tên và ngày. Cột cũ `User.canSign`
vẫn còn trong CSDL nhưng **đã bắc cầu** thành `quote:sign:own` khi resolve quyền
(`resolveUserPermissions` trong [`src/permissions.ts`](../../src/permissions.ts)) —
đừng thêm nhánh kiểm `canSign` mới.

Sửa một ô chỉ cập nhật đúng dòng đó, không vẽ lại cả trang (không mất focus / vị trí cuộn).

---

## 5. Hoá đơn và công nợ (kế toán)

Trang **Hoá đơn** thay bảng Excel theo dõi hoá đơn của kế toán. **Cùng nguồn dữ liệu**
với Quản lý dự án (bảng `QuoteSheet`): kế toán **nhập ở đây**, trang Dự án chỉ **tham chiếu**.

- Kế toán nhập: Hạng mục · PO/HĐ · CTy (GN/SM/CLF) · Số hoá đơn · Ngày hoá đơn ·
  Hình thức thanh toán · Ngày đóng đơn hàng · Link hoá đơn · Chứng từ gửi đi / trả về · Năm · Note.
- **Ngày thanh toán** tách thành quyền riêng `invoice:pay` — người nhập hoá đơn
  không mặc nhiên đánh dấu được đã thu tiền.
- **Tình trạng HĐ tự động** chuyển "Hoàn tất" khi có đủ Số hoá đơn + Ngày hoá đơn (không tick tay).
- **Công nợ** = số ngày từ Ngày hoá đơn khi chưa thanh toán, **tô đỏ khi quá hạn**.
  Hạn tính theo **hạn công nợ riêng của từng khách** (đặt ở trang Mã khách hàng);
  khách chưa đặt thì dùng ngưỡng mặc định chỉnh được ngay trên thanh công cụ.
- Ô bắt buộc chưa điền **tô hồng**, điền rồi trở lại nền trắng.

Có thêm màn **chỉ-xem bảng nội bộ** (`quote:internal:view`) cho tài khoản phụ trách
chi phí: thấy bảng nội bộ của một báo giá và đánh dấu thanh toán từng hàng, **không**
thấy giá khách, khách hàng hay báo giá chính — server đã lược dữ liệu trước khi trả.

---

## 6. Nhân sự

Hai màn dùng chung một nguồn dữ liệu:

- **Hồ sơ nhân công theo dự án** (`/api/personnel`) — hồ sơ từng người cho từng dự án.
- **Danh bạ nhân viên** (`/api/employees`) — đúng 10 trường nhóm "Cá nhân" của hồ sơ
  trên, không lặp lại dữ liệu.

Hệ thống làm được:

- **Tính thuế TNCN** (`computeTax`) và **thu nhập chịu thuế** ngay lúc đọc bản ghi.
- **Tham chiếu dự án**: hồ sơ tự nối với báo giá/dự án tương ứng (`buildProjectRef`).
- **Đánh dấu đã thanh toán** kèm ngày — quyền `personnel:pay` (kế toán). Người có
  quyền này **không sửa được** nội dung hồ sơ.
- **Xác nhận đã ký** kèm ngày — quyền `personnel:confirm` (chỉ admin).
- **Ghi chú kế toán** — cột riêng, quyền `personnel:accounting-note`.
- **Ảnh chứng từ thanh toán** ghi mới **luôn vào kho object** (S3/MinIO) với đường
  ký tên tạm thời để tải. Bản ghi cũ còn base64 trong cột `paymentProof` thì đọc vẫn
  rơi về đó — cột cũ chỉ bỏ ở một migration riêng sau khi xác minh 100% đã chuyển
  (`npm run proof:migrate` / `proof:verify`). Quyền tải ảnh bám vào **quyền đọc hồ sơ**,
  không bám vào "ai đã tải lên".
- **Sinh hợp đồng dịch vụ `.docx`** từ mẫu công ty.
- **Mã hoá PII khi lưu**: CCCD, số tài khoản, lương mã hoá AES-256-GCM khi có
  `PII_ENC_KEY`. Khi bật mã hoá, **CCCD bị loại khỏi cột tìm kiếm** `searchText` —
  vì cột đó nằm phẳng ngay cạnh trong cùng bản dump, để CCCD ở đó thì mã hoá chỉ còn
  là trang trí. Tra CCCD bằng-đúng vẫn chạy qua chỉ mục mù.

---

## 7. Khách hàng

- Mã khách hàng + tên công ty, tìm kiếm có debounce, sắp xếp, phân trang.
- **Ghi chú / theo dõi khách** (`POST /:id/notes`, quyền `customer:note:add`).
- **Hạn công nợ riêng cho từng khách** — trang Hoá đơn dùng số này để tô đỏ.
- Phạm vi dữ liệu cô lập ở **server** theo người sở hữu (`customer:read:own` so với
  `customer:read:all`); giao diện không nới lỏng gì thêm.

---

## 8. Danh mục rạp

Danh sách các hạng mục thường dùng **theo từng rạp / địa điểm**, bố cục kiểu danh bạ:
trái là danh sách rạp, phải là hạng mục của rạp đang chọn.

- Mỗi rạp có **từ khoá** (tag) — trim, bỏ rỗng, bỏ trùng, tối đa 20 tag mỗi rạp,
  mỗi tag tối đa 40 ký tự, nên không đẻ ra `"HCM "` và `"HCM"` thành hai chip khác nhau.
- Mỗi hạng mục có số đo (không cho số âm) + đơn vị; `m^2`, `m²`, `m 2` chuẩn hoá về `m2`.
- **Gộp rạp trùng** (`POST /:id/merge`) và **gắn tag hàng loạt** (`POST /tags/bulk`).
- Danh mục này là nguồn cho bộ chèn hạng mục trong trình soạn báo giá (mục 1.6).

Các cột `region` / `cluster` / `code` là di sản từ file Excel cũ — **vẫn còn trong
CSDL** để dữ liệu cũ không vỡ nhưng **đã bỏ khỏi giao diện**.

---

## 9. Tổng quan

Chọn kỳ (7 / 30 / 90 ngày · quý · năm) rồi xem:

- **KPI có xu hướng** so với kỳ liền trước;
- **biểu đồ doanh số theo ngày** (SVG tự vẽ, không thư viện chart);
- **phễu / pipeline** theo kỳ kèm tỷ lệ thắng;
- **"Cần xử lý"** — công nợ và chứng từ rút từ Quản lý dự án;
- **bảng xếp hạng** — chỉ người xem được mọi báo giá.

Phân quyền là **deny-by-default**: "tạo được báo giá" **không** suy ra "đọc được số
liệu" — thiếu `quote:read:own` thì các endpoint analytics trả 403.

---

## 10. Nền tảng dùng chung

| Tính năng | Chi tiết |
|---|---|
| **Tìm kiếm không dấu** | Cột `searchText` chuẩn-hoá bỏ dấu + chỉ mục GIN trigram (`pg_trgm`) trên báo giá, khách hàng, nhân sự → gõ sai dấu / không dấu vẫn ra. Thêm `GET /api/search` tìm toàn cục. |
| **Thông báo trong app** | Danh sách thẻ đã/chưa đọc, lọc, "đánh dấu đã đọc tất cả", bấm vào là deep-link sang đúng báo giá. Khử trùng lặp ở **cả hai đầu**: backend bỏ qua bản giống hệt chưa đọc trong 5 phút, frontend gộp lại lần nữa cho dữ liệu cũ. |
| **Realtime** | SSE (`/api/stream/events`) đẩy tín hiệu để client làm mới cache — không phải WebSocket, xem [ADR 0004](../adr/0004-sse-not-websocket.md). |
| **Webhook ra ngoài** | Đăng ký endpoint theo sự kiện (`quote.created`, `quote.updated`, `quote.converted`, `customer.created`…), xem lại lịch sử gửi (`/:id/deliveries`). |
| **Email / Telegram** | Gửi qua hàng đợi nền khi có Redis; kênh và mức độ ồn cấu hình ở `Setting` `notif.channels`. |
| **Nhật ký hoạt động** | Lọc theo hoạt động / đối tượng / khoảng ngày, phân trang, nhãn tiếng Việt. Danh sách mã hoạt động ở frontend bị khoá hai chiều với backend bằng test `w2-auditActionCoverage` — thiếu **hoặc thừa** một mã đều làm CI đỏ. Quyền xem chi tiết (`audit:view:full`) tách riêng khỏi quyền xem danh sách. |
| **Phân quyền động** | Admin sửa được ma trận **vai trò × quyền** ngay trên giao diện, và tick **quyền cho từng tài khoản**. Vai trò `admin` **khoá cứng** (luôn đủ quyền — chống tự khoá mình ra ngoài). |
| **Tài khoản** | Mời qua email (không đặt mật khẩu hộ), khoá / mở khoá (**không xoá** tài khoản đã kích hoạt — nghỉ việc thì khoá), tự đổi mật khẩu có thanh đo độ mạnh. |
| **MFA (TOTP)** | Bật bằng QR + xác nhận, có mã dự phòng dùng-một-lần; tắt phải nhập lại mật khẩu + mã. |
| **GDPR** | Xuất và xoá dữ liệu cá nhân — cho chính mình (`/gdpr/me/*`) và cho user bất kỳ (admin). |
| **Sao lưu** | `POST /api/admin/backup.dump` cho admin tải bản dump (POST chứ không GET — thao tác nặng, và client Bearer vẫn qua được vì `csrfGuard` chỉ áp cho phiên cookie). Quy trình đầy đủ ở [BACKUP_RESTORE.md](../operations/BACKUP_RESTORE.md). |
| **PWA** | Cài được như app; service worker cache app-shell nhưng **không** cache `/api` (dữ liệu luôn lấy mạng). |
| **Responsive** | Dùng được trên điện thoại, máy tính bảng, desktop — kể cả lưới báo giá. |

---

## 11. Vai trò

Enum `Role` có **năm** giá trị: `admin`, `manager`, `account_hn`, `hr`, `accountant`.
Vai trò "Nhân viên" đã bỏ khỏi enum từ 2026-06-15.

Nhưng **vai trò chỉ là bộ quyền mặc định**, không phải chốt chặn. Chốt thật là
**quyền** (`quote:create`, `invoice:pay`, `personnel:confirm`…), và quyền có thể
ghi đè ở hai mức:

1. **theo vai trò** — bảng `RolePermission`, admin sửa trên trang Phân quyền;
2. **theo từng tài khoản** — `User.permissions`.

Cả hai được resolve lại **mỗi request** từ CSDL. Vì vậy **đừng đọc bảng vai trò như
một danh sách cố định** — nguồn sự thật là
[`src/permissions.ts`](../../src/permissions.ts) và ma trận đầy đủ 138 endpoint ở
[ROLES_PERMISSIONS.md](ROLES_PERMISSIONS.md), có
`scripts/ci/endpoint-inventory.mjs --check` đối chiếu ở CI.

Ý định nghiệp vụ của từng vai trò, để đọc mã cho dễ:

| Vai trò trong mã | Nhãn trên giao diện | Ý định |
|---|---|---|
| `admin` | Quản trị | toàn quyền; duyệt hàng nội bộ, ký mọi chứng từ, xác nhận hồ sơ nhân sự đã ký |
| `manager` | Account | làm báo giá của mình + báo giá được thêm làm thành viên; chốt/không-chốt theo khách; xem dự án của mình |
| `account_hn` | Account HN | **chỉ** điền giá Hà Nội của báo giá được giao |
| `hr` | Nhân sự | **chỉ xem** hồ sơ nhân sự |
| `accountant` | Kế toán | xem hồ sơ nhân sự + đánh dấu thanh toán + ghi chú kế toán; nhập hoá đơn |

> Cột nhãn lấy từ `ROLE_LABEL` ở [`web/src/lib/format.tsx`](../../web/src/lib/format.tsx)
> — một nguồn duy nhất cho mọi màn. Đáng chú ý: `manager` hiện là **"Account"**, không
> phải "Quản lý", để khỏi lẫn với "Quản trị" (`admin`). Tên trong mã vẫn là `manager`;
> khi đọc log hay nhật ký thì thấy tên mã, không thấy nhãn.

---

## 12. Những thứ cố ý KHÔNG có

Ghi ra để người sau khỏi đi tìm:

- **Không có duyệt báo giá nội bộ.** Đã từng có, đã bỏ vì hoá ra chỉ là thủ tục.
- **Không có SSO / OIDC.** Đăng nhập cục bộ; kiến trúc đã dọn sẵn đường
  ([ADR 0007](../adr/0007-san-sang-cho-oidc.md)) nhưng chưa nối.
- **Không có SPA vanilla nữa.** Frontend duy nhất là React trong `web/`; bản vanilla
  cũ ở `public/js` đã gỡ hẳn 2026-08-26 vì mang hai lỗi mất dữ liệu mà React không có
  — [ADR 0006](../adr/0006-go-spa-vanilla-cu.md).
- **Không tự đăng ký tài khoản.** Admin mời.
- **Không có màn hình quản lý bảng giá sản phẩm.** Bảng `Product` / `ProductPriceTier`
  và các quyền `product:read` · `product:read:cost` · `product:manage` **có thật** và
  tìm kiếm toàn cục đã dùng `product:read`, nhưng **không có route `/api/products` và
  không có trang nào trong `web/src/pages`**. Nghĩa là dữ liệu sản phẩm chỉ vào được
  bằng seed/SQL. Đừng tưởng đây là màn hình bị xoá — nó chưa từng được dựng.

Danh sách rủi ro và nợ kỹ thuật còn lại: [docs/REMAINING_RISKS.md](../REMAINING_RISKS.md).
