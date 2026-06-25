// Tầng SERVICE cho domain Nhân sự (hồ sơ nhân công theo dự án). Bê NGUYÊN logic từ
// personnel.routes.ts (giữ hành vi y hệt): phân quyền theo phạm vi (canScoped/READ_ALL),
// 🔵 tính thuế (computeTax) + 🩷 tra cứu Dự án (buildProjectRef) lúc đọc, audit. Route chỉ còn:
// validate → gọi service → res. Mẫu chuẩn theo customerService.ts / quoteService.ts.
import type { Request } from "express";
import { prisma } from "../db.js";
import { audit } from "../audit.js";
import { can, canScoped, PERMISSIONS as P } from "../permissions.js";
import { buildProjectRef, computeTax, codeLabel, type ProjectRef } from "./projectRef.js";
import { httpError } from "../quoteService.js";

type Action = "read" | "manage";

// Tải bản ghi + 403 nếu caller không được làm `action` (read|manage) với nó (owner = createdById).
async function loadAuthorized(req: Request, action: Action) {
  const rec = await prisma.personnelRecord.findFirst({ where: { id: (req.params as any).id } });
  if (!rec) throw httpError(404, "Không tìm thấy hồ sơ nhân sự");
  if (!canScoped(req.session, "personnel", action, rec, "createdById")) {
    throw httpError(403, "Bạn không có quyền với hồ sơ này");
  }
  return rec;
}

const ownerSelect = { createdBy: { select: { id: true, displayName: true, username: true } } };

// 🔵 Gắn field công thức (pit, taxableIncome) + 🩷 field tham chiếu Dự án vào bản ghi khi TRẢ VỀ.
// Các field này KHÔNG lưu DB — luôn tính/tra lúc đọc nên không bao giờ lệch với Lương/Dự án.
function decorate<T extends { salary: unknown; projectCode: string | null; paidAt?: Date | null; confirmedAt?: Date | null }>(rec: T, refMap: Map<string, ProjectRef>) {
  const { pit, taxableIncome } = computeTax(rec.salary == null ? null : Number(rec.salary));
  const ref = refMap.get((rec.projectCode ?? "").toString().trim());
  return {
    ...rec,
    pit, taxableIncome,
    projectNameContract: ref?.projectNameContract ?? null,
    salesContractNo: ref?.salesContractNo ?? null,
    salesContractDate: ref?.salesContractDate ?? null,
    purchaseOrder: ref?.purchaseOrder ?? null,
    preTaxAmount: ref?.preTaxAmount ?? null,
    // THANH TOÁN: KẾ TOÁN bấm (rec.paidAt). XÁC NHẬN: ADMIN bấm (rec.confirmedAt → "Đã ký").
    // paidAt/confirmedAt đi kèm (qua ...rec) để FE hiện ngày.
    payment: rec.paidAt ? "Đã thanh toán" : "Chưa thanh toán",
    confirmed: rec.confirmedAt ? "Đã ký" : null,
  };
}

export async function listPersonnel(req: Request) {
  const { q, page, size, sort, order } = req.query as any;
  const where: Record<string, any> = {};
  // Phân quyền dữ liệu: ai KHÔNG có read:all (manager) chỉ thấy hồ sơ MÌNH tạo.
  if (!can(req.session, P.PERSONNEL_READ_ALL)) where.createdById = req.session.userId;
  if (q) {
    where.OR = [
      { fullName: { contains: q, mode: "insensitive" } },
      { projectName: { contains: q, mode: "insensitive" } },
      { projectCode: { contains: q, mode: "insensitive" } },
      { taxCode: { contains: q } },
      { phone: { contains: q } },
      { idCard: { contains: q } },
    ];
  }
  const [total, data, agg] = await Promise.all([
    prisma.personnelRecord.count({ where }),
    prisma.personnelRecord.findMany({
      where, orderBy: { [sort]: order }, skip: (page - 1) * size, take: size, include: ownerSelect,
    }),
    prisma.personnelRecord.aggregate({ where, _sum: { salary: true } }),
  ]);
  // 🩷 Tra cứu dữ liệu Dự án theo mã sản xuất — CHỈ cho các dòng đang hiển thị (truy vấn hẹp).
  const refMap = await buildProjectRef(data.map((r) => r.projectCode));
  const decorated = data.map((r) => decorate(r, refMap));
  // Tổng (toàn bộ lọc): Thuế TNCN = ΣLương/9, Thu nhập chịu thuế = ΣLương×10/9 (công thức đã chốt).
  const salarySum = Number(agg._sum.salary ?? 0);
  const tax = computeTax(salarySum);
  const summary = { salary: salarySum, pit: tax.pit ?? 0, taxableIncome: tax.taxableIncome ?? 0 };
  return { data: decorated, meta: { total, page, size, pageCount: Math.ceil(total / size) }, summary };
}

