// DỊCH VỤ KẾ TOÁN của trang Hóa đơn đầu vào (chủ repo 2026-10-06): kế toán tích "ĐÃ CHI" + ảnh chứng từ
// (`invoice:input:pay`), ghi Ngày hóa đơn + Ghi chú kế toán (`invoice:edit`) cho từng hàng bảng nội bộ đã duyệt —
// ngay trên trang Hóa đơn đầu vào, KHÔNG qua màn soạn báo giá (kế toán không có quote:read:*, không mở được báo giá).
//
// Dữ liệu ở bảng RIÊNG `InputInvoiceEntry` (khoản) + `InputInvoiceProof` (ảnh, CHỈ THÊM). Luật thuần ở src/khoanChi.ts.
//
// ── BẤT BIẾN ─────────────────────────────────────────────────────────────────────────────────────────────
//   KT-1  CHỈ tệp này (và công cụ chuyển dữ liệu src/khoanChiBackfill.ts) GHI hai bảng. Đường Lưu báo giá, nhân bản,
//         luồng Hà Nội, GDPR, bản chụp phiên bản chỉ ĐỌC.
//   KT-5  Thứ tự khoá: ở đây Quote FOR SHARE → đọc hàng → khoản FOR UPDATE; KHÔNG BAO GIỜ xin khoá QuoteSheet. Đường Lưu
//         khoá QuoteSheet (nếu có) → Quote FOR UPDATE → rồi mới đọc khoản. Hai chiều không bao giờ ngược nhau.
//   KT-7  Ảnh không bao giờ bị xoá: thay / gỡ / bỏ tích chỉ đặt `retiredAt`. Không có lệnh DELETE nào lên hai bảng.
//   KT-8  Ghi kế toán KHÔNG đụng `Quote`/`QuoteSheet`: không bump `Quote.updatedAt` (mốc khoá lạc quan của màn soạn —
//         tích một ô không được đá văng người đang soạn), không sinh QuoteVersion. Mỗi lần ghi tăng `version` của
//         RIÊNG khoản đó và có nhật ký before/after (không chép ảnh).
import type { Request } from "express";
import { Prisma } from "@prisma/client";
import { prisma, type TxClient } from "../db.js";
import { can, PERMISSIONS as P } from "../permissions.js";
import { httpError } from "../httpError.js";
import { audit } from "../audit.js";
import { emitChange } from "../sse.js";
import { decodeDataUrl, sniffImage, sha256, MAX_PROOF_BYTES } from "../paymentProof.js";
import { PAYMENT_PROOF_DATA_URL_RE } from "../validators.js";
import { bangNoiBoTheoSheet, bangHnTheoBaoGia } from "../bangNoiBoSql.js";
import { dsMauBangNoiBo, bangNoiBoCoNgay, type MauBangNoiBo } from "../quoteUtils.js";
import {
  khoaKhoanChi,
  hangCuaPhia,
  chupHang,
  phuKeToan,
  hatGiongJson,
  coDauVetJsonCu,
  tenHangDaChi,
  ngayTuChuoi,
  ngayRaChuoi,
  dtoKhoanChi,
  loiCoMa,
  type PhiaKhoanChi,
  type KhoanChiNap,
  type AnhChungTuNap,
  type KhoanChiDto,
  type LyDoRutAnh,
} from "../khoanChi.js";

/** Trần số ảnh MỘT khoản giữ được (kể cả ảnh đã rút) — ảnh chỉ thêm, nên phải có trần. */
export const TRAN_ANH_MOI_KHOAN = 20;

const CHON_KHOAN = {
  id: true, quoteId: true, side: true, rid: true,
  paid: true, paidAt: true, paidById: true, paidByName: true, paidSnapshot: true,
  currentProofId: true, invoiceDate: true, accountingNote: true,
  rowSnapshot: true, legacySeed: true, source: true, version: true,
  updatedAt: true, updatedByName: true,
} satisfies Prisma.InputInvoiceEntrySelect;

const CHON_ANH = {
  id: true, entryId: true, uploadedAt: true, uploadedByName: true, retiredAt: true, retiredReason: true, source: true,
} satisfies Prisma.InputInvoiceProofSelect;

type DocKhoan = Pick<TxClient, "inputInvoiceEntry">;

