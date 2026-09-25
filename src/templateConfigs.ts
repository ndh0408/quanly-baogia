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
      // KHÔNG khai `sectionFill`/`sectionTextColor` ở đây: `src/excel.ts` tô hàng nhóm bằng
      // `itemsCfg.sectionFill` (nhánh `items`, KHÔNG phải `palette`), nên hai khoá đó từng nằm
      // đây là KHOÁ CHẾT — không đường nào đọc, mà còn ghi sai màu thật: khai FFE2EFDA trong khi
      // tệp GN xuất ra là FFFAE9DB (giá trị dự phòng đóng cứng ở excel.ts). Cấu hình nói một đằng
      // mã làm một nẻo đúng là thứ đã gây ra lỗi cộng đôi tiền của Colorfull hôm nay, nên dọn.
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
      // ── XOÁ TÊN NGƯỜI KÝ NHÚNG CỨNG TRONG FILE MẪU (G22) ───────────────────
      // `templates/CLF_KhongNgay.xlsx` mang sẵn chuỗi "Trần Thị Lan Anh" ở ô G22, ngay dưới dòng
      // "Công Ty TNHH Colorfull" của khối ký. Nó KHÔNG phải ô dữ liệu — không đường nào ghi đè —
      // nên MỌI báo giá Colorfull, do bất kỳ ai gửi, đều ra file khách với tên một người cụ thể
      // đứng ở chỗ ký, trong khi người gửi thật nằm ở khối F1 phía trên. Hai tên khác nhau trên
      // cùng một tờ.
      //
      // ĐÚNG LỚP LỖI GN ĐÃ VÁ: nhãn "Ms." nhúng cứng ở B3/E3 của mẫu Marico (xem extraCellsToClear
      // của `marico_decor`), và GN chốt hẳn `palette.footer.sign.showSender: false` — "KHÔNG in tên
      // người gửi". Theo đúng quyết định đó: xoá tên, chừa chỗ trống để ký tay; dòng tên công ty
      // ở G18 giữ nguyên.
      // C3 = chữ mồi "logo cty khách hàng" (chữ ĐỎ) nằm sẵn trong file mẫu. Tính năng logo khách
      // đã gỡ khỏi cả giao diện lẫn máy chủ, nên chữ này phải biến mất — trước đây nó chỉ được thay
      // khi báo giá CÓ logo, tức gần như mọi file gửi khách đều in nguyên dòng chữ đỏ đó.
      extraCellsToClear: ["J5", "J8", "G22", "C3"],
      keepImagesAboveRow: 3,
    },
    cells: {
      title:       "B2",
      titleFormat: baoGiaTitle,
      // KHỐI "KÍNH GỬI" RA GIỮA TRANG. Mẫu gốc đặt nó ở F3 (gộp F3:I3) để chừa chỗ bên trái cho ô
      // logo khách hàng; nay tính năng đó đã gỡ nên khối này dạt sang phải một cách vô cớ, lệch hẳn
      // bố cục của bản GN. `headerMerges` gộp lại C3:I3 và `toBlockCenter` canh giữa.
      toBlockCell: "C3",
      toBlockCenter: true,
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
      // Mã báo giá = dòng CUỐI của khối trên, đúng chuỗi của GN (`quoteNumberFormat` của marico_decor).
      // Không có mã thì không in dòng nào. Vì sao không đặt ô riêng: xem chỗ đọc khoá này ở src/excel.ts.
      toBlockCodeFormat: (n: string | null | undefined) => (n ? `(Số://${n})` : ""),
      // "TP.HCM , ngày …" footer date — written from the quote's date (was a
      // hard-coded 05/07/2018 in the template, never updated before).
      date:        "G17",
      // "* Thông tin chương trình" banner (B5:I5). Filled from the quote's optional
      // info row(s); cleared when there are none so the "….." placeholder never prints.
      infoBannerCell: "B5",
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
    // Gộp lại đầu trang sau khi bỏ ô logo khách: khối "Kính gửi" phủ C3:I3 và canh giữa.
    headerMerges: ["C3:I3"],
    // Ô "* Ghi chú" có sẵn trong mẫu — nay CHỈ in khi người dùng bật ô Ghi chú ở màn soạn.
    noteFooterRange: "C17:D17",
    items: {
      firstRow: 6,
      headerRow: 4,
      paintHeader: false,      // giữ màu header baked riêng của Colorfull
      // Colorfull (CLF): GIỮ màu cũ — KHÔNG dùng màu Gia Nguyễn. Header để baked (không repaint),
      // nền nhóm theo bảng màu riêng của Colorfull (bên dưới).
      // MÀU LẤY TỪ CHÍNH FILE MẪU ANH ĐÃ CHỈNH HOÀN CHỈNH
      // ("Copy of Copy of E2E_-_Nhap_tu_Excel_091-new4.xlsx", bản sửa 2026-09-23, đọc bằng exceljs):
      //     hàng NHÓM      = F4CFB0 (cam đào)     · chữ Times 11 đậm
      //     hàng NHÓM CON  = CAD8AA (xanh ô-liu)  · chữ Times 11 đậm màu 4F513E
      // Lịch sử: FCEFDB / EAF1FB → F6D479 / D5DDA2 → nay. Đổi ở đây là `excelImport.ts` tự nhận màu
      // mới; màu cũ đã phát hành phải giữ trong danh sách chép tay ở đó (tệp khách còn giữ).
      // Tiêu đề cột · dải tiêu đề · khối tổng là nền NƯỚNG SẴN trong file mẫu (9DCCC9 / 9CCDC9 —
      // xem scripts/doi-mau-clf.mjs), nên không khai ở đây — `paintHeader: false` để app KHÔNG tô đè.
      sectionFill: "FFF4CFB0", subFill: "FFCAD8AA",
      // MÀU CHỮ, đo từ cùng tệp mẫu ấy (đừng chỉ lấy màu nền — đợt trước bỏ quên đúng hai dòng
      // này nên hàng nhóm ra chữ CAM-NÂU FF9A5B14 và nhóm con ra chữ XANH DƯƠNG FF1F4E79):
      //     hàng NHÓM     = theme5 tint -0.25  (accent2 #C0504D → #953735, đỏ gạch)
      //     hàng NHÓM CON = FF4F513E           (xanh rêu đậm)
      // Giữ nguyên dạng THEME cho hàng nhóm thay vì đóng cứng #953735: tệp mẫu khai bằng theme,
      // ghi lại y như vậy thì đổi bảng màu của tệp mẫu là chữ đi theo, không lệch ra.
      sectionTextColor: { theme: 5, tint: -0.25 },
      subTextColor: "FF4F513E",
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
      // (`src/excelImport.ts`, dòng `it.detail = textAt(r, "detail")`) vẫn đọc cột này vào `it.detail` — đo trên production 2026-09-18 có
      // 64 hạng mục đang giữ nội dung Chi Tiết — nên file Colorfull gửi sang CÓ cột đó, app lưu
      // lại, rồi trả về cho khách một file MẤT cột đó.
      //
      // BẬT LẠI KHÔNG DỊCH ĐỊA CHỈ Ô NÀO. `detail: "D"` vốn đã khai, nên `metaService` trả
      // `reserveDetail: true` và `web/src/components/GridTable.tsx` (`keepDetailSlot`) vẫn chừa khe D từ trước:
      // cờ này chỉ đổi việc HIỆN cột, không đổi sơ đồ chữ cột. Mọi công thức đã lưu giữ nguyên
      // nghĩa, kể cả loại trỏ theo địa chỉ (`{"quantity":"=E3"}` — E vẫn là Số Lượng).
      //
      // GN KHÔNG ĐỔI: `clofull_decor` là object RIÊNG, không spread từ `marico_decor`. Hai mẫu
      // spread từ GN là `gn_banner` và `unibenfood`, cả hai nằm ngoài khối này.
      removeDetail: false,
      // Khung ngoài DÀY như bản GN (đo trên file xuất: GN có viền 'medium' ở cạnh trên tiêu đề và
      // hai cạnh bên; mẫu Colorfull vốn chỉ có 'thin' nên bảng trông mỏng hơn hẳn khi đặt cạnh).
      outerFrame: true,
      // BỀ RỘNG CÂN LẠI GIỮA HAI CỘT. File mẫu để C 21 / D 50 — hợp với cách Colorfull tự soạn
      // (tên ngắn, mô tả dài nằm ở Chi Tiết). Nhưng dữ liệu thật chuyển từ nếp Gia Nguyễn sang thì
      // ngược lại: tên dài ("Banner khu khách ngồi chờ: 8m2W x 2m9H") mà Chi Tiết ngắn (". PP in
      // KTS") — đo trên file xuất: cột Hạng Mục rộng 21 làm chữ bị cắt mất dòng, còn Chi Tiết rộng
      // 50 thì bỏ trống quá nửa. Chia lại cho hai bên cùng đủ chỗ; tổng bề ngang bảng KHÔNG tăng.
      //
      // CỘT STT BẰNG ĐÚNG GN (6,63 — `cols` của Marico_Decor.xlsx). Mẫu để 12,36 cho một cột chỉ chứa
      // "A" / "1".."99" — người dùng chỉ ra ô STT "bự quá" (2026-09-25). Phần bề rộng dôi ra dồn hết
      // cho Hạng Mục, tính cho B + C giữ đúng số px cũ (87 + 238 = 46 + 279): mép cột D không xê dịch
      // nên logo COLORFUL (neo B → D) giữ nguyên hình, và tổng bề ngang bảng vẫn không đổi.
      //
      // THÀNH TIỀN (H) 15 → 17,1, lấy đúng phần đó từ GHI CHÚ (I) 16,18 → 14 (105 + 113 = 120 + 98 px):
      // nhãn nay xuống dòng "THÀNH TIỀN / (VNĐ)" như GN, mà ở cỡ 12 đậm (GN cỡ 10) chữ "THÀNH TIỀN" không
      // vừa cột 15 — Excel COM đo ra nó tự ngắt "THÀNH / TIỀN" (tests/xl-cao-hang-tieu-de-cot.test.js),
      // tức nhãn thành 3 dòng và hàng tiêu đề cao ~50pt. Ở 17,1 nó nằm gọn một dòng.
      columnWidths: { B: 6.6328125, C: 39.8, D: 30, H: 17.1, I: 14 },
      // "(VNĐ)" sau Đơn Giá / Thành Tiền, đúng cách GN viết (G11/H11 của Marico_Decor.xlsx).
      headerLabels: { unitPrice: "ĐƠN GIÁ\n(VNĐ)", amount: "THÀNH TIỀN\n(VNĐ)" },
      // Tên hạng mục có màu như GN (GN: xanh 0070C0), nhưng theo tông của chính Colorfull: cùng sắc
      // độ với nền tiêu đề cột 9DCCC9 (176°), hạ độ sáng xuống 30% cho đọc được trên nền trắng
      // (tương phản ≈ 5,3:1, ngang xanh GN). Mẫu để đen (theme 1).
      nameTextColor: "FF227771",
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
        labelText: (vatPct: number) => `VAT(${vatPct}%)`,
        valueCell: "H",
        rowOffset: 2,
        formula: ({ subtotalRow, vatPct }: { subtotalRow: number; vatPct: number }) => `H${subtotalRow}*${vatPct}%`,
      },
      // Hàng "Discount" — CHỈ chèn khi sheet có Discount, nằm NGAY DƯỚI dòng "Cộng". Dòng
      // "Tổng Cộng" kế tiếp = Cộng + Discount (ghi số ÂM), rồi VAT mới tính trên "Tổng Cộng".
      // Xem khối tổng trong src/excel.ts.
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
    // ── GHI CHÚ CUỐI BÁO GIÁ: DÙNG Ô CÓ SẴN CỦA MẪU, KHÔNG DỰNG DÒNG MỚI ──────────────────
    // Mẫu Colorfull đã có sẵn ô "* Ghi chú" (gộp C17:D17) ngay dưới khối tổng — nhưng nó mang chữ
    // NHÚNG CỨNG "- Tất cả các hạng mục trên là cho thuê, Colofull thu hồi sau khi tháo dỡ" (chú ý
    // cả lỗi chính tả tên công ty trong file mẫu). Chữ đó in ra MỌI báo giá kể cả khi người dùng
    // KHÔNG bật ô "Thêm Ghi chú" ở màn soạn — người dùng báo đúng chỗ này.
    // Nay ô đó do `quote.notes` điều khiển: bật thì in ghi chú của người dùng, không bật thì KHÔNG
    // in gì. Giống hệt cách GN làm, chỉ khác là GN dựng dòng mới còn đây dùng ô sẵn có.
    // (Vì vậy KHÔNG khai `palette.note` — khai cả hai thì ghi chú in hai lần.)
  },

};

