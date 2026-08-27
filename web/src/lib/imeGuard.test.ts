import { describe, it, expect } from "vitest";
import { dangGoIME } from "./gridShared";

// ── BỘ GÕ TIẾNG VIỆT (IME) ───────────────────────────────────────────────────
// §3 của quy ước dự án liệt "IME tiếng Việt" vào nhóm KHÔNG ĐƯỢC PHÁ, mà trước bài này repo có
// ĐÚNG 0 bài kiểm cho nó — trong khi chính điều kiện ấy nằm ở hai nơi, viết hai kiểu khác nhau
// (web/src/components/GridTable.tsx và web/src/pages/Venues.tsx). Nay cả hai gọi chung
// `dangGoIME`, và bài này canh đúng cái chung đó.
//
// Vì sao đáng canh: hỏng ở đây KHÔNG hiện ra với bàn phím tiếng Anh. Người gõ Telex mất chữ đầu
// mỗi ô (lưới), hoặc mỗi lần bỏ dấu là một lần gửi nhầm (trang Rạp) — còn bộ test thì xanh.

/** Dựng một sự kiện giống React tổng hợp: React CHÉP keyCode từ nativeEvent sang, nên mặc định
 *  hai chỗ bằng nhau — trừ khi bài kiểm cố ý tách ra để kiểm từng đường đọc. */
const phim = (o: {
  key?: string;
  keyCode?: number;
  isComposing?: boolean;
  nativeKeyCode?: number;
  khongCoNative?: boolean;
}) => ({
  key: o.key ?? "a",
  keyCode: o.keyCode ?? 65,
  nativeEvent: o.khongCoNative ? null : { isComposing: o.isComposing ?? false, keyCode: o.nativeKeyCode ?? o.keyCode ?? 65 },
});

describe("dangGoIME — nhận ra nhịp của bộ gõ", () => {
  it("phím thường (gõ 'a' bằng bàn phím tiếng Anh) KHÔNG phải nhịp bộ gõ", () => {
    expect(dangGoIME(phim({ key: "a", keyCode: 65 }))).toBe(false);
  });

  it("isComposing = true → đúng (đường chuẩn, mọi trình duyệt đời mới)", () => {
    expect(dangGoIME(phim({ key: "a", isComposing: true }))).toBe(true);
  });

  it("keyCode 229 → đúng (quy ước cũ; Safari cũ để isComposing=false ở nhịp ĐẦU của cụm)", () => {
    expect(dangGoIME(phim({ key: "Unidentified", keyCode: 229 }))).toBe(true);
  });

  it('key = "Process" → đúng (Firefox dùng thay cho 229)', () => {
    expect(dangGoIME(phim({ key: "Process", keyCode: 0 }))).toBe(true);
  });

  it("229 nằm ở nativeEvent mà sự kiện tổng hợp không có → vẫn đúng", () => {
    expect(dangGoIME(phim({ key: "a", keyCode: 0, nativeKeyCode: 229 }))).toBe(true);
  });

  it("thiếu hẳn nativeEvent thì KHÔNG được ném (một số đường gọi truyền sự kiện trần)", () => {
    expect(dangGoIME(phim({ key: "a", keyCode: 65, khongCoNative: true }))).toBe(false);
    expect(dangGoIME(phim({ key: "Process", khongCoNative: true }))).toBe(true);
    expect(dangGoIME({})).toBe(false);
  });

  it("Enter / Escape / mũi tên KHÔNG bị nhận nhầm là nhịp bộ gõ", () => {
    for (const [key, keyCode] of [["Enter", 13], ["Escape", 27], ["ArrowDown", 40], ["Tab", 9]] as const) {
      expect(dangGoIME(phim({ key, keyCode }))).toBe(false);
    }
  });

  // CỐ Ý: hàm KHÔNG xét Ctrl/Cmd. Hai nơi gọi lọc phím tắt ở hai thời điểm khác nhau (lưới lọc
  // TRƯỚC khi hỏi, trang Rạp lọc SAU), nên nhét Ctrl vào đây sẽ đổi hành vi của một trong hai.
  it("KHÔNG tự xét Ctrl/Cmd — đó là việc của nơi gọi", () => {
    const e = { ...phim({ key: "a", isComposing: true }), ctrlKey: true, metaKey: true };
    expect(dangGoIME(e)).toBe(true);
  });
});
