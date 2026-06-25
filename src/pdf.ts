import PDFDocument from "pdfkit";
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { logger } from "./logger.js";

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

const fmt = (n) => Number(n).toLocaleString("vi-VN");

function registerFonts(doc) {
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

export async function renderQuotePdf(quote) {
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
      drawItemsTable(doc, sh.items || [], runningIdx);
      runningIdx += (sh.items || []).length;
    }

    doc.moveDown(0.5);

    const sub = Number(quote.subtotal ?? 0);
    const vat = Number(quote.vat ?? 0);
    const total = Number(quote.total ?? 0);
    const vatPct = Number(quote.vatPercent ?? 0);

    doc.fontSize(11);
    const r = (label, val, bold = false) => {
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

function drawItemsTable(doc, items, baseIdx) {
  const cols = [
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

  // Draw the orange header row at y, return the y below it.
  const drawHeader = (atY) => {
    let x = startX;
    doc.font("bold").fontSize(10);
    doc.rect(startX, atY, tableW, 18).fillAndStroke("#FFE4CC", "#888");
    doc.fillColor("black");
    for (const c of cols) { doc.text(c.label, x + 2, atY + 4, { width: c.w - 4, align: c.align }); x += c.w; }
    doc.font("body");
    return atY + 18;
  };

  let y = drawHeader(doc.y + 4);
  items.forEach((it, idx) => {
    const qty = Number(it.quantity || 0);
    const price = Number(it.unitPrice || 0);
    const days = it.days != null ? Number(it.days) : null;
    const amount = days && days > 0 ? qty * days * price : qty * price;
    const text = (it.name || "") + (it.detail ? `\n  ${it.detail}` : "");
    const lines = Math.max(1, text.split("\n").length);
    const rowH = Math.max(18, 8 + lines * 12);
    // Page-break: if this row would overflow the page, start a new page + re-draw
    // the table header so long quotes don't get clipped/overlapped.
    if (y + rowH > pageBottom()) {
      doc.addPage();
      y = drawHeader(doc.page.margins.top);
    }
    let x = startX;
    doc.rect(startX, y, tableW, rowH).stroke("#bbb");
    const vals = [String(baseIdx + idx + 1), text, it.unit || "", fmt(qty), fmt(price), fmt(amount)];
    vals.forEach((v, i) => {
      doc.text(String(v), x + 2, y + 4, { width: cols[i].w - 4, align: cols[i].align });
      x += cols[i].w;
    });
    y += rowH;
  });
  doc.y = y + 4;
}
