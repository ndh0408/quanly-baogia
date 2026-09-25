// Nạp kết quả ĐỌC FILE EXCEL (server: src/excelImport.ts) vào LƯỚI báo giá đang mở.
//
// Server trả công thức ở dạng CANONICAL theo TÊN FIELD — "={unitPrice:9}*2" — chứ không theo chữ
// cột, vì chữ cột của lưới phụ thuộc mẫu ĐANG MỞ (có/không cột Chi Tiết, có/không Số Ngày).
// Ở đây mới đổi sang chữ cột thật của lưới đích → dán sang mẫu khác cũng KHÔNG LỆCH Ô.
// Field nào mẫu đích không có (vd Số Ngày) → BỎ công thức, giữ con số (không tạo ref chết).

import * as M from "./quoteMath";
import type { EditorTemplate, ImportedItem, ImportedSheet } from "./api";

export const NEW_IMPORT_SHEET = -1;

type ImportTargetSheet = { name?: string | null; templateId?: number };

/**
 * Ghép sheet trong file vào sheet báo giá theo TEMPLATE, không theo vị trí mù.
 *
 * Ví dụ file có [Banner, Banner, Booth] nhưng báo giá đang có [Backdrop, Banner, Banner]:
 * kết quả phải là [1, 2, 0], không phải [0, 1, 2]. Nếu không còn sheet cùng mẫu thì tạo sheet mới.
 */
export function autoTargetIndexes(
  files: Pick<ImportedSheet, "name" | "templateCode" | "hasDays" | "numberSubs">[],
  targets: ImportTargetSheet[],
  templates: EditorTemplate[],
): number[] {
  const tplById = new Map(templates.map((t) => [t.id, t]));
  const used = new Set<number>();
  const out = new Array(files.length).fill(NEW_IMPORT_SHEET);
  const normName = (s: unknown) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/^\s*\d+\s*[.)-]?\s*/, "").replace(/[^a-z0-9]+/g, " ").trim();

  const take = (fi: number, accept: (t: EditorTemplate, target: ImportTargetSheet, targetIndex: number) => boolean) => {
    const hit = targets.findIndex((target, ti) => {
      if (used.has(ti)) return false;
      const tpl = target.templateId == null ? undefined : tplById.get(target.templateId);
      return !!tpl && accept(tpl, target, ti);
    });
    if (hit >= 0) { out[fi] = hit; used.add(hit); }
  };

  // Tên + template cùng khớp: giữ đúng sheet ngay cả khi nhiều sheet dùng chung một mẫu.
  files.forEach((file, fi) => {
    const name = normName(file.name);
    if (!file.templateCode || !name) return;
    take(fi, (tpl, target) => tpl.code === file.templateCode && normName(target.name) === name);
  });

  // Bằng chứng mạnh nhất còn lại: mã template do server nhận từ bố cục/màu/cách đánh STT của file.
  files.forEach((file, fi) => {
    if (out[fi] === NEW_IMPORT_SHEET && file.templateCode) take(fi, (tpl) => tpl.code === file.templateCode);
  });

  // File ngoài không nhận ra đúng mã mẫu: chỉ ghép khi cấu trúc cốt lõi thật sự tương thích.
  files.forEach((file, fi) => {
    if (out[fi] !== NEW_IMPORT_SHEET || file.templateCode) return;
    take(fi, (tpl) => !!tpl.layout?.hasDays === file.hasDays
      && !!tpl.layout?.numberSubsections === file.numberSubs);
  });

  return out;
}

