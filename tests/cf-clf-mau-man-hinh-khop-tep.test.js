/**
 * ============================================================================
 * MÀU LƯỚI TRÊN MÀN HÌNH PHẢI KHỚP MÀU TRONG TỆP EXCEL — COLORFULL.
 *
 * Người soạn nhìn lưới để biết khách sắp nhận cái gì. Hai đầu lệch nhau thì cái nhìn ấy vô giá
 * trị, và lệch được là vì màu khai ở HAI NƠI: `src/templateConfigs.ts` (tệp) và CSS (màn hình).
 *
 * Đã lệch thật, hai lần, đo được trên tệp do máy chủ dev xuất ra:
 *   · hàng nhóm / nhóm con — đổi sang F6D479 / D5DDA2 trong cấu hình mà `.clf-theme` trong
 *     `public/style.css` vẫn #fcefdb / #eaf1fb (màu Colorfull CŨ).
 *   · hàng tiêu đề — tệp giữ nền nướng sẵn (`paintHeader: false`), khi ấy là theme8 tint 0.4 = #93CDDD
 *     xanh ngọc, còn màn hình để #ffcc99 peach (màu header của Gia Nguyễn). Lệch này có TRƯỚC
 *     đợt vá cột Chi Tiết.
 *
 * `public/style.css` là tệp ĐÓNG BĂNG (không sửa) — phần đè nằm ở `web/src/styles.css`, nạp SAU
 * nên cùng độ ưu tiên thì bản dưới thắng (xem web/src/main.tsx:10-11).
 * ============================================================================
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { getConfig } from "../src/templateConfigs.js";

const CSS = fs.readFileSync(path.join(process.cwd(), "web/src/styles.css"), "utf8");

/** Màu nền cuối cùng thắng cho một bộ chọn — lấy lần khai SAU CÙNG trong tệp đè. */
function nenCuoiCung(boChon) {
  const re = new RegExp(`${boChon.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{[^}]*background:\\s*(#[0-9A-Fa-f]{3,8})`, "g");
  let m, cuoi = null;
  while ((m = re.exec(CSS))) cuoi = m[1].toLowerCase();
  return cuoi;
}

/** "FFF6D479" (argb của ExcelJS) → "#f6d479" (css). */
const argbSangCss = (argb) => "#" + String(argb).slice(-6).toLowerCase();

/**
 * Màu CHỮ cuối cùng thắng cho một bộ chọn. Khác `nenCuoiCung`: các luật màu chữ viết theo DANH
 * SÁCH bộ chọn ("a, b, c { color: … }"), nên phải tách danh sách ra rồi so từng bộ chọn — dò kiểu
 * "bộ chọn ngay trước {" sẽ chỉ thấy bộ chọn CUỐI của danh sách.
 */
function mauChuCuoiCung(boChon) {
  const khongChuThich = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
  const re = /([^{}]+)\{([^}]*)\}/g;
  let m, cuoi = null;
  while ((m = re.exec(khongChuThich))) {
    const ds = m[1].split(",").map((x) => x.trim().replace(/\s+/g, " "));
    const mau = /(?:^|;)\s*color:\s*(#[0-9A-Fa-f]{3,8})/.exec(m[2]);
    if (mau && ds.includes(boChon)) cuoi = mau[1].toLowerCase();
  }
  return cuoi;
}

/**
 * ÁP `tint` LÊN MỘT MÀU ĐÚNG CÁCH EXCEL VẼ: đổi RGB → HLS rồi L' = L·(1+tint) khi tint âm (tối đi),
 * L' = L·(1−tint) + HLSMAX·tint khi tint dương (sáng lên) — ECMA-376, thuộc tính `tint` của CT_Color.
 * Chỗ dễ sai là THANG SỐ: Excel dùng HLS SỐ NGUYÊN thang 240 của Windows (ColorRGBToHLS /
 * ColorHLSToRGB, phép chia nguyên), không phải HSL số thực. Hai cách lệch nhau ±1 mỗi kênh — đủ làm
 * "màn hình khớp tệp" thành gần đúng. Đo bằng Excel COM (Range.Font.Color) trên tệp Colorfull xuất ra,
 * 2026-09-29: theme 9 tint -0.49998 (accent6 F79646) → #974706 (HSL số thực cho #984807); theme 5 tint
 * -0.24998 (accent2 C0504D) → #963634 (HSL số thực cho #953735 — số bảng màu Office in). Ca "bộ giải
 * theme khớp Excel" bên dưới khoá đúng hai số đo ấy.
 */
