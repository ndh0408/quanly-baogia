import "dotenv/config";
import { z } from "zod";
import { napBiMatTuFile } from "./secretFiles.js";


/**
 * Biến môi trường SỐ, coi chuỗi RỖNG như KHÔNG ĐẶT.
 *
 * Vì sao cần: `z.coerce.number()` ép "" thành 0. Với `.positive()` phía sau thì `SMTP_PORT=`
 * (dòng có tên biến nhưng bỏ trống — chuyện rất thường gặp trong file .env sinh tự động, và trong
 * compose khi viết `SMTP_PORT: ${SMTP_PORT}` mà biến gốc chưa đặt) làm TOÀN BỘ tiến trình THOÁT
 * lúc khởi động, kèm thông điệp "expected number to be >0" chẳng chỉ ra biến nào.
 * Đã kiểm bằng zod v4: ""  →  "Too small: expected number to be >0".
 *
 * Chuỗi rỗng nghĩa là "không cấu hình", không phải "cấu hình bằng số không". Chuẩn hoá về undefined
 * để giá trị mặc định của schema được dùng.
 */
// Generic để GIỮ NGUYÊN kiểu đầu ra của schema bên trong. Nếu khai `(s: z.ZodTypeAny)` thì kiểu
// đầu ra bị xoá thành `unknown` và mọi nơi dùng `config.DEFAULT_PAGE_SIZE` sẽ vỡ typecheck.
const rongLaChuaDat = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const numEnv = <T extends z.ZodTypeAny>(schemaSo: T) =>
  z.preprocess(rongLaChuaDat, schemaSo) as unknown as T;