/**
 * SẮP LẠI các sheet ĐẾN TỪ FILE cho đúng thứ tự trong file, TẠI CHỖ.
 *
 * Vì sao cần: đường nạp giữ nguyên chỗ của sheet ĐANG CÓ bị ghi đè, và nối sheet MỚI vào cuối.
 * Nên một file 10 sheet nạp vào báo giá mới (đang có đúng 1 sheet trắng) mà sheet thứ 3 của file
 * là cái ghép được vào chỗ trống đó, thì thứ tự ra: [3, 1, 2, 4, 5, …] — đúng lỗi người dùng gặp.
 *
 * Cách chữa: lấy ĐÚNG những vị trí mà nhóm sheet đến-từ-file đang chiếm, rồi ghi lại chúng vào
 * chính những vị trí đó theo thứ tự trong file. Sheet KHÔNG dính tới lượt nạp không xê dịch.
 * Đây là một PHÉP HOÁN VỊ: không thêm, không bớt, không đổi độ dài mảng.
 */
export function sapXepTheoFile<T>(sheets: T[], theoFile: T[]): void {
  if (theoFile.length < 2) return;
  const cho = theoFile.map((sh) => sheets.indexOf(sh)).filter((i) => i >= 0).sort((a, b) => a - b);
  if (cho.length !== theoFile.length) return;   // có sheet đã bị xoá khỏi mảng → không đụng vào
  cho.forEach((viTri, k) => { sheets[viTri] = theoFile[k]; });
}

/** Sơ đồ địa chỉ ô A1 của lưới — PHẢI khớp mảng ADDR trong components/GridTable.tsx. */
export function addrFields(opts: { addrDetail: boolean; usesDays: boolean; internalNote?: boolean }): string[] {
  return [
    "_stt", "name",
    ...(opts.addrDetail ? ["detail"] : []),
    "unit", "quantity",
    ...(opts.usesDays ? ["days"] : []),
    "unitPrice", "_amount", "notes",
    ...(opts.internalNote ? ["internalNote"] : []),
  ];
}

/** field → chữ cột trong lưới đích ("unitPrice" → "F"). null nếu lưới đích không có cột đó. */
export function letterOfField(fields: string[], field: string): string | null {
  const i = fields.indexOf(field);
  return i < 0 ? null : M.groupLetter(i);
}

/**
 * Đổi 1 công thức canonical sang công thức lưới đích. Trả null nếu có ref tới field mà lưới đích
 * không có (khi đó nơi gọi giữ nguyên con số — không bao giờ để lại ref sai ô).
 */
export function canonicalToGrid(canon: string, fields: string[]): string | null {
  let bad = false;
  const out = String(canon).replace(/\{(\w+):(\d+)\}/g, (_m, f: string, r: string) => {
    const L = letterOfField(fields, f);
    if (!L) { bad = true; return "0"; }
    return `${L}${r}`;
  });
  return bad ? null : out;
}

export type ApplyOpts = {
  /** Mẫu ĐÍCH: lưới có chừa cột Chi Tiết trong sơ đồ địa chỉ không / có cột Số Ngày không. */
  addrDetail: boolean;
  usesDays: boolean;
  /**
   * Mẫu đích có HIỆN cột Chi Tiết không (layout.hasDetail) — KHÁC `addrDetail`, vốn chỉ nói "có
   * chừa khe địa chỉ". Mẫu ẩn cột thì chừa khe mà không hiện; mẫu Colorfull thì hiện.
   * Quyết định việc nội dung Chi Tiết trong file có được NẠP hay bị bỏ — xem `toGridItems`.
   */
  showDetail?: boolean;
  /** Dòng đầu của khối trong lưới đích (0-based) — nạp NỐI THÊM thì ref phải dời theo. */
  baseRow?: number;
};

export type ApplyResult = { items: M.Item[]; droppedFormulas: number };

