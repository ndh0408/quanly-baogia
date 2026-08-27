// BÍ MẬT ĐỌC TỪ FILE — quy ước `<TÊN>_FILE`.
//
// ── VÌ SAO CÓ TÍNH NĂNG NÀY ─────────────────────────────────────────────────
// src/config.ts đọc DUY NHẤT `process.env`, nên mọi bí mật phải nằm trong biến môi trường — nơi
// `docker inspect` in ra nguyên vẹn, `/proc/<pid>/environ` đọc được, và mọi tiến trình con đều
// kế thừa. Quy ước `_FILE` là đường để Docker secrets / Kubernetes Secret volume / Vault Agent
// đưa bí mật vào bằng FILE thay vì bằng env.
//
// ── BÀI NÀY KHOÁ ĐIỀU GÌ ────────────────────────────────────────────────────
// Không phải "tính năng có chạy không" — mà là BỐN QUYẾT ĐỊNH ĐÓNG của nó. Mỗi quyết định đều có
// một phiên bản "dễ chịu hơn" mà người sau rất dễ đổi sang, và mỗi phiên bản dễ chịu đó đều tạo ra
// một lỗi im lặng:
//   · đặt cả hai → im lặng chọn một bên  ⇒ xoay khoá xong mà tiến trình vẫn chạy giá trị cũ;
//   · file thiếu → bỏ qua                ⇒ bí mật "tắt êm", đúng bẫy PII_ENC_KEY đã gặp;
//   · file rỗng  → chấp nhận             ⇒ chạy với khoá rỗng, volume gắn hụt mà không ai biết;
//   · dùng trim() → cắt cả dấu cách cuối ⇒ khoá base64/mật khẩu kết thúc bằng dấu cách bị hỏng.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, chmodSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { napBiMatTuFile } from "../src/secretFiles.js";

let thuMuc;
beforeEach(() => { thuMuc = mkdtempSync(path.join(tmpdir(), "bi-mat-")); });
afterEach(() => { rmSync(thuMuc, { recursive: true, force: true }); });

// Quy ước `*_FILE` CHỈ áp cho khoá cấu hình của ứng dụng (schema zod ở src/config.ts). Bài test
// truyền danh sách tường minh — không có mặc định "mọi tên", vì chính mặc định đó là lỗi mà bộ
// test bên dưới ("KHÔNG đụng biến _FILE của hệ sinh thái") sinh ra để chặn.
const KHOA = ["SESSION_SECRET", "JWT_SECRET", "PII_ENC_KEY", "MFA_ENC_KEY", "SMTP_PASS", "A", "B", "C", "X"];
const nap = (env, khoa = KHOA) => napBiMatTuFile(env, khoa);

/** Ghi một file bí mật, trả đường dẫn. */
const ghi = (ten, noiDung) => {
  const p = path.join(thuMuc, ten);
  writeFileSync(p, noiDung);
  return p;
};

describe("nạp được", () => {
  it("đặt biến từ nội dung file", () => {
    const env = { SESSION_SECRET_FILE: ghi("sess", "abc123-du-dai-cho-production") };
    const ra = nap(env);
    expect(env.SESSION_SECRET).toBe("abc123-du-dai-cho-production");
    expect(ra).toEqual([{ ten: "SESSION_SECRET", duongDan: env.SESSION_SECRET_FILE }]);
  });

  it("KHÔNG trả về giá trị bí mật trong kết quả (kết quả này đi vào log khởi động)", () => {
    const env = { JWT_SECRET_FILE: ghi("jwt", "gia-tri-tuyet-mat") };
    const ra = nap(env);
    expect(JSON.stringify(ra), "giá trị bí mật lọt vào thứ được in ra log").not.toContain("gia-tri-tuyet-mat");
  });

  it("nạp nhiều biến một lượt, thứ tự tất định", () => {
    const env = {
      PII_ENC_KEY_FILE: ghi("pii", "khoa-pii"),
      MFA_ENC_KEY_FILE: ghi("mfa", "khoa-mfa"),
      SMTP_PASS_FILE: ghi("smtp", "mat-khau-smtp"),
    };
    const ra = nap(env);
    expect(ra.map((x) => x.ten)).toEqual(["MFA_ENC_KEY", "PII_ENC_KEY", "SMTP_PASS"]);
    expect(env.PII_ENC_KEY).toBe("khoa-pii");
    expect(env.MFA_ENC_KEY).toBe("khoa-mfa");
    expect(env.SMTP_PASS).toBe("mat-khau-smtp");
  });

  it("biến KHÔNG có hậu tố _FILE thì không đụng tới", () => {
    const env = { NODE_ENV: "production", PORT: "3000" };
    expect(nap(env)).toEqual([]);
    expect(env).toEqual({ NODE_ENV: "production", PORT: "3000" });
  });
});

