// Tầng SERVICE cho domain Analytics (KPI báo giá). Bê NGUYÊN logic từ analytics.routes.ts ra đây:
// phạm vi quyền (quoteScopeWhere / QUOTE_READ_ALL), groupBy/aggregate/$queryRaw, gom map kết quả.
// Route chỉ còn: requirePermission (ở router) + validate → gọi service → res.json. Mẫu theo quoteService.ts.
import type { Request } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { can, quoteScopeWhereOrThrow, PERMISSIONS as P } from "../permissions.js";

function defaultRange(q: { from?: Date; to?: Date }) {
  const to = q.to || new Date();
  const from = q.from || new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  return { from, to };
}

/**
 * 🔒 Deny-by-default cho các biểu đồ chỉ có 2 mức "toàn công ty / của mình":
 * true  = xem số liệu MỌI báo giá (quote:read:all)
 * false = chỉ báo giá do mình tạo — VẪN đòi quote:read:own, không thì 403.
 * Router đã gác quote:create nhưng "tạo được" KHÔNG suy ra "đọc được": ma trận phân quyền cho phép
 * tick create mà bỏ read, khi đó doanh số/tổng tiền vẫn lọt qua các endpoint này.
 */
function seesAllQuotes(session: { userId?: number; role?: string; permissions?: string[] }): boolean {
  if (can(session, P.QUOTE_READ_ALL)) return true;
  if (!can(session, P.QUOTE_READ_OWN)) throw Object.assign(new Error("Bạn không có quyền xem số liệu báo giá"), { status: 403 });
  return false;
}

/**
 * Overview KPIs: total amount of approved+sent+converted, count by status,
 * conversion rate, average deal size, expiring soon, top performers.
 */
export async function overview(req: Request) {
  const { from, to } = defaultRange(req.query);
  const scope = quoteScopeWhereOrThrow(req.session); // read:all=mọi báo giá, read:own=tự tạo/thành viên, không quyền=403

  const where = { createdAt: { gte: from, lte: to }, ...scope };

  const [byStatus, chotMoi, chotCu] = await Promise.all([
    prisma.quote.groupBy({
      by: ["status"],
      where,
      _count: { _all: true },
      _sum: { total: true },
    }),
    // ── DOANH THU ĐÃ CHỐT = COALESCE("convertedTotal", "total") ───────────────
    // Đây là luật do chính migration 20260917030000 đặt ra ("Mọi nơi đọc phải dùng COALESCE").
    // `Quote.total` là tổng của bản báo giá NHƯ ĐÃ GỬI KHÁCH và cố ý giữ nguyên nghĩa (file
    // Excel/PDF, lịch sử phiên bản, bản xuất GDPR đều đọc nó). Số tiền THẬT SỰ chốt — đã trừ
    // những trang khách bấm "Không duyệt" — nằm ở `convertedTotal`. Cộng `total` ở đây là báo
    // doanh thu CAO HƠN mức khách đồng ý, đúng lỗi mà cột kia sinh ra để chặn.
    //
    // VÌ SAO HAI PHÉP GỘP CHỨ KHÔNG PHẢI MỘT CÂU SQL THÔ: `where` chứa `scope` do
    // `quoteScopeWhereOrThrow` sinh ra (read:all / read:own / thành viên). Viết lại thành SQL
    // thô là cài lại logic PHÂN QUYỀN lần thứ hai, và hai bản sẽ trôi khỏi nhau — một lỗ lộ số
    // liệu, không chỉ là lệch số. Prisma `aggregate` không diễn đạt được COALESCE, nên tách
    // đúng hai vế rời nhau rồi cộng lại: kết quả y hệt COALESCE mà `where` chỉ có MỘT nguồn.
    //
    // convertedTotal NULL nghĩa là: chốt TRƯỚC 2026-09-17 (chưa có cột) → rơi về `total`, đúng
    // con số hệ thống vẫn báo cho tới nay nên số liệu lịch sử KHÔNG đổi.
    prisma.quote.aggregate({
      where: { ...where, status: "converted", convertedTotal: { not: null } },
      _sum: { convertedTotal: true },
      _count: { _all: true },
    }),
    prisma.quote.aggregate({
      where: { ...where, status: "converted", convertedTotal: null },
      _sum: { total: true },
      _count: { _all: true },
    }),
  ]);

  const doanhThuChot = Number(chotMoi._sum.convertedTotal ?? 0) + Number(chotCu._sum.total ?? 0);
  const soDaChot = chotMoi._count._all + chotCu._count._all;

  const counts = Object.fromEntries(byStatus.map((b) => [b.status, b._count._all]));
  const sums = Object.fromEntries(byStatus.map((b) => [b.status, Number(b._sum.total ?? 0)]));
  // Phễu (web/src/pages/Dashboard.tsx:163 đọc `ov.sums[status]`) phải nói CÙNG một con số với ô
  // "Doanh số đã chốt" ngay bên cạnh. Bậc `converted` của phễu lấy từ `byStatus`, tức `total` —
  // thay bằng số đã trừ. CHỈ ghi đè khi khoá đã có: gán vô điều kiện sẽ đẻ ra bậc "converted: 0"
  // cho kỳ không có báo giá nào chốt, và phễu vẽ thêm một hàng rỗng chưa từng có.
  if ("converted" in sums) sums.converted = doanhThuChot;
  const totalQuotes = byStatus.reduce((s, b) => s + b._count._all, 0);
  const converted = counts.converted || 0;
  const conversionRate = totalQuotes > 0 ? Number(((converted / totalQuotes) * 100).toFixed(2)) : 0;

  return {
    period: { from, to },
    counts,
    sums,
    kpi: {
      totalQuotes,
      approvedAmount: doanhThuChot,
      // Tự chia thay vì `_avg`: trung bình phải là trung bình của CHÍNH con số đang báo ở trên.
      // Dùng `_avg` của một trong hai vế sẽ ra trung bình của nửa tập, còn cộng hai `_avg` lại là
      // sai hẳn về toán (trung bình của tổng ≠ tổng các trung bình khi hai nhóm khác cỡ).
      avgDealSize: soDaChot > 0 ? doanhThuChot / soDaChot : 0,
      conversionRate,
    },
  };
}

