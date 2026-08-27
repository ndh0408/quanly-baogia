// §30 + Phụ lục §8 — CHƯA làm SSO, nhưng KHÔNG ĐƯỢC CHẶN ĐƯỜNG tới OIDC.
//
// Prompt nói hai điều cùng lúc: "không chuyển sang SSO nếu business chưa cần" VÀ "không được thiết
// kế auth khiến sau này không thể thêm SSO". Vế thứ hai là một tính chất KIẾN TRÚC — nó không có
// mã nào để chỉ vào, nên rất dễ mất mà không ai thấy.
//
// Quyết định và lý do: docs/adr/0007-san-sang-cho-oidc.md.
// File này biến ba tính chất trong ADR đó thành ba bài test, để chúng không chỉ là lời hứa.
//
// ── ĐÂY LÀ BÀI ĐỌC MÃ NGUỒN ────────────────────────────────────
// Không thể kiểm "sau này thêm OIDC được không" bằng cách chạy. Ba bài dưới đây kiểm HÌNH DẠNG của
// mã — hẹp, cụ thể, và mỗi bài chặn đúng MỘT cách làm hỏng tính chất tương ứng. Chúng KHÔNG chứng
// minh OIDC sẽ chạy được; xem mục "Rủi ro còn lại" ở cuối ADR.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const GOC = path.resolve(new URL(".", import.meta.url).pathname, "..");
const doc = (p) => readFileSync(path.join(GOC, p), "utf8");
const boChuThich = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

describe("tính chất 1 — cấp phiên TÁCH khỏi việc xác minh mật khẩu", () => {
  const src = boChuThich(doc("src/services/authService.ts"));

  it("`establishSession` nhận SessionSeed, không nhận mật khẩu", () => {
    const m = src.match(/export async function establishSession\(([^)]*)\)/);
    expect(m, "không còn hàm establishSession — lớp cấp phiên đã bị gộp đi đâu?").not.toBeNull();
    expect(m[1], "chữ ký nhận SessionSeed").toMatch(/SessionSeed/);
    expect(m[1].toLowerCase(), "nhận mật khẩu ⇒ cấp phiên đã dính vào MỘT cách xác thực")
      .not.toMatch(/password|matkhau|credential/);
  });

  it("thân hàm KHÔNG so mật khẩu, KHÔNG gọi bcrypt", () => {
    // Đây là cách hỏng dễ xảy ra nhất: "tiện tay" nhét việc kiểm mật khẩu vào hàm cấp phiên.
    // Làm thế thì callback OIDC không dùng lại được nó nữa.
    const i = src.indexOf("export async function establishSession");
    const than = src.slice(i, src.indexOf("\nexport ", i + 10));
    expect(than).not.toMatch(/bcrypt|compare\(|passwordHash/);
  });

  it("có ÍT NHẤT BA nguồn gọi nó, và chúng xác minh danh tính KHÁC NHAU", () => {
    // Một hàm chỉ có một caller thì "tách rời" là chưa được chứng minh. Ba caller với ba cách xác
    // minh khác nhau (mật khẩu · token mời · phiên đang có) mới là bằng chứng.
    const noiGoi = [];
    for (const f of ["src/services/authService.ts", "src/routes/auth.routes.ts"]) {
      const s = boChuThich(doc(f));
      for (const _ of s.matchAll(/\bestablishSession\(/g)) noiGoi.push(f);
    }
    // Trừ đi chính dòng khai báo trong authService.
    const soGoi = noiGoi.length - 1;
    expect(soGoi, `chỉ ${soGoi} nơi gọi establishSession — tính tách rời chưa được chứng minh`)
      .toBeGreaterThanOrEqual(3);
  });
});

describe("tính chất 2 — phân quyền KHÔNG phụ thuộc cách đăng nhập", () => {
  const perm = boChuThich(doc("src/permissions.ts"));

  it("permissions.ts đọc role/permissions của phiên, không hỏi 'đăng nhập bằng gì'", () => {
    expect(perm, "không còn đọc quyền từ phiên?").toMatch(/session\??\.(permissions|role)/);
    // IdP cấp DANH TÍNH; RBAC vẫn của hệ thống này (sơ đồ §30: IdP → OIDC → application user → RBAC).
    expect(perm, "phân quyền rẽ nhánh theo cách đăng nhập ⇒ thêm OIDC là phải sửa RBAC")
      .not.toMatch(/loginMethod|authMethod|viaPassword|viaOidc|isOidc|provider\s*===/);
  });
});

describe("tính chất 3 — lối vào khẩn cấp còn nguyên", () => {
  it("BREAK_GLASS_EMAILS vẫn có trong schema cấu hình", () => {
    // §30 đòi giữ đường đăng nhập nội bộ khi IdP chết. Cơ chế đã có — việc cần làm là ĐỪNG GỠ.
    expect(boChuThich(doc("src/config.ts"))).toMatch(/BREAK_GLASS_EMAILS/);
  });
});

describe("trạng thái hiện tại đúng như ADR khai", () => {
  it("CHƯA có mã OIDC nào — ADR nói 'chưa triển khai', đừng để nó lệch", () => {
    // Nếu ai đó BẮT ĐẦU thêm OIDC thật, bài này đỏ và buộc phải cập nhật ADR 0007 — đó là ý đồ.
    const nguon = [];
    const quet = (d) => {
      for (const e of readdirSync(path.join(GOC, d), { withFileTypes: true })) {
        if (e.name === "node_modules") continue;
        if (e.isDirectory()) quet(path.join(d, e.name));
        else if (/\.ts$/.test(e.name)) nguon.push(path.join(d, e.name));
      }
    };
    quet("src");
    const dinh = nguon.filter((f) => /\b(oidc|openid|entra|keycloak|okta|saml)\b/i.test(boChuThich(doc(f))));
    expect(dinh, `mã OIDC đã xuất hiện ở ${dinh.join(", ")} — cập nhật docs/adr/0007-san-sang-cho-oidc.md`)
      .toEqual([]);
  });
});
