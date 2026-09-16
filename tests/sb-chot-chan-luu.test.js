// CHỐT CHẶN ĐƯỜNG LƯU: KÍCH THƯỚC + NGÂN SÁCH ĐỒNG THỜI.
//
// ── VÌ SAO CÓ BÀI NÀY ───────────────────────────────────────────────────────
// ĐO ĐƯỢC trên môi trường thật (container app 1.536 MB, heap V8 1.024 MB), POST /api/quotes:
//     10.000 dòng →  7,1s, đỉnh RSS   460 MB
//     20.000 dòng → 13,1s, đỉnh RSS   756 MB
//     30.000 dòng → 18,1s, đỉnh RSS 1.154 MB (77% trần)
//     60.000 dòng → tiến trình BỊ NHÂN GIẾT (oom-kill, anon-rss 1,5 GB) — CẢ APP SẬP cho mọi người
// 60.000 chính là con số hệ thống TỰ QUẢNG CÁO là hợp lệ (MAX_SAVE_SHEETS × MAX_SAVE_ITEMS_PER_SHEET),
// tức mọi tài khoản có `quote:create` đều hạ được cả app bằng MỘT request bình thường.
//
// Hai chốt cho HAI chế độ hỏng khác nhau — bài này canh cả hai, và canh cả chỗ chúng KHÔNG được
// chặn nhầm người dùng hợp lệ.
import { describe, it, expect } from "vitest";
import { createBudgetGate } from "../src/saveBudget.js";
import { demTongDongLuu, MAX_SAVE_TOTAL_ROWS } from "../src/validators.js";

const dong = (n) => Array.from({ length: n }, (_, i) => ({ order: i + 1, kind: "item", name: `x${i}` }));

describe("demTongDongLuu — đếm ĐỦ BA nguồn", () => {
  it("cộng sheet.items + sheet.extraTables[].items + hnTables[].items", () => {
    expect(
      demTongDongLuu({
        sheets: [{ items: dong(2), extraTables: [{ items: dong(3) }] }],
        hnTables: [{ items: dong(4) }],
      }),
    ).toBe(9);
  });

  it("bảng phụ và bảng HN ĐỀU được tính — đây chính là lỗ đã đo", () => {
    // Trần 1000 ở `sheetSchema.items` CHỈ áp cho `sheet.items`. `extraTables` là .max(20) BẢNG,
    // mỗi bảng lại có items .max(1000); `hnTables` là .max(60) bảng × 1000. Sức chứa THẬT của
    // schema vì thế là 60×(1000+20×1000) + 60×1000 = 1.320.000 dòng, không phải 60.000.
    const chiSheet = demTongDongLuu({ sheets: [{ items: dong(5) }] });
    const themBangPhu = demTongDongLuu({ sheets: [{ items: dong(5), extraTables: [{ items: dong(7) }] }] });
    const themBangHn = demTongDongLuu({ sheets: [{ items: dong(5) }], hnTables: [{ items: dong(9) }] });
    expect(chiSheet).toBe(5);
    expect(themBangPhu, "bảng phụ KHÔNG được tính → trần tổng thành vô nghĩa").toBe(12);
    expect(themBangHn, "bảng HN KHÔNG được tính → trần tổng thành vô nghĩa").toBe(14);
  });

  it("thân rỗng / thiếu khoá → 0, không ném", () => {
    expect(demTongDongLuu(null)).toBe(0);
    expect(demTongDongLuu({})).toBe(0);
    expect(demTongDongLuu({ sheets: [{}] })).toBe(0);
    expect(demTongDongLuu({ sheets: [{ items: null, extraTables: null }] })).toBe(0);
  });
});