/** Doanh số ĐÃ CHỐT (converted) theo ngày — cho biểu đồ Tổng quan. Chỉ tính status='converted'
 *  để KHỚP với KPI "Doanh số đã chốt" của overview (approvedAmount = aggregate converted). Trước đây
 *  cộng cả approved/sent (enum cũ đã chết theo luồng rút gọn 2026-06-22) → lệch số với KPI. */
export async function revenueByDay(req: Request) {
  const { from, to } = defaultRange(req.query);
  const allScope = seesAllQuotes(req.session);
  // CÙNG PHẠM VI VỚI overview() (DB-05, audit 2026-09-23): quoteScopeWhere cho người chỉ có
  // read:own gồm báo giá mình TẠO và báo giá mình là THÀNH VIÊN. Bản trước ở đây chỉ lấy
  // `createdById`, nên tổng các cột biểu đồ không cộng khớp ô "Doanh số đã chốt" ngay bên cạnh.
  // Viết lại đúng hai vế của quoteScopeWhere; Prisma.sql giữ giá trị ở dạng tham số.
  const uid = req.session.userId;
  const scope = allScope
    ? Prisma.empty
    : Prisma.sql`AND ("createdById" = ${uid} OR EXISTS (SELECT 1 FROM "QuoteMember" m WHERE m."quoteId" = "Quote".id AND m."userId" = ${uid}))`;

  // GOM THEO NGÀY GIỜ VIỆT NAM, không phải ngày UTC (DB-05). Cột TIMESTAMP(3) lưu giờ UTC không kèm
  // múi, nên phải gắn UTC rồi mới đổi sang Asia/Ho_Chi_Minh — báo giá tạo 00:00–06:59 giờ VN từng
  // rơi sang ngày hôm trước trên biểu đồ.
  const rows = await prisma.$queryRaw`
      -- COALESCE("convertedTotal","total"): số tiền THẬT SỰ chốt, đã trừ trang khách không duyệt.
      -- NULL = chốt trước 2026-09-17 (chưa có cột) → rơi về "total". Xem khối chú thích ở overview().
      SELECT DATE(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Ho_Chi_Minh') AS d, COALESCE(SUM(COALESCE("convertedTotal", "total")), 0)::float AS amount, COUNT(*)::int AS n
      FROM "Quote"
      WHERE "createdAt" >= ${from} AND "createdAt" <= ${to}
        AND "status" = 'converted'
        AND "deletedAt" IS NULL ${scope}
      GROUP BY 1
      ORDER BY 1 ASC`;
  return { data: rows };
}