/** Mọi khoản của MỘT báo giá → Map khoá `${side}:${rid}`. Gọi TRONG transaction của đường Lưu, sau khi đã khoá Quote. */
export async function docKhoanChiTrongTx(db: DocKhoan, quoteId: number): Promise<Map<string, KhoanChiNap>> {
  const ds = await db.inputInvoiceEntry.findMany({ where: { quoteId }, select: CHON_KHOAN });
  return new Map(ds.map((e) => [khoaKhoanChi(e.side, e.rid), e as KhoanChiNap]));
}

/** Khoản của nhiều báo giá: quoteId → (khoá → khoản). Một câu, đi chỉ mục unique (tiền tố quoteId). */
export async function docKhoanChiTheoBaoGia(ids: number[], db: DocKhoan = prisma): Promise<Map<number, Map<string, KhoanChiNap>>> {
  const out = new Map<number, Map<string, KhoanChiNap>>();
  if (!ids.length) return out;
  const ds = await db.inputInvoiceEntry.findMany({ where: { quoteId: { in: ids } }, select: CHON_KHOAN });
  for (const e of ds) {
    let m = out.get(e.quoteId);
    if (!m) out.set(e.quoteId, (m = new Map()));
    m.set(khoaKhoanChi(e.side, e.rid), e as KhoanChiNap);
  }
  return out;
}

/** Siêu dữ liệu ảnh (KHÔNG có `dataUrl`) của các khoản: entryId → ảnh. */
export async function docAnhTheoKhoan(entryIds: number[]): Promise<Map<number, AnhChungTuNap[]>> {
  const out = new Map<number, AnhChungTuNap[]>();
  if (!entryIds.length) return out;
  const ds = await prisma.inputInvoiceProof.findMany({ where: { entryId: { in: entryIds } }, select: CHON_ANH, orderBy: { id: "asc" } });
  for (const a of ds) (out.get(a.entryId) ?? out.set(a.entryId, []).get(a.entryId)!).push(a);
  return out;
}

/**
 * LỚP PHỦ cho phản hồi báo giá đầy đủ / nội bộ / account Hà Nội (src/quoteUtils.ts presentQuote): đè trạng thái HIỆU
 * LỰC (KT-3) lên các hàng có khoản. Không có khoản nào thì không đổi gì — và không tốn thêm câu nào ngoài một lần đọc.
 */
export async function phuKeToanBanTrinhBay<T>(quoteId: number, out: T): Promise<T> {
  const khoan = await docKhoanChiTrongTx(prisma, quoteId);
  return phuKeToan(out, khoan);
}

/**
 * Tên các hàng ĐANG hiệu lực đã chi của MỘT báo giá, cả hai phía (KT-3) — kể cả khoản đã chi mà hàng không còn trong
 * JSON. Gọi TRONG transaction đang giữ Quote FOR UPDATE (chốt xoá mềm báo giá, KT-4). Đọc JSON đã cắt ảnh.
 */
export async function khoanDaChiCuaBaoGia(tx: TxClient, quoteId: number): Promise<string[]> {
  const khoan = await docKhoanChiTrongTx(tx, quoteId);
  const sheet = await bangCuaPhia(tx, quoteId, "sheet");
  const hn = await bangCuaPhia(tx, quoteId, "hn");
  return [...tenHangDaChi("sheet", sheet, khoan), ...tenHangDaChi("hn", hn, khoan)];
}

