import PDFDocument from "pdfkit";
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { logger } from "./logger.js";

// Toán tiền GIỐNG HỆT lưới web + file Excel (shared/quote-math.ts, src/excel.ts). Khai cục bộ chứ
// KHÔNG import shared/: runtime chạy tsx trên src/ nên "../shared/quote-math.js" không resolve được
// trong container (excel.ts/excelImport.ts cũng khai cục bộ vì lý do này).
function qtyRound(x: unknown) {
  const n = Number(x) || 0;
  const t = Math.round(Math.abs(n) * 10 + 1e-6) / 10;
  return n < 0 ? -t : t;
}
function qtyExact(x: unknown) {
  const n = Number(x) || 0;
  const t = Math.round(Math.abs(n) * 10_000 + 1e-8) / 10_000;
  return n < 0 ? -t : t;
}
const qtyForAmount = (it: any) => (it?.quantityExact ? qtyExact(it.quantity) : qtyRound(it?.quantity));
const lineAmount = (it: any, usesDays: boolean) => {
  const q = qtyForAmount(it), d = Number(it?.days) || 1, pr = Number(it?.unitPrice) || 0;
  return Math.round(usesDays ? q * d * pr : q * pr);
};
const groupMult = (it: any) => Math.max(1, qtyForAmount(it) || 1);
function groupLetter(n: number) {
  let s = "", x = n + 1;
  while (x > 0) { const m = (x - 1) % 26; s = String.fromCharCode(65 + m) + s; x = Math.floor((x - 1) / 26); }
  return s;
}
const fmtNumCell = (v?: number | string, exact = false) => {
  const t = exact ? qtyExact(v) : qtyRound(v);
  if (!t || isNaN(t)) return "";
  return t.toLocaleString("vi-VN", { maximumFractionDigits: exact ? 4 : 1 });
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FONT_DIR = path.join(__dirname, "..", "fonts");

const FONT_PATHS = {
  regular: path.join(FONT_DIR, "Times.ttf"),
  bold: path.join(FONT_DIR, "Times-Bold.ttf"),
  italic: path.join(FONT_DIR, "Times-Italic.ttf"),
};

let hasUnicodeFont: boolean | null = null;
function checkFontsOnce() {
  if (hasUnicodeFont !== null) return hasUnicodeFont;
  hasUnicodeFont = existsSync(FONT_PATHS.regular) && existsSync(FONT_PATHS.bold);
  if (!hasUnicodeFont) {
    logger.warn({ fontDir: FONT_DIR }, "PDF Unicode fonts missing — Vietnamese diacritics will not render. See fonts/README.md");
  }
  return hasUnicodeFont;
}

const fmt = (n: number) => Number(n).toLocaleString("vi-VN");

function registerFonts(doc: PDFKit.PDFDocument) {
  if (checkFontsOnce()) {
    doc.registerFont("body", FONT_PATHS.regular);
    doc.registerFont("bold", FONT_PATHS.bold);
    if (existsSync(FONT_PATHS.italic)) doc.registerFont("italic", FONT_PATHS.italic);
    else doc.registerFont("italic", FONT_PATHS.regular);
  } else {
    // Built-in PDF Times — ASCII only
    doc.registerFont("body", "Times-Roman");
    doc.registerFont("bold", "Times-Bold");
    doc.registerFont("italic", "Times-Italic");
  }
}

export async function renderQuotePdf(quote: any) {
  return new Promise((resolve, reject) => {
    const buffers: Buffer[] = [];
    const doc = new PDFDocument({ size: "A4", margin: 40 });
    registerFonts(doc);
    doc.on("data", (b) => buffers.push(b));
    doc.on("end", () => resolve(Buffer.concat(buffers)));
    doc.on("error", reject);

    doc.font("bold").fontSize(16).text("BẢNG BÁO GIÁ", { align: "center" });
    doc.moveDown(0.2);
    doc.font("italic").fontSize(11).text(quote.title || "", { align: "center" });
    doc.moveDown(0.5);

    doc.font("body").fontSize(10);
    doc.text(`Số: ${quote.quoteNumber}`, { continued: true });
    doc.text(`     Ngày: ${new Date(quote.quoteDate).toLocaleDateString("vi-VN")}`, { align: "right" });
    doc.moveDown(0.5);

    const startY = doc.y;
    doc.font("bold").text("Bên gửi:", 40, startY);
    doc.font("body");
    doc.text(quote.company?.name || "");
    doc.text(quote.fromAddress || "");
    if (quote.fromContact) {
      doc.text(`Liên hệ: ${quote.fromContact}${quote.fromPhone ? " — " + quote.fromPhone : ""}`);
    }

    const rightY = doc.y;
    doc.font("bold").text("Bên nhận:", 320, startY);
    doc.font("body");
    doc.text(quote.toCompany || "", 320);
    if (quote.toContact) doc.text(`Người liên hệ: ${quote.toContact}`, 320);
    doc.y = Math.max(doc.y, rightY) + 6;

    if (quote.greeting) {
      doc.font("italic").fontSize(10).text(quote.greeting, { align: "justify" });
      doc.moveDown(0.5);
    }

    let runningIdx = 0;
    for (const sh of quote.sheets || []) {
      if (sh.name) {
        doc.moveDown(0.3);
        doc.font("bold").fontSize(11).text(sh.name);
      }
      drawItemsTable(doc, sh.items || [], runningIdx, !!sh.groupSubtotal, { quoteNumber: quote.quoteNumber, sheetName: sh.name });
      runningIdx += (sh.items || []).filter((it: any) => it?.kind !== "section" && it?.kind !== "subsection" && it?.kind !== "info").length;
    }

    doc.moveDown(0.5);

    const sub = Number(quote.subtotal ?? 0);
    const vat = Number(quote.vat ?? 0);
    const total = Number(quote.total ?? 0);
    const vatPct = Number(quote.vatPercent ?? 0);

    doc.fontSize(11);
    const r = (label: string, val: number, bold = false) => {
      doc.font(bold ? "bold" : "body");
      doc.text(`${label}: ${fmt(val)} VND`, { align: "right" });
    };
    r("Tổng phụ", sub);
    r(`VAT (${vatPct}%)`, vat);
    r("Thành tiền", total, true);

    if (quote.notes) {
      doc.moveDown(0.6);
      doc.font("italic").fontSize(9).text("Ghi chú: " + quote.notes);
    }

    doc.moveDown(1);
    doc.font("body").fontSize(10);
    doc.text(`Trân trọng,`, { align: "right" });
    doc.text(quote.fromContact || "", { align: "right" });

    doc.end();
  });
}

function drawItemsTable(
  doc: PDFKit.PDFDocument,
  items: any[],
  baseIdx: number,
  groupSubtotal: boolean,
  where: { quoteNumber?: string; sheetName?: string } = {},
) {
  const cols: { w: number; label: string; align: "left" | "center" | "right" | "justify" }[] = [
    { w: 30, label: "STT", align: "center" },
    { w: 200, label: "Hạng mục", align: "left" },
    { w: 50, label: "ĐVT", align: "center" },
    { w: 50, label: "SL", align: "right" },
    { w: 80, label: "Đơn giá", align: "right" },
    { w: 95, label: "Thành tiền", align: "right" },
  ];
  const startX = 40;
  const tableW = cols.reduce((s, c) => s + c.w, 0);
  const pageBottom = () => doc.page.height - doc.page.margins.bottom;
  // Cỡ chữ của bảng phải đặt NGAY ĐÂY. Chiều cao hàng đo bằng doc.heightOfString, mà hàm đó dùng
  // cỡ chữ ĐANG hiệu lực — trước kia drawHeader() chạy trước vòng lặp và vô tình đặt hộ 10pt.
  // Nay tiêu đề vẽ muộn, nên nếu không đặt thì phép đo thừa hưởng fontSize(11) của dòng tên sheet
  // và MỌI hàng bị tính cao gấp đôi.
  doc.fontSize(10);

  // Draw the orange header row at y, return the y below it.
  const drawHeader = (atY: number) => {
    let x = startX;
    doc.font("bold").fontSize(10);
    doc.rect(startX, atY, tableW, 18).fillAndStroke("#FFE4CC", "#888");
    doc.fillColor("black");
    for (const c of cols) { doc.text(c.label, x + 2, atY + 4, { width: c.w - 4, align: c.align }); x += c.w; }
    doc.font("body");
    return atY + 18;
  };

  // Sheet dùng cột Số Ngày hay không — suy từ dữ liệu, vì PDF không in cột đó nhưng tiền phải nhân.
  const usesDays = items.some((it) => it && it.days != null && Number(it.days) > 0);
  // Tổng từng nhóm (Σ dòng con tới nhóm kế) để in Thành Tiền ở hàng nhóm, đúng như lưới web.
  const sectionSum: Record<number, number> = {};
  {
    let cur = -1;
    items.forEach((it, i) => {
      if (it?.kind === "section" || it?.kind === "subsection") { cur = i; sectionSum[i] = 0; return; }
      if (it?.kind === "info") return;
      if (cur >= 0) sectionSum[cur] += lineAmount(it, usesDays);
    });
  }

  // Hàng TIÊU ĐỀ bảng vẽ MUỘN — chỉ khi đã biết hàng đầu tiên nằm ở đâu. Vẽ sớm (`drawHeader(doc.y + 4)`
  // ngay tại đây) sinh hai lỗi thấy được trong file gửi khách:
  //   (a) sheet thứ hai trở đi KHÔNG có tên thì renderQuotePdf bỏ qua lệnh text duy nhất có thể ép
  //       pdfkit sang trang → tiêu đề bị vẽ RA NGOÀI lề dưới (tái hiện được từ 31 hạng mục ở sheet đầu);
  //   (b) hàng đầu quá cao (nhánh cắt) thì trang trước còn lại đúng một hàng tiêu đề trống.
  let y = doc.y + 4;
  let needHeader = true;
  /** Đặt chỗ cho một hàng cao `rowH`: sang trang nếu thiếu, rồi vẽ tiêu đề bảng nếu trang chưa có. */
  const startRow = (rowH: number) => {
    if (y + (needHeader ? 18 : 0) + rowH > pageBottom()) {
      doc.addPage();
      y = doc.page.margins.top;
      needHeader = true;
    }
    if (needHeader) { y = drawHeader(y); needHeader = false; }
  };
  let sectionIdx = 0, subNo = 0, itemNo = baseIdx, mult = 1;
  items.forEach((it, idx) => {
    const kind = it?.kind || "item";
    const isGroup = kind === "section" || kind === "subsection";
    const isInfo = kind === "info";

    // Hàng NHÓM đặt hệ số nhân cho các dòng dưới nó (chỉ khi bật "Thành Tiền nhóm") và tự nó không
    // cộng tiền. Trước đây PDF in nhóm y như hàng thường rồi nhân luôn Số Lượng của nhóm vào tiền.
    if (isGroup) mult = groupSubtotal ? groupMult(it) : 1;

    let stt = "", text = String(it?.name || ""), unit = "", qtyS = "", priceS = "", amtS = "";
    if (isGroup) {
      if (kind === "section") { sectionIdx++; subNo = 0; stt = String(it.label || groupLetter(sectionIdx)); }
      else stt = String(it.label || ++subNo);
      const gAmt = sectionSum[idx] || 0;
      priceS = fmtNumCell(gAmt);                                      // Đơn Giá nhóm = Σ mục con
      amtS = groupSubtotal ? fmtNumCell(gAmt * groupMult(it)) : "";   // × hệ số nhóm
    } else if (!isInfo) {
      stt = String(++itemNo);
      if (it?.detail) text += "\n  " + it.detail;
      unit = it?.unit || "";
      qtyS = fmtNumCell(qtyForAmount(it), !!it?.quantityExact);       // ĐÚNG con số lưới hiển thị
      priceS = fmt(Number(it?.unitPrice) || 0);
      amtS = fmt(lineAmount(it, usesDays) * mult);                    // cùng phép tính với web + Excel
    }

    // Chiều cao hàng phải ĐO THẬT chứ không đếm "\n": chữ được vẽ CÓ ràng bề rộng cột ngay bên
    // dưới nên pdfkit tự xuống dòng, mà cột "Hạng mục" chỉ rộng 200pt ở cỡ chữ 10 (~40 ký tự/dòng)
    // trong khi tên hạng mục được phép dài tới 2000 ký tự (src/validators.ts). Đếm "\n" cho ra 1
    // dòng → khung kẻ ngắn hơn chữ, hàng sau đè lên chữ hàng trước, và điều kiện ngắt trang bên
    // dưới cũng dùng đúng con số sai đó nên trang bị tràn. Đây là tài liệu gửi cho khách.
    const rowFont = isGroup ? "bold" : isInfo ? "italic" : "body";
    doc.font(rowFont);
    const vals = [stt, text, unit, qtyS, priceS, amtS];
    const cellH = vals.map((v, i) => doc.heightOfString(String(v), { width: cols[i].w - 4 }));
    const textH = Math.max(...cellH);
    // Trần = phần dùng được của MỘT trang (đã trừ hàng tiêu đề bảng 18pt + 4pt đệm): hàng cao hơn
    // cả trang thì KHÔNG chỗ nào vẽ trọn được.
    const maxRowH = Math.max(18, doc.page.height - doc.page.margins.bottom - doc.page.margins.top - 22);
    // Làm tròn LÊN bội số 12pt — đúng bước dòng của công thức cũ.
    //
    // CẢNH BÁO BỐ CỤC (đo thật, không phỏng đoán): với phông production DejaVuSerif — Dockerfile
    // chép DejaVuSerif.ttf vào fonts/Times.ttf — cột "Hạng mục" rộng 196pt ở cỡ 10 chứa được
    // khoảng 35 ký tự trên MỘT dòng. Tên hạng mục dài hơn thế (rất thường gặp) trước đây bị đếm
    // là 1 dòng (20pt) nay thành 2 dòng (32pt): báo giá 2000 dòng đi từ 53 lên 85 trang (+60%).
    // Mọi hàng có `detail` cũng đổi. Tức bản vá này CÓ dàn lại trang cho báo giá đang chạy —
    // đó là hệ quả bắt buộc của việc sửa khung vẽ hụt, nhưng phải nói đúng để bên in/gửi biết.
    const wantH = 8 + Math.max(1, Math.ceil(textH / 12)) * 12;
    const rowH = Math.min(maxRowH, Math.max(18, wantH));
    const clipped = wantH > maxRowH;
    // Chiều cao chữ được phép vẽ trong ô. Hàng bị cắt nhường 12pt cuối cho DÒNG BÁO CẮT: tài liệu
    // này gửi cho khách, mất chữ mà không có dấu hiệu gì là điều tệ nhất có thể làm.
    const textCap = rowH - 8 - (clipped ? 12 : 0);
    if (clipped) {
      logger.warn(
        { quoteNumber: where.quoteNumber, sheetName: where.sheetName, itemName: String(it?.name || "").slice(0, 80), wantH, maxRowH },
        "PDF: hàng hạng mục cao hơn một trang giấy — nội dung bị cắt trong bản PDF (bản Excel vẫn đủ)",
      );
    }
    startRow(rowH);
    doc.font(rowFont);   // drawHeader trả font về "body" — đặt lại font của hàng trước khi vẽ
    let x = startX;
    // Viền ĐỎ cho hàng bị cắt: dấu hiệu nhìn thấy được ngay cả khi lướt nhanh qua trang.
    const border = clipped ? "#CC0000" : "#bbb";
    if (isGroup) doc.rect(startX, y, tableW, rowH).fillAndStroke(kind === "section" ? "#FDEBD8" : "#DCE6F4", border);
    else doc.rect(startX, y, tableW, rowH).stroke(border);
    doc.fillColor("black");
    doc.font(rowFont);
    vals.forEach((v, i) => {
      // Chỉ ràng height/ellipsis cho ĐÚNG ô thật sự tràn: hàng bình thường — và cả những ô ngắn
      // (STT, ĐVT, tiền) của hàng bị cắt — giữ nguyên đường vẽ cũ của pdfkit.
      const opt: PDFKit.Mixins.TextOptions = { width: cols[i].w - 4, align: cols[i].align };
      if (clipped && cellH[i] > textCap) { opt.height = textCap; opt.ellipsis = true; }
      doc.text(String(v), x + 2, y + 4, opt);
      x += cols[i].w;
    });
    if (clipped) {
      // Dòng báo cắt nằm TRONG khung hàng, ở 12pt vừa chừa ra bên trên.
      doc.font("italic").fontSize(8).fillColor("#CC0000");
      doc.text("[…] Nội dung bị cắt — xem bản Excel để có đầy đủ", startX + 2, y + rowH - 13,
        { width: tableW - 4, align: "left", height: 11, ellipsis: true, lineBreak: false });
      doc.fillColor("black").fontSize(10);
    }
    doc.font("body");
    y += rowH;
  });
  // Sheet KHÔNG có hạng mục nào: giữ nguyên hành vi cũ (vẫn in hàng tiêu đề bảng), chỉ thêm chốt lề.
  if (needHeader) {
    if (y + 18 > pageBottom()) { doc.addPage(); y = doc.page.margins.top; }
    y = drawHeader(y);
  }
  doc.y = y + 4;
}
