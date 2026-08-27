# Đường LƯU báo giá

Nguồn: `updateQuote` trong `src/services/quoteService.ts`, `saveHn` trong
`src/hnWorkflow.ts`, `carrySheetState`/`sanitizeExtraTables` trong
`src/quoteUtils.ts`.
Diễn giải bằng lời: [DATA_FLOW.md](../DATA_FLOW.md#3-đường-lưu-báo-giá).

Đây là đường **duy nhất trong hệ có thể làm mất công việc của người khác**. Mỗi
hộp dưới đây tồn tại vì một cách mất dữ liệu cụ thể, không phải vì gọn sơ đồ.

```mermaid
sequenceDiagram
    autonumber
    participant FE as Editor QuoteEditor.tsx
    participant RT as PUT /api/quotes/{id}
    participant SV as updateQuote
    participant TX as Transaction
    participant DB as PostgreSQL

    FE->>RT: sheets + baseUpdatedAt (mốc lúc mở editor)
    RT->>RT: chặn ai có quote:hn:fill<br/>(chỉ được điền phần HN)
    RT->>SV: QuoteUpdateSchema đã hợp lệ
    SV->>DB: đọc RÚT GỌN (không kéo images / extraTables)
    SV->>SV: canEdit — converted/lost là BẤT BIẾN
    SV->>SV: khoá lạc quan lần 1 (ngoài transaction)
    SV->>SV: computeQuoteTotals — tính tiền TRƯỚC, giữ transaction ngắn

    SV->>TX: BEGIN
    TX->>DB: SELECT id FROM QuoteSheet WHERE quoteId=? ORDER BY id FOR UPDATE
    Note over TX,DB: KHOÁ RỒI MỚI ĐỌC. Ba đường ghi QuoteSheet<br/>KHÔNG chạm Quote: custStatus, signedAt, invoiceNo.
    TX->>DB: đọc lại sheet TƯƠI
    TX->>TX: reconcileExtraApprovals — thiếu internal:approve thì lấy lại cờ duyệt
    TX->>TX: reconcileExtraPayments — thiếu internal:pay thì lấy lại paid/paidProof
    TX->>TX: carrySheetState — bê chữ ký, hoá đơn, ý kiến khách sang bản mới
    TX->>TX: reconcileHanoiTables — thiếu hn:manage thì giữ giá HN đã chốt
    TX->>TX: sheetKhongDoi? (cờ INCREMENTAL_QUOTE_SAVE) giữ nguyên trang không đổi
    TX->>DB: deleteMany sheet (trừ trang giữ lại)
    TX->>DB: UPDATE Quote SET updatedAt=updatedAt WHERE id=? AND updatedAt=?
    alt 0 dòng
        TX-->>FE: 409 — người khác vừa lưu, tải lại đi
    else khớp mốc
        TX->>DB: quote.update + sheets.create
        TX->>DB: snapshotQuoteVersion
        TX-->>SV: COMMIT
        SV-->>FE: 200 kèm báo giá đầy đủ (lần này CÓ ảnh)
    end
```

## Vì sao khoá lạc quan phải kiểm HAI lần

Lần kiểm đầu chạy **ngoài** transaction, nên hai người bấm Lưu chồng nhau vẫn
lọt qua **cả hai** (cùng đọc một mốc) rồi người ghi sau đè im lặng — `UPDATE`
không hề kèm điều kiện mốc. Câu `UPDATE … WHERE updatedAt = <mốc>` bên trong
transaction vừa **kiểm** vừa **khoá** hàng `Quote`: bên đến sau phải xếp hàng,
tới lượt thì mốc đã đổi → 0 dòng → 409.

Nó dùng `$executeRaw` chứ không dùng `tx.quote.updateMany` vì extension realtime
coi `updateMany` là WRITE: mỗi lần Lưu sẽ bắn **hai** sự kiện SSE thay vì một, và
một lần Lưu **thất bại** (rollback) vẫn bắt mọi client đang mở danh sách tải lại,
vì `emit` nằm ngoài vòng đời transaction.

## Vì sao `ORDER BY id`

`deleteMany` khoá theo thứ tự quét vật lý (không xác định). Thiếu `ORDER BY id`
thì `updateQuote` và `saveHn` có thể lấy khoá **ngược chiều nhau** trên cùng một
báo giá → deadlock 40P01 → Prisma P2034. Ba đường ghi
(`updateQuote`, `saveHn`, `markExtraTableRowPayment`) đều lấy khoá `QuoteSheet`
**trước** `Quote`, cùng một thứ tự.

## Nhánh Account Hà Nội

```mermaid
flowchart LR
    A["PUT /api/quotes/:id/hn<br/>saveHn"] --> L["cùng khoá FOR UPDATE trên QuoteSheet,<br/>cùng thứ tự với updateQuote"]
    L --> C{"sheetId client gửi<br/>có còn tồn tại?"}
    C -->|"nhỏ hơn mọi id hiện có<br/>= dấu vết xoá-tạo-lại"| E409["409 — quản lý vừa lưu, tải lại"]
    C -->|"lớn hơn = client bịa"| SKIP["bỏ qua, 200 (hành vi cũ)"]
    C -->|"khớp"| W["ghi RIÊNG bảng category=hanoi,<br/>chép nguyên hcm/khach"]
    W --> BUMP["chạm Quote để bump updatedAt"]
    BUMP --> OK["200"]
```

`BUMP` không phải trang trí: ghi bảng HN là ghi hàng **con**, nên `Quote.updatedAt`
không tự đổi. Không bump thì khoá lạc quan của quản lý không thấy phần HN vừa
lưu, và lần `deleteMany` + tạo lại kế tiếp ghi đè nó **im lặng**.

Nhánh `E409` là **suy đoán theo dấu vết**, và mã nguồn nói thẳng điều đó: id của
`QuoteSheet` tăng dần theo sequence, nên id nhỏ hơn mọi id hiện có gần như chắc
chắn là dấu vết xoá-tạo-lại. Hợp đồng đúng đắn cần client gửi `baseUpdatedAt`
cho cả đường này. Nhưng suy đoán này **không bao giờ làm mất dữ liệu**: sai thì
cùng lắm bắt tải lại một lần thừa.
