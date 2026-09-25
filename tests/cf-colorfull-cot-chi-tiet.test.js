/**
 * ============================================================================
 * COLORFULL CÓ CỘT CHI TIẾT — VÀ RIÊNG COLORFULL.
 *
 * ── CÁI SAI ĐÃ CHẠY THẬT ───────────────────────────────────────────────────
 * `templates/CLF_KhongNgay.xlsx` được DỰNG QUANH cột Chi Tiết:
 *   · D4 là ô tiêu đề "Chi Tiết" nằm sẵn trong file (code không sinh ra nó);
 *   · bề rộng trong file: C = 21.2 mà D = 50 — D là cột RỘNG NHẤT của bảng;
 *   · dòng mẫu D6:D12 chứa đúng loại nội dung của cột đó ("Bàn check in: bàn dán AW",
 *     "Backdrop: / . KT: 14mW x 5mH / . Khung sắt…").
 * Vậy mà `clofull_decor.items` lại đặt `removeDetail: true` và bóp `D: 10`, tức GỘP cột kể nội
 * dung của mẫu vào ô Hạng Mục.
 *
 * Và nó không chỉ là chuyện trình bày — nó XOÁ dữ liệu người dùng ĐÃ CÓ. Đường nhập Excel
 * (`excelImport.ts`, vai trò "CHI TIET") vẫn đọc cột này vào `it.detail`: đo trên production ngày
 * 2026-09-18 có 64 hạng mục đang giữ nội dung Chi Tiết. Nghĩa là file Colorfull gửi sang CÓ cột
 * đó, app lưu lại, rồi trả về cho khách một file MẤT cột đó — mà còn kèm một câu cảnh báo nói
 * ngược với thực tế: "nội dung đó sẽ không được nạp" (nạp rồi, chỉ là bị che).
 *
 * ── VÌ SAO BẬT LẠI KHÔNG LÀM VỠ CÔNG THỨC (vế quan trọng nhất) ──────────────
 * Khoá `detail: "D"` VỐN ĐÃ khai trong `columns`, nên `metaService` trả `reserveDetail: true` và
 * `GridTable.tsx` (`keepDetailSlot`) đã chừa khe D trong SƠ ĐỒ ĐỊA CHỈ từ trước — kể cả lúc cột bị
 * ẩn. Cờ `removeDetail` chỉ điều khiển việc HIỆN cột. Nên 307 công thức đã lưu (đo cùng ngày) giữ
 * nguyên nghĩa, trong đó 40 cái trỏ theo địa chỉ ô kiểu `{"quantity":"=E3"}` — E vẫn là Số Lượng.
 * Cụm bài cuối tệp khoá đúng điều đó: thứ tự khe địa chỉ KHÔNG đổi.
 *
 * ── VẾ ĐỐI TRỌNG: GN PHẢI KHÔNG ĐỔI ────────────────────────────────────────
 * Yêu cầu là "Chi Tiết chỉ của Colorfull". `clofull_decor` là object RIÊNG (không spread từ
 * `marico_decor`), còn `gn_banner`/`unibenfood` mới spread từ GN — nhưng "đọc code thấy nó riêng"
 * không phải bằng chứng đủ mạnh cho một thứ đi ra ngoài cho khách. Nên ba mẫu GN được kiểm THẬT
 * ở đây: vẫn gộp C:D, vẫn không có chữ "Chi Tiết" nào trong bảng.
 * ============================================================================
 */
import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { buildQuoteBuffer } from "../src/excel.js";
import { getConfig } from "../src/templateConfigs.js";
import { parseQuoteWorkbook } from "../src/excelImport.js";

const chu = (v) =>
  v && typeof v === "object" && Array.isArray(v.richText)
    ? v.richText.map((x) => x.text).join("")
    : v && typeof v === "object" && v.formula
      ? `=${v.formula}`
      : String(v ?? "");

/** Nội dung Chi Tiết lấy ĐÚNG hình dạng thật của Colorfull: nhiều dòng, có ". KT:". */
const CT_1 = "Bàn check in: bàn dán AW";
const CT_2 = "Backdrop:\n. KT: 14mW x 5mH\n. Khung sắt, format dán decal in KTS";

const baoGia = (templateCode) => ({
  id: 1,
  quoteNumber: "CLF26999",
  title: "Thử Colorfull",
  toCompany: "Colorfull",
  toContact: "Mr. Tài",
  fromContact: "Lan Anh",
  fromTitle: "Account",
  fromPhone: "0914291951",
  fromAddress: "34 Đào Trí, P.Phú Thuận, TP.HCM",
  city: "TP. Hồ Chí Minh",
  quoteDate: new Date("2026-09-18T00:00:00Z"),
  vatPercent: 8,
  hnTables: [],
  sheets: [
    {
      id: 1, name: "CLF", order: 1, templateCode,
      groupSubtotal: false, discount: 0, extraTables: [],
      items: [
        { order: 1, kind: "item", name: "Khu Vực Check In", detail: CT_1, unit: "bộ", quantity: 3, unitPrice: 450_000, notes: "ghi chú A" },
        // NHÓM + hai hàng con: đây là chỗ merge dọc được dựng lại, và là chỗ dễ gộp lẫn cột nhất.
        { order: 2, kind: "section", name: "Booth cụm Typo", quantity: 1 },
        { order: 3, kind: "item", name: "Booth cụm Typo", detail: CT_2, unit: "m2", quantity: 70, unitPrice: 360_000 },
        { order: 4, kind: "item", name: "Booth cụm Typo", detail: "Đèn pha chiếu sáng", unit: "cái", quantity: 14, unitPrice: 300_000 },
      ],
    },
  ],
});

/** Bản CÓ NGÀY: thêm `days`, và mẫu clofull_conngay. */
const baoGiaNgay = () => {
  const q = baoGia("clofull_conngay");
  q.sheets[0].items = q.sheets[0].items.map((it) => (it.kind === "item" ? { ...it, days: 3 } : it));
  return q;
};

async function moFile(buf) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  return wb.worksheets[0];
}

/**
 * Địa chỉ Ô CHỦ của `addr` (chính nó nếu không nằm trong vùng gộp).
 *
 * Bản đầu của bài này dùng một hàm `gopNgang(addr)` hỏi "ô này có mượn giá trị từ cột khác
 * không". Hàm đó SAI cách hỏi: với chính ô chủ (C11 của vùng gộp C11:D11) thì `master === cell`
 * nên nó trả `false` — tức ca "CLF không gộp C:D" XANH mà chẳng kiểm gì, còn ca GN thì đỏ oan.
 * Hỏi đúng là: ô D thuộc về ai. Thuộc về C ⇒ Chi Tiết đã bị hút vào Hạng Mục; thuộc về chính nó
 * ⇒ Chi Tiết là một cột thật.
 */
function oChu(ws, addr) {
  const cell = ws.getCell(addr);
  return cell.isMerged && cell.master ? cell.master.address : cell.address;
}

const HANG_TIEU_DE = 4;
const HANG_DAU = 6;

describe("Colorfull — cột Chi Tiết hiện ra trong file xuất", () => {
  it("hàng tiêu đề giữ đủ 8 cột, D4 vẫn là 'Chi Tiết'", async () => {
    const ws = await moFile(await buildQuoteBuffer(baoGia("clofull_decor")));
    const got = ["B", "C", "D", "E", "F", "G", "H", "I"].map((c) =>
      chu(ws.getCell(`${c}${HANG_TIEU_DE}`).value).replace(/\s+/g, " ").trim().toUpperCase());
    expect(got[0]).toBe("STT");
    expect(got[1]).toBe("HẠNG MỤC");
    expect(got[2], "ô tiêu đề Chi Tiết bị xoá — cột lại bị gộp vào Hạng Mục").toBe("CHI TIẾT");
    expect(got[3]).toBe("ĐVT");
    expect(got[4]).toBe("SỐ LƯỢNG");
    expect(got[5]).toMatch(/^ĐƠN GIÁ/);
    expect(got[6]).toMatch(/^THÀNH TIỀN/);
    expect(got[7]).toMatch(/^GHI CHÚ/);
  }, 120_000);

  it("nội dung Chi Tiết in ĐÚNG cột D, không bị nhồi vào Hạng Mục", async () => {
    const ws = await moFile(await buildQuoteBuffer(baoGia("clofull_decor")));
    expect(chu(ws.getCell(`C${HANG_DAU}`).value)).toBe("Khu Vực Check In");
    expect(chu(ws.getCell(`D${HANG_DAU}`).value), "Chi Tiết không ra tới file").toBe(CT_1);
    // Nhiều dòng phải giữ nguyên ngắt dòng — mẫu Colorfull dùng kiểu ". KT: …" trên từng dòng.
    const hangCon = HANG_DAU + 2;
    expect(chu(ws.getCell(`D${hangCon}`).value)).toBe(CT_2);
    expect(chu(ws.getCell(`D${hangCon}`).value).split("\n").length, "ngắt dòng trong Chi Tiết bị bóp").toBe(3);
  }, 120_000);

  it("KHÔNG gộp C:D ở tiêu đề lẫn ở hàng hạng mục", async () => {
    // Đây là hành vi của `removeDetail: true` — còn sót một chỗ là cột lại biến mất.
    const ws = await moFile(await buildQuoteBuffer(baoGia("clofull_decor")));
    expect(oChu(ws, `D${HANG_TIEU_DE}`), "ô tiêu đề Chi Tiết vẫn bị hút vào Hạng Mục").toBe(`D${HANG_TIEU_DE}`);
    for (let r = HANG_DAU; r <= HANG_DAU + 3; r++) {
      expect(oChu(ws, `D${r}`), `hàng ${r}: ô Chi Tiết bị hút vào ô khác`).toBe(`D${r}`);
    }
  }, 120_000);

  it("HAI cột Hạng Mục và Chi Tiết đều đủ rộng — không cột nào bị bỏ đói", async () => {
    // Bốn lần chỉnh, mỗi lần vì một số đo:
    //   C 38 / D 10  — thời gộp cột: Chi Tiết chỉ là khe địa chỉ, không hiện.
    //   C 21 / D 50  — theo đúng file mẫu: hợp cách Colorfull tự soạn (tên ngắn, mô tả dài ở Chi Tiết).
    //   C 34 / D 30  — sau khi chạy dữ liệu THẬT chuyển từ nếp Gia Nguyễn sang: tên dài
    //                  ("Banner khu khách ngồi chờ: 8m2W x 2m9H") mà Chi Tiết ngắn (". PP in KTS"),
    //                  nên cột Hạng Mục rộng 21 bị CẮT CHỮ còn Chi Tiết bỏ trống quá nửa.
    //   C 39,8 / D 30 — 2026-09-25: cột STT thu về 6,63 như GN, phần dôi dồn hết cho Hạng Mục.
    // Bài này vì thế không khoá "cột nào rộng hơn" — nó khoá điều thật sự quan trọng: cả hai đều
    // đủ chỗ, và tổng bề ngang bảng không phình ra.
    const ws = await moFile(await buildQuoteBuffer(baoGia("clofull_decor")));
    const wC = ws.getColumn("C").width, wD = ws.getColumn("D").width;
    expect(wC, `Hạng Mục hẹp quá (${wC}) — tên dài sẽ bị cắt`).toBeGreaterThanOrEqual(28);
    expect(wD, `Chi Tiết hẹp quá (${wD}) — nội dung nhiều dòng sẽ bị bóp`).toBeGreaterThanOrEqual(26);
    const tong = ["B", "C", "D", "E", "F", "G", "H", "I"].reduce((a, L) => a + (ws.getColumn(L).width || 0), 0);
    expect(tong, "bảng phình ngang hơn trước — sẽ tràn khổ giấy").toBeLessThanOrEqual(150);
  }, 120_000);

  it("nhập lại chính file vừa xuất: Chi Tiết quay về, và KHÔNG có cảnh báo 'sẽ không được nạp'", async () => {
    // Vòng tròn xuất → nhập là đường người dùng đi thật (sửa trên Excel rồi nạp lại).
    const buf = await buildQuoteBuffer(baoGia("clofull_decor"));
    const kq = await parseQuoteWorkbook(buf);
    const sheet = kq.sheets.find((s) => !s.skipped);
    expect(sheet, "không nạp được sheet nào").toBeTruthy();
    expect(sheet.templateCode, "đoán sai mẫu → cảnh báo Chi Tiết sẽ bật lại").toBe("clofull_decor");
    const coCT = sheet.items.filter((it) => String(it.detail || "").trim());
    expect(coCT.length, "nạp lại mà mất nội dung Chi Tiết").toBeGreaterThanOrEqual(3);
    expect(coCT[0].detail).toBe(CT_1);
    const canhBao = (sheet.warnings || []).filter((w) => /Chi Tiết/i.test(w));
    expect(canhBao, `app nói "sẽ không được nạp" trong khi nó vừa nạp xong: ${canhBao.join(" | ")}`).toEqual([]);
  }, 120_000);
});

