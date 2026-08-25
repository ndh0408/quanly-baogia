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
      detail: "", // Trường Chi Tiết đã bỏ khỏi sản phẩm; file cũ có dữ liệu ở đây cũng không nạp lại.
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
  formulas: "Công thức", quantityExact: "Cách tính Số lượng",
};
const KIND_LABEL: Record<string, string> = {
  item: "Hạng mục", sub: "Dòng phụ", section: "Nhóm chính", subsection: "Nhóm phụ", info: "Thông tin",
};
export const kindLabel = (k?: string) => KIND_LABEL[k || "item"] || k || "—";

function diffFields(a: M.Item, b: M.Item, usesDays: boolean): DiffField[] {
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
  if (norm(a.notes) !== norm(b.notes)) push("notes", a.notes || "", b.notes || "");
  if (norm(a.label) !== norm(b.label)) push("label", a.label || "", b.label || "");
  const fa = JSON.stringify(a.formulas || {}), fb = JSON.stringify(b.formulas || {});
  if (fa !== fb) push("formulas", Object.values(a.formulas || {}).join(" ") || "—", Object.values(b.formulas || {}).join(" ") || "—");
  return out;
}

/** Trên ngưỡng này thì bỏ ghép LCS (bảng n×m quá lớn, treo trình duyệt) — so thẳng theo vị trí. */
const LCS_MAX = 1200;

/** So thẳng theo VỊ TRÍ khi bảng quá dài — vẫn thấy dòng nào đổi số, chỉ không dò được chèn/xoá. */
function diffByPosition(before: M.Item[], after: M.Item[], usesDays: boolean, warnOf?: (i: number) => string[] | undefined): DiffRow[] {
  const rows: DiffRow[] = [];
  const n = Math.max(before.length, after.length);
  for (let i = 0; i < n; i++) {
    const a = before[i], b = after[i];
    if (a && b) {
      const fields = diffFields(a, b, usesDays);
      rows.push({ kind: fields.length ? "changed" : "same", beforeNo: i + 1, afterNo: i + 1, itemKind: b.kind, name: b.name || a.name || "", item: b, fields, warn: warnOf?.(i) });
    } else if (b) rows.push({ kind: "added", afterNo: i + 1, itemKind: b.kind, name: b.name || "", item: b, fields: [], warn: warnOf?.(i) });
    else if (a) rows.push({ kind: "removed", beforeNo: i + 1, itemKind: a.kind, name: a.name || "", item: a, fields: [] });
  }
  return rows;
}

/** So sánh lưới ĐANG CÓ với lưới SẼ NẠP (đã đổi sang item của lưới). */
export function diffItems(before: M.Item[], after: M.Item[], usesDays: boolean, warnOf?: (i: number) => string[] | undefined): DiffRow[] {
  const n = before.length, m = after.length;
  if (n > LCS_MAX || m > LCS_MAX) return diffByPosition(before, after, usesDays, warnOf);
  // LCS theo khoá dòng — bảng (n+1)×(m+1); trên LCS_MAX đã rẽ nhánh ở trên nên không phình.
  const keyA = before.map(rowKey), keyB = after.map(rowKey);
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = keyA[i] === keyB[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const rows: DiffRow[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (keyA[i] === keyB[j]) {
      const fields = diffFields(before[i], after[j], usesDays);
      rows.push({
        kind: fields.length ? "changed" : "same",
        beforeNo: i + 1, afterNo: j + 1,
        itemKind: after[j].kind, name: after[j].name || before[i].name || "", item: after[j],
        fields, warn: warnOf?.(j),
      });
      i++; j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      rows.push({ kind: "removed", beforeNo: i + 1, itemKind: before[i].kind, name: before[i].name || "", item: before[i], fields: [] });
      i++;
    } else {
      rows.push({ kind: "added", afterNo: j + 1, itemKind: after[j].kind, name: after[j].name || "", item: after[j], fields: [], warn: warnOf?.(j) });
      j++;
    }
  }
  while (i < n) { rows.push({ kind: "removed", beforeNo: i + 1, itemKind: before[i].kind, name: before[i].name || "", item: before[i], fields: [] }); i++; }
  while (j < m) { rows.push({ kind: "added", afterNo: j + 1, itemKind: after[j].kind, name: after[j].name || "", item: after[j], fields: [], warn: warnOf?.(j) }); j++; }
  return rows;
}

export const diffCounts = (rows: DiffRow[]) => ({
  same: rows.filter((r) => r.kind === "same").length,
  changed: rows.filter((r) => r.kind === "changed").length,
  added: rows.filter((r) => r.kind === "added").length,
  removed: rows.filter((r) => r.kind === "removed").length,
});
