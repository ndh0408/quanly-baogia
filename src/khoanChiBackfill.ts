// CHUYỂN DỮ LIỆU MỘT LẦN: cờ "đã trả" + ảnh chứng từ CŨ trong JSON hàng (`QuoteSheet.extraTables`, `Quote.hnTables`)
// → bảng khoản chi `InputInvoiceEntry` / `InputInvoiceProof` của trang Hóa đơn đầu vào (chủ repo 2026-10-06).
//
// ── VÌ SAO CẦN, DÙ ĐÃ CÓ ĐỌC DỰ PHÒNG ──────────────────────────────────────────────────────────────────
// Mã mới đọc "khoản ?? cờ JSON cũ" (src/khoanChi.ts trangThaiHieuLuc) và gieo khoản từ JSON ở lần ghi đầu, nên KHÔNG
// chạy công cụ này cũng không mất gì. Nhưng hai nguồn sống song song càng lâu càng dễ lệch: bản app CŨ (khe migrate →
// recreate của deploy.sh, hoặc sau khi lùi ảnh) vẫn ghi JSON. Chép sang bảng ngay sau deploy rồi `--kiem` định kỳ là
// cách đưa mọi thứ về MỘT nguồn, và bắt được lần nào app cũ còn ghi JSON (lệch `legacySeed`).
//
// ── HỢP ĐỒNG ─────────────────────────────────────────────────────────────────────────────────────────
//   · KHÔNG đụng một byte JSON nào — trừ `suaRidKhoanChi` (`--sua-rid`), và nó chỉ ghi trường `rid`. Không bao giờ
//     ghi đè khoản đã có (INSERT … ON CONFLICT DO NOTHING).
//   · Chạy lại bao nhiêu lần cũng vậy: lần hai không đổi gì.
//   · Gồm cả báo giá ĐÃ XOÁ MỀM (tiền đã chi vẫn phải đối chiếu được); bỏ bản cũ của bảng Hà Nội còn nằm trong trang.
//   · rid trùng trong một phía → hàng ĐẦU (luật "mỗi rid kế thừa một lần" của đường Lưu); hàng thiếu rid → chỉ báo
//     (`--sua-rid` cấp rid / tách rid trùng trước, rồi `--ghi` chép được cả các hàng đó).
//   · Mỗi báo giá một transaction, thứ tự khoá như dịch vụ kế toán (Quote FOR SHARE → đọc JSON → ghi khoản, KT-5).
//   · Nằm trong src/ nên được biên dịch vào dist/ và CHẠY ĐƯỢC TRONG IMAGE PRODUCTION — xem src/tools/backfillKhoanChi.ts.
import { prisma } from "./db.js";
import { audit } from "./audit.js";
import { dsMauBangNoiBo, bangNoiBoCoNgay, type MauBangNoiBo } from "./quoteUtils.js";
import { randomUUID } from "node:crypto";
import { hangCuaPhia, khoaKhoanChi, hatGiongJson, coDauVetJsonCu, bangCuaSheets, sapTheoThuTu, laPhiaKhoanChi, PHIA_KHOAN_CHI, type PhiaKhoanChi } from "./khoanChi.js";
import { bangCuaPhia, gieoKhoan, docKhoanChiTheoBaoGia } from "./services/inputInvoiceService.js";

export type DongCanChep = { quoteId: number; side: PhiaKhoanChi; rid: string; ten: string; paid: boolean; coAnh: boolean; daXoa: boolean };
export type KeHoachKhoanChi = {
  /** Hàng JSON có dấu vết (đã trả / có ảnh) mà chưa có khoản — `--ghi` sẽ tạo khoản cho chúng. */
  canChep: DongCanChep[];
  /** Hàng có dấu vết mà THIẾU rid — không định vị được khoản, và đường Lưu từ chối báo giá đó; chữa bằng `--sua-rid`. */
  thieuRid: { quoteId: number; side: PhiaKhoanChi; ten: string }[];
  /** rid xuất hiện > 1 lần trong một phía, ít nhất một bản có dấu vết — chỉ hàng ĐẦU được chép. */
  trungRid: { quoteId: number; side: PhiaKhoanChi; rid: string; soLan: number }[];
  /** Khoản đã có mà cờ JSON hiện tại khác `legacySeed` (bản app cũ còn ghi JSON sau khi khoản đã có) — rà tay. */
  lechHatGiong: { quoteId: number; side: string; rid: string; hatGiong: unknown; jsonNay: unknown }[];
  /** Bản cũ của bảng Hà Nội còn trong TRANG mang cờ trả / ảnh mà `Quote.hnTables` không có hàng cùng rid mang dấu vết. */
  hanoiCuTrongTrang: { quoteId: number; sheetId: number; rid: string | null; ten: string }[];
};

