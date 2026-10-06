// CHIA SHEET THÀNH HÓA ĐƠN — đường ghi của trang Hóa đơn đầu ra (kế toán). Luật dùng chung: src/invoiceSplit.ts.
//
// PUT /api/quotes/:id/invoice-split  body { sheets: [{ sheetId, group: số | null, hold: "later" | "skip" | null }] }
//   · Phải liệt kê ĐÚNG và ĐỦ các sheet hiện có của báo giá (đọc TƯƠI sau khoá). Lệch → 409: sale vừa Lưu (lưu = xoá sheet
//     rồi tạo lại, id đổi) hay thêm/xoá sheet — kế toán tải lại rồi chia lại, không đoán.
//   · MỌI phần tử { group: null, hold: null } = BỎ CHIA (về "mỗi sheet một hóa đơn" như cũ).
//   · Còn lại mỗi sheet phải có group (1…99) HOẶC hold.
//   · HÓA ĐƠN ĐÃ XUẤT ĐỨNG YÊN: sheet đã có số HĐ hoặc đã thu tiền (sheetDaXuat) đang nằm trong một hóa đơn thì hóa đơn đó
//     phải giữ NGUYÊN tập sheet VÀ nguyên số thứ tự (mã _NN) — không gom thêm, không tách ra, không đổi số. Ngược lại là
//     đổi số tiền / mã của một hóa đơn đã gửi khách → 409.
//   · Hóa đơn MỚI gom nhiều sheet: hợp nhất trường hóa đơn từng cột (giá trị khác rỗng đầu tiên theo thứ tự sheet) rồi
//     ghi đồng loạt — PO / Hạng mục / CTy kế toán đã gõ trên một sheet không biến mất.
// Quyền: invoice:page vào (route) + invoice:edit (ở đây). Phạm vi GLOBAL như PUT /sheets/:sheetId/invoice: kế toán làm
// trên MỌI dự án đã chốt. Chỉ báo giá ĐÃ CHỐT, chưa xoá.
import type { Request } from "express";
import { prisma } from "../db.js";
import { audit } from "../audit.js";
import { httpError } from "../httpError.js";
import { emitChange } from "../sse.js";
import { can, PERMISSIONS as P } from "../permissions.js";
import {
  INVOICE_SHARED_FIELDS, daChiaHoaDon, khoaHoaDon, soHoaDon, sheetDaXuat, nhomTheoKhoa, type SplitSheet,
} from "../invoiceSplit.js";

type GanSheet = { sheetId: number; group: number | null; hold: "later" | "skip" | null };

const coGiaTri = (v: unknown) => v != null && String(v).trim() !== "";
const tapBang = (a: number[], b: number[]) => a.length === b.length && a.every((x) => b.includes(x));

