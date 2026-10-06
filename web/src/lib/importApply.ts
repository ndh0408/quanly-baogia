// Nạp kết quả ĐỌC FILE EXCEL (server: src/excelImport.ts) vào LƯỚI báo giá đang mở.
//
// Server trả công thức ở dạng CANONICAL theo TÊN FIELD — "={unitPrice:9}*2" — chứ không theo chữ
// cột, vì chữ cột của lưới phụ thuộc mẫu ĐANG MỞ (có/không cột Chi Tiết, có/không Số Ngày).
// Ở đây mới đổi sang chữ cột thật của lưới đích → dán sang mẫu khác cũng KHÔNG LỆCH Ô.
// Field nào mẫu đích không có (vd Số Ngày) → BỎ công thức, giữ con số (không tạo ref chết).

import * as M from "./quoteMath";
import { coNhomNhanHeSo, coSauNhapExcel } from "./khoaThanhTienNhom";
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
 *   · `rid` + cờ duyệt / đã chi — chỉ hàng bảng HÀ NỘI có (AccountHnView truyền thẳng hnTables vào
 *                      modal). Máy chủ khớp dấu duyệt theo `rid` (reconcileHnApprovals) và khớp KHOẢN KẾ
 *                      TOÁN của hàng — đã chi, ảnh chứng từ, ngày HĐ, ghi chú; kế toán ghi ở trang Hóa đơn
 *                      đầu vào từ 2026-10-06 — theo (báo giá, phía, `rid`); thiếu rid là máy chủ cấp rid
 *                      mới → hàng vẫn khớp đúng nội dung mất dấu duyệt, hàng ĐÃ CHI bị coi là bị xoá
 *                      (400 'hang-da-chi', cả lần Lưu bị từ chối) và khoản chưa chi thành mồ côi. Mang sang
 *                      KHÔNG nới gì: rid là thứ client vốn có; mỗi cặp ghép là một-một nên không nhân bản
 *                      rid, và máy chủ vẫn tự quyết cờ theo CSDL (cờ đã chi trong payload bị cắt) + ghim số
 *                      tiền hàng đã duyệt / đã chi (đổi số tiền → từ chối cả lần lưu, hỏng TO chứ không âm
 *                      thầm). Cờ mang theo để màn hình khỏi nói sai trước khi Lưu.
 *   · `ns` / `luuKho` / `chungTu` — ba cột NỘI BỘ của bảng Chi phí HCM / Phí khách hàng / Hà Nội. Bảng nội
 *                      bộ không xuất ra Excel và excelImport không đọc ba cột này, nên tệp nạp vào KHÔNG
 *                      BAO GIỜ chở chúng: không mang sang là Lưu xong ba cột về rỗng ở MỌI hàng khớp
 *                      (sanitizeExtraTables ghi null/false), trong khi bảng đối chiếu vẫn ghi "Giữ nguyên".
 * `trangThaiMat` = số hàng đã duyệt / đã chi KHÔNG ghép được — hộp xác nhận nói ra: hàng đã duyệt mất cùng
 *   dòng; hàng kế toán đã đánh dấu ĐÃ CHI thì máy chủ không cho xoá (400) — phải nhờ kế toán bỏ đánh dấu trước.
 * `noiBoMat` = số hàng có NS / chứng từ / lưu kho KHÔNG ghép được. Tệp không bao giờ chở ba cột đó nên hàng
 *   bị xoá thật là mất chúng vĩnh viễn — trước đây hộp xác nhận chỉ đếm ảnh và duyệt / thanh toán, im về chúng.
 * `tienDaTraDoi` = tên các hàng ĐÃ CHI ghép được mà tệp đổi SL / Đơn Giá / Số Ngày (soát toàn diện đợt 3).
 *   rid đi theo nên máy chủ nhận ra hàng đã chi, và người không có quyền tích ĐÃ CHI (invoice:input:pay — kế toán
 *   + admin) bị TỪ CHỐI cả lần Lưu (400). KHÔNG âm thầm giữ số cũ — người nạp có thể chính là người có quyền, và
 *   nuốt thay đổi là đúng thứ reconcileExtraPayments đã chọn tránh; chỉ NÓI RA trước khi nạp.
 */