/** Lập kế hoạch + soát lệch: CHỈ ĐỌC. */
export async function keHoachKhoanChi(opts: { quoteIds?: number[] } = {}): Promise<KeHoachKhoanChi> {
  const baoGia = await prisma.$queryRaw<{ id: number; deletedAt: Date | null }[]>`SELECT id, "deletedAt" FROM "Quote" ORDER BY id`;
  const ds = opts.quoteIds ? baoGia.filter((q) => opts.quoteIds!.includes(q.id)) : baoGia;
  const kh: KeHoachKhoanChi = { canChep: [], thieuRid: [], trungRid: [], lechHatGiong: [], hanoiCuTrongTrang: [] };
  const khoanTheoBaoGia = await docKhoanChiTheoBaoGia(ds.map((q) => q.id));
  for (const q of ds) {
    const khoan = khoanTheoBaoGia.get(q.id) ?? new Map();
    for (const side of PHIA_KHOAN_CHI) {
      const bang = await bangCuaPhia(prisma, q.id, side);
      const dem = new Map<string, number>();
      for (const { it } of hangCuaPhia(side, bang)) {
        const r = typeof it.rid === "string" ? it.rid.trim() : "";
        if (r) dem.set(r, (dem.get(r) ?? 0) + 1);
      }
      const daXet = new Set<string>();
      const daBaoTrung = new Set<string>();
      for (const { it, ten } of hangCuaPhia(side, bang)) {
        const rid = typeof it.rid === "string" ? it.rid.trim() : "";
        const coVet = coDauVetJsonCu(it);
        if (!rid) {
          if (coVet) kh.thieuRid.push({ quoteId: q.id, side, ten });
          continue;
        }
        if ((dem.get(rid) ?? 0) > 1 && coVet && !daBaoTrung.has(rid)) {
          daBaoTrung.add(rid);
          kh.trungRid.push({ quoteId: q.id, side, rid, soLan: dem.get(rid)! });
        }
        if (daXet.has(rid)) continue;             // hàng đầu mang rid này mới tính (kế thừa một lần)
        daXet.add(rid);
        const e = khoan.get(khoaKhoanChi(side, rid));
        if (e) {
          const nay = hatGiongJson(it);
          const goc = (e.legacySeed ?? null) as Record<string, unknown> | null;
          if (goc && (goc.paid !== nay.paid || goc.hasProof !== nay.hasProof || (goc.paidAt ?? null) !== nay.paidAt || (goc.paidById ?? null) !== nay.paidById)) {
            kh.lechHatGiong.push({ quoteId: q.id, side, rid, hatGiong: goc, jsonNay: nay });
          }
          continue;
        }
        if (coVet) {
          const h = hatGiongJson(it);
          kh.canChep.push({ quoteId: q.id, side, rid, ten, paid: h.paid, coAnh: h.hasProof, daXoa: !!q.deletedAt });
        }
      }
    }
  }
  // Bản cũ của bảng HN còn trong trang (migration 20260915140000 EXPAND-ONLY) mang cờ trả — đường đọc mới không thấy
  // nó (khoản HN định vị trên Quote.hnTables), nên phải báo nếu bản ở Quote.hnTables không mang cùng dấu vết.
  const cu = await prisma.$queryRaw<{ quoteId: number; sheetId: number; rid: string | null; ten: string | null }[]>`
    SELECT s."quoteId" AS "quoteId", s.id AS "sheetId", it.v->>'rid' AS rid, it.v->>'name' AS ten
      FROM "QuoteSheet" s,
           jsonb_array_elements(CASE WHEN jsonb_typeof(s."extraTables") = 'array' THEN s."extraTables" ELSE '[]'::jsonb END) t(v),
           jsonb_array_elements(CASE WHEN jsonb_typeof(t.v) = 'object' AND jsonb_typeof(t.v->'items') = 'array' THEN t.v->'items' ELSE '[]'::jsonb END) it(v)
     WHERE t.v->>'category' = 'hanoi' AND jsonb_typeof(it.v) = 'object'
       AND (it.v->>'paid' = 'true' OR coalesce(it.v->>'paidProof', '') <> '')`;
  for (const r of cu) {
    if (opts.quoteIds && !opts.quoteIds.includes(r.quoteId)) continue;
    const hn = await bangCuaPhia(prisma, r.quoteId, "hn");
    const coBanHn = [...hangCuaPhia("hn", hn)].some(({ it }) => r.rid && it.rid === r.rid && coDauVetJsonCu(it));
    const coKhoan = !!(r.rid && khoanTheoBaoGia.get(r.quoteId)?.has(khoaKhoanChi("hn", r.rid)));
    if (!coBanHn && !coKhoan) kh.hanoiCuTrongTrang.push({ quoteId: r.quoteId, sheetId: r.sheetId, rid: r.rid, ten: r.ten || "(không tên)" });
  }
  return kh;
}

