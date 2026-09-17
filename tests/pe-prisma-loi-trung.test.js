/**
 * ============================================================================
 * CỤM pe — ĐỌC TÊN RÀNG BUỘC TỪ LỖI P2002 QUA CẢ HAI HÌNH DẠNG.
 *
 * ── LỖI ĐÃ ĐO, KHÔNG PHẢI SUY ĐOÁN ─────────────────────────────────────────
 * Với engine Rust cũ, Prisma điền `err.meta.target`. Từ khi repo dùng driver adapter
 * `@prisma/adapter-pg` (Prisma 7), trường đó KHÔNG CÒN được điền. Đo bằng cách cố ý gây trùng trên
 * `@@unique([projectCode, projectVersion])` của bảng Quote:
 *
 *     code   = "P2002"
 *     target = undefined
 *     meta   = { driverAdapterError: { cause: {
 *                 originalCode: "23505",
 *                 constraint: { index: "Quote_projectCode_projectVersion_key" },
 *                 table: "Quote" } } }
 *
 * Hệ quả: MỌI phép so `String(err.meta?.target ?? "").includes("…")` trong repo trả false vĩnh
 * viễn. Hai chỗ đã hỏng IM LẶNG vì đúng lý do này:
 *
 *   · `createQuote` — nhánh "đụng MÃ DỰ ÁN" không bao giờ chạy → bốn lượt thử y hệt nhau rồi 409
 *     "Số báo giá bị trùng", sai hẳn nguyên nhân, mỗi lượt chèn rồi rollback TOÀN BỘ hạng mục.
 *   · `customerService` — 409 "Mã số thuế đã thuộc khách hàng X" tụt xuống `throw e` → 500
 *     "Lỗi server", đúng cái hàm đó sinh ra để tránh.
 *
 * ── CÙNG LỚP LỖI ĐÃ CẮN REPO NÀY MỘT LẦN ───────────────────────────────────
 * Nhánh `P2024` cho cạn pool cũng từng là mã chết vì node-pg ném `Error` TRẦN không có `.code`
 * (tests/pl-can-pool-503.test.js). Driver adapter đổi hình dạng lỗi là một nguồn hồi quy im lặng
 * có hệ thống ở repo này — nên hàm trích phải đọc CẢ HAI đường, và bài này khoá cả hai.
 * ============================================================================
 */
import { describe, it, expect } from "vitest";
import { tenRangBuocTrung, trungTren } from "../src/prismaLoi.js";

/** ĐÚNG hình dạng đo được từ @prisma/adapter-pg (Prisma 7). */
const loiAdapter = (index) => ({
  code: "P2002",
  meta: {
    driverAdapterError: {
      name: "DriverAdapterError",
      cause: {
        originalCode: "23505",
        originalMessage: `duplicate key value violates unique constraint "${index}"`,
        kind: "UniqueConstraintViolation",
        constraint: { index },
        table: "Quote",
      },
    },
    modelName: "Quote",
  },
});

/** Hình dạng của engine Rust / của lỗi tự chế trong các bài test cũ. */
const loiEngine = (target) => ({ code: "P2002", meta: { target } });