/** Đổi hạng mục đọc từ file → item của lưới (kèm dịch công thức sang chữ cột của lưới đích). */
export function toGridItems(imported: ImportedItem[], opts: ApplyOpts): ApplyResult {
  const fields = addrFields({ addrDetail: opts.addrDetail, usesDays: opts.usesDays });
  const base = opts.baseRow || 0;
  let dropped = 0;
  const items = imported.map((src) => {
    const it: M.Item = {
      ...M.blankItem(opts.usesDays),
      kind: src.kind,
      name: src.name || "",
      // CHI TIẾT: nạp khi mẫu đích HIỆN cột đó, bỏ khi không.
      //
      // Dòng này trước đây là `detail: ""` cứng, kèm chú thích "Trường Chi Tiết đã bỏ khỏi sản
      // phẩm". Câu đó đúng ở thời điểm viết — hồi ấy KHÔNG mẫu nào hiện cột Chi Tiết. Nay Colorfull
      // hiện nó ở cả ba mẫu (templateConfigs: `clofull_*` đặt `removeDetail: false`), và cột đó
      // chính là cột rộng nhất của mẫu CLF (D = 50), nơi đựng "Backdrop: / . KT: 14mW x 5mH / …".
      //
      // Giữ nguyên dòng cứng thì người dùng Colorfull nạp lại CHÍNH FILE app vừa xuất cũng mất
      // sạch cột D — và ở chế độ "Thay thế" thì Chi Tiết đang có trong sheet bị xoá trắng. Máy chủ
      // đọc được cột này rồi (`src/excelImport.ts`, vai trò "CHI TIET" → `it.detail`); chỗ đánh rơi
      // là ĐÚNG dòng này, ở tầng web.
      detail: opts.showDetail ? src.detail || "" : "",
      unit: src.unit || "",
      quantity: Number(src.quantity) || 0,
      quantityExact: !!src.quantityExact,
      unitPrice: Number(src.unitPrice) || 0,
      days: opts.usesDays ? (src.days != null ? Number(src.days) : 1) : null,
      notes: src.notes || "",
    };
    if (src.label) it.label = src.label;
    if (src.internalNote) it.internalNote = src.internalNote;
    if (src.formulas) {
      const fx: Record<string, string> = {};
      for (const [f, canon] of Object.entries(src.formulas)) {
        // Công thức cho cột mà lưới đích không có (vd Số Ngày) → bỏ, giữ số.
        if (!letterOfField(fields, f)) { dropped++; continue; }
        // Dời dòng theo vị trí khối được nạp vào (nạp nối thêm thì ref dời xuống đúng bấy nhiêu).
        const shifted = base ? canon.replace(/\{(\w+):(\d+)\}/g, (_m, ff, rr) => `{${ff}:${Number(rr) + base}}`) : canon;
        const g = canonicalToGrid(shifted, fields);
        if (g) fx[f] = g; else dropped++;
      }
      if (Object.keys(fx).length) it.formulas = fx;
    }
    return it;
  });
  return { items, droppedFormulas: dropped };
}

// ===== SO SÁNH TRƯỚC / SAU =====
// Ghép dòng cũ ↔ dòng mới bằng LCS trên "khoá dòng" (loại + tên + ĐVT đã chuẩn hoá) để biết dòng
// nào GIỮ NGUYÊN, dòng nào SỬA SỐ, dòng nào THÊM, dòng nào BỊ XOÁ — thay vì so cứng theo vị trí
// (chỉ cần khách chèn 1 dòng là lệch hết).

export type DiffKind = "same" | "changed" | "added" | "removed";
export type DiffField = { field: string; label: string; before: unknown; after: unknown };
export type DiffRow = {
  kind: DiffKind;
  /** Vị trí trong danh sách cũ / mới (1-based) để hiện cho người dùng. */
  beforeNo?: number;
  afterNo?: number;
  itemKind: string;
  name: string;
  item?: M.Item;
  fields: DiffField[];
  warn?: string[];
};

const norm = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim().toLowerCase();
const rowKey = (it: { kind?: string; name?: string; unit?: string }) => `${it.kind || "item"}|${norm(it.name)}|${norm(it.unit)}`;
const numEq = (a: unknown, b: unknown) => Math.abs((Number(a) || 0) - (Number(b) || 0)) < 0.005;