describe("Sơ đồ địa chỉ ô KHÔNG dịch — công thức đã lưu giữ nguyên nghĩa", () => {
  it("Colorfull: khe địa chỉ vẫn có 'detail', nên E vẫn là Số Lượng", () => {
    // `GridTable` dựng chữ cột theo VỊ TRÍ trong danh sách:
    //   A=_stt  B=name  C=detail  D=unit  E=quantity  F=unitPrice  G=_amount  H=notes
    // `keepDetailSlot` lấy từ `reserveDetail` (= có khai `columns.detail`), KHÔNG lấy từ
    // `removeDetail`. Nên bật/tắt việc hiện cột không đụng tới chữ cột nào.
    const items = getConfig("clofull_decor").items;
    expect(items.columns.detail, "mất khoá detail là dịch hết chữ cột từ E trở đi").toBe("D");
    const soDo = ["_stt", "name", ...(items.columns.detail ? ["detail"] : []), "unit", "quantity", "unitPrice", "_amount", "notes"];
    expect(soDo[4], 'công thức đã lưu kiểu "=E3" sẽ trỏ sai cột').toBe("quantity");
    expect(soDo[5]).toBe("unitPrice");
  });

  it("công thức thành tiền trong file xuất vẫn là ĐƠN GIÁ × SỐ LƯỢNG (G×F)", async () => {
    // Bản thật bọc ROUND(...,0) — làm tròn về đồng, `amountFormula` của config là phần trong ruột.
    // Kiểm phần TRONG RUỘT chứ không kiểm cả chuỗi: thêm/bỏ lớp làm tròn là quyết định khác, không
    // phải việc của bài này; điều bài này gác là G×F không bị dịch sang cột khác.
    const ws = await moFile(await buildQuoteBuffer(baoGia("clofull_decor")));
    expect(chu(ws.getCell(`H${HANG_DAU}`).value)).toMatch(new RegExp(`G${HANG_DAU}\\*F${HANG_DAU}`));
  }, 120_000);
});

describe("GN KHÔNG ĐỔI — Chi Tiết chỉ của Colorfull", () => {
  // Kiểm THẬT trên file xuất, không tin vào việc "code trông như tách rời".
  for (const ma of ["marico_decor", "gn_banner"]) {
    it(`${ma}: vẫn gộp C:D và không in tiêu đề Chi Tiết`, async () => {
      const ws = await moFile(await buildQuoteBuffer(baoGia(ma)));
      const hangTieuDe = getConfig(ma).items.headerRow;
      const hangDau = getConfig(ma).items.firstRow;
      // KHÔNG kiểm "ô D rỗng": D đang nằm TRONG vùng gộp C:D, nên ExcelJS trả giá trị của ô chủ ở
      // mọi cột trong vùng — đọc D ra đúng chữ "Hạng Mục" là DẤU HIỆU của việc gộp, không phải lỗi.
      // Thứ phải kiểm là ô chủ của D chính là C: khi ấy D không còn là một cột riêng để mà in ra.
      expect(oChu(ws, `D${hangTieuDe}`), "D tách khỏi ô gộp của C → GN mọc thêm cột Chi Tiết").toBe(`C${hangTieuDe}`);
      expect(oChu(ws, `D${hangDau}`), "D ở hàng hạng mục tách khỏi C → nội dung Chi Tiết sẽ in ra file GN").toBe(`C${hangDau}`);
    }, 120_000);
  }

  it("unibenfood (GN có ngày): D vẫn là ĐVT, không có khe Chi Tiết", () => {
    const cols = getConfig("unibenfood").items.columns;
    expect(cols.detail, "GN có ngày mọc thêm khe Chi Tiết → dịch hết chữ cột").toBeUndefined();
    expect(cols.unit).toBe("D");
  });
});

describe("Colorfull đủ BA mẫu như GN — và mẫu nào cũng có Chi Tiết", () => {
  // Yêu cầu: Colorfull có không-ngày · có-ngày · banner, cùng bộ quy tắc của GN, cộng cột Chi Tiết.
  // GN giải bài "có ngày" bằng cách HY SINH cột Chi Tiết (D đổi nhãn thành ĐVT) để khỏi chèn cột.
  // Colorfull không hy sinh được, nên bản có-ngày có file mẫu riêng 9 cột (B…J).
  it("cả ba mẫu Colorfull đều khai cột Chi Tiết và đều HIỆN nó", () => {
    for (const ma of ["clofull_decor", "clofull_banner", "clofull_conngay"]) {
      const items = getConfig(ma).items;
      expect(items.columns.detail, `${ma}: mất khoá detail`).toBe("D");
      expect(items.removeDetail, `${ma}: Chi Tiết lại bị gộp vào Hạng Mục`).toBe(false);
    }
  });

  it("banner: y hệt bản không-ngày, CHỈ khác cách đánh số nhóm con", () => {
    // Quan hệ này phải giống hệt gn_banner ↔ marico_decor: cùng file, cùng cột, cùng công thức.
    const khong = getConfig("clofull_decor"), banner = getConfig("clofull_banner");
    expect(banner.filePath, "banner mà dùng file khác thì mọi bản vá bố cục phải làm hai lần").toBe(khong.filePath);
    expect(banner.items.columns).toEqual(khong.items.columns);
    expect(banner.items.amountFormula(9)).toBe(khong.items.amountFormula(9));
    expect(banner.items.numberSubsections, "banner phải đánh số nhóm con").toBe(true);
    expect(khong.items.numberSubsections, "bản không-ngày KHÔNG đánh số nhóm con").toBeFalsy();
    // Và đúng quan hệ ấy bên GN, để hai bên không trôi khỏi nhau.
    expect(getConfig("gn_banner").items.numberSubsections).toBe(true);
  });

  it("có ngày: 9 cột B…J, Chi Tiết vẫn ở D, Số Ngày chen vào G", async () => {
    const cols = getConfig("clofull_conngay").items.columns;
    expect(cols).toEqual({ stt: "B", name: "C", detail: "D", unit: "E", quantity: "F", days: "G", unitPrice: "H", amount: "I", notes: "J" });
    const ws = await moFile(await buildQuoteBuffer(baoGiaNgay()));
    const tieuDe = ["B", "C", "D", "E", "F", "G", "H", "I", "J"].map((c) =>
      chu(ws.getCell(`${c}${HANG_TIEU_DE}`).value).replace(/\s+/g, " ").trim().toUpperCase());
    expect(tieuDe).toEqual(["STT", "HẠNG MỤC", "CHI TIẾT", "ĐVT", "SỐ LƯỢNG", "SỐ NGÀY", "ĐƠN GIÁ (VNĐ)", "THÀNH TIỀN (VNĐ)", "GHI CHÚ"]);
  }, 120_000);

  it("có ngày: thành tiền = ĐƠN GIÁ × SỐ LƯỢNG × SỐ NGÀY (cùng ý nghĩa với GN có-ngày)", async () => {
    const ws = await moFile(await buildQuoteBuffer(baoGiaNgay()));
    // So CHUỖI thẳng, không dùng regex: `*` trong công thức là ký tự lượng-từ của regex, và bản
    // đầu của ca này đỏ oan đúng vì thế (escape `\*` rụng mất một lớp khi đi qua heredoc).
    expect(chu(ws.getCell(`I${HANG_DAU}`).value)).toContain(`H${HANG_DAU}*F${HANG_DAU}*G${HANG_DAU}`);
    // Số ngày phải RA TỚI FILE, không rơi đâu mất.
    expect(chu(ws.getCell(`G${HANG_DAU}`).value)).toBe("3");
    expect(chu(ws.getCell(`D${HANG_DAU}`).value), "Chi Tiết mất ở bản có-ngày").toBe(CT_1);
  }, 120_000);

  it("có ngày: hộp nhãn khối tổng GỌN ở G:H, số tiền ở I — đúng nếp mẫu Gia Nguyễn", async () => {
    // Mẫu GN để nhãn "Tổng Cộng / VAT / Thành Tiền" trong một hộp ôm ĐÚNG HAI CỘT ngay trước ô
    // tiền (Marico: F:G, tiền ở H), còn các ô bên trái để trống KHÔNG tô nền. Mẫu Colorfull gốc
    // thì gộp cả B:G thành một băng màu chạy suốt bảng — người dùng yêu cầu thu lại như GN.
    // Bản có-ngày có thêm cột SỐ NGÀY nên hộp đó DỊCH sang G:H (tiền ở I), chứ không NỞ ra F:H.
    const ws = await moFile(await buildQuoteBuffer(baoGiaNgay()));
    let hangTong = null;
    ws.eachRow({ includeEmpty: false }, (row, r) => {
      if (hangTong == null && chu(row.getCell("G").value).trim() === "Tổng Cộng") hangTong = r;
    });
    expect(hangTong, "không tìm thấy hàng Tổng Cộng ở hộp nhãn G:H").toBeTruthy();
    expect(oChu(ws, `H${hangTong}`), "hộp nhãn không phủ G:H").toBe(`G${hangTong}`);
    expect(chu(ws.getCell(`I${hangTong}`).value), "số tiền tổng không nằm ở cột I").toMatch(/^=SUM\(I\d+:I\d+\)$/);
    // Và các ô bên trái hộp nhãn phải SẠCH nền, đúng như bên GN.
    expect(ws.getCell(`B${hangTong}`).fill?.fgColor, "ô trước hộp nhãn vẫn còn nền — băng màu chưa thu gọn").toBeFalsy();
  }, 120_000);

  it("GN có-ngày KHÔNG mọc thêm cột: vẫn 8 cột, vẫn không có Chi Tiết", () => {
    // Vế đối trọng cho cả cụm trên: việc Colorfull dài thêm một cột không được lan sang GN.
    const cols = getConfig("unibenfood").items.columns;
    expect(cols.detail).toBeUndefined();
    expect(cols.notes, "GN có-ngày bị đẩy sang 9 cột").toBe("I");
    expect(getConfig("unibenfood").items.amountFormula(9)).toBe("G9*E9*F9");
  });
});