describe("tenRangBuocTrung — đọc được CẢ HAI hình dạng", () => {
  it("driver adapter: lấy tên index từ meta.driverAdapterError.cause.constraint.index", () => {
    // Đây là hình dạng THẬT đang chạy ở repo này. Không đọc được nó = mọi nhánh P2002 đều chết.
    expect(tenRangBuocTrung(loiAdapter("Quote_projectCode_projectVersion_key")))
      .toBe("Quote_projectCode_projectVersion_key");
  });

  it("engine cũ: mảng cột", () => {
    expect(tenRangBuocTrung(loiEngine(["taxCode"]))).toBe("taxCode");
    expect(tenRangBuocTrung(loiEngine(["projectCode", "projectVersion"]))).toBe("projectCode,projectVersion");
  });

  it("engine cũ: tên index dạng chuỗi", () => {
    expect(tenRangBuocTrung(loiEngine("Customer_taxCode_live_key"))).toBe("Customer_taxCode_live_key");
  });

  it("adapter trả danh sách CỘT thay vì tên index", () => {
    // Một số bản adapter dùng `fields`. Đọc thiếu nhánh này là để lại đúng một nửa số ca hỏng.
    const e = loiAdapter("x");
    e.meta.driverAdapterError.cause.constraint = { fields: ["taxCode"] };
    expect(tenRangBuocTrung(e)).toBe("taxCode");
  });

  it("constraint là CHUỖI trần", () => {
    const e = loiAdapter("x");
    e.meta.driverAdapterError.cause.constraint = "Customer_code_key";
    expect(tenRangBuocTrung(e)).toBe("Customer_code_key");
  });

  it("lỗi lạ → chuỗi RỖNG, không ném", () => {
    // Chuỗi rỗng không `.includes` tên cột nào, nên nơi gọi rơi xuống nhánh mặc định thay vì đoán
    // nhầm thành một ràng buộc cụ thể. Ném ở đây sẽ biến một lỗi CSDL thành một lỗi khác.
    for (const x of [null, undefined, {}, { meta: {} }, { meta: { target: 42 } }, "chuỗi", 7]) {
      expect(() => tenRangBuocTrung(x)).not.toThrow();
      expect(tenRangBuocTrung(x)).toBe("");
    }
  });

  it("ƯU TIÊN meta.target khi có — bản không dùng adapter vẫn phải chạy", () => {
    const e = loiAdapter("Quote_projectCode_projectVersion_key");
    e.meta.target = ["taxCode"];
    expect(tenRangBuocTrung(e)).toBe("taxCode");
  });
});

describe("trungTren — chỉ đúng khi P2002 VÀ dính cột đó", () => {
  it("nhận đúng ràng buộc, qua hình dạng adapter", () => {
    expect(trungTren(loiAdapter("Quote_projectCode_projectVersion_key"), "projectCode")).toBe(true);
    expect(trungTren(loiAdapter("Customer_taxCode_live_key"), "taxCode")).toBe(true);
  });

  it("KHÔNG nhận nhầm ràng buộc khác", () => {
    // `Quote_quoteNumber_key` KHÔNG được đọc thành "đụng mã dự án" — nếu nhầm, vòng thử lại sẽ đẩy
    // sai bộ đếm và sinh ra một lớp lỗi mới.
    expect(trungTren(loiAdapter("Quote_quoteNumber_key"), "projectCode")).toBe(false);
  });

  it("lỗi KHÔNG phải P2002 → false, dù tên có khớp", () => {
    const e = loiAdapter("Quote_projectCode_projectVersion_key");
    e.code = "P2003";
    expect(trungTren(e, "projectCode")).toBe(false);
  });

  it("không ném với đầu vào rác", () => {
    for (const x of [null, undefined, {}, 7]) expect(() => trungTren(x, "taxCode")).not.toThrow();
  });
});

describe("KHÔNG nơi nào trong src/ còn đọc thẳng meta.target", () => {
  it("mọi chỗ phải đi qua src/prismaLoi.ts", async () => {
    // Đọc thẳng `meta.target` là viết lại đúng lỗi mã-chết này. Bài kiểm ở mức mã vì hành vi nhìn
    // từ ngoài giống hệt nhau cho tới khi có người gặp đúng ca trùng.
    const { readFileSync, readdirSync, statSync } = await import("node:fs");
    const { join, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

    const tep = [];
    const quet = (d) => {
      for (const t of readdirSync(d)) {
        const p = join(d, t);
        if (statSync(p).isDirectory()) quet(p);
        else if (/\.ts$/.test(t)) tep.push(p);
      }
    };
    quet(join(ROOT, "src"));

    // BỎ DÒNG CHÚ THÍCH: hai chỗ đã vá đều GIẢI THÍCH vì sao không được đọc `meta.target`, và soi
    // cả chú thích thì bài này đỏ vì chính lời cảnh báo — đúng cái bẫy đã gặp vài lần ở repo này.
    const boChuThich = (src) =>
      src.split("\n").filter((d) => !/^\s*(\/\/|\*|\/\*)/.test(d)).join("\n");
    const xau = tep
      .filter((p) => !p.endsWith("prismaLoi.ts"))
      .filter((p) => /meta\s*[?.]*\.\s*target/.test(boChuThich(readFileSync(p, "utf8"))))
      .map((p) => p.slice(ROOT.length + 1).replace(/\\/g, "/"));
    expect(xau, `đọc thẳng meta.target (undefined với driver adapter): ${xau.join(", ")}`).toEqual([]);
  });
});