describe("KHÔNG đụng tới biến _FILE của hệ sinh thái", () => {
  // ── HỒI QUY CHO ĐÚNG LỖI ĐÃ XẢY RA ────────────────────────────────────────
  // Bản đầu của `napBiMatTuFile` nhận MỌI biến kết thúc bằng `_FILE`. Nhưng hậu tố đó không thuộc
  // về repo này: cả một hệ sinh thái công cụ dùng nó với nghĩa "đường dẫn tới một file", KHÔNG
  // phải "đọc file này thành biến kia". Đo trên chính máy chạy repo: `env | grep _FILE=` ra NĂM
  // biến như vậy, trong đó `SSL_CERT_FILE` là biến CHUẨN của OpenSSL — có mặt trên mọi máy sau
  // proxy doanh nghiệp, mọi hệ Nix, mọi máy cài gcloud SDK.
  // Hậu quả đo được: `npm run verify` ĐỎ 25 bài, ứng dụng TỪ CHỐI KHỞI ĐỘNG.
  // Nay phạm vi là danh sách khoá của schema zod. Bài dưới khoá lại điều đó.
  const NGOAI = [
    "SSL_CERT_FILE",
    "NIX_SSL_CERT_FILE",
    "CLOUDSDK_CORE_CUSTOM_CA_CERTS_FILE",
    "CLAUDE_CODE_DIAGNOSTICS_FILE",
    "CLAUDE_SESSION_INGRESS_TOKEN_FILE",
  ];

  for (const ten of NGOAI) {
    it(`${ten} bị BỎ QUA, không nạp và không ném`, () => {
      // Trỏ vào một file CÓ THẬT: nếu hàm còn nhận biến này thì nó sẽ nạp thành công và ta thấy
      // ngay qua kết quả trả về — chứ không phải chỉ "không ném".
      const env = { [ten]: ghi("that", "noi-dung-that") };
      expect(nap(env)).toEqual([]);
      expect(env[ten.replace(/_FILE$/, "")], "đã nạp một biến KHÔNG thuộc cấu hình ứng dụng").toBeUndefined();
    });

    it(`${ten} trỏ vào file KHÔNG tồn tại cũng không được làm chết tiến trình`, () => {
      // Đây mới là ca đã làm 25 bài đỏ: biến tồn tại nhưng file không hợp lệ theo cách hiểu của ta.
      expect(() => nap({ [ten]: "/khong/co/duong/dan/nay" })).not.toThrow();
    });
  }

  it("bí mật THẬT vẫn nạp bình thường khi đứng chung với đám biến ngoài", () => {
    const env = {
      SSL_CERT_FILE: "/etc/ssl/certs/ca-certificates.crt",
      NIX_SSL_CERT_FILE: "/khong/co",
      SESSION_SECRET_FILE: ghi("s", "bi-mat-that"),
    };
    expect(nap(env).map((x) => x.ten)).toEqual(["SESSION_SECRET"]);
    expect(env.SESSION_SECRET).toBe("bi-mat-that");
  });

  it("gõ sai tên khoá thì bị bỏ qua ở đây — nhưng zod vẫn kêu vì thiếu biến thật", () => {
    // Không im lặng: `SESSION_SECRET` vẫn thiếu và src/config.ts từ chối khởi động kèm đúng tên.
    const env = { SESSION_SECRETT_FILE: ghi("s", "x") };
    expect(nap(env)).toEqual([]);
    expect(env.SESSION_SECRETT).toBeUndefined();
  });
});

