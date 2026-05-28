// Layout configuration for each Excel template.
// Each template defines: where header info goes, which columns hold item data,
// where totals rows are, and what formulas to write.

export const TEMPLATE_CONFIGS = {
  marico_decor: {
    sheetName: "Décor",
    filePath: "templates/Marico_Decor.xlsx",
    displayName: "GN (không ngày)",
    cleanup: {
      // Extra cells with leftover content from original Marico file
      extraCellsToClear: ["J16", "K16", "L16"],
      // Keep images whose top-left is in row <= N (logo area). Drop the rest.
      keepImagesAboveRow: 5,
    },
    // Cells where to write header text
    cells: {
      toCompany:   "C2",
      toContact:   "C3",
      // From section: combined string into F3
      fromContactCell: "F3",
      // fromContact format: "Hồng Tôn _ AccountTeam_0914291951"
      fromContactFormat: ({ contact, title, phone }) =>
        [contact, [title, phone].filter(Boolean).join("_")].filter(Boolean).join(" _ "),
      fromAddress: "F4",
      date:        "B6",
      title:       "B7",
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
      quoteNumber: "B8",
      quoteNumberFormat: (qn) => `(Số://${qn || ""})`,
      greeting:    "B9",
    },
    items: {
      firstRow: 12,
      lastRow:  21,
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
      // rows are offsets from the last item row (or from firstRow + itemCount)
      subtotal: {
        labelCells: [],                      // no label in Marico subtotal
        valueCell: "H",
        rowOffset: 1,
        formula: ({ first, last }) => `SUM(H${first}:H${last})`,
      },
      vat: {
        labelCells: [["F", "G"]],            // F merged with G
        labelText: (vatPct) => `VAT (${vatPct}%)`,
        valueCell: "H",
        rowOffset: 2,
        formula: ({ subtotalRow, vatPct }) => `H${subtotalRow}*${vatPct}%`,
      },
      total: {
        labelCells: [["F", "G"]],
        labelText: () => "Tổng Cộng",
        valueCell: "H",
        rowOffset: 3,
        formula: ({ subtotalRow, vatRow }) => `H${subtotalRow}+H${vatRow}`,
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
      total: {
        labelCells: [["B", "G"]],
        labelText: () => "Thành tiền",
        valueCell: "H",
        rowOffset: 3,
        formula: ({ subtotalRow, vatRow }) => `H${subtotalRow}+H${vatRow}`,
      },
    },
  },
};

export function getConfig(code) {
  const c = TEMPLATE_CONFIGS[code];
  if (!c) throw new Error(`Không có config cho template code: ${code}`);
  return c;
}