export async function setInvoiceSplit(req: Request) {
  if (!can(req.session, P.INVOICE_EDIT)) throw httpError(403, "Bạn không có quyền chia hóa đơn");
  const quoteId = Number(req.params.id);
  const gan: GanSheet[] = Array.isArray(req.body?.sheets) ? req.body.sheets : [];
  const quote = await prisma.quote.findUnique({ where: { id: quoteId }, select: { id: true, status: true, deletedAt: true } });
  if (!quote || quote.deletedAt) throw httpError(404, "Không tìm thấy báo giá");
  if (quote.status !== "converted") throw httpError(403, "Chỉ chia hóa đơn cho dự án đã chốt");

  const boChia = gan.every((g) => g.group == null && g.hold == null);
  if (!boChia) {
    for (const g of gan) {
      if (g.group == null && g.hold == null) throw httpError(400, "Mỗi sheet phải thuộc một hóa đơn, hoặc Để sau / Không xuất");
      if (g.group != null && g.hold != null) throw httpError(400, "Sheet không thể vừa thuộc hóa đơn vừa Để sau / Không xuất");
    }
  }
  if (new Set(gan.map((g) => g.sheetId)).size !== gan.length) throw httpError(400, "Một sheet được liệt kê hai lần");

  const kq = await prisma.$transaction(async (tx) => {
    // Cùng thứ tự khoá với mọi đường ghi QuoteSheet (updateQuote, saveHn, customerDecision…): QuoteSheet ORDER BY id.
    await tx.$queryRaw`SELECT id FROM "QuoteSheet" WHERE "quoteId" = ${quoteId} ORDER BY id FOR UPDATE`;
    const tuoi = await tx.quoteSheet.findMany({ where: { quoteId }, orderBy: [{ order: "asc" }, { id: "asc" }] });
    const ids = tuoi.map((s) => s.id);
    if (!tapBang(ids, gan.map((g) => g.sheetId))) {
      throw httpError(409, "Báo giá vừa đổi sheet (có người lưu / thêm / xoá sheet) — tải lại trang rồi chia lại");
    }
    const theoId = new Map(gan.map((g) => [g.sheetId, g]));
    const cu: SplitSheet[] = tuoi as unknown as SplitSheet[];
    const moi: SplitSheet[] = tuoi.map((s) => {
      const g = theoId.get(s.id)!;
      return { ...(s as unknown as SplitSheet), invoiceGroup: boChia ? null : g.group, invoiceHold: boChia ? null : g.hold };
    });
    const chiaCu = daChiaHoaDon(cu), chiaMoi = daChiaHoaDon(moi);
    const nhomCu = nhomTheoKhoa(cu, chiaCu), nhomMoi = nhomTheoKhoa(moi, chiaMoi);

    // HÓA ĐƠN ĐÃ XUẤT ĐỨNG YÊN — tập sheet và số thứ tự (mã _NN) không đổi. Sheet khách KHÔNG duyệt chưa có số HĐ không
    // tính vào tập: nó không vào hóa đơn (trang Hóa đơn ẩn, updateSheetInvoice không chép số HĐ sang) nên đưa nó ra
    // Không xuất không đổi gì của hóa đơn đã xuất.
    const anTrongHoaDon = new Set(tuoi.filter((s) => s.custStatus === "rejected" && !sheetDaXuat(s as unknown as SplitSheet)).map((s) => s.id));
    const tapTinh = (ds: number[] | undefined) => (ds ?? []).filter((id) => !anTrongHoaDon.has(id));
    for (let i = 0; i < tuoi.length; i++) {
      const s = cu[i];
      if (!sheetDaXuat(s)) continue;
      const kCu = khoaHoaDon(s, chiaCu);
      if (kCu === "later" || kCu === "skip") continue;   // dữ liệu lạ (số HĐ trên sheet Để sau) — không có hóa đơn nào để giữ
      const kMoi = khoaHoaDon(moi[i], chiaMoi);
      const giuTap = tapBang(tapTinh(nhomCu.get(kCu)), tapTinh(nhomMoi.get(kMoi)));
      const giuSo = soHoaDon(s, chiaCu, i) === soHoaDon(moi[i], chiaMoi, i);
      if (!giuTap || !giuSo) {
        throw httpError(409, `Sheet "${tuoi[i].name || `Sheet ${i + 1}`}" nằm trong hóa đơn ĐÃ XUẤT (có số HĐ / đã thu) — không gom thêm, tách ra hay đổi số hóa đơn đó được`);
      }
    }

    // Ghi phép chia.
    for (let i = 0; i < tuoi.length; i++) {
      if ((tuoi[i] as any).invoiceGroup === moi[i].invoiceGroup && (tuoi[i] as any).invoiceHold === moi[i].invoiceHold) continue;
      await tx.quoteSheet.update({ where: { id: tuoi[i].id }, data: { invoiceGroup: moi[i].invoiceGroup ?? null, invoiceHold: moi[i].invoiceHold ?? null } });
    }
    // Hóa đơn gom nhiều sheet: hợp nhất trường hóa đơn từng cột rồi ghi đồng loạt.
    for (const [k, ds] of nhomMoi) {
      if (!k.startsWith("g:") || ds.length < 2) continue;
      const thanh = ds.filter((id) => !anTrongHoaDon.has(id)).map((id) => tuoi.find((s) => s.id === id)! as any);
      if (thanh.length < 2) continue;
      const hop: Record<string, unknown> = {};
      for (const f of INVOICE_SHARED_FIELDS) {
        const v = thanh.map((s) => s[f]).find(coGiaTri);
        hop[f] = v ?? null;
      }
      const lech = thanh.some((s) => INVOICE_SHARED_FIELDS.some((f) => String(s[f] ?? "") !== String(hop[f] ?? "")));
      if (lech) await tx.quoteSheet.updateMany({ where: { id: { in: thanh.map((s) => s.id) } }, data: hop as any });
    }
    const truoc = tuoi.map((s: any) => ({ sheetId: s.id, group: s.invoiceGroup ?? null, hold: s.invoiceHold ?? null }));
    const sau = moi.map((s) => ({ sheetId: s.id, group: s.invoiceGroup ?? null, hold: s.invoiceHold ?? null }));
    return { truoc, sau };
  });

  // QuoteSheet không nằm trong RT_ENTITY (src/db.ts) → phát tay MỘT lần sau commit để trang Hóa đơn / Dự án đang mở tải lại.
  emitChange("quote", "update", quoteId);
  await audit(req, "quote.invoice.split", { resource: "quote", resourceId: quoteId, before: { sheets: kq.truoc }, after: { sheets: kq.sau } });
  return { sheets: kq.sau };
}
