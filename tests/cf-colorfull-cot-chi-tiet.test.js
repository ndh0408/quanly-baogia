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

  it("bề rộng cột về đúng thiết kế của mẫu (D rộng hơn C)", async () => {
    // Bản cũ: C 38 / D 10 — nghĩa là cột kể nội dung hẹp hơn cột tên bốn lần.
    const ws = await moFile(await buildQuoteBuffer(baoGia("clofull_decor")));
    const wC = ws.getColumn("C").width, wD = ws.getColumn("D").width;
    expect(wD, `Chi Tiết còn hẹp (${wD}) — nội dung nhiều dòng sẽ bị bóp`).toBeGreaterThan(wC);
    expect(wD).toBeGreaterThanOrEqual(40);
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
    expect(tieuDe).toEqual(["STT", "HẠNG MỤC", "CHI TIẾT", "ĐVT", "SỐ LƯỢNG", "SỐ NGÀY", "ĐƠN GIÁ", "THÀNH TIỀN", "GHI CHÚ"]);
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

  it("có ngày: nhãn khối tổng nới tới H, số tiền sang I — không chừa ô trắng giữa nhãn và số", async () => {
    // Đây là chỗ `spliceColumns` bỏ quên: nó dời giá trị mà KHÔNG dời vùng gộp, nên nhãn
    // "Tổng Cộng" từng biến mất khỏi B13 trong khi một ô gộp rỗng nằm đè lên chỗ cũ.
    const ws = await moFile(await buildQuoteBuffer(baoGiaNgay()));
    let hangTong = null;
    ws.eachRow({ includeEmpty: false }, (row, r) => {
      if (hangTong == null && chu(row.getCell("B").value).trim() === "Tổng Cộng") hangTong = r;
    });
    expect(hangTong, "không tìm thấy hàng Tổng Cộng").toBeTruthy();
    expect(oChu(ws, `H${hangTong}`), "vùng nhãn không phủ tới H → có ô trắng cạnh số tiền").toBe(`B${hangTong}`);
    expect(chu(ws.getCell(`I${hangTong}`).value), "số tiền tổng không nằm ở cột I").toMatch(/^=SUM\(I\d+:I\d+\)$/);
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

  it("khối điều khoản của mẫu KHÔNG được biến mất khi bảng nở thêm hàng hoặc có Discount", async () => {
    // Mẫu CLF có sẵn khối "* Ghi chú: - Tất cả các hạng mục trên là cho thuê…" ở ô GỘP C17:D17.
    // `duplicateRow` dời chữ xuống đúng hàng mới nhưng để lại danh sách gộp CŨ (C17:D17) — trạng
    // thái mâu thuẫn. Bước "dọn ô phụ" sau đó gán null cho D(hàng mới), mà ExcelJS ghi XUYÊN từ ô
    // phụ sang ô chủ ⇒ xoá trắng chính chữ đó. Đo trước khi vá: từ 8 mục trở lên là mất.
    for (const ma of ["clofull_decor", "clofull_banner", "clofull_conngay"]) {
      for (const [n, discount] of [[2, 0], [8, 0], [20, 0], [8, 50_000]]) {
        const ws = await moFile(await buildQuoteBuffer(baoGiaN(ma, n, { discount })));
        const hit = quetChu(ws, "Tất cả các hạng mục");
        expect(hit.length, `${ma} (${n} mục${discount ? " + discount" : ""}): mất khối điều khoản`).toBeGreaterThan(0);
        // và phải còn là MỘT ô gộp C:D, không phải chữ nhân đôi ra hai cột.
        expect(oChu(ws, hit[hit.length - 1]), "khối điều khoản không còn gộp C:D").toBe(hit[0]);
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
