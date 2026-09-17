/**
 * ============================================================================
 * MẪU "CÓ NGÀY" DỰNG LẠI TRÊN NỀN "KHÔNG NGÀY".
 *
 * ── HAI LỖI CỦA BẢN CŨ (`templates/Unibenfood.xlsx`) ──────────────────────
 * Đo trên file THẬT xuất từ production — báo giá #40, trang "Premiere":
 *
 *   1. HAI DÒNG TIÊU ĐỀ TRÙNG NHAU. r10 và r11 y hệt:
 *        STT | Hạng Mục | ĐVT | Số Lượng | Số Ngày | Đơn Giá | Thành Tiền
 *      Lỗi nằm NGAY TRONG FILE MẪU, nên MỌI file khách nhận được đều mang theo. Không bài kiểm nào
 *      thấy vì bộ kiểm chỉ so HASH toàn cục — hash khớp thì coi như "giữ nguyên output", kể cả khi
 *      output vốn đã sai từ đầu.
 *
 *   2. BỐ CỤC LỆCH HẲN bản không-ngày → mọi bản vá phải làm HAI LẦN. Gần nhất: xoá nhãn "Ms."
 *      nhúng cứng ở B3/E3 chỉ vá được cho nền Marico; bản có-ngày không hưởng và vẫn in "Ms.".
 *
 * ── BẢN MỚI ────────────────────────────────────────────────────────────────
 * `templates/GN_CoNgay.xlsx` dựng từ Marico_Decor.xlsx bằng
 * `node scripts/dung-mau-co-ngay.mjs` — CHỈ đổi nhãn cột, không chèn/xoá cột nào, nên vùng gộp của
 * ba hàng tổng, bề rộng và vùng in giữ nguyên.
 *
 *   B     C          D     E          F         G        H            I
 *   STT   Hạng Mục   ĐVT   SỐ LƯỢNG   SỐ NGÀY   ĐƠN GIÁ  THÀNH TIỀN   GHI CHÚ
 *
 * ── VẾ ĐỐI TRỌNG QUAN TRỌNG NHẤT ───────────────────────────────────────────
 * Bản không-ngày và bản banner ĐANG CHẠY ĐÚNG. Cụm bài cuối tệp này khoá chúng lại: `gn_banner`
 * spread từ `marico_decor`, nên một thay đổi lỡ tay ở `marico_decor` làm hỏng CẢ HAI cùng lúc.
 * ============================================================================
 */
import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { buildQuoteBuffer } from "../src/excel.js";
import { getConfig } from "../src/templateConfigs.js";
import { parseQuoteWorkbook, computeSubtotal } from "../src/excelImport.js";

const chu = (v) =>
  v && typeof v === "object" && Array.isArray(v.richText)
    ? v.richText.map((x) => x.text).join("")
    : v && typeof v === "object" && v.formula
      ? `=${v.formula}`
      : String(v ?? "");

/** Báo giá có đủ: mục thường, NHÓM có số lượng (nhân tổng con), và mục KHÔNG điền ngày. */
const baoGia = (templateCode) => ({
  id: 1,
  quoteNumber: "GN26999",
  title: "Thử có ngày",
  toCompany: "CGV",
  toContact: "Mr. Tài",
  fromContact: "Lan Anh",
  fromTitle: "Account",
  fromPhone: "0914291951",
  fromAddress: "34 Đào Trí, P.Phú Thuận, Q.7 TP.HCM",
  city: "TP. Hồ Chí Minh",
  quoteDate: new Date("2026-09-17T00:00:00Z"),
  vatPercent: 8,
  hnTables: [],
  sheets: [
    {
      id: 1,
      name: "Premiere",
      order: 1,
      templateCode,
      groupSubtotal: false,
      discount: 0,
      extraTables: [],
      items: [
        { order: 1, kind: "item", name: "Backdrop", unit: "cái", quantity: 2, days: 3, unitPrice: 500_000, notes: "ghi chú A" },
        { order: 2, kind: "section", name: "Nhóm booth", quantity: 1 },
        { order: 3, kind: "item", name: "Booth con", unit: "bộ", quantity: 1, days: 4, unitPrice: 250_000 },
        { order: 4, kind: "item", name: "Không điền ngày", unit: "m2", quantity: 5, days: null, unitPrice: 100_000 },
      ],
    },
  ],
});

async function moFile(buf) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  return wb.worksheets[0];
}

const HANG_TIEU_DE = 11;

