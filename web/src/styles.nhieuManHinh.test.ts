// NHIỀU CỠ MÀN HÌNH (chủ repo 2026-09-30: "nhiều màn hình xài lắm đó nha — FHD, 2K… css cho kĩ"). Đợt soát 2026-10-06 đo bằng Chromium
// thật ở 14 cỡ (360×740 → 3840×2160, sáng + tối) và tìm ra các lỗi dưới đây — mỗi bài khoá đúng LUẬT đã sửa, kèm số đo vì sao:
//   · số tiền ở thẻ KPI Dashboard bị cắt lặng lẽ ở 1280–1536px (chữ co theo CỬA SỔ, thẻ thì hẹp);
//   · Hóa đơn đầu ra khoá 5 cột 772px — ở 1024 rộng hơn cả khung cuộn (716px), 16 cột còn lại không bao giờ xem được;
//   · ô tìm ở 521–820px co về 196px vì một luật dành cho thanh công cụ dạng CỘT (chỉ ≤520px);
//   · tên khách ở màn soạn bị cắt kể cả tên ngắn ở ≤1024px.
// Bảng Danh sách báo giá: styles.ghiChuMau.test.ts. Thanh nút đáy màn soạn: styles.thanhDay.test.ts.
// Đọc thẳng CSS như styles.contrast.test.ts (vitest chặn .css nên `?raw` về chuỗi rỗng).
import { describe, it, expect } from "vitest";

const fs = (await import(/* @vite-ignore */ ["node", "fs"].join(":"))) as { readFileSync: (p: URL, e: string) => string };
const css = fs.readFileSync(new URL("./styles.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** Vị trí dấu `}` đóng khối mở ở `mo` (có tính khối lồng). */
function dong(mo: number): number {
  let d = 0;
  for (let j = mo; j < css.length; j++) {
    if (css[j] === "{") d++;
    else if (css[j] === "}" && --d === 0) return j;
  }
  return css.length;
}
/** Các khối CẤP ĐẦU: đầu khối (bộ chọn / "@media …") + ruột. */
const khoi: { dau: string; ruot: string }[] = [];
for (let i = 0, batDau = 0; i < css.length; i++) {
  if (css[i] !== "{") continue;
  const het = dong(i);
  khoi.push({ dau: css.slice(batDau, i).trim(), ruot: css.slice(i + 1, het) });
  i = het;
  batDau = het + 1;
}
/** Ruột các luật CẤP ĐẦU (ngoài @media) mà danh sách bộ chọn có đúng `chon`. */
const luat = (chon: string) => khoi.filter((k) => !k.dau.startsWith("@") && k.dau.split(",").map((s) => s.trim().replace(/\s+/g, " ")).includes(chon)).map((k) => k.ruot).join(";");
/** Ruột GỘP của mọi khối `@media <dieuKien>` (khớp chính xác chuỗi điều kiện) — một điều kiện có thể xuất hiện ở nhiều chỗ. */
const khoiMedia = (dieuKien: string) => khoi.filter((k) => k.dau === `@media ${dieuKien}`).map((k) => k.ruot).join("\n");

describe("Dashboard — số tiền ở thẻ KPI không bị cắt ở laptop", () => {
  it("cỡ chữ co theo bề rộng THẺ (container query), không theo bề rộng CỬA SỔ", () => {
    // Đo: 2.2vw chạm trần 26px từ 1182px, trong khi lưới xếp 5 thẻ chỉ rộng 200–215px ở 1366–1440 → "985.000.000 đ" (197px) bị cắt
    // 28–35px trong hộp 162px, `.kpi { overflow: hidden }` cắt lặng lẽ. 10.5cqi vừa cả số 10 tỷ ở mọi cỡ laptop.
    expect(luat(".kpi")).toMatch(/container-type:\s*inline-size/);
    const so = luat(".kpi strong");
    expect(so).toMatch(/font-size:\s*clamp\(\s*\d+px,\s*[\d.]+cqi,\s*26px\s*\)/);
    expect(so, "co theo cửa sổ là đúng lỗi cũ").not.toMatch(/font-size:[^;]*vw/);
    expect(so, "số tiền phải trên MỘT dòng — chữ 'đ' rớt dòng là lỗi trước đó nữa").toMatch(/white-space:\s*nowrap/);
  });
});

describe("Hóa đơn đầu ra — số cột đóng băng theo bề rộng khung", () => {
  it("≥1700px khoá 5 cột như cũ; ≤1699.98px chỉ khoá 3 cột danh tính dòng; ≤1099.98px không khoá", () => {
    const vua = khoiMedia("(max-width: 1699.98px)");
    const hep = khoiMedia("(max-width: 1099.98px)");
    expect(vua, "mất tầng ≤1699.98px").not.toBe("");
    expect(hep, "mất tầng ≤1099.98px").not.toBe("");
    // Mở khoá bằng left:auto (GIỮ sticky cho tiêu đề), và hạ z-index: cùng z-index thì cột đứng sau vẽ đè cột khoá khi cuộn ngang.
    expect(vua).toMatch(/\.inv-table th:nth-child\(4\),\s*\.inv-table td:nth-child\(4\),\s*\.inv-table th:nth-child\(5\),\s*\.inv-table td:nth-child\(5\)\s*\{\s*left:\s*auto/);
    expect(vua).toMatch(/\.inv-table td:nth-child\(4\),\s*\.inv-table td:nth-child\(5\)\s*\{\s*z-index:\s*auto/);
    expect(hep).toMatch(/\.inv-table th:nth-child\(-n \+ 3\),\s*\.inv-table td:nth-child\(-n \+ 3\)\s*\{\s*left:\s*auto/);
    expect(hep).toMatch(/\.inv-table td:nth-child\(-n \+ 3\)\s*\{\s*z-index:\s*auto/);
    expect(vua + hep, "không được tắt sticky — tiêu đề cột phải còn dính đầu khung").not.toMatch(/position:\s*static/);
    // Tầng rộng (cấp đầu) vẫn khoá đủ 5 cột: mốc left cộng dồn 0/150/260/400/640.
    expect(luat(".inv-table td:nth-child(5)")).toMatch(/left:\s*640px/);
  });
});

describe("Thanh công cụ — ô tìm kiếm", () => {
  it("`.toolbar .grow { flex: 0 0 auto }` CHỈ ≤520px (nơi thanh công cụ đổi sang CỘT) — 521–820px ô tìm phải giãn", () => {
    expect(khoiMedia("(max-width: 520px)")).toMatch(/\.toolbar \.grow\s*\{\s*flex:\s*0 0 auto/);
    // Đo: luật cũ áp tới 820px → ô tìm 196px, placeholder cụt, bên phải trống 162–453px.
    expect(khoiMedia("(max-width: 820px)")).not.toMatch(/\.toolbar \.grow\s*\{[^}]*flex:\s*0 0 auto/);
  });
});

describe("Màn soạn — ô khách hàng đã chọn", () => {
  it("tên khách xuống dòng (tối đa 2 dòng) thay vì cắt một dòng — chạm trên máy tính bảng không xem được title", () => {
    const gt = luat(".kh-chon-gt");
    expect(gt).toMatch(/-webkit-line-clamp:\s*2/);
    expect(gt).not.toMatch(/white-space:\s*nowrap/);
  });
});