/**
 * ============================================================================
 * NHỮNG CHỖ COLORFULL CHƯA THEO ĐÚNG QUY TẮC CỦA GN — TÌM BẰNG SOI CHÉO, VÁ THEO TỪNG SỐ ĐO.
 *
 * Bốn lỗi dưới đây do một đợt soi 5 mặt (cấu hình · xuất · nhập · lưới · hồi quy GN) tìm ra, mỗi
 * cái đã qua một vòng phản biện bằng mã nguồn trước khi được nhận là thật. Ba trong bốn cái CÓ
 * TRƯỚC bản vá Colorfull, nhưng hai mẫu mới (banner, có-ngày) vừa kế thừa nguyên xi chúng — nên
 * chúng thuộc về bản vá này.
 * ============================================================================
 */
describe("Colorfull — bốn lỗ hổng tìm được khi soi chéo với GN", () => {
  const baoGiaN = (code, n, extra = {}) => ({
    quoteNumber: "CLF26997", title: "T", toCompany: "K", city: "TP. Hồ Chí Minh",
    fromContact: "Nguyễn Văn Khác", fromTitle: "Account", fromPhone: "0900000000",
    quoteDate: new Date("2026-09-18"), vatPercent: 8, hnTables: [], ...extra,
    sheets: [{
      order: 1, name: "S", groupSubtotal: false, discount: extra.discount || 0, extraTables: [], templateCode: code,
      items: Array.from({ length: n }, (_, i) => ({
        order: i + 1, kind: "item", name: `Món ${i}`, detail: `chi tiết ${i}`,
        unit: "bộ", quantity: 1, days: 2, unitPrice: 1000, notes: "",
      })),
    }],
  });
  const quetChu = (ws, mau) => {
    const hit = [];
    ws.eachRow({ includeEmpty: false }, (row) => row.eachCell({ includeEmpty: false }, (c) => {
      if (chu(c.value).includes(mau)) hit.push(c.address);
    }));
    return hit;
  };

  it("KHÔNG in tên người ký nhúng cứng trong file mẫu — ai gửi cũng vậy", async () => {
    // `templates/CLF_KhongNgay.xlsx` mang sẵn "Trần Thị Lan Anh" ở G22 (bản có-ngày: H22, do script
    // dựng chép sang), ngay dưới dòng "Công Ty TNHH Colorfull" của khối ký. Không đường nào ghi đè
    // ô đó, nên mọi báo giá Colorfull ra file khách với tên một người cụ thể đứng chỗ ký — trong
    // khi người gửi THẬT nằm ở khối F1 phía trên. Hai tên khác nhau trên cùng một tờ.
    // GN đã vá đúng lớp lỗi này (nhãn "Ms." ở B3/E3 + `showSender: false`).
    for (const ma of ["clofull_decor", "clofull_banner", "clofull_conngay"]) {
      for (const n of [2, 12]) {
        const ws = await moFile(await buildQuoteBuffer(baoGiaN(ma, n)));
        expect(quetChu(ws, "Lan Anh"), `${ma} (${n} mục): còn tên người ký nhúng cứng`).toEqual([]);
        // Vế đối trọng: tên CÔNG TY ở khối ký phải còn — xoá nhầm nó là mất nhận diện thương hiệu.
        expect(quetChu(ws, "Công Ty TNHH Colorfull").length, `${ma}: mất luôn dòng tên công ty ở khối ký`).toBeGreaterThan(0);
      }
    }
  }, 300_000);

  it("Ghi chú người dùng gõ PHẢI ra file Excel — nhãn trên giao diện hứa 'in vào file Excel/PDF'", async () => {
    // Đường xuất Excel đọc `quote.notes` ở ĐÚNG MỘT chỗ, và chỗ đó nằm trong `if (pal)` của
    // src/excel.ts. Không mẫu CLF nào khai `palette` ⇒ ghi chú không bao giờ ra Excel, dù PDF vẫn
    // in. Đo trước khi vá: 3/3 mẫu GN có, 0/3 mẫu CLF không.
    const GHI = "DIEU KIEN RIENG CUA BAO GIA NAY";
    for (const ma of ["clofull_decor", "clofull_banner", "clofull_conngay"]) {
      const ws = await moFile(await buildQuoteBuffer(baoGiaN(ma, 3, { notes: GHI })));
      expect(quetChu(ws, GHI).length, `${ma}: ghi chú người dùng KHÔNG ra file Excel`).toBeGreaterThan(0);
    }
    // Không có ghi chú thì KHÔNG để lại ô "Ghi chú:" rỗng lơ lửng.
    const wsTrong = await moFile(await buildQuoteBuffer(baoGiaN("clofull_decor", 3, { notes: "" })));
    expect(quetChu(wsTrong, "Ghi chú:").filter((a) => chu(wsTrong.getCell(a).value).trim() === "Ghi chú:")).toEqual([]);
  }, 300_000);

  it("ô \"* Ghi chú\" của mẫu ĐI THEO Ô TÍCH của người dùng, không tự hiện", async () => {
    // Mẫu Colorfull nhúng cứng "* Ghi chú: - Tất cả các hạng mục trên là cho thuê, Colofull thu
    // hồi sau khi tháo dỡ" (kể cả lỗi chính tả tên công ty) vào ô gộp C17:D17. Nó in ra MỌI báo
    // giá, kể cả khi người dùng KHÔNG bật "Thêm Ghi chú" ở màn soạn — người dùng báo đúng chỗ này.
    // Nay ô đó do `quote.notes` điều khiển, giống hệt nếp của GN.
    //
    // Ca này cũng gác luôn lỗi ĐÃ CÓ ở đường ghi: `duplicateRow` dời chữ xuống hàng mới và biến D
    // thành ô PHỤ của C, nhưng để lại danh sách gộp CŨ — nên bước "dọn ô phụ" gán null cho D ghi
    // XUYÊN sang ô chủ và xoá trắng chữ. Vì thế phải kiểm ở NHIỀU cỡ bảng, không chỉ cỡ nhỏ.
    const GHI = "Bao gia co hieu luc 15 ngay";
    for (const ma of ["clofull_decor", "clofull_banner", "clofull_conngay"]) {
      for (const [n, discount] of [[2, 0], [8, 0], [20, 0], [8, 50_000]]) {
        const coGhi = await moFile(await buildQuoteBuffer(baoGiaN(ma, n, { discount, notes: GHI })));
        const hit = quetChu(coGhi, GHI);
        expect(hit.length, `${ma} (${n} mục${discount ? " + discount" : ""}): BẬT ghi chú mà file không có`).toBeGreaterThan(0);
        expect(oChu(coGhi, hit[hit.length - 1]), "ô ghi chú không còn gộp C:D").toBe(hit[0]);

        const khongGhi = await moFile(await buildQuoteBuffer(baoGiaN(ma, n, { discount })));
        expect(quetChu(khongGhi, "Tất cả các hạng mục"), `${ma} (${n} mục): KHÔNG bật ghi chú mà câu nhúng cứng của mẫu vẫn in ra`).toEqual([]);
        expect(quetChu(khongGhi, GHI)).toEqual([]);
      }
    }
  }, 300_000);

  it("file NGOÀI (không mang dấu mã mẫu) vẫn phải nhận ra là mẫu Colorfull, không rơi về GN", async () => {
    // Bộ đoán mẫu vốn không chấm cột Chi Tiết — dấu hiệu DUY NHẤT tách CLF khỏi GN. Bằng chứng còn
    // lại là MÀU nền hàng nhóm, mà màu chỉ có ở file do chính app xuất. File khách/đối tác gửi tới
    // (bảng phẳng, không hàng nhóm) vì thế rơi về mẫu GN đứng trước trong TEMPLATE_CONFIGS — đo
    // được: clofull_decor → đoán ra `marico_decor`.
    const nhuFileNgoai = async (buf) => {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buf);
      const ws = wb.worksheets[0];
      ws.getCell("A1").value = null;   // gỡ dấu mã mẫu app nhúng lúc xuất
      ws.name = "Bang gia";            // và tên tab do người ngoài đặt
      return Buffer.from(await wb.xlsx.writeBuffer());
    };
    for (const ma of ["clofull_decor", "clofull_conngay", "marico_decor", "unibenfood"]) {
      const kq = await parseQuoteWorkbook(await nhuFileNgoai(await buildQuoteBuffer(baoGiaN(ma, 2))));
      const sheet = kq.sheets.find((s) => !s.skipped);
      expect(sheet?.templateCode, `file ngoài dạng ${ma} bị đoán thành ${sheet?.templateCode}`).toBe(ma);
    }
  }, 300_000);
});

