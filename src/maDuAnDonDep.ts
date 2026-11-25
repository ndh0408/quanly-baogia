// DỌN MÃ DỰ ÁN MỘT LẦN — chủ repo 2026-11-25 chọn "làm sạch hết" khi chuyển sang cấp mã lúc KHÁCH CHỐT (src/maDuAn.ts).
//
// Trước 2026-11-25 mã dự án được cấp NGAY LÚC TẠO báo giá, nên dãy FP_A26_001, 002… của mỗi người đầy mã của báo giá
// nháp / khách không chốt. Công cụ này đưa dữ liệu cũ về đúng luật mới:
//   1. GỠ mã khỏi MỌI báo giá CHƯA CHỐT (mọi trạng thái khác `converted`, kể cả "Không chốt") và mọi báo giá ĐÃ XOÁ MỀM
//      → hiển thị "NHÁP <số BG>". Bản nháp là phiên bản mới của dự án đã chốt GIỮ liên kết về gốc (`projectRootId`) để
//      chốt lại lấy đúng mã của dự án.
//   2. ĐÁNH LẠI mã các báo giá ĐÃ CHỐT cho liền số theo từng (tiền tố, năm), GIỮ thứ tự số cũ tăng dần (001, 004, 006 →
//      001, 002, 003). Các phiên bản cùng một mã cũ nhận CÙNG một mã mới (số phiên bản giữ nguyên).
//   3. Mã KIỂU CŨ — không khớp `<tiền tố của người tạo><YY>_<NNN>` (vd "GN26026" của người không có tiền tố, hoặc tiền tố
//      người tạo đã đổi) — KHÔNG tự đánh lại: chỉ liệt kê để chủ repo quyết. Số của chúng được NÉ khi đánh lại.
//   4. Bộ đếm (tiền tố, năm) về đúng số lớn nhất còn lại sau khi đánh lại.
//   5. Điền `projectRootId` cho các phiên bản cũ đang nhận nhau qua projectCode (và nối thẳng chuỗi gốc → gốc thật).
//
// ── CỘT NÀO ĐI THEO MÃ ──────────────────────────────────────────────────────────────────────────────
//   · "Quote"."projectCode" + "searchText" (normalizeSearch(quoteNumber, projectCode, title, toCompany, toContact) — đúng
//     công thức createQuote/updateQuote).
//   · "PersonnelRecord"."projectCode" (lưu CỨNG mã sản xuất "<mã>[_vN][_NN]", buildProjectRef khớp BẰNG-ĐÚNG) + searchText.
//   · Không bảng nào khác LƯU chuỗi mã: mã hóa đơn đầu ra (src/invoiceSplit.ts) và mã sản xuất của sheet dựng lúc đọc
//     từ projectCode + QuoteSheet.codeNo; khoản chi kế toán (`InputInvoiceEntry.rowSnapshot`/`paidSnapshot`) chụp tên /
//     số lượng / tiền của hàng, không chụp mã. Thông báo chỉ mang số báo giá.
//   · GIỮ NGUYÊN như lịch sử: `QuoteVersion.payload` (bản chụp từng lần lưu) và `AuditEvent` — sửa chúng là sửa sổ sách.
//
// ── HỢP ĐỒNG ─────────────────────────────────────────────────────────────────────────────────────────
//   · `keHoachMaDuAn` CHỈ ĐỌC. `apDungMaDuAn` lập lại kế hoạch TRONG một transaction đã khoá bảng (LOCK "Quote" /
//     "PersonnelRecord" IN EXCLUSIVE MODE — đọc vẫn chạy, ghi phải chờ) rồi ghi tất cả hoặc không gì cả.
//   · Đổi mã HAI PHA (mã tạm `__DOI__<id>` → mã đích): đánh lại 004 → 002 trong khi 002 cũ chưa dời đi thì
//     @@unique([projectCode, projectVersion]) đỏ giữa chừng.
//   · Mỗi báo giá / hồ sơ đổi mã có một dòng AuditEvent (mã cũ → mới), ghi trong CÙNG transaction.
//   · Chạy lại lần hai không đổi gì (idempotent): mã đã liền số ánh xạ về chính nó, nháp không còn mã, liên kết đã thẳng.
//   · Không phải migration: người vận hành chạy tay SAU KHI BACKUP — docs/operations/DON_MA_DU_AN.md.
import { prisma, type TxClient } from "./db.js";
import { normalizeSearch } from "./searchText.js";
import { personnelSearchText } from "./services/personnelService.js";

