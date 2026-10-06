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
// Nạp mã nguồn qua Vite (`?raw`) chứ không qua node:fs: tsconfig của web chỉ có kiểu vite/client, không có @types/node —
// lúc dựng image (cd web && npm ci && tsc) `node:fs` / `__dirname` không có kiểu và bản dựng gãy.
const NGUON = import.meta.glob<string>(["./**/*.tsx", "!./**/*.test.tsx"], { query: "?raw", import: "default", eager: true });

/** Mọi thẻ JSX <input|select|textarea …> thật (bỏ dòng chú thích và thẻ trơn trong lời giải thích), kèm số dòng. */
function cacThe(nguon: string): { the: string; dong: number }[] {
  const kq: { the: string; dong: number }[] = [];
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
    kq.push({ the, dong: nguon.slice(0, m.index).split("\n").length });
  }
  return kq;
}

function oThieuTen(nguon: string): number[] {
  return cacThe(nguon).filter(({ the }) => !/\s(name|id)=/.test(the) && !/\{\.\.\./.test(the)).map((t) => t.dong);
}

const CHROME_NHAN_RA = /mail|phone|tel|name|address|title|password|user|company|contact|organi[sz]ation/i;
function oThieuTuDien(nguon: string): number[] {
  return cacThe(nguon).filter(({ the }) => {
    if (/\sautoComplete=/.test(the) || /type="(checkbox|radio|file|hidden)"/.test(the)) return false;
    const coDinh = the.match(/\sname="([^"]+)"/)?.[1];
    if (coDinh !== undefined) return CHROME_NHAN_RA.test(coDinh);
    return /\sname=\{/.test(the);   // tên động (f.key, field…) có thể là phone/address → phải khai
  }).map((t) => t.dong);
}

describe("ô nhập trong web/src đều có name hoặc id", () => {
  it("không thẻ <input|select|textarea> nào thiếu cả name lẫn id", () => {
    expect(Object.keys(NGUON).length, "glob phải thấy mã nguồn").toBeGreaterThan(20);
    const thieu = Object.entries(NGUON).flatMap(([p, nguon]) => oThieuTen(nguon).map((d) => `${p.slice(2)}:${d}`));
    expect(thieu, "thêm name=\"…\" cho các ô này (Chrome Issues: form field should have an id or name)").toEqual([]);
  });

  // Có name rồi thì Chrome nhận ra kiểu ô (email, phone, name, address…) và báo "An element doesn't have an autocomplete
  // attribute" — tệ hơn: nó GỢI Ý ĐIỀN email/SĐT của CHÍNH người dùng vào ô email/SĐT của khách trong báo giá.
  // Ô dữ liệu của người khác → autoComplete="off"; ô của chính mình (Tài khoản) → token chuẩn (name, tel, email…).
  it("ô có name kiểu email/phone/name/address/title… (hoặc name động) đều khai autoComplete", () => {
    const thieu = Object.entries(NGUON).flatMap(([p, nguon]) => oThieuTuDien(nguon).map((d) => `${p.slice(2)}:${d}`));
    expect(thieu, "thêm autoComplete=\"off\" (dữ liệu người khác) hoặc token chuẩn (dữ liệu của chính người dùng)").toEqual([]);
  });

  it("bộ quét bắt được thẻ thiếu tên (tự kiểm)", () => {
    expect(oThieuTen(`<input value={a} onChange={f} />\n<select name="x" value={b}>\n<input id="y" />`)).toEqual([1]);
    expect(oThieuTen(` * Giá trị cho \`<input type="date">\`\n<input {...props} />`)).toEqual([]);
    expect(oThieuTuDien(`<input name="toEmail" />\n<input name="q" />\n<input name={f.key} />\n<input name="phone" autoComplete="tel" />\n<input type="checkbox" name="title" />`)).toEqual([1, 3]);
  });
});
