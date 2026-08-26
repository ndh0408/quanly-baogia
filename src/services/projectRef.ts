// Tra cứu dữ liệu HỢP ĐỒNG/THANH TOÁN cho bảng Nhân sự — các cột HỒNG (tham chiếu) được
// LẤY TỪ module Dự án (báo giá ĐÃ CHỐT) theo "mã sản xuất", KHÔNG nhập tay, KHÔNG lưu.
//
// "Mã sản xuất" được dựng GIỐNG HỆT trang Quản lý dự án:
//   base = projectCode || quoteNumber  (+ "_v{N}" nếu projectVersion > 1)   [public/app.js codeLabel]
//   nếu báo giá nhiều sheet → mỗi sheet thêm hậu tố "_{i+1}"                  [admin.js renderProjects]
// Khớp ĐÚNG 1 mã sản xuất (gồm hậu tố). Không khớp → không có entry → UI hiện "—" (giống #N/A trong Excel).
import { prisma } from "../db.js";
import { logger } from "../logger.js";
import { computeQuoteTotals } from "../money.js";

/** Dựng "base" mã dự án y như client codeLabel() để mã sản xuất khớp tuyệt đối. */
export function codeLabel(q: { projectCode?: string | null; quoteNumber?: string | null; projectVersion?: number | null }): string {
  const c = q.projectCode || q.quoteNumber || "";
  return q.projectVersion && q.projectVersion > 1 ? `${c}_v${q.projectVersion}` : c;
}

export type ProjectRef = {
  salesContractNo: string | null;     // Số HĐ bán    ← QuoteSheet.invoiceNo
  salesContractDate: Date | null;     // Ngày HĐ bán  ← QuoteSheet.signedAt
  purchaseOrder: string | null;       // Đơn đặt hàng ← QuoteSheet.poNumber
  preTaxAmount: number | null;        // Tiền trước thuế ← subtotal theo sheet
  // (Thanh toán KHÔNG còn suy từ dự án — nay là hành động của KẾ TOÁN trên từng hồ sơ: PersonnelRecord.paidAt)
};

/**
 * TRẦN SỐ DÒNG nạp trong MỘT lượt tính lại (đường lùi cho sheet chưa backfill cột `subtotal`).
 *
 * Vì sao phải có: truy vấn đường lùi trước đây không có `take`, mà điều kiện vào đường lùi là MẶC
 * ĐỊNH trên CSDL chưa chạy prisma/backfill-sheet-subtotal.mjs (script đó không được nối vào
 * package.json lẫn deploy.sh, và báo giá "converted" là bất biến nên cột 0 ở lại vĩnh viễn).
 *
 * Quy mô tệ nhất, tính theo chính các trần đang có trong mã (KHÔNG phải phỏng đoán): số sheet vào
 * đường lùi = số dòng một trang Nhân sự, tới MAX_PAGE_SIZE = 500 (src/config.ts) — mỗi sheet tới
 * 1000 dòng (src/validators.ts) = 500 000 hàng cho MỘT lượt mở trang.
 *
 * 50 000 là trần AN TOÀN, CHƯA ĐO được kích thước hàng thật: nó phủ trọn 50 sheet đầy kín (cỡ báo
 * giá lớn nhất mô tả trong mã: 50 trang × 500-1000 dòng) và vẫn giữ lượt nạp ở mức hàng chục MB.
 */
export const MAX_TINH_LAI_ITEMS = 50_000;

/**
 * Trả về Map[mã sản xuất → dữ liệu tham chiếu] cho TẬP mã đang cần (các projectCode ở trang hiện tại).
 * Truy vấn hẹp: chỉ lấy báo giá đã chốt có projectCode/quoteNumber khớp ứng viên (đã bỏ hậu tố _sheet/_vN).
 */
