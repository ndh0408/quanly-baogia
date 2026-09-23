/**
 * OPS · DEP-02 / DOC-03 — ba cổng của verify-local KHÔNG chạy trên Windows mà vẫn báo xanh.
 *
 * LỖI: check-deps.mjs, check-shell-strict.mjs, gen-changelog.mjs gọi main() khi
 *   `import.meta.url === \`file://${process.argv[1]}\``. Trên Windows argv[1] = `D:\QuanLY\…`,
 *   import.meta.url = `file:///D:/QuanLY/…` → không bao giờ bằng → main() không chạy → exit 0, stdout
 *   RỖNG → verify-local in ✓. Đo được: chạy đúng cách thì check-shell-strict ĐỎ
 *   (alertmanager-entrypoint.sh thiếu pipefail) và CHANGELOG.md đã bị xoá trắng ở commit 0065eab
 *   (`gen-changelog.mjs > CHANGELOG.md` trên Windows ghi ra 0 byte) mà `--check` vẫn báo đạt.
 *
 * CÁCH KIỂM: gọi script bằng đường dẫn TUYỆT ĐỐI KIỂU NỀN TẢNG (path.resolve — trên Windows là
 * `D:\…`, đúng thứ verify-local truyền) và đòi phải CÓ đầu ra. Guard hỏng thì im lặng; im lặng chính
 * là tín hiệu cần bắt.
 */
import { describe, it, expect } from "vitest";
import { spawnSync, execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { kiemChangelog } from "../scripts/ci/gen-changelog.mjs";

const GOC = path.resolve(import.meta.dirname, "..");

describe("guard `main()` của script CI chạy được trên Windows", () => {
  for (const f of ["scripts/ci/check-deps.mjs", "scripts/ci/check-shell-strict.mjs", "scripts/ci/gen-changelog.mjs"]) {
    it(`${f} --check in ra kết luận (không im lặng)`, () => {
      const r = spawnSync(process.execPath, [path.resolve(GOC, f), "--check"], { cwd: GOC, encoding: "utf8" });
      expect((r.stdout + r.stderr).trim(), `${f} không in gì — main() không chạy, cổng xanh giả`).not.toBe("");
    });
  }

  it("không còn script nào trong scripts/ dùng mẫu `file://${process.argv[1]}`", () => {
    const tep = execFileSync("git", ["ls-files", "scripts/*.mjs", "scripts/**/*.mjs"], { cwd: GOC, encoding: "utf8" }).split("\n").filter(Boolean);
    const xau = tep.filter((f) => readFileSync(path.join(GOC, f), "utf8").includes("`file://${process.argv[1]}`"));
    expect(xau).toEqual([]);
  });
});

describe("gen-changelog --check", () => {
  const log = ["abc1234|2026-09-20|feat: một", "def5678|2026-09-21|fix: hai"];

  it("CHANGELOG rỗng → 0 mục (main() coi là HỎNG, không phải 'đi sau')", () => {
    expect(kiemChangelog("", log).coTrongFile.size).toBe(0);
  });

  it("mục bịa và tiêu đề sửa tay bị bắt", () => {
    const r = kiemChangelog("- `abc1234` feat: MỘT\n- `9999999` bịa\n", log);
    expect(r.bia).toEqual(["9999999"]);
    expect(r.lech.length).toBe(1);
  });

  it("CHANGELOG.md trong repo không rỗng và không có mục bịa", () => {
    const r = spawnSync(process.execPath, [path.resolve(GOC, "scripts/ci/gen-changelog.mjs"), "--check"], { cwd: GOC, encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);
  });
});
