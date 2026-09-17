import { z } from "zod";
import type { Request, Response, NextFunction } from "express";
import { config } from "./config.js";
import { viZodErrorMap } from "./zodErrorMap.js";

// Global Vietnamese fallback for any rule without its own message. Runs here (module
// body, after imports) so config.js env parsing above keeps its operator-facing text,
// while every request-time validation below resolves to Vietnamese.
z.config({ customError: viZodErrorMap });

// zbool treats the STRING "false" as truthy → true (JS gotcha: any non-empty
// string is truthy). Parse the MEANING instead: "false"/"0"/"no"/"off"/"" → false, other
// strings → true, real booleans pass through. Use for any boolean from a query/form value.
// (Mirrors the fix config.js applies to S3_FORCE_PATH_STYLE.)
export const zbool = z.preprocess(
  (v) => (typeof v === "string" ? !/^(false|0|no|off|)$/i.test(v.trim()) : v),
  z.boolean(),
);

// Data-URL ảnh chứng từ thanh toán, kiểm TOÀN CHUỖI (có neo cuối `$`).
//
// VÌ SAO tách ra hằng số dùng chung: hai route chứng từ (`quotes.routes.ts` /pay và
// `personnel.routes.ts` /payment) trước đây mỗi nơi tự viết một regex CHỈ khớp TIỀN TỐ, nên
// `data:image/png;base64,<png hợp lệ>" onerror="…` lọt vào CSDL nguyên văn — đúng cái lỗ mà
// customerLogo/itemSchema.images bên dưới đã bịt và ghi chú rõ. Regex ở hai nơi thì hai nơi sẽ
// trôi khỏi nhau; một chỗ là một chỗ.
//
// Tập MIME CỐ Ý hẹp hơn customerLogo (KHÔNG có gif): `sniffImage` trong src/paymentProof.ts chỉ
// nhận PNG/JPEG/WEBP, nhận gif ở cửa vào chỉ đổi lỗi 400 thành 415 ở tầng sâu hơn.
export const PAYMENT_PROOF_DATA_URL_RE = /^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/]+={0,2}$/i;

// Chặn TOP mật khẩu bị dò nhiều nhất (nguồn: các bảng "top common password" bị rò rỉ hàng năm,
// vd Have I Been Pwned / SplashData) — quy tắc "có chữ và số" một mình cho "password1", "abc12345"
// qua thẳng, mà đây là hai trong số mật khẩu bị thử ĐẦU TIÊN ở mọi cuộc dò tự động. Đo được trên
// production 2026-09-07: tài khoản mời mới chấp nhận "password1" không một cảnh báo nào.
// So khớp KHÔNG phân biệt hoa/thường và bỏ khoảng trắng hai đầu — kẻ dò cũng thử "Password1".
const MAT_KHAU_PHO_BIEN = new Set([
  "password", "password1", "password12", "password123", "passw0rd", "passw0rd1",
  "12345678", "123456789", "1234567890", "87654321", "11111111", "00000000",
  "qwerty123", "qwertyui", "qwerty12", "1qaz2wsx", "1q2w3e4r",
  "letmein1", "letmein123", "admin123", "administrator1",
  "welcome1", "welcome123", "iloveyou1", "iloveyou2",
  "abc12345", "abcd1234", "changeme1", "changeme123",
  "matkhau123", "matkhau1", "123matkhau",
]);
const pwd = z
  .string()
  .min(config.PASSWORD_MIN_LENGTH, `Mật khẩu tối thiểu ${config.PASSWORD_MIN_LENGTH} ký tự`)
  .max(128, "Mật khẩu quá dài")
  // bcrypt (bcryptjs) BỎ IM LẶNG mọi byte sau byte thứ 72. Mật khẩu tiếng Việt (đa byte UTF-8) chạm 72
  // byte chỉ sau ~24–36 ký tự nhìn thấy → phần đuôi vô tác dụng mà không báo. Chặn ngay lúc ĐẶT mật khẩu
  // để chính sách khớp thực tế (login vẫn nhận tối đa 128 để tài khoản cũ có mật khẩu dài vẫn đăng nhập).
  .refine((s) => Buffer.byteLength(s, "utf8") <= 72, "Mật khẩu quá dài (tối đa 72 byte; tiếng Việt có dấu tính ~2–3 byte mỗi ký tự)")
  .refine((s) => /[A-Za-z]/.test(s) && /\d/.test(s), {
    message: "Mật khẩu phải có cả chữ và số",
  })
  .refine((s) => !MAT_KHAU_PHO_BIEN.has(s.trim().toLowerCase()), {
    message: "Mật khẩu này quá phổ biến, dễ bị dò ra — vui lòng chọn mật khẩu khác",
  });

const username = z
  .string()
  .min(3, "Tên đăng nhập tối thiểu 3 ký tự")
  .max(40, "Tên đăng nhập tối đa 40 ký tự")
  .regex(/^[a-zA-Z0-9_.-]+$/, "Tên đăng nhập chỉ được chứa chữ, số và các ký tự . _ -");

const displayName = z.string().min(1, "Vui lòng nhập họ tên").max(120, "Họ tên tối đa 120 ký tự").trim();
const phone = z.string().max(40, "Số điện thoại tối đa 40 ký tự").trim().optional().or(z.literal("").transform(() => undefined));
const title = z.string().max(120, "Chức danh tối đa 120 ký tự").trim().optional().or(z.literal("").transform(() => undefined));