describe("Mẫu CÓ NGÀY — bố cục cột", () => {
  it("hàng tiêu đề đúng thứ tự đã chốt", async () => {
    const ws = await moFile(await buildQuoteBuffer(baoGia("unibenfood")));
    const got = ["B", "C", "D", "E", "F", "G", "H", "I"].map((c) =>
      chu(ws.getCell(`${c}${HANG_TIEU_DE}`).value).replace(/\s+/g, " ").trim().toUpperCase(),
    );
    expect(got[0]).toBe("STT");
    expect(got[1]).toBe("HẠNG MỤC");
    expect(got[2]).toBe("ĐVT");
    expect(got[3]).toBe("SỐ LƯỢNG");
    expect(got[4]).toBe("SỐ NGÀY");
    expect(got[5]).toMatch(/^ĐƠN GIÁ/);
    expect(got[6]).toMatch(/^THÀNH TIỀN/);
    expect(got[7]).toBe("GHI CHÚ");
  }, 120_000);

  it("KHÔNG có dòng tiêu đề thứ hai — đúng lỗi của bản cũ", async () => {
    // Bản cũ có tiêu đề ở CẢ r10 lẫn r11. Quét rộng để nếu bố cục dời chỗ vẫn bắt được.
    const ws = await moFile(await buildQuoteBuffer(baoGia("unibenfood")));
    const soDongTieuDe = [];
    ws.eachRow({ includeEmpty: false }, (row, r) => {
      if (r > 20) return;
      const b = chu(row.getCell("B").value).trim().toUpperCase();
      const c = chu(row.getCell("C").value).trim().toUpperCase();
      if (b === "STT" && c === "HẠNG MỤC") soDongTieuDe.push(r);
    });
    expect(soDongTieuDe, `tiêu đề xuất hiện ở các hàng: ${soDongTieuDe.join(", ")}`).toHaveLength(1);
  }, 120_000);

  it("KHÔNG còn cột Chi Tiết ở bất kỳ đâu", async () => {
    // Bỏ THẬT, không phải ẩn: không ô nào trong 20 hàng đầu được mang nhãn đó.
    const ws = await moFile(await buildQuoteBuffer(baoGia("unibenfood")));
    const xau = [];
    ws.eachRow({ includeEmpty: false }, (row, r) => {
      if (r > 20) return;
      row.eachCell({ includeEmpty: false }, (cell) => {
        if (/^\s*chi\s*ti[êế]t\s*$/i.test(chu(cell.value))) xau.push(`${cell.address}`);
      });
    });
    expect(xau, `còn nhãn Chi Tiết ở: ${xau.join(", ")}`).toEqual([]);
  }, 120_000);
});

describe("Mẫu CÓ NGÀY — số liệu và công thức", () => {
  it("Số Ngày ghi đúng cột F, và Thành Tiền nhân cả ba thừa số", async () => {
    const ws = await moFile(await buildQuoteBuffer(baoGia("unibenfood")));
    const hang = [];
    ws.eachRow({ includeEmpty: false }, (row, r) => {
      if (r <= HANG_TIEU_DE || r > 20) return;
      const ten = chu(row.getCell("C").value).trim();
      if (ten) hang.push({ r, ten, sl: chu(row.getCell("E").value), ngay: chu(row.getCell("F").value), gia: chu(row.getCell("G").value), tien: chu(row.getCell("H").value) });
    });

    const bd = hang.find((h) => h.ten === "Backdrop");
    expect(bd, `không thấy hàng Backdrop: ${JSON.stringify(hang)}`).toBeTruthy();
    expect(bd.sl).toBe("2");
    expect(bd.ngay, "số ngày không vào cột F").toBe("3");
    expect(bd.gia).toBe("500000");
    // Công thức SỐNG để khách mở file vẫn tính lại được — và phải gồm ĐỦ ba thừa số.
    expect(bd.tien).toContain(`G${bd.r}`);
    expect(bd.tien).toContain(`E${bd.r}`);
    expect(bd.tien, "công thức thiếu thừa số SỐ NGÀY").toContain(`F${bd.r}`);
  }, 120_000);

  it("mục KHÔNG điền ngày vẫn ra đúng tiền — coi như 1 ngày", async () => {
    // Vế dễ hỏng nhất: `days` null mà nhân thẳng thì mọi dòng chưa điền ngày thành 0 đồng.
    const ws = await moFile(await buildQuoteBuffer(baoGia("unibenfood")));
    let hang = null;
    ws.eachRow({ includeEmpty: false }, (row, r) => {
      if (chu(row.getCell("C").value).trim() === "Không điền ngày") hang = { r, ngay: chu(row.getCell("F").value) };
    });
    expect(hang, "không thấy hàng 'Không điền ngày'").toBeTruthy();
    expect(hang.ngay, "ô Số Ngày để trống/0 → Excel tính ra 0 đồng").toBe("1");
  }, 120_000);

  it("GHI CHÚ của hạng mục vào đúng cột I", async () => {
    const ws = await moFile(await buildQuoteBuffer(baoGia("unibenfood")));
    let thay = false;
    ws.eachRow({ includeEmpty: false }, (row, r) => {
      if (r > 20) return;
      if (chu(row.getCell("I").value).includes("ghi chú A")) thay = true;
    });
    expect(thay, "ghi chú hạng mục không tới cột I").toBe(true);
  }, 120_000);
});

