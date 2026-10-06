import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type Me, type ProjectQuote } from "../lib/api";
import { toast, confirmModal } from "../lib/ui";
import { fmtMoney, fmtDate, toInputDate, tieuDeHienThi, dash, Stat } from "../lib/format";
import { smartTextMatch } from "../lib/filterText";
import { nhomHoaDon, tienCoVat } from "../lib/hoaDonChia";
import { HopChiaHoaDon } from "../components/HopChiaHoaDon";

// Trang HÓA ĐƠN (kế toán) — thay bảng Excel theo dõi hóa đơn. CÙNG NGUỒN dữ liệu với Quản lý dự án
// (QuoteSheet): kế toán NHẬP ở đây → trang Dự án THAM CHIẾU (read-only). Mỗi sheet đã chốt = 1 dòng.
// - Tình trạng HĐ: TỰ ĐỘNG "Hoàn tất" khi có Số HĐơn + Ngày HĐơn (không nhập tay).
// - Kế toán nhập: Hạng mục, PO/HĐ, CTy (GN/SM/CLF), Số HĐơn, Ngày HĐơn, Hình thức TT, Ngày đóng ĐH,
//   Link HĐ, Ngày thanh toán (quyền invoice:pay riêng), Chứng từ gửi/trả, Năm, Note.
// - Tự động: Khách hàng, Mã KH, Mã sản xuất, Số tiền (thành tiền VAT), Acc (người tạo — suy từ MSX),
//   Công nợ (số ngày từ Ngày HĐơn khi chưa thanh toán — ĐỎ nếu quá HẠN CÔNG NỢ RIÊNG của khách
//   (đặt ở trang Mã khách hàng); khách chưa đặt thì dùng ngưỡng mặc định chỉnh được ở toolbar),
//   Ký chứng từ (tham chiếu từ trang Quản lý dự án — hiện AI ký + ngày ký).
// - Mọi ô nhập tay CHƯA điền tô HỒNG; có dữ liệu thì tự trở lại nền trắng.
// - CHIA HÓA ĐƠN (2026-10-06, lib/hoaDonChia + components/HopChiaHoaDon): kế toán gom sheet thành Hóa đơn 1, 2… (mã
//   _01/_02), Để sau, Không xuất. Chưa chia = mỗi sheet một dòng như trước. Hóa đơn gom nhiều sheet là MỘT dòng; ô nhập
//   ghi qua sheet đầu và máy chủ chép đồng loạt sang các sheet còn lại của hóa đơn.

const HEADERS = ["Khách hàng", "Mã KH", "Mã sản xuất", "Hạng mục", "Tình trạng HĐ", "PO/HĐ", "CTy", "Số HĐơn", "Ngày HĐơn", "Số tiền", "Công nợ", "Hình thức TT", "Ngày đóng ĐH", "Acc", "Link HĐ", "Ngày thanh toán", "Chứng từ gửi đi", "Chứng từ trả về", "Ký chứng từ", "Năm", "Note"];
const COMPANIES = ["GN", "SM", "CLF"];
const PAY_METHODS = ["CK", "TM"];
const DEBT_DEFAULT = 30;   // hạn công nợ (ngày) cho khách CHƯA đặt hạn riêng ở trang Mã khách hàng

// Cột sort được (kế toán cần sắp theo ngày/tiền/nợ để đòi nợ) + cột SỐ (căn phải, tabular-nums qua .num).
type SortKey = "invoiceDate" | "amount" | "debt";
const SORT_COLS: Record<string, SortKey> = { "Ngày HĐơn": "invoiceDate", "Số tiền": "amount", "Công nợ": "debt" };
const NUM_COLS = new Set(["Số tiền", "Công nợ"]);

// Nhãn cột cho aria-label từng ô nhập trong bảng (screen reader): vd "Số HĐơn — GN2607_2".
const FIELD_LABEL: Record<string, string> = {
  invoiceDesc: "Hạng mục", poNumber: "PO/HĐ", invoiceCompany: "CTy", invoiceNo: "Số HĐơn",
  invoiceDate: "Ngày HĐơn", paymentMethod: "Hình thức TT", orderClosedAt: "Ngày đóng ĐH",
  invoiceLink: "Link HĐ", paidAt: "Ngày thanh toán", docSentAt: "Chứng từ gửi đi",
  docReturnedAt: "Chứng từ trả về", invoiceYear: "Năm", invoiceNote: "Note",
};

// Field kế toán lưu qua saveField + field kiểu NGÀY (chuẩn hoá về yyyy-mm-dd như input khi so sánh).
const SAVE_FIELDS = ["invoiceDesc", "poNumber", "invoiceCompany", "invoiceNo", "invoiceDate", "paymentMethod", "orderClosedAt", "invoiceLink", "paidAt", "docSentAt", "docReturnedAt", "invoiceYear", "invoiceNote"] as const;
const DATE_FIELDS = new Set(["invoiceDate", "orderClosedAt", "paidAt", "docSentAt", "docReturnedAt"]);
type StatusFilter = "" | "complete" | "incomplete";
type CollectionFilter = "" | "paid" | "unpaid" | "dueSoon" | "overdue";
type MissingFilter = "" | "any" | "invoiceDesc" | "poNumber" | "invoiceNo" | "invoiceDate" | "paymentMethod" | "orderClosedAt" | "invoiceLink" | "paidAt" | "docSentAt" | "docReturnedAt" | "signedAt" | "invoiceYear" | "invoiceNote";

