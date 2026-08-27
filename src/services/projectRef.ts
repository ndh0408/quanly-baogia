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
 * Chặn bằng cách NẠP THEO LÔ SHEET (xem `LO_SHEET` ở buildProjectRef), KHÔNG bằng `take` cắt cụt:
 * cắt cụt thì sheet rơi ra ngoài vết cắt mất số tiền, và việc một hàng có số hay không phụ thuộc
 * các hàng khác cùng trang. Nạp theo lô giữ được cả hai: mọi sheet tính đủ, bộ nhớ vẫn O(một lô).

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
    // ── NẠP THEO LÔ SHEET, KHÔNG CẮT CỤT MỘT TRUY VẤN ──────────────────────────────────────────
    //
    // Bản trước dùng MỘT `findMany` kèm `take: MAX_TINH_LAI_ITEMS + 1` rồi BỎ HẲN sheet bị cắt dở.
    // Nó không cho ra số sai — nhưng nó biến một con số TIỀN ĐÚNG thành 0 đ ở cột "Tiền trước thuế"
    // trang Nhân sự, và tệ hơn: một hàng có hiện được số hay không phụ thuộc vào CÁC HÀNG KHÁC
    // cùng trang (sheet nào rơi ra ngoài vết cắt là do tổng số dòng của những sheet đứng trước).
    // Người dùng thấy 0 đ ở đúng hàng mà hôm qua còn có số, chỉ vì thêm một dự án khác vào trang.
    // Trước bản vá đó thì mọi sheet đều được tính ĐÚNG (truy vấn không có `take`) — cái phải giữ là
    // tính đúng, cái phải thêm là chặn bộ nhớ, và hai thứ đó không xung khắc.
    //
    // Chia theo SHEET chứ không theo DÒNG: mỗi lô là một tập sheet TRỌN VẸN, nên trong lô nào cũng
    // không có sheet nào bị nạp thiếu — không còn khái niệm "vết cắt giữa sheet" để phải xử lý.
    // Trần bộ nhớ: LO_SHEET × 1000 dòng (trần dòng mỗi trang, src/validators.ts) = 25 000 hàng
    // hẹp cho mỗi lượt, thay vì 500 000 của trường hợp tệ nhất khi không có trần nào.
    const LO_SHEET = 25;
    const dsSheet = [...canTinhLai];
    for (let k = 0; k < dsSheet.length; k += LO_SHEET) {
      const lo = dsSheet.slice(k, k + LO_SHEET);
      const items = await prisma.quoteItem.findMany({
        where: { sheetId: { in: lo } },
        // THỨ TỰ QUAN TRỌNG: dòng "section" đặt hệ số nhóm cho các dòng ĐỨNG SAU nó trong cùng sheet.
        orderBy: [{ sheetId: "asc" }, { order: "asc" }],
        select: { sheetId: true, kind: true, quantity: true, quantityExact: true, unitPrice: true, days: true },
      });
      const theoSheet = new Map<number, any[]>();
      // Gieo TRỌN tập sheet của lô: sheet không có dòng nào vẫn phải ra 0 một cách tường minh,
      // chứ không phải vắng mặt rồi rơi về giá trị cột.
      for (const id of lo) theoSheet.set(id, []);
      for (const it of items) theoSheet.get(it.sheetId)!.push(it);
      const gs = new Map<number, boolean>();
      for (const { sh } of cho) if (theoSheet.has(sh.id)) gs.set(sh.id, !!sh.groupSubtotal);
      // vatPercent 0: chỉ cần sheetTotals (tiền TRƯỚC thuế), không dùng vat/total.
      const totals = computeQuoteTotals({
        vatPercent: 0,
        sheets: [...theoSheet].map(([id, its]) => ({ id, groupSubtotal: gs.get(id) ?? false, items: its })),
      });
      for (const t of totals.sheetTotals) tinhLai.set(t.sheetId, Number(t.subtotal.toString()) || 0);
    }
    if (dsSheet.length > LO_SHEET) {
      logger.warn(
        { soSheet: dsSheet.length, soLo: Math.ceil(dsSheet.length / LO_SHEET) },
        "buildProjectRef: phải tính lại subtotal cho nhiều sheet — chạy prisma/backfill-sheet-subtotal.mjs để khỏi phải tính lại mỗi lượt mở trang"
      );
    }
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