type Db = TxClient;

/** Khuôn mã dự án do hệ thống cấp: `<tiền tố><YY>_<NNN>` (nextProjectCode). */
const KHUON_MA = /^(.+)(\d{2})_(\d{3,9})$/;
/** Đuôi hợp lệ phía sau mã dự án trong một mã SẢN XUẤT (sheetCode): `_vN` rồi `_NN`, cả hai tuỳ chọn. */
const DUOI_MA_SAN_XUAT = /^(_v\d+)?(_\d{2,})?$/;

export type DongBaoGia = {
  id: number;
  quoteNumber: string;
  status: string;
  daXoa: boolean;
  tieuDe: string;
  khach: string;
  phienBan: number;
  maCu: string | null;
  maMoi: string | null;
  gocCu: number | null;
  gocMoi: number | null;
  /** doi = đánh lại mã · go = gỡ mã (→ NHÁP) · giu = đã chốt, mã đã đúng · kieu-cu = đã chốt, mã kiểu cũ (giữ) · lien-ket = chỉ đổi liên kết gốc */
  loai: "doi" | "go" | "giu" | "kieu-cu" | "lien-ket";
  canhBao: string[];
};
export type DongNhanSu = { id: number; hoTen: string; maCu: string; maMoi: string };
export type DongBoDem = { prefix: string; year: number; cu: number | null; moi: number; ghiChu: string | null };
export type KeHoachMaDuAn = {
  baoGia: DongBaoGia[];
  nhanSu: DongNhanSu[];
  boDem: DongBoDem[];
  /** Hồ sơ nhân sự trỏ vào mã vừa bị GỠ (báo giá chưa chốt) — không có đích để đổi; trước đây cũng không tra được. */
  nhanSuMoCoi: { id: number; hoTen: string; ma: string }[];
};

type HangQuote = {
  id: number; quoteNumber: string; projectCode: string | null; projectVersion: number; projectRootId: number | null;
  status: string; deletedAt: Date | null; createdById: number; title: string; shortTitle: string | null;
  toCompany: string; toContact: string | null; khachTen: string | null;
  soHd: number; ngayHd: number; daThu: number; soPo: number; guiCt: number; khoanChi: number; khoanDaChi: number;
};

const cat = (s: string | null | undefined, n: number) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
};
const dinhDangMa = (prefix: string, yy: string, n: number) => `${prefix}${yy}_${String(n).padStart(3, "0")}`;

/**
 * Phạm vi: mặc định CẢ CSDL (đúng nghĩa công cụ). `chiNguoiTao` giới hạn vào báo giá của vài người tạo (và tiền tố mã
 * của chính họ) — để bài test chạy được trên CSDL test DÙNG CHUNG với các tệp test khác chạy song song, và để người
 * vận hành có thể thử trên MỘT người trước khi chạy cả công ty.
 */
export type PhamViDon = { chiNguoiTao?: number[] };