/**
 * ============================================================================
 * ĐẦU TRANG & KHỐI TỔNG CỦA COLORFULL — CHO GIỐNG BẢN GIA NGUYỄN.
 *
 * Người dùng so hai file cạnh nhau và chỉ ra năm chỗ Colorfull chưa bằng GN:
 *   1. không in MÃ DỰ ÁN (GN in "(Số://…)" ngay dưới tiêu đề) — lượt đầu nhét vào dải B5, người
 *      dùng bỏ; 2026-09-25 họ chốt chỗ đúng: dòng CUỐI khối "Kính gửi" (xem cụm "bốn chỗ học theo GN");
 *   2. không in LỜI CHÀO;
 *   3. còn nguyên chữ mồi đỏ "logo cty khách hàng" của file mẫu;
 *   4. dải "* Thông tin chương trình" rỗng vẫn tô màu vắt ngang bảng;
 *   5. nhãn "Tổng Cộng / VAT / Thành Tiền" là một băng chạy suốt bảng, không phải hộp gọn như GN.
 *
 * VÀ MỘT LỖI DO CHÍNH BẢN VÁ ĐẺ RA, NẶNG NHẤT TRONG CỤM: thu nhãn về F:G bằng cách đổi mỗi
 * `labelCells` làm file xuất ra MỞ KHÔNG ĐƯỢC — `mergeCells("F16:G16")` đè lên vùng B16:G16 sẵn có
 * của mẫu, ExcelJS xé vùng cũ thành B16:F16 và để lại HAI VÙNG GỘP CHỒNG NHAU ở cột F. Ghi thì
 * "thành công", mở lại thì hỏng. Ca cuối cụm này gác đúng điều đó ở mọi mẫu và mọi cỡ bảng.
 * ============================================================================
 */
describe("Colorfull — đầu trang và khối tổng theo nếp Gia Nguyễn", () => {
  const baoGiaDau = (code, over = {}) => ({
    quoteNumber: "CLF26070", projectCode: "FP_A26_002", projectVersion: 1,
    title: "Lên hương", toCompany: "CGV", toContact: "Mr. Toàn", city: "TP. Hồ Chí Minh",
    fromContact: "Chị QA", fromTitle: "Account", fromPhone: "0938111222",
    greeting: "Chân thành cảm ơn Quí khách hàng đã quan tâm đến dịch vụ của chúng tôi",
    quoteDate: new Date("2026-09-18"), vatPercent: 8, hnTables: [], ...over,
    sheets: [{
      order: 1, name: "Banner", groupSubtotal: false, discount: over.discount || 0, extraTables: [], templateCode: code,
      items: [
        ...(over.info ? [{ order: 0, kind: "info", name: "Premiere phim Thỏ Ơi 20/9" }] : []),
        ...Array.from({ length: over.soMuc || 10 }, (_, i) => ({
          order: i + 1, kind: "item", name: `Banner khu khách ngồi chờ: ${i}m2W x 2m9H`,
          detail: ". PP in KTS", unit: "m2", quantity: 23.8, days: 2, unitPrice: 95000, notes: "",
        })),
      ],
    }],
  });
  const tim = (ws, mau) => {
    const hit = [];
    ws.eachRow({ includeEmpty: false }, (row) => row.eachCell({ includeEmpty: false }, (c) => {
      if (chu(c.value).includes(mau)) hit.push(c.address);
    }));
    return hit;
  };

  /** Chỉ những ô từ hàng tiêu đề cột trở xuống — tức TRONG bảng, không phải đầu trang. */
  const trongBang = (hits) => hits.filter((a) => Number(a.replace(/^[A-Z]+/, "")) >= HANG_TIEU_DE);

  it("dải trên bảng CHỈ mang thông tin chương trình — không mã, không lời chào", async () => {
    // Có một lượt dải này gánh thêm mã dự án + lời chào, vì mẫu Colorfull không còn hàng trống nào
    // ở đầu trang. Người dùng xem file thật rồi chốt BỎ dòng đó. Bài này khoá quyết định ấy để bản
    // sau không lặng lẽ nhét lại. (Mã nay nằm ở khối "Kính gửi" hàng 3 — ngoài bảng, xem cụm cuối tệp.)
    for (const ma of ["clofull_decor", "clofull_banner", "clofull_conngay"]) {
      const ws = await moFile(await buildQuoteBuffer(baoGiaDau(ma)));
      expect(trongBang(tim(ws, "Số://")), `${ma}: dòng mã vẫn in ra trên bảng`).toEqual([]);
      expect(tim(ws, "Chân thành cảm ơn"), `${ma}: lời chào vẫn in ra trên bảng`).toEqual([]);
      // Và hàng đó phải ẨN, không để lại dải màu rỗng vắt ngang bảng.
      expect(ws.getRow(5).hidden, `${ma}: dải rỗng vẫn hiện`).toBe(true);
    }
  }, 300_000);

  it("CÓ dòng Thông tin chương trình thì dải hiện lại và in đúng nội dung đó", async () => {
    const ws = await moFile(await buildQuoteBuffer(baoGiaDau("clofull_decor", { info: true })));
    expect(tim(ws, "Thông tin chương trình").length, "mất dòng thông tin chương trình").toBeGreaterThan(0);
    expect(ws.getRow(5).hidden, "có nội dung mà hàng vẫn bị ẩn").toBeFalsy();
    expect(trongBang(tim(ws, "Số://")), "mã lại bám theo dòng thông tin chương trình").toEqual([]);
  }, 300_000);

  it("KHÔNG còn chữ mồi \"logo cty khách hàng\" — tính năng logo khách đã gỡ", async () => {
    for (const ma of ["clofull_decor", "clofull_banner", "clofull_conngay"]) {
      const ws = await moFile(await buildQuoteBuffer(baoGiaDau(ma)));
      expect(tim(ws, "logo cty khách hàng"), `${ma}: chữ mồi đỏ của file mẫu vẫn in ra`).toEqual([]);
    }
  }, 300_000);

  it("khối \"Kính gửi\" ra GIỮA trang (gộp C3:I3, canh giữa) sau khi bỏ ô logo", async () => {
    const ws = await moFile(await buildQuoteBuffer(baoGiaDau("clofull_decor")));
    expect(oChu(ws, "I3"), "khối Kính gửi chưa phủ tới I — vẫn dạt sang phải như cũ").toBe("C3");
    expect(ws.getCell("C3").alignment?.horizontal, "khối Kính gửi không canh giữa").toBe("center");
  }, 300_000);

  it("hộp nhãn khối tổng GỌN ở F:G, các ô bên trái SẠCH nền — đúng như mẫu GN", async () => {
    for (const ma of ["clofull_decor", "clofull_banner"]) {
      const ws = await moFile(await buildQuoteBuffer(baoGiaDau(ma)));
      let r = null;
      ws.eachRow({ includeEmpty: false }, (row, i) => { if (r == null && chu(row.getCell("F").value).trim() === "Tổng Cộng") r = i; });
      expect(r, `${ma}: không thấy nhãn Tổng Cộng ở hộp F:G`).toBeTruthy();
      expect(oChu(ws, `G${r}`), `${ma}: hộp nhãn không phủ F:G`).toBe(`F${r}`);
      expect(ws.getCell(`B${r}`).fill?.fgColor, `${ma}: ô trước hộp nhãn còn nền — băng màu chưa thu gọn`).toBeFalsy();
    }
  }, 300_000);

  it("FILE MỞ LẠI ĐƯỢC ở mọi mẫu và mọi cỡ bảng — không có vùng gộp chồng nhau", async () => {
    // Đây là ca tốn nhất của cụm. Thu nhãn tổng về F:G bằng cách đổi mỗi cấu hình làm ExcelJS xé
    // vùng gộp B:G sẵn có của mẫu thành B16:F16, chồng lên F16:G16 — file GHI RA THÀNH CÔNG nhưng
    // MỞ LẠI LÀ HỎNG ("Cannot merge already merged cells"), và Excel báo tệp lỗi. Không phát hiện
    // được nếu chỉ kiểm giá trị từng ô: phải ĐỌC LẠI cả tệp.
    // Cách chữa nằm ở FILE MẪU (scripts/sua-mau-clf-khoi-tong.mjs) chứ không ở tầng mã — sau
    // `duplicateRow`, sổ ghi vùng gộp của ExcelJS lệch khỏi trạng thái thật của ô nên mọi cách gỡ
    // dựa vào sổ đều trượt.
    for (const ma of ["clofull_decor", "clofull_banner", "clofull_conngay", "marico_decor", "gn_banner", "unibenfood"]) {
      for (const over of [{ soMuc: 1 }, { soMuc: 8 }, { soMuc: 20 }, { soMuc: 8, discount: 50_000 }, { soMuc: 8, notes: "ghi chú" }]) {
        const buf = await buildQuoteBuffer(baoGiaDau(ma, over));
        const wb = new ExcelJS.Workbook();
        await expect(
          wb.xlsx.load(buf),
          `${ma} (${over.soMuc} mục${over.discount ? " + discount" : ""}${over.notes ? " + ghi chú" : ""}): file mở lại KHÔNG được`,
        ).resolves.toBeTruthy();
      }
    }
  }, 400_000);
});

