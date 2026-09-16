// Tầng SERVICE cho domain GDPR (xuất dữ liệu + quyền-được-quên). Bê NGUYÊN logic THUẦN từ
// gdpr.routes.ts: truy vấn tổng hợp dữ liệu cá nhân, sinh các prisma-op vô danh hoá + thu hồi token.
// LƯU Ý: thao tác res (setHeader/end/clearCookie) và session.destroy GIỮ trong route — đó là controller
// HTTP, không phải logic thuần. Service chỉ trả DỮ LIỆU / thực thi transaction + audit. Mẫu theo customerService.ts.
import type { Request } from "express";
import { prisma } from "../db.js";
import { audit } from "../audit.js";
import { httpError } from "../httpError.js";
import { config } from "../config.js";
import { quoteScopeWhere, readScopeWhere } from "../permissions.js";
import { bangNoiBoTheoSheet, bangHnTheoBaoGia } from "./quoteService.js";

/**
 * Tuần tự hoá khối xuất — MỘT lần stringify duy nhất cho cả đường xuất, và là chỗ DUY NHẤT xử lý
 * BigInt (AuditEvent/Notification/RefreshToken đều có id BigInt, thứ JSON.stringify trần sẽ ném).
 *
 * Trước đây việc này làm hai lần: `bigIntToString` chạy JSON.stringify + JSON.parse trên TOÀN BỘ cây
 * (dựng thêm một chuỗi đầy đủ và một cây object đầy đủ trong heap), rồi route lại JSON.stringify lần
 * nữa để gửi đi. Ba bản sao cho một lần tải về. Bỏ vòng parse ấy không đổi một byte nào của JSON gửi
 * ra: Decimal của Prisma có toJSON trả chuỗi và Date có toJSON trả ISO, y hệt vòng cũ tạo ra.
 */
export function serializeExport(data: unknown): string {
  return JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2);
}

/**
 * Prisma ops that erase a user's OWN personal data and lock the account.
 * Returns an array to be passed to prisma.$transaction([...]) so token revocation
 * and PII anonymization commit atomically. Shared by self-delete and admin-delete.
 *
 * Note: quotes/customers owned by the user are intentionally NOT touched here —
 * they are business records (and customer rows are other people's personal data),
 * so they are retained with their ownership link, not anonymized.
 */
function anonymizeUserOps(id: number) {
  return [
    prisma.refreshToken.updateMany({ where: { userId: id }, data: { revokedAt: new Date() } }),
    prisma.user.update({
      where: { id },
      data: {
        username: `deleted-${id}-${Date.now()}`,
        passwordHash: "DELETED",
        displayName: "(deleted user)",
        email: null,
        phone: null,
        title: null,
        mfaSecret: null,
        mfaBackupCodes: [],
        mfaEnabled: false,
        active: false,
        deletedAt: new Date(),
      },
    }),
  ];
}

/**
 * Tổng hợp toàn bộ dữ liệu cá nhân của 1 user thành object xuất khẩu. Tuần tự hoá: `serializeExport`.
 *
 * `session` — PHIÊN CỦA NGƯỜI XIN BẢN XUẤT (đường tự-xuất /me/export). Có nó thì báo giá và khách hàng
 * bị KẸP THÊM phạm vi quyền hiện tại: một nhân viên bị gỡ sạch quyền báo giá/khách hàng (chuyển sang
 * tài khoản "chi phí"/kế toán) nhận 403 ở MỌI đường đọc bình thường (listQuotes/getQuote/listCustomers/
 * listProjects đều fail-closed), nhưng trước 2026-09-08 đường này chỉ có requireAuth và truy vấn
 * thẳng `createdById`/`ownerId` — một request tải về TOÀN BỘ báo giá họ từng tạo kèm giá từng hạng
 * mục, bảng chi phí nội bộ, và 5000 khách hàng đầy đủ liên hệ — dữ liệu của BÊN THỨ BA. Cùng lập luận
 * mà chú thích bên dưới đã dùng để loại customerLogo. Đường admin xuất hộ (/users/:id/export) không
 * truyền session → giữ nguyên hành vi (admin có read:all).
 */