/**
 * GHI: tạo khoản (+ ảnh `json-cu`) cho mọi dòng `canChep` — mỗi báo giá một transaction; đọc lại JSON TRONG transaction
 * (dưới Quote FOR SHARE) chứ không tin bản đọc lúc lập kế hoạch. Trả số khoản đã tạo.
 */
export async function apDungKhoanChi(kh: KeHoachKhoanChi): Promise<number> {
  const dsMau = await dsMauBangNoiBo();
  const theoBaoGia = new Map<number, DongCanChep[]>();
  for (const d of kh.canChep) (theoBaoGia.get(d.quoteId) ?? theoBaoGia.set(d.quoteId, []).get(d.quoteId)!).push(d);
  let tao = 0;
  for (const [quoteId, dong] of theoBaoGia) {
    const daTao = await prisma.$transaction(async (tx) => {
      const [q] = await tx.$queryRaw<{ id: number; companyId: number }[]>`SELECT id, "companyId" FROM "Quote" WHERE id = ${quoteId} FOR SHARE`;
      if (!q) return [] as { side: PhiaKhoanChi; rid: string; id: number }[];
      const out: { side: PhiaKhoanChi; rid: string; id: number }[] = [];
      for (const side of PHIA_KHOAN_CHI) {
        const can = new Set(dong.filter((d) => d.side === side).map((d) => d.rid));
        if (!can.size) continue;
        const bang = await bangCuaPhia(tx, quoteId, side);
        const daXet = new Set<string>();
        for (const h of hangCuaPhia(side, bang)) {
          const rid = typeof h.it.rid === "string" ? h.it.rid.trim() : "";
          if (!rid || daXet.has(rid)) continue;
          daXet.add(rid);
          if (!can.has(rid) || !coDauVetJsonCu(h.it)) continue;
          const coNgay = bangNoiBoCoNgay(h.t, q.companyId, dsMau as MauBangNoiBo[]);
          const g = await gieoKhoan(tx, { quoteId, side, rid, hang: h, coNgay, nguon: "json-cu", actorId: null, actorName: null });
          if (g.taoMoi) out.push({ side, rid, id: g.id });
        }
      }
      return out;
    });
    for (const d of daTao) {
      const e = await prisma.inputInvoiceEntry.findUnique({ where: { id: d.id }, select: { paid: true, paidAt: true, currentProofId: true } });
      // Nhật ký: actorId null (công cụ hệ thống), before = cờ JSON cũ (nguồn "json-cu"). Best-effort như mọi audit().
      await audit(null, "quote.internal.ke-toan", {
        resource: "quote", resourceId: quoteId,
        after: { nguon: "json-cu", side: d.side, rid: d.rid, paid: e?.paid ?? null, paidAt: e?.paidAt ?? null, proofId: e?.currentProofId ?? null },
      });
    }
    tao += daTao.length;
  }
  return tao;
}

/** Còn việc phải làm / phải rà không — `--kiem` thoát ≠ 0 khi có. */
export const conViec = (kh: KeHoachKhoanChi) =>
  kh.canChep.length + kh.thieuRid.length + kh.trungRid.length + kh.lechHatGiong.length + kh.hanoiCuTrongTrang.length > 0;

export type DoiRid = { quoteId: number; side: PhiaKhoanChi; ridCu: string | null; ridMoi: string; ten: string; coVet: boolean };