/**
 * ============================================================================
 * KHUNG VIỀN VÀ TRANG IN — HAI THỨ CHỈ LỘ RA KHI ĐẶT HAI FILE CẠNH NHAU.
 *
 * Người dùng so bản Colorfull với bản Gia Nguyễn và nhắc "độ dày của khung hay gì các thứ nữa"
 * cùng "xuống hàng trong excel khi tải ra không bị che". Đo ra ba chuyện:
 *
 *   1. KHUNG NGOÀI. GN có viền 'medium' ở cạnh trên hàng tiêu đề và hai cạnh bên của bảng (ruột
 *      'thin'); mẫu Colorfull thì mọi viền đều 'thin' → bảng trông mỏng và trôi.
 *   2. TRANG IN. Mẫu Colorfull đặt `fitToPage` kèm `fitToHeight: 1`, nghĩa là Excel BÓP cả bảng
 *      vào MỘT trang. Đo trên báo giá 120 hạng mục (143 hàng): in hoặc xuất PDF ra nhỏ tới mức
 *      không đọc nổi. GN thì `fitToPage: false` + tỷ lệ 55 nên in nhiều trang, đọc được.
 *      Bộ xuất chỉ CHÉP NGUYÊN `pageSetup` của file mẫu, nên lỗi nằm ở chính file mẫu.
 *   3. CHIỀU CAO HÀNG. Hàm ước lượng chia chữ theo SỐ KÝ TỰ, còn Excel ngắt theo TỪ — nên số dòng
 *      thật nhiều hơn ước lượng và dòng cuối bị che. Ca cuối cụm này khoá phép đếm dòng.
 * ============================================================================
 */
describe("Colorfull — khung viền, trang in, chiều cao hàng", () => {
  const baoGiaKhung = (code, soMuc = 10, tenDai = false) => ({
    quoteNumber: "CLF26070", projectCode: "FP_A26_002", title: "T", toCompany: "CGV",
    city: "TP. Hồ Chí Minh", quoteDate: new Date("2026-09-18"), vatPercent: 8, hnTables: [],
    sheets: [{
      order: 1, name: "S", groupSubtotal: false, discount: 0, extraTables: [], templateCode: code,
      items: Array.from({ length: soMuc }, (_, i) => ({
        order: i + 1, kind: "item",
        name: tenDai ? "Banner hàng rào: 0m8W x 0m5H x 8 tấm" : `Mục ${i}`,
        detail: ". PP in KTS", unit: "m2", quantity: 23.8, days: 2, unitPrice: 95_000, notes: "",
      })),
    }],
  });
  const netVien = (ws, addr, canh) => ws.getCell(addr).border?.[canh]?.style ?? "-";
  /**
   * Hàng tiêu đề + hàng hạng mục ĐẦU TIÊN.
   *
   * KHÔNG tìm hàng hạng mục theo `STT === "1"`: bản BANNER không đánh số mục cấp trên
   * (`numberSubsections`), nên ô STT rỗng và phép tìm đó trượt — bài này từng đỏ vì lý do ấy.
   * Dấu hiệu chắc chắn hơn: hàng nào có ĐVT thì là hàng hạng mục.
   */
  const timHang = (ws, cotDVT = "E") => {
    let hd = null, muc = null;
    ws.eachRow({ includeEmpty: false }, (row, r) => {
      const b = chu(row.getCell("B").value).trim();
      if (hd == null && b.toUpperCase() === "STT") hd = r;
      else if (hd != null && muc == null) {
        // Ô ĐVT phải là ô THẬT, không phải ô phụ của vùng gộp ngang: dải "* Thông tin chương
        // trình" gộp B5:I5 nên đọc ô E5 ra đúng chữ của ô chủ → nhận nhầm dải đó là hàng hạng mục.
        const o = row.getCell(cotDVT);
        const laOThat = !o.isMerged || o.master?.address === o.address;
        if (laOThat && chu(o.value).trim()) muc = r;
      }
    });
    if (!hd || !muc) throw new Error(`không tìm được hàng tiêu đề (${hd}) hoặc hàng hạng mục (${muc})`);
    return { hd, muc };
  };

  it("khung NGOÀI dày như GN: cạnh trên tiêu đề + hai cạnh bên đều 'medium'", async () => {
    for (const [ma, cotCuoi] of [["clofull_decor", "I"], ["clofull_banner", "I"], ["clofull_conngay", "J"]]) {
      for (const soMuc of [3, 20]) {
        const ws = await moFile(await buildQuoteBuffer(baoGiaKhung(ma, soMuc)));
        const { hd, muc } = timHang(ws);
        expect(netVien(ws, `B${hd}`, "top"), `${ma} (${soMuc} mục): cạnh trên tiêu đề không dày`).toBe("medium");
        expect(netVien(ws, `${cotCuoi}${hd}`, "top"), `${ma}: cạnh trên tiêu đề hụt ở cột cuối`).toBe("medium");
        expect(netVien(ws, `B${hd}`, "left"), `${ma}: cạnh TRÁI bảng không dày`).toBe("medium");
        expect(netVien(ws, `${cotCuoi}${hd}`, "right"), `${ma}: cạnh PHẢI bảng không dày`).toBe("medium");
        expect(netVien(ws, `B${muc}`, "left"), `${ma}: hàng hạng mục mất cạnh trái dày`).toBe("medium");
        expect(netVien(ws, `${cotCuoi}${muc}`, "right"), `${ma}: hàng hạng mục mất cạnh phải dày`).toBe("medium");
        // Ruột bảng vẫn PHẢI mảnh — dày hết thì thành lưới đen kịt.
        expect(netVien(ws, `C${muc}`, "left"), `${ma}: viền dày LEM vào ruột bảng`).toBe("thin");
      }
    }
  }, 300_000);

  it("ĐỘ DÀY khung học theo GIA NGUYỄN — lấy chính tệp GN làm chuẩn, không đóng cứng", async () => {
    // Yêu cầu của người dùng: "khung đậm nhạt thì học theo của GN". Nên ca này KHÔNG khai sẵn
    // "phải là medium" — nó DỰNG một tệp GN cùng dữ liệu rồi đòi Colorfull khớp.
    //
    // Đo lúc viết ca: bảng chính của hai bên đã giống nhau từng nét (tiêu đề tMtt/tttt/tttM,
    // hàng nhóm, nhóm con, hạng mục, hàng cuối). Lệch duy nhất nằm ở ĐÁY khối tổng:
    //     GN   hàng "Thành Tiền": F đáy DÀY · G đáy DÀY · H đáy DÀY
    //     CLF  hàng "Thành Tiền": F đáy DÀY · G đáy MẢNH · H đáy DÀY   ← đáy mỏng ở giữa
    // vì vòng kẻ đáy chỉ chạy cho ô nhãn ĐẦU và ô TIỀN, bỏ ô thứ hai của hộp nhãn.
    const net = (ws, addr, canh) => ws.getCell(addr).border?.[canh]?.style ?? "-";
    const timHang = (ws, re) => {
      let r = null;
      ws.eachRow({ includeEmpty: false }, (row, i) => {
        if (r != null) return;
        for (const L of ["B", "C", "D", "E", "F", "G", "H", "I", "J"]) {
          if (re.test(chu(row.getCell(L).value).trim())) { r = i; return; }
        }
      });
      return r;
    };
    /** Đáy hàng "Thành Tiền" đọc từ ô nhãn đầu → ô tiền: phải LIỀN một nét. */
    const dayKhoiTong = async (ma, nhan0, oTien) => {
      const ws = await moFile(await buildQuoteBuffer(baoGiaKhung(ma, 5)));
      const r = timHang(ws, /^Thành Tiền$/);
      expect(r, `${ma}: không thấy hàng Thành Tiền`).toBeTruthy();
      const day = [];
      for (let i = nhan0.charCodeAt(0); i <= oTien.charCodeAt(0); i++) {
        day.push(net(ws, `${String.fromCharCode(i)}${r}`, "bottom"));
      }
      return day;
    };

    const chuanGN = await dayKhoiTong("marico_decor", "F", "H");
    expect(new Set(chuanGN).size, `GN tự nó phải có đáy LIỀN thì mới làm chuẩn được: ${chuanGN}`).toBe(1);
    expect(chuanGN[0], "GN dùng nét dày ở đáy khối tổng").toBe("medium");

    for (const [ma, nhan0, oTien] of [["clofull_decor", "F", "H"], ["clofull_banner", "F", "H"], ["clofull_conngay", "G", "I"]]) {
      const day = await dayKhoiTong(ma, nhan0, oTien);
      expect(day, `${ma}: đáy khối tổng KHÔNG liền nét như GN (GN: ${chuanGN.join(",")})`)
        .toEqual(chuanGN.map(() => chuanGN[0]).slice(0, day.length));
    }
  }, 300_000);

  it("khung NGOÀI DỪNG ở hàng hạng mục cuối — không thò xuống khối tổng", async () => {
    // Người dùng khoanh ĐỎ đúng hai chỗ này trong ảnh chụp: kéo khung xuống hết khối tổng để lại
    // HAI VẠCH DỌC lơ lửng ở cột đầu và cột cuối, cùng một ô rỗng có viền bên dưới bảng — vì khối
    // tổng chỉ chiếm ba cột giữa.
    //
    // Ca này sinh ra vì một lượt ĐỘT BIẾN cho thấy bộ kiểm KHÔNG gác điều đó: đổi `hangCuoi` từ
    // `actualLastRow` về `totalRow` mà 32/32 vẫn xanh. Một bản vá không có ca nào giữ thì lần sau
    // sẽ lặng lẽ trôi lại.
    for (const [ma, cotCuoi] of [["clofull_decor", "I"], ["clofull_banner", "I"], ["clofull_conngay", "J"]]) {
      for (const soMuc of [3, 20]) {
        const ws = await moFile(await buildQuoteBuffer(baoGiaKhung(ma, soMuc)));
        // MỐC PHẢI ĐỘC LẬP VỚI VIỀN. Lần đầu tôi neo vào "hàng cuối cùng còn viền dày" — mốc đó
        // TRÔI THEO chính cái sai cần bắt, nên ca vẫn đỏ nhưng đỏ vì lý do NGƯỢC (báo "khung dừng
        // sớm" trong khi nó thò xuống). Neo vào DỮ LIỆU: tên hạng mục cuối là "Mục N-1".
        let cuoiMuc = null;
        ws.eachRow({ includeEmpty: false }, (row, r) => {
          if (chu(row.getCell("C").value).trim() === `Mục ${soMuc - 1}`) cuoiMuc = r;
        });
        expect(cuoiMuc, `${ma} (${soMuc} mục): không thấy hàng hạng mục cuối`).toBeTruthy();
        // Vế 1 — khung KHÔNG được dừng sớm: hàng hạng mục cuối vẫn phải có khung hai bên.
        expect(netVien(ws, `B${cuoiMuc}`, "left"), `${ma} (${soMuc} mục): khung dừng SỚM, hụt hàng cuối`).toBe("medium");
        expect(netVien(ws, `${cotCuoi}${cuoiMuc}`, "right"), `${ma} (${soMuc} mục): khung dừng SỚM ở cột cuối`).toBe("medium");
        // Vế 2 — và KHÔNG thò xuống: mọi hàng bên dưới, hai cột ngoài cùng phải sạch viền. Khối
        // tổng có khung RIÊNG ở ba cột giữa (nhãn F:G + ô tiền H, conngay là G:H + I) nên hai cột
        // ngoài cùng nằm ngoài nó.
        const thua = [];
        ws.eachRow({ includeEmpty: false }, (row, r) => {
          if (r <= cuoiMuc) return;
          if (netVien(ws, `B${r}`, "left") !== "-") thua.push(`B${r}`);
          if (netVien(ws, `${cotCuoi}${r}`, "right") !== "-") thua.push(`${cotCuoi}${r}`);
        });
        expect(thua, `${ma} (${soMuc} mục): vạch dọc THỪA lơ lửng dưới bảng`).toEqual([]);
      }
    }
  }, 300_000);

  it("GN vẫn y nguyên khung của nó — không bị bản vá này chạm vào", async () => {
    const ws = await moFile(await buildQuoteBuffer(baoGiaKhung("marico_decor", 12)));
    const { hd, muc } = timHang(ws);
    expect(netVien(ws, `B${hd}`, "top")).toBe("medium");
    expect(netVien(ws, `I${muc}`, "right")).toBe("medium");
    expect(netVien(ws, `C${muc}`, "left")).toBe("thin");
  }, 300_000);

  it("TRANG IN không bóp cả bảng vào một trang", async () => {
    // `fitToHeight: 0` = "vừa một trang NGANG, cao bao nhiêu trang cũng được". Đặt 1 là bóp hết
    // vào một trang — đo trên 120 hạng mục thì chữ nhỏ tới mức vô dụng.
    for (const ma of ["clofull_decor", "clofull_banner", "clofull_conngay"]) {
      const ws = await moFile(await buildQuoteBuffer(baoGiaKhung(ma, 120)));
      const p = ws.pageSetup || {};
      expect(p.fitToHeight, `${ma}: fitToHeight=${p.fitToHeight} → Excel bóp cả bảng vào một trang`).toBe(0);
      expect(p.fitToWidth, `${ma}: không ghim vừa một trang ngang → cột cuối bị cắt`).toBe(1);
      expect(Number(p.margins?.left), `${ma}: lề trái sát mép quá, máy in thường cắt`).toBeGreaterThanOrEqual(0.7);
    }
  }, 300_000);

  it("CHIỀU CAO HÀNG đủ cho chữ ngắt theo TỪ, không che dòng cuối", async () => {
    // "Banner hàng rào: 0m8W x 0m5H x 8 tấm" trong cột Hạng Mục: Excel ngắt theo từ nên cần nhiều
    // dòng hơn phép chia số ký tự. Bản cũ tính 2 dòng (cao 33) trong khi thật là 3 → mất dòng cuối.
    // Khoá bằng BẤT BIẾN, không bằng con số cứng: chiều cao phải đủ cho số dòng do ngắt-theo-từ.
    const ws = await moFile(await buildQuoteBuffer(baoGiaKhung("clofull_decor", 3, true)));
    const { muc } = await timHang(ws);
    const rong = ws.getColumn("C").width || 12;
    const moiDong = Math.max(4, Math.floor(rong - 1));
    const ten = chu(ws.getCell(`C${muc}`).value);
    let dong = 1, dai = 0;
    for (const w of ten.split(/\s+/).filter(Boolean)) {
      const them = dai === 0 ? w.length : dai + 1 + w.length;
      if (them <= moiDong) { dai = them; continue; }
      dong++; dai = w.length;
    }
    const canCao = dong * 15 + 3;
    expect(ws.getRow(muc).height, `chữ "${ten}" cần ${dong} dòng (~${canCao}pt) mà hàng chỉ cao ${ws.getRow(muc).height}pt → dòng cuối bị che`).toBeGreaterThanOrEqual(canCao);
  }, 300_000);
});