const FIELD_LABEL: Record<string, string> = {
  name: "Hạng mục", unit: "ĐVT", quantity: "Số lượng", unitPrice: "Đơn giá",
  days: "Số ngày", notes: "Ghi chú", detail: "Chi tiết", kind: "Loại dòng", label: "Chữ nhóm",
  formulas: "Công thức", quantityExact: "Cách tính Số lượng", images: "Hình ảnh",
};
const KIND_LABEL: Record<string, string> = {
  item: "Hạng mục", sub: "Dòng phụ", section: "Nhóm chính", subsection: "Nhóm phụ", info: "Thông tin",
};
export const kindLabel = (k?: string) => KIND_LABEL[k || "item"] || k || "—";

function diffFields(a: M.Item, b: M.Item, usesDays: boolean, showDetail?: boolean): DiffField[] {
  const out: DiffField[] = [];
  const push = (f: string, before: unknown, after: unknown) => out.push({ field: f, label: FIELD_LABEL[f] || f, before, after });
  if (norm(a.name) !== norm(b.name)) push("name", a.name || "", b.name || "");
  if (norm(a.unit) !== norm(b.unit)) push("unit", a.unit || "", b.unit || "");
  // So theo con số HIỂN THỊ, nếu không bảng đối chiếu đẻ ra dòng "Số lượng: 7,4 → 7,4" (thực là
  // 7.4213 vs 7.4313) — người dùng nhìn tưởng app hỏng.
  const qa = a.quantityExact || b.quantityExact ? Number(a.quantity) || 0 : Math.round(((Number(a.quantity) || 0) + Number.EPSILON) * 10) / 10;
  const qb = a.quantityExact || b.quantityExact ? Number(b.quantity) || 0 : Math.round(((Number(b.quantity) || 0) + Number.EPSILON) * 10) / 10;
  if (!numEq(qa, qb)) push("quantity", qa, qb);
  if (!!a.quantityExact !== !!b.quantityExact) push("quantityExact", !!a.quantityExact, !!b.quantityExact);
  if (!numEq(a.unitPrice, b.unitPrice)) push("unitPrice", Number(a.unitPrice) || 0, Number(b.unitPrice) || 0);
  if (usesDays && !numEq(a.days ?? 1, b.days ?? 1)) push("days", a.days ?? 1, b.days ?? 1);
  // Chi Tiết chỉ so khi mẫu đích HIỆN cột đó — mẫu ẩn thì hai bên luôn rỗng, đưa vào chỉ tổ nhiễu.
  // Thiếu dòng này thì bảng đối chiếu báo "không đổi" ĐÚNG LÚC Chi Tiết đang bị ghi đè: lớp bảo vệ
  // "xem kỹ trước khi nạp" của hộp thoại mù ngay ở cột rộng nhất của mẫu Colorfull.
  if (showDetail && norm(a.detail) !== norm(b.detail)) push("detail", a.detail || "", b.detail || "");
  if (norm(a.notes) !== norm(b.notes)) push("notes", a.notes || "", b.notes || "");
  if (norm(a.label) !== norm(b.label)) push("label", a.label || "", b.label || "");
  const fa = JSON.stringify(a.formulas || {}), fb = JSON.stringify(b.formulas || {});
  if (fa !== fb) push("formulas", Object.values(a.formulas || {}).join(" ") || "—", Object.values(b.formulas || {}).join(" ") || "—");
  // ẢNH: tệp Excel không chở được ảnh, nên dòng nạp vào không có ảnh. Không so thì dòng sắp MẤT ảnh
  // hiện "Giữ nguyên" (soát toàn diện L48). Dòng khớp ở chế độ Thay đã được `giuTruongChiApp` mang
  // ảnh sang nên vẫn "Giữ nguyên" thật; còn lại (vd so theo vị trí khi bảng quá dài) thì phải lộ ra.
  const na = a.images?.length || 0, nb = b.images?.length || 0;
  if (na !== nb) push("images", na, nb);
  return out;
}

/** Trên ngưỡng này thì bỏ ghép LCS (bảng n×m quá lớn, treo trình duyệt) — so thẳng theo vị trí. */
const LCS_MAX = 1200;

