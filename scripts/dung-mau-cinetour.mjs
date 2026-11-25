#!/usr/bin/env node
// ============================================================================
// DỰNG BỐN TỆP MẪU CINETOUR (cột SỐ CA) TỪ MẪU "CÓ NGÀY" ĐANG CHẠY CỦA TỪNG CÔNG TY.
//
//   templates/GN_Cinetour_KhongNgay.xlsx   ← GN_CoNgay.xlsx   ĐỔI NHÃN  F11 "SỐ NGÀY" → "SỐ CA"
//   templates/GN_Cinetour_CoNgay.xlsx      ← GN_CoNgay.xlsx   CHÈN cột G "SỐ CA" (sau SỐ NGÀY)
//   templates/CLF_Cinetour_KhongNgay.xlsx  ← CLF_CoNgay.xlsx  ĐỔI NHÃN  G4  "SỐ NGÀY" → "SỐ CA"
//   templates/CLF_Cinetour_CoNgay.xlsx     ← CLF_CoNgay.xlsx  CHÈN cột H "SỐ CA" (sau SỐ NGÀY)
//
// ── VÌ SAO NGUỒN LÀ BẢN "CÓ NGÀY" CHO CẢ HAI MẪU CINETOUR ─────────────────
// "Không ngày + Số Ca" và "Có ngày" có CÙNG một khung: một cột thừa số chen giữa SỐ LƯỢNG và ĐƠN GIÁ.
//   · GN: bản không ngày (Marico) giấu cột Chi Tiết (gộp C:D), bản có ngày dùng đúng chỗ đó cho ĐVT và chen SỐ
//     NGÀY — nên GN_CoNgay.xlsx CHÍNH LÀ bản không ngày nhìn thấy được + một cột số. Đổi nhãn là xong, mọi thứ đã
//     đúng ở bản có ngày (khối tổng, chân trang, logo, bề rộng) đi theo, không chỗ nào để lệch.
//   · CLF: bản có ngày đã chèn một cột thật (9 cột, giữ Chi Tiết) — cũng đúng khung "không ngày + Số Ca".
// Hai mẫu CINETOUR có ngày thì phải dài thêm một cột thật nữa: SL → SỐ NGÀY → SỐ CA → ĐƠN GIÁ.
//
// ── CHÈN CỘT: CÙNG CÁCH VỚI scripts/dung-mau-clf-co-ngay.mjs (đọc chú thích ở đó) ──
//   1. chụp style TỪNG Ô trước mọi thứ (unMerge xoá style ô phụ, merge chép style ô chủ ra cả vùng);
//   2. nhớ rồi gỡ hết vùng gộp (spliceColumns dời giá trị mà KHÔNG dời vùng gộp);
//   3. gỡ công thức chia sẻ (ExcelJS từ chối ghi clone khi master đã dời chỗ);
//   4. spliceColumns; 5. dịch tham chiếu trong công thức; 6. gộp lại theo toạ độ đã dịch (vùng BẮC QUA điểm chèn
//      thì nở thêm một cột — đúng cho dải tiêu đề / thư đầu chạy hết bề ngang);
//   7. trả style về theo toạ độ đã dịch; 8. cột mới chép style + bề rộng của cột SỐ NGÀY (cùng loại cột số);
//   8b. HỘP NHÃN KHỐI TỔNG: DỊCH, KHÔNG NỞ — phải ôm đúng hai cột ngay trước ô tiền, khớp `labelCells` của cấu
//      hình (src/templateConfigs.ts `khoiTongTai`). Lệch là ExcelJS gộp chồng lên nhau và tệp xuất ra MỞ KHÔNG
//      ĐƯỢC (đã xảy ra, xem scripts/sua-mau-clf-khoi-tong.mjs).
//
// ── LOGO KHÔNG ĐƯỢC XÊ ────────────────────────────────────────────────────
// spliceColumns không dời neo ảnh. Logo GN neo F2 → G2 (+44px), chèn ở G nên neo phải rơi vào cột MỚI — cột này
// lấy bề rộng của SỐ NGÀY (F), không đổi gì ở A…F ⇒ toạ độ tuyệt đối của logo giữ nguyên. Script KHÔNG tin điều đó:
// bước tự soi đo toạ độ tuyệt đối (EMU) của từng ảnh ở tệp nguồn và tệp đích, lệch là dừng.
//
// ── CHẠY LẠI ĐƯỢC ─────────────────────────────────────────────────────────
// Luôn đọc từ GN_CoNgay.xlsx / CLF_CoNgay.xlsx rồi ghi đè đích, không đọc chính đích — chạy hai lần không đẻ ra
// hai cột Số Ca. Sửa mẫu có ngày (scripts/dung-mau-co-ngay.mjs, scripts/dung-mau-clf-co-ngay.mjs) thì chạy lại
// script này để bốn mẫu CINETOUR nhận cùng bản vá.
//
//   node scripts/dung-mau-cinetour.mjs           # dựng + tự soi
//   node scripts/dung-mau-cinetour.mjs --soi     # dựng + in bản đồ ô để soi mắt thường
// ============================================================================
import ExcelJS from "exceljs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const GOC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tep = (t) => path.join(GOC, "templates", t);
const soi = process.argv.includes("--soi");
const NHAN = "SỐ CA";