// A user's "Mã dự án" is each person's OWN unique PREFIX (vd FP_D26); the system then
// auto-appends the per-quote sequence _001, _002… (nextProjectCode). So the prefix must
// NOT itself end in a sequence — otherwise you get FP_D26_001_001. Strip any trailing
// _NNN the admin accidentally typed (repeat to undo a pasted already-allocated code).
//
// VÀ BỎ LUÔN HAI SỐ NĂM Ở CUỐI. `nextProjectCode` tự thêm năm hiện tại ("FP_A" → "FP_A26_001"),
// nên một mã nhân viên tận cùng bằng 2 chữ số LUÔN LUÔN là năm gõ nhầm vào: để nguyên thì báo giá
// ra "FP_A2626_001", và sang năm mới nó vẫn kẹt ở năm cũ. Đây chính là lỗi đã xảy ra trên
// production (cả 5 nhân viên đều mang đuôi "26"), nên chặn ngay tại ô nhập để không tái diễn.
const projectCode = z
  .string()
  .max(40, "Mã dự án tối đa 40 ký tự")
  .transform((s) => {
    let v = (s || "").trim();
    while (/_\d{3}$/.test(v)) v = v.replace(/_\d{3}$/, "");   // _NNN = the auto sequence (exactly 3 digits)
    v = v.replace(/\d{2}$/, "");                              // YY = năm, do nextProjectCode thêm
    return v.length ? v : null;
  })
  .nullable()
  .optional();

export const LoginSchema = z.object({
  username: z.string().min(1, "Vui lòng nhập tên đăng nhập").max(80, "Tên đăng nhập tối đa 80 ký tự"),
  password: z.string().min(1, "Vui lòng nhập mật khẩu").max(128, "Mật khẩu tối đa 128 ký tự"),
});

export const ChangePasswordSchema = z.object({
  oldPassword: z.string().min(1, "Vui lòng nhập mật khẩu cũ"),
  newPassword: pwd,
});

// Admin invites an employee by email; they self-onboard.
export const UserInviteSchema = z.object({
  email: z.string().email("Email không hợp lệ").max(160, "Email tối đa 160 ký tự"),
  displayName,
  role: z.enum(["admin", "manager", "account_hn", "hr", "accountant"]).default("manager"),
  projectCode,
  permissions: z.array(z.string().max(60)).max(100).optional(), // tích quyền per-user lúc mời
});

export const AcceptInviteSchema = z.object({
  token: z.string().min(10, "Mã lời mời không hợp lệ").max(200, "Mã lời mời không hợp lệ"),
  displayName: displayName.optional(),
  phone,
  title,
  senderName: title,
  password: pwd,
  // Mã yếu tố thứ hai cho tài khoản ĐÃ bật MFA. Đường này kiêm "Quên mật khẩu" nên nó cấp phiên
  // đầy đủ — không hỏi mã ở đây thì chiếm được hộp thư là gỡ được luôn MFA. 6 chữ số = TOTP;
  // 10–20 ký tự hex = mã dự phòng (10 là định dạng CŨ, 20 là định dạng hiện tại 80 bit).
  mfaToken: z.string().regex(/^([0-9]{6}|[0-9A-Fa-f]{10,20})$/, "Mã MFA gồm 6 chữ số, hoặc mã dự phòng").optional(),
});

export const UserCreateSchema = z.object({
  username,
  password: pwd,
  displayName,
  role: z.enum(["admin", "manager", "account_hn", "hr", "accountant"]),
  phone,
  title,
  canSign: zbool.optional(),
});

export const UserUpdateSchema = z.object({
  displayName: displayName.optional(),
  role: z.enum(["admin", "manager", "account_hn", "hr", "accountant"]).optional(),
  phone,
  title,
  active: z.boolean().optional(),
  password: pwd.optional(),
  projectCode,
  canSign: zbool.optional(),
  permissions: z.array(z.string().max(60)).max(100).optional(), // tích quyền per-user (tập đầy đủ; [] = theo role)
});

// Every status a quote can actually hold (mirror of prisma QuoteStatus enum).
// Used by the list filter; the UI dropdown offers all of these.
export const QUOTE_STATUSES = ["draft", "pending", "approved", "rejected", "sent", "converted", "lost"];

// base64 data URL of the customer logo (~3MB cap to bound payload size).
// The WHOLE string must be valid base64 — a prefix-only check would let markup
// ride along and end up in an <img src> attribute (stored XSS).
const customerLogoSchema = z.string().max(3_500_000)
  .refine(
    (s) => /^data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/i.test(s),
    "Logo phải là ảnh PNG/JPG/GIF/WEBP (base64)"
  )
  .optional().nullable();