export async function exportUser(userId: number, session?: Parameters<typeof quoteScopeWhere>[0]) {
  // null = KHÔNG có quyền đọc nhóm đó → nhóm đó rỗng trong bản xuất (fail-closed như mọi đường đọc).
  const phamViBaoGia = session ? quoteScopeWhere(session) : {};
  const phamViKhach = session ? readScopeWhere(session, "customer") : {};
  const [user, quotes, customers, auditEvents, refreshTokens, notifications] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, username: true, displayName: true, email: true, phone: true,
        title: true, role: true, active: true,
        lastLoginAt: true, lastLoginIp: true, createdAt: true,
      },
    }),
    // Ba cột BLOB bị loại khỏi bản xuất — lý do KHÁC NHAU cho từng cột, không phải "cho nhẹ":
    //   · QuoteItem.images  — mảng data-URL base64, trần validator là 10 ảnh × 2.800.000 ký tự MỖI
    //     hạng mục (src/validators.ts:161-163). Một báo giá cỡ trung đã vượt xa bộ nhớ hợp lý, mà
    //     take ở đây là 1000 báo giá.
    //   · Quote.customerLogo — data-URL base64 logo của KHÁCH HÀNG, không phải dữ liệu cá nhân của
    //     người xin bản xuất: đưa vào một tệp tải-về là tự tạo đường rò.
    //
    // CÒN `QuoteSheet.extraTables` THÌ GIỮ — CHỈ CẮT RIÊNG ẢNH, VÀ CẮT NGAY TẠI SQL.
    //
    // Bản trước dùng `omit: { extraTables: true }` và chú thích đi kèm khẳng định "mọi trường
    // chữ/số của báo giá, sheet và hạng mục vẫn nguyên". Sai: `extraTables` là MỘT cột jsonb, cắt
    // nó là cắt cả nội dung — các bảng nội bộ Chi Phí HCM / Giá Hà Nội / Phí Khách Hàng, gồm
    // {name, detail, unit, quantity, unitPrice, days, notes} của từng dòng. Đó là dữ liệu do CHÍNH
    // người xin bản xuất nhập vào báo giá của họ; một bản xuất GDPR thiếu nó là thiếu thật.
    //
    // Nhưng cắt ở tầng JS cũng sai, và tests/b5-gdpr-export-anh.test.js đo được: ảnh `paidProof`
    // vẫn đi qua dây rồi mới bị bỏ (2,4 MB thay vì 0,36 MB cho cùng bộ dữ liệu). Nên dùng lại
    // `bangNoiBoTheoSheet` của quoteService — câu SQL DUY NHẤT trong repo cắt `paidProof` — thay vì
    // viết bản thứ hai. Hai bản chép của quy tắc cắt ấy chắc chắn sẽ trôi khỏi nhau.
    phamViBaoGia === null ? Promise.resolve({ danhSach: [] as any[], gioiHan: null }) : napBaoGiaCoTran(userId, phamViBaoGia),
    phamViKhach === null ? Promise.resolve([] as any[]) : prisma.customer.findMany({ where: { AND: [{ ownerId: userId }, phamViKhach] }, take: 5000 }),
    prisma.auditEvent.findMany({
      where: { actorId: userId },
      orderBy: { createdAt: "desc" },
      take: 5000,
    }),
    prisma.refreshToken.findMany({
      where: { userId },
      select: { id: true, family: true, ip: true, userAgent: true, expiresAt: true, revokedAt: true, createdAt: true },
    }),
    prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 5000,
    }),
  ]);

  return {
    exportedAt: new Date(),
    format: "qly-gdpr-export/1.0",
    user,
    // `gioiHan` chỉ xuất hiện khi bản xuất BỊ CẮT. Có mặt = bản xuất này KHÔNG đầy đủ, và khối đó
    // nói rõ cắt ở đâu và lấy nốt bằng cách nào. Cắt mà im lặng là tệ hơn không cắt: người nhận
    // tưởng mình đã có đủ dữ liệu.
    ...(quotes.gioiHan ? { gioiHan: quotes.gioiHan } : {}),
    quotes: quotes.danhSach,
    customers,
    auditEvents,
    refreshTokens,
    notifications,
  };
}