/**
 * CHUẨN HOÁ MÃ NỘI BỘ (`--sua-rid`) — việc DUY NHẤT của công cụ này có GHI JSON hàng, và chỉ ghi đúng trường `rid`:
 *   · hàng thiếu rid → rid mới;
 *   · bản thứ 2 trở đi của một rid TRÙNG trong một phía (theo thứ tự hiển thị: trang order→id, bảng, hàng) → rid mới;
 *   · rid dính khoảng trắng → cắt (bản đầu giữ rid đã cắt).
 * Mọi trường khác — cờ duyệt, cờ "đã trả", ẢNH base64 — giữ NGUYÊN trên chính hàng đó; bản đầu giữ rid (chủ của khoản kế
 * toán). Sau đó mọi hàng định vị được: kế toán ghi được khoản, `--ghi` chép được dấu vết cũ của các bản sau.
 *
 * Vì sao cần dù đường Lưu đã tự tách (src/khoanChi.ts chuanHoaRidTrung): hàng thiếu rid mà còn cờ / ảnh cũ thì đường Lưu
 * TỪ CHỐI (lưu sẽ xoá im cờ) — người soạn không tự gỡ được; và kế toán gặp 409 'hang-trung-ma' cho tới khi có ai bấm Lưu.
 *
 * Khoá như đường Lưu (KT-5): QuoteSheet FOR UPDATE (ORDER BY id) → Quote FOR NO KEY UPDATE; đọc JSON ĐỦ (cả ảnh) TRONG giao
 * dịch rồi ghi lại. Bump Quote.updatedAt để màn soạn đang mở bản cũ nhận 409 khi Lưu thay vì gửi lại rid cũ. Mỗi báo giá có
 * đổi ghi MỘT dòng nhật ký 'quote.internal.ke-toan' (nguon 'sua-rid', không chép ảnh). Gồm cả báo giá đã xoá mềm. Chạy lại
 * không đổi gì. `ghi` vắng = chế độ khô (chỉ liệt kê). CHỈ ghi thật sau pg_dump.
 */
