# Tính năng nghiệp vụ

Tài liệu này mô tả **hệ thống làm được gì cho người dùng**. Nó cố ý **không** nhắc
lại stack, cách dựng máy, bảng lệnh npm hay cây thư mục — những thứ đó nằm ở:

- [README.md](../../README.md) — công nghệ và hai bài toán khó của sản phẩm
- [docs/development/SETUP.md](../development/SETUP.md) — dựng môi trường, bảng npm script
- [docs/architecture/ARCHITECTURE.md](../architecture/ARCHITECTURE.md) — hệ thống ghép lại thế nào
- [docs/product/ROLES_PERMISSIONS.md](ROLES_PERMISSIONS.md) — ai được gọi endpoint nào (145 endpoint)

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

Chỉ báo giá **đã chốt** mới chảy sang trang Quản lý dự án, trang Hóa đơn đầu ra, số doanh
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
| **Nhóm** (A, B, C…) | — | ✅ | có Thành Tiền nhóm, nhân Số Lượng nếu bật. Nhóm có Số Lượng > 1 thì ô "Hiện Thành Tiền nhóm" **tự bật và bị khoá bật** (bỏ tích lúc đó là mất hệ số ×N, tổng sai im lặng) — luật đầy đủ ở mục **Ô "Hiện Thành Tiền nhóm"** ngay dưới bảng |
| **Nhóm con** | ❌ | ✅ | thụt lề + dấu `↳`; **không chiếm chữ A/B/C** |
| **Hàng con** (`↳`) | ✅ | ✅ | chi tiết trong một hạng mục. **Nút "↳ thêm hàng con" trên lưới đã bỏ (2026-09-23, chủ repo: "không còn cần sử dụng")** — hàng con có sẵn trong báo giá cũ vẫn hiển thị, tính tiền và xuất Excel như trước |
| **Dòng thông tin** | ❌ | ❌ | ghi chú thuần, không tính tiền |

**Ô "Hiện Thành Tiền nhóm".** Tắt thì tổng sheet KHÔNG nhân Số Lượng nhóm vào tiền các mục con
(`sheetSubtotalGrouped` ép hệ số về 1): nhóm "SL 3" ra tổng nhỏ hơn thật đúng 3 lần, và file Excel
xuất ra cũng sai tiền. Nên — chủ repo, 2026-09-30: "nếu có số lượng thì Thành Tiền nhóm tự động bật
và lock nút đó lại" — lưới giữ ba luật:

- **Khoá.** Ô đang bật mà còn nhóm / nhóm con có Số Lượng > 1 — tính theo SỐ ĐANG HIỆN, nên 1,04
  (hiện "1") không tính — thì ô bị khoá bật, vì bỏ tích lúc đó là mất hệ số ×N. Ô khoá vẽ đặc (nền
  đậm, dấu tích rõ, có cả giao diện tối) kèm dòng lý do bên dưới, không lẫn được với ô đang tắt.
  Khoá tự nhả khi không còn nhóm nào SL > 1 và giữ nguyên trạng thái đang có.
- **Tự bật — chỉ khi người dùng ĐƯA nhóm SL > 1 vào**, qua các đường:
  - **gõ / dán / điền** (Ctrl+D, Ctrl+R, kéo ô điền) vào ô Số Lượng của hàng nhóm hoặc nhóm con;
  - **cắt / dán** hàng nhóm mang SL > 1 vào bảng;
  - **chọn gợi ý danh mục** điền Số Lượng cho hàng nhóm / nhóm con. Trên hàng nhóm, gợi ý chỉ mở
    bằng **Alt+↓** ở ô tên nhóm — gõ tên nhóm KHÔNG mở gợi ý (gõ ≥ 2 ký tự tự mở chỉ có ở hàng mục;
    hàng mục không mang hệ số nhóm nên chọn gợi ý ở đó không bật ô);
  - **Ctrl+Z / Ctrl+Y** trả nhóm SL > 1 về khi ô đang tắt, và **công thức** tham chiếu (SL nhóm `=D2`)
    đẩy nhóm lên > 1 — hai đường này người dùng không trực tiếp gõ SL nhóm nên có lời báo (toast);
  - **nhập Excel** — xem bên dưới.
