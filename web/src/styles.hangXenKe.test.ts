// Danh sách báo giá: hàng TRẮNG / XÁM xen kẽ (yêu cầu chủ repo 2026-09-30: "nó kiểu trắng xám kiểu đan
// xen"). Bài này khoá ba thứ dễ vỡ âm thầm của một luật tô hàng xen kẽ:
//   · CHỈ áp cho bảng danh sách báo giá (`.ql-table`) — không tô lây sang 8 trang khác dùng chung
//     `.list-table` (Hoá đơn có ô hồng "chưa điền", Khách hàng, Nhân sự… mỗi nơi có cách đọc riêng);
//   · rê chuột vẫn NHÌN THẤY trên hàng xám (hover phải đậm hơn hàng xen kẽ, và thắng về độ ưu tiên —
//     `.list-table tbody tr.qrow:hover` của public/style.css chỉ (0,3,2), thua luật xen kẽ nếu cùng cấp);
//   · chữ thường và chữ mờ vẫn ≥ 4.5:1 trên nền xám ở CẢ hai chế độ sáng/tối.
// Đọc thẳng CSS như styles.contrast.test.ts (vitest chặn .css nên `?raw` về chuỗi rỗng).
import { describe, it, expect } from "vitest";

const fs = (await import(/* @vite-ignore */ ["node", "fs"].join(":"))) as { readFileSync: (p: URL, e: string) => string };
const boChu = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "");
const css = boChu(fs.readFileSync(new URL("./styles.css", import.meta.url), "utf8"));
const goc = boChu(fs.readFileSync(new URL("../../public/style.css", import.meta.url), "utf8"));