describe("xuống dòng cuối file", () => {
  // `echo "bi-mat" > f` để lại "\n". Cắt ĐÚNG MỘT dấu, không dùng trim().
  it("cắt một \\n cuối", () => {
    const env = { A_FILE: ghi("a", "bi-mat\n") };
    nap(env);
    expect(env.A).toBe("bi-mat");
  });

  it("cắt \\r\\n của Windows", () => {
    const env = { A_FILE: ghi("a", "bi-mat\r\n") };
    nap(env);
    expect(env.A).toBe("bi-mat");
  });

  it("GIỮ dấu cách cuối — trim() sẽ ăn mất và làm hỏng khoá", () => {
    const env = { A_FILE: ghi("a", "khoa-co-dau-cach \n") };
    nap(env);
    expect(env.A, "dùng trim() thì khoá bị đổi và xác thực hỏng với lỗi không lần ra được")
      .toBe("khoa-co-dau-cach ");
  });

  it("GIỮ xuống dòng ở GIỮA (khoá riêng PEM nhiều dòng)", () => {
    const pem = "-----BEGIN KEY-----\ndong1\ndong2\n-----END KEY-----\n";
    const env = { A_FILE: ghi("a", pem) };
    nap(env);
    expect(env.A).toBe("-----BEGIN KEY-----\ndong1\ndong2\n-----END KEY-----");
  });

  it("chỉ cắt MỘT dấu, file kết thúc bằng hai \\n thì còn lại một", () => {
    const env = { A_FILE: ghi("a", "bi-mat\n\n") };
    nap(env);
    expect(env.A).toBe("bi-mat\n");
  });
});

describe("mọi trường hợp mơ hồ đều là LỖI, không đoán", () => {
  it("đặt CẢ biến lẫn biến _FILE → ném, và nói rõ vì sao", () => {
    const env = { SESSION_SECRET: "tu-env", SESSION_SECRET_FILE: ghi("s", "tu-file") };
    expect(() => nap(env)).toThrowError(/CẢ SESSION_SECRET lẫn SESSION_SECRET_FILE/);
  });

  it("biến RỖNG vẫn tính là 'đã đặt' — đó là ca mơ hồ nhất", () => {
    // `FOO=""` trong compose là chuyện rất thường (biến gốc chưa đặt). Nếu coi rỗng là "chưa đặt"
    // thì file sẽ được nạp đè, và người vận hành tưởng env đang thắng.
    const env = { SESSION_SECRET: "", SESSION_SECRET_FILE: ghi("s", "tu-file") };
    expect(() => nap(env)).toThrowError(/CẢ SESSION_SECRET/);
  });

  it("file KHÔNG tồn tại → ném, không bỏ qua", () => {
    const env = { PII_ENC_KEY_FILE: path.join(thuMuc, "khong-co-file-nay") };
    expect(() => nap(env)).toThrowError(/không tồn tại/);
  });

  it("file RỖNG → ném (volume gắn hụt / Vault chưa ghi xong)", () => {
    const env = { PII_ENC_KEY_FILE: ghi("rong", "") };
    expect(() => nap(env)).toThrowError(/RỖNG/);
  });

  it("file chỉ có mỗi xuống dòng cũng là RỖNG", () => {
    const env = { PII_ENC_KEY_FILE: ghi("nl", "\n") };
    expect(() => nap(env)).toThrowError(/RỖNG/);
  });

  it("_FILE trỏ vào THƯ MỤC → nói rõ, vì đây là lỗi hay gặp khi gắn Secret của k8s", () => {
    const d = path.join(thuMuc, "thu-muc");
    mkdirSync(d);
    const env = { PII_ENC_KEY_FILE: d };
    expect(() => nap(env)).toThrowError(/THƯ MỤC/);
  });

  it("_FILE đặt nhưng để trống đường dẫn → ném", () => {
    expect(() => nap({ PII_ENC_KEY_FILE: "" })).toThrowError(/RỖNG/);
    expect(() => nap({ PII_ENC_KEY_FILE: "   " })).toThrowError(/RỖNG/);
  });

  it("gộp MỌI lỗi vào một thông điệp, không dừng ở cái đầu tiên", () => {
    // Người vận hành sửa xong một lỗi rồi lại gặp lỗi kế là ba vòng deploy. Nói hết một lần.
    const env = {
      A_FILE: path.join(thuMuc, "khong-co"),
      B_FILE: ghi("b", ""),
      C: "co-san", C_FILE: ghi("c", "x"),
    };
    let msg = "";
    try { nap(env); } catch (e) { msg = e.message; }
    expect(msg).toMatch(/A_FILE/);
    expect(msg).toMatch(/B_FILE/);
    expect(msg).toMatch(/C_FILE/);
  });

  it("thông điệp lỗi KHÔNG chứa nội dung bí mật", () => {
    const env = { X: "gia-tri-env-tuyet-mat", X_FILE: ghi("x", "gia-tri-file-tuyet-mat") };
    let msg = "";
    try { nap(env); } catch (e) { msg = e.message; }
    expect(msg).not.toContain("gia-tri-env-tuyet-mat");
    expect(msg).not.toContain("gia-tri-file-tuyet-mat");
  });
});