const itemSchema = z.object({
  order: z.coerce.number().int().optional(),
  // Optional link to the catalog Product this row came from. Carried through so an
  // edit (delete+recreate of sheets) doesn't drop the productId / catalog history.
  productId: z.coerce.number().int().positive().optional().nullable(),
  kind: z.enum(["item", "info", "sub", "section", "subsection"]).default("item"),
  label: z.string().max(12).optional().nullable(),
  name: z.string().max(2000).default(""),
  detail: z.string().max(2000).optional().nullable(),
  unit: z.string().max(40).optional().nullable(),
  // Allow negatives so a row can act as a discount line (vd "Giảm giá" với đơn giá âm).
  quantity: z.coerce.number({ error: "Số lượng phải là số" }).gte(-1e12, "Số lượng không hợp lệ").lte(1e12, "Số lượng không hợp lệ").default(0),
  quantityExact: z.boolean().optional().default(false),
  unitPrice: z.coerce.number({ error: "Đơn giá phải là số" }).gte(-1e12, "Đơn giá không hợp lệ").lte(1e12, "Đơn giá không hợp lệ").default(0),
  days: z.coerce.number({ error: "Số ngày phải là số" }).nonnegative("Số ngày không được âm").optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  internalNote: z.string().max(2000).optional().nullable(),   // ghi chú nội bộ — KHÔNG xuất Excel
  // Raw Excel-style formulas per numeric field (editor metadata only, e.g.
  // {"unitPrice":"=2000+3000"}). Declared so Zod KEEPS it instead of stripping it
  // (unknown keys are dropped by default), otherwise the "remember formula" feature
  // dies on save. Never used in totals/export — buildSheetsCreate re-validates shape.
  formulas: z.record(z.string().max(40), z.string().max(2000)).optional().nullable(),
  // MẢNG ảnh base64 data-URL cho cột "Hình ảnh" (chỉ hiện khi sheet.showImages). Client tự NÉN nhỏ
  // trước khi gửi. Cap mỗi ảnh ~2MB + tối đa 10 ảnh/hạng mục (chặn payload phình). Nhúng thật vào Excel.
  // BẢO MẬT: kiểm TOÀN BỘ chuỗi là data-URL ảnh base64 hợp lệ (KHÔNG chỉ tiền tố) — giống customerLogo.
  // Kiểm tiền tố (startsWith) để lọt markup như `data:image/png"><a …>` → thoát thuộc tính src="" (chèn HTML).
  images: z.array(
    z.string().max(2_800_000).regex(/^data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/i, "Ảnh không hợp lệ")
  ).max(10).optional().nullable(),
  // Duyệt theo HÀNG cho bảng nội bộ HCM/Khách. Khai báo để Zod KHÔNG strip; quyền đổi (chỉ
  // admin) + đóng dấu ngày/người do server (reconcileExtraApprovals) quyết định, không tin client.
  rid: z.string().max(64).optional().nullable(),
  approved: z.boolean().optional(),
  approvedAt: z.string().max(40).optional().nullable(),
  approvedBy: z.coerce.number().int().positive().optional().nullable(),
  // THANH TOÁN theo HÀNG — phải khai vì ĐÚNG LÝ DO như `approved` ở trên: Zod v4 loại bỏ khoá lạ,
  // và validate() THAY LUÔN req.body bằng object đã lọc. Thiếu ba dòng này thì tới
  // reconcileExtraPayments mọi hàng đều có `paid === undefined`, `!!undefined` là false, và người
  // CÓ quyền quote:internal:pay bấm Lưu là XOÁ SẠCH cờ đã-thanh-toán của mọi hàng nội bộ — mất luôn
  // paidAt/paidById, không cảnh báo gì. Nhánh không-có-quyền thì khôi phục từ CSDL nên vẫn đúng,
  // tức lỗi đánh trúng đúng những người quản lý thanh toán. Xem tests/extra-paid-preserved.test.js.
  //
  // Khai ở đây KHÔNG phải là tin client: reconcileExtraPayments vẫn quyết định giá trị cuối
  // (không quyền → lấy theo CSDL; có quyền → đóng dấu thời gian + người trả ở phía server).
  paid: z.boolean().optional(),
  paidAt: z.string().max(40).optional().nullable(),
  paidById: z.coerce.number().int().positive().optional().nullable(),
  // CỐ Ý KHÔNG khai `paidProof`: ảnh chứng từ chỉ đi qua route /pay, không đi qua đường lưu báo
  // giá (chống base64 chảy qua payload + chống giả mạo). reconcileExtraPayments luôn lấy ảnh từ CSDL.
});

// Bảng nội bộ CỦA MỘT TRANG (chỉ quản lý — không xuất Excel). Dùng cùng itemSchema với lưới chính.
//
// "hanoi" VẪN được nhận ở tầng schema dù bảng Hà Nội đã lên `Quote.hnTables` (2026-09-15): một tab
// chạy bundle CŨ còn gửi nó kèm `sheets`, và nếu zod chặn thì CẢ request Lưu hỏng với "Dữ liệu
// không hợp lệ" — người dùng mất luôn phần báo giá chính vừa sửa, vì một bảng nội bộ họ không hề
// đụng tới. Cửa ghi thứ hai được đóng ở tầng DƯỚI: `sanitizeExtraTables` (src/quoteUtils.ts) chỉ
// nhận ["hcm","khach"] nên bảng hanoi lọt qua schema sẽ bị LOẠI trước khi chạm đĩa.
const extraTableSchema = z.object({
  category: z.enum(["hcm", "khach", "hanoi"]),
  name: z.string().max(120).optional().nullable(),
  templateId: z.coerce.number().int().positive().optional().nullable(),   // mẫu cột (GN/CLF có/không ngày)
  groupSubtotal: z.boolean().optional(),
  items: z.array(itemSchema).max(1000, "Tối đa 1000 dòng trong một trang").default([]),
});

// SỨC CHỨA TỐI ĐA CỦA SCHEMA LƯU: 60 trang × 1000 dòng. Đường xuất NỀN phải nhận được TRỌN vẹn
// ngần này — xem chú thích ngay dưới, và src/worker.ts dùng lại đúng hai hằng số này.
//
// (`MAX_SAVE_TOTAL_ROWS` = 20.000 ở cuối file là trần THẬT cho báo giá MỚI. Nhưng nó chặn theo
// CHIỀU TĂNG, nên báo giá CŨ lớn hơn thế vẫn tồn tại và vẫn phải lấy dữ liệu ra được — đó chính là
// lý do trần xuất nền phải bám theo sức chứa SCHEMA, không bám theo trần lưu hiện hành.)
export const MAX_SAVE_SHEETS = 60;
export const MAX_SAVE_ITEMS_PER_SHEET = 1000;

