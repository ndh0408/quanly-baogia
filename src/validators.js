import { z } from "zod";
import { config } from "./config.js";

const pwd = z
  .string()
  .min(config.PASSWORD_MIN_LENGTH, `Mật khẩu tối thiểu ${config.PASSWORD_MIN_LENGTH} ký tự`)
  .max(128, "Mật khẩu quá dài")
  .refine((s) => /[A-Za-z]/.test(s) && /\d/.test(s), {
    message: "Mật khẩu phải có cả chữ và số",
  });

const username = z
  .string()
  .min(3, "Username tối thiểu 3 ký tự")
  .max(40, "Username quá dài")
  .regex(/^[a-zA-Z0-9_.-]+$/, "Username chỉ chứa chữ, số, dấu . _ -");

const displayName = z.string().min(1).max(120).trim();
const phone = z.string().max(40).trim().optional().or(z.literal("").transform(() => undefined));
const title = z.string().max(120).trim().optional().or(z.literal("").transform(() => undefined));

export const LoginSchema = z.object({
  username: z.string().min(1, "Thiếu username").max(80),
  password: z.string().min(1, "Thiếu mật khẩu").max(128),
});

export const ChangePasswordSchema = z.object({
  oldPassword: z.string().min(1),
  newPassword: pwd,
});

// Admin invites an employee by email; they self-onboard.
export const UserInviteSchema = z.object({
  email: z.string().email("Email không hợp lệ").max(160),
  displayName,
  role: z.enum(["admin", "manager", "employee"]).default("employee"),
});

export const AcceptInviteSchema = z.object({
  token: z.string().min(10).max(200),
  displayName: displayName.optional(),
  phone,
  password: pwd,
});

export const UserCreateSchema = z.object({
  username,
  password: pwd,
  displayName,
  role: z.enum(["admin", "manager", "employee"]),
  phone,
  title,
});

export const UserUpdateSchema = z.object({
  displayName: displayName.optional(),
  role: z.enum(["admin", "manager", "employee"]).optional(),
  phone,
  title,
  active: z.boolean().optional(),
  password: pwd.optional(),
});

const itemSchema = z.object({
  order: z.coerce.number().int().optional(),
  kind: z.enum(["item", "info", "sub"]).default("item"),
  name: z.string().max(2000).default(""),
  detail: z.string().max(2000).optional().nullable(),
  unit: z.string().max(40).optional().nullable(),
  // Allow negatives so a row can act as a discount line (vd "Giảm giá" với đơn giá âm).
  quantity: z.coerce.number().gte(-1e12).lte(1e12).default(0),
  unitPrice: z.coerce.number().gte(-1e12).lte(1e12).default(0),
  days: z.coerce.number().nonnegative().optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

const sheetSchema = z.object({
  templateId: z.coerce.number().int().positive(),
  name: z.string().max(120).optional().nullable(),
  order: z.coerce.number().int().optional(),
  items: z.array(itemSchema).max(500).default([]),
});

export const QuoteCreateSchema = z.object({
  // quoteNumber is server-generated; allow override but not required
  quoteNumber: z.string().max(40).optional(),
  title: z.string().min(1, "Thiếu tiêu đề").max(500),
  toCompany: z.string().min(1, "Thiếu khách hàng").max(500),
  toContact: z.string().max(200).optional().nullable(),
  toEmail: z.string().max(200).optional().nullable(),
  companyId: z.coerce.number().int().positive(),
  fromContact: z.string().max(200).optional().default(""),
  fromPhone: z.string().max(40).optional().nullable(),
  fromTitle: z.string().max(120).optional().nullable(),
  fromAddress: z.string().max(500).optional(),
  city: z.string().max(120).optional(),
  quoteDate: z.coerce.date()
    .refine((d) => d.getFullYear() >= 2015 && d.getTime() <= Date.now() + 86_400_000, "Ngày báo giá không hợp lệ")
    .optional(),
  validUntil: z.coerce.date().optional().nullable(),
  customerId: z.coerce.number().int().positive().optional().nullable(),
  managerId: z.coerce.number().int().positive().optional().nullable(), // quản lý phụ trách (bắt buộc khi nhân viên tạo)
  greeting: z.string().max(2000).optional(),
  vatPercent: z.coerce.number().min(0).max(100).default(8),
  discount: z.coerce.number().min(0).max(1e12).optional(),
  showTotals: z.coerce.boolean().optional(),
  notes: z.string().max(4000).optional().nullable(),
  // base64 data URL of the customer logo (~3MB cap to bound payload size)
  customerLogo: z.string().max(3_500_000)
    .refine((s) => /^data:image\/(png|jpe?g|gif|webp);base64,/i.test(s), "Logo phải là ảnh PNG/JPG/GIF/WEBP")
    .optional().nullable(),
  sheets: z.array(sheetSchema).min(1, "Phải có ít nhất 1 sheet").max(20),
});

// IMPORTANT: defined explicitly (NOT QuoteCreateSchema.partial()) because the
// create schema's `.default("")` on optional fields would materialize empty
// strings for absent keys on a partial update. The handler then does
// `"" || null` → null and Prisma rejects required columns like fromContact.
// Here every field is truly optional with NO default: absent => undefined =>
// the handler skips it, so only fields the client actually sent get updated.
export const QuoteUpdateSchema = z.object({
  quoteNumber: z.string().max(40).optional(),
  title: z.string().min(1).max(500).optional(),
  toCompany: z.string().min(1).max(500).optional(),
  toContact: z.string().max(200).optional().nullable(),
  toEmail: z.string().max(200).optional().nullable(),
  companyId: z.coerce.number().int().positive().optional(),
  fromContact: z.string().max(200).optional(),
  fromPhone: z.string().max(40).optional().nullable(),
  fromTitle: z.string().max(120).optional().nullable(),
  fromAddress: z.string().max(500).optional(),
  city: z.string().max(120).optional(),
  quoteDate: z.coerce.date()
    .refine((d) => d.getFullYear() >= 2015 && d.getTime() <= Date.now() + 86_400_000, "Ngày báo giá không hợp lệ")
    .optional(),
  validUntil: z.coerce.date().optional().nullable(),
  customerId: z.coerce.number().int().positive().optional().nullable(),
  greeting: z.string().max(2000).optional(),
  vatPercent: z.coerce.number().min(0).max(100).optional(),
  discount: z.coerce.number().min(0).max(1e12).optional(),
  showTotals: z.coerce.boolean().optional(),
  notes: z.string().max(4000).optional().nullable(),
  customerLogo: z.string().max(3_500_000)
    .refine((s) => /^data:image\/(png|jpe?g|gif|webp);base64,/i.test(s), "Logo phải là ảnh PNG/JPG/GIF/WEBP")
    .optional().nullable(),
  sheets: z.array(sheetSchema).max(20).optional(),
});

export const ListQuerySchema = z.object({
  q: z.string().max(200).optional(),
  status: z.enum(["draft", "pending", "approved", "rejected"]).optional(),
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