function apTint(hex6, tint) {
  const HLSMAX = 240, RGBMAX = 255, T = Math.trunc;
  const [R, G, B] = [0, 2, 4].map((i) => parseInt(hex6.slice(i, i + 2), 16));
  const cMax = Math.max(R, G, B), cMin = Math.min(R, G, B), d = cMax - cMin;
  const L = T(((cMax + cMin) * HLSMAX + RGBMAX) / (2 * RGBMAX));
  let H = 0, S = 0;
  if (d > 0) {
    S = L <= HLSMAX / 2 ? T((d * HLSMAX + (cMax + cMin) / 2) / (cMax + cMin)) : T((d * HLSMAX + (2 * RGBMAX - cMax - cMin) / 2) / (2 * RGBMAX - cMax - cMin));
    const lech = (v) => T(((cMax - v) * (HLSMAX / 6) + d / 2) / d);
    H = R === cMax ? lech(B) - lech(G) : G === cMax ? HLSMAX / 3 + lech(R) - lech(B) : (2 * HLSMAX) / 3 + lech(G) - lech(R);
    H = (H + HLSMAX) % HLSMAX;
  }
  const L2 = T(tint < 0 ? L * (1 + tint) : L * (1 - tint) + HLSMAX * tint);
  const kenh = (n1, n2, h) => {
    h = (h + HLSMAX) % HLSMAX;
    if (h < HLSMAX / 6) return n1 + T(((n2 - n1) * h + HLSMAX / 12) / (HLSMAX / 6));
    if (h < HLSMAX / 2) return n2;
    if (h < (HLSMAX * 2) / 3) return n1 + T(((n2 - n1) * ((HLSMAX * 2) / 3 - h) + HLSMAX / 12) / (HLSMAX / 6));
    return n1;
  };
  let rgb;
  if (S === 0) rgb = [L2, L2, L2].map((v) => T((v * RGBMAX) / HLSMAX));
  else {
    const m2 = L2 <= HLSMAX / 2 ? T((L2 * (HLSMAX + S) + HLSMAX / 2) / HLSMAX) : L2 + S - T((L2 * S + HLSMAX / 2) / HLSMAX);
    const m1 = 2 * L2 - m2;
    rgb = [kenh(m1, m2, H + HLSMAX / 3), kenh(m1, m2, H), kenh(m1, m2, H - HLSMAX / 3)].map((v) => T((v * RGBMAX + HLSMAX / 2) / HLSMAX));
  }
  return "#" + rgb.map((v) => v.toString(16).padStart(2, "0")).join("");
}

/**
 * Giải một màu THEME của Excel ra "#rrggbb", đọc bảng màu từ CHÍNH tệp mẫu Colorfull.
 * Chỉ số theme theo OOXML: 0 lt1 · 1 dk1 · 2 lt2 · 3 dk2 · 4..9 accent1..6.
 */
async function giaiMauTheme({ theme, tint = 0 }) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path.join(process.cwd(), "templates/CLF_KhongNgay.xlsx"));
  const xml = String(Object.values(wb._themes || {})[0] || "");
  const TEN = ["lt1", "dk1", "lt2", "dk2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6"];
  // `\\s\\S` gấp đôi gạch chéo: trong template literal, `\s` KHÔNG phải chuỗi thoát hợp lệ nên bị
  // hiểu thành chữ "s" trần — regex ra `[sS]` và không khớp được khối màu nào.
  const khoi = new RegExp(`<a:${TEN[theme]}>([\\s\\S]*?)</a:${TEN[theme]}>`).exec(xml);
  const hex = khoi && (/srgbClr val="([0-9A-Fa-f]{6})"/.exec(khoi[1]) || /lastClr="([0-9A-Fa-f]{6})"/.exec(khoi[1]));
  if (!hex) throw new Error(`không đọc được màu theme${theme} trong tệp mẫu`);
  return tint ? apTint(hex[1], tint) : `#${hex[1].toLowerCase()}`;
}