const chuCot = (n) => { let s = ""; while (n > 0) { const d = (n - 1) % 26; s = String.fromCharCode(65 + d) + s; n = Math.floor((n - 1) / 26); } return s; };
const soCot = (s) => [...s].reduce((a, c) => a * 26 + (c.charCodeAt(0) - 64), 0);
const sao = (x) => JSON.parse(JSON.stringify(x ?? {}));
const chu = (v) => (v && typeof v === "object" && Array.isArray(v.richText))
  ? v.richText.map((x) => x.text).join("")
  : (v && typeof v === "object" && v.formula) ? `=${v.formula}` : String(v ?? "");

async function moTep(t) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(tep(t));
  return wb;
}

// ── Hình học ảnh tuyệt đối — CÙNG công thức với src/excel.ts (pxCotExcel / emuHang / chupAnhMau) ──
function pxCot(ws, c) {
  const col = ws.getColumn(c);
  if (col.hidden) return 0;
  const w = Number(col.width);
  if (!Number.isFinite(w)) return 64;
  return w > 0 ? Math.trunc(((256 * w + Math.trunc(128 / 7)) / 256) * 7) : 0;
}
function emuHang(ws, r) {
  const row = ws.findRow(r);
  if (row?.hidden) return 0;
  const h = Number(row?.height);
  return (Number.isFinite(h) && h > 0 ? h : Number(ws.properties?.defaultRowHeight) || 15) * 12700;
}
const mepTrai = (ws, c0) => { let s = 0; for (let c = 1; c <= c0; c++) s += pxCot(ws, c) * 9525; return s; };
const mepTren = (ws, r0) => { let s = 0; for (let r = 1; r <= r0; r++) s += emuHang(ws, r); return s; };
const hinhAnh = (ws) => (ws._media || []).filter((m) => m?.type === "image").map((m) => {
  const { tl, br } = m.range;
  const diem = (a) => (a ? [mepTrai(ws, a.nativeCol) + a.nativeColOff, mepTren(ws, a.nativeRow) + a.nativeRowOff] : null);
  return { tl: diem(tl), br: diem(br) };
});

/** Mẫu Không ngày: chỉ đổi nhãn ô tiêu đề cột Số Ngày → Số Ca. Bố cục không xê một ly. */
async function doiNhan({ nguon, dich, oTieuDe }) {
  const wb = await moTep(nguon);
  const ws = wb.worksheets[0];
  const o = ws.getCell(oTieuDe);
  const cu = chu(o.value).trim();
  if (cu !== "SỐ NGÀY") throw new Error(`${nguon} ${oTieuDe} phải là "SỐ NGÀY" (cột sẽ đổi thành Số Ca), đang là "${cu}"`);
  o.value = NHAN;
  await wb.xlsx.writeFile(tep(dich));
  console.log(`✓ Đã dựng templates/${dich}  (đổi nhãn ${oTieuDe}: SỐ NGÀY → ${NHAN})`);
}

