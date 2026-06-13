// Layout configuration for each Excel template.
// Each template defines: where header info goes, which columns hold item data,
// where totals rows are, and what formulas to write.

// Shared title formatter: prefix "BẢNG BÁO GIÁ - " unless the title already
// starts with that phrase (diacritic-insensitive).
function baoGiaTitle(title) {
  const t = (title || "").trim();
  if (!t) return "BẢNG BÁO GIÁ";
  const ascii = t.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toUpperCase();
  if (/^BANG\s*BAO\s*GIA/.test(ascii)) return t;
  return `BẢNG BÁO GIÁ - ${t}`;
}

export const TEMPLATE_CONFIGS = {
  // ===== Gia Nguyễn — không ngày (new GN.xls form) =====
  // Columns: STT | Hạng Mục | ĐVT | Số Lượng | Đơn Giá | Thành Tiền | Ghi Chú
  // (no separate "Chi Tiết" column; amount = Đơn Giá × Số Lượng)
  marico_decor: {
    sheetName: "GN",
    filePath: "templates/GN_KhongNgay.xlsx",
    displayName: "GN (không ngày)",
    cleanup: {
      // Sample (CJ CGV) cells not overwritten by quote data — blank them so the
      // template behaves like an empty shell.
      extraCellsToClear: [
        "C4", "C5",                                    // customer Tel / Add (no quote field for these)
        "I12", "I13", "I14", "I15", "I16", "I17", "I18", // stray notes in far column
        "H16", "F5",                                    // leftover sample note + địa chỉ From cũ (đã dời lên F4)
        // NB: C19:C21 (vùng "* Ghi chú:" cạnh phần tổng) KHÔNG xóa ở đây nữa —
        // nó được ghi đè bằng quote.notes (hoặc clear) trong applyPalette().
      ],
      keepImagesAboveRow: 5,
    },
    cells: {
      toCompany:   "C2",
      toContact:   "C3",
      toPhone:     "C4",
      toAddress:   "C5",
      fromContactCell: "F3",
      // Gộp 1 dòng như mẫu: "Hồng Tôn _ AccountTeam_0914291951" (tên _ chức danh_SĐT)
      fromContactFormat: ({ contact, title, phone }) =>
        [[contact, title].filter(Boolean).join(" _ "), phone].filter(Boolean).join("_"),
      // SĐT đã gộp vào dòng trên → địa chỉ lên F4 (F5 mẫu cũ được clear trong cleanup)
      fromAddress: "F4",
      date:        "B6",
      title:       "B7",
      titleFormat: baoGiaTitle,
      greeting:    "B8",
    },
    items: {
      firstRow: 12,
      lastRow:  18,
      columns: {
        stt:       "B",
        name:      "C",
        unit:      "D",
        quantity:  "E",
        unitPrice: "F",
        amount:    "G",
        notes:     "H",
      },
      amountFormula: (r) => `F${r}*E${r}`,
    },
    totals: {
      subtotal: {
        labelCells: [["D", "F"]],
        labelText: () => "Cộng",
        valueCell: "G",
        rowOffset: 1,
        formula: ({ first, last }) => `SUM(G${first}:G${last})`,
      },
      vat: {
        labelCells: [["D", "F"]],
        labelText: (vatPct) => `VAT ${vatPct}%`,
        valueCell: "G",
        rowOffset: 2,
        formula: ({ subtotalRow, vatPct }) => `G${subtotalRow}*${vatPct}%`,
      },
      total: {
        labelCells: [["D", "F"]],
        labelText: () => "Thành Tiền",
        valueCell: "G",
        rowOffset: 3,
        formula: ({ subtotalRow, vatRow }) => `G${subtotalRow}+G${vatRow}`,
      },
    },
    // ===== Bảng màu GN (khớp mẫu Marico_Decor: peach + xanh lá + tên xanh dương) =====
    // Template gốc GN_KhongNgay.xlsx có header/tổng màu nâu đậm (accent6 darker 50%,
    // chữ trắng) — đè lại thành peach (accent6 lighter 80%) + chữ đen, nhóm thành xanh
    // lá, STT/Hạng Mục xanh dương, số tiền tổng đỏ. Áp trong applyPalette() (excel.js).
    palette: {
      headerRows:  [10, 11],     // hàng tiêu đề cột (đứng yên vì nằm trên firstRow)
      headerFill:  "FFFDEADA",   // peach (cam accent6 sáng 80%)
      sectionFill: "FFE2EFDA",   // xanh lá nhạt — hàng nhóm A/B/C
      totalsFill:  "FFFDEADA",   // peach — 3 dòng Cộng/VAT/Thành Tiền (nhãn + số đều đen đậm)
      nameColor:   "FF0070C0",   // xanh dương đậm — STT + Hạng Mục
      noteCol:     "C",          // cột "Ghi chú" merged cạnh phần tổng (C19:C21)
      noteColor:   "FF843C0C",   // nâu đỏ — dòng "Ghi chú:"
    },
  },

  // ===== Clofull — không ngày (new CLF.xls form) =====
  // Columns: STT | Hạng Mục | Chi Tiết | ĐVT | SỐ LƯỢNG | ĐƠN GIÁ | THÀNH TIỀN | Ghi Chú
  // Recipient info is a single combined "Kính gửi" block at F3.
  clofull_decor: {
    sheetName: "CLF",
    filePath: "templates/CLF_KhongNgay.xlsx",
    displayName: "CLF (không ngày)",
    cleanup: {
      // Sample grouped sub-items with vertical merges in STT / Hạng Mục —
      // unmerge so every item row fills independently. Borders/font are then
      // restored uniformly via items.styleRow below.
      unmergeRanges: ["B7", "C7", "B10", "C10"],
      // J5/J8 were coloured guide notes left for the developer ("hàng này có hoặc ko
      // tùy chương trình", "tạo được những hàng con…"). They are NOT part of a real
      // quote — strip them so they never print. The program-info line is now an
      // optional editor row (kind:"info") the user can add/remove per quote.
      extraCellsToClear: ["J5", "J8"],
      keepImagesAboveRow: 3,
    },
    cells: {
      title:       "B2",
      titleFormat: baoGiaTitle,
      toBlockCell: "F3",
      // 3-line recipient block matching the template (Cty / người liên hệ / Email).
      // Only lines with data are emitted, so it never prints empty "…" placeholders.
      toBlockFormat: ({ company, contact, email, phone, address }) => {
        const lines = [`Kính gửi: ${company || "….."}`];
        if (contact) lines.push(contact);
        if (phone) lines.push(`ĐT: ${phone}`);
        if (address) lines.push(`Đ/c: ${address}`);
        if (email) lines.push(`Email: ${email}`);
        return lines.join("\n");
      },
      // "TP.HCM , ngày …" footer date — written from the quote's date (was a
      // hard-coded 05/07/2018 in the template, never updated before).
      date:        "G17",
      // "* Thông tin chương trình" banner (B5:I5). Filled from the quote's optional
      // info row(s); cleared when there are none so the "….." placeholder never prints.
      infoBannerCell: "B5",
      // Customer logo replaces the "logo cty khách hàng" placeholder at C3.
      customerLogoCell: "C3",
      customerLogoExt: { width: 190, height: 80 },
      // Sender letterhead block (top-right, merged F1:I1). Was a hard-coded Colorfull
      // sample; now filled from the quote's company + sender fields so edits show up.
      fromBlockCell: "F1",
      fromBlockFormat: ({ companyName, contact, title, phone, address }) => {
        const lines = [];
        if (companyName) lines.push(String(companyName).toUpperCase());
        if (address) lines.push(address);
        const person = [contact, title].filter(Boolean).join(" - ");
        const personLine = [person, phone].filter(Boolean).join(" - ");
        if (personLine) lines.push(personLine);
        return lines.join("\n");
      },
    },
    // Footer "* Ghi chú" is a C:D merged cell that rides the item splice/duplicate;
    // re-merge it afterwards so the text doesn't duplicate across both columns.
    footerMerges: ["C17:D17"],
    items: {
      firstRow: 6,
      lastRow:  12,
      styleRow: 6,            // copy this clean row's borders/fonts to every item row
      columns: {
        stt:       "B",
        name:      "C",
        detail:    "D",
        unit:      "E",
        quantity:  "F",
        unitPrice: "G",
        amount:    "H",
        notes:     "I",
      },
      amountFormula: (r) => `G${r}*F${r}`,
    },
    totals: {
      subtotal: {
        labelCells: [["B", "G"]],
        labelText: () => "Tổng Cộng",
        valueCell: "H",
        rowOffset: 1,
        formula: ({ first, last }) => `SUM(H${first}:H${last})`,
      },
      vat: {
        labelCells: [["B", "G"]],
        labelText: (vatPct) => `VAT(${vatPct}%)`,
        valueCell: "H",
        rowOffset: 2,
        formula: ({ subtotalRow, vatPct }) => `H${subtotalRow}*${vatPct}%`,
      },
      // Optional "Giảm Giá" row, inserted between VAT and Thành Tiền only when the
      // quote has a discount. Total then subtracts it.
      discount: {
        labelCells: [["B", "G"]],
        labelText: () => "Giảm Giá",
        valueCell: "H",
      },
      total: {
        labelCells: [["B", "G"]],
        labelText: () => "Thành Tiền",
        valueCell: "H",
        rowOffset: 3,
        formula: ({ subtotalRow, vatRow, discountRow }) =>
          discountRow ? `H${subtotalRow}+H${vatRow}-H${discountRow}` : `H${subtotalRow}+H${vatRow}`,
      },
    },
  },

  unibenfood: {
    sheetName: "Quotation",
    filePath: "templates/Unibenfood.xlsx",
    displayName: "GN (có ngày)",
    cleanup: {
      // Marico-specific text that was in the original template file. We strip it so the
      // template behaves like a blank shell.
      extraCellsToClear: [
        "B8",          // leftover second-line greeting from original Unibenfood (we put full greeting into B7)
        "B12", "C12",  // description block
        // footer text
        "B30", "C30", "B31", "C31", "B32", "C32", "B33", "C33", "B34", "C34", "B35", "C35",
        "G30", "G31", "G32", "G33", "G34", "G35",
        "H30", "H31", "H32", "H33", "I30", "I31", "I32", "I33",
      ],
      // Remove Marico-typed structural rows: description block (12), section headers (13, 17), Phí quản lý (25).
      // After this, the template has 10 uniform white-bg item slots at rows 12-21 with totals at 22-24.
      removeRows: [12, 13, 17, 25],
      // Remove PG girl image (Marico-specific). Keep only company logo (above row 5).
      keepImagesAboveRow: 5,
    },
    cells: {
      toCompany:   "C1",
      toContact:   "C2",
      toPhone:     "C3",
      toAddress:   "C4",
      fromContactCell: "E2",
      fromContactFormat: ({ contact, title }) =>
        [contact, title].filter(Boolean).join(" _ "),
      fromPhone:   "E3",
      fromAddress: "E4",
      date:        "B5",
      title:       "B6",
      titleFormat: (title) => {
        const t = (title || "").trim();
        if (!t) return "BẢNG BÁO GIÁ";
        // Strip Vietnamese diacritics + special variants of "Đ"/"đ" then compare in upper-case.
        const ascii = t
          .normalize("NFD")
          .replace(/[̀-ͯ]/g, "")
          .replace(/đ/gi, "d")
          .toUpperCase();
        if (/^BANG\s*BAO\s*GIA/.test(ascii)) return t;
        return `BẢNG BÁO GIÁ - ${t}`;
      },
      greeting:    "B7",
    },
    items: {
      // After removing 4 Marico-specific rows, 10 uniform item slots remain at rows 12-21.
      // Same splice/duplicate behavior as Décor (compact output, no empty trailing rows).
      firstRow: 12,
      lastRow:  21,
      rowHeight: 30,
      // Description column (C) is shown in italic, matching the original Unibenfood template style
      italicColumns: ["C"],
      columns: {
        stt:       "B",
        name:      "C",
        unit:      "D",
        quantity:  "E",
        days:      "F",
        unitPrice: "G",
        amount:    "H",
        notes:     "I",
      },
      // Amount = quantity × days × unit price (this is the only real difference from Décor)
      amountFormula: (r) => `G${r}*E${r}*F${r}`,
    },
    totals: {
      subtotal: {
        labelCells: [["B", "G"]],
        labelText: () => " Tổng",
        valueCell: "H",
        rowOffset: 1,
        formula: ({ first, last }) => `SUM(H${first}:H${last})`,
      },
      vat: {
        labelCells: [["B", "G"]],
        labelText: (vatPct) => `VAT ${vatPct}%`,
        valueCell: "H",
        rowOffset: 2,
        formula: ({ subtotalRow, vatPct }) => `H${subtotalRow}*${vatPct}%`,
      },
      discount: {
        labelCells: [["B", "G"]],
        labelText: () => "Giảm Giá",
        valueCell: "H",
      },
      total: {
        labelCells: [["B", "G"]],
        labelText: () => "Thành tiền",
        valueCell: "H",
        rowOffset: 3,
        formula: ({ subtotalRow, vatRow, discountRow }) =>
          discountRow ? `H${subtotalRow}+H${vatRow}-H${discountRow}` : `H${subtotalRow}+H${vatRow}`,
      },
    },
  },
};

export function getConfig(code) {
  const c = TEMPLATE_CONFIGS[code];
  if (!c) throw new Error(`Không có config cho template code: ${code}`);
  return c;
}