type Row = {
  key: string; q: ProjectQuote; code: string; sheetId: number | null; amount: number;
  sheetNames: string[];   // tên các sheet của hóa đơn — "Hạng mục" gợi ý khi kế toán chưa gõ
  invoiceDesc: string | null; poNumber: string | null; invoiceCompany: string | null;
  invoiceNo: string | null; invoiceDate: string | null; paymentMethod: string | null;
  orderClosedAt: string | null; invoiceLink: string | null; paidAt: string | null;
  docSentAt: string | null; docReturnedAt: string | null; invoiceYear: number | null; invoiceNote: string | null;
  signedAt: string | null; signedByName: string | null;   // Ký chứng từ — hành động ở trang Quản lý dự án
};

export function buildRows(quotes: ProjectQuote[]): Row[] {
  const out: Row[] = [];
  for (const q of quotes) {
    if (q.status !== "converted") continue;   // hóa đơn chỉ theo dự án ĐÃ CHỐT
    // FE-09: trang khách không duyệt bị loại trong nhomHoaDon — mã sản xuất các trang còn lại vẫn theo `i` gốc.
    const { chia, hoaDon } = nhomHoaDon(q);
    hoaDon.forEach((hd) => {
      // Trường hóa đơn đọc từ sheet ĐẦU của hóa đơn — máy chủ giữ mọi sheet cùng hóa đơn mang cùng giá trị.
      const { sh, i } = hd.sheets[0];
      // Ký chứng từ vẫn theo sheet (trang Quản lý dự án): hóa đơn gom nhiều sheet chỉ "đã ký" khi MỌI sheet đã ký.
      const kyHet = hd.sheets.every((x) => !!x.sh.signedAt);
      out.push({
        key: chia ? `${q.id}-hd${hd.so}` : `${q.id}-${i}`, q, code: hd.code, sheetId: sh.id || null,
        amount: hd.amount, sheetNames: hd.sheets.map((x) => x.sh.name || `Sheet ${x.i + 1}`),
        invoiceDesc: sh.invoiceDesc || null, poNumber: sh.poNumber || null,
        invoiceCompany: sh.invoiceCompany || null, invoiceNo: sh.invoiceNo || null,
        invoiceDate: sh.invoiceDate || null, paymentMethod: sh.paymentMethod || null,
        orderClosedAt: sh.orderClosedAt || null, invoiceLink: sh.invoiceLink || null,
        paidAt: sh.paidAt || null, docSentAt: sh.docSentAt || null, docReturnedAt: sh.docReturnedAt || null,
        invoiceYear: sh.invoiceYear ?? null, invoiceNote: sh.invoiceNote || null,
        signedAt: kyHet ? sh.signedAt || null : null, signedByName: kyHet ? sh.signedByName || null : null,
      });
    });
  }
  return out;
}

/** Sheet Để sau / Không xuất của các báo giá đã chốt — nhóm riêng dưới bảng hóa đơn để kế toán biết còn phải xuất. */
export type HeldRow = { key: string; q: ProjectQuote; code: string; name: string; amount: number; hold: "later" | "skip" };
export function buildHeld(quotes: ProjectQuote[]): HeldRow[] {
  const out: HeldRow[] = [];
  for (const q of quotes) {
    if (q.status !== "converted") continue;
    const { deSau, khongXuat } = nhomHoaDon(q);
    const day = (ds: typeof deSau, hold: "later" | "skip") => ds.forEach((x) => out.push({
      key: `${q.id}-${hold}-${x.i}`, q, code: x.code, name: x.sh.name || `Sheet ${x.i + 1}`,
      amount: tienCoVat(Number(x.sh.subtotal) || 0, q.vatPercent), hold,
    }));
    day(deSau, "later"); day(khongXuat, "skip");
  }
  return out;
}

// Giá trị "đã lưu trên server" chuẩn hoá để so sánh trước khi gọi API (ngày → yyyy-mm-dd giống input).
const savedVal = (r: Row, f: string): string | null => {
  const v = r[f as keyof Row];
  if (v == null || v === "") return null;
  return DATE_FIELDS.has(f) ? (toInputDate(String(v)) || null) : String(v);
};

// Mặc định CTy theo công ty của báo giá (Gia Nguyễn → GN, Colorfull → CLF) khi kế toán chưa chọn.
const defaultCty = (q: ProjectQuote) => {
  const s = (q.company?.shortName || q.company?.name || "").toLowerCase();
  if (s.includes("color") || s.includes("clf")) return "CLF";
  return "GN";
};

