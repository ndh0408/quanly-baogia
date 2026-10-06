# Đường realtime (SSE)

Nguồn: `src/sse.ts`, `src/routes/stream.routes.ts`, extension realtime trong
`src/db.ts` (cộng các lời phát TAY như `src/services/inputInvoiceService.ts`), phía client là
`web/src/components/Shell.tsx` và bảng thực thể → khoá query `KHOA_THEO_THUC_THE` ở `web/src/lib/query.tsx`.
Vì sao SSE chứ không phải WebSocket: [ADR 0004](../../adr/0004-sse-not-websocket.md).
Diễn giải bằng lời: [DATA_FLOW.md](../DATA_FLOW.md#2-đường-realtime-sse).

```mermaid
sequenceDiagram
    autonumber
    participant T1 as Tab A — người sửa
    participant API1 as Tiến trình API 1
    participant R as Redis pub/sub
    participant API2 as Tiến trình API 2
    participant T2 as Tab B — người khác

    T2->>API2: GET /api/stream/events
    API2->>API2: attach — kiểm trần TRƯỚC khi đặt header
    API2-->>T2: text/event-stream, keepalive mỗi 25s

    T1->>API1: PUT /api/quotes/{id}
    API1->>API1: prisma $extends thấy WRITE vào Quote
    API1->>API1: emitChange quote update
    alt có REDIS_URL
        API1->>R: PUBLISH sse:events
        R->>API2: message
        R->>API1: message (chính nó cũng nhận)
        API2->>T2: event changed
    else không có Redis
        API1->>API1: localBroadcast — CHỈ tiến trình này
    end
    T2->>T2: window realtime:changed — trang tự tải lại
```

## Thực thể `inputInvoice` — phát TAY, một lần, SAU commit

Extension trong `src/db.ts` chỉ phát cho các model trong `RT_ENTITY` (`Quote`, `Customer`, `User`,
`QuoteListNote`), và phát **ngay sau từng câu lệnh** — kể cả khi transaction chưa commit hay sau đó
rollback. Khoản chi kế toán của trang Hóa đơn đầu vào (`InputInvoiceEntry` / `InputInvoiceProof`, từ
2026-10-06) cố ý **không** vào danh sách đó: một lần ghi khoản là nhiều câu trong một transaction (gieo
khoản, khoá, ghi ảnh, rút ảnh cũ), và một lần 409 / 400 phải không làm tươi màn hình nào.

```mermaid
sequenceDiagram
    autonumber
    participant KT as Tab kế toán — Hóa đơn đầu vào
    participant API as PUT /api/quotes/input-invoices/…
    participant DB as PostgreSQL
    participant T2 as Tab khác (kế toán khác, tài khoản chi phí, danh sách báo giá)

    KT->>API: khoản chi (baseVersion + trường đổi)
    API->>DB: BEGIN · Quote FOR SHARE · khoản FOR UPDATE · ghi
    alt 4xx (thiếu quyền, 409 khoan-chi-da-doi, hang-chua-duyet…)
        API-->>KT: lỗi — KHÔNG phát gì
    else 200
        API->>DB: COMMIT
        API->>API: emitChange inputInvoice update — đúng MỘT lần
        API-->>T2: event changed (entity inputInvoice)
        T2->>T2: làm tươi inputInvoices · quote-internal · quotes · audit
    end
```

Phía web, `KHOA_THEO_THUC_THE.inputInvoice` chỉ làm tươi bốn nhóm query đó. Thiếu dòng ánh xạ thì một
thực thể lạ làm tươi **mọi** query — đó cũng là điều xảy ra một nhịp với tab còn chạy bundle trước
deploy: vô hại, chỉ thừa một lượt tải. Ghi khoản không chạm `Quote`, nên không có sự kiện `quote` nào
kéo theo (màn soạn báo giá đang mở không bị đá văng).

## Vì sao publish KHÔNG tự giao cục bộ khi có Redis

Mọi tiến trình đều **vừa** publish **vừa** subscribe cùng một kênh. Nếu publish
cũng giao thẳng xuống client của chính nó thì tab nối vào tiến trình đó nhận
**hai lần** mỗi sự kiện. Subscriber là nơi giao duy nhất; publish chỉ đẩy lên
kênh.

Publisher và subscriber dùng **hai bộ option khác nhau**:

| | `maxRetriesPerRequest` | `enableOfflineQueue` | vì sao |
|---|---|---|---|
| subscriber | `null` (vô hạn) | mặc định | kết nối dài, phải tự nối lại và chờ được |
| publisher | 2 | `false` | publish là bắn-và-quên trên đường xử lý request; Redis chết mà xếp hàng vô hạn thì hàng đợi offline phình trong bộ nhớ để rồi giao một sự kiện đã lỗi thời |

## Ba chốt chặn trong `attach`

```mermaid
flowchart TD
    A["GET /api/stream/events"] --> C1{"tài khoản này đã có<br/>≥ SSE_MAX_PER_USER kết nối?"}
    C1 -->|"có"| E429["429 code sse_too_many<br/>— TRẢ TRƯỚC KHI đặt header"]
    C1 -->|"không"| H["đặt header + flushHeaders"]
    H --> RC{"vừa rớt về 0 kết nối<br/>trong 90 giây qua?"}
    RC -->|"có"| INC["sse_reconnects++"]
    RC -->|"không"| REG["đăng ký vào subscribers"]
    INC --> REG
    REG --> KA["setInterval keepalive 25s"]
    KA --> W{"writableLength ><br/>SSE_MAX_BUFFER?"}
    W -->|"có"| D["res.destroy — req phát close,<br/>dọn dẹp chạy như khi đóng tab"]
    W -->|"không"| OK["ghi tiếp"]
```

**Kiểm trần trước khi đặt header** vì đã `flushHeaders` với `text/event-stream`
rồi thì không còn trả 429 được nữa.

**Áp lực ngược huỷ socket, không chỉ bỏ ghi.** Một client đọc chậm, hay một
socket đã chết mà không gửi FIN, làm mọi sự kiện tiếp theo dồn vào bộ đệm trong
tiến trình, không giới hạn. SSE là dữ liệu **gợi ý làm mới màn hình**: mất vài
sự kiện thì client tự re-fetch, còn phình bộ nhớ thì kéo sập cả app.

**`sse_reconnects` là suy luận, và mã nguồn nói thẳng điều đó.** `EventSource`
chỉ gửi `Last-Event-ID` khi máy chủ từng gửi trường `id:` — đường phát ở đây
không gửi bao giờ. Nên "nối lại" được suy ra từ việc tài khoản vừa rớt về không
kết nối trong `SSE_RECONNECT_WINDOW_MS` (mặc định 90 giây). Mở thêm tab thứ hai
không tính; người bỏ đi 10 phút rồi quay lại cũng không tính. Con số này đọc là
"đường realtime có đang **chập chờn** không", không phải "đếm tuyệt đối".

## Compression phải loại trừ SSE

`src/app.ts` khai `filter` riêng: `/api/stream/events` và mọi request có
`Accept: text/event-stream` đều không nén. Quyết định ở **thời điểm request** chứ
không đợi `Content-Type` — lúc filter chạy, header đáp có thể chưa được chốt.
Triệu chứng khi quên: "realtime lúc được lúc không".

## Presence

`POST /api/stream/presence` với `open` / `heartbeat` / `close`. Trạng thái sống
**trong bộ nhớ tiến trình**, không lưu CSDL — đóng hết tab là gỡ. Route kiểm
`canOnQuote(read)` trước khi ghi hoặc trả về danh sách; thiếu bước đó thì bất kỳ
ai đăng nhập cũng dò được `quoteId` bất kỳ để biết ai đang sửa và tên hiển thị
của họ.

## Tắt máy có kiểm soát

`closeAllSse` gửi sự kiện `shutdown` rồi đóng mọi kết nối. Cần nó vì
`server.close()` **chờ mọi kết nối đang mở kết thúc**, mà kết nối SSE theo thiết
kế thì không bao giờ kết thúc: callback không bao giờ chạy, tiến trình chỉ thoát
nhờ bộ đếm giờ cưỡng bức với mã thoát 1, và orchestrator đọc mã thoát đó là
"container hỏng". Mỗi lần deploy trở thành một lần tắt cứng.