describe("không có quyền đọc", () => {
  it("file chmod 000 → ném với lý do quyền, không phải 'không tồn tại'", () => {
    // root bỏ qua kiểm quyền của file, nên bài này chỉ có nghĩa khi KHÔNG chạy bằng root.
    if (typeof process.getuid === "function" && process.getuid() === 0) return;
    const p = ghi("cam", "x");
    chmodSync(p, 0o000);
    expect(() => nap({ A_FILE: p })).toThrowError(/quyền đọc/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// NỐI DÂY THẬT VÀO src/config.ts.
//
// Mười chín bài trên kiểm HÀM. Chúng KHÔNG chứng minh hàm đó được GỌI, gọi ĐÚNG CHỖ, hay gọi
// TRƯỚC `schema.safeParse(process.env)`. Gọi sau thì `SESSION_SECRET_FILE` không có tác dụng gì
// và tiến trình chết vì "thiếu SESSION_SECRET" — đúng lúc người vận hành vừa làm đúng cách an
// toàn hơn. Đó là kiểu lỗi mà một bộ test đơn vị xanh 19/19 vẫn để lọt.
//
// Nên bài dưới nạp `dist/config.js` THẬT trong một tiến trình riêng (config.ts có `process.exit`
// ở nhiều nhánh — không nạp được trong tiến trình vitest).
// ─────────────────────────────────────────────────────────────────────────────
describe("nối dây vào src/config.ts (chạy dist/ trong tiến trình riêng)", () => {
  const DIST = new URL("../dist/config.js", import.meta.url).pathname;
  const co = existsSync(DIST);
  if (!co && process.env.REQUIRE_DB_TESTS === "1") {
    throw new Error("Thiếu dist/config.js — chạy `npm run build` trước. Bỏ qua âm thầm ở đây là mất đúng bài kiểm quan trọng nhất của file.");
  }

  /** Chạy node với env chỉ định, in ra giá trị config muốn xem. */
  const chay = (env, in_) =>
    spawnSync(process.execPath, ["-e", `import(${JSON.stringify(DIST)}).then(m => { ${in_} })`], {
      encoding: "utf8", timeout: 30_000,
      env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: "test", ...env },
    });

  it.runIf(co)("SESSION_SECRET_FILE thay được SESSION_SECRET ở tiến trình thật", () => {
    const p = path.join(thuMuc, "sess");
    writeFileSync(p, "bi-mat-tu-file-du-32-ky-tu-0123456789\n");
    const r = chay(
      { DATABASE_URL: "postgresql://u:p@127.0.0.1:5432/x", SESSION_SECRET_FILE: p },
      'console.log("GT=" + m.config.SESSION_SECRET)',
    );
    expect(r.stdout + r.stderr, `config không nhận giá trị từ file:\n${r.stdout}${r.stderr}`)
      .toMatch(/GT=bi-mat-tu-file-du-32-ky-tu-0123456789/);
  }, 40_000);

  it.runIf(co)("log khởi động nêu TÊN BIẾN và ĐƯỜNG DẪN, KHÔNG nêu giá trị", () => {
    const p = path.join(thuMuc, "sess2");
    writeFileSync(p, "gia-tri-khong-duoc-xuat-hien-trong-log-0123456789\n");
    const r = chay(
      { DATABASE_URL: "postgresql://u:p@127.0.0.1:5432/x", SESSION_SECRET_FILE: p },
      'console.log("xong")',
    );
    const ra = r.stdout + r.stderr;
    expect(ra, "không thấy dòng thông báo nạp bí mật").toMatch(/Nạp 1 bí mật từ file/);
    expect(ra).toContain("SESSION_SECRET");
    expect(ra, "GIÁ TRỊ bí mật lọt vào log khởi động").not.toContain("gia-tri-khong-duoc-xuat-hien-trong-log");
  }, 40_000);

  it.runIf(co)("cấu hình _FILE sai làm tiến trình THOÁT khác 0, không chạy tiếp", () => {
    const r = chay(
      { DATABASE_URL: "postgresql://u:p@127.0.0.1:5432/x", SESSION_SECRET: "kiem-thu-session-secret-du-32-ky-tu-co-san",
        SESSION_SECRET_FILE: path.join(thuMuc, "khong-co-file-nay") },
      'console.log("KHONG-DUOC-TOI-DAY")',
    );
    expect(r.status, "cấu hình bí mật mơ hồ mà tiến trình vẫn chạy tiếp").not.toBe(0);
    expect(r.stdout).not.toContain("KHONG-DUOC-TOI-DAY");
    expect(r.stdout + r.stderr).toMatch(/CẢ SESSION_SECRET lẫn SESSION_SECRET_FILE/);
  }, 40_000);
});
