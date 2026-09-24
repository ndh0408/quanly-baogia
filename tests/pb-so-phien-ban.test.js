// SỐ PHIÊN BẢN CHO NGƯỜI DÙNG — scripts/phien-ban.mjs (chủ repo 2026-09-25: "phiên bản đừng kiểu dãy
// chữ… người sử dụng có biết đâu… có quy tắc riêng cho từng số nào tăng").
//
// Quy tắc (đầu scripts/phien-ban.mjs):
//   · SỐ CUỐI tăng khi lần phát hành chỉ SỬA LỖI / chỉnh nhỏ
//   · SỐ GIỮA tăng khi có TÍNH NĂNG MỚI (commit feat:), số cuối về 0
//   · SỐ ĐẦU chỉ tăng khi chủ repo bật cờ (PHIEN_BAN_LON=1)
//   · tag trước là bản thử (v1.1.0-rc.1) → lần phát hành kế là chính số đó (1.1.0)
// Và script CHỈ ĐỌC git — gắn tag là việc của deploy.sh (xem chú thích đầu script vì sao).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const { phanTichSo, laTinhNang, soKeTiep, ghiChuPhatHanh } = await import("../scripts/phien-ban.mjs");

describe("quy tắc tăng số", () => {
  it("chỉ sửa lỗi / chỉnh nhỏ → tăng SỐ CUỐI", () => {
    expect(soKeTiep("v1.2.3", ["fix: sửa ô công thức", "docs: README", "chore: dọn"])).toBe("1.2.4");
  });
  it("có ít nhất một tính năng mới → tăng SỐ GIỮA, số cuối về 0", () => {
    expect(soKeTiep("v1.2.3", ["fix: a", "feat(web): kéo đổi thứ tự sheet", "fix: b"])).toBe("1.3.0");
    expect(soKeTiep("v1.2.3", ["feat!: đổi lớn nhưng chủ repo chưa bật cờ"]), "số đầu KHÔNG tự tăng").toBe("1.3.0");
  });
  it("SỐ ĐẦU chỉ tăng khi chủ repo bật cờ", () => {
    expect(soKeTiep("v1.9.4", ["fix: a"], { lon: true })).toBe("2.0.0");
  });
  it("tag trước là bản thử → phát hành chính số đó", () => {
    expect(soKeTiep("v1.1.0-rc.1", ["feat: x", "fix: y"])).toBe("1.1.0");
  });
  it("không commit nào kể từ tag → giữ nguyên (deploy lại cùng bản)", () => {
    expect(soKeTiep("v1.4.0", [])).toBe("1.4.0");
  });
  it("chưa có tag nào → tính như sau 1.0.0", () => {
    expect(soKeTiep("", ["fix: a"])).toBe("1.0.1");
    expect(soKeTiep(null, ["feat: a"])).toBe("1.1.0");
  });
  it("nhận ra tính năng theo Conventional Commits", () => {
    for (const t of ["feat: a", "feat(web): a", "feat!: a", "FEAT: a"]) expect(laTinhNang(t), t).toBe(true);
    for (const t of ["fix: a", "merge: báo 'Có bản mới'", "docs: feat nằm giữa câu", "feature: không phải tiền tố chuẩn"]) expect(laTinhNang(t), t).toBe(false);
  });
  it("phanTichSo: số ba phần (có hoặc không 'v', có đuôi bản thử); thứ khác → null", () => {
    expect(phanTichSo("v1.1.0-rc.1")).toEqual({ chinh: 1, phu: 1, va: 0, truoc: "rc.1" });
    expect(phanTichSo("2.0.3")).toEqual({ chinh: 2, phu: 0, va: 3, truoc: null });
    expect(phanTichSo("9dd30dc")).toBeNull();
    expect(phanTichSo("")).toBeNull();
  });
});

describe("ghi chú kèm tag", () => {
  it("nhóm Tính năng mới / Sửa lỗi, bỏ tiền tố feat:/fix:, bỏ commit merge", () => {
    const g = ghiChuPhatHanh("1.3.0", ["feat(web): kéo đổi thứ tự sheet", "fix: nhập 3,4", "merge: nhánh keo-sheet"], new Date(2026, 8, 25));
    expect(g).toMatch(/^Phiên bản 1\.3\.0 \(25\/09\/2026\)/);
    expect(g).toContain("Tính năng mới:\n- kéo đổi thứ tự sheet");
    expect(g).toContain("Sửa lỗi / chỉnh sửa:\n- nhập 3,4");
    expect(g).not.toContain("merge");
  });
});

describe("chạy thật trên lịch sử repo", () => {
  it("--so in đúng một số ba phần; --da-gan in 0 hoặc 1", () => {
    const so = execFileSync(process.execPath, [join(ROOT, "scripts/phien-ban.mjs"), "--so"], { cwd: ROOT, encoding: "utf8" }).trim();
    expect(so).toMatch(/^\d+\.\d+\.\d+$/);
    const daGan = execFileSync(process.execPath, [join(ROOT, "scripts/phien-ban.mjs"), "--da-gan"], { cwd: ROOT, encoding: "utf8" }).trim();
    expect(["0", "1"]).toContain(daGan);
  });
  it("script CHỈ ĐỌC git — không có lệnh gắn/xoá/đẩy tag nào (bộ test deploy trên Windows gọi git THẬT qua Node)", () => {
    const ma = readFileSync(join(ROOT, "scripts/phien-ban.mjs"), "utf8").replace(/^\s*\/\/.*$/gm, "");
    expect(ma).not.toMatch(/["']tag["']\s*,\s*["']-[ad]["']/);
    expect(ma).not.toMatch(/["']push["']/);
  });
});