// ── TRẦN XUẤT NỀN: 60.000, VÀ ĐÃ ĐO LÀ KỊP ────────────────────────────────
// ĐO TRONG container quanly-app trên VM (`buildQuoteBuffer` thật, template gn_banner):
//     20.000 dòng →  7,6s →  9,5 MB
//     40.000 dòng → 15,0s → 19,3 MB
//     60.000 dòng → 23,0s → 29,0 MB
//
// 23,0s LỌT trần cứng 30s của `generateInWorker` — nhưng chỉ dư 23%, không đủ cho một VM bận hơn.
// ĐÃ THỬ hạ hằng số này xuống 40.000 cho dư 100%: SAI, và ba cụm test (b1/b2/b9) bắt ngay. Báo giá
// CŨ lớn hơn 40.000 sẽ không còn ĐƯỜNG NÀO lấy dữ liệu ra — nhốt người dùng lại với chính dữ liệu
// của họ, đúng cái bẫy mà khối "ĐÃ GỠ. ĐỪNG ĐẶT LẠI" ở cuối file này ghi lại.
//
// Cách đúng là nới THỜI GIAN cho riêng đường nền (`EXPORT_GEN_TIMEOUT_NEN_MS`, src/exportQueue.ts):
// ở đó không có request nào đang chờ, người dùng hỏi trạng thái job khi nào cũng được.
export const MAX_ASYNC_EXPORT_ITEMS = MAX_SAVE_SHEETS * MAX_SAVE_ITEMS_PER_SHEET;   // 60 000

// ── BẤT BIẾN: TRẦN MỘT LƯỢT XUẤT KHÔNG ĐƯỢC LỚN HƠN CẢ NGÂN SÁCH ──────────
// Cùng luật, cùng lý do như cặp MAX_SAVE_TOTAL_ROWS ≤ SAVE_BUDGET_ROWS (src/config.ts). Nếu
// `MAX_ASYNC_EXPORT_ITEMS > EXPORT_BUDGET_ROWS` thì tồn tại báo giá HỢP LỆ theo trần kích thước
// mà cổng ngân sách KHÔNG BAO GIỜ cấp chỗ nổi — người dùng bấm Xuất và nhận 503 vĩnh viễn dù máy
// hoàn toàn rảnh.
//
// LÀ HÀM THUẦN, GỌI LÚC KHỞI ĐỘNG — KHÔNG phải phép kiểm chạy lúc import. Bản đầu đặt thẳng
// `process.exit(1)` ở thân module và nó tự bắn vào chân mình: mọi bài test muốn dựng cổng với
// ngân sách nhỏ đều làm chết tiến trình vitest ngay ở câu `import`. Một chốt chặn mà không bài
// nào chạm tới được thì cũng không bài nào chứng minh được là nó còn sống.
export function loiBatBienNganSachXuat(tranMotLuot: number, nganSach: number): string | null {
  if (tranMotLuot <= nganSach) return null;
  return (
    `❌ MAX_ASYNC_EXPORT_ITEMS (${tranMotLuot}) phải ≤ EXPORT_BUDGET_ROWS (${nganSach}). ` +
    "Lớn hơn nghĩa là có báo giá hợp lệ mà không bao giờ xuất được."
  );
}

/** Gọi ở MỌI điểm khởi động có đường xuất (server.ts, worker.ts). Sai cấu hình thì chết ngay,
 *  kèm tên cả hai biến, còn hơn để hỏng lúc có người bấm Xuất. */
export function kiemBatBienXuatLucKhoiDong() {
  const loi = loiBatBienNganSachXuat(MAX_ASYNC_EXPORT_ITEMS, config.EXPORT_BUDGET_ROWS);
  if (loi) {
    console.error(loi);
    process.exit(1);
  }
}

// LƯU PHẦN HÀ NỘI — `PUT /api/quotes/:id/hn` (src/hnWorkflow.ts saveHn).
//
// Route này TRƯỚC ĐÂY không có body schema: `validate({ params: idParam })` chỉ kiểm `:id`, còn
// `saveHn` đọc thẳng `req.body?.hnSheets` rồi đưa vào `sanitizeExtraTables`, mà hàm đó persist
// NGUYÊN TRẠNG mọi cờ do server sở hữu (`approved*`, `paid*`, `paidProof`). Người dùng duy nhất
// gọi được endpoint này là account Hà Nội — vai trò có ĐÚNG BA quyền
// (`quote:read:own`, `quote:update:own`, `quote:hn:fill`), KHÔNG có `quote:internal:pay` cũng
// KHÔNG có `quote:internal:approve`. Xem tests/hn-save-forgery.test.js.
//
// Schema chỉ chặn HÌNH DẠNG (kích thước payload, kiểu dữ liệu). Phần QUYỀN — cờ duyệt/thanh toán
// phải lấy lại từ CSDL — do saveHn xử lý; hai lớp này bổ sung nhau, không thay thế nhau.
// TRẦN của bảng Hà Nội ở CẤP BÁO GIÁ. Trước 2026-09-15 trần là 20 bảng/TRANG × 60 trang; gộp về
// một mảng cho cả báo giá mà giữ 20 là HẠ trần thật. Đo trên dữ liệu đang chạy (2026-09-15): nhiều
// nhất 2 bảng và 2 dòng HN trên một báo giá — nên 60 bảng × 1000 dòng vẫn rộng gấp nhiều lần nhu
// cầu, và bằng đúng trần của đường lưu chính nên không đẻ ra một con số thứ hai phải nhớ.
export const MAX_HN_TABLES = MAX_SAVE_SHEETS;