/**
 * Nạp báo giá cho bản xuất GDPR, CÓ TRẦN SỐ DÒNG, và nạp THEO LÔ.
 *
 * ── VÌ SAO ────────────────────────────────────────────────────────────────
 * Bản trước là một `findMany({ take: 1000, include: { sheets: { include: { items } } } })` —
 * trần 1000 BÁO GIÁ, không có trần nào trên số DÒNG. Sức chứa schema là 60 trang × 1000 dòng mỗi
 * báo giá, nên một lượt xuất có thể kéo về tới 60 TRIỆU dòng và dựng tất cả thành đối tượng JS
 * cùng lúc, rồi `serializeExport` còn `JSON.stringify(..., 2)` (in thụt lề) toàn bộ thành MỘT
 * chuỗi giữ trọn trong bộ nhớ. Đây là đường OOM cuối cùng còn lại sau đợt vá tháng 9 — cùng hình
 * dạng với đường lưu và đường nhập Excel đã vá.
 *
 * ── VÌ SAO PHẢI NẠP THEO LÔ, KHÔNG PHẢI CẮT SAU KHI NẠP ──────────────────
 * Cắt sau khi `findMany` trả về là vô nghĩa: đỉnh bộ nhớ nằm ở CHÍNH LÚC NẠP. Cùng bài học đã trả
 * giá ở `src/excelImport.ts` — bản vá đầu cắt sau vòng quét và ĐO ĐƯỢC là không đủ (RSS 1.887 MB,
 * vẫn bị nhân giết).
 *
 * ── VÀ VÌ SAO KHÔNG TỪ CHỐI THẲNG ─────────────────────────────────────────
 * Đây là quyền truy cập dữ liệu cá nhân. Trả lỗi "dữ liệu của bạn quá lớn" là từ chối một quyền
 * — không được phép. Nên: vẫn trả đủ DANH SÁCH báo giá (id, số, tiêu đề, ngày, tổng tiền…), chỉ
 * phần DÒNG CHI TIẾT của những báo giá vượt trần là bỏ, kèm khối `gioiHan` nói rõ báo giá nào
 * thiếu chi tiết và lấy nốt ở đâu (`GET /api/quotes/:id`).
 */