// Danh sách DỰ ÁN (báo giá ĐÃ CHỐT) để CHỌN khi tạo hồ sơ — tự điền Tên dự án / Mã dự án /
// Account / CTY / Tên dự án (HĐ). Account chỉ thấy dự án của CHÍNH MÌNH (createdById); admin/
// người có read:all thấy hết. Mỗi "mã sản xuất" (mỗi sheet, hậu tố _1/_2…) là 1 dòng chọn.
export async function listProjects(req: Request) {
  const { q } = req.query as any;
  const where: Record<string, any> = { status: "converted", deletedAt: null };
  if (!can(req.session, P.PERSONNEL_READ_ALL)) where.createdById = req.session.userId;   // Account: chỉ dự án của mình
  if (q) where.OR = [
    { title: { contains: q, mode: "insensitive" } },
    { projectCode: { contains: q, mode: "insensitive" } },
    { quoteNumber: { contains: q, mode: "insensitive" } },
  ];
  const quotes = await prisma.quote.findMany({
    where, take: 300, orderBy: { createdAt: "desc" },
    select: {
      quoteNumber: true, projectCode: true, projectVersion: true, title: true,
      company: { select: { name: true } },
      createdBy: { select: { displayName: true } },
      sheets: { orderBy: { order: "asc" }, select: { id: true, name: true } },
    },
  });
  const data: Array<Record<string, string>> = [];
  for (const qt of quotes) {
    const base = codeLabel(qt);
    const sheets = qt.sheets.length ? qt.sheets : [{ id: -1, name: "" } as any];
    const multi = sheets.length > 1;
    sheets.forEach((sh: any, i: number) => {
      data.push({
        projectCode: base + (multi ? `_${i + 1}` : ""),   // = mã sản xuất (khớp tra cứu cột HĐ)
        projectName: qt.title || "",                       // Tên dự án
        projectNameContract: qt.title || "",               // Tên dự án (HĐ)
        accountName: qt.createdBy?.displayName || "",       // Account (người tạo báo giá)
        company: qt.company?.name || "",                   // CTY
        sheetName: sh.name || "",                           // Hạng Mục (gợi ý khi nhiều sheet)
      });
    });
  }
  return { data };
}

export async function createPersonnel(req: Request) {
  const rec = await prisma.personnelRecord.create({
    data: { ...req.body, createdById: req.session.userId },   // người tạo = chủ sở hữu
    include: ownerSelect,
  });
  await audit(req, "personnel.create", { resource: "personnel", resourceId: rec.id });
  const refMap = await buildProjectRef([rec.projectCode]);
  return decorate(rec, refMap);
}

export async function getPersonnel(req: Request) {
  await loadAuthorized(req, "read");
  const full = await prisma.personnelRecord.findFirst({ where: { id: (req.params as any).id }, include: ownerSelect });
  if (!full) throw httpError(404, "Không tìm thấy hồ sơ nhân sự");
  const refMap = await buildProjectRef([full.projectCode]);
  return decorate(full, refMap);
}

export async function updatePersonnel(req: Request) {
  await loadAuthorized(req, "manage");   // hr/accountant không có manage → 403
  const rec = await prisma.personnelRecord.update({ where: { id: (req.params as any).id }, data: req.body, include: ownerSelect });
  await audit(req, "personnel.update", { resource: "personnel", resourceId: rec.id });
  const refMap = await buildProjectRef([rec.projectCode]);
  return decorate(rec, refMap);
}

export async function deletePersonnel(req: Request) {
  await loadAuthorized(req, "manage");
  await prisma.personnelRecord.delete({ where: { id: (req.params as any).id } });   // soft delete (db.js middleware)
  await audit(req, "personnel.delete", { resource: "personnel", resourceId: (req.params as any).id });
  return { ok: true };
}

// KẾ TOÁN (hoặc admin) đánh dấu ĐÃ / BỎ thanh toán cho 1 hồ sơ — lưu NGÀY + người đánh dấu.
export async function markPayment(req: Request) {
  const id = (req.params as any).id;
  const exists = await prisma.personnelRecord.findFirst({ where: { id }, select: { id: true } });
  if (!exists) throw httpError(404, "Không tìm thấy hồ sơ nhân sự");
  const paid = (req.body as any).paid as boolean;
  const rec = await prisma.personnelRecord.update({
    where: { id },
    data: paid ? { paidAt: new Date(), paidById: req.session.userId } : { paidAt: null, paidById: null },
    include: { ...ownerSelect, paidBy: { select: { id: true, displayName: true } } },
  });
  await audit(req, paid ? "personnel.pay" : "personnel.unpay", { resource: "personnel", resourceId: id });
  const refMap = await buildProjectRef([rec.projectCode]);
  return decorate(rec, refMap);
}

// ADMIN xác nhận "đã ký" / BỎ xác nhận cho 1 hồ sơ — lưu NGÀY + người.
export async function markConfirm(req: Request) {
  const id = (req.params as any).id;
  const exists = await prisma.personnelRecord.findFirst({ where: { id }, select: { id: true } });
  if (!exists) throw httpError(404, "Không tìm thấy hồ sơ nhân sự");
  const confirmed = (req.body as any).confirmed as boolean;
  const rec = await prisma.personnelRecord.update({
    where: { id },
    data: confirmed ? { confirmedAt: new Date(), confirmedById: req.session.userId } : { confirmedAt: null, confirmedById: null },
    include: { ...ownerSelect, confirmedBy: { select: { id: true, displayName: true } } },
  });
  await audit(req, confirmed ? "personnel.confirm" : "personnel.unconfirm", { resource: "personnel", resourceId: id });
  const refMap = await buildProjectRef([rec.projectCode]);
  return decorate(rec, refMap);
}
