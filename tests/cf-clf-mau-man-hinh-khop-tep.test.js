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
 *   · hàng tiêu đề — tệp giữ nền nướng sẵn (`paintHeader: false`) là theme8 tint 0.4 = #93CDDD
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

  it("hàng TIÊU ĐỀ: màn hình dùng đúng màu nướng sẵn của tệp mẫu, không dùng màu Gia Nguyễn", () => {
    // #93cddd = theme8 (accent5 #4BACC6) tint 0.4 — đọc thẳng từ `xl/theme/theme1.xml` của tệp do
    // app xuất ra. Đóng cứng ở đây thay vì giải mã theme trong bài kiểm: phép giải mã tint của
    // OOXML dài hơn cả thứ nó gác, còn con số này chỉ đổi khi ai đó thay tệp mẫu — lúc ấy ca
    // `paintHeader` bên `cf-clf-cot-hinh-anh.test.js` cũng đỏ theo.
    expect(getConfig("clofull_decor").items.paintHeader,
      "mẫu phải để nền header nướng sẵn thì ca này mới đúng vấn đề").toBe(false);
    expect(nenCuoiCung(".excel-table.clf-theme thead th"),
      "màu hàng TIÊU ĐỀ trên màn hình lệch với nền nướng sẵn trong tệp Excel").toBe("#93cddd");
  });
});
