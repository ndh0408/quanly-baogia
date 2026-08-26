// Ảnh trong app React: (1) "xem lớn" mở tab TRẮNG, (2) src gán thô không qua bộ lọc — chốt hồi quy.
//
// ── LỖI 1: xem ảnh lớn ra tab trắng ─────────────────────────────────────────
// `GridTable.tsx` (cột "Hình ảnh"): `onClick={() => window.open(src, "_blank")}`, mà `src` LUÔN là
// data-URL — ảnh được nén ngay tại client bằng `canvas.toDataURL("image/jpeg", 0.82)` và server chỉ
// nhận data-URL (`src/validators.ts` itemSchema.images). Chrome/Edge/Firefox CHẶN điều hướng cấp
// cao nhất tới `data:` (chống lừa đảo) → bấm "Bấm để xem lớn" mở ra một tab trắng.
// TÁI HIỆN: bật cột Hình ảnh, chèn 1 ảnh, bấm vào ảnh. HẬU QUẢ: tính năng phụ hỏng hoàn toàn
// (không mất dữ liệu, không sai tiền). CÁCH VÁ: mở lightbox TRONG app thay vì điều hướng ra ngoài.
//
// ── LỖI 2: src ảnh không qua bộ lọc ─────────────────────────────────────────
// Bản React gán `src` thô ở `GridTable.tsx`, `ExtraTables.tsx` (ảnh chứng từ thanh toán dòng nội
// bộ) và `Personnel.tsx` (ảnh chứng từ thanh toán nhân sự), trong khi SPA cũ luôn lọc qua
// `safeLogoSrc`. Hai route lưu ảnh chứng từ (`personnel.routes.ts`, `quotes.routes.ts`) chỉ kiểm
// TIỀN TỐ `^data:image/(png|jpe?g|webp);base64,` nên chuỗi kiểu
// `data:image/png;base64,AAA"><a href=x>` vẫn lọt vào CSDL — khác hẳn `validators.ts` và
// `quoteUtils.ts`, hai chỗ này neo cả chuỗi.
// Ghi rõ mức độ: HÔM NAY chưa thành XSS vì React gán qua thuộc tính DOM chứ không nội suy chuỗi vào
// HTML. Đây là mất một tầng phòng thủ + lệch chuẩn giữa các nơi, nên chốt lại cho khỏi trôi.
// CÁCH VÁ: `safeImgSrc` neo TOÀN CHUỖI đúng như `shared`/`src/quoteUtils.ts` và áp cho mọi <img>.
//
// Kiểm phần "gắn đúng chỗ" bằng cách đọc mã nguồn: web/ không có jsdom nên không render được
// component. Cách đọc-nguồn này đã có tiền lệ trong repo (tests/env-example.test.js,
// tests/ic-infra-compose.test.js).
// `?raw` của Vite (không phải node:fs) — web/tsconfig chỉ nạp types "vite/client", không có @types/node.
import { describe, it, expect } from "vitest";
import GRID from "../components/GridTable.tsx?raw";
import EXTRA from "../components/ExtraTables.tsx?raw";
import PERSONNEL from "../pages/Personnel.tsx?raw";
import WIZARD from "../pages/NewQuoteWizard.tsx?raw";
import { safeImgSrc } from "../components/GridTable";

const anhThat = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==";

describe("safeImgSrc — chỉ nhận data-URL ảnh base64 hợp lệ TOÀN CHUỖI", () => {
  it("giữ nguyên ảnh do chính app nén ra", () => {
    expect(safeImgSrc(anhThat)).toBe(anhThat);
    expect(safeImgSrc("data:image/png;base64,iVBORw0KGgo=")).toBe("data:image/png;base64,iVBORw0KGgo=");
    expect(safeImgSrc("data:image/webp;base64,UklGRg")).toBe("data:image/webp;base64,UklGRg");
  });

  it("chặn chuỗi CHỈ ĐÚNG TIỀN TỐ rồi nhét markup phía sau", () => {
    expect(safeImgSrc('data:image/png;base64,AAA"><a href=x>')).toBe("");
    expect(safeImgSrc("data:image/png;base64,AAA<script>alert(1)</script>")).toBe("");
    expect(safeImgSrc("data:image/png;base64,AAA ")).toBe("");
  });

  it("chặn mọi lược đồ không phải data-URL ảnh", () => {
    expect(safeImgSrc("javascript:alert(1)")).toBe("");
    expect(safeImgSrc("data:text/html;base64,PHNjcmlwdD4=")).toBe("");
    expect(safeImgSrc("https://vi-du.test/anh.png")).toBe("");
    expect(safeImgSrc("")).toBe("");
    expect(safeImgSrc(null)).toBe("");
    expect(safeImgSrc(undefined)).toBe("");
  });
});

describe("xem ảnh lớn phải mở TRONG app, không điều hướng tới data:", () => {
  it("GridTable không còn window.open cho ảnh", () => {
    expect(GRID).not.toMatch(/window\.open\s*\(/);
  });
});

describe("mọi <img> của cụm này đều đi qua bộ lọc src", () => {
  const imgSrcExprs = (code: string) =>
    [...code.matchAll(/<img\b[^>]*?\ssrc=\{([^}]*)\}/g)].map((m) => m[1].trim());

  for (const [ten, code] of [["GridTable.tsx", GRID], ["ExtraTables.tsx", EXTRA], ["Personnel.tsx", PERSONNEL], ["NewQuoteWizard.tsx", WIZARD]] as const) {
    it(`${ten}: không còn <img src={…}> gán thô`, () => {
      const exprs = imgSrcExprs(code);
      expect(exprs.length).toBeGreaterThan(0);
      for (const e of exprs) expect(e).toMatch(/^(safeImgSrc|safeLogo)\(/);
    });
  }

  it("bộ lọc logo của trình tạo báo giá cũng neo TOÀN CHUỖI, không chỉ tiền tố", () => {
    // Cùng chuẩn với validators.customerLogo phía server — nếu không, hai đầu hiểu khác nhau.
    const m = /const safeLogo = .*?\/(\^data:image.+)\/i\.test/.exec(WIZARD);
    expect(m, "không tìm thấy safeLogo trong NewQuoteWizard.tsx").not.toBeNull();
    expect(m![1]).toMatch(/\$$/);
    expect(new RegExp(m![1], "i").test('data:image/png;base64,AAA"><a href=x>')).toBe(false);
  });
});
