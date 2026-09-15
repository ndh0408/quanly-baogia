/** @vitest-environment jsdom */
//
// MÀN ACCOUNT HÀ NỘI: HAI CON SỐ TIỀN TRÊN CÙNG MỘT MÀN PHẢI KHỚP NHAU.
//
// ── LỖI ĐÃ ĐO ĐƯỢC (Cốc Cốc, 2026-09-16) ────────────────────────────────────
// `AccountHnView` giữ dữ liệu trong `qRef` (không phải state) và chỉ vẽ lại khi ai đó gọi
// `redraw()`. Hàm `mark` — thứ mà `HnTables` gọi sau MỌI thay đổi — chỉ đặt cờ `dirtyRef`, KHÔNG
// vẽ lại. `HnTables` thì tự vẽ lại chính nó, nên:
//
//   · đầu khối (do HnTables vẽ)      → "Tổng: 14.000.000 · 3 sheet"   ĐÚNG
//   · thẻ cuối màn (do cha vẽ)       → "TỔNG TẤT CẢ 2 SHEET HÀ NỘI — 9.500.000"   ĐỨNG IM
//
// Hai con số TIỀN đá nhau, và chỉ khớp lại sau khi Lưu rồi tải lại trang. Người đang gõ giá không
// biết tin con số nào — trên một màn mà việc DUY NHẤT của nó là gõ tiền.
//
// ── VÌ SAO PHẢI LÀ BÀI KIỂM MỨC COMPONENT ───────────────────────────────────
// Không hàm thuần nào bắt được: cả hai con số đều tính đúng từ CÙNG một mảng `hnTables`. Lỗi nằm
// ở chỗ CHA KHÔNG VẼ LẠI — chỉ lộ ra khi có cây React thật và một thay đổi đi qua đúng dây nối
// `HnTables → onMarkDirty → mark`. Đó cũng là lý do 205 bài backend + 23 bài web hiện có đều xanh
// trong khi lỗi vẫn nằm đó.
//
// Dùng `createRoot` + `act` của chính React, không thêm @testing-library — cùng khuôn với
// `GridTable.component.test.tsx`, và đúng luật `tests/ch3-npm-manifest.test.js` ở gốc repo.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";

const MAU = [{ id: 1, code: "gn", name: "GN (có ngày)", companyId: 7, layout: { hasDays: true } }];

const baoGia = () => ({
  id: 11,
  quoteNumber: "GN26D011",
  title: "Giao HN",
  companyId: 7,
  hnStatus: "assigned",
  updatedAt: "2026-09-16T00:00:00.000Z",
  hnRev: "0".repeat(32),
  hnTables: [
    { name: "Giá thuê HN", templateId: 1, groupSubtotal: true,
      items: [{ kind: "item", name: "Khung backdrop", quantity: 1, unitPrice: 5_000_000, days: 1 }] },
  ],
});

vi.mock("../lib/api", () => ({
  ApiError: class ApiError extends Error {},
  api: {
    metaTemplates: vi.fn(async () => MAU),
    getQuote: vi.fn(async () => baoGia()),
    saveHn: vi.fn(async () => ({})),
    submitHn: vi.fn(async () => ({})),
  },
}));
// CHỈ thay hai hàm mở hộp thoại; giữ nguyên phần còn lại của module.
// `../lib/ui` còn export `useEscClose`/`useIsMobile`… mà cả cây component dùng — mock trọn gói là
// GridTable chết ngay lúc render với "No export is defined on the mock".
vi.mock("../lib/ui", async (gocThat) => ({
  ...(await gocThat<typeof import("../lib/ui")>()),
  toast: vi.fn(),
  confirmModal: vi.fn(async () => true),
}));

const { AccountHnView } = await import("./AccountHnView");

describe("AccountHnView — tổng ở CUỐI màn phải đi theo thay đổi, không đợi Lưu", () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(async () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => { root.render(<AccountHnView quoteId={11} />); });
    // Hai vòng microtask cho metaTemplates + getQuote.
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });
  });

  const theCuoi = () => host.querySelector(".ahn-grand-card")?.textContent || "";
  // Cả ĐẦU KHỐI: tổng nằm ở `.extra-cat-total`, còn SỐ SHEET ở một span khác cùng hàng — nên lấy
  // nguyên hàng tiêu đề để so được cả hai.
  const dauKhoi = () => host.querySelector(".extra-cat-grouphead")?.textContent || "";

  it("mới mở: hai con số đã khớp (bảo hiểm — nếu vế này đỏ thì bài dưới vô nghĩa)", () => {
    expect(theCuoi()).toContain("1 sheet");
    expect(theCuoi()).toContain("5.000.000");
    expect(dauKhoi()).toContain("5.000.000");
  });

  it("thêm MỘT sheet → thẻ cuối màn đổi theo NGAY, không chờ Lưu/tải lại", async () => {
    const nut = [...host.querySelectorAll("button")].find((b) => /Thêm sheet/.test(b.textContent || ""));
    expect(nut, "phải có nút '+ Thêm sheet' (account HN đang được phép sửa)").toBeTruthy();

    await act(async () => { nut!.click(); });
    // `mark` gom nhịp 120ms rồi mới vẽ — chờ đúng cơ chế đó, đừng chờ theo cảm tính.
    await act(async () => { await new Promise((r) => setTimeout(r, 200)); });

    // ĐÂY là vế từng ĐỎ: trước bản vá thẻ cuối vẫn ghi "1 sheet" trong khi đầu khối đã "2 sheet".
    expect(theCuoi(), `thẻ cuối màn: "${theCuoi()}" · đầu khối: "${dauKhoi()}"`).toContain("2 sheet");
    expect(dauKhoi()).toContain("2 sheet");
  });
});
