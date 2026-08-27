// XUẤT NỀN — hai chỗ bỏ người dùng đứng giữa đường, và một chỗ cho ra hai kiểu tên file.
//
// Ba lỗi dưới đây chỉ lộ ra SAU khi SPA được nối vào đường xuất nền (commit 782243d). Trước đó
// không client nào gọi `POST /api/quotes/:id/export`, nên chúng nằm im: mã máy chủ đúng về mặt
// HTTP, chỉ vô dụng về mặt con người.
//
// ── LỖI 1: lời nhắn 503 là một VÒNG CỤT ─────────────────────────────────────
// `src/routes/jobs.routes.ts` nhánh "chưa cấu hình hàng đợi" từng trả:
//     "Hệ thống hàng đợi chưa được cấu hình. Vui lòng dùng chức năng xuất file trực tiếp."
// Nhưng người dùng CHỈ tới được đường nền vì đường trực tiếp vừa từ chối họ bằng 413 (báo giá quá
// lớn — src/routes/export.routes.ts). Bảo họ quay lại thứ vừa thất bại là không cho lối ra nào.
//
// ── LỖI 2: hai nhánh 503 KHÔNG cùng hình dạng ───────────────────────────────
// Nhánh "thiếu kho object" có `code: "export_async_unavailable"`, nhánh "thiếu hàng đợi/Redis"
// thì không. `code` là thứ DUY NHẤT client dùng để phân biệt "xuất nền chưa bật" (nói được thành
// câu người dùng hiểu) với một 503 bất kỳ (chỉ đổ nguyên văn kỹ thuật ra màn hình). Cùng một
// nguyên nhân mà ra hai hành vi giao diện khác nhau.
//
// ── LỖI 3: một nút, hai kiểu tên file ───────────────────────────────────────
// Công thức tên file bị chép tay hai nơi rồi lệch nhau:
//   · đường ĐỒNG BỘ đặt Content-Disposition = "BaoGia_<mã>.xlsx";
//   · đường NỀN không truyền `filename` vào `presignDownload`, nên kho object lấy phần cuối của
//     khoá — "<mã>-<dấu thời gian>.xlsx".
// Chuyện này KHÔNG sửa được ở client: link tải của đường nền là URL đã ký trỏ vào kho object, tức
// khác origin, mà trình duyệt BỎ QUA thuộc tính `download` của thẻ <a> khi khác origin. Tên file
// do header của kho quyết định — nên phải sửa ở máy chủ.
// Nay cả hai đường gọi CHUNG `tenFileXuat` (src/quoteUtils.ts).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tenFileXuat } from "../src/quoteUtils.js";

const GOC = new URL("..", import.meta.url).pathname;
const doc = (p) => readFileSync(join(GOC, p), "utf8");

/** Bỏ chú thích để khỏi khớp nhầm chính đoạn văn đang giải thích lỗi. */
const boChuThich = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

describe("tenFileXuat — MỘT công thức cho cả hai đường xuất", () => {
  it("dựng đúng tên mà người dùng thấy", () => {
    expect(tenFileXuat("BG-2026-001", 7, "xlsx")).toBe("BaoGia_BG-2026-001.xlsx");
    expect(tenFileXuat("BG-2026-001", 7, "pdf")).toBe("BaoGia_BG-2026-001.pdf");
  });

  it("thiếu mã báo giá thì rơi về id, không ra tên rỗng", () => {
    expect(tenFileXuat(null, 42, "xlsx")).toBe("BaoGia_quote-42.xlsx");
    expect(tenFileXuat("", 42, "pdf")).toBe("BaoGia_quote-42.pdf");
  });

  // Tên này đi THẲNG vào header `Content-Disposition: attachment; filename="..."`. Một dấu nháy
  // lọt qua là chèn được header. Bộ lọc phải HẸP, và bài này khoá nó lại.
  it("chặn mọi ký tự có thể phá header", () => {
    for (const ban of ['a"b', "a;b", "a\r\nX-Injected: 1", "a/b", "../../etc/passwd", "a b"]) {
      const ra = tenFileXuat(ban, 1, "xlsx");
      expect(ra, `lọt ký tự nguy hiểm: ${JSON.stringify(ban)} → ${ra}`).toMatch(/^BaoGia_[A-Za-z0-9_-]*\.xlsx$/);
    }
  });

  it("giữ nguyên chữ số và dấu gạch — mã báo giá thật không bị băm nát", () => {
    expect(tenFileXuat("GN_2026-07_v2", 1, "xlsx")).toBe("BaoGia_GN_2026-07_v2.xlsx");
  });
});