/**
 * Mẫu Có ngày: chèn cột SỐ CA ngay trước ĐƠN GIÁ (cột `chenTai`, 1-based), style + bề rộng chép từ cột SỐ NGÀY
 * (`chepStyleTu`). `hangTong` = ba hàng tổng của tệp mẫu; `donO` = ô rác cần dọn (toạ độ SAU khi chèn).
 */
async function chenCot({ nguon, dich, chenTai, chepStyleTu, hangTieuDe, hangTong, donO = [] }) {
  const wb = await moTep(nguon);
  const ws = wb.worksheets[0];
  const dichC = (c) => (c < chenTai ? c : c + 1);
  const tach = (addr) => { const m = /^([A-Z]+)(\d+)$/.exec(addr); return { c: soCot(m[1]), r: m[2] }; };
  const dichVung = (range) => {
    const [a, b] = range.split(":");
    const t = tach(a), p = tach(b || a);
    return `${chuCot(dichC(t.c))}${t.r}:${chuCot(dichC(p.c))}${p.r}`;
  };

  // 1) Style từng ô, lúc tệp còn nguyên.
  const styleCu = new Map();
  ws.eachRow({ includeEmpty: true }, (row, r) => {
    row.eachCell({ includeEmpty: true }, (cell, c) => { styleCu.set(`${r}:${c}`, sao(cell.style)); });
  });
  // 2) Vùng gộp.
  const gopCu = [...(ws.model.merges || [])];
  for (const m of gopCu) ws.unMergeCells(m);
  // 3) Gỡ công thức chia sẻ — đọc `.formula` lúc quan hệ master/clone còn nguyên.
  const congThuc = new Map();
  ws.eachRow({ includeEmpty: false }, (row) => {
    row.eachCell({ includeEmpty: false }, (cell) => { const f = cell.formula; if (f) congThuc.set(cell.address, { f, kq: cell.result }); });
  });
  for (const [addr, { f, kq }] of congThuc) ws.getCell(addr).value = { formula: f, result: kq ?? undefined };
  // 4) Chèn.
  ws.spliceColumns(chenTai, 0, []);
  // 5) Dịch tham chiếu trong công thức (công thức mẫu trỏ cột đã dời).
  const dichCongThuc = (f) => f.replace(/(\$?)([A-Z]{1,2})(\$?)(\d+)/g, (ca, d1, cot, d2, hang) => {
    const c = soCot(cot);
    return c >= 1 && c <= 26 ? `${d1}${chuCot(dichC(c))}${d2}${hang}` : ca;
  });
  ws.eachRow({ includeEmpty: false }, (row) => {
    row.eachCell({ includeEmpty: false }, (cell) => { const f = cell.formula; if (f) cell.value = { formula: dichCongThuc(f), result: cell.result ?? undefined }; });
  });
  // 6) Gộp lại.
  for (const m of gopCu) ws.mergeCells(dichVung(m));
  // 7) Trả style.
  for (const [khoa, st] of styleCu) {
    const [r, c] = khoa.split(":").map(Number);
    ws.getCell(r, dichC(c)).style = st;
  }
  // 8) Cột mới: style + bề rộng của cột Số Ngày, nhãn SỐ CA.
  ws.getColumn(chenTai).width = ws.getColumn(chepStyleTu).width;
  ws.eachRow({ includeEmpty: true }, (row) => { row.getCell(chenTai).style = sao(row.getCell(chepStyleTu).style); });
  const oTieuDe = ws.getCell(hangTieuDe, chenTai);
  oTieuDe.value = NHAN;
  oTieuDe.style = sao(ws.getCell(hangTieuDe, chepStyleTu).style);
  // 8b) Hộp nhãn khối tổng: [tu:den] bắc qua điểm chèn đã nở thành [tu:den+1] ở bước 6 → thu lại [tu+1:den+1].
  // PHẢI sau bước 8 (bước 8 chép style cột Số Ngày đè lên cả hàng tổng — xem dung-mau-clf-co-ngay.mjs 8b).
  for (const r of hangTong) {
    const vung = (ws.model.merges || []).find((m) => { const [a, b] = m.split(":"); const t = tach(a), p = tach(b); return t.r === String(r) && p.r === String(r) && t.c < chenTai && p.c >= chenTai; });
    if (!vung) throw new Error(`${nguon}: hàng tổng ${r} không có hộp nhãn bắc qua cột ${chuCot(chenTai)}`);
    const [a, b] = vung.split(":"); const tu = tach(a).c, den = tach(b).c;
    const st = sao(ws.getCell(r, tu).style);
    const nhan = ws.getCell(r, tu).value;
    ws.unMergeCells(vung);
    const oDau = ws.getCell(r, tu);
    const stDau = sao(st); delete stDau.fill; delete stDau.border;   // như các ô trống trước hộp nhãn
    oDau.style = stDau; oDau.value = null;
    for (let c = tu + 1; c <= den; c++) ws.getCell(r, c).style = sao(st);
    ws.mergeCells(r, tu + 1, r, den);
    ws.getCell(r, tu + 1).value = nhan ?? null;
  }
  for (const addr of donO) ws.getCell(addr).value = null;
  await wb.xlsx.writeFile(tep(dich));
  console.log(`✓ Đã dựng templates/${dich}  (chèn cột ${chuCot(chenTai)} "${NHAN}" sau ${chuCot(chepStyleTu)})`);
}

