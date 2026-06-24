import { z } from "zod";
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

const pwd = z
  .string()
  .min(config.PASSWORD_MIN_LENGTH, `Mật khẩu tối thiểu ${config.PASSWORD_MIN_LENGTH} ký tự`)
  .max(128, "Mật khẩu quá dài")
  .refine((s) => /[A-Za-z]/.test(s) && /\d/.test(s), {
    message: "Mật khẩu phải có cả chữ và số",
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
const projectCode = z
  .string()
  .max(40, "Mã dự án tối đa 40 ký tự")
  .transform((s) => {
    let v = (s || "").trim();
    while (/_\d{3}$/.test(v)) v = v.replace(/_\d{3}$/, "");   // _NNN = the auto sequence (exactly 3 digits)
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
});

export const AcceptInviteSchema = z.object({
  token: z.string().min(10, "Mã lời mời không hợp lệ").max(200, "Mã lời mời không hợp lệ"),
  displayName: displayName.optional(),
  phone,
  title,
  senderName: title,
  password: pwd,
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
  unitPrice: z.coerce.number({ error: "Đơn giá phải là số" }).gte(-1e12, "Đơn giá không hợp lệ").lte(1e12, "Đơn giá không hợp lệ").default(0),
  days: z.coerce.number({ error: "Số ngày phải là số" }).nonnegative("Số ngày không được âm").optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  internalNote: z.string().max(2000).optional().nullable(),   // ghi chú nội bộ — KHÔNG xuất Excel
  // Raw Excel-style formulas per numeric field (editor metadata only, e.g.
  // {"unitPrice":"=2000+3000"}). Declared so Zod KEEPS it instead of stripping it
  // (unknown keys are dropped by default), otherwise the "remember formula" feature
  // dies on save. Never used in totals/export — buildSheetsCreate re-validates shape.
  formulas: z.record(z.string().max(40), z.string().max(2000)).optional().nullable(),
  // Duyệt theo HÀNG cho bảng nội bộ HCM/Khách. Khai báo để Zod KHÔNG strip; quyền đổi (chỉ
  // admin) + đóng dấu ngày/người do server (reconcileExtraApprovals) quyết định, không tin client.
  rid: z.string().max(64).optional().nullable(),
  approved: z.boolean().optional(),
  approvedAt: z.string().max(40).optional().nullable(),
  approvedBy: z.coerce.number().int().positive().optional().nullable(),
});

// Bảng nội bộ (chỉ quản lý — không xuất Excel). Dùng cùng itemSchema với lưới chính.
const extraTableSchema = z.object({
  category: z.enum(["hcm", "hanoi", "khach"]),
  name: z.string().max(120).optional().nullable(),
  templateId: z.coerce.number().int().positive().optional().nullable(),   // mẫu cột (GN/CLF có/không ngày)
  groupSubtotal: z.boolean().optional(),
  items: z.array(itemSchema).max(500).default([]),
});

const sheetSchema = z.object({
  templateId: z.coerce.number({ error: "Vui lòng chọn mẫu báo giá" }).int("Mẫu báo giá không hợp lệ").positive("Vui lòng chọn mẫu báo giá"),
  name: z.string().max(120).optional().nullable(),
  order: z.coerce.number().int().optional(),
  groupSubtotal: z.boolean().optional(),
  items: z.array(itemSchema).max(500).default([]),
  extraTables: z.array(extraTableSchema).max(20).optional().default([]),
});

export const QuoteCreateSchema = z.object({
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
  vatPercent: z.coerce.number({ error: "VAT phải là số" }).min(0, "VAT không được nhỏ hơn 0%").max(100, "VAT không được vượt quá 100%").default(8),
  discount: z.coerce.number({ error: "Chiết khấu phải là số" }).min(0, "Chiết khấu không được nhỏ hơn 0").max(1e12, "Chiết khấu quá lớn").optional(),
  showTotals: zbool.optional(),
  notes: z.string().max(4000).optional().nullable(),
  customerLogo: customerLogoSchema,
  sheets: z.array(sheetSchema).min(1, "Báo giá phải có ít nhất 1 trang").max(20, "Tối đa 20 trang trong một báo giá"),
});

// IMPORTANT: defined explicitly (NOT QuoteCreateSchema.partial()) because the
// create schema's `.default("")` on optional fields would materialize empty
// strings for absent keys on a partial update. The handler then does
// `"" || null` → null and Prisma rejects required columns like fromContact.
// Here every field is truly optional with NO default: absent => undefined =>
// the handler skips it, so only fields the client actually sent get updated.
export const QuoteUpdateSchema = z.object({
  quoteNumber: z.string().max(40).optional(),
  title: z.string().min(1, "Vui lòng nhập tiêu đề báo giá").max(500, "Tiêu đề tối đa 500 ký tự").optional(),
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
  discount: z.coerce.number({ error: "Chiết khấu phải là số" }).min(0, "Chiết khấu không được nhỏ hơn 0").max(1e12, "Chiết khấu quá lớn").optional(),
  showTotals: zbool.optional(),
  notes: z.string().max(4000).optional().nullable(),
  customerLogo: customerLogoSchema,
  sheets: z.array(sheetSchema).min(1, "Báo giá phải có ít nhất 1 trang").max(20, "Tối đa 20 trang trong một báo giá").optional(),
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
export function validate(schemas) {
  return (req, res, next) => {
    try {
      if (schemas.body) req.body = schemas.body.parse(req.body ?? {});
      if (schemas.query) req.query = schemas.query.parse(req.query ?? {});
      if (schemas.params) req.params = schemas.params.parse(req.params ?? {});
      next();
    } catch (e) {
      const errors = (e.issues || []).map((i) => ({
        path: i.path.join("."),
        message: i.message,
      }));
      res.status(400).json({ error: "Dữ liệu không hợp lệ", details: errors });
    }
  };
}