/**
 * ============================================================================
 * MÀU CỦA COLORFULL — LẤY TỪ FILE MẪU NGƯỜI DÙNG TỰ CHỈNH, KHÔNG PHẢI TÔI CHỌN.
 *
 * Người dùng gửi "Copy of Copy of E2E_-_Nhap_tu_Excel_091-new4.xlsx" và nói đó là mẫu đã chỉnh
 * hoàn chỉnh "cả màu sắc". Đọc file đó bằng exceljs lấy ra đúng hai màu:
 *     hàng NHÓM      F6D479 (vàng nghệ)
 *     hàng NHÓM CON  D5DDA2 (xanh ô-liu)
 * Trước đó cấu hình để FCEFDB / EAF1FB — hai màu nhạt hơn hẳn, không phải thứ đã chọn.
 * Ngày 2026-09-23 người dùng sửa lại chính tệp đó: nhóm F4CFB0 · nhóm con CAD8AA (hằng số dưới).
 *
 * VÀ MỘT LỖI CỦA TÔI mà người dùng chụp màn hình chỉ ra: ở bản CÓ NGÀY, hộp nhãn "Tổng Cộng /
 * VAT / Thành Tiền" ra TRẮNG TRƠN trong khi ô tiền vẫn có nền. Nguyên nhân trong script dựng mẫu:
 * bước chép style cột SỐ LƯỢNG sang cột SỐ NGÀY chạy cho MỌI hàng, kể cả ba hàng tổng, và nó chạy
 * SAU bước dời hộp nhãn → chép đè nền vừa đặt bằng style của cột F (ô đó đã dọn sạch nền vì nằm
 * ngoài hộp nhãn). Đã đảo thứ tự hai bước.
 * ============================================================================
 */
