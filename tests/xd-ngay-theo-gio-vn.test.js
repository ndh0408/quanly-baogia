// XLSX-11 — ngày trên tệp xuất tính theo múi giờ của TIẾN TRÌNH (container chạy UTC): báo giá tạo/nhân
// bản lúc 00:00–06:59 giờ VN (quoteDate = new Date() → 17:00–23:59Z hôm trước) in lùi một ngày.
// Kiểm trong tiến trình con TZ=UTC — đúng môi trường production; máy dev Windows ở +7 che mất lỗi.
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { homNayVN, ngayThangNamVN } from "../src/vnTime.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function chayUTC(ma) {
  return execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", ma], {
    cwd: ROOT, encoding: "utf8", env: { ...process.env, TZ: "UTC" },
  }).trim();
}

describe("XLSX-11: ngày theo lịch VN", () => {
  it("vnDateText(22/09 23:30Z) trong tiến trình UTC → 'ngày 23 tháng 09'", () => {
    const out = chayUTC(`const { vnDateText } = await import(${JSON.stringify(pathToFileURL(path.join(ROOT, "src/excel.ts")).href)}); process.stdout.write(vnDateText(new Date("2026-09-22T23:30:00Z"), "HCM"));`);
    expect(out).toContain("ngày 23 tháng 09 năm 2026");
  });

  it("ngày nhập từ web ('YYYY-MM-DD' → 00:00Z) giữ nguyên như trước", () => {
    const out = chayUTC(`const { vnDateText } = await import(${JSON.stringify(pathToFileURL(path.join(ROOT, "src/excel.ts")).href)}); process.stdout.write(vnDateText(new Date("2026-06-13"), "HCM"));`);
    expect(out).toBe("HCM, ngày 13 tháng 06 năm 2026");
  });

  it("homNayVN lúc 06:30 giờ VN (23:30Z hôm trước) → 00:00Z của ngày VN", () => {
    expect(homNayVN(new Date("2026-09-22T23:30:00Z")).toISOString()).toBe("2026-09-23T00:00:00.000Z");
    expect(ngayThangNamVN("2026-09-22T16:59:59Z")).toEqual({ ngay: 22, thang: 9, nam: 2026 });
    expect(ngayThangNamVN("2026-09-22T17:00:00Z")).toEqual({ ngay: 23, thang: 9, nam: 2026 });
  });
});