- **KHÔNG bật.** Mở báo giá cũ đã lưu "tắt + nhóm SL > 1": không tự bật, không khoá (bật là đổi
  tổng đã lưu). Đi ngang ô SL rồi Enter, hay sửa ô KHÔNG liên quan (đổi tên nhóm; dán / điền /
  Ctrl+D một cột chữ như ĐVT, Ghi chú, Tên qua hàng nhóm; xoá nhóm rồi Ctrl+Z) cũng không bật.
  Nhóm SL ≤ 1 không đổi tổng nên không bật. Bảng phụ (Chi phí HCM / Phí khách hàng) dùng chung
  luật của lưới nhưng không có đường nhập Excel riêng.

Ô "Hiện Thành Tiền nhóm" nằm trong mốc hoàn tác: lùi / tiến trả nó về đúng trạng thái lúc chụp mốc
khi mốc có nhóm SL > 1 (Esc huỷ phiên gõ SL nhóm cũng trả cờ). Ô đổi trạng thái vì hoàn tác thì có
toast báo — cả chiều bật lại lẫn chiều tắt lại (mốc là báo giá cũ "tắt + nhóm SL > 1" mà người dùng
đã bật giữa chừng).

**Nhập Excel** (hộp "Nhập từ Excel", cả ở phần Hà Nội) cũng là một đường tự bật. Bộ đọc file
(`src/excelImport.ts`) chỉ coi cờ là BẬT khi dòng nhóm trong file có ghi Thành Tiền, nên file mang
Số Lượng nhóm > 1 mà không ghi Thành Tiền nhóm ra cờ TẮT — giữ cờ đó thì nhập xong tổng không nhân
hệ số, xuất Excel ra sai tiền. Vì vậy nạp xong mà bảng kết quả còn nhóm SL > 1 thì cờ bật, ở cả ba
đường (kèm toast nói đã tự bật ở bao nhiêu sheet):

- **sheet mới** (thêm sheet / thêm bảng): cờ theo file, rồi tự bật;
- **Nối vào cuối**: cờ của sheet đích, rồi tự bật — kể cả khi nhóm SL > 1 là của hàng cũ trong sheet
  đích chứ không phải của file;
- **Thay toàn bộ**: cờ theo file nhưng KHÔNG làm mất cờ bật của sheet đang bật, rồi tự bật (ở phần Hà
  Nội, Thay giữ nguyên cờ của bảng đích, rồi tự bật).