describe("Colorfull — màu nền đúng như file mẫu người dùng chỉnh", () => {
  const NHOM = "F4CFB0";
  const NHOM_CON = "CAD8AA";
  const nenCua = (ws, addr) => {
    const f = ws.getCell(addr).fill;
    if (!f || f.type !== "pattern" || !f.fgColor) return "-";
    const g = f.fgColor;
    return g.argb ? g.argb.slice(2).toUpperCase() : `theme${g.theme}/t${Math.round((g.tint || 0) * 100) / 100}`;
  };
  const baoGiaNhom = (code) => ({
    quoteNumber: "X", projectCode: "FP_A26_004", title: "T", toCompany: "K", city: "TP. Hồ Chí Minh",
    quoteDate: new Date("2026-09-18"), vatPercent: 8, hnTables: [],
    sheets: [{
      order: 1, name: "S", groupSubtotal: false, discount: 0, extraTables: [], templateCode: code,
      items: [
        { order: 1, kind: "section", name: "NHÓM A", quantity: 1 },
        { order: 2, kind: "item", name: "Backdrop", detail: "ct", unit: "m2", quantity: 12, days: 1, unitPrice: 250_000, notes: "" },
        { order: 3, kind: "subsection", name: "Nhóm con B1", quantity: 1 },
        { order: 4, kind: "item", name: "Bàn", detail: "", unit: "cái", quantity: 4, days: 1, unitPrice: 150_000, notes: "" },
      ],
    }],
  });

  it("hàng NHÓM và NHÓM CON dùng đúng hai màu đã chọn", async () => {
    for (const ma of ["clofull_decor", "clofull_banner", "clofull_conngay"]) {
      const ws = await moFile(await buildQuoteBuffer(baoGiaNhom(ma)));
      let rNhom = null, rCon = null;
      ws.eachRow({ includeEmpty: false }, (row, r) => {
        const ten = chu(row.getCell("C").value).trim();
        if (ten === "NHÓM A") rNhom = r;
        if (ten === "Nhóm con B1") rCon = r;
      });
      expect(rNhom, `${ma}: không thấy hàng nhóm`).toBeTruthy();
      expect(rCon, `${ma}: không thấy hàng nhóm con`).toBeTruthy();
      expect(nenCua(ws, `C${rNhom}`), `${ma}: hàng NHÓM sai màu`).toBe(NHOM);
      expect(nenCua(ws, `C${rCon}`), `${ma}: hàng NHÓM CON sai màu`).toBe(NHOM_CON);
      // Hàng hạng mục thường KHÔNG được tô — tô hết thì mất ý nghĩa phân nhóm.
      expect(nenCua(ws, `C${rNhom + 1}`), `${ma}: hàng hạng mục thường bị tô màu nhóm`).toBe("-");
    }
  }, 300_000);

  it("MÀU CHỮ hàng nhóm / nhóm con cũng theo file mẫu — và GN GIỮ NGUYÊN màu cũ", async () => {
    // Đợt trước đổi `sectionFill`/`subFill` theo tệp mẫu người dùng chỉnh mà BỎ QUÊN hai màu chữ
    // vốn đóng cứng trong `src/excel.ts`, nên hàng nhóm ra chữ CAM-NÂU FF9A5B14 và nhóm con ra
    // chữ XANH DƯƠNG FF1F4E79. Người dùng mở tệp thật rồi chỉ ra đúng chỗ đó.
    // Đo trên tệp mẫu của họ: hàng nhóm = theme5 tint -0.25 (đỏ gạch) · nhóm con = FF4F513E.
    //
    // Vế thứ hai QUAN TRỌNG NGANG: ba mẫu Gia Nguyễn phải GIỮ NGUYÊN hai màu cũ. Bản vá gắn màu
    // mới vào CẤU HÌNH và để `??` rơi về giá trị cũ, nên GN không đi qua nhánh nào mới — ca này
    // khoá điều đó lại, vì "đọc code thấy không đụng" không phải bằng chứng đủ mạnh cho GN.
    const mauChu = (ws, addr) => {
      const f = ws.getCell(addr).font || {};
      const c = f.color || {};
      return c.argb ?? (c.theme != null ? `theme${c.theme}/t${Math.round((c.tint || 0) * 100) / 100}` : "(auto)");
    };
    const timHai = (ws) => {
      let rNhom = null, rCon = null;
      ws.eachRow({ includeEmpty: false }, (row, r) => {
        const ten = chu(row.getCell("C").value).trim();
        if (ten === "NHÓM A") rNhom = r;
        if (ten === "Nhóm con B1") rCon = r;
      });
      return { rNhom, rCon };
    };

    for (const ma of ["clofull_decor", "clofull_banner", "clofull_conngay"]) {
      const ws = await moFile(await buildQuoteBuffer(baoGiaNhom(ma)));
      const { rNhom, rCon } = timHai(ws);
      expect(rNhom && rCon, `${ma}: không thấy đủ hàng nhóm + nhóm con`).toBeTruthy();
      expect(mauChu(ws, `C${rNhom}`), `${ma}: chữ hàng NHÓM không phải màu của file mẫu`).toBe("theme5/t-0.25");
      expect(mauChu(ws, `C${rCon}`), `${ma}: chữ hàng NHÓM CON không phải màu của file mẫu`).toBe("FF4F513E");
    }

    for (const ma of ["marico_decor", "gn_banner", "unibenfood"]) {
      const ws = await moFile(await buildQuoteBuffer(baoGiaNhom(ma)));
      const { rNhom, rCon } = timHai(ws);
      expect(rNhom && rCon, `${ma}: không thấy đủ hàng nhóm + nhóm con`).toBeTruthy();
      expect(mauChu(ws, `C${rNhom}`), `${ma}: GN BỊ ĐỔI màu chữ hàng nhóm`).toBe("FF9A5B14");
      expect(mauChu(ws, `C${rCon}`), `${ma}: GN BỊ ĐỔI màu chữ hàng nhóm con`).toBe("FF1F4E79");
    }
  }, 300_000);

  it("hộp nhãn khối tổng CÓ nền, kể cả bản có-ngày", async () => {
    // Bản có-ngày từng ra nhãn trắng trơn trong khi ô tiền có nền — người dùng chụp màn hình
    // chỉ đúng chỗ này. Kiểm cả hai cỡ khối tổng (có và không có Discount).
    for (const [ma, cotNhan, cotTien] of [["clofull_decor", "F", "H"], ["clofull_banner", "F", "H"], ["clofull_conngay", "G", "I"]]) {
      for (const discount of [0, 50_000]) {
        const q = baoGiaNhom(ma);
        q.sheets[0].discount = discount;
        const ws = await moFile(await buildQuoteBuffer(q));
        const hang = [];
        ws.eachRow({ includeEmpty: false }, (row, r) => {
          if (/^(Tổng Cộng|Cộng|VAT|Thành Tiền|Discount)/.test(chu(row.getCell(cotNhan).value).trim())) hang.push(r);
        });
        expect(hang.length, `${ma}: không thấy hàng tổng nào`).toBeGreaterThanOrEqual(3);
        for (const r of hang) {
          expect(nenCua(ws, `${cotNhan}${r}`), `${ma}${discount ? " +discount" : ""} r${r}: hộp nhãn MẤT nền`).not.toBe("-");
          expect(nenCua(ws, `${cotTien}${r}`), `${ma}${discount ? " +discount" : ""} r${r}: ô tiền mất nền`).not.toBe("-");
        }
      }
    }
  }, 300_000);
});

/**
 * ============================================================================
 * BỐN CHỖ COLORFULL HỌC THEO GIA NGUYỄN (người dùng chỉ ra trên ảnh chụp, 2026-09-25).
 *
 *   1. ô STT "bự quá": mẫu để cột B 12,36 cho một cột chỉ chứa "A" / "1".."99" — GN 6,63;
 *   2. chưa có MÃ BÁO GIÁ — "nằm dưới cùng mấy chỗ thông tin, y hệt GN": dòng "(Số://…)" nghiêng;
 *   3. tên hạng mục có màu như GN (GN xanh 0070C0), theo tông nền tiêu đề cột của Colorfull;
 *   4. "(VNĐ)" sau Đơn Giá / Thành Tiền như GN.
 * Cả BA mẫu Colorfull. Cột dôi ra của STT dồn cho Hạng Mục sao cho mép cột D không xê dịch — logo
 * COLORFUL neo B → D, nên nó giữ nguyên hình; ca logo bên dưới khoá đúng điều đó.
 * ============================================================================
 */