describe("cổng ngân sách — trần theo TRỌNG SỐ, không theo suất", () => {
  it("không bao giờ vượt ngân sách, dù nhiều người xin cùng lúc", async () => {
    const g = createBudgetGate({ nganSach: 100, toiDaCho: 10 });
    const dinh = { v: 0 };
    const chay = async (can) => {
      await g.xin(can);
      dinh.v = Math.max(dinh.v, g.dangBay());
      await new Promise((r) => setTimeout(r, 5));
      g.tra(can);
    };
    await Promise.all([chay(60), chay(60), chay(60), chay(30), chay(30)]);
    expect(dinh.v, `đỉnh ${dinh.v} vượt ngân sách 100`).toBeLessThanOrEqual(100);
    expect(g.dangBay()).toBe(0);
    expect(g.dangCho()).toBe(0);
  });

  it("FIFO: người xin NHIỀU đứng đầu hàng KHÔNG bị việc nhỏ chen qua mặt", async () => {
    // Nếu cổng "nhảy cóc" tìm ai vừa chỗ hơn thì việc nhỏ luôn chen được và người xin nhiều nhất
    // chờ mãi — đói tài nguyên, và triệu chứng là "thỉnh thoảng có người không lưu được".
    const g = createBudgetGate({ nganSach: 100, toiDaCho: 10 });
    await g.xin(100); // chiếm hết
    const thuTu = [];
    const to = g.xin(100).then(() => thuTu.push("to"));
    const nho = g.xin(1).then(() => thuTu.push("nho"));
    g.tra(100);          // nhả → chỉ ĐỦ cho người đứng đầu (100), việc nhỏ PHẢI tiếp tục chờ
    await to;
    expect(thuTu, `sau lần nhả thứ nhất: ${thuTu.join(",")}`).toEqual(["to"]);
    g.tra(100);          // nhả tiếp → tới lượt việc nhỏ
    await nho;
    expect(thuTu).toEqual(["to", "nho"]);
    g.tra(1);
    expect(g.dangBay()).toBe(0);
  });

  it("hàng đợi ĐẦY → 503 kèm Retry-After, không phải treo", async () => {
    const g = createBudgetGate({ nganSach: 10, toiDaCho: 1 });
    await g.xin(10);
    const cho = g.xin(5).catch(() => "bi-tu-choi"); // vào hàng (1 chỗ)
    await expect(g.xin(5)).rejects.toMatchObject({ status: 503, retryAfter: 5, code: "save_budget_full" });
    g.tra(10);
    await cho;
  });

  it("xin NHIỀU HƠN cả ngân sách → KẸP xuống ngân sách và chạy MỘT MÌNH, KHÔNG từ chối", async () => {
    // ĐÃ ĐO TRÊN MÁY CHỦ THẬT rằng bản đầu (từ chối 413 ở đây) vô hiệu hoá quyền miễn trừ của
    // `gacKichThuocLuu`: báo giá CŨ 25.000 dòng được chốt kích thước cho qua rồi bị cổng này chặn
    // — chủ báo giá lại bị khoá ra khỏi dữ liệu của mình. Việc từ chối theo KÍCH THƯỚC thuộc về
    // chốt kia (nơi duy nhất biết báo giá đang có bao nhiêu dòng), không thuộc về cổng đồng thời.
    const g = createBudgetGate({ nganSach: 10, toiDaCho: 10 });
    const t = Date.now();
    await g.xin(25);                       // lớn hơn cả ngân sách
    expect(Date.now() - t, "phải được cấp ngay khi hệ thống rảnh").toBeLessThan(500);
    expect(g.dangBay(), "kẹp xuống đúng bằng ngân sách → chiếm trọn chỗ").toBe(10);

    // Và trong lúc nó chạy, người khác PHẢI chờ — đó là ý nghĩa của "chạy một mình".
    let daCap = false;
    const sau = g.xin(1).then(() => { daCap = true; });
    await new Promise((r) => setTimeout(r, 20));
    expect(daCap, "có người được cấp chỗ trong khi việc lớn đang chạy → vỡ trần").toBe(false);
    g.tra(10);
    await sau;
    expect(daCap).toBe(true);
    g.tra(1);
  });

  it("huỷ giữa chừng (client ngắt) thì RỜI hàng, không giữ chỗ ma", async () => {
    const g = createBudgetGate({ nganSach: 10, toiDaCho: 10 });
    await g.xin(10);
    const ac = new AbortController();
    const p = g.xin(5, ac.signal).catch((e) => e);
    expect(g.dangCho()).toBe(1);
    ac.abort();
    await p;
    expect(g.dangCho(), "bỏ đi rồi mà vẫn còn trong hàng → rò chỗ").toBe(0);
    g.tra(10);
  });

  it("trả dư KHÔNG làm biến đếm xuống âm (âm = trần thành vô nghĩa)", () => {
    const g = createBudgetGate({ nganSach: 10, toiDaCho: 10 });
    g.tra(5);
    g.tra(5);
    expect(g.dangBay()).toBe(0);
  });
});

describe("hằng số", () => {
  it("MAX_SAVE_TOTAL_ROWS nằm ở mức ĐO ĐƯỢC là an toàn, không phải 60.000", () => {
    // 20.000 dòng = 756 MB đỉnh (49% container). 30.000 = 1.154 MB (77%). 60.000 = oom-kill.
    expect(MAX_SAVE_TOTAL_ROWS).toBeLessThanOrEqual(20_000);
    expect(MAX_SAVE_TOTAL_ROWS).toBeGreaterThan(0);
  });
});