/** Tự soi: đọc LẠI tệp vừa ghi, không tin workbook trong bộ nhớ. */
async function soiLai({ nguon, dich, hangTieuDe, tieuDe, hopNhan, hangTong, tien }) {
  const [src, out] = [await moTep(nguon), await moTep(dich)];
  const ws = out.worksheets[0];
  const loi = [];
  const thuc = tieuDe.map((_, i) => chu(ws.getCell(hangTieuDe, i + 2).value).replace(/\s+/g, " ").trim().toUpperCase());
  tieuDe.forEach((mong, i) => { if (!thuc[i].startsWith(mong)) loi.push(`${chuCot(i + 2)}${hangTieuDe} phải là "${mong}…", đang là "${thuc[i]}"`); });
  const conNgay = thuc.filter((t) => t === "SỐ NGÀY").length, conCa = thuc.filter((t) => t === NHAN).length;
  if (conCa !== 1) loi.push(`phải có đúng MỘT cột ${NHAN}, đang có ${conCa}`);
  if (conNgay !== (tieuDe.includes("SỐ NGÀY") ? 1 : 0)) loi.push(`số cột SỐ NGÀY sai (${conNgay})`);
  const [nhanTu, nhanDen] = hopNhan;
  for (const r of hangTong) {
    if (!(ws.model.merges || []).includes(`${nhanTu}${r}:${nhanDen}${r}`)) loi.push(`hàng tổng ${r} phải gộp ${nhanTu}:${nhanDen} (khớp labelCells), đang có ${(ws.model.merges || []).filter((m) => new RegExp(`^[A-Z]+${r}:`).test(m)).join(",") || "không gì"}`);
    const truoc = chuCot(soCot(nhanTu) - 1);
    if (ws.getCell(`${truoc}${r}`).fill?.fgColor) loi.push(`${truoc}${r}: còn nền — ô trước hộp nhãn phải trống`);
    if (ws.getCell(`${tien}${r}`).formula == null && r === hangTong[0]) loi.push(`${tien}${r}: mất công thức tổng`);
  }
  const a = JSON.stringify(hinhAnh(src.worksheets[0])), b = JSON.stringify(hinhAnh(ws));
  if (a !== b) loi.push(`logo xê dịch: nguồn ${a} ≠ đích ${b}`);
  if (loi.length) { console.error(`✖ templates/${dich} SAI:\n  - ${loi.join("\n  - ")}`); process.exitCode = 1; return; }
  console.log(`  ✓ soi lại: tiêu đề ${thuc.join(" | ")} · hộp nhãn ${nhanTu}:${nhanDen} · logo giữ nguyên`);
  if (soi) {
    console.log("    vùng gộp:", JSON.stringify(ws.model.merges));
    console.log("    bề rộng :", tieuDe.map((_, i) => `${chuCot(i + 2)}=${ws.getColumn(i + 2).width}`).join(" "));
    for (let r = 1; r <= 26; r++) {
      const o = [];
      for (let c = 2; c <= 12; c++) { const s = chu(ws.getCell(r, c).value).replace(/\n/g, "⏎").slice(0, 18); if (s) o.push(`${chuCot(c)}=${s}`); }
      if (o.length) console.log(`    r${r}: ${o.join(" | ")}`);
    }
  }
}