export async function buildProjectRef(codes: Array<string | null | undefined>): Promise<Map<string, ProjectRef>> {
  const wanted = new Set<string>();
  for (const raw of codes) {
    const c = (raw ?? "").toString().trim();
    if (c) wanted.add(c);
  }
  const out = new Map<string, ProjectRef>();
  if (!wanted.size) return out;

  // Ứng viên để truy vấn hẹp: mã đầy đủ + bỏ hậu tố sheet (_1/_2) + bỏ version (_vN).
  const candidates = new Set<string>();
  for (const c of wanted) {
    candidates.add(c);
    const noSheet = c.replace(/_\d+$/, "");
    candidates.add(noSheet);
    candidates.add(noSheet.replace(/_v\d+$/, ""));
    candidates.add(c.replace(/_v\d+$/, ""));
  }
  const arr = [...candidates];

  const quotes = await prisma.quote.findMany({
    where: { status: "converted", deletedAt: null, OR: [{ projectCode: { in: arr } }, { quoteNumber: { in: arr } }] },
    take: 1000,
    select: {
      quoteNumber: true, projectCode: true, projectVersion: true, subtotal: true,
      sheets: {
        orderBy: { order: "asc" },
        select: {
          id: true, order: true, name: true,
          signedAt: true, invoiceNo: true, paidAt: true, poNumber: true,
          // subtotal materialized lúc save (= computeQuoteTotals.sheetTotals) → đường NHANH: đọc
          // thẳng cột, KHÔNG kéo items. Cùng nguồn số với trang Quản lý dự án (listProjects), nên
          // hai trang không hiện hai con số khác nhau cho cùng một mã sản xuất.
          subtotal: true,
          // groupSubtotal chỉ dùng cho ĐƯỜNG LÙI bên dưới (hệ số nhóm khi tính lại từ items).
          groupSubtotal: true,
        },
      },
    },
  });

  // ── Bước 1: chọn ra ĐÚNG các (mã sản xuất → sheet) đang cần, ghi nhận sheet phải tính lại ────
  type Cho = { code: string; quoteSubtotal: unknown; sh: any };
  const cho: Cho[] = [];
  const canTinhLai = new Set<number>();
  for (const q of quotes) {
    const base = codeLabel(q);
    // Báo giá không có sheet → coi như 1 dòng dùng subtotal tổng (giống admin.js fallback).
    const sheets = q.sheets.length ? q.sheets : [{ id: -1, subtotal: null, groupSubtotal: false, poNumber: null, invoiceNo: null, signedAt: null, paidAt: null } as any];
    const multi = sheets.length > 1;
    sheets.forEach((sh: any, i: number) => {
      const code = base + (multi ? `_${i + 1}` : "");
      if (!wanted.has(code)) return; // chỉ giữ mã đang cần — khớp đúng 1 mã sản xuất
      cho.push({ code, quoteSubtotal: q.subtotal, sh });
      // Cột `QuoteSheet.subtotal` được thêm bởi migration 20260625000003 với NOT NULL DEFAULT 0 ⇒
      // MỌI sheet lưu TRƯỚC ngày đó mang 0 cho tới khi chạy prisma/backfill-sheet-subtotal.mjs.
      // buildProjectRef chỉ đọc báo giá "converted", mà converted là BẤT BIẾN (canEdit trả false)
      // nên nhóm dữ liệu đó KHÔNG BAO GIỜ được lưu lại để cột được ghi — tin cột là hiện 0 đ vĩnh
      // viễn ở cột TIỀN trang Nhân sự. Vì vậy 0 KHÔNG được coi là số đã biết: kéo items của RIÊNG
      // sheet đó và tính lại. Sheet rỗng thật sự cũng ra 0 nên đường lùi không thể làm sai số đúng.
      if (sh.id > 0 && !(Number(sh.subtotal) > 0)) canTinhLai.add(sh.id);
    });
  }

  // ── Bước 2: ĐƯỜNG LÙI — tính lại subtotal cho các sheet có cột = 0 ───────────────────────────
  // Dùng CHÍNH computeQuoteTotals (src/money.ts) — đúng hàm mà cột subtotal được ghi ra từ đó —
  // để số tính lại không thể lệch khỏi số mà lần save tới sẽ ghi vào cột.
  const tinhLai = new Map<number, number>();
  if (canTinhLai.size) {
    const items = await prisma.quoteItem.findMany({
      where: { sheetId: { in: [...canTinhLai] } },
      // THỨ TỰ QUAN TRỌNG: dòng "section" đặt hệ số nhóm cho các dòng ĐỨNG SAU nó trong cùng sheet.
      // Thứ tự này còn là thứ mà việc cắt-cụt bên dưới dựa vào: các dòng của một sheet nằm liền
      // nhau, nên chỉ ĐÚNG MỘT sheet (sheet cuối) có thể bị nạp thiếu.
      orderBy: [{ sheetId: "asc" }, { order: "asc" }],
      select: { sheetId: true, kind: true, quantity: true, quantityExact: true, unitPrice: true, days: true },
      // +1 để PHÂN BIỆT "vừa đủ" với "còn nữa" mà không phải đếm trước bằng một truy vấn thứ hai.
      take: MAX_TINH_LAI_ITEMS + 1,
    });
    // ── Chạm trần: BỎ HẲN sheet nạp thiếu, không gán cho nó một con số sai ──────────────────────
    // Tính tổng trên phần đã nạp là ra một số TIỀN THIẾU DÒNG. Đó tệ hơn hẳn số 0 cũ: 0 nhìn là
    // biết "chưa có dữ liệu", còn một con số thiếu thì không ai nhận ra. Bỏ sheet đó ra thì nó rơi
    // về đúng giá trị cột (0) như trước bản vá — xấu, nhưng KHÔNG SAI.
    let dung = items;
    const dongBiCat = items[MAX_TINH_LAI_ITEMS]; // dòng ĐẦU TIÊN nằm ngoài trần (undefined = không chạm trần)
    if (dongBiCat) {
      dung = items.slice(0, MAX_TINH_LAI_ITEMS);
      const sheetCuoi = dung[dung.length - 1]?.sheetId;
      // CHỈ bỏ khi vết cắt rơi vào GIỮA một sheet. Nếu nó rơi đúng ranh giới hai sheet thì sheet
      // cuối trong `dung` đã nạp ĐỦ — bỏ nó đi là tự vứt một con số đúng.
      if (sheetCuoi != null && sheetCuoi === dongBiCat.sheetId) dung = dung.filter((it) => it.sheetId !== sheetCuoi);
      logger.warn(
        { tran: MAX_TINH_LAI_ITEMS, soSheet: canTinhLai.size, sheetCatDo: dongBiCat.sheetId },
        "buildProjectRef: chạm trần nạp QuoteItem — chạy prisma/backfill-sheet-subtotal.mjs để khỏi phải tính lại"
      );
    }
    const theoSheet = new Map<number, any[]>();
    // CHỈ gieo những sheet THẬT SỰ nạp đủ: sheet vắng mặt ở đây sẽ không có mục trong `tinhLai`,
    // nên bước 3 dùng lại giá trị cột thay vì một tổng dựng từ dữ liệu thiếu.
    for (const it of dung) if (!theoSheet.has(it.sheetId)) theoSheet.set(it.sheetId, []);
    for (const it of dung) theoSheet.get(it.sheetId)!.push(it);
    const gs = new Map<number, boolean>();
    for (const { sh } of cho) if (canTinhLai.has(sh.id)) gs.set(sh.id, !!sh.groupSubtotal);
    // vatPercent 0: chỉ cần sheetTotals (tiền TRƯỚC thuế), không dùng vat/total.
    const totals = computeQuoteTotals({
      vatPercent: 0,
      sheets: [...theoSheet].map(([id, its]) => ({ id, groupSubtotal: gs.get(id) ?? false, items: its })),
    });
    for (const t of totals.sheetTotals) tinhLai.set(t.sheetId, Number(t.subtotal.toString()) || 0);
  }

  // ── Bước 3: dựng kết quả ─────────────────────────────────────────────────────────────────────
  for (const { code, quoteSubtotal, sh } of cho) {
    // `|| 0` (không phải ??): Number() trả NaN chứ không bao giờ nullish — subtotal thiếu/hỏng phải về 0.
    const cot = sh.subtotal != null ? (Number(sh.subtotal) || 0) : (Number(quoteSubtotal) || 0);
    const baoGia = cot > 0 ? cot : (tinhLai.get(sh.id) ?? cot);
    out.set(code, {
      salesContractNo: sh.invoiceNo ?? null,
      salesContractDate: sh.signedAt ?? null,
      purchaseOrder: sh.poNumber ?? null,
      preTaxAmount: baoGia,
    });
  }
  return out;
}

/** Công thức thuế (chốt với chủ dự án): Thuế TNCN = Lương/9; Thu nhập chịu thuế = Lương×10/9. */
export function computeTax(salary: number | null | undefined): { pit: number | null; taxableIncome: number | null } {
  const s = salary == null ? null : Number(salary);
  if (s == null || !isFinite(s)) return { pit: null, taxableIncome: null };
  const pit = Math.round(s / 9);
  return { pit, taxableIncome: s + pit };
}