/** Như trên, cho biến CHUỖI: "" nghĩa là chưa đặt, không phải chuỗi rỗng hợp lệ. */
const strEnv = <T extends z.ZodTypeAny>(schemaChuoi: T) =>
  z.preprocess(rongLaChuaDat, schemaChuoi) as unknown as T;

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: numEnv(z.coerce.number().int().positive().default(3000)),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  // KHÔNG dùng `.min(32).or(z.string().min(1))`: union chỉ cần MỘT nhánh khớp, nên `min(32)` không
  // chặn được gì — "short" vẫn qua. Và khi CẢ HAI nhánh trượt (chuỗi rỗng), zod v4 gộp thành
  // `invalid_union` với message "Invalid input", còn thông điệp thật nằm trong mảng lỗi lồng bên
  // trong — mà vòng in lỗi phía dưới chỉ in `issue.message`, tức người vận hành nhận đúng một câu
  // vô nghĩa. Ngưỡng 32 ký tự áp ở lớp kiểm production tường minh phía dưới, nơi nó thật sự bắt buộc.
  SESSION_SECRET: z.string().min(1, "SESSION_SECRET là bắt buộc (production còn phải ≥ 32 ký tự)"),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).optional(),
  // Auth tuning
  BCRYPT_COST: numEnv(z.coerce.number().int().min(10).max(15).default(12)),
  PASSWORD_MIN_LENGTH: numEnv(z.coerce.number().int().min(8).default(8)),
  LOGIN_MAX_ATTEMPTS: numEnv(z.coerce.number().int().min(3).default(5)),
  LOGIN_LOCKOUT_MINUTES: numEnv(z.coerce.number().int().min(1).default(15)),
  // Rate limiting
  RATE_LIMIT_LOGIN_PER_15M: numEnv(z.coerce.number().int().default(10)),
  RATE_LIMIT_API_PER_MIN: numEnv(z.coerce.number().int().default(120)),
  // Pagination defaults
  DEFAULT_PAGE_SIZE: numEnv(z.coerce.number().int().min(1).max(200).default(20)),
  MAX_PAGE_SIZE: numEnv(z.coerce.number().int().min(10).max(500).default(100)),
  // Public base URL of the app (e.g. https://gianguyen.cloud). Used to build
  // links in outgoing emails (password reset, invites). NEVER derived from
  // request headers — Origin/Host are client-controlled and would let an
  // attacker poison reset links (account takeover).
  APP_BASE_URL: z.string().url("APP_BASE_URL phải là URL đầy đủ, vd https://gianguyen.cloud").optional(),
  // CORS
  CORS_ORIGINS: z.string().optional(),
  // Trust proxy (Nginx, Cloudflare). Set 1 (one hop) or true for any.
  // KIỂM DẠNG (HTTP-12): `false`/`off`/`no` trước đây lọt qua rồi `app.set("trust proxy", "false")`
  // làm proxy-addr ném "invalid IP address: false" trong createApp — tiến trình chết với lỗi không
  // nói tên biến. Nhận: số chặng, `true`, `loopback`/`linklocal`/`uniquelocal`, hoặc danh sách IP/CIDR.
  // Chuỗi rỗng (`TRUST_PROXY=` trong .env.example) = không đặt.
  TRUST_PROXY: strEnv(z.string().trim().regex(/^(true|\d+|loopback|linklocal|uniquelocal|[0-9a-f:.,/ ]+)$/i, {
    error: "TRUST_PROXY: số chặng proxy (vd 1), 'true', 'loopback'/'linklocal'/'uniquelocal', hoặc danh sách IP/CIDR — KHÔNG dùng 'false' (muốn tắt thì bỏ trống)",
  }).optional()),
  // JWT
  JWT_SECRET: strEnv(z.string().min(16).optional()),
  JWT_ACCESS_TTL: z.string().default("15m"),
  JWT_REFRESH_TTL_DAYS: numEnv(z.coerce.number().int().min(1).default(7)),
  // Redis (BullMQ, rate-limit-redis, cache)
  REDIS_URL: z.string().optional(),
  // S3 / MinIO
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default("auto"),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  S3_BUCKET: z.string().default("quanly"),
  // z.coerce.boolean() treats the STRING "false" as truthy (non-empty) → true.
  // Parse explicitly so S3_FORCE_PATH_STYLE=false actually means false.
  S3_FORCE_PATH_STYLE: z.preprocess((v) => (typeof v === "string" ? !/^(false|0|no)$/i.test(v) : v), z.boolean()).default(true),
  // Telegram
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  // [KHÔNG DÙNG] Webhook đi được ký bằng secret RIÊNG của từng webhook (`Webhook.secret`, sinh ngẫu
  // nhiên rồi mã hoá at-rest — xem src/webhooks.ts + src/secretbox.ts), KHÔNG dùng biến này. Giữ khai
  // báo để `.env` cũ có dòng này không bị coi là biến lạ; đừng nối nó vào tính năng nào.
  WEBHOOK_SECRET: z.string().optional(),
  // Sentry
  SENTRY_DSN: z.string().optional(),
  // Optional bearer token to protect /metrics (defence-in-depth on top of network policy)
  METRICS_TOKEN: z.string().optional(),
  // ── CỜ TÍNH NĂNG ────────────────────────────────────────────────────────
  // §47: chỉ dùng cho triển khai RỦI RO cần bật/tắt được, không dựng hệ thống cờ.
  //
  // INCREMENTAL_QUOTE_SAVE — bỏ qua việc xoá-tạo-lại những TRANG KHÔNG ĐỔI khi lưu báo giá.
  // MẶC ĐỊNH TẮT, có chủ ý: đường lưu là chỗ tiền và trạng thái mức sheet đi qua, và một lỗi so
  // sánh ở đó là mất dữ liệu ÂM THẦM (trả 200, người dùng không biết gì). Bật sau khi đã chạy
  // thật ở staging. Số đo trước/sau: docs/architecture/QUOTE_SAVE_PERFORMANCE.md.
  // Cùng cách phân tích "false" như S3_FORCE_PATH_STYLE — `z.coerce.boolean()` coi chuỗi "false"
  // là true, nên KHÔNG dùng được ở đây.
  INCREMENTAL_QUOTE_SAVE: z
    .preprocess((v) => (typeof v === "string" ? /^(1|true|yes|on)$/i.test(v) : !!v), z.boolean())
    .default(false),
  // Key used to encrypt MFA TOTP secrets at rest (AES-256-GCM). Strongly recommended
  // in production; if absent, secrets fall back to plaintext (legacy) with a warning.
  MFA_ENC_KEY: strEnv(z.string().min(16).optional()),

  // ─────────────────────────────────────────────────────────────────────────
  // TỪ ĐÂY TRỞ XUỐNG: các biến mà mã nguồn ĐANG đọc thẳng qua `process.env`.
  //
  // Chúng được khai ở đây KHÔNG phải để ép mọi nơi phải import `config` — nhiều chỗ đọc
  // `process.env` trực tiếp vẫn chạy đúng. Mục đích là để chúng ĐI QUA MỘT LẦN KIỂM TRA lúc khởi
  // động. Trước đây `RETAIN_AUDIT_DAYS=ba trăm` lặng lẽ thành NaN rồi rơi về mặc định, và
  // `DB_POOL_MAX=abc` lặng lẽ thành 20 — sai cấu hình mà không ai biết cho tới khi truy số liệu
  // không khớp. Khai ở đây thì gõ sai là CHẾT NGAY LÚC KHỞI ĐỘNG kèm tên biến.
  // ─────────────────────────────────────────────────────────────────────────

  // Gửi email (mời thành viên, đặt lại mật khẩu). Thiếu SMTP_HOST → email bị BỎ, chỉ ghi log.
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: numEnv(z.coerce.number().int().positive().max(65535).default(587)),
  SMTP_SECURE: z.string().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),

  // Mã hoá PII khi lưu trữ (CCCD / số tài khoản / lương). TÁCH BIỆT hoàn toàn với MFA_ENC_KEY,
  // JWT_SECRET, SESSION_SECRET — xoay một khoá không được làm hỏng dữ liệu của hệ thống kia.
  // Không đặt → mã hoá TẮT (ghi thô). Xem docs/operations/DISASTER_RECOVERY.md: MẤT KHOÁ = MẤT DỮ LIỆU VĨNH VIỄN.
  PII_ENC_KEY: strEnv(z.string().min(16, "PII_ENC_KEY phải ≥ 16 ký tự (sinh bằng: openssl rand -base64 48)").optional()),

  // Vòng đời dữ liệu (job dọn chạy hằng ngày 03:00 — src/retention.ts).
  RETAIN_AUDIT_DAYS: numEnv(z.coerce.number().int().positive().default(730)),
  RETAIN_LOGIN_DAYS: numEnv(z.coerce.number().int().positive().default(365)),
  RETAIN_WEBHOOK_DAYS: numEnv(z.coerce.number().int().positive().default(90)),
  RETAIN_VERSION_KEEP: numEnv(z.coerce.number().int().positive().default(100)),
  // 0 = TẮT (mặc định). Đây là XOÁ VĨNH VIỄN file trong kho object nên phải bật tường minh —
  // xem khối chú thích ở chỗ dùng trong src/retention.ts. `nonnegative` chứ không `positive`:
  // 0 là giá trị HỢP LỆ và có nghĩa, còn số ÂM thì `days(-n)` cho ra mốc trong TƯƠNG LAI, tức
  // xoá sạch — phải chết ngay lúc khởi động thay vì im lặng.
  RETAIN_EXPORT_DAYS: numEnv(z.coerce.number().int().nonnegative().default(0)),

  // Kích thước pool kết nối Postgres CỦA MỘT TIẾN TRÌNH (src/db.ts). Nhân với số instance app +
  // worker phải còn nằm dưới max_connections của Postgres.
  DB_POOL_MAX: numEnv(z.coerce.number().int().positive().max(200).default(20)),

  // Trần thời gian của MỌI $transaction tương tác (src/db.ts, transactionOptions). ĐƠN VỊ: MILI-GIÂY.
  //
  // Vì sao khai ở đây chứ không đọc thẳng process.env: chữ "timeout" đọc lên rất dễ hiểu thành GIÂY.
  // `DB_TX_TIMEOUT=5` với `Number(x) || 60_000` là 5 MILI-GIÂY — mọi lần Lưu báo giá, tạo báo giá,
  // nhập Excel, snapshot phiên bản, /pay, saveHn đều chết P2028 ngay lập tức, trong khi tiến trình
  // vẫn khởi động bình thường: ứng dụng đứng ở chế độ CHỈ-ĐỌC mà không có lấy một dòng log giải
  // thích. `-1` cũng lọt qua `||` vì số âm là truthy. `.min(1_000)` chặn cả hai kiểu gõ nhầm đó.
  DB_TX_MAX_WAIT: numEnv(z.coerce.number().int().positive().max(60_000).default(10_000)),
  DB_TX_TIMEOUT: numEnv(z.coerce.number().int().min(1_000, "DB_TX_TIMEOUT tính bằng MILI-GIÂY, tối thiểu 1000 (=1 giây)").max(300_000).default(60_000)),

  // Hạn CƯỠNG BỨC khi tắt tiến trình web (src/server.ts shutdown). ĐƠN VỊ: MILI-GIÂY.
  // Trước đây cứng 10s trong khi lượt lưu báo giá lớn đo được 13,1s và trần transaction là 60s
  // (DB_TX_TIMEOUT) → mỗi lần deploy cắt ngang lượt lưu đang chạy (HTTP-08). 70s = 60s + chỗ ghi
  // audit/phản hồi. PHẢI nhỏ hơn ân hạn của nền tảng: `stop_grace_period` của service app trong
  // docker-compose.prod.yml và `terminationGracePeriodSeconds` (trừ 5s preStop) ở Helm/k8s —
  // tests/ht8-an-han-tat-app.test.js khoá thứ tự đó.
  SHUTDOWN_TIMEOUT_MS: numEnv(z.coerce.number().int().min(1_000, "SHUTDOWN_TIMEOUT_MS tính bằng MILI-GIÂY").max(600_000).default(70_000)),

  // ── PHANH THỜI GIAN Ở CHÍNH POSTGRES (src/db.ts, src/app.ts) ──────────── ĐƠN VỊ: MILI-GIÂY.
  //
  // VÌ SAO CẦN, dù đã có DB_TX_TIMEOUT: trần kia là của PRISMA, và nó chỉ chi phối cái nằm TRONG
  // một `$transaction`. Hai thứ nguy hiểm nhất lại nằm NGOÀI:
  //   · một truy vấn lẻ chạy loạn (kế hoạch xấu, bảng phình) giữ kết nối tới khi nào xong;
  //   · một transaction bị BỎ DỞ (tiến trình web chết, mạng đứt giữa chừng) giữ kết nối
  //     VĨNH VIỄN — và kết nối "idle in transaction" còn chặn cả VACUUM dọn rác.
  // ĐO ĐƯỢC trên production 2026-09-16: `statement_timeout = 0` và
  // `idle_in_transaction_session_timeout = 0`, tức KHÔNG có phanh nào. Đó đúng là cơ chế biến
  // 44/100 kết nối thành 100/100 sau vài tuần: chậm, âm thầm, rồi sập một lần.
  //
  // ĐẶT Ở ĐÂU: qua `options` của pg Pool (`-c statement_timeout=…`), KHÔNG phải `ALTER DATABASE`.
  // Khác biệt quan trọng: cách này chỉ ràng buộc POOL CỦA ỨNG DỤNG, còn `prisma migrate deploy`
  // dùng kết nối riêng nên một migration chạy lâu KHÔNG bị cắt giữa chừng. `ALTER DATABASE` thì
  // trói cả migration — và một migration bị giết giữa chừng là đúng thứ "không được hư hỏng dữ
  // liệu" cấm.
  //
  // DB_STATEMENT_TIMEOUT PHẢI ≥ DB_TX_TIMEOUT (có chốt chặn ngay sau khi parse, xem cuối file).
  // ĐO ĐƯỢC: `statement_timeout` cắt CẢ lúc đang CHỜ KHOÁ — thử với hai kết nối tranh một hàng,
  // bên chờ bị giết đúng 1.501 ms với mã `57014`. Đặt thấp hơn trần transaction là giết luôn
  // những lần chờ khoá HỢP LỆ (hai người cùng lưu một báo giá), biến một lần chờ vài trăm mili
  // giây thành một lỗi.
  DB_STATEMENT_TIMEOUT: numEnv(z.coerce.number().int().min(1_000, "DB_STATEMENT_TIMEOUT tính bằng MILI-GIÂY, tối thiểu 1000").max(600_000).default(60_000)),
  // Trần cho phiên NẰM IM GIỮA MỘT TRANSACTION. Gấp đôi trần transaction: phải rộng hơn khoảng
  // nghỉ dài nhất mà mã JS thật sự có giữa hai câu lệnh trong cùng transaction (đường Lưu báo giá
  // tính lại tổng tiền giữa chừng), nhưng vẫn đủ chặt để thu hồi một transaction đã bị bỏ rơi.
  DB_IDLE_TX_TIMEOUT: numEnv(z.coerce.number().int().min(1_000, "DB_IDLE_TX_TIMEOUT tính bằng MILI-GIÂY, tối thiểu 1000").max(600_000).default(120_000)),

  // ── NGÂN SÁCH BỘ NHỚ CỦA ĐƯỜNG LƯU (src/saveBudget.ts) ────────────────────
  // Đơn vị là DÒNG, không phải request: một lần lưu 20.000 dòng tốn bộ nhớ bằng HAI MƯƠI lần lưu
  // 1.000 dòng, nên đếm suất là đếm sai đơn vị.
  //
  // Công thức, suy từ số ĐO ĐƯỢC (~36 MB mỗi 1.000 dòng, nền ~200 MB):
  //
  // RÀNG BUỘC THẬT LÀ HEAP V8, KHÔNG PHẢI TRẦN cgroup. Trần cgroup 3.072 MB chỉ là chỗ nhân hệ
  // điều hành ra tay; V8 ném heap-OOM BẮT ĐƯỢC ở --max-old-space-size=2.048 MB TRƯỚC đó, và đó
  // mới là con số phải chia. Lấy trần cgroup mà chia là tính ra một ngân sách mà tiến trình không
  // bao giờ tiêu tới được — nó chết trước.
  //     dùng được = 2.048 − 200 = 1.848 MB  →  ÷ 36  ≈ 51.000 dòng đang bay
  //     chừa ~22% cho lưu lượng thường       ≈ 40.000
  //
  // 40.000 = ĐÚNG HAI lần lưu lớn nhất (MAX_SAVE_TOTAL_ROWS = 20.000) chạy song song. Đó là điểm
  // đáng chọn, không phải con số tròn ngẫu nhiên: đo được 20.000 dòng → đỉnh 756 MB, nên hai lượt
  // cùng lúc ≈ 1.512 MB, vẫn dưới heap 2.048 MB.
  //
  // ⚠️ ĐỪNG nâng lên 60.000. Bản trước của chú thích này khuyên đúng như vậy ("nâng trần container
  // lên 4 GB thì đặt SAVE_BUDGET_ROWS=60000") — mà 60.000 CHÍNH LÀ con số đã tái hiện được
  // oom-kill trên máy chủ thật. Muốn nâng thì nâng `--max-old-space-size` TRƯỚC, rồi chia lại
  // theo đúng công thức trên, và đo lại.
  SAVE_BUDGET_ROWS: numEnv(z.coerce.number().int().min(1_000).max(1_000_000).default(40_000)),
  // Bao nhiêu request được XẾP HÀNG chờ ngân sách. Không phải cho đẹp: mỗi người đang chờ đã parse
  // xong payload và đang ÔM nó trong bộ nhớ, nên hàng đợi không trần là một đường OOM khác.
  SAVE_MAX_PENDING: numEnv(z.coerce.number().int().min(0).max(100).default(4)),
  // Dưới ngưỡng này, GET /api/quotes/:id KHÔNG đi qua cổng ngân sách — xem `gacNganSachDoc`.
  // 2.000 chọn theo số ĐO ĐƯỢC: production có 756 hạng mục trên TOÀN BỘ 12 báo giá, nên thực tế
  // không lượt đọc nào chạm cổng; nó chỉ bật lên khi có báo giá thật sự lớn.
  READ_GATE_THRESHOLD_ROWS: numEnv(z.coerce.number().int().min(0).max(1_000_000).default(2_000)),
  // Trần TỔNG cho cột jsonb `QuoteSheet.extraTables` (byte của chuỗi JSON). `paidProof` bị chặn
  // 900.000 ký tự MỖI LƯỢT nhưng không có trần nào trên CỘT, mà /pay đọc–sửa–ghi cả khối mỗi lần.
  // 8 MB ≈ 9 ảnh chứng từ cỡ tối đa trên một trang: rộng rãi cho dùng thật (production đang ở 424
  // BYTE), mà vẫn cắt trường hợp xấu nhất xuống ~11 lần so với kịch bản 90 MB.
  MAX_EXTRA_TABLES_BYTES: numEnv(z.coerce.number().int().min(64 * 1024).max(64 * 1024 * 1024).default(8 * 1024 * 1024)),

  // ── TRẦN DÒNG CHO BẢN XUẤT GDPR (src/services/gdprService.ts) ─────────────
  // Bản xuất trước đó chỉ có trần 1000 BÁO GIÁ, không có trần nào trên số DÒNG. Sức chứa schema là
  // 60 trang × 1000 dòng mỗi báo giá → tối đa 60 TRIỆU dòng dựng thành đối tượng JS cùng lúc, rồi
  // `serializeExport` còn `JSON.stringify(..., 2)` toàn bộ thành MỘT chuỗi. Cùng hình dạng với
  // đường lưu và đường nhập Excel đã vá, chỉ khác là chưa ai chạm tới.
  //
  // 50.000 dòng ≈ 2,5× trần lưu MỘT báo giá (20.000), và theo hệ số đo được ở đường lưu
  // (~36 MB / 1.000 dòng) thì ≈ 1,8 GB — vẫn quá lớn nếu đo thô, nhưng bản xuất GDPR KHÔNG đi qua
  // đường dựng workbook: nó chỉ là hàng CSDL + JSON, nhẹ hơn hẳn mỗi dòng. Đây là mức chọn CÓ CĂN
  // CỨ chứ chưa phải số ĐO: production hiện có 756 hạng mục trên TOÀN BỘ 12 báo giá, nên không có
  // cách nào đo một lượt xuất thật sự lớn ở đây. Vượt trần thì bản xuất VẪN trả đủ danh sách báo
  // giá, chỉ bỏ phần dòng chi tiết và nói rõ trong khối `gioiHan`.
  GDPR_EXPORT_MAX_ROWS: numEnv(z.coerce.number().int().min(1_000).max(10_000_000).default(50_000)),

  // Trần công suất xuất file (src/exportQueue.ts). Hàng đợi đầy → 503 + Retry-After.
  EXPORT_MAX_ACTIVE: numEnv(z.coerce.number().int().positive().max(32).default(3)),
  EXPORT_MAX_PENDING: numEnv(z.coerce.number().int().min(0).max(500).default(20)),

  // ── NGÂN SÁCH DÒNG CHO ĐƯỜNG XUẤT ────────────────────────────────────────
  // `EXPORT_MAX_ACTIVE` đếm SUẤT: ba lượt xuất là ba lượt, dù mỗi lượt 1.000 dòng hay 60.000.
  // Đó là cùng lỗ mà `SAVE_BUDGET_ROWS` sinh ra để bịt cho đường lưu (xem src/saveBudget.ts:56).
  //
  // ĐO THẬT trên ảnh production (container 3 GB, 2 CPU, heap 2 GB — khớp VM dev):
  //      1.000 dòng →  0,9s · RSS đỉnh 140 MB
  //     10.000 dòng → 13,9s · RSS đỉnh 240 MB
  //     20.000 dòng → 26,4s · RSS đỉnh 336 MB
  //     60.000 dòng → 77,1s · RSS đỉnh 416 MB   ← đúng trần MAX_ASYNC_EXPORT_ITEMS
  //
  // Hỏng KHÔNG phải vì bộ nhớ (3 × 416 MB vẫn lọt 3 GB) mà vì THỜI GIAN. Đo qua đúng đường chạy
  // thật (runExportJob → worker_thread), 3 người cùng xuất 60.000 dòng, trần nền 90s:
  //     3 suất → #1 90,1s ✗ · #2 90,1s ✗ · #3 90,2s ✗   HỎNG 3/3, RSS đỉnh 1.214 MB
  //     1 suất → #1 74,4s ✓ · #2 151,0s ✓ · #3 226,8s ✓  HỎNG 0/3, RSS đỉnh   636 MB
  // Ba lượt tranh 2 CPU nên KHÔNG lượt nào kịp trần: hệ thống đốt trọn 90 giây rồi trả về KHÔNG
  // MỘT FILE NÀO. Xếp hàng thì lượt đầu xong ở 74s và cả ba đều có file.
  //
  // Nhưng đặt thẳng EXPORT_MAX_ACTIVE=1 lại bắt lượt xuất 1.000 dòng (0,9s) xếp sau lượt 60.000
  // dòng — phạt đúng những người dùng bình thường. Nên: GIỮ cổng suất (nó chặn số worker_thread)
  // và THÊM cổng ngân sách theo dòng, đúng cặp hai-cổng của đường lưu.
  //
  // 60.000 = đúng MAX_ASYNC_EXPORT_ITEMS, tức "một lượt xuất lớn nhất được phép, chạy một mình".
  // Suy ra từ số đo: 1,285 ms/dòng, 2 CPU ⇒ để mọi lượt kịp trần 90s thì số dòng đang bay phải
  // ≤ 90s × 2 / 1,285ms ≈ 140.000. Lấy 60.000 để còn biên an toàn cho máy bận và cho phần nền.
  // Hệ quả: 3 lượt 20.000 dòng vẫn chạy SONG SONG (vừa đúng 60.000), 2 lượt 30.000 cũng vậy.
  EXPORT_BUDGET_ROWS: numEnv(z.coerce.number().int().min(1_000).max(1_000_000).default(60_000)),

  // Tiến trình worker nền.
  WORKER_CONCURRENCY: numEnv(z.coerce.number().int().positive().max(64).default(4)),
  WORKER_MODE: z.string().optional(),

  // Lấy mẫu Sentry.
  SENTRY_TRACES_SAMPLE_RATE: numEnv(z.coerce.number().min(0).max(1).default(0.1)),
  SENTRY_PROFILES_SAMPLE_RATE: numEnv(z.coerce.number().min(0).max(1).default(0)),

  // Tài khoản KHẨN CẤP: vẫn hiện trong danh sách, vẫn hạ quyền/khoá được; cờ chỉ để admin nhận ra
  // và mọi thay đổi trên nó được ghi thêm sự kiện audit riêng.
  BREAK_GLASS_EMAILS: z.string().optional(),
  // [BỎ DẦN] tên cũ của BREAK_GLASS_EMAILS. Vẫn đọc để tương thích, KHÔNG còn ẩn tài khoản nữa.
  HIDDEN_USER_EMAILS: z.string().optional(),
});

