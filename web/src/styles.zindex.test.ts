// GAP1-04: modal React nằm DƯỚI thanh đầu trang mobile (sticky z 60) và sidebar (70) ở màn ≤920px vì
// `.modal-backdrop` bị đè z-index 50. Nút ✕ / tiêu đề modal cao bị che, cú bấm rơi vào topbar. Bài này
// tính z-index CUỐI CÙNG của từng lớp từ đúng hai tệp CSS app nạp (public/style.css trước, styles.css sau).
import { describe, it, expect } from "vitest";

// vitest trả RỖNG cho `*.css?raw` (xem styles.contrast.test.ts) → đọc đĩa.
const fs = (await import(/* @vite-ignore */ ["node", "fs"].join(":"))) as { readFileSync: (p: URL, e: string) => string };
const CSS = [
  fs.readFileSync(new URL("../../public/style.css", import.meta.url), "utf8"),
  fs.readFileSync(new URL("./styles.css", import.meta.url), "utf8"),
].join("\n").replace(/\/\*[\s\S]*?\*\//g, "");

/** z-index cuối cùng khai cho ĐÚNG bộ chọn (kể cả trong @media — cả hai nhánh đều áp ở màn hẹp). */
function zCuoi(boChon: string): number | null {
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null, cuoi: number | null = null;
  while ((m = re.exec(CSS))) {
    const ds = m[1].split(",").map((x) => x.trim().replace(/\s+/g, " "));
    const z = /z-index:\s*(-?\d+)/.exec(m[2]);
    if (z && ds.includes(boChon)) cuoi = Number(z[1]);
  }
  return cuoi;
}

describe("GAP1-04 — thứ tự lớp chồng", () => {
  it("modal nằm trên topbar mobile, sidebar và lớp mờ của sidebar", () => {
    const modal = zCuoi(".modal-backdrop")!;
    for (const lop of [".mobile-topbar", ".sidebar", ".sidebar-backdrop"]) {
      expect(modal, `.modal-backdrop (${modal}) phải > ${lop} (${zCuoi(lop)})`).toBeGreaterThan(zCuoi(lop)!);
    }
  });
  it("toast nổi trên modal (báo lỗi Lưu ngay trong form)", () => {
    expect(zCuoi("#toast-host")!).toBeGreaterThan(zCuoi(".modal-backdrop")!);
  });
});