describe("KHÔNG được đụng bản KHÔNG NGÀY và bản BANNER", () => {
  // `gn_banner` spread từ `marico_decor`, nên một thay đổi lỡ tay ở `marico_decor` làm hỏng CẢ HAI.
  // Hai bản này đang chạy đúng trên production — đây là vế giữ chúng nguyên vẹn.
  it("marico_decor giữ nguyên bố cục cột và công thức", () => {
    const c = getConfig("marico_decor");
    expect(c.filePath).toBe("templates/Marico_Decor.xlsx");
    expect(c.items.columns).toMatchObject({ stt: "B", name: "C", detail: "D", unit: "E", quantity: "F", unitPrice: "G", amount: "H", notes: "I" });
    expect(c.items.removeDetail, "bản không-ngày vốn GỘP C:D để giấu Chi Tiết").toBe(true);
    expect(c.items.amountFormula(12), "công thức bản không-ngày KHÔNG được có thừa số ngày").toBe("G12*F12");
    expect(c.items.columns.days, "bản không-ngày không được có cột ngày").toBeUndefined();
  });

  it("gn_banner vẫn thừa hưởng marico_decor và giữ cờ đánh số nhóm con", () => {
    const b = getConfig("gn_banner");
    expect(b.filePath).toBe("templates/Marico_Decor.xlsx");
    expect(b.items.amountFormula(12)).toBe("G12*F12");
    expect(b.items.numberSubsections).toBe(true);
    expect(b.items.columns.days).toBeUndefined();
  });

  it("có-ngày và không-ngày dùng HAI file mẫu khác nhau", () => {
    expect(getConfig("unibenfood").filePath).toBe("templates/GN_CoNgay.xlsx");
    expect(getConfig("unibenfood").filePath).not.toBe(getConfig("marico_decor").filePath);
    expect(getConfig("unibenfood").items.amountFormula(12)).toBe("G12*E12*F12");
  });
});

describe("Vòng tròn XUẤT → NHẬP LẠI", () => {
  // Người dùng xuất file, sửa trong Excel, rồi nạp lại — đường đi thật của họ. Bố cục cột mới phải
  // được bộ nhập nhận ra, nếu không thì SỐ NGÀY rơi mất và mọi dòng tụt giá trị.
  it("nhập lại file vừa xuất: nhận đúng mẫu CÓ NGÀY và giữ nguyên số ngày", async () => {
    const buf = await buildQuoteBuffer(baoGia("unibenfood"));
    const kq = await parseQuoteWorkbook(Buffer.from(buf));
    const trang = kq.sheets.filter((s) => !s.skipped);
    expect(trang.length, `không trang nào nạp được: ${JSON.stringify(kq.sheets.map((s) => s.skipped))}`).toBeGreaterThan(0);

    const t = trang[0];
    expect(t.hasDays, "bộ nhập KHÔNG nhận ra cột Số Ngày → mọi dòng mất thừa số ngày").toBe(true);
    expect(t.columns.days, "cột ngày phải là F theo bố cục đã chốt").toBe("F");
    expect(t.columns.unit).toBe("D");
    expect(t.columns.quantity).toBe("E");
    expect(t.columns.notes).toBe("I");

    const bd = t.items.find((i) => (i.name || "").includes("Backdrop"));
    expect(bd, `không nhập lại được hàng Backdrop: ${JSON.stringify(t.items.map((i) => i.name))}`).toBeTruthy();
    expect(Number(bd.quantity)).toBe(2);
    expect(Number(bd.days), "số ngày rơi mất khi nhập lại").toBe(3);
    expect(Number(bd.unitPrice)).toBe(500_000);
  }, 120_000);

  it("tổng tính lại sau khi nhập KHỚP với tổng lúc xuất", async () => {
    // Vế tiền: nhận đúng cột mà tính sai thì vẫn mất tiền. 2×3×500.000 + 1×4×250.000 + 5×1×100.000
    const buf = await buildQuoteBuffer(baoGia("unibenfood"));
    const kq = await parseQuoteWorkbook(Buffer.from(buf));
    const t = kq.sheets.find((s) => !s.skipped);
    expect(computeSubtotal(t)).toBe(2 * 3 * 500_000 + 1 * 4 * 250_000 + 5 * 1 * 100_000);
  }, 120_000);

  it("bản KHÔNG NGÀY nhập lại vẫn KHÔNG có cột ngày", async () => {
    // Vế đối trọng: nếu bộ nhập bỗng thấy cột ngày ở bản không-ngày thì nó đang đọc nhầm cột khác.
    const buf = await buildQuoteBuffer(baoGia("marico_decor"));
    const kq = await parseQuoteWorkbook(Buffer.from(buf));
    const t = kq.sheets.find((s) => !s.skipped);
    expect(t.hasDays).toBe(false);
    expect(t.columns.days).toBeUndefined();
  }, 120_000);
});