// ===== GN (không ngày) — bản BANNER =====
// Y HỆT GN không ngày (cùng cột/công thức/cách xuất), CHỈ khác
// ── FILE MẪU: `templates/Marico_Decor.xlsx`, kế thừa qua phép spread bên dưới. KHÔNG phải
// GN_KhongNgay.xlsx như chú thích cũ ghi — `src/excel.ts` (chỗ đọc `cfg.filePath`) đọc `cfg.filePath`, tức đường dẫn
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

// ===== Colorfull — bản BANNER (không ngày) =====
// Y HỆT `clofull_decor` (cùng FILE MẪU, cùng cột, cùng công thức, cùng cách xuất), CHỈ khác cách
// đánh STT: nhóm con đánh số 1,2,3… còn mục bên dưới không đánh số. Đúng quan hệ mà `gn_banner` có
// với `marico_decor` bên Gia Nguyễn — cùng một khái niệm "bản banner", nên cùng một cách làm.
//
// KHÔNG cần file mẫu riêng, và đó là chủ ý: hai mẫu chung một file thì mọi bản vá bố cục (bề rộng,
// khối tổng, chân trang) tự động đúng cho cả hai. Bên GN cũng vậy — `gn_banner` dùng chính
// `Marico_Decor.xlsx`.
TEMPLATE_CONFIGS.clofull_banner = {
  ...TEMPLATE_CONFIGS.clofull_decor,
  sheetName: "CLF Banner",
  displayName: "CLF Banner (không ngày)",
  items: { ...TEMPLATE_CONFIGS.clofull_decor.items, numberSubsections: true },
};

