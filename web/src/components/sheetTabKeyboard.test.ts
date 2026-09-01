// Tab sheet "Bảng nội bộ" không thao tác được bằng bàn phím — chốt hồi quy.
//
// ── LỖI ─────────────────────────────────────────────────────────────────────
// `ExtraTables.tsx` vẽ tab sheet bằng `<div className="sheet-tab …" onClick={…}>` trần: KHÔNG
// `role`, KHÔNG `tabIndex`, KHÔNG `onKeyDown`. Một <div> không có tabIndex thì không nhận focus,
// nên phím Tab đi thẳng qua nó và Enter/Space không kích hoạt được gì. Dấu ✕ xoá sheet cũng là
// `<span className="rm-tab" onClick={…}>` — cùng vấn đề, mà lại là thao tác PHÁ HUỶ.
//
// ── TÁI HIỆN ────────────────────────────────────────────────────────────────
// Mở báo giá → "Bảng nội bộ" → có từ 2 sheet trở lên trong một loại → dùng phím Tab đi tới dải tab:
// tiêu điểm nhảy thẳng từ nút "+ Thêm sheet" xuống lưới, bỏ qua toàn bộ tab. Không có cách nào đổi
// sheet hay xoá sheet nếu không dùng chuột.
//
// ── HẬU QUẢ ─────────────────────────────────────────────────────────────────
// Không sai tiền, không mất dữ liệu. Nhưng đây là hai chỗ DUY NHẤT trong app còn sót: hai nơi vẽ
// đúng cùng một dải tab — `QuoteEditor.tsx` (tab sheet báo giá) và `AccountHnView.tsx` (tab bảng
// giá Hà Nội) — đều đã có role + tabIndex + Enter/Space. Sót một chỗ nghĩa là quy ước trôi, và
// người sửa sau sẽ chép lại đúng mẫu sai này.
//
// ── CÁCH VÁ ─────────────────────────────────────────────────────────────────
// Áp đúng mẫu QuoteEditor.tsx: tab là `<div role="button" tabIndex={0} onKeyDown=…>`, còn nút xoá
// đổi hẳn sang `<button type="button">` thật (tự vào thứ tự Tab, tự nhận Enter/Space, có tên đọc
// lên được thay vì mỗi dấu ✕).
//
// Bài này ĐỌC MÃ NGUỒN chứ không render: web/ không có jsdom và không được thêm gói test mới. Cách
// đọc-nguồn đã có tiền lệ ngay cạnh đây (web/src/lib/imgSrcGuard.test.ts dùng `?raw` của Vite).
import { describe, it, expect } from "vitest";
import EXTRA from "./ExtraTables.tsx?raw";
import QUOTE_EDITOR from "../pages/QuoteEditor.tsx?raw";
import ACCOUNT_HN from "../pages/AccountHnView.tsx?raw";

/**
 * Tách các thẻ JSX MỞ ra thành { tag, attrs }.
 *
 * Không dùng được regex một phát `<(\w+)[^>]*>`: thuộc tính JSX chứa `{…}` mà bên trong có cả `=>`
 * của hàm mũi tên lẫn `>` trong chuỗi, nên phải quét tay — đếm độ sâu ngoặc nhọn và bỏ qua mọi thứ
 * nằm trong dấu nháy (kể cả template literal, nơi `${…}` có ngoặc riêng).
 */
function theJsxTags(code: string): { tag: string; attrs: string }[] {
  const out: { tag: string; attrs: string }[] = [];
  for (let i = 0; i < code.length; i++) {
    if (code[i] !== "<") continue;
    const m = /^<([A-Za-z][\w.]*)/.exec(code.slice(i, i + 48));
    if (!m) continue;
    let j = i + m[0].length;
    let depth = 0;
    let quote = "";
    for (; j < code.length; j++) {
      const c = code[j];
      if (quote) { if (c === quote && code[j - 1] !== "\\") quote = ""; continue; }
      if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
      if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) break;
    }
    out.push({ tag: m[1], attrs: code.slice(i + m[0].length, j) });
    i = j;
  }
  return out;
}

/** Thẻ bấm được của dải tab sheet: có class `sheet-tab`/`rm-tab` VÀ có onClick riêng. */
const tabBamDuoc = (code: string) =>
  theJsxTags(code).filter((t) => /\b(sheet-tab|rm-tab)\b/.test(t.attrs) && /\bonClick=/.test(t.attrs));

const NGUON = [
  ["ExtraTables.tsx", EXTRA],
  ["QuoteEditor.tsx", QUOTE_EDITOR],
  ["AccountHnView.tsx", ACCOUNT_HN],
] as const;

describe("dải tab sheet — mọi thứ bấm được phải dùng được bằng bàn phím", () => {
  for (const [ten, code] of NGUON) {
    it(`${ten}: bộ quét tìm thấy tab bấm được (chốt để bài test không tự xanh vì quét trượt)`, () => {
      expect(tabBamDuoc(code).length).toBeGreaterThan(0);
    });

    it(`${ten}: mọi tab bấm được đều nhận được tiêu điểm và Enter/Space`, () => {
      for (const t of tabBamDuoc(code)) {
        const mo = `<${t.tag} ${t.attrs.trim().replace(/\s+/g, " ").slice(0, 160)}>`;
        // <button> thật đã tự có tất cả: vào thứ tự Tab, kích hoạt bằng Enter/Space, có vai trò.
        if (t.tag === "button") continue;
        expect(t.attrs, `${ten}: thiếu tabIndex → phím Tab đi qua, không focus được ${mo}`).toMatch(/\btabIndex=/);
        expect(t.attrs, `${ten}: thiếu onKeyDown → Enter/Space không kích hoạt ${mo}`).toMatch(/\bonKeyDown=/);
        // Không có role thì công nghệ hỗ trợ đọc ra "nhóm/văn bản", và aria-pressed/aria-selected
        // gắn lên phần tử không có vai trò tương ứng bị BỎ QUA hoàn toàn.
        expect(t.attrs, `${ten}: thiếu role → trình đọc màn hình không biết đây là thứ bấm được ${mo}`).toMatch(/\brole=/);
      }
    });
  }
});