describe("Quy tắc LÀM TRÒN phải y hệt bản không-ngày", () => {
  // Tiền Việt không có đơn vị nhỏ hơn đồng. Bản không-ngày bọc ROUND quanh công thức để khách mở
  // file ra KHÔNG thấy số lẻ thập phân; bản có-ngày phải làm y hệt, nếu không hai mẫu cho hai con
  // số khác nhau trên cùng một báo giá.
  const congThuc = async (code) => {
    const ws = await moFile(await buildQuoteBuffer(baoGia(code)));
    let ct = null;
    ws.eachRow({ includeEmpty: false }, (row, r) => {
      if (r <= HANG_TIEU_DE || r > 20) return;
      if (chu(row.getCell("C").value).trim() === "Backdrop") ct = chu(row.getCell("H").value);
    });
    return ct;
  };

  it("có-ngày bọc ROUND giống không-ngày", async () => {
    const coNgay = await congThuc("unibenfood");
    const khongNgay = await congThuc("marico_decor");
    expect(coNgay, `công thức có-ngày: ${coNgay}`).toMatch(/^=ROUND\(/);
    expect(khongNgay).toMatch(/^=ROUND\(/);
    // Cùng số chữ số thập phân — khác nhau là hai mẫu làm tròn khác nhau.
    const soLe = (ct) => (ct.match(/,\s*(-?\d+)\s*\)/) || [])[1];
    expect(soLe(coNgay), "số chữ số làm tròn khác bản không-ngày").toBe(soLe(khongNgay));
  }, 120_000);

  it("đơn giá LẺ vẫn ra số nguyên đồng", async () => {
    // 3 ngày × 2 cái × 333.333,33 đ = 1.999.999,98 → phải thành 2.000.000, không để số lẻ.
    const q = baoGia("unibenfood");
    q.sheets[0].items[0].unitPrice = 333_333.33;
    const ws = await moFile(await buildQuoteBuffer(q));
    let gia = null;
    ws.eachRow({ includeEmpty: false }, (row) => {
      if (chu(row.getCell("C").value).trim() === "Backdrop") gia = row.getCell("G").value;
    });
    expect(gia, "đơn giá không tới được ô G").not.toBeNull();
    // Công thức SỐNG nên Excel tự tính; điều cần khoá là nó ĐƯỢC BỌC ROUND (bài trên), còn ở đây
    // khoá rằng đơn giá KHÔNG bị app tự ý làm tròn mất phần lẻ người dùng đã nhập.
    expect(Number(gia)).toBeCloseTo(333_333.33, 2);
  }, 120_000);
});

describe("Thừa hưởng ĐỦ tuỳ biến của bản không-ngày", () => {
  // Bản không-ngày có nhiều thứ đã chỉnh tay: bảng màu hàng nhóm, màu số tiền tổng, dòng "Ghi chú",
  // khối chân trang hai cột + chỗ ký. Bê nền sang mà rơi mất một trong số đó thì file có-ngày trông
  // khác hẳn file không-ngày của cùng công ty — đúng thứ kế toán nhận ra ngay.
  const cfg = () => getConfig("unibenfood");
  const goc = () => getConfig("marico_decor");

  it("bảng màu giống hệt bản không-ngày", () => {
    expect(cfg().palette).toEqual(goc().palette);
    // Nêu đích danh vài khoá để nếu ai đó làm rỗng cả `palette` thì bài này vẫn nói ra cái gì mất.
    expect(cfg().palette.sectionFill).toBeTruthy();
    expect(cfg().palette.totalsValueColor).toBeTruthy();
    expect(cfg().palette.note).toBeTruthy();
    expect(cfg().palette.footer.customer.text).toBe("Ý Kiến Khách Hàng");
  });

  it("khối Tổng/VAT/Discount/Thành Tiền giống hệt", () => {
    expect(cfg().totals).toEqual(goc().totals);
  });

  it("quy tắc dọn mẫu giống hệt — gồm cả việc xoá nhãn 'Ms.'", () => {
    expect(cfg().cleanup).toEqual(goc().cleanup);
    expect(cfg().cleanup.extraCellsToClear).toContain("B3");
    expect(cfg().cleanup.extraCellsToClear).toContain("E3");
  });

  it("vị trí ô thông tin khách/người gửi giống hệt", () => {
    expect(cfg().cells).toEqual(goc().cells);
  });

  it("hàng nhóm THẬT SỰ được tô màu trong file xuất ra", async () => {
    // Cấu hình giống nhau chưa chứng minh file ra giống nhau — phải mở file mà xem.
    const ws = await moFile(await buildQuoteBuffer(baoGia("unibenfood")));
    let o = null;
    ws.eachRow({ includeEmpty: false }, (row) => {
      if (chu(row.getCell("C").value).trim() === "Nhóm booth") o = row.getCell("C");
    });
    expect(o, "không thấy hàng nhóm").toBeTruthy();
    const nen = o.fill && o.fill.fgColor && o.fill.fgColor.argb;
    // SO VỚI BẢN KHÔNG-NGÀY, KHÔNG so với `palette.sectionFill`: màu thật của hàng nhóm là màu
    // BAKED sẵn trong file mẫu, `palette.sectionFill` chỉ là một trong mấy nguồn màu. Chốt vào
    // hằng số trong config sẽ khoá sai thứ — điều cần chứng minh là HAI MẪU RA CÙNG MỘT MÀU.
    const wsGoc = await moFile(await buildQuoteBuffer(baoGia("marico_decor")));
    let oGoc = null;
    wsGoc.eachRow({ includeEmpty: false }, (row) => {
      if (chu(row.getCell("C").value).trim() === "Nhóm booth") oGoc = row.getCell("C");
    });
    expect(oGoc, "bản không-ngày không có hàng nhóm để đối chiếu").toBeTruthy();
    const nenGoc = oGoc.fill && oGoc.fill.fgColor && oGoc.fill.fgColor.argb;
    expect(nen, "hàng nhóm không được tô nền").toBeTruthy();
    expect(nen, `màu hàng nhóm LỆCH bản không-ngày (${nen} ≠ ${nenGoc})`).toBe(nenGoc);
  }, 120_000);

  it("chân trang có đủ lời chào và 'Ý Kiến Khách Hàng'", async () => {
    const ws = await moFile(await buildQuoteBuffer(baoGia("unibenfood")));
    let chuoi = "";
    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (c) => { chuoi += chu(c.value) + "\n"; });
    });
    expect(chuoi).toContain("Rất mong nhận được sự phúc đáp sớm");
    expect(chuoi).toContain("Trân trọng kính chào");
    expect(chuoi).toContain("Ý Kiến Khách Hàng");
  }, 120_000);

  it("KHÔNG còn nhãn 'Ms.' nhúng cứng — bản có-ngày CŨ vẫn còn", async () => {
    // Đây là lợi ích cụ thể nhất của việc dùng chung nền: bản vá xoá nhãn danh xưng làm cho bản
    // không-ngày ngày 2026-09-17 nay tự động áp cho cả bản có-ngày.
    const ws = await moFile(await buildQuoteBuffer(baoGia("unibenfood")));
    const xau = [];
    ws.eachRow({ includeEmpty: false }, (row, r) => {
      if (r > 10) return;
      row.eachCell({ includeEmpty: false }, (c) => {
        if (/^\s*(Ms|Mr|Mrs)\.?\s*$/i.test(chu(c.value))) xau.push(`${c.address}="${chu(c.value).trim()}"`);
      });
    });
    expect(xau, `còn nhãn danh xưng trần: ${xau.join(", ")}`).toEqual([]);
    expect(chu(ws.getCell("C3").value), "tên khách phải còn nguyên").toContain("Mr. Tài");
  }, 120_000);
});