// Công nợ = số ngày từ Ngày HĐơn đến hôm nay khi CHƯA thanh toán (đã thanh toán/chưa xuất HĐ → không nợ).
const debtDays = (r: Row): number | null => {
  if (!r.invoiceDate || r.paidAt) return null;
  const d = new Date(r.invoiceDate); if (isNaN(d.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
};

const hasValue = (v: unknown) => v != null && String(v).trim() !== "";
const rowLimit = (r: Row) => r.q.customerDebtDays ?? DEBT_DEFAULT;
const isOverdue = (r: Row) => { const days = debtDays(r); return days != null && days > rowLimit(r); };
const isDueSoon = (r: Row) => {
  const days = debtDays(r);
  const limit = rowLimit(r);
  return days != null && days <= limit && days >= Math.max(0, limit - 7);
};
const missingFields = (r: Row): MissingFilter[] => [
  "invoiceDesc", "poNumber", "invoiceNo", "invoiceDate", "paymentMethod", "orderClosedAt",
  "invoiceLink", "paidAt", "docSentAt", "docReturnedAt", "signedAt", "invoiceYear", "invoiceNote",
].filter((field) => !hasValue(r[field as keyof Row])) as MissingFilter[];

export function InvoicesPage({ me }: { me: Me }) {
  const canEdit = me.permissions.includes("invoice:edit");
  const canPay = me.permissions.includes("invoice:pay");
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [year, setYear] = useState("");
  const [month, setMonth] = useState("");   // lọc theo THÁNG của Ngày HĐơn
  const [cty, setCty] = useState("");
  const [status, setStatus] = useState<StatusFilter>("");
  const [collection, setCollection] = useState<CollectionFilter>("");
  const [missing, setMissing] = useState<MissingFilter>("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  // Hạn công nợ đặt RIÊNG TỪNG CÔNG TY ở trang Mã khách hàng (nút Sửa) — khách chưa đặt
  // thì dùng mặc định cố định 30 ngày. (2026-07-16: bỏ ô chỉnh "mặc định" trên toolbar theo
  // yêu cầu — thừa khi đã có hạn riêng từng khách.)

  const { data, isPending, error } = useQuery({ queryKey: ["quoteProjects"], queryFn: api.quoteProjects });
  const [rows, setRows] = useState<Row[]>([]);
  // Snapshot giá trị ĐÃ LƯU từng ô (key:field) — để saveField bỏ qua khi giá trị không đổi.
  const savedRef = useRef<Record<string, string | null>>({});
  useEffect(() => {
    if (!data) return;
    const built = buildRows(data.data || []);
    const snap: Record<string, string | null> = {};
    for (const r of built) for (const f of SAVE_FIELDS) snap[`${r.key}:${f}`] = savedVal(r, f);
    savedRef.current = snap;
    // Đang gõ dở trong bảng (input/select focus trong .inv-table) → BỎ QUA, không ghi đè ô đang nhập
    // (refetch sau khi lưu ô khác sẽ reset controlled input về giá trị server → mất chữ đang gõ).
    const ae = document.activeElement;
    if (ae instanceof HTMLElement && (ae.tagName === "INPUT" || ae.tagName === "SELECT") && ae.closest(".inv-table")) return;
    setRows(built);
  }, [data]);
  const err = error ? (error instanceof ApiError ? error.message : "Lỗi tải dữ liệu") : "";
  const held = useMemo(() => buildHeld(data?.data || []), [data]);
  const [hienKhongXuat, setHienKhongXuat] = useState(false);
  const [chiaQ, setChiaQ] = useState<ProjectQuote | null>(null);   // báo giá đang mở hộp Chia hóa đơn
  const load = () => { qc.invalidateQueries({ queryKey: ["quoteProjects"] }); };

  const years = useMemo(() => [...new Set(rows.map((r) => r.invoiceYear || (r.invoiceDate ? new Date(r.invoiceDate).getFullYear() : null)).filter(Boolean))].sort() as number[], [rows]);
  // Lọc NGỮ CẢNH trước (tìm kiếm/pháp nhân/thời gian). Số lượng trên nút lọc nhanh tính từ tập này,
  // nên vẫn đúng khi người dùng đang xem riêng một công ty hoặc một khoảng ngày.
  const contextRows = rows.filter((r) => {
    const inputDate = toInputDate(r.invoiceDate);
    const done = !!(r.invoiceNo && r.invoiceDate);
    if (year && String(r.invoiceYear || (r.invoiceDate ? new Date(r.invoiceDate).getFullYear() : "")) !== year) return false;
    if (month && String(r.invoiceDate ? new Date(r.invoiceDate).getMonth() + 1 : "") !== month) return false;
    if (dateFrom && (!inputDate || inputDate < dateFrom)) return false;
    if (dateTo && (!inputDate || inputDate > dateTo)) return false;
    if (cty && (r.invoiceCompany || defaultCty(r.q)) !== cty) return false;
    if (!smartTextMatch(q, [
      r.q.customerName, r.q.customerCode, r.q.title, r.code, r.invoiceDesc, r.invoiceNo, r.poNumber,
      r.invoiceCompany || defaultCty(r.q), r.paymentMethod, r.invoiceNote, r.q.createdBy?.displayName,
      r.signedByName, r.amount, fmtMoney(r.amount), r.invoiceDate, fmtDate(r.invoiceDate),
      done ? "hoàn tất" : "chưa đủ", r.paidAt ? "đã thu đã thanh toán" : "chưa thu chưa thanh toán",
      isOverdue(r) ? "quá hạn nợ quá hạn" : "", isDueSoon(r) ? "sắp đến hạn sap den han" : "",
    ])) return false;
    return true;
  });
  // Sau đó mới áp điều kiện NGHIỆP VỤ; các nhóm độc lập để có thể kết hợp, vd CTy=GN + Chưa thu + Chưa ký.
  const shown = contextRows.filter((r) => {
    const done = !!(r.invoiceNo && r.invoiceDate);
    if (status === "complete" && !done) return false;
    if (status === "incomplete" && done) return false;
    if (collection === "paid" && !r.paidAt) return false;
    if (collection === "unpaid" && r.paidAt) return false;
    if (collection === "dueSoon" && !isDueSoon(r)) return false;
    if (collection === "overdue" && !isOverdue(r)) return false;
    if (missing === "any" && missingFields(r).length === 0) return false;
    if (missing && missing !== "any" && !missingFields(r).includes(missing)) return false;
    return true;
  });
  const quickCounts = {
    incomplete: contextRows.filter((r) => !(r.invoiceNo && r.invoiceDate)).length,
    unpaid: contextRows.filter((r) => !r.paidAt).length,
    dueSoon: contextRows.filter(isDueSoon).length,
    overdue: contextRows.filter(isOverdue).length,
    missing: contextRows.filter((r) => missingFields(r).length > 0).length,
    unsigned: contextRows.filter((r) => !r.signedAt).length,
    paid: contextRows.filter((r) => !!r.paidAt).length,
  };
  const activeFilterCount = [q.trim(), cty, year, month, status, collection, missing, dateFrom, dateTo].filter(Boolean).length;
  const clearFilters = () => {
    setQ(""); setCty(""); setYear(""); setMonth(""); setStatus(""); setCollection(""); setMissing(""); setDateFrom(""); setDateTo("");
  };

  // Sort client 3 cột chính (Ngày HĐơn / Số tiền / Công nợ) — pattern th.sortable + aria-sort như trang Mã khách hàng.
  const [sortKey, setSortKey] = useState<SortKey | "">("");
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  const toggleSort = (k: SortKey) => { if (sortKey === k) setSortDir((d) => (d === 1 ? -1 : 1)); else { setSortKey(k); setSortDir(1); } };
  const sortVal = (r: Row, k: SortKey): number | null => {
    if (k === "amount") return r.amount;
    if (k === "invoiceDate") { if (!r.invoiceDate) return null; const t = new Date(r.invoiceDate).getTime(); return isNaN(t) ? null : t; }
    return debtDays(r);
  };
  const sorted = sortKey
    ? [...shown].sort((a, b) => {
        const va = sortVal(a, sortKey), vb = sortVal(b, sortKey);
        if (va == null && vb == null) return 0;
        if (va == null) return 1;         // ô trống luôn xuống cuối
        if (vb == null) return -1;
        return (va - vb) * sortDir;
      })
    : shown;

  // Sheet Để sau / Không xuất trong phạm vi ô tìm kiếm + CTy (bảng nhóm riêng bên dưới dùng cùng phép lọc).
  const heldLoc = (hold: "later" | "skip") => held.filter((h) => h.hold === hold
    && (!cty || defaultCty(h.q) === cty)
    && smartTextMatch(q, [h.q.customerName, h.q.customerCode, h.q.title, h.code, h.name, h.amount, fmtMoney(h.amount)]));
  // "Để sau" chưa xuất nhưng VẪN PHẢI THU → cộng vào Tổng + Chưa thu (chủ repo 2026-10-06); "Không xuất" thì không.
  // Chỉ cộng khi không lọc theo thứ chỉ hóa đơn mới có (số/ngày HĐ, đã thu, quá hạn, ô thiếu) — sheet chưa xuất không có.
  const tinhDeSau = !status && !missing && (collection === "" || collection === "unpaid") && !year && !month && !dateFrom && !dateTo;
  const deSauTien = tinhDeSau ? heldLoc("later").reduce((s, h) => s + h.amount, 0) : 0;
  const sumAmount = shown.reduce((s, r) => s + r.amount, 0) + deSauTien;
  const collected = shown.reduce((s, r) => s + (r.paidAt ? r.amount : 0), 0);
  // Hạn công nợ áp cho TỪNG DÒNG: ưu tiên hạn RIÊNG của khách (trang Mã khách hàng), chưa đặt → 30 ngày.
  const overdue = shown.filter(isOverdue);
  const overdueAmount = overdue.reduce((s, r) => s + r.amount, 0);

  const patch = (key: string, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));
  const saveField = async (row: Row, field: string, val: string | null) => {
    if (!row.sheetId) return;
    const k = `${row.key}:${field}`;
    if ((val ?? null) === (savedRef.current[k] ?? null)) return;   // giá trị KHÔNG đổi → khỏi gọi API/toast/refetch
    try {
      await api.updateSheetInvoice(row.sheetId, field, val);
      savedRef.current[k] = val ?? null;
      patch(row.key, { [field]: val } as unknown as Partial<Row>);   // ô hiển thị (chế độ xem) thấy giá trị mới ngay
      toast("Đã lưu", "success");
      // Đồng bộ cache cho trang Quản lý dự án / Dashboard (tham chiếu cùng nguồn) thấy ngay giá trị mới.
      qc.invalidateQueries({ queryKey: ["quoteProjects"] });
    } catch (ex) { toast(ex instanceof ApiError ? ex.message : "Lỗi", "error"); load(); }
  };

  // LÀM LẠI HÓA ĐƠN (chủ repo 2026-10-06: "back lại cho họ tự chọn lại để làm lại hóa đơn"): gỡ số HĐ + ngày + link khỏi
  // mọi sheet của hóa đơn; tiền đã thu GIỮ NGUYÊN. Sau đó các sheet chọn lại được trong "Chia HĐ".
  const lamLai = async (r: Row) => {
    if (!r.sheetId) return;
    const thu = r.paidAt ? ` Đã thu ${fmtMoney(r.amount)} ngày ${fmtDate(r.paidAt)} — GIỮ NGUYÊN, không gỡ.` : "";
    const ok = await confirmModal(
      `Làm lại hóa đơn ${r.code}?`,
      `Gỡ số HĐ ${r.invoiceNo}${r.invoiceDate ? `, Ngày HĐ ${fmtDate(r.invoiceDate)}` : ""}${r.invoiceLink ? ", Link HĐ" : ""} khỏi ${r.sheetNames.length > 1 ? `${r.sheetNames.length} sheet (${r.sheetNames.join(", ")})` : `sheet ${r.sheetNames[0] || ""}`}. Sau đó chọn lại sheet ở "Chia HĐ" rồi nhập số HĐ mới.${thu}`,
      { danger: true, confirmText: "Gỡ số HĐ" },
    );
    if (!ok) return;
    try {
      await api.lamLaiHoaDon(r.q.id, r.sheetId);
      toast(`Đã gỡ số HĐ ${r.invoiceNo}`, "success");
      load();
    } catch (ex) { toast(ex instanceof ApiError ? ex.message : "Lỗi", "error"); load(); }
  };

  const fieldLabel = (f: string, r: Row) => `${FIELD_LABEL[f] || f} — ${r.code}`;
  const editable = (r: Row, field?: string) => (field === "paidAt" ? canPay : canEdit) && !!r.sheetId;
  // Một quy tắc duy nhất cho toàn bảng: null, chuỗi rỗng hoặc chỉ có khoảng trắng đều là CHƯA ĐIỀN.
  const missCls = (v: unknown) => (hasValue(v) ? undefined : "cell-miss");

  // CHỐNG SỬA NHẦM (2026-07-20, yêu cầu chủ dự án): ô hiển thị dạng CHỮ như Excel — NHẤP ĐÚP mới mở
  // ô nhập; Enter/blur = lưu, Esc = hủy (input uncontrolled nên hủy là về nguyên trạng). Click 1 lần
  // trên ô sửa-được KHÔNG mở báo giá (row-click bỏ qua [data-edit]) để nhấp đúp không bị nhảy trang,
  // và đè phím lung tung không còn ăn vào ô vì bình thường không có input nào đang mở.
  const [editKey, setEditKey] = useState<string | null>(null);
  const ck = (r: Row, f: string) => `${r.key}:${f}`;
  const editKeyDown = (e: { key: string; stopPropagation: () => void; target: EventTarget }) => {
    if (e.key === "Enter") (e.target as HTMLElement).blur();
    else if (e.key === "Escape") { e.stopPropagation(); setEditKey(null); }
  };
  // FE-07: trước đây CHỈ nhấp đúp chuột mới mở được ô — kế toán nhập liệu bằng bàn phím (Tab/Enter
  // như Excel) không có đường nào để sửa, ô cũng không nhận tiêu điểm. Nay ô sửa-được nằm trong thứ tự
  // Tab và mở bằng Enter hoặc F2 (phím sửa ô của Excel). Nhấp MỘT lần vẫn không mở — giữ nguyên lớp
  // chống sửa nhầm ở trên. stopPropagation: Enter ở ô không được rơi xuống hàng (hàng Enter = mở báo giá).
  const viewTd = (r: Row, field: string, content: React.ReactNode, extraCls = "") => (
    <td className={["cell-edit", extraCls, missCls(r[field as keyof Row])].filter(Boolean).join(" ")} data-edit
        title="Nhấp đúp (hoặc Enter / F2) để sửa" tabIndex={0} role="button" aria-label={`Sửa ${fieldLabel(field, r)}`}
        onDoubleClick={() => setEditKey(ck(r, field))}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === "F2") { e.preventDefault(); e.stopPropagation(); setEditKey(ck(r, field)); } }}>{content}</td>
  );

  const textCell = (r: Row, field: keyof Row, w = 110) => {
    const v = (r[field] as string) || "";
    if (!editable(r, field as string)) return <td className={missCls(r[field])}>{v || dash}</td>;
    if (editKey !== ck(r, field as string)) return viewTd(r, field as string, v || dash);
    return <td className={missCls(r[field])}><input autoComplete="off" name={String(field)} autoFocus defaultValue={v} style={{ width: w }} aria-label={fieldLabel(field as string, r)}
      onKeyDown={editKeyDown} onBlur={(e) => { setEditKey(null); saveField(r, field as string, e.target.value.trim() || null); }} /></td>;
  };
  const dateCell = (r: Row, field: keyof Row) => {
    const disp = hasValue(r[field]) ? fmtDate(r[field] as string) : dash;
    if (!editable(r, field as string)) return <td className={missCls(r[field])}>{disp}</td>;
    if (editKey !== ck(r, field as string)) return viewTd(r, field as string, disp);
    return <td className={missCls(r[field])}><input autoComplete="off" name={String(field)} autoFocus type="date" defaultValue={toInputDate(r[field] as string)} style={{ width: 140 }} aria-label={fieldLabel(field as string, r)}
      onKeyDown={editKeyDown} onBlur={(e) => { setEditKey(null); saveField(r, field as string, e.target.value || null); }} /></td>;
  };
  const selectCell = (r: Row, field: keyof Row, options: string[], defVal = "") => {
    const disp = (r[field] as string) || defVal;
    if (!editable(r, field as string)) return <td>{disp || dash}</td>;
    if (editKey !== ck(r, field as string)) return viewTd(r, field as string, disp || dash);
    return <td className={missCls(disp)}><select autoComplete="off" name={String(field)} autoFocus defaultValue={disp} style={{ width: 74 }} aria-label={fieldLabel(field as string, r)}
      onKeyDown={editKeyDown}
      onChange={(e) => { setEditKey(null); saveField(r, field as string, e.target.value || null); }}
      onBlur={() => setEditKey(null)}>
      {!defVal && <option value="">—</option>}
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select></td>;
  };

  // Nhóm SHEET ĐỂ SAU (chưa xuất — kế toán còn phải xuất) / KHÔNG XUẤT (mờ, bật bằng ô tích). Chỉ áp ô tìm kiếm + CTy:
  // các bộ lọc còn lại (số HĐ, ngày HĐ, thu tiền) là của hóa đơn, sheet chưa xuất không có.
  const heldTable = (hold: "later" | "skip") => {
    const ds = heldLoc(hold);
    if (!ds.length) return null;
    const tieuDe = hold === "later" ? "Sheet để sau — chưa xuất hóa đơn" : "Sheet không xuất hóa đơn";
    return (
      <section className={`inv-chia-nhom${hold === "skip" ? " inv-chia-khong" : ""}`} aria-label={tieuDe}>
        <h2>{tieuDe} <span className="muted">({ds.length} sheet · {fmtMoney(ds.reduce((s, h) => s + h.amount, 0))})</span></h2>
        <div className="tbl-scroll">
          <table className="list-table">
            <thead><tr><th scope="col">Khách hàng</th><th scope="col">Mã sản xuất</th><th scope="col">Sheet</th><th scope="col" className="num">Số tiền</th><th scope="col">Acc</th>{canEdit && <th scope="col" aria-label="Thao tác" />}</tr></thead>
            <tbody>
              {ds.map((h) => (
                <tr key={h.key} className="qrow" tabIndex={0} title="Bấm để mở báo giá"
                    onClick={(e) => { if ((e.target as HTMLElement).closest("button")) return; location.hash = "#/quotes/" + h.q.id; }}
                    onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget) location.hash = "#/quotes/" + h.q.id; }}>
                  <td><strong>{h.q.customerName || h.q.customerCode || tieuDeHienThi(h.q)}</strong></td>
                  <td>{h.code}</td>
                  <td>{h.name}</td>
                  <td className="num">{fmtMoney(h.amount)}</td>
                  <td>{h.q.createdBy?.displayName || dash}</td>
                  {canEdit && <td><button type="button" className="btn btn-xs" onClick={() => setChiaQ(h.q)} aria-label={`Xếp vào hóa đơn — ${h.name}`}>Xếp vào hóa đơn</button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    );
  };

  return (
    <div>
      <h1>Hóa đơn đầu ra</h1>
      <p className="muted">Hóa đơn <b>xuất cho khách</b> — theo dõi theo <b>dự án đã chốt</b> (mỗi sheet 1 dòng; <b>Chia HĐ</b> để gom nhiều sheet thành một hóa đơn _01/_02, để sau hoặc không xuất). Hóa đơn nhận từ nhà cung cấp xem ở <a href="#/invoices-in">Hóa đơn đầu vào</a>. <b>Nhấp đúp</b> vào ô để sửa (Enter lưu · Esc hủy) — trang Quản lý dự án <b>tham chiếu</b> tự động. Ô <b>hồng</b> = chưa điền. Tình trạng HĐ tự <b>Hoàn tất</b> khi có Số HĐơn + Ngày HĐơn. Bấm dòng để mở báo giá.</p>

      <div className="inv-filters">
        <div className="toolbar inv-filter-row inv-filter-main">
          <input name="q" className="grow" type="search" placeholder="Tìm không dấu: khách, MSX, số HĐ, PO, tiền, ngày, ghi chú…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Tìm hóa đơn" />
          <select name="status" value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} aria-label="Lọc tình trạng hóa đơn">
            <option value="">Tình trạng: Tất cả</option><option value="complete">Hoàn tất</option><option value="incomplete">Chưa đủ</option>
          </select>
          <select name="collection" value={collection} onChange={(e) => setCollection(e.target.value as CollectionFilter)} aria-label="Lọc thu tiền">
            <option value="">Thu tiền: Tất cả</option><option value="paid">Đã thu</option><option value="unpaid">Chưa thu</option><option value="dueSoon">Sắp đến hạn (7 ngày)</option><option value="overdue">Nợ quá hạn</option>
          </select>
          <select name="missing" value={missing} onChange={(e) => setMissing(e.target.value as MissingFilter)} aria-label="Lọc thông tin còn thiếu">
            <option value="">Thiếu dữ liệu: Tất cả</option><option value="any">Có ô còn thiếu</option>
            <option value="invoiceDesc">Thiếu Hạng mục</option><option value="poNumber">Thiếu PO/HĐ</option>
            <option value="invoiceNo">Thiếu Số HĐ</option><option value="invoiceDate">Thiếu Ngày HĐ</option>
            <option value="paymentMethod">Thiếu Hình thức TT</option><option value="orderClosedAt">Thiếu Ngày đóng ĐH</option>
            <option value="invoiceLink">Thiếu Link HĐ</option><option value="paidAt">Thiếu Ngày thanh toán</option>
            <option value="docSentAt">Thiếu CT gửi đi</option><option value="docReturnedAt">Thiếu CT trả về</option>
            <option value="signedAt">Chưa ký chứng từ</option><option value="invoiceYear">Thiếu Năm</option><option value="invoiceNote">Thiếu Note</option>
          </select>
        </div>
        <div className="toolbar inv-filter-row inv-filter-extra">
          <select name="cty" value={cty} onChange={(e) => setCty(e.target.value)} aria-label="Lọc theo công ty"><option value="">CTy: Tất cả</option>{COMPANIES.map((c) => <option key={c} value={c}>{c}</option>)}</select>
          <select name="year" value={year} onChange={(e) => setYear(e.target.value)} aria-label="Lọc theo năm"><option value="">Năm: Tất cả</option>{years.map((y) => <option key={y} value={String(y)}>{y}</option>)}</select>
          <select name="month" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Lọc theo tháng (Ngày HĐơn)" title="Theo tháng của Ngày HĐơn">
            <option value="">Tháng: Tất cả</option>{Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={String(i + 1)}>Tháng {i + 1}</option>)}
          </select>
          <label className="inv-date-filter"><span>Từ ngày HĐ</span><input name="dateFrom" type="date" value={dateFrom} max={dateTo || undefined} onChange={(e) => setDateFrom(e.target.value)} /></label>
          <label className="inv-date-filter"><span>Đến ngày HĐ</span><input name="dateTo" type="date" value={dateTo} min={dateFrom || undefined} onChange={(e) => setDateTo(e.target.value)} /></label>
          <span className="spacer" />
          <button className="btn btn-sm btn-ghost" type="button" disabled={!activeFilterCount} onClick={clearFilters}>Xóa tất cả{activeFilterCount ? <span className="inv-filter-count">{activeFilterCount}</span> : null}</button>
        </div>
      </div>
      <div className="inv-quick-filters" aria-label="Bộ lọc nhanh hóa đơn">
        <span className="inv-quick-label">Lọc nhanh:</span>
        <button type="button" className={!status && !collection && !missing ? "active" : ""} onClick={() => { setStatus(""); setCollection(""); setMissing(""); }}>Tất cả <b>{contextRows.length}</b></button>
        <button type="button" className={status === "incomplete" ? "active" : ""} onClick={() => setStatus((v) => v === "incomplete" ? "" : "incomplete")}>Chưa đủ HĐ <b>{quickCounts.incomplete}</b></button>
        <button type="button" className={collection === "unpaid" ? "active" : ""} onClick={() => setCollection((v) => v === "unpaid" ? "" : "unpaid")}>Chưa thu <b>{quickCounts.unpaid}</b></button>
        <button type="button" className={`warning${collection === "dueSoon" ? " active" : ""}`} onClick={() => setCollection((v) => v === "dueSoon" ? "" : "dueSoon")}>Sắp đến hạn <b>{quickCounts.dueSoon}</b></button>
        <button type="button" className={`danger${collection === "overdue" ? " active" : ""}`} onClick={() => setCollection((v) => v === "overdue" ? "" : "overdue")}>⚠ Nợ quá hạn <b>{quickCounts.overdue}</b></button>
        <button type="button" className={missing === "any" ? "active" : ""} onClick={() => setMissing((v) => v === "any" ? "" : "any")}>Thiếu dữ liệu <b>{quickCounts.missing}</b></button>
        <button type="button" className={missing === "signedAt" ? "active" : ""} onClick={() => setMissing((v) => v === "signedAt" ? "" : "signedAt")}>Chưa ký <b>{quickCounts.unsigned}</b></button>
        <button type="button" className={collection === "paid" ? "active" : ""} onClick={() => setCollection((v) => v === "paid" ? "" : "paid")}>Đã thu <b>{quickCounts.paid}</b></button>
      </div>

      {err && <div className="err">⚠ {err} <button className="btn btn-sm" onClick={load}>Thử lại</button></div>}

      {isPending ? (
        <div className="skeleton-wrap">{Array.from({ length: 6 }).map((_, i) => <div className="skeleton-row" key={i} />)}</div>
      ) : err && !data ? null : (   /* lỗi tải mà CHƯA có dữ liệu → chỉ hiện banner lỗi, không hiện stat 0 gây hiểu nhầm */
        <>
          <div className="stat-row">
            <Stat label="Tổng số tiền (VAT)" value={fmtMoney(sumAmount)} title={deSauTien ? `Gồm ${fmtMoney(deSauTien)} của sheet Để sau (chưa xuất HĐ)` : undefined} />
            <Stat label="Đã thu" value={fmtMoney(collected)} tone="ok" active={collection === "paid"} onClick={() => setCollection((v) => v === "paid" ? "" : "paid")} title="Bấm để lọc hóa đơn đã thu" />
            <Stat label="Chưa thu" value={fmtMoney(sumAmount - collected)} tone={sumAmount - collected > 0 ? "danger" : undefined} active={collection === "unpaid"} onClick={() => setCollection((v) => v === "unpaid" ? "" : "unpaid")} title="Bấm để lọc hóa đơn chưa thu" />
            <Stat label="Nợ quá hạn" value={overdue.length ? `${overdue.length} HĐ · ${fmtMoney(overdueAmount)}` : "0"} tone={overdue.length ? "danger" : "ok"} active={collection === "overdue"} onClick={() => setCollection((v) => v === "overdue" ? "" : "overdue")} title="Bấm để lọc nợ quá hạn" />
            <Stat label="Số hóa đơn" value={String(shown.length)} />
          </div>

          {shown.length === 0 ? (
            <div className="empty">{rows.length ? <>Không có hóa đơn khớp bộ lọc.{activeFilterCount > 0 && <div style={{ marginTop: 10 }}><button className="btn btn-sm" onClick={clearFilters}>Xóa tất cả bộ lọc</button></div>}</> : 'Chưa có dự án nào ở trạng thái "Đã chốt".'}</div>
          ) : (
            <>
              <div className="tbl-scroll">
                <table className="list-table inv-table">
                  <thead><tr>{HEADERS.map((h) => {
                    const sk = SORT_COLS[h];
                    const cls = [NUM_COLS.has(h) ? "num" : "", sk ? "sortable" : ""].filter(Boolean).join(" ") || undefined;
                    if (!sk) return <th key={h} scope="col" className={cls}>{h}</th>;
                    const active = sortKey === sk;
                    return (
                      <th key={h} scope="col" className={cls} tabIndex={0} title="Bấm để sắp xếp"
                          aria-sort={active ? (sortDir === 1 ? "ascending" : "descending") : "none"}
                          onClick={() => toggleSort(sk)}
                          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleSort(sk); } }}>
                        {h}{active ? (sortDir === 1 ? " ▲" : " ▼") : ""}
                      </th>
                    );
                  })}</tr></thead>
                  <tbody>
                    {sorted.map((r) => {
                      const done = !!(r.invoiceNo && r.invoiceDate);   // TỰ ĐỘNG Hoàn tất khi có Số HĐ + Ngày HĐ
                      const nDays = debtDays(r);                        // null = đã thanh toán / chưa có Ngày HĐơn
                      const limit = rowLimit(r);                        // hạn riêng của khách ?? mặc định toolbar
                      const over = nDays != null && nDays > limit;      // quá hạn → ĐỎ (đi đòi nợ)
                      return (
                        <tr key={r.key} className="qrow" title="Bấm để mở báo giá" tabIndex={0}
                            onClick={(e) => { if ((e.target as HTMLElement).closest("button,a,input,select,[data-edit]")) return; location.hash = "#/quotes/" + r.q.id; }}
                            onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget) location.hash = "#/quotes/" + r.q.id; }}>
                          <td title={r.q.title}><strong>{r.q.customerName || r.q.customerCode || tieuDeHienThi(r.q)}</strong></td>
                          <td>{r.q.customerCode || dash}</td>
                          <td className="nowrap">
                            <strong>{r.code}</strong>
                            {canEdit && (r.q.sheets?.length || 0) > 1 && (
                              <button type="button" className="btn btn-xs btn-ghost inv-chia-nut" title="Gom / tách sheet thành hóa đơn, Để sau, Không xuất"
                                      aria-label={`Chia hóa đơn — ${r.code}`} onClick={() => setChiaQ(r.q)}>Chia HĐ</button>
                            )}
                            {canEdit && r.invoiceNo && (
                              <button type="button" className="btn btn-xs btn-ghost inv-chia-nut" title="Gỡ số HĐ để chọn lại sheet và làm lại hóa đơn"
                                      aria-label={`Làm lại hóa đơn — ${r.code}`} onClick={() => void lamLai(r)}>Làm lại HĐ</button>
                            )}
                            {r.sheetNames.length > 1 && <div className="muted inv-chia-sheets">{r.sheetNames.length} sheet</div>}
                          </td>
                          {r.invoiceDesc || editKey === ck(r, "invoiceDesc")
                            ? textCell(r, "invoiceDesc", 210)
                            : editable(r, "invoiceDesc")
                              ? viewTd(r, "invoiceDesc", <span className="muted" title="Chưa gõ Hạng mục — gợi ý theo tên sheet">{r.sheetNames.join(", ") || dash}</span>)
                              : <td className="cell-miss"><span className="muted">{r.sheetNames.join(", ") || dash}</span></td>}
                          <td>{done ? <span className="status approved">Hoàn tất</span> : <span className="status pending">Chưa đủ</span>}</td>
                          {textCell(r, "poNumber", 90)}
                          {selectCell(r, "invoiceCompany", COMPANIES, defaultCty(r.q))}
                          {textCell(r, "invoiceNo", 90)}
                          {dateCell(r, "invoiceDate")}
                          <td className="num"><strong>{fmtMoney(r.amount)}</strong></td>
                          <td className={"num nowrap" + (over ? " cell-over" : "")}
                              title={nDays == null ? undefined : `Hạn công nợ ${limit} ngày (${r.q.customerDebtDays != null ? "riêng khách này — đặt ở Mã khách hàng" : "mặc định"})${over ? ` — QUÁ HẠN, từ Ngày HĐơn ${fmtDate(r.invoiceDate)}, cần báo thanh toán` : ""}`}>
                            {r.paidAt ? <span className="txt-ok">✓ Đã TT</span> : nDays == null ? dash : <>{over ? "⚠ " : ""}{nDays}/{limit} ngày</>}
                          </td>
                          {selectCell(r, "paymentMethod", PAY_METHODS)}
                          {dateCell(r, "orderClosedAt")}
                          <td>{r.q.createdBy?.displayName || dash}</td>
                          {editable(r)
                            ? (editKey === ck(r, "invoiceLink")
                              ? <td className={missCls(r.invoiceLink)}><input name="invoiceLink" autoFocus defaultValue={r.invoiceLink || ""} style={{ width: 150 }} aria-label={fieldLabel("invoiceLink", r)}
                                  onKeyDown={editKeyDown} onBlur={(e) => { setEditKey(null); saveField(r, "invoiceLink", e.target.value.trim() || null); }} /></td>
                              : viewTd(r, "invoiceLink", r.invoiceLink ? <a href={r.invoiceLink} target="_blank" rel="noopener" onClick={(e) => e.stopPropagation()}>Xem HĐ ↗</a> : dash, "nowrap"))
                            : <td className={missCls(r.invoiceLink)}>{r.invoiceLink ? <a href={r.invoiceLink} target="_blank" rel="noopener">Xem HĐ</a> : dash}</td>}
                          {dateCell(r, "paidAt")}
                          {dateCell(r, "docSentAt")}
                          {dateCell(r, "docReturnedAt")}
                          <td className="nowrap">
                            {r.signedAt
                              ? <span className="status approved nowrap">✓ {r.signedByName || "Đã ký"} · {fmtDate(r.signedAt)}</span>
                              : <span className="muted">Chưa ký</span>}
                          </td>
                          {editable(r)
                            ? (editKey === ck(r, "invoiceYear")
                              ? <td className={missCls(r.invoiceYear)}><input name="invoiceYear" autoFocus inputMode="numeric" defaultValue={r.invoiceYear ?? ""} style={{ width: 64 }} aria-label={fieldLabel("invoiceYear", r)}
                                  onKeyDown={editKeyDown} onBlur={(e) => { setEditKey(null); const v = e.target.value.replace(/[^\d]/g, ""); saveField(r, "invoiceYear", v || null); }} /></td>
                              : viewTd(r, "invoiceYear", r.invoiceYear ?? dash))
                            : <td className={missCls(r.invoiceYear)}>{r.invoiceYear ?? dash}</td>}
                          {textCell(r, "invoiceNote", 130)}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="list-foot"><span className="muted">Hiển thị {sorted.length} / {rows.length} hóa đơn{activeFilterCount ? ` · ${activeFilterCount} bộ lọc đang dùng` : ""}</span></div>
            </>
          )}
          {heldTable("later")}
          {held.some((h) => h.hold === "skip") && (
            <label className="inv-chia-toggle">
              <input type="checkbox" name="hienKhongXuat" checked={hienKhongXuat} onChange={(e) => setHienKhongXuat(e.target.checked)} />
              {" "}Hiện sheet Không xuất ({held.filter((h) => h.hold === "skip").length})
            </label>
          )}
          {hienKhongXuat && heldTable("skip")}
        </>
      )}
      {chiaQ && <HopChiaHoaDon q={chiaQ} onClose={() => setChiaQ(null)} onSaved={load} />}
    </div>
  );
}