const GN_TIEU_DE_8 = ["STT", "HẠNG MỤC", "ĐVT", "SỐ LƯỢNG", NHAN, "ĐƠN GIÁ", "THÀNH TIỀN", "GHI CHÚ"];
const GN_TIEU_DE_9 = ["STT", "HẠNG MỤC", "ĐVT", "SỐ LƯỢNG", "SỐ NGÀY", NHAN, "ĐƠN GIÁ", "THÀNH TIỀN", "GHI CHÚ"];
const CLF_TIEU_DE_9 = ["STT", "HẠNG MỤC", "CHI TIẾT", "ĐVT", "SỐ LƯỢNG", NHAN, "ĐƠN GIÁ", "THÀNH TIỀN", "GHI CHÚ"];
const CLF_TIEU_DE_10 = ["STT", "HẠNG MỤC", "CHI TIẾT", "ĐVT", "SỐ LƯỢNG", "SỐ NGÀY", NHAN, "ĐƠN GIÁ", "THÀNH TIỀN", "GHI CHÚ"];

// GN: tiêu đề hàng 11, ba hàng tổng 22–24 (hộp nhãn F:G, tiền H ở bản có ngày).
await doiNhan({ nguon: "GN_CoNgay.xlsx", dich: "GN_Cinetour_KhongNgay.xlsx", oTieuDe: "F11" });
await soiLai({ nguon: "GN_CoNgay.xlsx", dich: "GN_Cinetour_KhongNgay.xlsx", hangTieuDe: 11, tieuDe: GN_TIEU_DE_8, hopNhan: ["F", "G"], hangTong: [22, 23, 24], tien: "H" });
// Ô ghi chú lạc của mẫu Marico (J16 "khung sắt căng hiflex…") trôi sang K16 — không thuộc báo giá nào.
await chenCot({ nguon: "GN_CoNgay.xlsx", dich: "GN_Cinetour_CoNgay.xlsx", chenTai: 7, chepStyleTu: 6, hangTieuDe: 11, hangTong: [22, 23, 24], donO: ["K16"] });
await soiLai({ nguon: "GN_CoNgay.xlsx", dich: "GN_Cinetour_CoNgay.xlsx", hangTieuDe: 11, tieuDe: GN_TIEU_DE_9, hopNhan: ["G", "H"], hangTong: [22, 23, 24], tien: "I" });

// CLF: tiêu đề hàng 4, ba hàng tổng 13–15 (hộp nhãn G:H, tiền I ở bản có ngày).
await doiNhan({ nguon: "CLF_CoNgay.xlsx", dich: "CLF_Cinetour_KhongNgay.xlsx", oTieuDe: "G4" });
await soiLai({ nguon: "CLF_CoNgay.xlsx", dich: "CLF_Cinetour_KhongNgay.xlsx", hangTieuDe: 4, tieuDe: CLF_TIEU_DE_9, hopNhan: ["G", "H"], hangTong: [13, 14, 15], tien: "I" });
await chenCot({ nguon: "CLF_CoNgay.xlsx", dich: "CLF_Cinetour_CoNgay.xlsx", chenTai: 8, chepStyleTu: 7, hangTieuDe: 4, hangTong: [13, 14, 15] });
await soiLai({ nguon: "CLF_CoNgay.xlsx", dich: "CLF_Cinetour_CoNgay.xlsx", hangTieuDe: 4, tieuDe: CLF_TIEU_DE_10, hopNhan: ["H", "I"], hangTong: [13, 14, 15], tien: "J" });