// LƯU PHẦN HÀ NỘI — `PUT /api/quotes/:id/hn` (src/hnWorkflow.ts saveHn).
//
// Route này TRƯỚC ĐÂY không có body schema: `saveHn` đọc thẳng `req.body?.hnSheets` rồi đưa vào
// `sanitizeExtraTables`, mà hàm đó persist NGUYÊN TRẠNG mọi cờ do server sở hữu (`approved*`,
// `paid*`, `paidProof`). Người dùng duy nhất gọi được endpoint này là account Hà Nội — vai trò có
// ĐÚNG BA quyền (`quote:read:own`, `quote:update:own`, `quote:hn:fill`), KHÔNG có
// `quote:internal:pay` cũng KHÔNG có `quote:internal:approve`. Xem tests/hn-save-forgery.test.js.
//
// Schema chỉ chặn HÌNH DẠNG (kích thước payload, kiểu dữ liệu). Phần QUYỀN — cờ duyệt/thanh toán
// phải lấy lại từ CSDL — do saveHn xử lý; hai lớp này bổ sung nhau, không thay thế nhau.
//
// Hình dạng đổi từ `hnSheets[{ sheetId, hnTables }]` sang `hnTables[]` PHẲNG: bảng HN không còn
// thuộc trang nào của chủ báo giá. `baseUpdatedAt` thay cho phép suy đoán "trang đã chết" đã bỏ.
export const HnSaveSchema = z.object({
  // MỐC CHỐT 409 CỦA PHẦN HÀ NỘI. Client nhận `hnRev` ở GET rồi gửi trả nguyên văn.
  // Chuỗi ĐỤC với client (băm sha256 của phần người dùng gõ — xem quoteUtils.hnRevCua), nên
  // 32 ký tự hex; ràng buộc độ dài để không ai nhét cả bảng vào đây.
  baseHnRev: z.string().trim().regex(/^[0-9a-f]{32}$/, "Mốc phần Hà Nội không hợp lệ").optional(),
  // GIỮ LẠI cho tab cũ đang mở lúc deploy: bản trước chỉ có mốc này. Khi CẢ HAI cùng có thì
  // `baseHnRev` thắng — xem lý do ở hnWorkflow.saveHn.
  baseUpdatedAt: z.string().max(40).optional(),
  // CỐ Ý KHÔNG `.default([])`: Zod v4 loại khoá lạ, nên một tab chạy bundle CŨ (gửi `hnSheets`)
  // sẽ parse ra `hnTables: []` — không phân biệt được với "người dùng vừa xoá hết bảng". Server
  // ghi mảng rỗng = XOÁ TRẮNG phần Hà Nội, im lặng. Để `optional()` thì saveHn nhận ra và 400.
  hnTables: z
    .array(extraTableSchema.omit({ category: true }))
    .max(MAX_HN_TABLES, `Tối đa ${MAX_HN_TABLES} bảng Hà Nội trong một báo giá`)
    .optional(),
});

const sheetSchema = z.object({
  // id của sheet ĐANG CÓ trong DB (client gửi lại khi sửa). Lưu = xoá-tạo-lại sheet nên server dùng
  // id này để BÊ trạng thái mức sheet sang bản mới (khách duyệt sheet, chữ ký, số hoá đơn…).
  // Chỉ dùng để GHÉP — mọi giá trị trạng thái vẫn do server quyết, client không đặt được.
  id: z.coerce.number().int().positive().optional().nullable(),
  templateId: z.coerce.number({ error: "Vui lòng chọn mẫu báo giá" }).int("Mẫu báo giá không hợp lệ").positive("Vui lòng chọn mẫu báo giá"),
  name: z.string().max(120).optional().nullable(),
  order: z.coerce.number().int().optional(),
  groupSubtotal: z.boolean().optional(),
  showImages: z.boolean().optional(),   // BẬT cột "Hình ảnh" cho sheet này
  // Giảm giá RIÊNG của sheet (VNĐ, ≥ 0) — trừ TRƯỚC khi tính VAT. Server kẹp lại theo tổng sheet
  // trong computeQuoteTotals, ở đây chỉ chặn số vô lý/âm để báo lỗi tiếng Việt thay vì 500.
  discount: z.coerce.number({ error: "Discount phải là số" }).min(0, "Discount không được nhỏ hơn 0").max(1e12, "Discount quá lớn").optional(),
  items: z.array(itemSchema).max(1000, "Tối đa 1000 dòng trong một trang").default([]),
  extraTables: z.array(extraTableSchema).max(20).optional().default([]),
});

/**
 * TRẦN XUẤT FILE — và vì thế cũng là trần LƯU. Một nguồn duy nhất cho cả hai đường.
 *
 * `src/routes/export.routes.ts` từ chối 413 khi báo giá vượt hai con số này ("dùng xuất nền").
 * Trần LƯU thì rộng hơn hẳn: 60 trang × 1000 dòng = 60.000 dòng, tức người dùng lưu được những
 * báo giá mà HỆ THỐNG KHÔNG CÓ CÁCH NÀO xuất ra file — đường xuất nền không có nút nào trên giao
 * diện React (`grep -rn "/jobs" web/src` không ra kết quả) và còn tự tắt khi không có hàng đợi
 * (`export_async_unavailable`, src/routes/jobs.routes.ts). Kết quả: soạn xong, bấm Lưu thấy "Đã
 * lưu", rồi bấm Xuất file thì nhận một lỗi kèm lời khuyên không bấm được ở đâu cả.
 *
 * Nên chốt chặn được dời LÊN lúc LƯU: hỏng sớm, ngay tại thao tác gây ra nó, kèm câu nói được
 * người dùng phải làm gì (tách bớt sang báo giá khác). Không nới trần xuất trực tiếp thay vì siết
 * trần lưu: sinh file chạy trong worker_threads có trần 30s (`EXPORT_GEN_TIMEOUT_MS`,
 * src/exportQueue.ts:171), vượt là bị `terminate()` — đổi 413 lấy một lỗi hết-giờ thì tệ hơn.
 * (CHƯA ĐO được 60.000 dòng mất bao lâu để sinh file; chỉ biết trần thời gian ở đó là 30s.)
 *
 * Trần TRANG (60 khi lưu) đã nằm dưới trần xuất (100) nên không phải đụng tới.
 */
