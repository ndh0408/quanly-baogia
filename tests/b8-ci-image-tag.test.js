// Bản phát hành chỉ được mang tag BẤT BIẾN.
//
// ── ĐO TRƯỚC KHI VIẾT ────────────────────────────────────────────────────────
// `latest` đã bị bỏ khỏi metadata-action, nhưng `type=ref,event=branch` vẫn còn — và job
// build-image chỉ chạy khi ref là master/main (.github/workflows/ci.yml, `if:` của job). Nghĩa là
// registry vẫn nhận đúng một tag DI ĐỘNG: `ghcr.io/<repo>:master`, đổi nội dung sau mỗi lần merge.
// Đó chính là cái bẫy mà chú thích ngay trên nó ("Chỉ tag BẤT BIẾN") tự nhận là không được phép,
// và chốt Helm không bắt được: infra/helm/quanly/templates/_helpers.tpl chỉ từ chối ĐÚNG CHUỖI
// "latest", nên `--set image.tag=master` render bình thường.
//
// tests/ic-infra-compose.test.js chỉ chốt `.not.toMatch(/type=raw,value=latest/)` — đúng tên cũ,
// không đúng bản chất. Bài test này chốt bản chất: KHÔNG tag di động nào, dù tên là gì.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const ci = readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf8");

/** Khối `tags: |` của docker/metadata-action (thụt sâu hơn, tới dòng bớt thụt đầu tiên). */
function khoiTags() {
  const i = ci.indexOf("          tags: |");
  expect(i, "không tìm thấy khối tags: | của metadata-action").toBeGreaterThan(-1);
  const dong = ci.slice(i).split(/\r?\n/).slice(1);
  const ra = [];
  for (const d of dong) {
    if (d.trim() === "") continue;
    if (!/^ {12}/.test(d)) break; // hết khối
    ra.push(d.trim());
  }
  return ra;
}

describe("CI: image đẩy lên registry", () => {
  it("chỉ sinh tag BẤT BIẾN — không tag di động nào", () => {
    const tags = khoiTags().filter((d) => !d.startsWith("#"));
    expect(tags.length, "khối tags rỗng — không tìm đúng chỗ").toBeGreaterThan(0);

    // `type=sha` (digest git) là bất biến. Mọi type còn lại đều trỏ vào một cái tên có thể được
    // ghi đè: ref/branch → `:master`, ref/tag → có thể force-push, raw/latest → kinh điển.
    const diDong = tags.filter((t) => !/^type=sha\b/.test(t));
    expect(
      diDong,
      `Tag di động trong metadata-action: ${diDong.join(", ")}.\n` +
        `Registry chỉ được nhận tag bất biến; deploy đi bằng digest (xem bước "Ghi lại digest bất biến").`
    ).toEqual([]);
  });

  it("vẫn còn ít nhất một tag để đẩy (không xoá sạch thành job vô nghĩa)", () => {
    expect(khoiTags().some((t) => /^type=sha\b/.test(t))).toBe(true);
  });
});
