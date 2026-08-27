// Bộ lọc "Hoạt động" của Nhật ký hoạt động phải PHỦ mọi mã action mà máy chủ thực sự ghi.
//
// ── LỖI ─────────────────────────────────────────────────────────────────────
// `ACTION_GROUPS` trong `web/src/pages/Audit.tsx` là nguồn DUY NHẤT dựng <select> lọc hoạt động
// (và `ACTION_LABEL` suy ra từ chính nó). Ô lọc là <select>, KHÔNG có ô nhập tự do — mã nào
// không có trong bảng thì admin không có cách nào chọn để lọc, và cột "Hoạt động" hiện mã thô
// (`actionLabel` fallback `a`) thay vì tiếng Việt.
// Các đợt vá gần đây thêm 15 mã mới vào máy chủ (file.sign-download, file.sign-upload,
// file.finalize, personnel.payment-proof.view, …) mà không cập nhật bảng này.
//
// ── VÌ SAO KHOÁ BẰNG TEST ĐỌC NGUỒN ─────────────────────────────────────────
// Danh sách này trôi khỏi máy chủ một cách IM LẶNG: thêm một `audit(req, "x.y")` ở `src/` không
// làm hỏng build của `web/`. Test này đọc CẢ HAI nguồn dưới dạng văn bản (`?raw` /
// `import.meta.glob`) rồi so, nên mọi mã mới thêm ở máy chủ về sau đều làm test đỏ ngay.
// Dùng `?raw` chứ không phải `node:fs` vì web/tsconfig chỉ nạp types "vite/client",
// không có @types/node — tiền lệ: web/src/lib/imgSrcGuard.test.ts, b6-gridMemo.test.ts.
import { describe, it, expect } from "vitest";
import AUDIT_PAGE from "./Audit.tsx?raw";

// Toàn bộ mã nguồn máy chủ (repo-root/src), KHÔNG phải web/src.
const SERVER_SRC = {
  ...import.meta.glob("../../../src/**/*.ts", { query: "?raw", import: "default", eager: true }),
  ...import.meta.glob("../../../src/**/*.js", { query: "?raw", import: "default", eager: true }),
} as Record<string, string>;

// Mọi lời gọi `audit(<ctx>, "<action>"` — `<ctx>` là req/null/tên biến, không chứa dấu phẩy hay ngoặc,
// nên khai báo `audit(ctx: Request | null, action: string, …)` trong src/audit.ts KHÔNG khớp
// (sau dấu phẩy đầu tiên là `action`, không phải dấu nháy).
const CALL_RE = /\baudit\(\s*[^,()]*,\s*"([^"]+)"/g;

function serverActions(): { actions: Set<string>; files: number } {
  const found = new Set<string>();
  const texts = Object.values(SERVER_SRC);
  for (const text of texts) for (const m of text.matchAll(CALL_RE)) found.add(m[1]);
  return { actions: found, files: texts.length };
}

// Trích các cặp ["mã", "nhãn"] bên trong đúng khối `const ACTION_GROUPS … ];`.
function uiActions(): { pairs: [string, string][] } {
  const start = AUDIT_PAGE.indexOf("const ACTION_GROUPS");
  expect(start, "không tìm thấy ACTION_GROUPS trong Audit.tsx").toBeGreaterThanOrEqual(0);
  const end = AUDIT_PAGE.indexOf("\n];", start);
  expect(end, "không tìm thấy điểm kết thúc của ACTION_GROUPS").toBeGreaterThan(start);
  const block = AUDIT_PAGE.slice(start, end);
  const pairs: [string, string][] = [];
  for (const m of block.matchAll(/\["([a-z][\w.-]*)",\s*"([^"]+)"\]/g)) pairs.push([m[1], m[2]]);
  return { pairs };
}

describe("Nhật ký hoạt động — bộ lọc Hoạt động phủ hết mã máy chủ ghi", () => {
  it("đọc được cả hai nguồn (nếu glob hỏng thì mọi khẳng định dưới đây thành vô nghĩa)", () => {
    const { actions, files } = serverActions();
    expect(files).toBeGreaterThan(30);            // src/ có ~50 file .ts + 2 worker .js
    expect(actions.size).toBeGreaterThanOrEqual(82);   // 82 = số đếm thật lúc viết bài này
    expect(actions.has("quote.create")).toBe(true);
    expect(uiActions().pairs.length).toBeGreaterThan(60);
  });

  it("MỌI mã action `audit()` ghi ở src/ đều có trong ACTION_GROUPS", () => {
    const { actions } = serverActions();
    const known = new Set(uiActions().pairs.map(([a]) => a));
    const missing = [...actions].filter((a) => !known.has(a)).sort();
    expect(missing, `thiếu trong ACTION_GROUPS (admin không lọc được): ${missing.join(", ")}`).toEqual([]);
  });

  it("không có mã nào trùng lặp, và mã nào cũng có nhãn tiếng Việt (không phải chính nó)", () => {
    const { pairs } = uiActions();
    const seen = new Set<string>(); const dup: string[] = [];
    for (const [a] of pairs) { if (seen.has(a)) dup.push(a); seen.add(a); }
    expect(dup, `mã trùng: ${dup.join(", ")}`).toEqual([]);
    // Nhãn phải là chữ, không được để nguyên mã (dấu chấm) hay bỏ trống.
    const xau = pairs.filter(([a, l]) => !l.trim() || l === a).map(([a]) => a);
    expect(xau, `nhãn chưa dịch: ${xau.join(", ")}`).toEqual([]);
  });

  it("KHÔNG có mã thừa: mọi mã trong bảng đều thực sự được src/ ghi", () => {
    // Mã thừa không gây hại hiển thị nhưng làm dropdown có lựa chọn LUÔN ra 0 dòng.
    const { actions } = serverActions();
    const extra = uiActions().pairs.map(([a]) => a).filter((a) => !actions.has(a)).sort();
    expect(extra, `có trong bảng nhưng src/ không ghi: ${extra.join(", ")}`).toEqual([]);
  });
});