export const MAX_EXPORT_SHEETS = 100;
export const MAX_EXPORT_ITEMS = 20_000;

/**
 * ── ĐÃ TỪNG CÓ MỘT TRẦN 20.000 DÒNG Ở ĐÂY. ĐÃ GỠ. ĐỪNG ĐẶT LẠI. ─────────────
 *
 * Nó được thêm để đóng mục "lưu được mà không xuất được": trần lưu (60 × 1000 = 60.000) rộng gấp
 * ba trần xuất ĐỒNG BỘ (20.000), nên người dùng dựng được báo giá rồi không tải về nổi.
 *
 * Nhưng siết ở ĐƯỜNG LƯU là sai chỗ, và sai theo kiểu nguy hiểm nhất: nó áp NGƯỢC lên dữ liệu ĐÃ
 * CÓ. Trần này chưa từng tồn tại trước đó, nên CSDL production có thể đang chứa báo giá 25.000
 * dòng lưu hợp lệ từ trước. Với trần mới, chủ báo giá đó sửa MỘT ký tự tiêu đề rồi bấm Lưu là
 * nhận lỗi xác thực và KHÔNG lưu được nữa — mất quyền sửa chính dữ liệu của mình, mà không có
 * đường nào tự thoát (tách bớt trang cũng là một lần Lưu, nên cũng bị chặn).
 *
 * Cách đóng ĐÚNG chỗ: làm cho đường xuất NỀN thật sự nhận hết những gì lưu được (xem
 * `MAX_ASYNC_EXPORT_ITEMS` ở trên và `chanBaoGiaQuaLon` trong src/worker.ts). Khi đó lời khuyên
 * "dùng xuất nền" trong thông điệp 413 của src/routes/export.routes.ts mới là lời khuyên THẬT.
 *
 * ĐÃ NỐI XONG Ở GIAO DIỆN (2026-08-27) — chú thích này TỪNG ghi "SPA chưa nối nút xuất nền, đường
 * thoát hiện có ở tầng API chứ chưa có ở giao diện", và lời khai đó nay SAI:
 * `web/src/lib/exportQuote.ts` bắt 413 rồi tự chuyển sang `POST /api/quotes/:id/export` và hỏi
 * `GET /api/jobs/export/:jobId`, và cả `QuoteEditor.tsx` lẫn `QuoteList.tsx` đều gọi nó.
 * Một chú thích khai còn-thiếu trong khi đã xong thì đẩy người đọc sau đi làm lại việc đã làm —
 * hoặc tệ hơn, dạy họ thôi tin tài liệu trong repo này. Ràng buộc được khoá ở
 * tests/b9-export-escape-route.test.js.
 */

// Bảng nội bộ (extraTables) KHÔNG tính vào đây: chúng không đi vào file xuất (xem extraTableSchema).
export const demSoDong = (sheets: { items?: unknown[] }[]) =>
  sheets.reduce((n, s) => n + (Array.isArray(s?.items) ? s.items.length : 0), 0);

/**
 * ĐẾM TỔNG SỐ DÒNG MỘT LẦN LƯU THẬT SỰ MANG THEO — cả BA nguồn.
 *
 * Khác `demSoDong` ngay trên: hàm kia đếm cho đường XUẤT nên cố ý bỏ bảng nội bộ. Hàm này đếm cho
 * BỘ NHỚ, mà bộ nhớ thì không phân biệt dòng nào xuất ra Excel — mọi dòng đều được parse, validate,
 * sao chép vào payload Prisma, rồi chụp lại một lần nữa vào bản lưu phiên bản.
 *
 * VÌ SAO PHẢI ĐẾM CẢ BA: trần 1000 ở `sheetSchema.items` CHỈ áp cho `sheet.items`. Ngay dòng dưới,
 * `extraTables` được `.max(20)` bảng — mà MỖI bảng lại có `items` riêng cũng `.max(1000)`. Cộng
 * với `hnTables` (`.max(60)` bảng × 1000 dòng), sức chứa THẬT của schema là:
 *     60 trang × (1000 + 20×1000)  +  60 bảng HN × 1000  =  1.320.000 dòng
 * chứ không phải 60.000 như mọi chú thích và tài liệu vẫn khai.
 */
export const demTongDongLuu = (body: unknown): number => {
  const b = body as {
    sheets?: Array<{ items?: unknown[]; extraTables?: Array<{ items?: unknown[] }> }>;
    hnTables?: Array<{ items?: unknown[] }>;
  } | null;
  let n = 0;
  for (const s of b?.sheets ?? []) {
    n += Array.isArray(s?.items) ? s.items.length : 0;
    for (const t of s?.extraTables ?? []) n += Array.isArray(t?.items) ? t.items.length : 0;
  }
  for (const t of b?.hnTables ?? []) n += Array.isArray(t?.items) ? t.items.length : 0;
  return n;
};