/** Màu chữ trong cấu hình (argb hoặc theme) → "#rrggbb". */
const mauCauHinhSangCss = async (v) => (typeof v === "string" ? argbSangCss(v) : giaiMauTheme(v));

describe("Colorfull — màu lưới khớp màu tệp Excel", () => {
  it("hàng NHÓM và NHÓM CON: CSS đè khớp đúng `items.sectionFill` / `items.subFill`", () => {
    const it0 = getConfig("clofull_decor").items;
    expect(it0.sectionFill, "cấu hình phải khai màu nhóm thì phép so mới có nghĩa").toBeTruthy();
    expect(it0.subFill, "cấu hình phải khai màu nhóm con").toBeTruthy();

    expect(nenCuoiCung(".excel-table.clf-theme tr.section-row td"),
      "màu hàng NHÓM trên màn hình lệch với màu tệp Excel").toBe(argbSangCss(it0.sectionFill));
    expect(nenCuoiCung(".excel-table.clf-theme tr.subgroup-row td"),
      "màu hàng NHÓM CON trên màn hình lệch với màu tệp Excel").toBe(argbSangCss(it0.subFill));
  });

  it("ba mẫu Colorfull dùng CHUNG một bộ màu — không mẫu nào trôi riêng", () => {
    const goc = getConfig("clofull_decor").items;
    for (const ma of ["clofull_banner", "clofull_conngay"]) {
      const x = getConfig(ma).items;
      expect(x.sectionFill, `${ma}: màu nhóm khác bản không-ngày`).toBe(goc.sectionFill);
      expect(x.subFill, `${ma}: màu nhóm con khác bản không-ngày`).toBe(goc.subFill);
    }
  });

  it("MÀU CHỮ hàng nhóm / nhóm con: màn hình khớp đúng màu chữ trong tệp Excel", async () => {
    // Đợt đổi màu chữ Excel theo tệp mẫu (`sectionTextColor` / `subTextColor`) đã TỰ TẠO RA một
    // chỗ lệch mới: `public/style.css` vẫn tô chữ hàng nhóm #9a5b14 và nhóm con #1f4e79 — hai màu
    // Excel CŨ. Ca soi màu nền ở trên vẫn XANH vì nó không nhìn màu chữ. Phát hiện khi tự kiểm lại
    // trên dev sau deploy, trước khi người dùng thấy.
    //
    // Màu nhóm khai bằng THEME trong cấu hình, nên ca này GIẢI theme ngay từ tệp mẫu thay vì đóng
    // cứng "#963634": đổi bảng màu tệp mẫu hay đổi `tint` trong cấu hình mà quên CSS là đỏ ngay.
    const it0 = getConfig("clofull_decor").items;
    expect(it0.sectionTextColor, "cấu hình phải khai màu chữ hàng nhóm").toBeTruthy();
    expect(it0.subTextColor, "cấu hình phải khai màu chữ hàng nhóm con").toBeTruthy();

    const chuNhom = await mauCauHinhSangCss(it0.sectionTextColor);
    const chuCon = await mauCauHinhSangCss(it0.subTextColor);

    for (const bc of [
      ".excel-table.clf-theme tr.section-row input",
      ".excel-table.clf-theme tr.section-row td.col-price",
      ".excel-table.clf-theme tr.section-row td.col-amount",
      ".excel-table.clf-theme tr.section-row td.col-notes textarea",
      // GAP1-03: TÊN NHÓM (textarea) và chữ STT (A/B/C) — chữ to nhất của hàng — trước đây rơi về
      // luật chung `td.col-hangmuc textarea` / `td.col-stt` #0066cc (xanh dương). src/excel.ts tô
      // sectionTextColor cho MỌI cột của hàng nhóm, kể cả tên và STT. `:not(.subgroup-row)` vì hàng
      // nhóm con cũng mang lớp section-row.
      ".excel-table.clf-theme tr.section-row:not(.subgroup-row) td.col-stt",
      ".excel-table.clf-theme tr.section-row:not(.subgroup-row) td.col-hangmuc textarea",
    ]) {
      expect(mauChuCuoiCung(bc), `${bc}: chữ hàng NHÓM trên màn hình lệch với tệp Excel`).toBe(chuNhom);
    }
    for (const bc of [
      ".excel-table.clf-theme tr.subgroup-row td.col-stt",   // GAP1-03: số nhóm con của mẫu banner
      ".excel-table.clf-theme tr.subgroup-row input",
      ".excel-table.clf-theme tr.subgroup-row td.col-hangmuc textarea",
      ".excel-table.clf-theme tr.subgroup-row td.col-price",
      ".excel-table.clf-theme tr.subgroup-row td.col-amount",
      ".excel-table.clf-theme tr.subgroup-row td.col-notes textarea",
    ]) {
      expect(mauChuCuoiCung(bc), `${bc}: chữ hàng NHÓM CON trên màn hình lệch với tệp Excel`).toBe(chuCon);
    }
  });

  it("bộ giải theme khớp đúng số Excel vẽ (đo Excel COM) — không phải HSL số thực", async () => {
    // Không có ca này thì hai ca dưới chỉ chứng minh "CSS khớp với chính bộ giải", còn bộ giải lệch
    // Excel bao nhiêu cũng xanh. Số đo: Range.Font.Color trên tệp Colorfull xuất ra (2026-09-29).
    expect(await giaiMauTheme({ theme: 9, tint: -0.499984740745262 }), "B/C hàng hạng mục").toBe("#974706");
    expect(await giaiMauTheme({ theme: 5, tint: -0.249977111117893 }), "chữ hàng nhóm").toBe("#963634");
    // Tint dương: "Orange, Accent 6, Lighter 40%" của bảng màu Office.
    expect(await giaiMauTheme({ theme: 9, tint: 0.39997558519241921 })).toBe("#fabf8f");
  });

  it("TÊN HẠNG MỤC: màn hình tô đúng `items.nameTextColor` như tệp Excel — và vẫn đọc được ở bản tối", async () => {
    // Tệp tô chữ Hạng Mục cùng màu số STT (theme 9 tint -0.5 — accent6 của chính tệp mẫu tối đi một
    // nửa), thay cho đen của tệp mẫu; lưới thì rơi về #0066cc chung của GN
    // (`.excel-table td.col-hangmuc textarea`, public/style.css). Giải theme ngay từ tệp mẫu: đổi bảng
    // màu tệp mẫu hay đổi `tint` trong cấu hình mà quên CSS là đỏ ngay.
    const cfg = getConfig("clofull_decor").items.nameTextColor;
    expect(cfg, "cấu hình phải khai màu tên hạng mục").toBeTruthy();
    const mau = await mauCauHinhSangCss(cfg);
    expect(mauChuCuoiCung(".excel-table.clf-theme tr.grp-head td.col-hangmuc textarea"),
      "màu tên hạng mục trên màn hình lệch với tệp Excel").toBe(mau);
    // Luật sáng (0,4,3) thắng luật tối chung `td:is(.col-stt, .col-hangmuc) :is(input, textarea)`
    // (0,4,2) — thiếu luật tối riêng là chữ nâu cam đậm vẽ trên nền tối.
    const toi = mauChuCuoiCung(':root[data-theme="dark"] .excel-table.clf-theme tr.grp-head td.col-hangmuc textarea');
    expect(toi, "thiếu màu tên hạng mục cho bản tối").toBeTruthy();
    const L = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
      .reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
    const tuongPhan = (a, b) => { const [x, y] = [L(a), L(b)]; return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    expect(tuongPhan(mau, "#ffffff"), "tên hạng mục khó đọc trên nền trắng").toBeGreaterThanOrEqual(4.5);
    for (const nen of ["#141821", "#1a1f2a"]) {   // --surface / --surface-2 bản tối (public/style.css)
      expect(tuongPhan(toi, nen), `bản tối: ${toi} trên ${nen}`).toBeGreaterThanOrEqual(4.5);
    }
    // Bản tối phải CÙNG TÔNG với màu tệp (sắc độ lệch ≤ 10°) và SÁNG hơn — không được là một màu khác hẳn.
    const hsl = (h) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
      const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
      const sac = d === 0 ? 0 : max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      return { sac: sac * 60, sang: (max + min) / 2 };
    };
    const [s, t] = [hsl(mau), hsl(toi)];
    expect(Math.min(Math.abs(s.sac - t.sac), 360 - Math.abs(s.sac - t.sac)), `bản tối ${toi} khác tông với ${mau}`).toBeLessThanOrEqual(10);
    expect(t.sang, `bản tối ${toi} không sáng hơn ${mau}`).toBeGreaterThan(s.sang);
  });

  it("hàng TIÊU ĐỀ: màn hình dùng đúng màu nướng sẵn của tệp mẫu, không dùng màu Gia Nguyễn", async () => {
    // Đọc nền ô tiêu đề cột NGAY TỪ tệp mẫu thay vì đóng cứng: lần đổi màu 2026-09-23 (theme8 tint
    // 0.4 = #93cddd → 9DCCC9) cho thấy con số này có đổi thật, và đổi thì CSS phải theo.
    // Tệp mẫu khai bằng argb (scripts/doi-mau-clf.mjs) — quay lại màu theme thì giải bằng `giaiMauTheme`.
    expect(getConfig("clofull_decor").items.paintHeader,
      "mẫu phải để nền header nướng sẵn thì ca này mới đúng vấn đề").toBe(false);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(path.join(process.cwd(), "templates/CLF_KhongNgay.xlsx"));
    const g = wb.worksheets[0].getCell("C4").fill?.fgColor || {};
    const nenTep = g.argb ? argbSangCss(g.argb) : await giaiMauTheme(g);
    expect(nenCuoiCung(".excel-table.clf-theme thead th"),
      "màu hàng TIÊU ĐỀ trên màn hình lệch với nền nướng sẵn trong tệp Excel").toBe(nenTep);
  });

  it("nền NƯỚNG SẴN của hai tệp mẫu đúng bảng màu người dùng chỉnh (2026-09-23)", async () => {
    // Nguồn: "Copy of Copy of E2E_-_Nhap_tu_Excel_091-new4.xlsx" bản sửa 2026-09-23.
    //   dải tiêu đề 9CCDC9 · chữ 243139 — tiêu đề cột 9DCCC9 — khối tổng 9DCCC9
    // Bản CÓ NGÀY dựng lại từ bản không-ngày (scripts/dung-mau-clf-co-ngay.mjs) — quên dựng lại là
    // hai bản lệch màu, ca này bắt được.
    const doc = async (tep) => {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.readFile(path.join(process.cwd(), "templates", tep));
      return wb.worksheets[0];
    };
    const nen = (ws, a) => String(ws.getCell(a).fill?.fgColor?.argb || "-").toUpperCase();
    for (const [tep, cotCuoi, oTong] of [
      ["CLF_KhongNgay.xlsx", "I", ["F", "G", "H"]],
      ["CLF_CoNgay.xlsx", "J", ["G", "H", "I"]],
    ]) {
      const ws = await doc(tep);
      expect(nen(ws, "B2"), `${tep}: nền dải tiêu đề`).toBe("FF9CCDC9");
      expect(String(ws.getCell("B2").font?.color?.argb).toUpperCase(), `${tep}: chữ dải tiêu đề`).toBe("FF243139");
      for (const c of ["B", "C", "D", "E", "F", "G", "H", "I", cotCuoi]) {
        expect(nen(ws, `${c}4`), `${tep}: nền tiêu đề cột ${c}4`).toBe("FF9DCCC9");
      }
      for (const r of [13, 14, 15]) for (const c of oTong) {
        expect(nen(ws, `${c}${r}`), `${tep}: nền khối tổng ${c}${r}`).toBe("FF9DCCC9");
      }
    }
  });
});