const TRUONG_TRANG_THAI = ["rid", "approved", "approvedAt", "approvedBy", "paid", "paidAt", "paidById", "hasPaidProof"] as const;
const TRUONG_NOI_BO = ["ns", "luuKho", "chungTu"] as const;
const coTrangThai = (it: Record<string, unknown>) => !!(it.approved || it.paid || it.hasPaidProof || it.paidAt);
/** Hàng có dữ liệu ở ba cột nội bộ — giá trị mặc định (null / false / chuỗi trắng) không tính, như extraTableHasData. */
const coNoiBo = (it: Record<string, unknown>) => (typeof it.ns === "string" && it.ns.trim() !== "") || !!it.chungTu || it.luuKho === true;
/** Dấu vân tay SỐ TIỀN của một hàng — PHẢI khớp `soTienHang` (src/services/quoteService.ts), nơi máy
 *  chủ so hàng đã chi. `null` = hàng KHÔNG ghi số tiền (bản trước chuẩn hoá) → máy chủ không so. */
const soTienHang = (it: Record<string, unknown>): string | null => {
  const q = it.quantity, dg = it.unitPrice;
  if (q == null && dg == null) return null;
  return `${Number(q) || 0}|${Number(dg) || 0}|${it.days != null ? Number(it.days) : ""}`;
};

export function giuTruongChiApp(before: M.Item[], after: M.Item[], opts: { giuGhiChuNoiBo: boolean; giuCongThucNgayAn?: boolean }): { items: M.Item[]; anhMat: number; trangThaiMat: number; daChiMat: string[]; noiBoMat: number; tienDaTraDoi: string[]; congThucNgayAnMat: number } {
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
    for (const k of TRUONG_NOI_BO) if (cu[k] != null && moi[k] == null) (moi as Record<string, unknown>)[k] = cu[k];
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
  let anhMat = 0, trangThaiMat = 0, noiBoMat = 0, congThucNgayAnMat = 0;
  const daChiMat: string[] = [];
  before.forEach((cu, i) => {
    if (opts.giuCongThucNgayAn && cu.formulas?.days && !ngayAnDaGiu.has(i)) congThucNgayAnMat++;
    if (daGhep.has(i)) return;
    anhMat += cu.images?.length || 0;
    if (coTrangThai(cu as ItemApp)) trangThaiMat++;
    if ((cu as ItemApp).paid === true) daChiMat.push(String(cu.name || "").trim() || "(không tên)");
    if (coNoiBo(cu as ItemApp)) noiBoMat++;
  });
  return { items, anhMat, trangThaiMat, daChiMat, noiBoMat, tienDaTraDoi, congThucNgayAnMat };
}

/**
 * Hàng ĐÃ CHI nằm trong các sheet sắp bị XOÁ khi nạp (soát 2026-10-06, W1). Máy chủ không cho hàng đã chi biến mất —
 * 400 'hang-da-chi', CẢ lần Lưu bị từ chối, với MỌI người — nên modal chặn ngay thay vì để người dùng làm tiếp trên một
 * bản không lưu được. `paid` là trạng thái HIỆU LỰC máy chủ phủ lên mọi phản hồi báo giá (khoản kế toán ?? cờ JSON cũ).
 * Hai hình dạng "sheet": màn soạn — hàng đã chi ở `extraTables` (Chi phí HCM / Phí KH) của trang; màn Account HN — mỗi
 * "sheet" là một bảng Hà Nội, hàng nằm thẳng ở `items`. Hàng mà rid còn ở sheet giữ lại không tính (máy chủ so theo rid).
 */