const L = (h: string) => {
  const c = [0, 2, 4].map((i) => parseInt(h.replace("#", "").slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const tuongPhan = (a: string, b: string) => { const x = L(a), y = L(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

/** Giá trị token màu trong khối `chon {…}` đầu tiên có khai nó (`:root` / `[data-theme="dark"]`). */
const token = (nguon: string, chon: string, ten: string) => {
  const re = new RegExp(`(?:^|\\})\\s*${chon.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^{}]*)\\}`, "g");
  for (const m of nguon.matchAll(re)) {
    const v = new RegExp(`${ten}:\\s*(#[0-9a-fA-F]{6})`).exec(m[1])?.[1];
    if (v) return v;
  }
  return "";
};
const luat = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ ds: m[1].split(",").map((x) => x.trim().replace(/\s+/g, " ")), than: m[2] }));
const tim = (boChon: string) => luat.filter((l) => l.ds.includes(boChon));

const CHE_DO = [
  { ten: "sáng", chon: ":root" },
  { ten: "tối", chon: '[data-theme="dark"]' },
];

describe("Danh sách báo giá — hàng trắng/xám xen kẽ", () => {
  for (const { ten, chon } of CHE_DO) {
    it(`chế độ ${ten}: có token nền hàng xen kẽ + nền khi rê chuột, khác nền thường và khác nhau`, () => {
      const alt = token(css, chon, "--row-alt"), hover = token(css, chon, "--row-alt-hover");
      const nen = token(goc, chon, "--surface");
      expect(alt, `thiếu --row-alt ở ${chon}`).not.toBe("");
      expect(hover, `thiếu --row-alt-hover ở ${chon}`).not.toBe("");
      expect(nen, `không đọc được --surface ở ${chon}`).not.toBe("");
      // Phải NHÌN THẤY được: cùng màu với nền thường là luật vô hình (đã từng có ở --surface-2 vs --surface).
      expect(tuongPhan(alt, nen), `${alt} gần như trùng ${nen}`).toBeGreaterThanOrEqual(1.04);
      expect(tuongPhan(hover, alt), `hover ${hover} gần như trùng hàng xám ${alt}`).toBeGreaterThanOrEqual(1.05);
    });

    it(`chế độ ${ten}: chữ thường và chữ mờ ≥ 4.5:1 trên cả nền xám lẫn nền rê chuột`, () => {
      const chu = token(goc, chon, "--text"), mo = token(goc, chon, "--text-muted");
      for (const t of ["--row-alt", "--row-alt-hover"]) {
        const n = token(css, chon, t);
        expect(tuongPhan(chu, n), `--text ${chu} trên ${t} ${n}`).toBeGreaterThanOrEqual(4.5);
        expect(tuongPhan(mo, n), `--text-muted ${mo} trên ${t} ${n}`).toBeGreaterThanOrEqual(4.5);
      }
    });
  }

  it("luật xen kẽ nhắm ĐÚNG bảng danh sách báo giá, không phải mọi .list-table", () => {
    const xenKe = tim(".list-table.ql-table tbody tr:nth-child(even)");
    expect(xenKe.length, "thiếu luật tô hàng chẵn của .ql-table").toBe(1);
    expect(xenKe[0].than).toMatch(/background:\s*var\(--row-alt\)/);
    // Không có luật xen kẽ CHUNG nào cho .list-table / .inv-table. (`.tbl-wrap` — bảng Nhân sự/Danh bạ —
    // có luật xen kẽ RIÊNG từ trước, cố ý, nên không nằm trong phép kiểm này.)
    const lay = luat.flatMap((l) => l.ds).filter((s) => /nth-child\((even|2n)\)/.test(s) && /tr/.test(s) && !s.includes(".ql-table") && /\.(list-table|inv-table)\b/.test(s));
    expect(lay, "luật xen kẽ tô lây sang bảng khác").toEqual([]);
  });

  it("rê chuột trên hàng xám: luật riêng, độ ưu tiên CAO HƠN luật gốc (0,3,2) của public/style.css", () => {
    const hover = tim(".list-table.ql-table tbody tr.qrow:hover");
    expect(hover.length, "thiếu luật hover của .ql-table").toBe(1);
    expect(hover[0].than).toMatch(/background:\s*var\(--row-alt-hover\)/);
    // Bốn lớp (.list-table .ql-table .qrow :hover) = (0,4,2) > (0,3,2). Số lớp đọc thẳng từ bộ chọn.
    const soLop = (s: string) => (s.match(/\.[\w-]+|:hover|:nth-child\([^)]*\)/g) ?? []).length;
    expect(soLop(".list-table.ql-table tbody tr.qrow:hover")).toBeGreaterThan(soLop(".list-table tbody tr.qrow:hover"));
    // Và luật gốc vẫn đúng như giả định (đổi ở public/style.css thì bài này đỏ để xem lại).
    expect(goc).toMatch(/\.list-table tbody tr\.qrow:hover\s*\{[^}]*background:\s*var\(--surface-hover\)/);
  });
});

// ── CỘT THAO TÁC KHÔNG ĐƯỢC ĐÈ LÊN Ô GHI CHÚ ─────────────────────────────────────────────────────────────────
// Bản 2026-09-30 đầu tiên làm cột thao tác (Excel · ⋯) DÍNH mép phải để nút luôn bấm được khi bảng cuộn ngang — và ô
// ghi chú nằm ngay trước nó nên bị che: chủ repo chụp màn hình "nó đang bị che đi", chỉ hở nửa chấm màu. Bỏ dính; bảng
// tràn thì cuộn ngang như mọi bảng khác, và đệm ngang thu còn 10px để ít tràn hơn. Bài này chặn việc "sửa lại" bằng cách
// dính lần nữa mà không đo: nếu thật sự cần dính, phải dính CẢ cột ghi chú cùng với nó.
describe("Danh sách báo giá — cột thao tác KHÔNG đè lên ô ghi chú", () => {
  const luatCuaBang = luat.filter((l) => l.ds.some((d) => d.includes(".ql-table")));

  it("không luật nào của .ql-table cho cột thao tác position:sticky (dính) hay right:0", () => {
    const dinh = luatCuaBang.filter((l) => l.ds.some((d) => /actions|row-actions/.test(d)) && /position:\s*sticky|right:\s*0/.test(l.than));
    expect(dinh.map((l) => l.ds.join(", ")), "cột thao tác dính đè lên ô Ghi chú ngay bên trái nó").toEqual([]);
  });

  it("bảng không bị ép overflow:visible để chạy sticky (hidden của .list-table còn giữ bo góc)", () => {
    const duyet = luatCuaBang.filter((l) => l.ds.includes(".list-table.ql-table") && /overflow:\s*visible/.test(l.than));
    expect(duyet).toEqual([]);
  });

  it("đệm ngang ô của .ql-table thu còn 10px (gốc 14px) để thêm cột Ghi chú mà bảng ít phải cuộn ngang", () => {
    const l = luatCuaBang.find((x) => x.ds.includes(".ql-table th") && x.ds.includes(".ql-table td"));
    expect(l, "thiếu luật đệm").toBeTruthy();
    expect(l!.than).toMatch(/padding-left:\s*10px/);
    expect(l!.than).toMatch(/padding-right:\s*10px/);
  });
});
