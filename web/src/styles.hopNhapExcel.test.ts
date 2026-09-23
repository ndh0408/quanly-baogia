// L76 (soát toàn diện): hộp "Nhập từ Excel" NHẢY khi bảng xem trước hiện ra (CLS 0,188 đo trên dev).
// .modal-backdrop căn giữa theo chiều dọc (grid place-items: center) nên khi phần giới thiệu + vùng kéo
// thả (~360px) được thay bằng bảng kế hoạch + xem trước (tới max-height 92vh), mép trên nhảy lên
// (cao mới − cao cũ)/2 — đo ở cửa sổ 950px: mép trên 297px → 38px, nút ✕ chạy theo.
// Bài này tính giá trị CUỐI CÙNG khai cho đúng bộ chọn trong hai tệp CSS app nạp (public/style.css trước,
// styles.css sau — cách đọc như styles.zindex.test.ts).
import { describe, it, expect } from "vitest";
const fs = (await import(/* @vite-ignore */ ["node", "fs"].join(":"))) as { readFileSync: (p: URL, e: string) => string };
const CSS = [
  fs.readFileSync(new URL("../../public/style.css", import.meta.url), "utf8"),
  fs.readFileSync(new URL("./styles.css", import.meta.url), "utf8"),
].join("\n").replace(/\/\*[\s\S]*?\*\//g, "");

/** Giá trị cuối cùng của thuộc tính `prop` khai cho ĐÚNG bộ chọn (ngoài @media: chỉ rule cấp đầu). */
function cuoi(boChon: string, prop: string): string | null {
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null, v: string | null = null;
  while ((m = re.exec(CSS))) {
    const ds = m[1].split(",").map((x) => x.trim().replace(/\s+/g, " "));
    const d = new RegExp(`(?:^|[;\\s])${prop}:\\s*([^;]+)`).exec(m[2]);
    if (d && ds.includes(boChon)) v = d[1].trim();
  }
  return v;
}

describe("L76 — hộp Nhập từ Excel neo mép trên, không nhảy khi nội dung đổi cao", () => {
  it("hộp nhập Excel tự neo ở trên (align-self: start) — mép trên đứng yên, hộp chỉ dài xuống", () => {
    expect(cuoi(".modal.import-modal", "align-self")).toBe("start");
  });
  it("mép trên = đúng chỗ của hộp cỡ tối đa khi còn căn giữa (4vh) → lúc bảng hiện ra cũng không xê dịch", () => {
    // Nền mờ có padding 20px; hộp cao tối đa 92vh căn giữa thì mép trên = 20px + (100vh − 40px − 92vh)/2 = 4vh.
    expect(cuoi(".modal.import-modal", "margin-top")).toBe("max(0px, calc(4vh - 20px))");
  });
  it("các hộp thoại khác KHÔNG đổi: nền mờ dùng chung vẫn căn giữa", () => {
    expect(cuoi(".modal-backdrop", "place-items")).toBe("center");
  });
});