/** Top sales by approved amount. */
export async function topSales(req: Request) {
  const { from, to, limit } = { ...defaultRange(req.query), limit: (req.query as any).limit };
  // Only admin sees the company-wide leaderboard; others see just their own row.
  const taScope = seesAllQuotes(req.session) ? {} : { createdById: req.session.userId };
  // Cùng luật COALESCE("convertedTotal","total") như overview() — xem khối chú thích ở đó. Xếp
  // hạng theo `total` sẽ cho người bán một báo giá lớn mà khách gạt quá nửa đứng trên người bán
  // một báo giá nhỏ hơn nhưng khách lấy hết.
  const chung = { ...taScope, createdAt: { gte: from, lte: to }, status: "converted" as const };
  const [gMoi, gCu] = await Promise.all([
    prisma.quote.groupBy({
      by: ["createdById"],
      where: { ...chung, convertedTotal: { not: null } },
      _sum: { convertedTotal: true },
      _count: { _all: true },
    }),
    prisma.quote.groupBy({
      by: ["createdById"],
      where: { ...chung, convertedTotal: null },
      _sum: { total: true },
      _count: { _all: true },
    }),
  ]);
  // Gộp hai vế rồi mới xếp hạng. XẾP HẠNG PHẢI LÀM SAU KHI CỘNG: một người có cả báo giá chốt
  // trước và sau 2026-09-17 sẽ nằm ở CẢ HAI nhóm, nên cắt `take` ở từng nhóm rồi mới cộng có thể
  // đánh rơi đúng người đứng đầu.
  const gom = new Map<number, { amount: number; count: number }>();
  const cong = (id: number, tien: number, dem: number) => {
    const g = gom.get(id) ?? { amount: 0, count: 0 };
    g.amount += tien;
    g.count += dem;
    gom.set(id, g);
  };
  for (const r of gMoi) cong(r.createdById, Number(r._sum.convertedTotal ?? 0), r._count._all);
  for (const r of gCu) cong(r.createdById, Number(r._sum.total ?? 0), r._count._all);

  const xep = [...gom.entries()].sort((a, b) => b[1].amount - a[1].amount);
  // `limit` có thể undefined (route không bắt buộc) — `slice(0, undefined)` trả về cả mảng, đúng
  // hành vi cũ của `take: undefined`.
  const rows = (typeof limit === "number" && limit > 0 ? xep.slice(0, limit) : xep).map(([createdById, g]) => ({
    createdById,
    amount: g.amount,
    count: g.count,
  }));
  const userIds = rows.map((r) => r.createdById);
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, username: true, displayName: true },
  });
  const uMap = Object.fromEntries(users.map((u) => [u.id, u]));
  return {
    data: rows.map((r) => ({
      userId: r.createdById,
      user: uMap[r.createdById] || null,
      amount: r.amount,
      count: r.count,
    })),
  };
}

/** Funnel: count of quotes at each status. */
export async function funnel(req: Request) {
  const scope = quoteScopeWhereOrThrow(req.session); // read:all / read:own / 403
  const rows = await prisma.quote.groupBy({
    by: ["status"],
    where: scope,
    _count: { _all: true },
  });
  const order = ["draft", "pending", "approved", "sent", "converted", "rejected", "lost"];
  const map = Object.fromEntries(rows.map((r) => [r.status, r._count._all]));
  return { data: order.map((s) => ({ status: s, count: map[s] || 0 })) };
}