Hộp nhập tính tổng dự kiến và đối chiếu tiền theo cờ đã bật, và **cảnh báo, không chặn** khi tổng đã
nhân hệ số nhóm khác tổng ghi trong file: "Đã bật Thành Tiền nhóm vì file có nhóm Số Lượng > 1 nên
tổng đã nhân hệ số nhóm và khác tổng ghi trong file". Sheet đích ĐANG bật (Thay / Nối không tắt nó)
mà file không nhân hệ số cũng lệch y như thế, và cũng chỉ cảnh báo ("Sheet đích đang bật Thành Tiền
nhóm…"). Lệch THẬT — tổng theo cờ trong file cũng không khớp — vẫn đi qua hộp xác nhận như trước.
Ngưỡng dung sai của thẻ đối chiếu (số lớn hơn giữa 2 đ và 0,5 % tổng ghi trong file) chỉ để nuốt sai số
đọc file. Phần chênh do hệ số nhóm là số tiền chính xác, nên hễ lần nạp đem lại khác tổng ghi trong file
vì hệ số nhóm thì thẻ **không bao giờ** báo "Khớp", dù chỉ chênh vài đồng — thẻ vàng "Lệch …", không chặn.
Sheet chọn **Bỏ qua** chỉ để xem: không bật gì, tổng tính theo cờ của file. Máy chủ, Excel, PDF không
đổi: tổng vẫn tính theo cờ đã lưu.

Ở chế độ **Nối vào cuối**, "sau nạp" trong thẻ đối chiếu là phần tổng sheet **thật sự tăng thêm**
(tổng sau nạp trừ tổng trước nạp, cùng hàm tổng của lưới), không phải tổng riêng các hàng của file.
Hàng nối vào cuối vẫn thuộc nhóm cuối của sheet như trước; hộp chỉ nói ra bằng số tiền, cảnh báo vàng,
không chặn, hai thứ mà riêng Nối mới có:

- hàng của file đứng trước dòng nhóm đầu tiên của file nằm trong nhóm cuối của sheet nên được nhân Số
  Lượng nhóm đó — "Các hàng nối vào nằm trong nhóm “…” (Số Lượng 3) ở cuối sheet nên được nhân ×3:
  200.000 trong file → 600.000 sau nạp" (file mở đầu bằng dòng nhóm của chính nó thì không có câu này);
- ô vừa tự bật làm đổi tổng các hàng sẵn có — "Bật Thành Tiền nhóm làm tổng các hàng sẵn có đổi
  100.000 → 300.000".

Hai câu này hiện bất kể phần nhân thêm lớn hay nhỏ, và khi có chúng mà phần tăng thêm khác tổng ghi
trong file thì thẻ không báo "Khớp" (xem ngưỡng dung sai ở trên). Lệch THẬT xét trên chính các hàng
của file, nên vẫn đỏ + hỏi xác nhận, kể cả khi phần nhân thêm tình cờ bù đúng phần đọc thiếu — thẻ
khi đó ghi "Chưa khớp" kèm tiền các hàng đọc được ("Excel 400.000 · các hàng trong file 200.000"),
không lặp hai số "sau nạp" bằng nhau. Bảng Hà Nội không nhân hệ số nhóm nên không có hai câu trên.

Phần **Hà Nội** (và bảng phụ Chi phí HCM / Phí khách hàng) khác ở tiền: tổng bảng là `extraTableSum`
— chỉ cộng hạng mục, **không bao giờ nhân** Số Lượng nhóm dù cờ bật, và các bảng nội bộ này không xuất
Excel; cờ ở đó chỉ quyết định ô Thành Tiền của dòng nhóm hiện số đã nhân hay để trống. Nhập Excel vào
bảng Hà Nội vẫn tự bật + khoá ô (cùng luật lưới), còn hộp nhập tính tổng của bảng KHÔNG nhân hệ số và
nói đúng như vậy — không nói "tổng đã nhân hệ số nhóm". Mọi tổng của hộp ở đó ("Tổng hiện tại … → …",
"sau nạp" của thẻ đối chiếu) cộng bằng chính `extraTableSum`, nên khớp từng đồng với "Tổng tất cả …
sheet Hà Nội" — cả ở ca làm tròn ,5 (0,7 × 163.845 ra 114.691) lẫn Số Ngày ≤ 0 (bảng bỏ qua Số Ngày đó).

Báo giá cũ đã lưu "tắt + nhóm SL > 1" tìm bằng truy vấn chỉ-đọc ở
[`docs/development/DATABASE.md`](../development/DATABASE.md) (mục "Truy vấn kiểm dữ liệu") — và
**không sửa hàng loạt**, xem cảnh báo ở đó.

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
> `web/src/lib/quoteMath.test.ts` (22 bài, chạy bằng `npm run web:test`).

### 1.4 Bên gửi / bên nhận

- **Công ty** chọn lúc tạo báo giá rồi **khoá** ở màn sửa.
- **Địa chỉ bên gửi** chỉ-đọc, luôn bám theo địa chỉ công ty.
- Người gửi / chức danh / điện thoại bên gửi: nhập tay, chảy thẳng ra Excel.
- **Bên nhận**: tên khách, người liên hệ, email, điện thoại, địa chỉ — tất cả ra Excel.

### 1.5 Bảng nội bộ và duyệt theo hàng

Mỗi sheet báo giá có thêm các **bảng nội bộ** hai loại — **Chi Phí HCM**, **Phí Khách Hàng**
(**Báo Giá Hà Nội** thì từ 2026-09-15 nằm ở cấp BÁO GIÁ, `Quote.hnTables`, không theo sheet — xem
DATA_FLOW.md mục 3.4). Chúng là lưới đầy đủ (template, công thức, nhóm,
copy/paste) nhưng **KHÔNG bao giờ xuất ra Excel/PDF cho khách**; tổng từng loại đổ
sang trang Quản lý dự án.

Hai loại **Chi Phí HCM** và **Phí Khách Hàng** có cột **Duyệt** theo từng hàng:

- chỉ người có quyền `quote:internal:approve` tick được (mặc định: admin);
- **chỉ hàng đã duyệt mới cộng vào tổng**, kèm dấu ngày duyệt + người duyệt;
- chốt chặn nằm ở **server**, khớp theo `rid` từng hàng
  (`reconcileExtraApprovals` trong [`src/services/quoteService.ts`](../../src/services/quoteService.ts)) —
  gửi `approved: true` trong payload **không** tự duyệt được.

Mỗi hàng nội bộ **đã duyệt** còn là một **khoản chi** của kế toán: tích **đã chi** kèm **ảnh
chứng từ** (ủy nhiệm chi), ghi **Ngày hóa đơn** + **Ghi chú kế toán**. Từ 2026-10-06 việc đó làm ở
trang **Hóa đơn đầu vào** (mục 5), **không còn ở màn soạn báo giá** — màn soạn không còn cột / nút thanh
toán (chủ repo: "cái thanh toán bên đó là cho kế toán, không nằm trong kia nữa"). Quyền
`invoice:input:pay` cho đã chi + ảnh, `invoice:edit` cho ngày HĐ + ghi chú.

- Dữ liệu ở **bảng riêng** `InputInvoiceEntry` (khoản) / `InputInvoiceProof` (ảnh), không trong JSON của
  sheet — nên không đường Lưu báo giá, nhân bản hay lùi phiên bản nào ghi đè được nó. Ảnh **vẫn là
  data-URL base64 trong CSDL** (khác chứng từ Nhân sự ở mục 6 đã lên kho object: kho object production
  chưa có bản sao), **chỉ thêm** (thay / gỡ / bỏ tích chỉ rút vào lịch sử), và không bao giờ đi kèm lần
  đọc báo giá hay danh sách — phải gọi riêng `GET /api/quotes/input-invoices/:quoteId/:side/:rid/proof`.
- Bốn cờ cũ `paid` / `paidAt` / `paidById` / `paidProof` còn trong JSON hàng thì **đóng băng**: không ai đổi
  được qua đường Lưu nữa, và chúng chỉ còn là nguồn dự phòng cho hàng chưa có khoản (công cụ
  `backfillKhoanChi` chép chúng sang bảng ngay sau deploy).
- Màn soạn **chặn làm mất hàng ĐÃ CHI**: xoá hàng / bảng / trang chứa nó → lỗi nêu tên hàng (xoá bảng /
  trang bị chặn ngay trên trình duyệt; xoá dòng thì Ctrl+Z khôi phục được), nạp Excel mà làm mất nó ("Thay
  toàn bộ" khi dòng không còn trong file, hay xoá sheet) bị chặn ngay ở hộp nạp, không xoá được báo giá chứa
  nó, và chỉ người có quyền tích mới đổi được số lượng / đơn giá / số ngày của hàng đó. Lối thoát: nhờ kế
  toán bỏ đánh dấu ở trang Hóa đơn đầu vào trước.

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

### 1.9 Ghi chú và màu ở danh sách báo giá

Mỗi dòng của **Danh sách báo giá** có cột **Ghi chú** ở cuối hàng, ngay trước cột nút thao tác; cả bảng
được tô **trắng / xám xen kẽ** để đọc theo hàng (chỉ bảng này — `.ql-table`).

- Một ô = một chấm màu + chữ (tối đa 200 ký tự, một dòng). **Bấm chữ** để gõ — Enter hoặc rời ô là lưu,
  Esc là huỷ; **bấm chấm** để chọn **một trong 5 màu** (đỏ · cam · xanh lá · xanh dương · tím) theo kiểu
  bảng chọn của Zalo: chấm đang chọn có dấu ✓, bấm lại để bỏ màu. Enter chốt một từ của bộ gõ tiếng Việt
  (OpenKey/Unikey) **không** bị tính là lệnh lưu.
- **Dùng chung**: ghi chú thuộc về dòng báo giá, ai thấy dòng đó đều thấy (người ghi + giờ ghi hiện khi rê
  chuột) — không phải ghi chú riêng từng người.
- **Ai được ghi**: cùng cổng với sửa báo giá (`loadAuthorizedQuote(update)`) — chủ, thành viên có ít nhất một
  vùng, người có `quote:update:all`. Thành viên chỉ-xem và người chỉ có `quote:read:all` xem được nhưng không
  sửa. Account Hà Nội và tài khoản chi phí (view bị lược) không thấy cột này và bị 403 nếu gọi thẳng.
- **Nằm ở bảng riêng `QuoteListNote`, KHÔNG phải cột trên `Quote`.** Ghi lên `Quote` làm `updatedAt` nhảy —
  tức đá văng lần Lưu kế tiếp của người đang soạn chính báo giá đó (khoá lạc quan, mục 1.8). Nên ghi chú
  không đổi `updatedAt`, không sinh `QuoteVersion`, không bị khoá khi báo giá đã xuất hoá đơn (dòng đó
  chính là dòng cần nhắc "chờ thu"). Có thực thể realtime riêng (`quoteNote`) để danh sách của người khác
  tự tươi mà không kéo theo tải lại trang Hóa đơn / Tổng quan.

### 1.10 Bộ lọc, tìm thông minh và sắp xếp ở danh sách báo giá

- **Bộ lọc** (`web/src/components/BoLocBaoGia.tsx`): chip **Trạng thái** (Nháp · Đã chốt · Không chốt, chọn nhiều; chip
  "Khác" chỉ hiện khi còn dữ liệu của bốn trạng thái cũ) · **Người tạo** và **Công ty** (chọn nhiều, có hộp tìm) · **Của tôi** ·
  **Ngày báo giá** (mẫu nhanh: hôm nay, 7 / 30 ngày qua, tháng này / trước, quý, năm — hoặc từ–đến) · **Tổng tiền** (gõ kiểu
  người Việt: `100tr`, `1,5 tỷ`, `500k`; gõ chưa hiểu thì báo lỗi ngay tại ô, không đoán bừa số tiền) · **Ghi chú** (có / chưa có /
  theo 5 màu; "chưa có" và "theo màu" loại trừ nhau). Các nhóm kết hợp **AND** với nhau và với phạm vi quyền — bộ lọc không bao
  giờ mở rộng thứ người dùng được thấy.
- **Số đếm** trên từng ô lấy từ `GET /api/quotes/facets`: mỗi nhóm đếm theo **mọi bộ lọc KHÁC** của nó (trừ chính nhóm đó),
  nên bấm "Đã chốt" thì các nhóm còn lại cho biết lọc thêm sẽ ra bao nhiêu. Số đếm lỗi / chưa về thì bộ lọc vẫn dùng bình
  thường, chỉ thiếu con số. Bộ lọc nằm trên URL (`#/list?status=draft,converted&company=2&from=…`) — dán link cho nhau là ra
  đúng màn hình.
- **Tìm thông minh** (`src/quoteListFilter.ts`): nhiều từ, không dấu, không cần đúng thứ tự; **mọi từ phải khớp**, mỗi từ khớp ở
  bất kỳ nơi nào trong mã / tiêu đề / khách gõ tay, khách trong danh mục (mã, tên, SĐT, email, MST, người liên hệ), người tạo,
  công ty, ghi chú dòng.
- **Sắp xếp mọi cột** (Mã dự án · Người tạo · Tiêu đề · Ngày · Tổng · Công ty · Khách · Mã KH · Trạng thái). Cột **Tiêu đề** sắp
  theo **chữ ô đang hiện** (tiêu đề rút gọn nếu có) bằng `sapIdTheoTieuDe` — SQL không `ORDER BY` được biểu thức đó, còn sắp
  theo cột gốc thì dòng có tiêu đề rút gọn nằm sai chỗ; thứ tự tiếng Việt (dấu, đ) và số tự nhiên ("Sự kiện 2" trước "Sự kiện
  10"). Cột có nhiều dòng bằng nhau dùng `id` làm khoá phụ nên phân trang không trùng / sót dòng.
- **View bị lược** (account HN, tài khoản chi phí) chỉ còn ô tìm cũ + trạng thái + ngày; `GET /facets` trả 403; tìm / lọc / sắp
  xếp theo thứ họ không thấy (tổng tiền, ghi chú, người tạo, khách danh mục) bị bỏ — lọc theo thứ người ta không được thấy là
  cách đọc trộm nó bằng cách dò.

### 1.11 Đổi khách hàng ngay trong báo giá

Khối **Bên nhận · Khách hàng** ở màn soạn có ô **Mã khách hàng (danh mục)** hiện khách đang gắn và nút **Đổi khách hàng** (hộp
chọn dùng chung với bước 3 của "Tạo báo giá mới": `web/src/components/CustomerPicker.tsx`).

- Đổi khách là đổi **cả khối bên nhận**: tên, người liên hệ, email, SĐT, địa chỉ lấy theo khách mới. Ô nào khách mới để
  trống thì **để trống** — không giữ email / SĐT của khách cũ dưới tên khách mới (báo giá gửi đi mang email của công ty khác
  nặng hơn nhiều một ô trống). Chưa lưu cho tới khi bấm Lưu; các ô vẫn sửa tay được. Chọn lại đúng khách đang gắn thì không
  đè gì.
- Cùng cổng với mọi ô của khối này: báo giá đã xuất hoá đơn, người chỉ xem, và account phụ không có vùng "Báo giá chính"
  không thấy nút.
- Máy chủ kiểm khách mới (`kiemKhachDuocGan`, xem [QUOTE_WORKFLOW.md](QUOTE_WORKFLOW.md) bất biến 6): phải tồn tại và người đổi
  phải đọc được nó; chỉ kiểm khi giá trị **đổi**. Nhật ký `quote.update` ghi mã + tên khách trước / sau.

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
| GN không ngày (`marico_decor`) | Gia Nguyễn | `templates/Marico_Decor.xlsx` | header tiếng Việt một dòng, không có cột Số ngày |
| GN có ngày (`unibenfood`) | Gia Nguyễn | `templates/GN_CoNgay.xlsx` | **cùng nền với GN không ngày**, thay cột Chi Tiết bằng **Số ngày**; Thành Tiền = Đơn Giá × Số Lượng × Số Ngày. Dựng lại: `node scripts/dung-mau-co-ngay.mjs` |
| GN Banner (`gn_banner`) | Gia Nguyễn | `templates/Marico_Decor.xlsx` | cùng file GN không ngày, **khác cách đánh STT** (nhóm con đánh 1,2,3; mục dưới không đánh số) |
| CLF không ngày (`clofull_decor`) | Colorfull | `templates/CLF_KhongNgay.xlsx` | có cột Chi Tiết; khối "Kính gửi" + letterhead người gửi ở F1 |

Ánh xạ bên gửi / bên nhận vào ô Excel:

- **GN không ngày** — khách: công ty C2, người liên hệ C3 (mẫu này không có ô riêng cho Tel/Địa chỉ khách); người gửi F3 (tên _ chức danh _ SĐT gộp một dòng), địa chỉ F4.
- **GN có ngày** — khách C1/C2, Tel C3, Địa chỉ C4; người gửi E2, SĐT E3, địa chỉ E4.
- **CLF** — khối "Kính gửi" (gộp B3:I3 từ cột STT; bản có ngày B3:J3): công ty + người liên hệ + ĐT + Đ/c + email; letterhead (F1): tên công ty + địa chỉ + tên · chức danh · SĐT.

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

Trang **Hóa đơn đầu ra** (tên cũ "Hoá đơn"; hoá đơn xuất cho khách) thay bảng Excel theo dõi hoá đơn của kế toán. **Cùng nguồn dữ liệu**
với Quản lý dự án (bảng `QuoteSheet`): kế toán **nhập ở đây**, trang Dự án chỉ **tham chiếu**.

- Kế toán nhập: Hạng mục · PO/HĐ · CTy (GN/SM/CLF) · Số hoá đơn · Ngày hoá đơn ·
  Hình thức thanh toán · Ngày đóng đơn hàng · Link hoá đơn · Chứng từ gửi đi / trả về · Năm · Note.
- **Ngày thanh toán** tách thành quyền riêng `invoice:pay` — người nhập hoá đơn
  không mặc nhiên đánh dấu được đã thu tiền. `invoice:pay` chỉ là ngày **THU** tiền (tiền VÀO) của trang
  này; việc **CHI** (tiền RA) theo từng hàng bảng nội bộ dùng quyền riêng `invoice:input:pay` ở trang Hóa
  đơn đầu vào — cố ý không dùng chung, để ai đang giữ `invoice:pay` (qua ghi đè vai trò, quyền riêng, hay
  `invoice:manage` bắc cầu) không tự động tích được "đã chi".
- **Tình trạng HĐ tự động** chuyển "Hoàn tất" khi có đủ Số hoá đơn + Ngày hoá đơn (không tick tay).
- **Công nợ** = số ngày từ Ngày hoá đơn khi chưa thanh toán, **tô đỏ khi quá hạn**.
  Hạn tính theo **hạn công nợ riêng của từng khách** (đặt ở trang Mã khách hàng);
  khách chưa đặt thì dùng ngưỡng mặc định chỉnh được ngay trên thanh công cụ.
- Ô bắt buộc chưa điền **tô hồng**, điền rồi trở lại nền trắng.

Có thêm màn **chỉ-xem bảng nội bộ** (`quote:internal:view`) cho tài khoản phụ trách
chi phí: thấy bảng nội bộ của một báo giá, **không** thấy giá khách, khách hàng hay báo giá
chính — server đã lược dữ liệu trước khi trả. Từ 2026-10-06 màn này **chỉ xem**: cột Thanh toán chỉ
còn chữ "✓ Đã TT · ngày" (theo khoản kế toán), không tích được, không mở được ảnh chứng từ, không thấy
ngày HĐ / ghi chú KT. Quyền `quote:internal:pay` mà tài khoản này từng dùng để tích nay không còn tác
dụng — việc tích thuộc về kế toán ở trang Hóa đơn đầu vào.

### Hóa đơn đầu vào

Trang **Hóa đơn đầu vào** (mới 2026-09-30, `#/invoices-in`; **ghi được** từ 2026-10-06) là đối xứng của trang
Hóa đơn đầu ra: liệt kê mọi **hàng bảng nội bộ ĐÃ DUYỆT** — mỗi hàng là một khoản chi mà kế toán phải đòi /
đối chiếu hoá đơn đầu vào — và **kế toán ghi ngay tại đây**, không cần (và không thể) mở báo giá.

- **"Đã duyệt" có hai dạng.** Chi phí HCM và Phí khách hàng: duyệt **theo từng hàng** (mục 1.5). Báo giá Hà
  Nội: duyệt ở **mức báo giá** (`hnStatus = approved`, mục 3) — khi đó mọi hàng HN vào. Hàng chưa duyệt không
  cộng vào tổng báo giá nên không xuất hiện (trừ khi nó đã có dữ liệu kế toán — xem "Cần chú ý").
- Mỗi dòng: mã dự án (theo sheet) · khách · hạng mục (kèm loại bảng, chi tiết) · NS · SL / đơn giá / thành
  tiền · chứng từ (VAT / HĐNS / TM) · lưu kho · ngày + người duyệt · cột **Kế toán** (đã chi + ngày chi, có ảnh
  hay chưa, ngày HĐ, ghi chú). Lọc theo loại bảng, chứng từ, đã chi, có ngày HĐ hay chưa, trạng thái báo giá,
  khoảng ngày duyệt; tìm không dấu (cả ghi chú KT, ngày HĐ, người đánh dấu); sắp theo ngày duyệt / thành tiền.
- **Ghi ở hộp "Khoản chi"** (mở từ cột Kế toán): tích **Đã chi** kèm **ảnh ủy nhiệm chi** (`invoice:input:pay`
  — ngày chi do máy chủ đóng dấu lúc tích; ảnh không bắt buộc, khoản đã chi mà thiếu ảnh hiện "⚠ chưa có
  ảnh"), **Ngày hóa đơn** + **Ghi chú kế toán** (`invoice:edit`, tối đa 1000 ký tự). Bỏ tích / thay ảnh / gỡ
  ảnh chỉ **rút** ảnh cũ vào lịch sử — vẫn xem lại được, tối đa 20 ảnh một khoản. Thiếu quyền ô nào thì ô
  đó khoá kèm lý do.
- **Không đụng báo giá.** Ghi vào bảng riêng nên không đổi `Quote.updatedAt` (người đang soạn báo giá không
  bị đá văng), không sinh phiên bản báo giá. Hai kế toán sửa cùng một khoản: người lưu sau nhận báo "vừa có
  người sửa", trang nạp lại và **giữ** phần đang nhập — không ghi đè im lặng; danh sách tự nạp lại (realtime)
  mà người kia vừa đổi đúng ô mình đang sửa thì hộp **hỏi trước khi ghi đè** (nêu người + giá trị mới). Hộp
  còn thay đổi chưa lưu thì F5 / đóng tab / Back / bấm menu đều hỏi; đang nén ảnh thì chưa Lưu được; Ngày
  hóa đơn ngoài 2000–2100 báo ngay.
- **TÍCH MỚI chỉ cho hàng đã duyệt.** Hàng đã có dữ liệu kế toán mà sau đó bị bỏ duyệt, phần Hà Nội bị trả
  lại / giao lại, hàng bị xoá khỏi báo giá, hay báo giá bị xoá — vẫn hiện ở thẻ **Cần chú ý** (tách khỏi danh
  sách chính và khỏi mọi tổng tiền) để kế toán thấy, sửa, bỏ tích được; dòng của báo giá đã xoá không mở được
  báo giá nữa nhưng hộp Khoản chi vẫn mở ở chế độ **chỉ xem** (xem ảnh chứng từ, ngày HĐ, ghi chú, lịch sử ảnh).
  Hàng cũ trùng mã nội bộ chỉ xem cho tới lần Lưu báo giá kế (máy tách mã, mỗi hàng giữ cờ của chính nó); hàng
  cũ đã trả mà THIẾU mã thì báo giá đó không Lưu được cho tới khi quản trị chạy công cụ chuẩn hoá mã
  (`backfillKhoanChi --sua-rid` — DISASTER_RECOVERY.md).
- Số tiền của hàng đã chi bị đổi **sau** khi chi (chỉ người có quyền tích làm được) → trang báo "Số tiền đã
  đổi sau khi chi", kế toán đối chiếu rồi bấm "Xác nhận số tiền hiện tại".
- Duyệt, bỏ duyệt, đổi chứng từ vẫn làm ở màn soạn báo giá. Tiền tính bằng ĐÚNG `extraTableSum` ở máy chủ
  (`src/inputInvoices.ts`) — trang không tự cộng lại.
- Quyền vào trang `invoice:page` (cùng trang Hóa đơn đầu ra). Quyền xem Quản lý dự án (`invoice:read`)
  **không đủ**: đây là dữ liệu chi phí. Danh sách không bao giờ mang ảnh ủy nhiệm chi — chỉ người có
  `invoice:input:pay` mở được ảnh, và mỗi lần mở ghi nhật ký (`quote.internal.proof-view`).
- **Cố ý chưa có:** số hoá đơn / nhà cung cấp riêng cho từng khoản (chủ repo 2026-10-06), tích nhiều khoản
  một lần, sửa thẳng trong bảng, dán ảnh bằng Ctrl+V.

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
- **Hạn công nợ riêng cho từng khách** — trang Hóa đơn đầu ra dùng số này để tô đỏ.
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
| **Webhook ra ngoài** | Đăng ký endpoint theo sự kiện (`quote.created`, `quote.converted` — hai sự kiện duy nhất hệ thống thật sự bắn), mỗi lượt gửi mang `X-QLY-Delivery` ổn định qua các lần thử lại để bên nhận khử trùng; xem lại lịch sử gửi (`/:id/deliveries`). |
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
[`src/permissions.ts`](../../src/permissions.ts) và ma trận đầy đủ 145 endpoint ở
[ROLES_PERMISSIONS.md](ROLES_PERMISSIONS.md), có
`scripts/ci/endpoint-inventory.mjs --check` đối chiếu ở CI.

Ý định nghiệp vụ của từng vai trò, để đọc mã cho dễ:

| Vai trò trong mã | Nhãn trên giao diện | Ý định |
|---|---|---|
| `admin` | Quản trị | toàn quyền; duyệt hàng nội bộ, ký mọi chứng từ, xác nhận hồ sơ nhân sự đã ký |
| `manager` | Account | làm báo giá của mình + báo giá được thêm làm thành viên; chốt/không-chốt theo khách; xem dự án của mình |
| `account_hn` | Account HN | **chỉ** điền giá Hà Nội của báo giá được giao |
| `hr` | Nhân sự | **chỉ xem** hồ sơ nhân sự |
| `accountant` | Kế toán | xem hồ sơ nhân sự + đánh dấu thanh toán + ghi chú kế toán; nhập hoá đơn đầu ra; ở trang Hóa đơn đầu vào tích đã chi + ảnh chứng từ, ghi ngày HĐ + ghi chú — **không** thấy báo giá |

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