/** So thẳng theo VỊ TRÍ khi bảng quá dài — vẫn thấy dòng nào đổi số, chỉ không dò được chèn/xoá. */
function diffByPosition(before: M.Item[], after: M.Item[], usesDays: boolean, warnOf?: (i: number) => string[] | undefined, showDetail?: boolean): DiffRow[] {
  const rows: DiffRow[] = [];
  const n = Math.max(before.length, after.length);
  for (let i = 0; i < n; i++) {
    const a = before[i], b = after[i];
    if (a && b) {
      const fields = diffFields(a, b, usesDays, showDetail);
      rows.push({ kind: fields.length ? "changed" : "same", beforeNo: i + 1, afterNo: i + 1, itemKind: b.kind, name: b.name || a.name || "", item: b, fields, warn: warnOf?.(i) });
    } else if (b) rows.push({ kind: "added", afterNo: i + 1, itemKind: b.kind, name: b.name || "", item: b, fields: [], warn: warnOf?.(i) });
    else if (a) rows.push({ kind: "removed", beforeNo: i + 1, itemKind: a.kind, name: a.name || "", item: a, fields: [] });
  }
  return rows;
}

type BuocGhep = { k: "pair"; i: number; j: number } | { k: "removed"; i: number } | { k: "added"; j: number };

/**
 * Dò LCS theo khoá dòng → chuỗi bước ghép (cặp / xoá / thêm). DÙNG CHUNG cho bảng đối chiếu
 * (`diffItems`) và việc mang ảnh sang khi nạp thật (`giuTruongChiApp`): xem trước ghép một kiểu mà
 * nạp thật ghép một kiểu là biến bảng đối chiếu thành lời hứa suông.
 */
function buocGhepLcs(before: M.Item[], after: M.Item[]): BuocGhep[] {
  const n = before.length, m = after.length;
  // LCS theo khoá dòng — bảng (n+1)×(m+1); nơi gọi đã rẽ nhánh trên LCS_MAX nên không phình.
  const keyA = before.map(rowKey), keyB = after.map(rowKey);
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = keyA[i] === keyB[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: BuocGhep[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (keyA[i] === keyB[j]) { out.push({ k: "pair", i, j }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ k: "removed", i }); i++; }
    else { out.push({ k: "added", j }); j++; }
  }
  while (i < n) out.push({ k: "removed", i: i++ });
  while (j < m) out.push({ k: "added", j: j++ });
  return out;
}

/** Các cặp [dòng cũ, dòng mới] (0-based) cùng khoá dòng — đúng phép ghép của bảng đối chiếu. */
export function ghepDong(before: M.Item[], after: M.Item[]): [number, number][] {
  if (before.length > LCS_MAX || after.length > LCS_MAX) {
    // Bảng quá dài: đối chiếu so theo VỊ TRÍ — chỉ coi là một dòng khi khoá cũng khớp.
    const out: [number, number][] = [];
    for (let i = 0; i < Math.min(before.length, after.length); i++) if (rowKey(before[i]) === rowKey(after[i])) out.push([i, i]);
    return out;
  }
  return buocGhepLcs(before, after).flatMap((b) => (b.k === "pair" ? [[b.i, b.j] as [number, number]] : []));
}

