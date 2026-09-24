// GRID-03: công thức sai IM LẶNG. "," tách đối số (thói quen Excel vùng US) bị đọc thành dấu thập phân
// SAU khi đã thay tham chiếu bằng số → "=SUM(E1,E2)" ra 100000,25; đối số không đọc được bị lọc bỏ
// rồi tính tiếp trên phần còn lại → "=ROUND(G3,0)" ra 0.
import { describe, it, expect } from "vitest";
import { evalFormula, type FormulaRefs } from "./formula";

const O: Record<string, number> = { E1: 100000, E2: 250000, E3: 123.456, E5: 7, G3: 1234.5 };
const refs: FormulaRefs = {
  cell: (a) => O[a.replace(/\$/g, "").toUpperCase()] ?? 0,
  range: (a, b) => {
    const [ca, ra] = [a.replace(/\d+/, ""), Number(a.replace(/\D+/, ""))], rb = Number(b.replace(/\D+/, ""));
    const out: number[] = []; for (let r = Math.min(ra, rb); r <= Math.max(ra, rb); r++) out.push(O[ca + r] ?? 0); return out;
  },
};
const tinh = (s: string) => evalFormula(s, refs);

describe("GRID-03 — dấu phẩy cạnh tham chiếu ô là TÁCH ĐỐI SỐ", () => {
  it("=SUM(E1,E2) → 350000 (bản cũ 100000,25)", () => expect(tinh("=SUM(E1,E2)")).toBe(350000));
  it("=MAX(E3,E5) → 123.456", () => expect(tinh("=MAX(E3,E5)")).toBeCloseTo(123.456));
  it("=ROUND(G3,0) → 1235 (bản cũ 0)", () => expect(tinh("=ROUND(G3,0)")).toBe(1235));
  it("=SUM(E1:E2,E5) → 350007", () => expect(tinh("=SUM(E1:E2,E5)")).toBe(350007));
  it("$ tuyệt đối: =SUM($E$1,$E$2) → 350000", () => expect(tinh("=SUM($E$1,$E$2)")).toBe(350000));
});

describe("GRID-03 — giữ nguyên hành vi đúng", () => {
  it("=SUM(E1;E2) (Excel VN) → 350000", () => expect(tinh("=SUM(E1;E2)")).toBe(350000));
  it("=ROUND(G3;0) → 1235", () => expect(tinh("=ROUND(G3;0)")).toBe(1235));
  it("=E1*1,1 — dấu phẩy thập phân giữa hai CHỮ SỐ vẫn là thập phân", () => expect(tinh("=E1*1,1")).toBeCloseTo(110000));
  it("=5x3 và phần trăm", () => { expect(tinh("=5x3")).toBe(15); expect(tinh("=E1*8%")).toBe(8000); });
});

describe("GRID-03 — công thức lỗi trả null (nơi gọi tô đỏ), không bịa số", () => {
  it("sai cú pháp =E1* → null", () => expect(tinh("=E1*")).toBeNull());
  it("hàm lạ =TONG(E1;E2) → null", () => expect(tinh("=TONG(E1;E2)")).toBeNull());
  it("chia 0 =E1/0 → null", () => expect(tinh("=E1/0")).toBeNull());
  it("đối số không đọc được KHÔNG bị lọc bỏ im lặng: =SUM(1.5,2;3) → null", () => expect(evalFormula("=SUM(1.5,2;3)")).toBeNull());
});