/** Lớp phủ cho hàng THÔ của danh sách báo giá (nhánh bảng nội bộ của listQuotes) — để "Đã TT x/y" đếm theo khoản. */
export async function phuKeToanDanhSach(rows: { id: number }[]): Promise<void> {
  const theoBaoGia = await docKhoanChiTheoBaoGia(rows.map((r) => r.id));
  if (!theoBaoGia.size) return;
  for (const r of rows) {
    const k = theoBaoGia.get(r.id);
    if (k) phuKeToan(r, k);
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
//  GHI MỘT KHOẢN — PUT /api/quotes/input-invoices/:quoteId/:side/:rid
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────

type ThanKhoanChi = {
  baseVersion: number;
  paid?: boolean;
  paidProof?: string | null;
  invoiceDate?: string | null;
  accountingNote?: string | null;
};

type AnhMoi = { dataUrl: string; mime: string; size: number; sha256: string };

/** Ảnh mới: giải base64 + soát magic bytes TRƯỚC transaction (không giữ khoá trong lúc làm việc CPU). */
function kiemAnhMoi(dataUrl: string): AnhMoi {
  const buf = decodeDataUrl(dataUrl);
  if (!buf) throw loiCoMa(415, "khong-phai-anh", "Ảnh chứng từ không hợp lệ");
  if (buf.length > MAX_PROOF_BYTES) throw loiCoMa(413, "anh-qua-lon", "Ảnh chứng từ quá lớn — hãy chụp lại nhỏ hơn");
  const kind = sniffImage(buf);
  if (!kind) throw loiCoMa(415, "khong-phai-anh", "Nội dung không phải ảnh PNG/JPG/WEBP");
  // Nhãn trong chuỗi client gửi không được tin: nhãn khớp kiểu THẬT (magic bytes) thì giữ nguyên chuỗi (đã qua regex
  // toàn chuỗi ở zod); lệch thì dựng lại data-URL từ BYTE + kiểu đã soát.
  const nhan = /^data:(image\/[a-z]+);/i.exec(dataUrl.trim())?.[1]?.toLowerCase().replace("image/jpg", "image/jpeg");
  const luu = nhan === kind.mime ? dataUrl.trim() : `data:${kind.mime};base64,${buf.toString("base64")}`;
  return { dataUrl: luu, mime: kind.mime, size: buf.length, sha256: sha256(buf) };
}

/** Ảnh trong JSON cũ của hàng → dòng InputInvoiceProof `json-cu`. Không qua được regex ảnh thì bỏ (vốn không xem được). */
export function anhTuJsonCu(dataUrl: unknown): AnhMoi | null {
  if (typeof dataUrl !== "string" || !PAYMENT_PROOF_DATA_URL_RE.test(dataUrl)) return null;
  const buf = decodeDataUrl(dataUrl);
  if (!buf) return null;
  const nhan = /^data:(image\/[a-z]+);/i.exec(dataUrl)?.[1]?.toLowerCase() ?? "image/png";
  return { dataUrl, mime: sniffImage(buf)?.mime ?? nhan, size: buf.length, sha256: sha256(buf) };
}

export type DongBang = { t: Record<string, any>; it: Record<string, any>; ten: string };

/** Bảng của MỘT phía của một báo giá, đã cắt ảnh (còn cờ `hasPaidProof`), đọc bằng client `db` (thường là tx). */
export async function bangCuaPhia(db: Pick<TxClient, "$queryRaw">, quoteId: number, side: PhiaKhoanChi): Promise<unknown[]> {
  if (side === "hn") return (await bangHnTheoBaoGia([quoteId], db)).get(quoteId) ?? [];
  const rows = await bangNoiBoTheoSheet([quoteId], db);
  rows.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.sheetId - b.sheetId);
  return rows.flatMap((r) => (Array.isArray(r.tables) ? r.tables : []));
}

/**
 * Ảnh base64 CŨ của đúng một hàng (theo rid) — câu riêng, chỉ khi hàng có cờ `hasPaidProof`: các đường đọc khác đều đã
 * cắt ảnh ở SQL. Trả mọi bản khớp THEO THỨ TỰ hiển thị (trang `order` rồi id, bảng, hàng) — >1 nghĩa là rid trùng; bản
 * ĐẦU là bản mà luật "mỗi rid kế thừa một lần" của đường Lưu coi là hàng gốc.
 */
async function anhJsonCuCuaHang(db: Pick<TxClient, "$queryRaw">, quoteId: number, side: PhiaKhoanChi, rid: string): Promise<(string | null)[]> {
  const rows = side === "hn"
    ? await db.$queryRaw<{ p: string | null }[]>`
        SELECT it.v->>'paidProof' AS p
          FROM "Quote" q,
               jsonb_array_elements(CASE WHEN jsonb_typeof(q."hnTables") = 'array' THEN q."hnTables" ELSE '[]'::jsonb END) WITH ORDINALITY AS t(v, o),
               jsonb_array_elements(CASE WHEN jsonb_typeof(t.v) = 'object' AND jsonb_typeof(t.v->'items') = 'array' THEN t.v->'items' ELSE '[]'::jsonb END) WITH ORDINALITY AS it(v, o)
         WHERE q.id = ${quoteId} AND jsonb_typeof(it.v) = 'object' AND it.v->>'rid' = ${rid}
         ORDER BY t.o, it.o`
    : await db.$queryRaw<{ p: string | null }[]>`
        SELECT it.v->>'paidProof' AS p
          FROM "QuoteSheet" s,
               jsonb_array_elements(CASE WHEN jsonb_typeof(s."extraTables") = 'array' THEN s."extraTables" ELSE '[]'::jsonb END) WITH ORDINALITY AS t(v, o),
               jsonb_array_elements(CASE WHEN jsonb_typeof(t.v) = 'object' AND jsonb_typeof(t.v->'items') = 'array' THEN t.v->'items' ELSE '[]'::jsonb END) WITH ORDINALITY AS it(v, o)
         WHERE s."quoteId" = ${quoteId} AND t.v->>'category' IN ('hcm', 'khach')
           AND jsonb_typeof(it.v) = 'object' AND it.v->>'rid' = ${rid}
         ORDER BY s."order", s.id, t.o, it.o`;
  return rows.map((r) => r.p);
}

async function tenNguoi(db: Pick<TxClient, "user">, id: number | null | undefined): Promise<string | null> {
  if (id == null) return null;
  const u = await db.user.findFirst({ where: { id }, select: { displayName: true }, includeDeleted: true } as any);
  return (u as { displayName?: string } | null)?.displayName ?? null;
}

/**
 * GIEO một khoản từ cờ JSON cũ của hàng (chưa có khoản): `INSERT … ON CONFLICT DO NOTHING` (hai người cùng gieo thì
 * một người thắng, người kia không ghi gì) — paid/paidAt/paidById chép nguyên, ảnh cũ thành InputInvoiceProof
 * `json-cu`, `legacySeed` ghi lại đúng cờ JSON lúc gieo. KHÔNG đụng một byte JSON. Dùng chung với
 * src/khoanChiBackfill.ts. Trả id khoản (của mình hoặc của người thắng) và cờ "mình vừa tạo".
 */
export async function gieoKhoan(
  tx: TxClient,
  p: { quoteId: number; side: PhiaKhoanChi; rid: string; hang: DongBang | null; coNgay: boolean; nguon: "trang" | "json-cu"; actorId: number | null; actorName: string | null },
): Promise<{ id: number; taoMoi: boolean }> {
  const h = hatGiongJson(p.hang?.it);
  const paidByName = h.paid ? await tenNguoi(tx, h.paidById) : null;
  const rowSnapshot = p.hang ? chupHang(p.hang, p.coNgay, p.side) : {};
  const n = await tx.inputInvoiceEntry.createMany({
    data: [{
      quoteId: p.quoteId, side: p.side, rid: p.rid,
      paid: h.paid,
      paidAt: h.paid && h.paidAt ? new Date(h.paidAt) : null,
      paidById: h.paidById,
      paidByName,
      rowSnapshot: rowSnapshot as Prisma.InputJsonValue,
      legacySeed: h as unknown as Prisma.InputJsonValue,
      source: h.paid || h.hasProof ? "json-cu" : p.nguon,
      version: 0,
      updatedById: p.actorId,
      updatedByName: p.actorName,
    }],
    skipDuplicates: true,
  });
  const [e] = await tx.$queryRaw<{ id: number }[]>`SELECT id FROM "InputInvoiceEntry" WHERE "quoteId" = ${p.quoteId} AND side = ${p.side} AND rid = ${p.rid}`;
  if (!e) throw httpError(500, "Không tạo được khoản chi");
  if (n.count > 0 && h.hasProof) {
    // Hàng ĐẦU mang rid này — cùng hàng mà `p.hang` trỏ tới (người gọi duyệt theo đúng thứ tự đó).
    const [anhCu] = await anhJsonCuCuaHang(tx, p.quoteId, p.side, p.rid);
    const anh = anhTuJsonCu(anhCu);
    if (anh) {
      const pr = await tx.inputInvoiceProof.create({
        data: {
          entryId: e.id, dataUrl: anh.dataUrl, mime: anh.mime, size: anh.size, sha256: anh.sha256, source: "json-cu",
          uploadedAt: h.paidAt ? new Date(h.paidAt) : new Date(), uploadedById: h.paidById, uploadedByName: paidByName,
        },
        select: { id: true },
      });
      // Ảnh cũ chỉ là ảnh HIỆN TẠI nếu hàng đang "đã trả" — không thì rút ngay vào lịch sử (vẫn giữ).
      if (h.paid) await tx.inputInvoiceEntry.update({ where: { id: e.id }, data: { currentProofId: pr.id } });
      else await tx.inputInvoiceProof.update({ where: { id: pr.id }, data: { retiredAt: new Date(), retiredReason: "bo-danh-dau" } });
    }
  }
  return { id: e.id, taoMoi: n.count > 0 };
}

/** Ảnh chụp những gì nhật ký cần của một khoản — KHÔNG BAO GIỜ có ảnh (AuditEvent không mã hoá; chép ảnh = nhân bản PII). */
function nhatKyKhoan(e: KhoanChiNap | null, ten: string, sha: string | null, nguon: string) {
  return e
    ? {
        side: e.side, rid: e.rid, ten, version: e.version, paid: e.paid, paidAt: e.paidAt ?? null, paidById: e.paidById ?? null,
        paidByName: e.paidByName ?? null, proofId: e.currentProofId ?? null, proofSha256: sha,
        invoiceDate: ngayRaChuoi(e.invoiceDate), accountingNote: e.accountingNote ?? null, nguon,
      }
    : null;
}

async function shaCua(db: Pick<TxClient, "inputInvoiceProof">, id: number | null | undefined) {
  if (id == null) return null;
  return (await db.inputInvoiceProof.findFirst({ where: { id }, select: { sha256: true } }))?.sha256 ?? null;
}

export async function ghiKhoanChi(req: Request): Promise<{ row: KhoanChiDto }> {
  const s = req.session;
  // Route đã gác invoice:page; kiểm lại ở đây vì mọi đường gọi mới (job, route khác) đều đi qua hàm này.
  if (!can(s, P.INVOICE_PAGE)) throw httpError(403, "Bạn không có quyền mở trang Hóa đơn đầu vào");
  const quoteId = Number(req.params.quoteId);
  const side = String(req.params.side) as PhiaKhoanChi;
  const rid = String(req.params.rid);
  const b = req.body as ThanKhoanChi;

  // (1) QUYỀN THEO TỪNG TRƯỜNG — như updateSheetInvoice: thiếu quyền của BẤT KỲ trường nào là 403 và không ghi gì.
  const chamTien = b.paid !== undefined || b.paidProof !== undefined;
  const chamSua = b.invoiceDate !== undefined || b.accountingNote !== undefined;
  if (chamTien && !can(s, P.INVOICE_INPUT_PAY)) {
    throw httpError(403, "Bạn không có quyền đánh dấu ĐÃ CHI / ảnh chứng từ — nhờ quản trị cấp quyền 'Hóa đơn đầu vào: tích ĐÃ CHI + ảnh chứng từ'.");
  }
  if (chamSua && !can(s, P.INVOICE_EDIT)) throw httpError(403, "Bạn không có quyền sửa Ngày hóa đơn / Ghi chú kế toán");

  // (2) Việc nặng TRƯỚC transaction: soát ảnh, danh sách mẫu (cột Số Ngày), tên người ghi.
  const anhMoi = typeof b.paidProof === "string" ? kiemAnhMoi(b.paidProof) : null;
  const [dsMau, toi] = await Promise.all([dsMauBangNoiBo(), tenNguoi(prisma, s.userId)]);
  const uid = s.userId ?? null;

  const kq = await prisma.$transaction(async (tx) => {
    // (3) Quote FOR SHARE: chặn báo giá bị xoá / Lưu (Quote FOR UPDATE) chen giữa lúc đọc hàng và lúc ghi khoản,
    // nhưng không chặn kế toán khác (FOR SHARE tương thích nhau). SQL thô: không qua extension, không phát SSE.
    const [q] = await tx.$queryRaw<{ id: number; deletedAt: Date | null; hnStatus: string | null; companyId: number }[]>`
      SELECT id, "deletedAt", "hnStatus", "companyId" FROM "Quote" WHERE id = ${quoteId} FOR SHARE`;
    if (!q) throw loiCoMa(404, "khong-thay-bao-gia", "Không tìm thấy báo giá");
    if (q.deletedAt) throw loiCoMa(409, "bao-gia-da-xoa", "Báo giá này đã bị xoá — khoản chi của nó chỉ còn để xem.");

    const bang = await bangCuaPhia(tx, quoteId, side);
    const khop = [...hangCuaPhia(side, bang)].filter((h) => typeof h.it.rid === "string" && h.it.rid.trim() === rid);
    if (khop.length > 1) {
      throw loiCoMa(409, "hang-trung-ma", "Có hai dòng cùng mã nội bộ trong báo giá này — nhờ người soạn mở báo giá và bấm Lưu một lần (máy tự tách mã), rồi thử lại.");
    }
    const hang = khop[0] ?? null;
    // Hàng thuộc TẬP TRANG: Chi phí HCM / Phí KH đã duyệt theo hàng; Hà Nội khi CẢ PHẦN đã duyệt.
    const duDieuKien = !!hang && (side === "hn" ? q.hnStatus === "approved" : hang.it.approved === true);
    const coNgay = hang ? bangNoiBoCoNgay(hang.t, q.companyId, dsMau as MauBangNoiBo[]) : false;

    const [daCo] = await tx.$queryRaw<{ id: number }[]>`SELECT id FROM "InputInvoiceEntry" WHERE "quoteId" = ${quoteId} AND side = ${side} AND rid = ${rid}`;
    if (!hang && !daCo) throw loiCoMa(404, "khong-thay-hang", "Không tìm thấy dòng này trong báo giá (có thể vừa bị xoá hoặc đổi) — hãy tải lại trang.");
    // Ghi lên hàng NGOÀI tập trang chỉ khi hàng đó đã có dữ liệu kế toán (khoản, hoặc cờ / ảnh JSON cũ): kế toán vẫn
    // phải bỏ tích / sửa ghi chú được sau khi người duyệt bỏ duyệt — nhưng không mở khoản mới cho hàng chưa duyệt.
    if (hang && !duDieuKien && !daCo && !coDauVetJsonCu(hang.it)) {
      throw loiCoMa(409, "hang-chua-duyet", side === "hn" ? "Phần Hà Nội của báo giá này chưa được duyệt nên chưa là khoản chi." : "Dòng này chưa được duyệt nên chưa là khoản chi.");
    }

    // (4) Chưa có khoản → gieo (từ cờ JSON cũ nếu có). Hai người cùng gieo: ON CONFLICT DO NOTHING, rồi xếp hàng ở (5).
    let nguonTruoc = "bang";
    if (!daCo) {
      const g = await gieoKhoan(tx, { quoteId, side, rid, hang, coNgay, nguon: "trang", actorId: uid, actorName: toi });
      // Nhật ký "trước": khoản vừa gieo từ cờ JSON cũ = nguồn json-cu; gieo trắng (chưa có dữ liệu kế toán nào) = khong.
      if (g.taoMoi) nguonTruoc = coDauVetJsonCu(hang?.it) ? "json-cu" : "khong";
    }

    // (5) Khoá ĐÚNG khoản này rồi mới so mốc — hai kế toán cùng một khoản xếp hàng ở đây, người sau 409.
    const [e] = await tx.$queryRaw<KhoanChiNap[]>`
      SELECT id, "quoteId", side, rid, paid, "paidAt", "paidById", "paidByName", "paidSnapshot", "currentProofId", "invoiceDate",
             "accountingNote", "rowSnapshot", "legacySeed", source, version, "updatedAt", "updatedByName"
        FROM "InputInvoiceEntry" WHERE "quoteId" = ${quoteId} AND side = ${side} AND rid = ${rid} FOR UPDATE`;
    if (!e) throw httpError(500, "Không đọc được khoản chi vừa tạo");
    if (e.version !== b.baseVersion) {
      throw loiCoMa(409, "khoan-chi-da-doi", "Kế toán khác vừa sửa khoản này — trang đã nạp lại, phần bạn đang nhập vẫn giữ. Kiểm lại rồi bấm Lưu lần nữa.");
    }
    const ten = hang?.ten || (e.rowSnapshot && typeof e.rowSnapshot === "object" ? String((e.rowSnapshot as any).name ?? "") : "");
    const truoc = nhatKyKhoan(e, ten, await shaCua(tx, e.currentProofId), nguonTruoc);

    // (6) Áp thay đổi.
    const now = new Date();
    const data: Prisma.InputInvoiceEntryUpdateInput = {};
    let paidSau = e.paid;
    let proofSau = e.currentProofId;
    let doiTich = false;
    const rutAnh = async (id: number | null, lyDo: LyDoRutAnh) => {
      if (id == null) return;
      await tx.inputInvoiceProof.updateMany({
        where: { id, entryId: e.id, retiredAt: null },
        data: { retiredAt: now, retiredById: uid, retiredByName: toi, retiredReason: lyDo },
      });
    };

    if (b.paid === true) {
      if (!hang) throw loiCoMa(409, "hang-khong-con", "Dòng này không còn trong báo giá — không đánh dấu đã chi được nữa.");
      if (!e.paid) {
        if (!duDieuKien) throw loiCoMa(409, "hang-chua-duyet", side === "hn" ? "Phần Hà Nội của báo giá này chưa được duyệt — chưa đánh dấu đã chi được." : "Dòng này chưa được duyệt — chưa đánh dấu đã chi được.");
        Object.assign(data, { paid: true, paidAt: now, paidById: uid, paidByName: toi });
        paidSau = true;
        doiTich = true;
      }
      // Tích mới, hoặc tích lại khoản đã chi = "xác nhận số tiền hiện tại": chụp lại hàng làm bằng chứng số đã chi.
      data.paidSnapshot = chupHang(hang, coNgay, side) as Prisma.InputJsonValue;
    } else if (b.paid === false && e.paid) {
      Object.assign(data, { paid: false, paidAt: null, paidById: null, paidByName: null, paidSnapshot: Prisma.DbNull });
      await rutAnh(proofSau, "bo-danh-dau");
      proofSau = null;
      paidSau = false;
      doiTich = true;
    }

    if (anhMoi) {
      if (!hang) throw loiCoMa(409, "hang-khong-con", "Dòng này không còn trong báo giá — không đính ảnh mới được nữa.");
      if (!paidSau) throw loiCoMa(400, "chua-danh-dau", "Chỉ đính ảnh chứng từ cho khoản ĐÃ CHI — hãy tích 'Đã chi' trước (hoặc cùng lúc).");
      const soAnh = await tx.inputInvoiceProof.count({ where: { entryId: e.id } });
      if (soAnh >= TRAN_ANH_MOI_KHOAN) {
        throw loiCoMa(400, "qua-nhieu-anh", `Khoản này đã có ${soAnh} ảnh (kể cả ảnh cũ trong lịch sử) — tối đa ${TRAN_ANH_MOI_KHOAN}.`);
      }
      await rutAnh(proofSau, "thay");
      const pr = await tx.inputInvoiceProof.create({
        data: { entryId: e.id, dataUrl: anhMoi.dataUrl, mime: anhMoi.mime, size: anhMoi.size, sha256: anhMoi.sha256, source: "upload", uploadedAt: now, uploadedById: uid, uploadedByName: toi },
        select: { id: true },
      });
      proofSau = pr.id;
    } else if (b.paidProof === null && proofSau != null) {
      await rutAnh(proofSau, "go-anh");
      proofSau = null;
    }
    if (proofSau !== e.currentProofId) data.currentProofId = proofSau;

    if (b.invoiceDate !== undefined) data.invoiceDate = b.invoiceDate ? ngayTuChuoi(b.invoiceDate) : null;
    if (b.accountingNote !== undefined) data.accountingNote = b.accountingNote ? b.accountingNote : null;
    if (hang) data.rowSnapshot = chupHang(hang, coNgay, side) as Prisma.InputJsonValue;
    Object.assign(data, { updatedById: uid, updatedByName: toi, version: { increment: 1 } });

    const sau = (await tx.inputInvoiceEntry.update({ where: { id: e.id }, data, select: CHON_KHOAN })) as KhoanChiNap;
    const anh = await tx.inputInvoiceProof.findMany({ where: { entryId: e.id }, select: CHON_ANH, orderBy: { id: "asc" } });
    return {
      dto: dtoKhoanChi({
        quoteId, side, rid, entry: sau, anh, itJson: hang?.it ?? null,
        tienHienTai: hang ? chupHang(hang, coNgay, side).amount : null,
      }),
      doiTich,
      daChi: paidSau,
      truoc,
      sau: nhatKyKhoan(sau, ten, await shaCua(tx, sau.currentProofId), "bang"),
    };
  });

  // (7) SAU commit: một sự kiện realtime + một dòng nhật ký. 4xx không tới đây nên không phát gì.
  emitChange("inputInvoice", "update");
  await audit(req, kq.doiTich ? (kq.daChi ? "quote.internal.pay" : "quote.internal.unpay") : "quote.internal.ke-toan", {
    resource: "quote", resourceId: quoteId, before: kq.truoc, after: kq.sau,
  });
  return { row: kq.dto };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
//  XEM ẢNH — GET /api/quotes/input-invoices/:quoteId/:side/:rid/proof[?proofId=N]
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Ảnh ủy nhiệm chi là DỮ LIỆU CÁ NHÂN của bên thứ ba (tên + số tài khoản + số tiền): chỉ người có
 * `invoice:input:pay` xem được — tài khoản chi phí (quote:internal:view) không còn đường xem. Mỗi lần xem ghi nhật ký
 * (chỉ định danh, không chép ảnh). Đọc được cả khoản của báo giá đã xoá mềm (bằng chứng chỉ-đọc).
 */
export async function docAnhKhoanChi(req: Request) {
  const s = req.session;
  if (!can(s, P.INVOICE_PAGE) || !can(s, P.INVOICE_INPUT_PAY)) throw httpError(403, "Bạn không có quyền xem ảnh chứng từ");
  const quoteId = Number(req.params.quoteId);
  const side = String(req.params.side) as PhiaKhoanChi;
  const rid = String(req.params.rid);
  const proofId = req.query.proofId != null ? Number(req.query.proofId) : null;

  const e = await prisma.inputInvoiceEntry.findUnique({ where: { quoteId_side_rid: { quoteId, side, rid } }, select: { id: true, currentProofId: true } });
  if (e) {
    const id = proofId ?? e.currentProofId;
    let ket: { paidProof: string | null; proofId: number | null; retiredAt: string | null; nguon: "bang" | "json-cu" } = { paidProof: null, proofId: null, retiredAt: null, nguon: "bang" };
    if (id != null) {
      const p = await prisma.inputInvoiceProof.findFirst({ where: { id, entryId: e.id }, select: { id: true, dataUrl: true, retiredAt: true } });
      if (!p) throw loiCoMa(404, "khong-thay-anh", "Không tìm thấy ảnh này của khoản chi");
      ket = { paidProof: p.dataUrl, proofId: p.id, retiredAt: p.retiredAt ? p.retiredAt.toISOString() : null, nguon: "bang" };
    }
    await audit(req, "quote.internal.proof-view", { resource: "quote", resourceId: quoteId, after: { side, rid, proofId: ket.proofId, nguon: "bang" } });
    return ket;
  }
  // Chưa có khoản → ĐỌC DỰ PHÒNG ảnh trong JSON cũ của hàng (KT-3), lọc lại bằng regex như readProofDataUrl.
  if (proofId != null) throw loiCoMa(404, "khong-thay-anh", "Không tìm thấy ảnh này của khoản chi");
  const ds = await anhJsonCuCuaHang(prisma, quoteId, side, rid);
  if (ds.length > 1) throw loiCoMa(409, "hang-trung-ma", "Có hai dòng cùng mã nội bộ trong báo giá này — nhờ người soạn mở báo giá và bấm Lưu một lần.");
  if (!ds.length) throw loiCoMa(404, "khong-thay-hang", "Không tìm thấy dòng này trong báo giá");
  const anh = typeof ds[0] === "string" && PAYMENT_PROOF_DATA_URL_RE.test(ds[0]) ? ds[0] : null;
  await audit(req, "quote.internal.proof-view", { resource: "quote", resourceId: quoteId, after: { side, rid, proofId: null, nguon: "json-cu" } });
  return { paidProof: anh, proofId: null, retiredAt: null, nguon: "json-cu" as const };
}