/**
 * Chế độ THAY: mang những trường CHỈ APP CÓ — tệp Excel không chở được — từ dòng cũ sang dòng mới
 * cùng khoá. Trả mảng item MỚI (không sửa tại chỗ) + số ảnh SẼ MẤT (ảnh của dòng cũ không ghép được).
 *
 * Soát toàn diện L48: trước đây item nạp vào dựng từ `blankItem` nên KHÔNG có ảnh; trang gọi
 * `target.items.splice(0, len, ...stamped)` rồi bấm Lưu là ảnh của CẢ sheet mất vĩnh viễn — kể cả
 * khi khách chỉ sửa một đơn giá — trong khi bảng đối chiếu vẫn ghi "Giữ nguyên" và tệp xuất lúc tắt
 * cột ảnh thì máy chủ không cảnh báo gì.
 *   · `images`       — ảnh hạng mục (tệp xuất không bao giờ chở ngược lại được).
 *   · `productId`    — liên kết danh mục sản phẩm; không có trong `M.Item` nhưng máy chủ trả kèm dòng
 *                      và lưu lại nguyên (src/quoteUtils.ts) — mất là gãy lịch sử theo sản phẩm.
 *   · `internalNote` — ghi chú NỘI BỘ, KHÔNG BAO GIỜ xuất ra Excel. Chỉ mang sang khi tệp KHÔNG có cột
 *                      đó (`giuGhiChuNoiBo`); tệp có cột thì theo tệp, kể cả ô trống (người sửa cố ý xoá).
 *   · `rid` + cờ duyệt / thanh toán — chỉ hàng bảng HÀ NỘI có (AccountHnView truyền thẳng hnTables vào
 *                      modal). Máy chủ khớp dấu duyệt, cờ đã trả và ẢNH CHỨNG TỪ theo `rid`
 *                      (reconcileHnApprovals / reconcileExtraPayments, src/services/quoteService.ts);
 *                      thiếu rid là máy chủ cấp rid mới → hàng vẫn khớp đúng nội dung mất sạch trạng
 *                      thái, ảnh uỷ nhiệm chi mất VĨNH VIỄN, không một lời báo. Mang sang KHÔNG nới gì:
 *                      rid là thứ client vốn có; mỗi cặp ghép là một-một nên không nhân bản rid, và máy
 *                      chủ vẫn tự quyết cờ theo CSDL + ghim số tiền hàng đã duyệt / đã trả (đổi số tiền
 *                      → từ chối cả lần lưu, hỏng TO chứ không âm thầm). Cờ mang theo để màn hình khỏi
 *                      nói sai trước khi Lưu, và để người CÓ quyền không vô tình bỏ dấu đã trả.
 * `trangThaiMat` = số hàng đã duyệt / đã thanh toán KHÔNG ghép được (sẽ mất cùng dòng) — hộp xác nhận nói ra.
 * `tienDaTraDoi` = tên các hàng ĐÃ THANH TOÁN ghép được mà tệp đổi SL / Đơn Giá / Số Ngày (soát toàn diện
 *   đợt 3). rid đi theo nên máy chủ nhận ra hàng đã trả, và người không có quyền thanh toán bị TỪ CHỐI cả
 *   lần Lưu (400). KHÔNG âm thầm giữ số cũ — người nạp có thể chính là người có quyền, và nuốt thay đổi là
 *   đúng thứ reconcileExtraPayments đã chọn tránh; chỉ NÓI RA trước khi nạp.
 */
const TRUONG_TRANG_THAI = ["rid", "approved", "approvedAt", "approvedBy", "paid", "paidAt", "paidById", "hasPaidProof"] as const;
const coTrangThai = (it: Record<string, unknown>) => !!(it.approved || it.paid || it.hasPaidProof || it.paidAt);
/** Dấu vân tay SỐ TIỀN của một hàng — PHẢI khớp `soTienHang` (src/services/quoteService.ts), nơi máy
 *  chủ so hàng đã trả. `null` = hàng KHÔNG ghi số tiền (bản trước chuẩn hoá) → máy chủ không so. */
const soTienHang = (it: Record<string, unknown>): string | null => {
  const q = it.quantity, dg = it.unitPrice;
  if (q == null && dg == null) return null;
  return `${Number(q) || 0}|${Number(dg) || 0}|${it.days != null ? Number(it.days) : ""}`;
};

