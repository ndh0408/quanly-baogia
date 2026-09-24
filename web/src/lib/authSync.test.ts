// FE-05: đồng bộ đăng nhập/đăng xuất giữa các tab + đăng xuất lỗi mạng không được giả vờ đã thoát.
// Node có sẵn BroadcastChannel toàn cục (cùng API với trình duyệt), nên đi đúng đường kênh thật.
import { describe, it, expect, vi } from "vitest";
import { canNapLai, ngheAuth, phatDangNhap, phatDangXuat, dangXuat } from "./authSync";

const cho = (ms = 30) => new Promise((r) => setTimeout(r, ms));

describe("FE-05 — tab khác đổi danh tính thì tab này nạp lại", () => {
  it("canNapLai: logout → có; login người khác → có; login cùng người → không; chưa đăng nhập → không", () => {
    expect(canNapLai({ type: "logout" }, 1)).toBe(true);
    expect(canNapLai({ type: "login", userId: 2 }, 1)).toBe(true);
    expect(canNapLai({ type: "login", userId: 1 }, 1)).toBe(false);
    expect(canNapLai({ type: "login", userId: 2 }, null)).toBe(false);
    expect(canNapLai("rác", 1)).toBe(false);
  });

  it("qua kênh THẬT: tab khác đăng nhập user 2 → tab đang là user 1 gọi nạp lại", async () => {
    const napLai = vi.fn();
    const huy = ngheAuth(() => 1, napLai);
    try {
      phatDangNhap(1);
      await cho();
      expect(napLai).not.toHaveBeenCalled();
      phatDangNhap(2);
      await cho();
      expect(napLai).toHaveBeenCalledTimes(1);
      phatDangXuat();
      await cho();
      expect(napLai).toHaveBeenCalledTimes(2);
    } finally { huy(); }
  });

  it("tab khác đăng nhập lại CÙNG người → gọi songLai (gỡ chặn + đóng lớp phủ), KHÔNG nạp lại — diễn tập 2026-09-25", async () => {
    const napLai = vi.fn();
    const songLai = vi.fn();
    const huy = ngheAuth(() => 1, napLai, songLai);
    try {
      phatDangNhap(1);
      await cho();
      expect(songLai).toHaveBeenCalledTimes(1);
      expect(napLai).not.toHaveBeenCalled();
      phatDangNhap(2);
      await cho();
      expect(napLai).toHaveBeenCalledTimes(1);
      expect(songLai, "người KHÁC thì nạp lại sạch, không 'sống lại'").toHaveBeenCalledTimes(1);
    } finally { huy(); }
  });
});

// Dây nối: hàm thuần đúng mà App/Shell không gọi thì vô nghĩa. Cùng cách với App.draftleak.test.ts
// (đọc mã nguồn qua ?raw — web/ không có jsdom cho App đầy đủ ở bài này).
import appSrc from "../App.tsx?raw";
import shellSrc from "../components/Shell.tsx?raw";
describe("FE-05 — dây nối trong App / Shell", () => {
  it("App nghe kênh auth và phát tin khi đăng nhập", () => {
    expect(appSrc).toMatch(/ngheAuth\(/);
    expect(appSrc).toMatch(/phatDangNhap\(/);
  });
  it("App: tab khác đăng nhập lại cùng người → gỡ chặn lời gọi (phienSongLai) và đóng lớp phủ", () => {
    expect(appSrc).toMatch(/ngheAuth\([^;]*phienSongLai\(\);\s*setMatPhien\(false\)/);
  });
  it("Shell: nút Đăng xuất chỉ nạp lại khi dangXuat() thành công, và phát tin cho tab khác", () => {
    const i = shellSrc.indexOf('className="logout"');
    const nut = shellSrc.slice(i, shellSrc.indexOf("</button>", i));
    expect(nut).toMatch(/if \(!\(await dangXuat\([\s\S]*?\)\)\) \{[\s\S]*?return; \}[\s\S]*phatDangXuat\(\)[\s\S]*location\.reload\(\)/);
    expect(nut).not.toMatch(/catch \{ \/\* ignore \*\/ \}/);
  });
});

describe("FE-05 — đăng xuất", () => {
  it("lỗi mạng → CHƯA đăng xuất (không được nạp lại như đã thoát)", async () => {
    expect(await dangXuat(async () => { throw new TypeError("Failed to fetch"); })).toBe(false);
    expect(await dangXuat(async () => { throw Object.assign(new Error("500"), { status: 500 }); })).toBe(false);
  });
  it("thành công, hoặc 401 (phiên vốn đã chết) → coi là đã đăng xuất", async () => {
    expect(await dangXuat(async () => ({}))).toBe(true);
    expect(await dangXuat(async () => { throw Object.assign(new Error("401"), { status: 401 }); })).toBe(true);
  });
});
