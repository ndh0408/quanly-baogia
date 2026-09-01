# Vòng đời một request

Nguồn: `src/app.ts` (thứ tự `app.use`), `src/middleware.ts`, `src/permissions.ts`.
Diễn giải bằng lời: [DATA_FLOW.md](../DATA_FLOW.md#1-một-request-thường-trình-duyệt--postgres).

```mermaid
flowchart TD
    B["Trình duyệt<br/>web/src/lib/api.ts"] -->|"gzip nếu thân > 256KB<br/>+ header X-CSRF-Token"| CF["Cloudflare Tunnel"]
    CF --> H["helmet — CSP, HSTS"]
    H --> C["compression<br/>LOẠI TRỪ text/event-stream"]
    C --> RID["requestId — gắn req.id"]
    RID --> LOG["pino-http — log truy cập"]
    LOG --> DEC["decompressBody<br/>/api/quotes 16MB · còn lại 2MB"]
    DEC --> JSON["express.json — cùng cặp trần"]
    JSON --> SESS{"có Bearer<br/>và KHÔNG có cookie?"}
    SESS -->|"có"| MET["metricsMiddleware"]
    SESS -->|"không"| PG["express-session<br/>kho PG user_sessions"]
    PG --> MET
    MET --> BA["bearerAuth — JWT thành phiên giả lập"]
    BA --> EAU["enforceActiveUser<br/>nạp LẠI vai trò + quyền TỪ CSDL"]
    EAU --> CSRF["csrfGuard<br/>miễn cho client Bearer"]
    CSRF --> RL["apiLimiter — 120/phút"]
    RL --> R["routes/*.routes.ts<br/>validate zod + requirePermission"]
    R --> S["services/*.ts<br/>canOnQuote · canScoped · transaction"]
    S --> P["Prisma $extends<br/>xoá mềm + lọc deletedAt + emitChange"]
    P --> DB[("PostgreSQL<br/>qua pg.Pool, DB_POOL_MAX")]

    EAU -.->|"tài khoản bị khoá"| E401["401"]
    CSRF -.->|"thiếu/sai mã"| E403["403 code csrf_token_*"]
    RL -.->|"quá trần"| E429["429"]
    R -.->|"thiếu năng lực"| F403["403"]
    S -.->|"không sở hữu bản ghi"| F403
```

## Ba điều dễ đọc nhầm

**Nhánh `SESS`.** Request mang Bearer mà **không** kèm cookie phiên thì bỏ qua
hẳn `express-session`. Không có nhánh này, `bearerAuth` ghi danh tính vào
`req.session` là đánh dấu phiên đã thay đổi → express-session lưu xuống PG và
phát `Set-Cookie` cho một client API chưa bao giờ xin cookie. Đã đo: 5 request
Bearer sinh 5 hàng `user_sessions` và 5 `Set-Cookie`.

**Hai lớp 403 khác nhau.** Ở route là **năng lực** ("được phép làm hành động
này không"); trong service là **phạm vi bản ghi** ("được phép làm nó trên bản
ghi cụ thể này không"). Bỏ lớp thứ hai là IDOR — bỏ lớp thứ nhất thì mọi tài
khoản đọc được một báo giá cũng xuất được nó.

**`notFound` đứng TRƯỚC static.** Nên `/api/gì-đó-không-có` trả 404 JSON thay vì
rơi vào vỏ SPA và trả về HTML — client `fetch` nhận HTML thay vì JSON là lớp lỗi
rất khó lần ra.