/**
 * ── TRẦN TỔNG DÒNG MỖI LẦN LƯU ──────────────────────────────────────────────
 *
 * ĐO ĐƯỢC trên môi trường thật (container app 1.536 MB, heap V8 1.024 MB):
 *     10.000 dòng →  7,1s, đỉnh RSS   460 MB
 *     20.000 dòng → 13,1s, đỉnh RSS   756 MB
 *     30.000 dòng → 18,1s, đỉnh RSS 1.154 MB  (77% trần — sống, nhưng KHÔNG còn chỗ cho ai khác)
 *     60.000 dòng → tiến trình BỊ NHÂN GIẾT (oom-kill, anon-rss 1,5 GB) — CẢ APP SẬP cho mọi người
 * Quy luật: ~36 MB mỗi 1.000 dòng, cộng nền ~200 MB.
 *
 * 20.000 là con số ĐO ĐƯỢC còn an toàn, không phải số chọn cho tròn.
 *
 * ── VÀ VÌ SAO NÓ ÁP THEO CHIỀU TĂNG, KHÔNG PHẢI TUYỆT ĐỐI ───────────────────
 * Đọc khối "ĐÃ GỠ. ĐỪNG ĐẶT LẠI" ở ngay dưới trước khi đụng vào đây. Lần trước một trần tuyệt đối
 * đã bị gỡ vì nó áp NGƯỢC lên dữ liệu đã có: chủ một báo giá 25.000 dòng lưu hợp lệ từ trước sẽ
 * không sửa nổi chính báo giá của mình nữa, kể cả để TÁCH BỚT cho vừa trần (tách cũng là một lần
 * Lưu). Đó là lý do đúng, và nó vẫn đúng.
 *
 * Nên trần này KHÔNG chặn theo con số tuyệt đối mà chặn theo HƯỚNG:
 *   · TẠO MỚI  → chặn thẳng. Không mất gì: thứ chưa tồn tại thì không ai bị khoá khỏi nó, và thứ
 *                vượt trần vốn dĩ lưu không nổi.
 *   · LƯU LẠI  → cho qua nếu  dòng mới ≤ max(trần, số dòng ĐANG CÓ trong CSDL).
 *                Chủ báo giá cũ vẫn sửa được, vẫn GIẢM được, chỉ không PHÌNH THÊM quá trần.
 * Chốt chặn nằm ở src/saveBudget.ts (`gacKichThuocLuu`) vì nó cần đọc CSDL — zod không đọc được.
 */
export const MAX_SAVE_TOTAL_ROWS = Number(process.env.MAX_SAVE_TOTAL_ROWS) || 20_000;

const quoteSheetsSchema = z
  .array(sheetSchema)
  .min(1, "Báo giá phải có ít nhất 1 trang")
  .max(MAX_SAVE_SHEETS, `Tối đa ${MAX_SAVE_SHEETS} trang trong một báo giá`);

export const QuoteCreateSchema = z.object({
  // Trình soạn cho gõ phần Hà Nội ngay khi TẠO báo giá. Thiếu khoá này thì zod cắt sạch và người
  // dùng mất phần vừa gõ mà không một lỗi nào hiện ra.
  hnTables: z.array(extraTableSchema.omit({ category: true })).max(MAX_HN_TABLES).optional(),
  // quoteNumber is server-generated; allow override but not required
  quoteNumber: z.string().max(40).optional(),
  title: z.string().min(1, "Vui lòng nhập tiêu đề báo giá").max(500, "Tiêu đề tối đa 500 ký tự"),
  toCompany: z.string().min(1, "Vui lòng nhập tên khách hàng").max(500, "Tên khách hàng tối đa 500 ký tự"),
  toContact: z.string().max(200).optional().nullable(),
  toEmail: z.string().max(200).optional().nullable(),
  toPhone: z.string().max(200).optional().nullable(),
  toAddress: z.string().max(500).optional().nullable(),
  companyId: z.coerce.number({ error: "Vui lòng chọn công ty phát hành" }).int("Công ty phát hành không hợp lệ").positive("Vui lòng chọn công ty phát hành"),
  fromContact: z.string().max(200).optional().default(""),
  fromPhone: z.string().max(40).optional().nullable(),
  fromTitle: z.string().max(120).optional().nullable(),
  fromAddress: z.string().max(500).optional(),
  city: z.string().max(120).optional(),
  quoteDate: z.coerce.date({ error: "Ngày báo giá không hợp lệ" })
    .refine((d) => d.getFullYear() >= 2015 && d.getTime() <= Date.now() + 86_400_000, "Ngày báo giá không hợp lệ")
    .optional(),
  // Ngày thi công (lắp đặt) — CHỈ quản lý nội bộ, KHÔNG xuất Excel. Có thể ở tương lai
  // nên không chặn cận trên như quoteDate; "" (xoá ngày) → route quy về null.
  executionDate: z.coerce.date({ error: "Ngày thi công không hợp lệ" })
    .refine((d) => d.getFullYear() >= 2015 && d.getFullYear() <= 2100, "Ngày thi công không hợp lệ")
    .nullable().optional().or(z.literal("")),
  customerId: z.coerce.number().int().positive().optional().nullable(),
  managerId: z.coerce.number().int().positive().optional().nullable(), // quản lý phụ trách (bắt buộc khi nhân viên tạo)
  greeting: z.string().max(2000).optional(),
  // Tiêu đề RÚT GỌN (tuỳ chọn) — dùng đặt tên file tải về; trống thì lùi về `title`.
  shortTitle: z.string().max(120, "Tiêu đề rút gọn tối đa 120 ký tự").optional().nullable(),
  vatPercent: z.coerce.number({ error: "VAT phải là số" }).min(0, "VAT không được nhỏ hơn 0%").max(100, "VAT không được vượt quá 100%").default(8),
  // GIỮ ĐỂ KHÔNG VỠ CLIENT CŨ, NHƯNG BỊ BỎ QUA: giảm giá nay ở mức SHEET (`sheets[].discount`)
  // và `Quote.discount` là Σ các sheet, do computeQuoteTotals tính. Xem src/money.ts.
  discount: z.coerce.number({ error: "Chiết khấu phải là số" }).min(0, "Chiết khấu không được nhỏ hơn 0").max(1e12, "Chiết khấu quá lớn").optional(),
  showTotals: zbool.optional(),
  notes: z.string().max(4000).optional().nullable(),
  customerLogo: customerLogoSchema,
  sheets: quoteSheetsSchema,
});

