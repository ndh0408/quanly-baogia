// MỌI Ô NHẬP CÓ `name` (hoặc `id`) — soát bằng Chrome DevTools 2026-10-06.
//
// Chrome (bảng Issues) báo "A form field element should have an id or name attribute" cho từng ô thiếu cả hai: trình
// tự điền và trình quản lý mật khẩu không nhận ra ô. Lúc soát, trên dev có 137 lần báo ở màn soạn báo giá, 9 ở Hóa đơn
// đầu ra, 9 ở Tài khoản… Đã gắn `name` cho cả 166 thẻ trong web/src. Bài này quét mã nguồn để thẻ mới không quay lại
// cảnh thiếu tên. ĐỎ trên mã cũ (166 thẻ thiếu).
//
// Quét thẻ JSX `<input|select|textarea …>` trong *.tsx (bỏ tệp test). Thẻ có `{...props}` được bỏ qua vì tên có thể đến
// từ props. Dòng chú thích (`*`, `//`) và thẻ trơn không thuộc tính như `<input>` trong lời giải thích cũng bỏ qua.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const GOC = join(__dirname);

function tepTsx(thuMuc: string): string[] {
  const kq: string[] = [];
  for (const ten of readdirSync(thuMuc)) {
    const p = join(thuMuc, ten);
    if (statSync(p).isDirectory()) kq.push(...tepTsx(p));
    else if (ten.endsWith(".tsx") && !ten.endsWith(".test.tsx")) kq.push(p);
  }
  return kq;
}

function oThieuTen(nguon: string): number[] {
  const dong: number[] = [];
  const re = /<(input|select|textarea)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(nguon))) {
    let i = m.index + 1, sau = 0;
    for (; i < nguon.length; i++) {
      const c = nguon[i];
      if (c === "{") sau++;
      else if (c === "}") sau--;
      else if (c === ">" && sau === 0 && nguon[i - 1] !== "=") break;
    }
    const the = nguon.slice(m.index, i + 1);
    const dauDong = nguon.slice(nguon.lastIndexOf("\n", m.index) + 1, m.index);
    if (!the.includes("=") || /^\s*(\*|\/\/)/.test(dauDong)) continue;
    if (/\s(name|id)=/.test(the) || /\{\.\.\./.test(the)) continue;
    dong.push(nguon.slice(0, m.index).split("\n").length);
  }
  return dong;
}

describe("ô nhập trong web/src đều có name hoặc id", () => {
  it("không thẻ <input|select|textarea> nào thiếu cả name lẫn id", () => {
    const thieu = tepTsx(GOC).flatMap((p) =>
      oThieuTen(readFileSync(p, "utf8")).map((d) => `${relative(GOC, p).split(sep).join("/")}:${d}`));
    expect(thieu, "thêm name=\"…\" cho các ô này (Chrome Issues: form field should have an id or name)").toEqual([]);
  });

  it("bộ quét bắt được thẻ thiếu tên (tự kiểm)", () => {
    expect(oThieuTen(`<input value={a} onChange={f} />\n<select name="x" value={b}>\n<input id="y" />`)).toEqual([1]);
    expect(oThieuTen(` * Giá trị cho \`<input type="date">\`\n<input {...props} />`)).toEqual([]);
  });
});