// ===== Colorfull — CÓ NGÀY =====
// ── VÌ SAO BẢN NÀY CÓ FILE MẪU RIÊNG, TRONG KHI BÊN GN THÌ KHÔNG ──────────
// GN có-ngày (`unibenfood`) dùng lại nền không-ngày và CHỈ ĐỔI NHÃN CỘT — nó đủ chỗ vì đã HY SINH
// cột Chi Tiết: ô "Chi Tiết" ở D bị đổi thẳng thành "ĐVT". Colorfull không hy sinh được, vì Chi
// Tiết chính là cột kể nội dung của mẫu này (D rộng 50 — rộng nhất bảng). Cần CẢ Chi Tiết LẪN Số
// Ngày ⇒ bảng dài thêm một cột thật: 8 cột (B…I) thành 9 cột (B…J).
//
//   B     C          D          E     F           G          H         I             J
//   STT   Hạng Mục   Chi Tiết   ĐVT   SỐ LƯỢNG    SỐ NGÀY    ĐƠN GIÁ   THÀNH TIỀN    Ghi Chú
//
// File mẫu dựng lại được, và script tự soi lại đầu ra:  node scripts/dung-mau-clf-co-ngay.mjs
//
// MỌI TOẠ ĐỘ TỪ CỘT G TRỞ ĐI ĐỀU DỊCH MỘT CỘT so với bản không-ngày — kể cả những thứ không thuộc
// bảng: ô ngày ở chân trang đi từ `G17` sang `H17`. Khai lại trọn bộ `cells`/`totals` thay vì
// spread rồi sửa lẻ, để đọc một chỗ là thấy hết toạ độ thật của mẫu này.
TEMPLATE_CONFIGS.clofull_conngay = {
  ...TEMPLATE_CONFIGS.clofull_decor,
  filePath: "templates/CLF_CoNgay.xlsx",
  displayName: "CLF (có ngày)",
  cells: {
    ...TEMPLATE_CONFIGS.clofull_decor.cells,
    date: "H17",   // bản không-ngày: G17 — dịch theo cột Số Ngày vừa chèn
  },
  // Mọi toạ độ ngang đều dịch một cột theo cột SỐ NGÀY vừa chèn.
  headerMerges: ["C3:J3"],
  cleanup: {
    ...TEMPLATE_CONFIGS.clofull_decor.cleanup,
    // Toạ độ dịch theo cột Số Ngày đã chèn:
    //   · tên người ký nhúng cứng  G22 → H22  (xem chú thích ở `clofull_decor`);
    //   · hai ô chú thích cho lập trình viên J5/J8 → K5/K8. Script dựng mẫu đã dọn sẵn chúng, giữ
    //     ở đây là lớp chắn thứ hai — VÀ để KHÔNG kế thừa "J5"/"J8" của bản không-ngày, vì ở mẫu
    //     9 cột thì J chính là cột GHI CHÚ thật của người dùng, xoá nhầm là mất ghi chú hàng 3.
    extraCellsToClear: ["K5", "K8", "H22"],
  },
  items: {
    ...TEMPLATE_CONFIGS.clofull_decor.items,
    columns: {
      stt:       "B",
      name:      "C",
      detail:    "D",
      unit:      "E",
      quantity:  "F",
      days:      "G",
      unitPrice: "H",
      amount:    "I",
      notes:     "J",
    },
    // Cùng ý nghĩa với GN có-ngày (`G*E*F` = đơn giá × số lượng × số ngày), chỉ khác chữ cột.
    amountFormula: (r: number) => `H${r}*F${r}*G${r}`,
    // `columnWidths` khoá theo CHỮ cột nên phải dịch như mọi toạ độ khác: Thành Tiền / Ghi Chú ở I / J.
    // Tệp mẫu có-ngày để I 15 · J 16,18 — y cặp H/I của bản không-ngày, nên cùng số.
    columnWidths: { B: 6.6328125, C: 39.8, D: 30, I: 17.1, J: 14 },
  },
  totals: {
    subtotal: {
      labelCells: [["G", "H"]],
      labelText: () => "Tổng Cộng",
      labelTextGross: () => "Cộng",
      valueCell: "I",
      rowOffset: 1,
      formula: ({ first, last }: { first: number; last: number; subtotalRow: number }) => `SUM(I${first}:I${last})`,
    },
    vat: {
      labelCells: [["G", "H"]],
      labelText: (vatPct: number) => `VAT(${vatPct}%)`,
      valueCell: "I",
      rowOffset: 2,
      formula: ({ subtotalRow, vatPct }: { subtotalRow: number; vatPct: number }) => `I${subtotalRow}*${vatPct}%`,
    },
    discount: {
      labelCells: [["G", "H"]],
      labelText: () => "Discount",
      valueCell: "I",
    },
    total: {
      labelCells: [["G", "H"]],
      labelText: () => "Thành Tiền",
      valueCell: "I",
      rowOffset: 3,
      formula: ({ subtotalRow, vatRow, discountRow }: { subtotalRow: number; vatRow: number; discountRow: number | null }) =>
        discountRow ? `I${subtotalRow}+I${vatRow}-I${discountRow}` : `I${subtotalRow}+I${vatRow}`,
    },
  },
};


export function getConfig(code: string) {
  const c = TEMPLATE_CONFIGS[code];
  if (!c) throw new Error(`Không có config cho template code: ${code}`);
  return c;
}