// ── BÍ MẬT TỪ FILE, NGAY TRƯỚC KHI ĐỌC process.env ─────────────────────────
// PHẢI chạy TRƯỚC `schema.safeParse(process.env)` ngay dưới, vì nó ĐẶT THÊM biến vào process.env.
// Đặt sau thì `SESSION_SECRET_FILE` không có tác dụng gì và tiến trình chết vì "thiếu
// SESSION_SECRET" — đúng lúc người vận hành vừa làm đúng cách an toàn hơn.
//
// Và PHẢI đứng ở đây (sau khi `schema` đã khai) chứ không phải đầu file: phạm vi của quy ước
// `*_FILE` là DANH SÁCH KHOÁ CỦA SCHEMA, không phải mọi biến môi trường. `SSL_CERT_FILE` (biến
// chuẩn của OpenSSL, có trên mọi máy sau proxy doanh nghiệp) không được coi là "đọc file này
// thành SSL_CERT". Xem khối chú thích trong src/secretFiles.ts để biết vì sao — bản đầu nhận mọi
// `*_FILE` và làm 25 bài test đỏ vì ứng dụng từ chối khởi động.
try {
  const daNap = napBiMatTuFile(process.env, Object.keys(schema.shape));
  // In TÊN BIẾN và ĐƯỜNG DẪN, KHÔNG BAO GIỜ in giá trị.
  if (daNap.length) {
    console.log(
      `🔐 Nạp ${daNap.length} bí mật từ file: ` + daNap.map((x) => `${x.ten}←${x.duongDan}`).join(", "),
    );
  }
} catch (e) {
  console.error(`❌ ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error("❌ Invalid environment variables:");
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}

export const config = parsed.data;

// ── BẤT BIẾN: PHANH CÂU LỆNH KHÔNG ĐƯỢC CHẶT HƠN TRẦN TRANSACTION ─────────
// Đặt DB_STATEMENT_TIMEOUT < DB_TX_TIMEOUT thì Postgres giết câu lệnh TRƯỚC khi Prisma kịp bỏ
// transaction, nên người dùng nhận `57014` thay vì thông điệp "báo giá quá lớn" của P2028 — và
// tệ hơn: mọi lần CHỜ KHOÁ dài hơn trần cũng chết, biến chuyện hai người cùng lưu (vốn chỉ chờ
// vài trăm mili giây) thành lỗi. Chết ngay lúc khởi động kèm tên biến, đừng để phát hiện lúc
// người dùng đang gõ.
if (config.DB_STATEMENT_TIMEOUT < config.DB_TX_TIMEOUT) {
  console.error(
    `❌ DB_STATEMENT_TIMEOUT (${config.DB_STATEMENT_TIMEOUT}ms) phải ≥ DB_TX_TIMEOUT (${config.DB_TX_TIMEOUT}ms). ` +
      "Phanh câu lệnh chặt hơn trần transaction sẽ giết cả những lần chờ khoá hợp lệ.",
  );
  process.exit(1);
}

// ── BẤT BIẾN: TRẦN MỖI LẦN LƯU KHÔNG ĐƯỢC LỚN HƠN CẢ NGÂN SÁCH ────────────
// MAX_SAVE_TOTAL_ROWS > SAVE_BUDGET_ROWS nghĩa là có những payload HỢP LỆ theo chốt kích thước mà
// cổng ngân sách KHÔNG BAO GIỜ cấp chỗ được — người dùng gõ xong, bấm Lưu, và nhận 413 vĩnh viễn
// dù hệ thống hoàn toàn rảnh. Chết ngay lúc khởi động kèm tên cả hai biến.
{
  const tranMoiLan = Number(process.env.MAX_SAVE_TOTAL_ROWS) || 20_000;
  if (tranMoiLan > config.SAVE_BUDGET_ROWS) {
    console.error(
      `❌ MAX_SAVE_TOTAL_ROWS (${tranMoiLan}) phải ≤ SAVE_BUDGET_ROWS (${config.SAVE_BUDGET_ROWS}). ` +
        "Lớn hơn nghĩa là có báo giá hợp lệ mà không bao giờ lưu được.",
    );
    process.exit(1);
  }
}

// Hard fail in production if SESSION_SECRET is a known weak default
if (
  config.NODE_ENV === "production" &&
  (config.SESSION_SECRET === "dev-secret" ||
    config.SESSION_SECRET === "change-me" ||
    config.SESSION_SECRET.length < 32)
) {
  console.error("❌ SESSION_SECRET unsafe in production (must be ≥ 32 chars and not a default).");
  process.exit(1);
}

// In production, require a dedicated JWT_SECRET (do NOT share with SESSION_SECRET:
// a leak in either subsystem must not compromise the other, and they must rotate
// independently).
if (config.NODE_ENV === "production") {
  if (!process.env.JWT_SECRET || !config.JWT_SECRET) {
    console.error("❌ JWT_SECRET must be set explicitly in production (separate from SESSION_SECRET).");
    process.exit(1);
  }
  if (config.JWT_SECRET.length < 32 || config.JWT_SECRET === config.SESSION_SECRET) {
    console.error("❌ JWT_SECRET must be ≥ 32 chars and different from SESSION_SECRET in production.");
    process.exit(1);
  }
}

// Dev/test convenience: derive a JWT secret from SESSION_SECRET if not set.
if (!config.JWT_SECRET) config.JWT_SECRET = config.SESSION_SECRET;

// Email links must come from configuration, not from request headers.
if (config.NODE_ENV === "production" && !config.APP_BASE_URL) {
  console.error("❌ APP_BASE_URL must be set in production (e.g. https://gianguyen.cloud) — email links are built from it.");
  process.exit(1);
}
if (!config.APP_BASE_URL) config.APP_BASE_URL = `http://localhost:${config.PORT}`;
config.APP_BASE_URL = config.APP_BASE_URL.replace(/\/+$/, "");

// In production, require MFA_ENC_KEY so TOTP secrets are ENCRYPTED at-rest (AES-256-GCM).
// Without it, mfa.js falls back to PLAINTEXT — a single DB dump would expose every user's
// 2FA secret, defeating MFA entirely. (Dev/test still allow the plaintext fallback.)
if (config.NODE_ENV === "production" && !config.MFA_ENC_KEY) {
  console.error("❌ MFA_ENC_KEY must be set in production (encrypts TOTP secrets at-rest; ≥ 16 chars).");
  process.exit(1);
}

// PII_ENC_KEY, KHI ĐÃ ĐẶT, phải mạnh NGANG SESSION_SECRET/JWT_SECRET — ultracode audit 2026-09-09
// (finding PII-3): schema ở trên chỉ đòi ≥16 ký tự cho MỌI môi trường, dù đây là bí mật hậu quả
// nặng nhất khi mất/yếu trong cả hệ ("MẤT KHOÁ = MẤT DỮ LIỆU VĨNH VIỄN", docs/architecture/
// SECURITY_MODEL.md) — nặng hơn SESSION_SECRET (chỉ làm phiên bị giả mạo được, xoay được ngay) và
// JWT_SECRET (tương tự). KHÔNG hạ xuống thành exit-khi-THIẾU: thiếu khoá đã là lựa chọn TỰ NHẬN có
// cảnh báo to ở khối dưới (đúng chủ đích SECURITY_MODEL.md — im lặng tắt mã hoá, không chặn khởi
// động). Ở ĐÂY chỉ chặn trường hợp khoá CÓ ĐẶT nhưng YẾU hoặc TRÙNG bí mật khác — một khoá yếu mà
// tưởng là đã mã hoá còn nguy hiểm hơn biết rõ là chưa mã hoá.
if (config.NODE_ENV === "production" && config.PII_ENC_KEY) {
  const trung = [config.SESSION_SECRET, config.JWT_SECRET, config.MFA_ENC_KEY].filter(Boolean);
  if (config.PII_ENC_KEY.length < 32 || trung.includes(config.PII_ENC_KEY)) {
    console.error("❌ PII_ENC_KEY không đủ mạnh cho production (phải ≥ 32 ký tự và KHÁC SESSION_SECRET/JWT_SECRET/MFA_ENC_KEY). Sinh khoá mới: openssl rand -base64 48.");
    process.exit(1);
  }
}

// Rate limiters share their counters via Redis. Without REDIS_URL they silently fall
// back to a per-process in-memory store, so on a multi-instance prod deploy the
// login/API limits are multiplied per instance and brute-force lockout weakens.
if (config.NODE_ENV === "production" && !config.REDIS_URL) {
  console.warn("⚠️  REDIS_URL is not set in production — rate limiting falls back to a per-process store; set REDIS_URL if you run more than one app instance.");
}

export const isProd = config.NODE_ENV === "production";

/**
 * Tính năng nào ĐANG BẬT theo cấu hình hiện tại.
 *
 * Vì sao cần: hầu hết tính năng phụ ở đây "tắt êm" khi thiếu biến môi trường — không có SMTP_HOST
 * thì email bị BỎ và chỉ ghi một dòng log warn lẫn trong luồng khởi động; không có PII_ENC_KEY thì
 * CCCD/số tài khoản/lương ghi THÔ mà không ai nói gì; không có S3 thì ảnh chứng từ trả 503 đúng lúc
 * kế toán cần lưu. Từng cái đều là lựa chọn hợp lệ ở môi trường dev, nhưng ở production thì gần như
 * luôn là cấu hình sót — và cách duy nhất để phát hiện hiện nay là đi đọc mã nguồn.
 *
 * server.ts in bảng này lúc khởi động để trạng thái thật nằm ngay trong log, không phải suy đoán.
 */
export function featureStatus() {
  return {
    "Kho object (S3/MinIO)": !!(config.S3_ENDPOINT && config.S3_ACCESS_KEY && config.S3_SECRET_KEY),
    "Mã hoá PII khi lưu": !!config.PII_ENC_KEY,
    "Mã hoá bí mật MFA": !!config.MFA_ENC_KEY,
    "Redis (hàng đợi/rate-limit/SSE)": !!config.REDIS_URL,
    "Gửi email (SMTP)": !!config.SMTP_HOST,
    "Sentry": !!config.SENTRY_DSN,
    "Thông báo Telegram": !!config.TELEGRAM_BOT_TOKEN,
    "/metrics có token bảo vệ": !!config.METRICS_TOKEN,
  };
}

// Ở production, những thứ TẮT ÊM mà gây MẤT DỮ LIỆU hoặc hỏng nghiệp vụ thì phải kêu to.
// KHÔNG exit: mỗi cái đều có thể là lựa chọn có chủ ý của một triển khai nhỏ, và làm cả ứng dụng
// không khởi động được vì một tính năng phụ còn tệ hơn. Nhưng im lặng thì không được.
if (config.NODE_ENV === "production") {
  if (!config.PII_ENC_KEY) {
    console.warn(
      "⚠️  PII_ENC_KEY chưa đặt ở production — CCCD / số tài khoản / lương đang được ghi THÔ vào CSDL.\n" +
        "    Bất kỳ bản dump CSDL nào cũng lộ nguyên các trường này. Xem docs/operations/DISASTER_RECOVERY.md."
    );
  }
  if (!config.S3_ENDPOINT) {
    console.warn(
      "⚠️  S3_* chưa đặt ở production — ảnh chứng từ thanh toán KHÔNG lưu được (route trả 503)."
    );
  }
  if (!config.SMTP_HOST) {
    console.warn(
      "⚠️  SMTP_HOST chưa đặt ở production — thư mời thành viên và đặt lại mật khẩu sẽ bị BỎ IM LẶNG."
    );
  }
}