export async function suaRidKhoanChi(opts: { quoteIds?: number[]; ghi?: boolean } = {}): Promise<DoiRid[]> {
  const ds = (await prisma.$queryRaw<{ id: number }[]>`SELECT id FROM "Quote" ORDER BY id`).map((r) => r.id).filter((id) => !opts.quoteIds || opts.quoteIds.includes(id));
  const tatCa: DoiRid[] = [];
  for (const quoteId of ds) {
    const doi = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "QuoteSheet" WHERE "quoteId" = ${quoteId} ORDER BY id FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "Quote" WHERE id = ${quoteId} FOR NO KEY UPDATE`;
      const sheets: any[] = await tx.quoteSheet.findMany({ where: { quoteId }, select: { id: true, order: true, extraTables: true } });
      const q: any = await tx.quote.findFirst({ where: { id: quoteId }, select: { hnTables: true }, includeDeleted: true } as any);
      const out: DoiRid[] = [];
      const lam = (side: PhiaKhoanChi, tables: unknown, danhDau: (it: object) => void) => {
        const thay = new Set<string>();
        for (const { it, ten } of hangCuaPhia(side, tables)) {
          const r = typeof it.rid === "string" ? it.rid.trim() : "";
          if (r && !thay.has(r)) {
            thay.add(r);
            // rid dính khoảng trắng (payload tự chế ở bản cũ) → cắt: khoản kế toán và đường Lưu đều khoá theo rid ĐÃ CẮT.
            if (it.rid !== r) { out.push({ quoteId, side, ridCu: it.rid, ridMoi: r, ten, coVet: coDauVetJsonCu(it) }); it.rid = r; danhDau(it); }
            continue;
          }
          const moi = randomUUID();
          out.push({ quoteId, side, ridCu: r || null, ridMoi: moi, ten, coVet: coDauVetJsonCu(it) });
          it.rid = moi;
          thay.add(moi);
          danhDau(it);
        }
      };
      // Phía "sheet": hàng của trang nào bị đổi thì ghi lại đúng trang đó.
      const trangCua = new Map<object, number>();
      for (const sh of sheets) for (const { it } of hangCuaPhia("sheet", Array.isArray(sh.extraTables) ? sh.extraTables : [])) trangCua.set(it, sh.id);
      const sheetDoi = new Set<number>();
      lam("sheet", bangCuaSheets(sapTheoThuTu(sheets)), (it) => { const id = trangCua.get(it); if (id != null) sheetDoi.add(id); });
      let hnDoi = false;
      lam("hn", Array.isArray(q?.hnTables) ? q.hnTables : [], () => { hnDoi = true; });
      if (!out.length || !opts.ghi) return out;
      for (const sh of sheets) if (sheetDoi.has(sh.id)) await tx.quoteSheet.update({ where: { id: sh.id }, data: { extraTables: sh.extraTables } });
      // Cùng một lệnh: ghi hnTables (nếu đổi) VÀ bump updatedAt — màn soạn mở bản cũ sẽ nhận 409 khi Lưu. Đặt updatedAt
      // TƯỜNG MINH: chỉ đổi hàng trang thì data rỗng, không trông vào việc Prisma có tự chạm @updatedAt khi data rỗng.
      await tx.quote.update({ where: { id: quoteId }, data: { ...(hnDoi ? { hnTables: q.hnTables } : {}), updatedAt: new Date() } });
      return out;
    });
    if (doi.length && opts.ghi) {
      await audit(null, "quote.internal.ke-toan", {
        resource: "quote", resourceId: quoteId,
        after: { nguon: "sua-rid", soHang: doi.length, doi: doi.slice(0, 50).map(({ side, ridCu, ridMoi, ten, coVet }) => ({ side, ridCu, ridMoi, ten: ten.slice(0, 80), coVet })) },
      });
    }
    tatCa.push(...doi);
  }
  return tatCa;
}

/**
 * XÁC NHẬN ĐÃ RÀ (`--xac-nhan quoteId:side:rid[,…]`) một dòng 'lech-legacySeed' của `--kiem`: người vận hành đã đối chiếu
 * cờ JSON cũ vừa bị bản app cũ đổi (lúc lùi ảnh) với khoản kế toán và quyết định giữ khoản như hiện có. Ghi `legacySeed` =
 * cờ JSON HIỆN TẠI để `--kiem` về 0 lại được — KHÔNG đổi khoản (đã chi, ảnh, ngày HĐ, ghi chú) và KHÔNG đụng JSON. Mỗi dòng
 * một nhật ký 'quote.internal.ke-toan' (nguon 'xac-nhan', trước/sau là hạt giống). Trả số dòng đã xác nhận + dòng bỏ qua.
 */
export async function xacNhanHatGiong(khoa: string[]): Promise<{ daXacNhan: number; boQua: string[] }> {
  let daXacNhan = 0;
  const boQua: string[] = [];
  for (const k of khoa) {
    const m = /^(\d+):(sheet|hn):(.+)$/.exec(k.trim());
    if (!m || !laPhiaKhoanChi(m[2])) { boQua.push(`${k} (sai dạng quoteId:side:rid)`); continue; }
    const quoteId = Number(m[1]);
    const side = m[2] as PhiaKhoanChi;
    const rid = m[3];
    const kq = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Quote" WHERE id = ${quoteId} FOR SHARE`;
      const bang = await bangCuaPhia(tx, quoteId, side);
      const hang = [...hangCuaPhia(side, bang)].find(({ it }) => typeof it.rid === "string" && it.rid.trim() === rid);
      if (!hang) return null;
      const [e] = await tx.$queryRaw<{ id: number; legacySeed: unknown }[]>`SELECT id, "legacySeed" FROM "InputInvoiceEntry" WHERE "quoteId" = ${quoteId} AND side = ${side} AND rid = ${rid} FOR UPDATE`;
      if (!e) return null;
      const moi = hatGiongJson(hang.it);
      await tx.inputInvoiceEntry.update({ where: { id: e.id }, data: { legacySeed: moi as any } });
      return { cu: e.legacySeed, moi };
    });
    if (!kq) { boQua.push(`${k} (không thấy hàng hoặc khoản)`); continue; }
    await audit(null, "quote.internal.ke-toan", {
      resource: "quote", resourceId: quoteId,
      before: { nguon: "xac-nhan", side, rid, legacySeed: kq.cu },
      after: { nguon: "xac-nhan", side, rid, legacySeed: kq.moi },
    });
    daXacNhan++;
  }
  return { daXacNhan, boQua };
}
