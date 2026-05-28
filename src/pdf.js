import PDFDocument from "pdfkit";
import { D } from "./money.js";

const fmt = (n) => Number(n).toLocaleString("vi-VN");

/**
 * Render a quote to a PDF buffer. Single-tab summary layout — not pixel-for-pixel
 * the same as the Excel template (which is what xlsx export is for), but a clean
 * professional PDF the customer can read on phone.
 */
export async function renderQuotePdf(quote) {
  return new Promise((resolve, reject) => {
    const buffers = [];
    const doc = new PDFDocument({ size: "A4", margin: 40 });
    doc.on("data", (b) => buffers.push(b));
    doc.on("end", () => resolve(Buffer.concat(buffers)));
    doc.on("error", reject);

    // Header
    doc.font("Times-Bold").fontSize(16);
    doc.text("BẢNG BÁO GIÁ", { align: "center" });
    doc.moveDown(0.2);
    doc.font("Times-Italic").fontSize(11);
    doc.text(quote.title || "", { align: "center" });
    doc.moveDown(0.5);

    doc.font("Times-Roman").fontSize(10);
    doc.text(`Số: ${quote.quoteNumber}`, { continued: true });
    doc.text(`     Ngày: ${new Date(quote.quoteDate).toLocaleDateString("vi-VN")}`, { align: "right" });
    doc.moveDown(0.5);

    // From / To block
    const startY = doc.y;
    doc.font("Times-Bold").text("Bên gửi:", 40, startY);
    doc.font("Times-Roman");
    doc.text(quote.company?.name || "");
    doc.text(quote.fromAddress || "");
    if (quote.fromContact) doc.text(`Liên hệ: ${quote.fromContact}${quote.fromPhone ? " — " + quote.fromPhone : ""}`);

    doc.font("Times-Bold").text("Bên nhận:", 320, startY);
    doc.font("Times-Roman");
    doc.text(quote.toCompany || "", 320);
    if (quote.toContact) doc.text(`Người liên hệ: ${quote.toContact}`, 320);
    doc.y = Math.max(doc.y, startY + 70);
    doc.moveDown(0.5);

    // Greeting
    doc.font("Times-Italic").fontSize(10);
    doc.text(quote.greeting || "", { align: "justify" });
    doc.moveDown(0.5);

    // Items per sheet
    let runningIdx = 0;
    for (const sh of quote.sheets || []) {
      if (sh.name) {
        doc.moveDown(0.3);
        doc.font("Times-Bold").fontSize(11).text(sh.name);
      }
      drawItemsTable(doc, sh.items || [], runningIdx);
      runningIdx += (sh.items || []).length;
    }

    doc.moveDown(0.5);

    // Totals box right-aligned
    const sub = Number(quote.subtotal ?? 0);
    const vat = Number(quote.vat ?? 0);
    const total = Number(quote.total ?? 0);
    const vatPct = Number(quote.vatPercent ?? 0);

    doc.font("Times-Roman").fontSize(11);
    const r = (label, val, bold = false) => {
      doc.font(bold ? "Times-Bold" : "Times-Roman");
      doc.text(`${label}: ${fmt(val)} VND`, { align: "right" });
    };
    r("Tổng phụ", sub);
    r(`VAT (${vatPct}%)`, vat);
    r("Thành tiền", total, true);

    doc.moveDown(1);
    if (quote.notes) {
      doc.font("Times-Italic").fontSize(9);
      doc.text("Ghi chú: " + quote.notes, { align: "left" });
    }

    doc.moveDown(2);
    doc.font("Times-Roman").fontSize(10);
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
  const startY = doc.y + 4;
  let x = startX;

  doc.font("Times-Bold").fontSize(10);
  doc.rect(startX, startY, cols.reduce((s, c) => s + c.w, 0), 18).fillAndStroke("#FFE4CC", "#888");
  doc.fillColor("black");
  for (const c of cols) {
    doc.text(c.label, x + 2, startY + 4, { width: c.w - 4, align: c.align });
    x += c.w;
  }
  let y = startY + 18;

  doc.font("Times-Roman");
  items.forEach((it, idx) => {
    const qty = Number(it.quantity || 0);
    const price = Number(it.unitPrice || 0);
    const days = it.days != null ? Number(it.days) : null;
    const amount = days && days > 0 ? qty * days * price : qty * price;
    const rowH = Math.max(18, Math.ceil(String(it.name || "").length / 50) * 14);
    x = startX;
    doc.rect(startX, y, cols.reduce((s, c) => s + c.w, 0), rowH).stroke("#bbb");
    const vals = [
      String(baseIdx + idx + 1),
      it.name + (it.detail ? `\n  ${it.detail}` : ""),
      it.unit || "",
      fmt(qty),
      fmt(price),
      fmt(amount),
    ];
    vals.forEach((v, i) => {
      doc.text(String(v), x + 2, y + 3, { width: cols[i].w - 4, align: cols[i].align });
      x += cols[i].w;
    });
    y += rowH;
  });
  doc.y = y + 4;
}