async function napBaoGiaCoTran(userId: number, phamViBaoGia: any) {
  const TRAN_DONG = config.GDPR_EXPORT_MAX_ROWS;
  const MOI_LO = 25;

  const ids = (await prisma.quote.findMany({
    where: { AND: [{ createdById: userId }, phamViBaoGia] },
    select: { id: true },
    orderBy: { id: "asc" },
    take: 1000,
  })).map((q) => q.id);
  if (!ids.length) return { danhSach: [] as any[], gioiHan: null };

  // ── ĐẾM TRƯỚC, RỒI MỚI QUYẾT ĐỊNH NẠP GÌ ─────────────────────────────────
  // Bản đầu của hàm này chỉ xét ngân sách GIỮA CÁC LÔ, và bài kiểm bắt được ngay: 6 báo giá nằm
  // trọn trong lô đầu tiên nên không lô nào bị cắt, trần thành vô nghĩa. Tệ hơn, với lô 25 báo giá
  // × 60.000 dòng thì một lô có thể vượt trần 1,5 TRIỆU dòng trước khi ai đó kịp kiểm — đúng cái
  // trần này sinh ra để chặn.
  //
  // Một câu đếm rẻ (chỉ đụng chỉ mục `QuoteItem(sheetId, order)`) cho biết CHÍNH XÁC báo giá nào
  // vừa ngân sách, nên không có lượt nạp thừa nào, và không phải cắt-sau-khi-nạp.
  const dem = await prisma.$queryRaw<{ quoteId: number; soDong: bigint }[]>`
    SELECT s."quoteId" AS "quoteId", count(i.id) AS "soDong"
      FROM "QuoteSheet" s
      LEFT JOIN "QuoteItem" i ON i."sheetId" = s.id
     WHERE s."quoteId" = ANY(${ids})
     GROUP BY s."quoteId"`;
  const soDongCua = new Map<number, number>();
  for (const r of dem) soDongCua.set(Number(r.quoteId), Number(r.soDong));

  const dayDu = new Set<number>();
  const thieuChiTiet: number[] = [];
  let tongDong = 0;
  for (const id of ids) {
    const n = soDongCua.get(id) ?? 0;
    // `tongDong + n <= TRAN` chứ không phải `tongDong < TRAN`: vế sau cho một báo giá KHỔNG LỒ lọt
    // qua chỉ vì nó tình cờ là báo giá đầu tiên.
    if (tongDong + n <= TRAN_DONG) { dayDu.add(id); tongDong += n; }
    else thieuChiTiet.push(id);
  }

  const danhSach: any[] = [];
  for (let i = 0; i < ids.length; i += MOI_LO) {
    const lo = ids.slice(i, i + MOI_LO);
    const loDu = lo.filter((id) => dayDu.has(id));
    const loThieu = lo.filter((id) => !dayDu.has(id));

    if (loDu.length) {
      const qs = await prisma.quote.findMany({
        where: { id: { in: loDu } },
        orderBy: { id: "asc" },
        // `hnTables` (bảng Hà Nội cấp báo giá, từ 2026-09-15) cũng chứa `paidProof` → cắt cùng
        // cách: omit ở đây, rồi nạp lại bản đã cắt ảnh qua câu SQL dùng chung.
        omit: { customerLogo: true, hnTables: true },
        include: { sheets: { omit: { extraTables: true }, include: { items: { omit: { images: true } } } } },
      });
      const [bang, hn] = await Promise.all([bangNoiBoTheoSheet(loDu), bangHnTheoBaoGia(loDu)]);
      const theoSheet = new Map<number, any>();
      for (const r of bang) theoSheet.set(r.sheetId, r.tables);
      for (const q of qs) {
        danhSach.push({
          ...q,
          hnTables: hn.get(q.id) ?? [],
          sheets: (q.sheets || []).map((sh: any) => ({ ...sh, extraTables: theoSheet.get(sh.id) ?? [] })),
        });
      }
    }

    if (loThieu.length) {
      // Vẫn nạp METADATA đầy đủ (số, tiêu đề, ngày, tổng tiền…) — chỉ bỏ DÒNG chi tiết.
      const qs = await prisma.quote.findMany({
        where: { id: { in: loThieu } },
        orderBy: { id: "asc" },
        omit: { customerLogo: true, hnTables: true },
        include: { sheets: { omit: { extraTables: true } } },
      });
      for (const q of qs) {
        danhSach.push({
          ...q,
          hnTables: [],
          sheets: (q.sheets || []).map((sh: any) => ({ ...sh, items: [], extraTables: [] })),
        });
      }
    }
  }
  danhSach.sort((a, b) => a.id - b.id);

  const gioiHan = thieuChiTiet.length
    ? {
        lyDo: `Bản xuất đã chạm trần ${TRAN_DONG.toLocaleString("vi-VN")} dòng hạng mục (GDPR_EXPORT_MAX_ROWS).`,
        soDongDaXuat: tongDong,
        soBaoGiaThieuChiTiet: thieuChiTiet.length,
        baoGiaThieuChiTiet: thieuChiTiet,
        huongDan: "Danh sách báo giá vẫn ĐẦY ĐỦ; chỉ phần dòng hạng mục của các báo giá trên bị bỏ. Lấy nốt từng báo giá tại GET /api/quotes/:id.",
      }
    : null;

  return { danhSach, gioiHan };
}

/**
 * Xoá tài khoản của CHÍNH user (right-to-erasure) — phần LOGIC THUẦN: transaction vô danh hoá + audit.
 * Việc destroy session + clearCookie GIỮ ở route (controller HTTP) vì thao tác res/session.
 */
export async function deleteSelf(req: Request) {
  const id = (req.session as any).userId;
  await prisma.$transaction(anonymizeUserOps(id));
  await audit(req, "gdpr.delete.self", { resource: "user", resourceId: id, actorId: id });
}

/** Admin xoá tài khoản người dùng khác: chặn tự-xoá, 404 nếu không có, rồi transaction + audit. */
export async function deleteByAdmin(req: Request) {
  if ((req.params as any).id === req.session.userId) {
    throw httpError(400, "Không thể tự xóa chính mình ở đây. Vui lòng dùng chức năng \"Xóa tài khoản của tôi\".");
  }
  const target = await prisma.user.findUnique({ where: { id: (req.params as any).id }, select: { id: true } });
  if (!target) throw httpError(404, "Không tìm thấy người dùng");
  await prisma.$transaction(anonymizeUserOps((req.params as any).id));
  await audit(req, "gdpr.delete.by_admin", { resource: "user", resourceId: (req.params as any).id });
  return { ok: true };
}