export function khoanDaChiTrongSheetXoa(sheets: readonly { items?: unknown; extraTables?: unknown }[], xoa: readonly number[]): string[] {
  type Hang = Record<string, unknown>;
  const laObj = (x: unknown): x is Hang => !!x && typeof x === "object" && !Array.isArray(x);
  const hangCua = (s: { items?: unknown; extraTables?: unknown } | undefined): Hang[] => [
    ...(Array.isArray(s?.items) ? s.items : []),
    ...(Array.isArray(s?.extraTables) ? s.extraTables : [])
      .filter((t): t is Hang => laObj(t) && (t.category === "hcm" || t.category === "khach"))
      .flatMap((t) => (Array.isArray(t.items) ? t.items : [])),
  ].filter(laObj);
  const tapXoa = new Set(xoa);
  const ridGiu = new Set(sheets.flatMap((s, i) => (tapXoa.has(i) ? [] : hangCua(s))).map((it) => (typeof it.rid === "string" ? it.rid : "")).filter(Boolean));
  return [...tapXoa].flatMap((i) => hangCua(sheets[i])
    .filter((it) => it.paid === true && !(typeof it.rid === "string" && ridGiu.has(it.rid)))
    .map((it) => String(it.name || "").trim() || "(không tên)"));
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

const laDongNhom = (it: M.Item) => it.kind === "section" || it.kind === "subsection";
/** Chênh từ nửa đồng trở lên mới là "đổi tiền" — dưới mức đó tổng làm tròn ra cùng một số. */
export const khacTien = (a: number, b: number) => Math.abs(a - b) >= 0.5;

/** Nguyên nhân (a) của `doiChieuNhapExcel`: các hàng NỐI vào thuộc nhóm cuối của sheet đích nên được nhân Số Lượng nhóm đó.
 *  `soLuong`: Số Lượng nhóm đúng như ô đang hiện (cũng là hệ số ×N). `trongTep` → `sauNap`: tiền của chính các hàng đó khi đứng
 *  một mình (như trong file) → sau khi nằm trong nhóm. `chiPhanDau`: file có dòng nhóm riêng nên chỉ phần đứng trước dòng nhóm
 *  đầu tiên của file rơi vào nhóm cũ. */
export type NhomCuoiNhan = { ten: string; nhomPhu: boolean; soLuong: string; trongTep: number; sauNap: number; chiPhanDau: boolean };

/**
 * Cờ "Hiện Thành Tiền nhóm" và ĐỐI CHIẾU TIỀN của MỘT sheet trong file SAU KHI nạp — MỘT chỗ tính cho bảng xem trước của hộp
 * "Nhập từ Excel" và cho hộp xác nhận lúc nạp: hai nơi phải nói cùng một điều, không thì đối chiếu tiền nói một đằng, nạp thật
 * một nẻo.
 *
 * Luật cờ là của `coSauNhapExcel` (lib/khoaThanhTienNhom); ở đây chỉ nối nó với đường nạp của hộp: `target` rỗng = sheet MỚI,
 * `mode` "append" = Nối vào cuối, còn lại = Thay toàn bộ. `mode` "skip" chỉ để xem, không nạp → không có gì được bật, và mọi
 * tổng tính theo cờ của chính file như trước (tính theo cờ "sẽ bật" thì sheet bỏ qua lại hiện "Tổng tiền chưa khớp" oan).
 *
 *  · `hangSauNap`: TOÀN BỘ hàng của bảng sau khi nạp (Nối: hàng cũ rồi tới hàng mới ở CUỐI); `hangNap`: riêng các hàng lấy từ
 *    file. Nối thì phần đứng trước `hangNap` trong `hangSauNap` chính là bảng TRƯỚC khi nạp.
 *  · `co`: cờ HIỆU LỰC sau nạp; `tuBat`: cờ vừa được bật vì nhập; `nguonNhom`: nhóm SL > 1 đến từ file hay chỉ có sẵn ở sheet
 *    đích (Nối vào sheet cũ "tắt + nhóm SL > 1" bằng file không có nhóm nào).
 *  · `nhanSauNap`: tổng của bảng đích sau nạp có nhân Số Lượng nhóm không = cờ hiệu lực — TRỪ bảng mà tổng KHÔNG BAO GIỜ nhân
 *    hệ số nhóm (`tongKhongNhanNhom`: bảng Hà Nội, tổng là `extraTableSum` chỉ cộng hạng mục; cờ ở đó chỉ quyết định ô Thành
 *    Tiền của dòng nhóm hiện số đã nhân hay để trống). Mọi tổng trong hộp đi theo nó, để hộp nói đúng con số màn gọi sẽ hiện.
 *  · `tongBang`: hàm tổng THẬT của bảng đích khi nó không cộng như lưới báo giá — bảng Hà Nội cộng bằng `extraTableSum`, đúng phép
 *    AccountHnView cộng "Tổng tất cả … sheet Hà Nội" (làm tròn từng dòng kiểu riêng, bỏ Số Ngày ≤ 0; cộng như lưới thì lệch nó ở
 *    ca làm tròn ,5 và Số Ngày âm). Mọi tổng PHÍA BẢNG ĐÍCH (`importedTotal`, `tongHangTep`, `tongSauNap`) đi theo nó; cách FILE tự
 *    cộng tổng của nó vẫn là phép của lưới theo cờ nhóm. Không truyền → phép của lưới theo `nhanSauNap`.
 *  · `importedTotal` ("sau nạp" của thẻ đối chiếu): phần tổng của bảng mà LẦN NẠP NÀY đem lại, tính theo `nhanSauNap` bằng đúng
 *    hàm tổng của bảng đích. Thay / sheet mới: tổng các hàng lấy từ file (bảng chỉ còn chúng). NỐI: phần tổng bảng THẬT SỰ tăng
 *    thêm = tổng(bảng sau nạp, cờ sau nạp) − tổng(bảng trước nạp, cờ trước nạp). Cộng riêng các hàng của file (hệ số bắt đầu ×1)
 *    như trước đây thì sót hai thứ chỉ Nối mới có, và thẻ báo "Khớp 200.000" trong khi tổng sheet tăng 800.000:
 *      (a) `nhomCuoiNhan` — hàng của file đứng trước dòng nhóm đầu tiên của file thuộc nhóm CUỐI của sheet đích (lưới không mở
 *          nhóm mới cho chúng) nên được nhân Số Lượng nhóm đó;
 *      (b) `hangSanCoDoi` — cờ đổi vì nạp (ô vừa tự bật) làm tổng các hàng SẴN CÓ của sheet đổi theo.
 *    Bảng Hà Nội không nhân hệ số nhóm nên không bao giờ có (a) / (b).
 *  · `tongHangTep`: riêng các hàng của file như bảng đích cộng chúng, hệ số bắt đầu ×1 (= `importedTotal` khi không có (a) / (b)).
 *    `tongSauNap`: tổng THẬT của cả bảng đích sau nạp (vế phải của "Tổng hiện tại: … → …").
 *  · `fileTotal`: tổng ghi trong file (nếu có). Ngưỡng dung sai (2 đ / 0,5 %) CHỈ để nuốt sai số đọc file — giữa tổng ghi trong
 *    file và các hàng của file cộng theo cách FILE cộng: theo cờ của file, hoặc (file "tắt" mà tổng vẫn nhân Số Lượng nhóm) theo
 *    cờ sau nạp — lấy cách gần tổng ghi trong file hơn. Phần chênh do HỆ SỐ NHÓM — nhóm của file bị bảng đích cộng theo cờ khác
 *    cách file cộng, (a), (b) — là số tiền CHÍNH XÁC, tất định, nên KHÔNG BAO GIỜ bị ngưỡng nuốt: ngưỡng 0,5 % của tệp 1 tỷ là 5
 *    triệu, đủ để thẻ báo "Khớp" trong khi tổng sheet tăng thêm 4 triệu vì nhóm cuối ×3.
 *  · `lechThat`: lệch THẬT — bỏ phần chênh do hệ số nhóm ra mà "sau nạp" vẫn lệch tổng ghi trong file quá ngưỡng: chính các hàng
 *    của file không cộng ra tổng ghi trong nó (đọc thiếu dòng, sai cột…), kể cả khi (a) / (b) tình cờ bù đúng phần thiếu. Rủi ro:
 *    đỏ + hỏi xác nhận như trước. `lechSauNap`: "sau nạp" lệch tổng ghi trong file quá ngưỡng.
 *  · `moneyMismatch`: thẻ đối chiếu KHÔNG được nói "Khớp" — lệch thật, "sau nạp" lệch quá ngưỡng, hoặc lần nạp đem lại khác tổng
 *    ghi trong file vì hệ số nhóm (dù chỉ vài đồng).
 *  · `lechDoHeSoNhom`: không khớp mà KHÔNG phải lệch thật, tức sinh ra CHỈ vì hệ số nhóm: (a), (b), hoặc `lechDoCoTep` — các nhóm
 *    CỦA FILE bị bảng đích cộng theo cờ khác cách file cộng: sheet sau nạp nhân hệ số mà file không (ô vừa TỰ BẬT, hoặc sheet đích
 *    đang bật và Thay / Nối không tắt nó), hoặc ngược lại (bảng Hà Nội không nhân mà file nhân). Đó là chủ ý: cảnh báo vàng, không
 *    chặn, không đưa vào hộp xác nhận.
 */
export function doiChieuNhapExcel(o: {
  fs: Pick<ImportedSheet, "groupSubtotal" | "totals">;
  mode: "replace" | "append" | "skip";
  target: { groupSubtotal?: boolean } | null | undefined;
  hangSauNap: M.Item[];
  hangNap: M.Item[];
  usesDays: boolean;
  thayGiuCoCuaDich?: boolean;
  tongKhongNhanNhom?: boolean;
  tongBang?: (hang: M.Item[]) => number;
}) {
  const coFile = !!o.fs.groupSubtotal;
  const cheDo = !o.target ? "moi" : o.mode === "append" ? "noi" : "thay";
  const coHieuLuc = coSauNhapExcel({ cheDo, coCuaDich: o.target?.groupSubtotal, coTheoFile: coFile, thayGiuCoCuaDich: o.thayGiuCoCuaDich }, o.hangSauNap);
  const boQua = o.mode === "skip";
  const co = boQua ? coFile : coHieuLuc.co;
  const tuBat = !boQua && coHieuLuc.tuBat;
  const nhanSauNap = boQua ? coFile : co && !o.tongKhongNhanNhom;
  // `tong`: phép cộng của lưới báo giá theo cờ nhóm — cũng là cách file Excel tự cộng tổng của nó. `tongDich`: tổng THẬT của bảng
  // đích (lưới: chính `tong`; bảng Hà Nội: `tongBang` = extraTableSum). "Bỏ qua" chỉ để xem → mọi tổng theo cách của file.
  const tong = (hang: M.Item[], nhan: boolean) => M.sheetSubtotalGrouped(hang, o.usesDays, nhan);
  const tongRieng = !boQua && o.tongKhongNhanNhom ? o.tongBang : undefined;
  const tongDich = (hang: M.Item[], nhan: boolean) => (tongRieng ? tongRieng(hang) : tong(hang, nhan));
  // Các hàng của file khi đứng MỘT MÌNH (hệ số bắt đầu ×1): theo cờ sau nạp và theo cờ của chính file (phép của lưới — cách file tự
  // cộng tổng), và như bảng đích sẽ cộng chúng.
  const tepTheoCoSau = tong(o.hangNap, nhanSauNap);
  const tepTheoCoTep = tong(o.hangNap, coFile);
  const tongHangTep = tongDich(o.hangNap, nhanSauNap);
  const tongSauNap = tongDich(o.hangSauNap, nhanSauNap);
  let importedTotal = tongHangTep;
  let nhomCuoiNhan: NhomCuoiNhan | null = null;
  let hangSanCoDoi: { truoc: number; sau: number } | null = null;
  if (cheDo === "noi") {
    const truoc = o.hangSauNap.slice(0, Math.max(0, o.hangSauNap.length - o.hangNap.length));
    // Cờ TRƯỚC nạp tính như màn gọi đang hiện — cùng phép với "Tổng hiện tại" của hộp (bảng Hà Nội: không bao giờ nhân).
    const nhanTruoc = !o.tongKhongNhanNhom && !!o.target?.groupSubtotal;
    const truocCoCu = tongDich(truoc, nhanTruoc), truocCoMoi = tongDich(truoc, nhanSauNap);
    importedTotal = tongSauNap - truocCoCu;
    if (khacTien(truocCoCu, truocCoMoi)) hangSanCoDoi = { truoc: truocCoCu, sau: truocCoMoi };
    // (a): hàng của file trước dòng nhóm đầu tiên của file. Có nhân hay không là do CHÍNH hàm tổng nói (cờ sau nạp tắt, hay
    // nhóm cuối SL ≤ 1 thì hai con số bằng nhau) — không tự suy luật riêng.
    const nhomDauTep = o.hangNap.findIndex(laDongNhom);
    const hangDau = nhomDauTep < 0 ? o.hangNap : o.hangNap.slice(0, nhomDauTep);
    let nhomCuoi: M.Item | undefined;
    for (let i = truoc.length - 1; i >= 0 && !nhomCuoi; i--) if (laDongNhom(truoc[i])) nhomCuoi = truoc[i];
    if (nhomCuoi && hangDau.length) {
      const trongTep = tongDich(hangDau, nhanSauNap);
      const sauNap = tongDich([...truoc, ...hangDau], nhanSauNap) - truocCoMoi;
      if (khacTien(trongTep, sauNap)) nhomCuoiNhan = {
        ten: String(nhomCuoi.name || "").trim(), nhomPhu: nhomCuoi.kind === "subsection",
        soLuong: M.fmtNumCell(nhomCuoi.quantity, !!nhomCuoi.quantityExact), trongTep, sauNap, chiPhanDau: nhomDauTep >= 0,
      };
    }
  }
  const fileTotal = o.fs.totals?.subtotal ?? null;
  // Ngưỡng dung sai: CHỈ để nuốt sai số đọc file (tổng ghi trong file với các hàng đọc được, cộng theo cách file cộng).
  const lech = (t: number) => fileTotal != null && Math.abs(t - fileTotal) > Math.max(2, Math.abs(fileTotal) * 0.005);
  // Cách file cộng ra tổng ghi trong nó: theo cờ của chính file, hay — file "tắt" mà tổng vẫn nhân Số Lượng nhóm — theo cờ sau nạp.
  // Lấy cách gần tổng ghi trong file hơn; bằng nhau thì theo cờ của file.
  const tepKhop = fileTotal != null && Math.abs(tepTheoCoSau - fileTotal) < Math.abs(tepTheoCoTep - fileTotal) ? tepTheoCoSau : tepTheoCoTep;
  // Phần lần nạp đem lại khác cách file cộng CHỈ VÌ HỆ SỐ NHÓM — số tiền chính xác, tất định: nhóm của file bị bảng đích cộng theo
  // cờ khác (tepTheoCoSau − tepKhop), cộng (a) + (b) của Nối (importedTotal − tongHangTep). Bảng Hà Nội: (a) = (b) = 0, còn chênh
  // làm tròn / Số Ngày ≤ 0 của extraTableSum so với phép của lưới KHÔNG phải hệ số nhóm — nó ở lại phía "sai số" của ngưỡng.
  const chenhHeSo = tepTheoCoSau - tepKhop + (importedTotal - tongHangTep);
  // Lệch THẬT: bỏ phần chênh do hệ số nhóm ra mà "sau nạp" vẫn lệch tổng ghi trong file quá ngưỡng. Xét trên chính HÀNG CỦA FILE, không
  // trên "sau nạp": Nối mà (a) / (b) tình cờ bù đúng phần đọc thiếu (file ghi 400.000, đọc được một hàng 200.000, nối vào nhóm cuối
  // SL 2 → sau nạp cũng 400.000) thì lỗi đọc vẫn phải lộ ra, không thành "Khớp".
  const lechThat = lech(importedTotal - chenhHeSo);
  const lechSauNap = lech(importedTotal);
  // Không phải lệch thật, nhưng lần nạp đem lại khác tổng ghi trong file vì hệ số nhóm: thẻ KHÔNG được nói "Khớp", dù phần chênh nhỏ
  // hơn ngưỡng (tệp 50 triệu, nhóm cuối ×2 làm tổng tăng thêm 100.000 — ngưỡng 250.000 từng gọi đó là "Khớp").
  const lechHeSo = fileTotal != null && !lechThat && khacTien(chenhHeSo, 0) && khacTien(importedTotal, fileTotal);
  const moneyMismatch = lechThat || lechSauNap || lechHeSo;
  const lechDoHeSoNhom = moneyMismatch && !lechThat;
  const lechDoCoTep = lechDoHeSoNhom && khacTien(tepTheoCoSau, tepKhop);
  const nguonNhom: "file" | "sheet đích" = coNhomNhanHeSo(o.hangNap) ? "file" : "sheet đích";
  return {
    co, tuBat, nhanSauNap, importedTotal, tongHangTep, tongSauNap, fileTotal,
    moneyMismatch, lechSauNap, lechThat, lechDoHeSoNhom, lechDoCoTep, nhomCuoiNhan, hangSanCoDoi, nguonNhom,
  };
}