/** Lập kế hoạch: CHỈ ĐỌC. Truyền `tx` để đọc trong transaction đã khoá (apDungMaDuAn). */
export async function keHoachMaDuAn(db: Db = prisma as unknown as Db, phamVi: PhamViDon = {}): Promise<KeHoachMaDuAn> {
  // Mọi báo giá, KỂ CẢ đã xoá mềm (@@unique gồm cả chúng). Kèm dấu hiệu "mã đã ra chứng từ" để cảnh báo.
  const qs = await db.$queryRaw<HangQuote[]>`
    SELECT q.id, q."quoteNumber", q."projectCode", q."projectVersion", q."projectRootId", q.status::text AS status,
           q."deletedAt", q."createdById", q.title, q."shortTitle", q."toCompany", q."toContact", c.name AS "khachTen",
           COALESCE(s."soHd", 0)::int AS "soHd", COALESCE(s."ngayHd", 0)::int AS "ngayHd", COALESCE(s."daThu", 0)::int AS "daThu",
           COALESCE(s."soPo", 0)::int AS "soPo", COALESCE(s."guiCt", 0)::int AS "guiCt",
           COALESCE(k."khoanChi", 0)::int AS "khoanChi", COALESCE(k."khoanDaChi", 0)::int AS "khoanDaChi"
    FROM "Quote" q
    LEFT JOIN "Customer" c ON c.id = q."customerId"
    LEFT JOIN (
      SELECT "quoteId",
             COUNT(*) FILTER (WHERE COALESCE(TRIM("invoiceNo"), '') <> '' OR COALESCE(TRIM("hnInvoiceNo"), '') <> '') AS "soHd",
             COUNT(*) FILTER (WHERE "invoiceDate" IS NOT NULL) AS "ngayHd",
             COUNT(*) FILTER (WHERE "paidAt" IS NOT NULL) AS "daThu",
             COUNT(*) FILTER (WHERE COALESCE(TRIM("poNumber"), '') <> '') AS "soPo",
             COUNT(*) FILTER (WHERE "docSentAt" IS NOT NULL) AS "guiCt"
      FROM "QuoteSheet" GROUP BY "quoteId"
    ) s ON s."quoteId" = q.id
    LEFT JOIN (
      SELECT "quoteId", COUNT(*) AS "khoanChi", COUNT(*) FILTER (WHERE paid) AS "khoanDaChi"
      FROM "InputInvoiceEntry" GROUP BY "quoteId"
    ) k ON k."quoteId" = q.id
    ORDER BY q.id`;
  const chi = phamVi.chiNguoiTao ? new Set(phamVi.chiNguoiTao) : null;
  if (chi) qs.splice(0, qs.length, ...qs.filter((q) => chi.has(q.createdById)));
  const users = await db.$queryRaw<{ id: number; projectCode: string | null }[]>`SELECT id, "projectCode" FROM "User"`;
  const tienToNguoi = new Map(users.map((u) => [u.id, (u.projectCode ?? "").trim()]));
  const congTy = await db.$queryRaw<{ quotePrefix: string | null }[]>`SELECT "quotePrefix" FROM "Company"`;
  // Bộ đếm số BÁO GIÁ dùng CHUNG bảng QuoteCounter theo (prefix, năm). Tiền tố mã dự án nào trùng tiền tố số báo giá của
  // một công ty thì hàng đếm đó đang đếm CẢ số báo giá — kéo nó về số mã dự án là cấp lại số báo giá đã dùng.
  const tienToSoBaoGia = new Set(["GN", ...congTy.map((c) => (c.quotePrefix ?? "").trim()).filter(Boolean)]);

  // ── 1. NHÓM DỰ ÁN (union-find): liên kết gốc sẵn có + cùng projectCode + gốc kiểu cũ (projectCode null, số BG = mã) ──
  const cha = new Map<number, number>();
  const tim = (x: number): number => {
    let r = x;
    while ((cha.get(r) ?? r) !== r) r = cha.get(r)!;
    let y = x;
    while (y !== r) { const n = cha.get(y)!; cha.set(y, r); y = n; }
    return r;
  };
  const noi = (a: number, b: number) => {
    if (!cha.has(a)) cha.set(a, a);
    if (!cha.has(b)) cha.set(b, b);
    const ra = tim(a), rb = tim(b);
    if (ra !== rb) cha.set(Math.max(ra, rb), Math.min(ra, rb));
  };
  for (const q of qs) {
    if (!cha.has(q.id)) cha.set(q.id, q.id);
    if (q.projectRootId != null) noi(q.id, q.projectRootId);   // gốc đã xoá cứng vẫn là một nút (số id)
  }
  const theoMa = new Map<string, HangQuote[]>();
  for (const q of qs) if (q.projectCode) {
    const ds = theoMa.get(q.projectCode) ?? [];
    ds.push(q);
    theoMa.set(q.projectCode, ds);
  }
  for (const ds of theoMa.values()) for (const q of ds.slice(1)) noi(ds[0].id, q.id);
  const theoSo = new Map(qs.map((q) => [q.quoteNumber, q]));
  for (const [ma, ds] of theoMa) {
    const goc = theoSo.get(ma);
    if (goc && !goc.projectCode) noi(goc.id, ds[0].id);
  }
  // Gốc của nhóm = id NHỎ NHẤT (bản tạo đầu tiên; "Bản mới" luôn sinh sau bản nó chép). Nút không phải báo giá (gốc đã
  // xoá cứng) vẫn có thể là id nhỏ nhất — đúng ý: các phiên bản còn lại giữ nguyên liên kết như cũ.
  const thanhVien = new Map<number, number>();
  for (const x of cha.keys()) { const r = tim(x); thanhVien.set(r, (thanhVien.get(r) ?? 0) + 1); }
  const gocMoiCua = (q: HangQuote): number | null => {
    const r = tim(q.id);
    return (thanhVien.get(r) ?? 1) > 1 && r !== q.id ? r : null;
  };

  // ── 2. PHÂN LOẠI MÃ ĐANG ĐƯỢC BÁO GIÁ ĐÃ CHỐT (còn sống) DÙNG ──
  const conSong = (q: HangQuote) => q.status === "converted" && !q.deletedAt;
  type MaChot = { ma: string; prefix: string; yy: string; year: number; n: number };
  const maTheoTienTo = new Map<string, MaChot>();   // mã → phân tích (đánh lại được)
  const maKieuCu = new Set<string>();
  for (const [ma, ds] of theoMa) {
    if (!ds.some(conSong)) continue;
    const m = KHUON_MA.exec(ma);
    // "Theo tiền tố người tạo": phần chữ của mã là ĐÚNG tiền tố hiện tại của người tạo một trong các báo giá mang mã.
    const theoTienTo = !!m && ds.some((q) => tienToNguoi.get(q.createdById) === m[1]);
    if (m && theoTienTo) maTheoTienTo.set(ma, { ma, prefix: m[1], yy: m[2], year: 2000 + Number(m[2]), n: Number(m[3]) });
    else maKieuCu.add(ma);
  }

  // ── 3. ĐÁNH LẠI LIỀN SỐ THEO (tiền tố, năm), né số của mã kiểu cũ còn ở lại ──
  const khoaXo = (p: string, y: number) => `${p}\u0000${y}`;
  const xo = new Map<string, MaChot[]>();
  for (const mc of maTheoTienTo.values()) {
    const k = khoaXo(mc.prefix, mc.year);
    const ds = xo.get(k) ?? [];
    ds.push(mc);
    xo.set(k, ds);
  }
  const giuLai = (prefix: string, year: number) => {   // số của mã KIỂU CŨ trong xô này — không được cấp trùng
    const s = new Set<number>();
    for (const ma of maKieuCu) {
      const m = KHUON_MA.exec(ma);
      if (m && m[1] === prefix && 2000 + Number(m[2]) === year) s.add(Number(m[3]));
    }
    return s;
  };
  const maMoiCua = new Map<string, string>();
  const lonNhatXo = new Map<string, number>();
  for (const [k, ds] of xo) {
    ds.sort((a, b) => a.n - b.n || a.ma.localeCompare(b.ma));
    const { prefix, year, yy } = ds[0];
    const ne = giuLai(prefix, year);
    let n = 0;
    for (const mc of ds) {
      do { n++; } while (ne.has(n));
      maMoiCua.set(mc.ma, dinhDangMa(prefix, yy, n));
    }
    lonNhatXo.set(k, Math.max(n, ...ne));
  }

  // ── 4. TỪNG BÁO GIÁ ──
  const baoGia: DongBaoGia[] = [];
  for (const q of qs) {
    const gocMoi = gocMoiCua(q);
    let maMoi: string | null = q.projectCode;
    let loai: DongBaoGia["loai"] | null = null;
    if (q.projectCode) {
      if (q.deletedAt || q.status !== "converted") { maMoi = null; loai = "go"; }
      else if (maKieuCu.has(q.projectCode)) loai = "kieu-cu";
      else { maMoi = maMoiCua.get(q.projectCode) ?? q.projectCode; loai = maMoi === q.projectCode ? "giu" : "doi"; }
    }
    if (!loai && gocMoi !== q.projectRootId) loai = "lien-ket";
    if (!loai) continue;
    const canhBao: string[] = [];
    if (loai === "doi" || (loai === "go" && q.status === "converted")) {
      // Mã ĐÃ RA NGOÀI: chứng từ thật đã gửi khách mang mã cũ — đổi mã là hai bên không còn khớp.
      if (q.soHd) canhBao.push(`có số HĐ (${q.soHd} sheet)`);
      if (q.ngayHd) canhBao.push("có ngày HĐ");
      if (q.daThu) canhBao.push("đã thu tiền");
      if (q.soPo) canhBao.push("có số PO");
      if (q.guiCt) canhBao.push("đã gửi chứng từ");
      if (q.khoanChi) canhBao.push(`khoản chi kế toán: ${q.khoanChi} (${q.khoanDaChi} đã chi)`);
    }
    if (loai === "go" && q.status === "converted") canhBao.push("ĐÃ CHỐT nhưng đã xoá mềm — mã bị gỡ");
    baoGia.push({
      id: q.id, quoteNumber: q.quoteNumber, status: q.status, daXoa: !!q.deletedAt,
      tieuDe: q.shortTitle?.trim() || q.title, khach: q.khachTen || q.toCompany || "", phienBan: q.projectVersion,
      maCu: q.projectCode, maMoi, gocCu: q.projectRootId, gocMoi, loai, canhBao,
    });
  }

  // ── 5. NHÂN SỰ: mã sản xuất lưu cứng "<mã>[_vN][_NN]" ──
  const doiMa = new Map<string, string>();
  for (const b of baoGia) if (b.loai === "doi" && b.maCu && b.maMoi) doiMa.set(b.maCu, b.maMoi);
  const maBiGo = new Set<string>();
  for (const b of baoGia) if (b.loai === "go" && b.maCu && !maTheoTienTo.has(b.maCu) && !maKieuCu.has(b.maCu)) maBiGo.add(b.maCu);
  const ns = await db.$queryRaw<{ id: number; fullName: string; projectCode: string | null }[]>`
    SELECT id, "fullName", "projectCode" FROM "PersonnelRecord" WHERE COALESCE("projectCode", '') <> '' ORDER BY id`;
  // Mã dài trước: "FP_A26_001" không được ăn nhầm hồ sơ của "FP_A26_0012…" (đuôi phải khớp DUOI_MA_SAN_XUAT).
  const tachMa = (ma: string, tap: Iterable<string>) => {
    for (const goc of [...tap].sort((a, b) => b.length - a.length)) {
      if (ma.startsWith(goc) && DUOI_MA_SAN_XUAT.test(ma.slice(goc.length))) return { goc, duoi: ma.slice(goc.length) };
    }
    return null;
  };
  const nhanSu: DongNhanSu[] = [];
  const nhanSuMoCoi: KeHoachMaDuAn["nhanSuMoCoi"] = [];
  for (const r of ns) {
    const ma = (r.projectCode ?? "").trim();
    const t = tachMa(ma, doiMa.keys());
    if (t) { nhanSu.push({ id: r.id, hoTen: r.fullName, maCu: r.projectCode!, maMoi: doiMa.get(t.goc)! + t.duoi }); continue; }
    if (tachMa(ma, maBiGo)) nhanSuMoCoi.push({ id: r.id, hoTen: r.fullName, ma });
  }

  // ── 6. BỘ ĐẾM: (tiền tố người dùng, năm) về số lớn nhất CÒN LẠI sau khi dọn ──
  const tienToNguoiDung = new Set(users.filter((u) => !chi || chi.has(u.id)).map((u) => (u.projectCode ?? "").trim()).filter(Boolean));
  const conLai = new Map<string, number>();   // khoá xô → số lớn nhất còn mang sau khi dọn
  const xoCanXet = new Map<string, { prefix: string; year: number }>();
  const ghiNhan = (ma: string | null, mangSo: boolean) => {
    const m = ma ? KHUON_MA.exec(ma) : null;
    if (!m || !tienToNguoiDung.has(m[1])) return;
    const year = 2000 + Number(m[2]);
    const k = khoaXo(m[1], year);
    xoCanXet.set(k, { prefix: m[1], year });
    if (mangSo) conLai.set(k, Math.max(conLai.get(k) ?? 0, Number(m[3])));
  };
  const theoIdBg = new Map(baoGia.map((b) => [b.id, b]));
  for (const q of qs) {
    ghiNhan(q.projectCode, false);
    const b = theoIdBg.get(q.id);
    ghiNhan(b ? b.maMoi : q.projectCode, true);
  }
  for (const [k, n] of lonNhatXo) conLai.set(k, Math.max(conLai.get(k) ?? 0, n));
  const demHienTai = await db.$queryRaw<{ prefix: string; year: number; value: number }[]>`
    SELECT prefix, year, value FROM "QuoteCounter" WHERE year >= 2000`;
  for (const d of demHienTai) if (tienToNguoiDung.has(d.prefix)) xoCanXet.set(khoaXo(d.prefix, d.year), { prefix: d.prefix, year: d.year });
  const demTheoKhoa = new Map(demHienTai.map((d) => [khoaXo(d.prefix, d.year), d.value]));
  const boDem: DongBoDem[] = [];
  for (const [k, { prefix, year }] of [...xoCanXet].sort((a, b) => a[0].localeCompare(b[0]))) {
    const cu = demTheoKhoa.get(k) ?? null;
    const moi = conLai.get(k) ?? 0;
    if (tienToSoBaoGia.has(prefix)) {
      if (cu !== moi) boDem.push({ prefix, year, cu, moi: cu ?? 0, ghiChu: `tiền tố "${prefix}" trùng tiền tố SỐ BÁO GIÁ của công ty — KHÔNG sửa bộ đếm (dùng chung); số mã lớn nhất còn lại là ${moi}` });
      continue;
    }
    if (cu !== moi && !(cu == null && moi === 0)) boDem.push({ prefix, year, cu, moi, ghiChu: null });
  }

  return { baoGia, nhanSu, boDem, nhanSuMoCoi };
}