describe("cả hai đường xuất phải DÙNG CHUNG công thức đó", () => {
  // Chép tay lại là mở đường cho chúng lệch nhau lần nữa — đúng lỗi vừa vá.
  it("export.routes.ts (đồng bộ) gọi tenFileXuat, không tự dựng tên", () => {
    const src = boChuThich(doc("src/routes/export.routes.ts"));
    expect(src).toMatch(/tenFileXuat\(quote\.quoteNumber, id, "xlsx"\)/);
    expect(src).toMatch(/tenFileXuat\(quote\.quoteNumber, id, "pdf"\)/);
    expect(src, "chép tay lại công thức = mở đường cho hai đường lệch nhau lần nữa")
      .not.toMatch(/replace\(\/\[\^A-Za-z0-9_-\]/);
  });

  it("worker.ts (nền) TRUYỀN filename vào presignDownload, và cũng qua tenFileXuat", () => {
    const src = boChuThich(doc("src/worker.ts"));
    const goi = [...src.matchAll(/presignDownload\([^)]*\)/g)].map((m) => m[0]);
    expect(goi.length, "không còn lời gọi presignDownload nào ở worker?").toBeGreaterThanOrEqual(2);
    for (const g of goi) {
      expect(g, `presignDownload thiếu filename → kho object tự đặt tên theo khoá: ${g}`)
        .toMatch(/filename:\s*tenFileXuat\(/);
    }
  });
});

describe("503 của đường xuất nền không được bỏ người dùng đứng giữa đường", () => {
  const src = boChuThich(doc("src/routes/jobs.routes.ts"));

  /** Các khối `res.status(503).json({...})` trong file. */
  const khoi503 = () => {
    const ra = [];
    const re = /status\(503\)\s*\.json\(\s*\{/g;
    while (re.exec(src)) {
      // Cắt từ dấu `{` tới dấu `}` cân bằng.
      let i = re.lastIndex - 1, sau = 0;
      for (let k = i; k < src.length; k++) {
        if (src[k] === "{") sau++;
        else if (src[k] === "}") { sau--; if (!sau) { ra.push(src.slice(i, k + 1)); break; } }
      }
    }
    return ra;
  };

  it("có BA nhánh 503 — hai ở lúc xếp việc, một ở lúc hỏi kết quả", () => {
    // Bản đầu của bài này chỉ nghĩ tới hai nhánh của route xếp việc. Chính nó bắt ra nhánh thứ ba
    // ở `GET /jobs/:queue/:id` (Redis chết GIỮA LÚC người dùng đang chờ) — nhánh đó cũng thiếu
    // `code` và cũng nói trống không. Ghi lại ở đây để lần sau đừng "sửa" con số cho khớp mà
    // không hỏi nhánh mới có mang code chưa.
    const k = khoi503();
    expect(k.length, "số nhánh 503 đổi — kiểm lại xem nhánh mới có mang code không").toBeGreaterThanOrEqual(3);
  });

  it("MỌI nhánh 503 mang code:'export_async_unavailable' — client dựa vào đúng nó", () => {
    for (const k of khoi503()) {
      expect(k, `một nhánh 503 thiếu code → client không phân biệt được, chỉ đổ nguyên văn kỹ thuật ra màn hình:\n${k}`)
        .toMatch(/code:\s*"export_async_unavailable"/);
    }
  });

  it("KHÔNG nhánh nào bảo người dùng quay lại thứ vừa thất bại", () => {
    for (const k of khoi503()) {
      expect(k, `vòng cụt: người dùng tới đây VÌ đường trực tiếp vừa trả 413:\n${k}`)
        .not.toMatch(/xuất file trực tiếp/);
    }
  });

  it("mỗi nhánh nói rõ THIẾU CÁI GÌ và AI khắc phục được", () => {
    const k = khoi503();
    expect(k.some((x) => /hàng đợi|Redis/i.test(x)), "không nhánh nào nói tới hàng đợi/Redis").toBe(true);
    expect(k.some((x) => /kho lưu trữ/i.test(x)), "không nhánh nào nói tới kho lưu trữ").toBe(true);
    for (const x of k) {
      expect(x, `người dùng không tự bật Redis/kho được — phải chỉ họ nhờ ai:\n${x}`)
        .toMatch(/quản trị viên/);
    }
  });
});