describe("Colorfull — bốn chỗ học theo GN (2026-09-25)", () => {
  const MAU_CLF = ["clofull_decor", "clofull_banner", "clofull_conngay"];
  // [mẫu, cột Đơn Giá, cột Thành Tiền]
  const COT_TIEN = { clofull_decor: ["G", "H"], clofull_banner: ["G", "H"], clofull_conngay: ["H", "I"] };
  const baoGia4 = (code, over = {}) => ({
    quoteNumber: "CLF26070", projectCode: "FP_A26_002", projectVersion: 1,
    title: "Trại Buôn Người", toCompany: "CTY CP PHIM THIÊN NGÂN", toContact: "Ms. Ninh", city: "TP. Hồ Chí Minh",
    quoteDate: new Date("2026-09-25"), vatPercent: 8, hnTables: [], ...over,
    sheets: over.sheets || [{
      order: 1, name: "Booth", groupSubtotal: false, discount: 0, extraTables: [], templateCode: code,
      items: [
        { order: 1, kind: "section", name: "Booth 3m5W x 2m7H x 1m2D", quantity: 9 },
        { order: 2, kind: "item", name: "Vách giữa: 2m5W x 2m6H", detail: ". KS, ốp formex dán PP in KTS", unit: "m2", quantity: 12.7, days: 1, unitPrice: 504_000 },
        { order: 3, kind: "sub", name: "", detail: "Hàng con", unit: "m2", quantity: 1, days: 1, unitPrice: 1_000 },
        { order: 4, kind: "subsection", name: "Chi phí vận chuyển", quantity: 1 },
        { order: 5, kind: "item", name: "HCM: GLXND, BHDLVV", detail: "", unit: "bộ", quantity: 5, days: 1, unitPrice: 2_945_656 },
      ],
    }],
  });
  const hangCo = (ws, ten) => {
    let r = null;
    ws.eachRow({ includeEmpty: false }, (row, i) => { if (r == null && chu(row.getCell("C").value).trim() === ten) r = i; });
    return r;
  };
  /** Bề rộng px Excel vẽ cho bề rộng LƯU `w` (chữ số rộng nhất 7px — font Normal Calibri 11 của mẫu). */
  const px = (w) => Math.trunc(((256 * w + 18) / 256) * 7);
  const mauChu = (ws, addr) => {
    const c = ws.getCell(addr).font?.color || {};
    return c.argb ?? (c.theme != null ? `theme${c.theme}/t${Math.round((c.tint || 0) * 100) / 100}` : "(auto)");
  };

  it("cột STT rộng ĐÚNG bằng GN; phần dôi chỉ chuyển sang cột khác — mép bảng không đổi", async () => {
    const gn = await moFile(await buildQuoteBuffer(baoGia4("marico_decor", { sheets: [{ ...baoGia4("x").sheets[0], templateCode: "marico_decor" }] })));
    const rongGN = gn.getColumn("B").width;
    for (const ma of MAU_CLF) {
      const ws = await moFile(await buildQuoteBuffer(baoGia4(ma)));
      expect(ws.getColumn("B").width, `${ma}: cột STT không bằng GN`).toBe(rongGN);
      // Mép trái cột D (= A + B + C) giữ đúng px của bản trước (B 12,36 · C 34 → 87 + 238): logo neo
      // tới D nên đây là thứ giữ logo nguyên hình. Mép phải bảng (tới hết Ghi Chú) cũng không đổi.
      expect(px(ws.getColumn("B").width) + px(ws.getColumn("C").width), `${ma}: mép cột D xê dịch`).toBe(87 + 238);
      const [, cotTT] = COT_TIEN[ma];
      const cotGC = String.fromCharCode(cotTT.charCodeAt(0) + 1);
      expect(px(ws.getColumn(cotTT).width) + px(ws.getColumn(cotGC).width), `${ma}: mép phải bảng xê dịch`).toBe(105 + 113);
    }
  }, 300_000);

  it("logo COLORFUL giữ nguyên chỗ và kích thước — neo không tràn khỏi cột của nó", async () => {
    // Tệp mẫu neo logo ở cột B, lệch 596900 EMU (62,7px). B còn 46px thì độ lệch dài hơn cả cột, và
    // mỗi trình đọc xử lý chỗ tràn một kiểu (ExcelJS kẹp về mép cột, LibreOffice cho tràn sang C).
    // Các số px dưới đây theo cách Excel đo cột ở 96dpi — xem `neoAnhTrongCot`.
    const EMU_PX = 9525;
    for (const ma of MAU_CLF) {
      const ws = await moFile(await buildQuoteBuffer(baoGia4(ma)));
      expect(ws.getImages().length, `${ma}: mất logo`).toBe(1);
      const { tl, br } = ws.getImages()[0].range;
      const x = (a) => { let s = 0; for (let c = 1; c <= a.nativeCol; c++) s += px(ws.getColumn(c).width); return s + a.nativeColOff / EMU_PX; };
      for (const a of [tl, br]) {
        expect(a.nativeColOff / EMU_PX, `${ma}: neo lệch dài hơn cả cột của nó`).toBeLessThan(px(ws.getColumn(a.nativeCol + 1).width));
      }
      // Mép trái: A (27px) + 62,67px như tệp mẫu. Mép phải: mép cột D (27 + 325) + 22px như bản trước.
      expect(x(tl), `${ma}: logo xê dịch ngang`).toBeCloseTo(27 + 596900 / EMU_PX, 5);
      expect(x(br), `${ma}: logo đổi bề rộng`).toBeCloseTo(27 + 87 + 238 + 209550 / EMU_PX, 5);
      expect([tl.nativeRow, tl.nativeRowOff, br.nativeRow, br.nativeRowOff], `${ma}: logo đổi chiều cao`).toEqual([0, 0, 0, 774700]);
    }
  }, 300_000);

  it("nhãn \"(VNĐ)\" sau Đơn Giá / Thành Tiền đúng cách GN viết — và nhập lại vẫn nhận đúng cột", async () => {
    const gn = await moFile(await buildQuoteBuffer(baoGia4("x", { sheets: [{ ...baoGia4("x").sheets[0], templateCode: "marico_decor" }] })));
    const gon = (v) => chu(v).replace(/\s+/g, " ").trim();
    for (const ma of MAU_CLF) {
      const buf = await buildQuoteBuffer(baoGia4(ma));
      const ws = await moFile(buf);
      const [cDG, cTT] = COT_TIEN[ma];
      expect(ws.getCell(`${cDG}4`).value, `${ma}: nhãn Đơn Giá`).toBe("ĐƠN GIÁ\n(VNĐ)");
      expect(ws.getCell(`${cTT}4`).value, `${ma}: nhãn Thành Tiền`).toBe("THÀNH TIỀN\n(VNĐ)");
      // Cùng chữ với GN (G11/H11 — GN có thêm một dấu cách thừa trước "\n", không phải chủ ý).
      expect(gon(ws.getCell(`${cDG}4`).value)).toBe(gon(gn.getCell("G11").value));
      expect(gon(ws.getCell(`${cTT}4`).value)).toBe(gon(gn.getCell("H11").value));
      const sheet = (await parseQuoteWorkbook(buf)).sheets.find((s) => !s.skipped);
      const muc = sheet.items.find((it) => it.name === "HCM: GLXND, BHDLVV");
      expect(Number(muc?.unitPrice), `${ma}: nhập lại mất cột Đơn Giá`).toBe(2_945_656);
    }
  }, 300_000);

  it("MÃ BÁO GIÁ là dòng CUỐI khối \"Kính gửi\", nghiêng, đúng chuỗi GN in — không lọt vào bảng", async () => {
    const gn = await moFile(await buildQuoteBuffer(baoGia4("x", { sheets: [{ ...baoGia4("x").sheets[0], templateCode: "marico_decor" }] })));
    // ĐỦ năm dòng người nhận + dòng mã = 6 dòng · 94,5pt, cao hơn 67pt nướng sẵn trong mẫu — ít dòng
    // hơn thì hàng mẫu vốn đã đủ cao và phép đo chiều cao cuối bài không bao giờ đỏ được.
    const du = { toPhone: "0909 123 456", toAddress: "123 Nguyễn Văn Linh, Q.7", toEmail: "ninh@thienngan.vn" };
    for (const ma of MAU_CLF) {
      const ws = await moFile(await buildQuoteBuffer(baoGia4(ma, du)));
      const v = ws.getCell("C3").value;
      expect(Array.isArray(v?.richText), `${ma}: khối Kính gửi không có dòng mã`).toBe(true);
      const dong = chu(v).split("\n");
      expect(dong[0]).toBe("Kính gửi: CTY CP PHIM THIÊN NGÂN");
      expect(dong[1]).toBe("Ms. Ninh");
      expect(dong, `${ma}: khối Kính gửi phải đủ 5 dòng + dòng mã`).toHaveLength(6);
      expect(dong.at(-1), `${ma}: dòng mã sai`).toBe("(Số://FP_A26_002)");
      expect(dong.at(-1), `${ma}: khác chuỗi GN in ở B8`).toBe(chu(gn.getCell("B8").value));
      const [dau, cuoi] = [v.richText[0], v.richText.at(-1)];
      expect(cuoi.font?.italic, `${ma}: dòng mã không nghiêng như GN`).toBe(true);
      expect(dau.font?.italic ?? false, `${ma}: cả khối bị nghiêng lây`).toBe(false);
      for (const d of v.richText) {
        expect(d.font?.name, `${ma}: một đoạn thiếu font — Excel vẽ bằng Calibri`).toBe("Times New Roman");
        expect(d.font?.size).toBe(12);
        expect(d.font?.color, `${ma}: chữ đỏ của ô mồi lại lọt vào`).toEqual({ theme: 1 });
      }
      // Hàng 3 đủ cao cho cả dòng mã (Times 12: 15,75pt/dòng).
      expect(ws.getRow(3).height, `${ma}: dòng mã bị xén`).toBeGreaterThanOrEqual(dong.length * 15.75);
    }
  }, 300_000);

  it("nhiều sheet: mỗi tab mang mã RIÊNG của nó (_01, _02); không có mã thì không in dòng nào", async () => {
    const s = baoGia4("clofull_decor").sheets[0];
    const q = baoGia4("clofull_decor", { sheets: [s, { ...s, order: 2, name: "Lightbox", templateCode: "clofull_conngay" }] });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await buildQuoteBuffer(q));
    expect(chu(wb.worksheets[0].getCell("C3").value).split("\n").at(-1)).toBe("(Số://FP_A26_002_01)");
    expect(chu(wb.worksheets[1].getCell("C3").value).split("\n").at(-1)).toBe("(Số://FP_A26_002_02)");

    const ws = await moFile(await buildQuoteBuffer(baoGia4("clofull_decor", { quoteNumber: null, projectCode: null })));
    expect(ws.getCell("C3").value, "không có mã mà vẫn in dòng mã rỗng").toBe("Kính gửi: CTY CP PHIM THIÊN NGÂN\nMs. Ninh");
  }, 300_000);

  it("tên HẠNG MỤC có màu xanh ngọc theo nền tiêu đề cột — chỉ hàng hạng mục, nhóm / GN giữ nguyên", async () => {
    const mau = getConfig("clofull_decor").items.nameTextColor;
    expect(mau, "cấu hình phải khai màu tên hạng mục").toMatch(/^FF[0-9A-F]{6}$/);
    for (const ma of MAU_CLF) {
      expect(getConfig(ma).items.nameTextColor, `${ma}: lệch màu với bản không-ngày`).toBe(mau);
      const ws = await moFile(await buildQuoteBuffer(baoGia4(ma)));
      const [rNhom, rMuc, rCon, rMuc2] = ["Booth 3m5W x 2m7H x 1m2D", "Vách giữa: 2m5W x 2m6H", "Chi phí vận chuyển", "HCM: GLXND, BHDLVV"].map((t) => hangCo(ws, t));
      expect(rNhom && rMuc && rCon && rMuc2, `${ma}: không thấy đủ hàng`).toBeTruthy();
      expect(mauChu(ws, `C${rMuc}`), `${ma}: tên hạng mục chưa có màu`).toBe(mau);
      expect(mauChu(ws, `C${rMuc2}`), `${ma}: tên hạng mục dưới nhóm con chưa có màu`).toBe(mau);
      expect(ws.getCell(`C${rMuc}`).font?.bold, `${ma}: tên mất đậm`).toBe(true);
      // Hàng con (sub) dùng chung ô tên GỘP của hàng hạng mục → cùng màu.
      expect(ws.getCell(`C${rMuc + 1}`).master?.address, `${ma}: hàng con không gộp tên`).toBe(`C${rMuc}`);
      // Không đụng: nhóm, nhóm con, STT, Chi Tiết của hàng hạng mục.
      expect(mauChu(ws, `C${rNhom}`)).toBe("theme5/t-0.25");
      expect(mauChu(ws, `C${rCon}`)).toBe("FF4F513E");
      expect(mauChu(ws, `B${rMuc}`), `${ma}: màu STT bị đổi lây`).toBe("theme9/t-0.5");
      expect(mauChu(ws, `D${rMuc}`), `${ma}: màu Chi Tiết bị đổi lây`).not.toBe(mau);
    }
    // GN không khai khoá này — tên vẫn xanh 0070C0 nướng sẵn trong tệp mẫu.
    for (const ma of ["marico_decor", "gn_banner", "unibenfood"]) {
      expect(getConfig(ma).items.nameTextColor, `${ma}: GN bị gắn màu Colorfull`).toBeUndefined();
      const ws = await moFile(await buildQuoteBuffer(baoGia4("x", { sheets: [{ ...baoGia4("x").sheets[0], templateCode: ma }] })));
      expect(mauChu(ws, `C${hangCo(ws, "Vách giữa: 2m5W x 2m6H")}`), `${ma}: GN đổi màu tên`).toBe("FF0070C0");
    }
  }, 300_000);
});