/** Dòng báo giá có ghi gì không (đổi / gỡ mã, hoặc đổi liên kết gốc — kể cả ở dòng mã "giữ" / "kiểu cũ"). */
const coGhi = (b: DongBaoGia) => b.loai === "doi" || b.loai === "go" || b.gocMoi !== b.gocCu;

/** Kế hoạch có việc để ghi không (bỏ qua dòng chỉ-liệt-kê: giữ / kiểu cũ / ghi chú bộ đếm không sửa). */
export function coViec(kh: KeHoachMaDuAn): boolean {
  return kh.baoGia.some(coGhi)
    || kh.nhanSu.length > 0
    || kh.boDem.some((d) => !d.ghiChu);
}

/**
 * Ghi kế hoạch — MỘT transaction, khoá bảng trước rồi LẬP LẠI kế hoạch bên trong (bản in ở --kiem có thể đã cũ).
 * Trả kế hoạch đã áp dụng.
 */
export async function apDungMaDuAn(opts: PhamViDon & { timeoutMs?: number } = {}): Promise<KeHoachMaDuAn> {
  return prisma.$transaction(async (tx) => {
    // EXCLUSIVE: đọc (SELECT) vẫn chạy, mọi lệnh ghi (kể cả chốt báo giá, lưu hồ sơ nhân sự) chờ tới khi xong.
    await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '15s'`);
    await tx.$executeRawUnsafe(`LOCK TABLE "Quote", "PersonnelRecord", "QuoteCounter" IN EXCLUSIVE MODE`);
    const kh = await keHoachMaDuAn(tx, opts);
    const doi = kh.baoGia.filter((b) => b.loai === "doi");
    const go = kh.baoGia.filter((b) => b.loai === "go");
    const doiGoc = kh.baoGia.filter((b) => b.gocMoi !== b.gocCu);

    // Pha 1: mọi mã sắp đổi → mã TẠM riêng từng báo giá; mã bị gỡ → NULL. Sau pha này không còn mã cũ nào chắn đường.
    for (const b of doi) await tx.$executeRaw`UPDATE "Quote" SET "projectCode" = ${`__DOI__${b.id}`} WHERE id = ${b.id}`;
    for (const b of go) await tx.$executeRaw`UPDATE "Quote" SET "projectCode" = NULL WHERE id = ${b.id}`;
    // Pha 2: mã tạm → mã đích.
    for (const b of doi) await tx.$executeRaw`UPDATE "Quote" SET "projectCode" = ${b.maMoi} WHERE id = ${b.id}`;
    // searchText theo mã mới — đúng công thức createQuote/updateQuote.
    for (const b of [...doi, ...go]) {
      const [q] = await tx.$queryRaw<{ quoteNumber: string; title: string; toCompany: string; toContact: string | null }[]>`
        SELECT "quoteNumber", title, "toCompany", "toContact" FROM "Quote" WHERE id = ${b.id}`;
      const st = normalizeSearch(q.quoteNumber, b.maMoi, q.title, q.toCompany, q.toContact);
      await tx.$executeRaw`UPDATE "Quote" SET "searchText" = ${st} WHERE id = ${b.id}`;
    }
    for (const b of doiGoc) await tx.$executeRaw`UPDATE "Quote" SET "projectRootId" = ${b.gocMoi} WHERE id = ${b.id}`;

    for (const n of kh.nhanSu) {
      const [r] = await tx.$queryRaw<Record<string, any>[]>`
        SELECT "fullName", "projectName", "projectNameContract", "taxCode", phone, "idCard" FROM "PersonnelRecord" WHERE id = ${n.id}`;
      const st = personnelSearchText({ ...r, projectCode: n.maMoi });
      await tx.$executeRaw`UPDATE "PersonnelRecord" SET "projectCode" = ${n.maMoi}, "searchText" = ${st} WHERE id = ${n.id}`;
    }

    for (const d of kh.boDem) {
      if (d.ghiChu) continue;
      await tx.$executeRaw`
        INSERT INTO "QuoteCounter" ("prefix", "year", "value") VALUES (${d.prefix}, ${d.year}, ${d.moi})
        ON CONFLICT ("prefix", "year") DO UPDATE SET "value" = EXCLUDED."value"`;
    }

    // Nhật ký: MỘT dòng cho mỗi báo giá / hồ sơ đổi mã (actorId null = công cụ hệ thống), cùng transaction.
    const nhatKy = [
      ...kh.baoGia.filter(coGhi).map((b) => ({
        action: "quote.ma-du-an.don", resource: "quote", resourceId: String(b.id),
        before: { projectCode: b.maCu, projectRootId: b.gocCu },
        after: { projectCode: b.maMoi, projectRootId: b.gocMoi, viec: b.loai },
      })),
      ...kh.nhanSu.map((n) => ({
        action: "personnel.ma-du-an.don", resource: "personnel", resourceId: String(n.id),
        before: { projectCode: n.maCu }, after: { projectCode: n.maMoi },
      })),
    ];
    if (nhatKy.length) await tx.auditEvent.createMany({ data: nhatKy as any });
    return kh;
  }, { timeout: opts.timeoutMs ?? 300_000, maxWait: 30_000 });
}

// ── IN BẢNG ───────────────────────────────────────────────────────────────────────────────────────────

const TRANG_THAI: Record<string, string> = {
  draft: "Nháp", pending: "Chờ duyệt", approved: "Đã duyệt", rejected: "Bị từ chối", sent: "Đã gửi", converted: "Đã chốt", lost: "Không chốt",
};
const NHAN_LOAI: Record<DongBaoGia["loai"], string> = {
  doi: "ĐÁNH LẠI", go: "GỠ → NHÁP", giu: "giữ", "kieu-cu": "KIỂU CŨ (giữ)", "lien-ket": "liên kết",
};
const nhanMa = (ma: string | null, v: number, quoteNumber: string) =>
  ma ? (v > 1 ? `${ma} (v${v})` : ma) : `NHÁP ${quoteNumber}`;

function bang(tieuDe: string[], hang: string[][]): string[] {
  if (!hang.length) return ["  (không có)"];
  const rong = tieuDe.map((t, i) => Math.max(t.length, ...hang.map((h) => (h[i] ?? "").length)));
  const dong = (h: string[]) => "  " + h.map((c, i) => (c ?? "").padEnd(rong[i])).join(" | ").trimEnd();
  return [dong(tieuDe), "  " + rong.map((n) => "-".repeat(n)).join("-+-"), ...hang.map(dong)];
}

/** Bảng đầy đủ để gửi chủ repo duyệt (--kiem) hoặc in lại sau khi áp dụng (--ap-dung). */
export function inKeHoach(kh: KeHoachMaDuAn): string[] {
  const out: string[] = [];
  const hangBg = (b: DongBaoGia) => [
    String(b.id), (TRANG_THAI[b.status] ?? b.status) + (b.daXoa ? " (đã xoá)" : ""), NHAN_LOAI[b.loai],
    `${b.maCu ? nhanMa(b.maCu, b.phienBan, b.quoteNumber) : "—"} → ${b.loai === "lien-ket" || b.loai === "giu" || b.loai === "kieu-cu" ? "=" : nhanMa(b.maMoi, b.phienBan, b.quoteNumber)}`,
    b.gocMoi !== b.gocCu ? `${b.gocCu ?? "—"} → ${b.gocMoi ?? "—"}` : (b.gocMoi != null ? String(b.gocMoi) : ""),
    cat(b.tieuDe, 40), cat(b.khach, 30), b.canhBao.length ? "⚠ " + b.canhBao.join("; ") : "",
  ];
  const tieuDeBg = ["id", "trạng thái", "việc", "mã cũ → mã mới", "gốc dự án", "tiêu đề", "khách", "cảnh báo"];
  const nhom: [string, DongBaoGia["loai"][]][] = [
    ["ĐÃ CHỐT — đánh lại liền số theo (tiền tố, năm), giữ thứ tự số cũ", ["doi", "giu"]],
    ["CHƯA CHỐT / ĐÃ XOÁ — gỡ mã, hiện NHÁP <số báo giá>", ["go"]],
    ["MÃ KIỂU CŨ (không theo tiền tố người tạo) — KHÔNG tự đánh lại, chủ repo quyết", ["kieu-cu"]],
    ["CHỈ ĐỔI LIÊN KẾT PHIÊN BẢN (gốc dự án)", ["lien-ket"]],
  ];
  for (const [ten, loai] of nhom) {
    const ds = kh.baoGia.filter((b) => loai.includes(b.loai));
    out.push("", `■ ${ten}: ${ds.length}`, ...bang(tieuDeBg, ds.map(hangBg)));
  }
  out.push("", `■ HỒ SƠ NHÂN SỰ đổi mã sản xuất theo: ${kh.nhanSu.length}`,
    ...bang(["id", "họ tên", "mã cũ → mã mới"], kh.nhanSu.map((n) => [String(n.id), cat(n.hoTen, 30), `${n.maCu} → ${n.maMoi}`])));
  if (kh.nhanSuMoCoi.length) {
    out.push("", `■ HỒ SƠ NHÂN SỰ trỏ vào mã vừa GỠ (báo giá chưa chốt — vốn đã không tra được hợp đồng): ${kh.nhanSuMoCoi.length}`,
      ...bang(["id", "họ tên", "mã"], kh.nhanSuMoCoi.map((n) => [String(n.id), cat(n.hoTen, 30), n.ma])));
  }
  out.push("", `■ BỘ ĐẾM mã dự án (tiền tố, năm): ${kh.boDem.length}`,
    ...bang(["tiền tố", "năm", "cũ → mới", "ghi chú"], kh.boDem.map((d) => [d.prefix, String(d.year), `${d.cu ?? "—"} → ${d.moi}`, d.ghiChu ?? ""])));
  const dem = (l: DongBaoGia["loai"]) => kh.baoGia.filter((b) => b.loai === l).length;
  const canhBao = kh.baoGia.filter((b) => b.canhBao.length).length;
  out.push("", `TÓM TẮT: ${dem("doi")} đánh lại · ${dem("giu")} giữ · ${dem("go")} gỡ → NHÁP · ${dem("kieu-cu")} kiểu cũ · ` +
    `${dem("lien-ket")} chỉ liên kết · ${kh.nhanSu.length} hồ sơ nhân sự · ${kh.boDem.filter((d) => !d.ghiChu).length} bộ đếm · ` +
    `${canhBao} báo giá có CẢNH BÁO chứng từ`);
  return out;
}
