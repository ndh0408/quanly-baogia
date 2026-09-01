// `npm run verify` KHÔNG ĐƯỢC chạy lên hạ tầng thật.
//
// ── LỖI ─────────────────────────────────────────────────────────────────────
// `scripts/verify-local.sh` đặt mặc định bằng `: "${DATABASE_URL:=…}"`, tức nó CHỈ đặt khi biến
// CHƯA CÓ. Ai đang export DATABASE_URL của production trong shell — chuyện thường ngày: vừa chạy
// `prisma studio`, vừa soi một truy vấn, vừa deploy — rồi gõ `npm run verify` sẽ chạy TOÀN BỘ
// những thứ sau lên production:
//
//   · `prisma migrate deploy`                          — thao tác schema THẬT
//   · 165 file test                                    — tạo/xoá bản ghi, rất nhiều deleteMany
//   · `hangDoi.obliterate({ force: true })` (hq3-*)    — XOÁ SẠCH hàng đợi xuất file
//
// Không bước nào hỏi lại. Đây là MẤT DỮ LIỆU, không phải bất tiện. Và nó không cần ai bất cẩn:
// chỉ cần một biến còn sót trong shell từ việc trước đó.
//
// ── CHỐT ────────────────────────────────────────────────────────────────────
// Script đòi hạ tầng phải TRÔNG NHƯ hạ tầng test. CSDL phải thoả HAI điều kiện độc lập — máy chủ
// cục bộ VÀ tên có chữ "test" — vì mỗi cái một mình đều hụt:
//   · chỉ kiểm host → tunnel SSH tới prod qua 127.0.0.1 lọt;
//   · chỉ kiểm tên  → một CSDL tên "quanly_test" nằm trên máy chủ prod lọt.
// Redis và kho object cũng phải cục bộ (bộ test gọi obliterate và ghi/xoá object).
//
// Cửa thoát CÓ CHỦ Ý: `VERIFY_CHO_PHEP_HA_TANG_LA=1`. Ai thật sự cần thì gõ tường minh.
//
// ── VÌ SAO KIỂM BẰNG `--kiem-hatang` ────────────────────────────────────────
// Chốt nằm ở đầu một script chạy mất ~4 phút. `--kiem-hatang` chạy RIÊNG chốt rồi thoát, nên bài
// này kiểm được CẢ HAI chiều trong tích tắc — quan trọng: một chốt an toàn chỉ kiểm được một chiều
// ("có chặn") mà không kiểm chiều kia ("không chặn oan") thì sớm muộn ai đó nới nó ra cho đỡ vướng.
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

// `path.dirname` của một đường có dấu "/" cuối cắt mất một cấp — bản đầu ra /home/user thay vì
// gốc repo, và cả 10 bài đỏ vì "No such file or directory" chứ không phải vì chốt hỏng.
const GOC = path.resolve(fileURLToPath(import.meta.url), "../..");
const SCRIPT = path.join(GOC, "scripts/verify-local.sh");

const SACH = {
  DATABASE_URL: "postgresql://quanly:quanly_pwd@127.0.0.1:5432/quanly_test?schema=public",
  REDIS_URL: "redis://127.0.0.1:6379",
  S3_ENDPOINT: "http://127.0.0.1:9000",
  S3_BUCKET: "quanly-test",
};

/** Chạy RIÊNG chốt hạ tầng. Trả về { ma, ra } — không đụng CSDL, không chạy test nào. */
function chay(doiEnv = {}) {
  const r = spawnSync("bash", [SCRIPT, "--kiem-hatang"], {
    cwd: GOC,
    encoding: "utf8",
    timeout: 60_000,
    // env RỖNG + đúng những gì cần: không thừa hưởng biến của tiến trình vitest, nếu không bài này
    // đo nhầm môi trường chạy test thay vì đo chốt.
    env: { PATH: process.env.PATH, HOME: process.env.HOME, ...SACH, ...doiEnv },
  });
  return { ma: r.status, ra: `${r.stdout || ""}${r.stderr || ""}` };
}

describe("verify-local — CHẶN khi hạ tầng không trông như hạ tầng test", () => {
  const XAU = [
    ["CSDL trỏ thẳng máy chủ prod", { DATABASE_URL: "postgresql://u:p@db.gianguyen.cloud:5432/quanly" }],
    ["CSDL prod qua tunnel về 127.0.0.1 (host cục bộ nhưng tên thật)", { DATABASE_URL: "postgresql://u:p@127.0.0.1:5432/quanly?schema=public" }],
    ["tên có 'test' nhưng nằm trên máy chủ prod", { DATABASE_URL: "postgresql://u:p@db.gianguyen.cloud:5432/quanly_test" }],
    ["Redis trỏ prod (obliterate sẽ xoá sạch hàng đợi thật)", { REDIS_URL: "redis://redis.gianguyen.cloud:6379" }],
    ["kho object trỏ prod", { S3_ENDPOINT: "https://s3.gianguyen.cloud" }],
    ["bucket là bucket thật", { S3_BUCKET: "quanly" }],
  ];

  for (const [ten, env] of XAU) {
    it(`chặn: ${ten}`, () => {
      const { ma, ra } = chay(env);
      expect(ma, `LỌT QUA — lượt verify này sẽ ghi/xoá trên hạ tầng thật.\n${ra}`).not.toBe(0);
      expect(ra).toMatch(/hạ tầng KHÔNG trông như hạ tầng test/);
    });
  }

  it("lời nhắn chỉ ĐÚNG cách thoát, không bắt người ta đoán", () => {
    const { ra } = chay({ DATABASE_URL: "postgresql://u:p@prod.example:5432/quanly" });
    expect(ra, "phải chỉ cách chạy sạch").toMatch(/env -u DATABASE_URL/);
    expect(ra, "phải nêu tên biến cửa thoát").toMatch(/VERIFY_CHO_PHEP_HA_TANG_LA=1/);
    expect(ra, "phải chỉ cách tự soi shell của mình").toMatch(/env \| grep/);
  });
});

describe("verify-local — KHÔNG chặn oan", () => {
  // Chiều này quan trọng ngang chiều kia: một chốt hay báo động giả sẽ bị người ta nới ra.
  it("hạ tầng test mặc định đi qua", () => {
    const { ma, ra } = chay();
    expect(ma, `chặn oan hạ tầng test hợp lệ:\n${ra}`).toBe(0);
  });

  it("cửa thoát tường minh có tác dụng", () => {
    const { ma } = chay({
      VERIFY_CHO_PHEP_HA_TANG_LA: "1",
      DATABASE_URL: "postgresql://u:p@ngoai.example:5432/gido",
      REDIS_URL: "redis://ngoai.example:6379",
    });
    expect(ma, "cửa thoát không hoạt động → người có lý do chính đáng sẽ gỡ hẳn chốt").toBe(0);
  });

  it("localhost và [::1] cũng được coi là cục bộ, không chỉ 127.0.0.1", () => {
    expect(chay({ DATABASE_URL: "postgresql://u:p@localhost:5432/quanly_test" }).ma).toBe(0);
    expect(chay({ DATABASE_URL: "postgresql://u:p@[::1]:5432/quanly_test" }).ma).toBe(0);
  });
});
