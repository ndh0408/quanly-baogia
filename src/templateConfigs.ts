// Layout configuration for each Excel template.
// Each template defines: where header info goes, which columns hold item data,
// where totals rows are, and what formulas to write.

// Shared title formatter: prefix "BẢNG BÁO GIÁ - " unless the title already
// starts with that phrase (diacritic-insensitive).
function baoGiaTitle(title: string | null | undefined) {
  const t = (title || "").trim();
  if (!t) return "BẢNG BÁO GIÁ";
  const ascii = t.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toUpperCase();
  if (/^BANG\s*BAO\s*GIA/.test(ascii)) return t;
  return `BẢNG BÁO GIÁ - ${t}`;
}

export const TEMPLATE_CONFIGS: Record<string, any> = {
  // ===== Gia Nguyễn — không ngày (bố cục Marico_Decor: CÓ cột Chi Tiết) =====
  // Cột: STT | Hạng Mục | Chi Tiết | ĐVT | Số Lượng | Đơn Giá | Thành Tiền | Notes
  // Dùng chính file Marico_Decor.xlsx — đã baked sẵn: header/tổng peach, tên xanh
  // #0070C0, Chi Tiết nghiêng, khối From có nhãn "From: / Add:" + logo GIA NGUYỄN.
  // (Nhãn "Ms." nhúng cứng ở B3/E3 nay bị xoá lúc xuất — danh xưng do người dùng tự gõ.)
  // Code chỉ: đổ dữ liệu, tô xanh hàng nhóm A/B, đổi số tiền tổng sang đen, in "Ghi chú".
  marico_decor: {
    sheetName: "Décor",
    filePath: "templates/Marico_Decor.xlsx",
    displayName: "GN (không ngày)",
    cleanup: {
      extraCellsToClear: [
        "J16",   // ghi chú lạc ở cột xa (mẫu Marico) — không thuộc bảng báo giá
        // ── XOÁ NHÃN "Ms." NHÚNG CỨNG TRONG FILE MẪU ────────────────────────
        // B3 và E3 của Marico_Decor.xlsx chứa đúng chuỗi "Ms." — hai Ô NHÃN riêng, không phải ô
        // dữ liệu. Tên người đi vào C3 (bên nhận) và F3 (bên gửi), nên hai ô này KHÔNG BAO GIỜ bị
        // ghi đè và file xuất ra luôn mang "Ms." dù thực tế là ai.
        //
        // ĐÃ THẤY TRÊN FILE THẬT: người dùng gõ "Mr. Tài" vào ô Người liên hệ, file xuất ra ghi
        //     Ms.   Mr. Tài
        // Vừa sai giới tính, vừa lặp danh xưng. Bên gửi cũng vậy: "Ms. Lan Anh _ Account_…".
        //
        // Danh xưng nay do NGƯỜI DÙNG TỰ GÕ vào ô Người liên hệ / Người gửi — họ biết khách là ai,
        // template thì không. Xoá nhãn chứ không đoán hộ.
        "B3",   // nhãn "Ms." của khối To (tên khách ở C3)
        "E3",   // nhãn "Ms." của khối From (người gửi ở F3)
      ],
      keepImagesAboveRow: 11,   // giữ logo GIA NGUYỄN (F2); bỏ ảnh khác dưới header (nếu có)
    },
    cells: {
      toCompany:   "C2",        // nhãn "To:" ở B2. (B3 từng là nhãn "Ms." — nay xoá, xem extraCellsToClear)
      toContact:   "C3",
      fromContactCell: "F3",
      // 1 dòng như mẫu: "Hồng Tôn _ AccountTeam_0914291951". (E3 từng là nhãn "Ms." — nay xoá.)
      fromContactFormat: ({ contact, title, phone }: { contact: string | null | undefined; title: string | null | undefined; phone: string | null | undefined }) =>
        [[contact, title].filter(Boolean).join(" _ "), phone].filter(Boolean).join("_"),
      fromAddress: "F4",        // nhãn "Add:" đã có sẵn ở E4; nhãn "From:" ở E2 + logo F2
      date:        "B6",
      title:       "B7",
      titleFormat: baoGiaTitle,
      quoteNumber: "B8",
      quoteNumberFormat: (n: string | null | undefined) => (n ? `(Số://${n})` : ""),
      greeting:    "B9",
    },
    items: {
      firstRow: 12,
      headerRow: 11,   // hàng tiêu đề cột (STT/Hạng Mục…) → đổi nền qua code
      lastRow:  21,
      styleRow: 12,              // copy style hàng 12 (tên xanh, viền) ra mọi hàng
      // Chi Tiết bị BỎ khỏi bảng Excel: header + mọi ô C:D được gộp thành một cột Hạng Mục rộng.
      // Cột vật lý D chỉ còn là phần của ô gộp để công thức báo giá cũ không bị dịch địa chỉ.
      removeDetail: true,
      columnWidths: { C: 38, D: 10 },
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
      amountFormula: (r: number) => `G${r}*F${r}`,
    },
    totals: {
      subtotal: {
        labelCells: [["F", "G"]],
        labelText: () => "Tổng Cộng",
        // Sheet CÓ Discount → dòng này là số CHƯA trừ nên đổi nhãn thành "Cộng", còn nhãn
        // "Tổng Cộng" tụt xuống dòng sau Discount (excel.ts dựng hai hàng đó).
        labelTextGross: () => "Cộng",
        valueCell: "H",
        rowOffset: 1,
        formula: ({ first, last }: { first: number; last: number; subtotalRow: number }) => `SUM(H${first}:H${last})`,
      },
      vat: {
        labelCells: [["F", "G"]],
        labelText: (vatPct: number) => `VAT (${vatPct}%)`,
        valueCell: "H",
        rowOffset: 2,
        formula: ({ subtotalRow, vatPct }: { subtotalRow: number; vatPct: number }) => `H${subtotalRow}*${vatPct}%`,
      },
      discount: {
        labelCells: [["F", "G"]],
        labelText: () => "Discount",
        valueCell: "H",
      },
      total: {
        labelCells: [["F", "G"]],
        labelText: () => "Thành Tiền",
        valueCell: "H",
        rowOffset: 3,
        formula: ({ subtotalRow, vatRow, discountRow }: { subtotalRow: number; vatRow: number; discountRow: number | null }) =>
          discountRow ? `H${subtotalRow}+H${vatRow}-H${discountRow}` : `H${subtotalRow}+H${vatRow}`,
      },
    },
    // Header/tổng/tên đã baked sẵn màu trong template → chỉ cần: tô xanh hàng nhóm,
    // đổi số tiền tổng sang đen (mẫu gốc để đỏ), và in "Ghi chú" 1 dòng dưới phần tổng.
    palette: {
      sectionFill:      "FFE2EFDA",   // xanh lá nhạt — hàng nhóm A/B/C
      sectionTextColor: "FF000000",   // A/B + tên nhóm: đen đậm (đè màu baked của slot)
      totalsValueColor: "FF000000",   // số tiền tổng: đen
      note: { rowOffset: 1, colFrom: "B", colTo: "I", color: "FF843C0C" },  // "Ghi chú:" nâu (font nền → hiện ngay)
      // Cuối báo giá (cân đối kiểu GN gốc): lời chào canh TRÁI (cột B:F) + "Ý Kiến Khách
      //   Hàng" canh giữa cột PHẢI (G:I) CÙNG hàng → 2 cột cân đối; rồi CHỪA chỗ ký+đóng dấu.
      footer: {
        rowOffset: 2,                       // "Rất mong" = totalRow + 2 (Ghi chú ở +1)
        left: {
          lines: ["Rất mong nhận được sự phúc đáp sớm từ Quí công ty", "Trân trọng kính chào"],
          from: "B", to: "F",               // lời chào: cột trái, canh trái
        },
        customer: { text: "Ý Kiến Khách Hàng", from: "G", to: "I", rowOffset: 2 },  // phải, cùng hàng
        sign: {
          gapRowOffset: 4, gapRows: 4, gapRowHeight: 20,  // chừa chỗ ký + đóng dấu
          showSender: false,                              // KHÔNG in tên người gửi
        },
      },
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
      toBlockFormat: ({ company, contact, email, phone, address }: { company: string | null | undefined; contact: string | null | undefined; email: string | null | undefined; phone: string | null | undefined; address: string | null | undefined }) => {
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
      fromBlockFormat: ({ companyName, contact, title, phone, address }: { companyName: string | null | undefined; contact: string | null | undefined; title: string | null | undefined; phone: string | null | undefined; address: string | null | undefined }) => {
        const lines: string[] = [];
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
      headerRow: 4,
      paintHeader: false,      // giữ màu header baked riêng của Colorfull
      // Colorfull (CLF): GIỮ màu cũ — KHÔNG dùng màu Gia Nguyễn. Header để baked (không repaint),
      // nền nhóm dùng màu cũ #fcefdb/#eaf1fb.
      sectionFill: "FFFCEFDB", subFill: "FFEAF1FB",
      lastRow:  12,
      styleRow: 6,            // copy this clean row's borders/fonts to every item row
      // ── CỘT CHI TIẾT: BẬT, VÀ CHỈ RIÊNG COLORFULL ────────────────────────────────────────
      // Mẫu này được DỰNG QUANH cột Chi Tiết, xem chính file `templates/CLF_KhongNgay.xlsx`:
      //   · D4 là ô tiêu đề "Chi Tiết" có sẵn (không phải code sinh ra);
      //   · bề rộng cột trong file: C = 21.2 mà D = 50 — D là cột RỘNG NHẤT của bảng;
      //   · các dòng mẫu D6:D12 chứa đúng loại nội dung của cột này ("Bàn check in: bàn dán AW",
      //     "Backdrop: / . KT: 14mW x 5mH / . Khung sắt…").
      // Cấu hình cũ đặt `removeDetail: true` + bóp `D: 10` rồi gộp vào Hạng Mục, tức xoá đúng
      // cột kể nội dung của mẫu. Và nó xoá THẬT dữ liệu người dùng đã có: đường nhập Excel
      // (`excelImport.ts:460`) vẫn đọc cột này vào `it.detail` — đo trên production 2026-09-18 có
      // 64 hạng mục đang giữ nội dung Chi Tiết — nên file Colorfull gửi sang CÓ cột đó, app lưu
      // lại, rồi trả về cho khách một file MẤT cột đó.
      //
      // BẬT LẠI KHÔNG DỊCH ĐỊA CHỈ Ô NÀO. `detail: "D"` vốn đã khai, nên `metaService` trả
      // `reserveDetail: true` và `GridTable.tsx:354` (`keepDetailSlot`) vẫn chừa khe D từ trước:
      // cờ này chỉ đổi việc HIỆN cột, không đổi sơ đồ chữ cột. Mọi công thức đã lưu giữ nguyên
      // nghĩa, kể cả loại trỏ theo địa chỉ (`{"quantity":"=E3"}` — E vẫn là Số Lượng).
      //
      // GN KHÔNG ĐỔI: `clofull_decor` là object RIÊNG, không spread từ `marico_decor`. Hai mẫu
      // spread từ GN là `gn_banner` và `unibenfood`, cả hai nằm ngoài khối này.
      removeDetail: false,
      // Trả về đúng bề rộng thiết kế trong file (C 21 / D 50) thay vì C 38 / D 10 của thời gộp cột.
      columnWidths: { C: 21, D: 50 },
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
      amountFormula: (r: number) => `G${r}*F${r}`,
    },
    totals: {
      subtotal: {
        labelCells: [["B", "G"]],
        labelText: () => "Tổng Cộng",
        // Sheet CÓ Discount → dòng này là số CHƯA trừ nên đổi nhãn thành "Cộng", còn nhãn
        // "Tổng Cộng" tụt xuống dòng sau Discount (excel.ts dựng hai hàng đó).
        labelTextGross: () => "Cộng",
        valueCell: "H",
        rowOffset: 1,
        formula: ({ first, last }: { first: number; last: number; subtotalRow: number }) => `SUM(H${first}:H${last})`,
      },
      vat: {
        labelCells: [["B", "G"]],
        labelText: (vatPct: number) => `VAT(${vatPct}%)`,
        valueCell: "H",
        rowOffset: 2,
        formula: ({ subtotalRow, vatPct }: { subtotalRow: number; vatPct: number }) => `H${subtotalRow}*${vatPct}%`,
      },
      // Hàng "Discount" — CHỈ chèn khi sheet có Discount, nằm NGAY DƯỚI dòng "Cộng". Dòng
      // "Tổng Cộng" kế tiếp = Cộng + Discount (ghi số ÂM), rồi VAT mới tính trên "Tổng Cộng".
      // Xem khối tổng trong src/excel.ts.
      discount: {
        labelCells: [["B", "G"]],
        labelText: () => "Discount",
        valueCell: "H",
      },
      total: {
        labelCells: [["B", "G"]],
        labelText: () => "Thành Tiền",
        valueCell: "H",
        rowOffset: 3,
        formula: ({ subtotalRow, vatRow, discountRow }: { subtotalRow: number; vatRow: number; discountRow: number | null }) =>
          discountRow ? `H${subtotalRow}+H${vatRow}-H${discountRow}` : `H${subtotalRow}+H${vatRow}`,
      },
    },
  },

};

// ===== GN (không ngày) — bản BANNER =====
// Y HỆT GN không ngày (cùng cột/công thức/cách xuất), CHỈ khác
// ── FILE MẪU: `templates/Marico_Decor.xlsx`, kế thừa qua phép spread bên dưới. KHÔNG phải
// GN_KhongNgay.xlsx như chú thích cũ ghi — `excel.ts:1498` đọc `cfg.filePath`, tức đường dẫn
// trong config này, chứ KHÔNG đọc `QuoteTemplate.filePath` dưới CSDL. Nên nhãn "Ms." nhúng cứng
// ở B3/E3 của Marico_Decor.xlsx dính CẢ gn_banner, và bản vá xoá nhãn cũng theo spread mà sang.
// cách đánh STT: NHÓM CON đánh số 1,2,3… (reset theo từng nhóm chính), các MỤC bên dưới
// nhóm con KHÔNG đánh số. Bật bằng cờ items.numberSubsections (excel.js + editor.js đọc cờ này).
TEMPLATE_CONFIGS.gn_banner = {
  ...TEMPLATE_CONFIGS.marico_decor,
  sheetName: "GN Banner",
  displayName: "GN Banner (không ngày)",
  items: { ...TEMPLATE_CONFIGS.marico_decor.items, numberSubsections: true },
};

// ===== GN — CÓ NGÀY =====
// BÊ NGUYÊN NỀN CỦA BẢN KHÔNG-NGÀY (`marico_decor`). Khác đúng hai thứ: có cột SỐ NGÀY, và Thành
// Tiền nhân thêm thừa số đó. Mọi quy tắc còn lại — hàng, nhóm A/B/C, nhóm con, cách dọn mẫu, khối
// Tổng/VAT/Thành tiền, vị trí ô thông tin khách, xoá nhãn "Ms." — đi theo bản không-ngày.
//
// ── VÌ SAO BỎ `templates/Unibenfood.xlsx` ─────────────────────────────────
// Bản cũ hỏng ở hai chỗ độc lập, cả hai đo được trên file thật xuất từ production (báo giá #40,
// trang "Premiere"):
//   1. HAI DÒNG TIÊU ĐỀ TRÙNG NHAU (r10 và r11 y hệt). Lỗi nằm NGAY TRONG FILE MẪU nên mọi file
//      khách nhận được đều mang theo. Marico_Decor.xlsx chỉ có đúng một dòng, ở r11.
//   2. Bố cục lệch hẳn bản không-ngày → mọi bản vá phải làm HAI LẦN. Gần nhất: xoá nhãn "Ms."
//      nhúng cứng ở B3/E3 chỉ vá được cho nền Marico, bản có-ngày không hưởng.
// Dùng chung một nền thì cả hai lớp lỗi đó biến mất cùng lúc.
//
// ── BỐ CỤC ────────────────────────────────────────────────────────────────
//   B     C          D     E          F         G        H            I
//   STT   Hạng Mục   ĐVT   SỐ LƯỢNG   SỐ NGÀY   ĐƠN GIÁ  THÀNH TIỀN   GHI CHÚ
//
// Cột "Chi Tiết" KHÔNG tồn tại ở bản này — và đó KHÔNG phải bước lùi: bản không-ngày cũng không
// hiện nó trong file xuất ra (`removeDetail: true` gộp C:D thành một cột Hạng Mục rộng), còn bản
// có-ngày CŨ cũng chưa từng có. Ở đây cột đó biến mất THẬT, không phải bị ẩn.
//
// File mẫu dựng lại được: node scripts/dung-mau-co-ngay.mjs
TEMPLATE_CONFIGS.unibenfood = {
  ...TEMPLATE_CONFIGS.marico_decor,
  filePath: "templates/GN_CoNgay.xlsx",
  displayName: "GN (có ngày)",
  items: {
    ...TEMPLATE_CONFIGS.marico_decor.items,
    // Cờ này ở bản không-ngày dùng để GỘP C:D cho khỏi lộ cột Chi Tiết. Ở đây để `false` cho khỏi
    // gây hiểu nhầm, nhưng nó VÔ HIỆU dù đặt gì: mọi nhánh đọc nó trong src/excel.ts đều bị chặn
    // bởi `cols.detail` (dòng 485, 525, 555, 783, 844), mà bảng `columns` bên dưới KHÔNG khai
    // `detail`. Chính việc THIẾU khoá `detail` mới là thứ làm cột Chi Tiết biến mất — không phải
    // cờ này. Ghi rõ ra vì một dòng cấu hình trông như đang điều khiển thứ gì đó mà thật ra không
    // là loại chú thích tự nó sai.
    removeDetail: false,
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
    // Khác bản không-ngày (`G*F`) ĐÚNG ở thừa số `F` — số ngày.
    amountFormula: (r: number) => `G${r}*E${r}*F${r}`,
  },
};


export function getConfig(code: string) {
  const c = TEMPLATE_CONFIGS[code];
  if (!c) throw new Error(`Không có config cho template code: ${code}`);
  return c;
}