// IMPORTANT: defined explicitly (NOT QuoteCreateSchema.partial()) because the
// create schema's `.default("")` on optional fields would materialize empty
// strings for absent keys on a partial update. The handler then does
// `"" || null` → null and Prisma rejects required columns like fromContact.
// Here every field is truly optional with NO default: absent => undefined =>
// the handler skips it, so only fields the client actually sent get updated.
export const QuoteUpdateSchema = z.object({
  // Bảng Hà Nội cấp báo giá. Chủ báo giá sửa phần HN qua ĐÚNG đường lưu này (khối "Báo Giá Hà Nội"
  // trong trình soạn); account Hà Nội thì đi đường riêng PUT /:id/hn. Vắng mặt = KHÔNG đụng tới —
  // client cũ không gửi khoá này nên phần HN của họ không bị xoá trắng.
  hnTables: z.array(extraTableSchema.omit({ category: true })).max(MAX_HN_TABLES).optional(),
  quoteNumber: z.string().max(40).optional(),
  title: z.string().min(1, "Vui lòng nhập tiêu đề báo giá").max(500, "Tiêu đề tối đa 500 ký tự").optional(),
  shortTitle: z.string().max(120, "Tiêu đề rút gọn tối đa 120 ký tự").optional().nullable(),
  toCompany: z.string().min(1, "Vui lòng nhập tên khách hàng").max(500, "Tên khách hàng tối đa 500 ký tự").optional(),
  toContact: z.string().max(200).optional().nullable(),
  toEmail: z.string().max(200).optional().nullable(),
  toPhone: z.string().max(200).optional().nullable(),
  toAddress: z.string().max(500).optional().nullable(),
  companyId: z.coerce.number().int().positive().optional(),
  fromContact: z.string().max(200).optional(),
  fromPhone: z.string().max(40).optional().nullable(),
  fromTitle: z.string().max(120).optional().nullable(),
  fromAddress: z.string().max(500).optional(),
  city: z.string().max(120).optional(),
  quoteDate: z.coerce.date({ error: "Ngày báo giá không hợp lệ" })
    .refine((d) => d.getFullYear() >= 2015 && d.getTime() <= Date.now() + 86_400_000, "Ngày báo giá không hợp lệ")
    .optional(),
  // Ngày thi công (lắp đặt) — CHỈ quản lý nội bộ, KHÔNG xuất Excel. Có thể ở tương lai
  // nên không chặn cận trên như quoteDate; "" (xoá ngày) → route quy về null.
  executionDate: z.coerce.date({ error: "Ngày thi công không hợp lệ" })
    .refine((d) => d.getFullYear() >= 2015 && d.getFullYear() <= 2100, "Ngày thi công không hợp lệ")
    .nullable().optional().or(z.literal("")),
  customerId: z.coerce.number().int().positive().optional().nullable(),
  greeting: z.string().max(2000).optional(),
  vatPercent: z.coerce.number().min(0).max(100).optional(),
  // BỊ BỎ QUA — xem chú thích cùng tên ở QuoteCreateSchema.
  discount: z.coerce.number({ error: "Chiết khấu phải là số" }).min(0, "Chiết khấu không được nhỏ hơn 0").max(1e12, "Chiết khấu quá lớn").optional(),
  showTotals: zbool.optional(),
  notes: z.string().max(4000).optional().nullable(),
  customerLogo: customerLogoSchema,
  sheets: quoteSheetsSchema.optional(),
  // Khóa LẠC QUAN: mốc updatedAt mà client đã tải. Server chặn ghi đè nếu DB đã đổi (người khác lưu xen vào).
  baseUpdatedAt: z.coerce.date().optional(),
});

export const ListQuerySchema = z.object({
  q: z.string().max(200).optional(),
  status: z.enum(QUOTE_STATUSES).optional(),
  companyId: z.coerce.number().int().positive().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(config.MAX_PAGE_SIZE).default(config.DEFAULT_PAGE_SIZE),
  sort: z.enum(["createdAt", "quoteDate", "total", "quoteNumber"]).default("createdAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
});

/**
 * Express middleware: parse body/query/params against a zod schema and replace
 * the original with the parsed (typed) result. On failure, return 400 with details.
 */
export function validate(schemas: { body?: z.ZodType; query?: z.ZodType; params?: z.ZodType }) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      if (schemas.body) req.body = schemas.body.parse(req.body ?? {});
      if (schemas.query) req.query = schemas.query.parse(req.query ?? {}) as any;
      if (schemas.params) req.params = schemas.params.parse(req.params ?? {}) as any;
      next();
    } catch (e) {
      const issues = e instanceof z.ZodError ? e.issues : [];
      const errors = issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      }));
      res.status(400).json({ error: "Dữ liệu không hợp lệ", details: errors });
    }
  };
}