export function giuTruongChiApp(before: M.Item[], after: M.Item[], opts: { giuGhiChuNoiBo: boolean; giuCongThucNgayAn?: boolean }): { items: M.Item[]; anhMat: number; trangThaiMat: number; tienDaTraDoi: string[]; congThucNgayAnMat: number } {
  type ItemApp = M.Item & { productId?: unknown } & Record<string, unknown>;
  const items = after.slice();
  const daGhep = new Set<number>();
  const ngayAnDaGiu = new Set<number>();
  const tienDaTraDoi: string[] = [];
  const ngayAnConDungDiaChi = opts.giuCongThucNgayAn && before.length === after.length && before.every((it, i) => rowKey(it) === rowKey(after[i]));
  for (const [i, j] of ghepDong(before, after)) {
    daGhep.add(i);
    const cu = before[i] as ItemApp, moi = { ...items[j] } as ItemApp;
    if (cu.images?.length && !moi.images?.length) moi.images = cu.images.slice();
    if (cu.productId != null && moi.productId == null) moi.productId = cu.productId;
    if (opts.giuGhiChuNoiBo && cu.internalNote && !moi.internalNote) moi.internalNote = cu.internalNote;
    // Mẫu không-ngày không có ô Excel để chở công thức Số Ngày. Chỉ mang metadata
    // từ sheet cũ khi cấu trúc hàng giữ nguyên; thêm/dời hàng có thể làm ref A1 trỏ nhầm.
    if (ngayAnConDungDiaChi && i === j && cu.formulas?.days && !moi.formulas?.days) {
      moi.formulas = { ...(moi.formulas || {}), days: cu.formulas.days };
    }
    if (cu.formulas?.days && moi.formulas?.days === cu.formulas.days) ngayAnDaGiu.add(i);
    if (typeof cu.rid === "string" && cu.rid && moi.rid == null) {
      const nguon = cu as Record<string, unknown>, dich = moi as Record<string, unknown>;
      for (const k of TRUONG_TRANG_THAI) if (nguon[k] !== undefined) dich[k] = nguon[k];
      const tienCu = soTienHang(nguon);
      if (nguon.paid && tienCu !== null && tienCu !== soTienHang(dich)) tienDaTraDoi.push(String(cu.name || "").trim() || "(không tên)");
    }
    items[j] = moi;
  }
  let anhMat = 0, trangThaiMat = 0, congThucNgayAnMat = 0;
  before.forEach((cu, i) => {
    if (opts.giuCongThucNgayAn && cu.formulas?.days && !ngayAnDaGiu.has(i)) congThucNgayAnMat++;
    if (daGhep.has(i)) return;
    anhMat += cu.images?.length || 0;
    if (coTrangThai(cu as ItemApp)) trangThaiMat++;
  });
  return { items, anhMat, trangThaiMat, tienDaTraDoi, congThucNgayAnMat };
}

/** So sánh lưới ĐANG CÓ với lưới SẼ NẠP (đã đổi sang item của lưới). */
export function diffItems(before: M.Item[], after: M.Item[], usesDays: boolean, warnOf?: (i: number) => string[] | undefined, showDetail?: boolean): DiffRow[] {
  if (before.length > LCS_MAX || after.length > LCS_MAX) return diffByPosition(before, after, usesDays, warnOf, showDetail);
  return buocGhepLcs(before, after).map((b): DiffRow => {
    if (b.k === "pair") {
      const fields = diffFields(before[b.i], after[b.j], usesDays, showDetail);
      return {
        kind: fields.length ? "changed" : "same",
        beforeNo: b.i + 1, afterNo: b.j + 1,
        itemKind: after[b.j].kind, name: after[b.j].name || before[b.i].name || "", item: after[b.j],
        fields, warn: warnOf?.(b.j),
      };
    }
    if (b.k === "removed") return { kind: "removed", beforeNo: b.i + 1, itemKind: before[b.i].kind, name: before[b.i].name || "", item: before[b.i], fields: [] };
    return { kind: "added", afterNo: b.j + 1, itemKind: after[b.j].kind, name: after[b.j].name || "", item: after[b.j], fields: [], warn: warnOf?.(b.j) };
  });
}

export const diffCounts = (rows: DiffRow[]) => ({
  same: rows.filter((r) => r.kind === "same").length,
  changed: rows.filter((r) => r.kind === "changed").length,
  added: rows.filter((r) => r.kind === "added").length,
  removed: rows.filter((r) => r.kind === "removed").length,
});
