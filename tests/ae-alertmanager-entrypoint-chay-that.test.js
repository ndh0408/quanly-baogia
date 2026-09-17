/**
 * ============================================================================
 * CHẠY THẬT `alertmanager-entrypoint.sh`, KHÔNG CHỈ ĐỌC VĂN BẢN CỦA NÓ.
 *
 * ── VÌ SAO CÓ TỆP NÀY ──────────────────────────────────────────────────────
 * tests/am-canh-bao-den-nguoi.test.js khoá rất nhiều điều về script này, nhưng MỌI bài trong đó
 * đều là so khớp VĂN BẢN (`expect(ENTRY).toMatch(...)`). Văn bản đúng không chứng minh phép thay
 * CHẠY đúng — và lỗi dưới đây là một ví dụ sống: script khai ngay ở dòng đầu rằng nó "thay theo
 * NGHĨA ĐEN", văn bản khớp mọi bài kiểm, mà giá trị vẫn bị bóp méo.
 *
 * ── LỖI ĐÃ ĐO ──────────────────────────────────────────────────────────────
 * `awk -v ten="$gt"` DIỄN GIẢI CHUỖI THOÁT trong giá trị:
 *     printf 'x=${U}\n' | awk -v v='ab\tcd\ne' '{gsub(/\$\{U\}/,v); print}' | cat -A
 *     → x=ab^Icd$
 *       e$
 * Một TAB thật và một XUỐNG DÒNG thật. Hậu quả với cấu hình Alertmanager:
 *   · tài khoản/địa chỉ chứa dấu chéo ngược bị đổi IM LẶNG → thư gửi sai chỗ hoặc không gửi;
 *   · một cặp chéo-ngược-n CHÈN ĐƯỢC DÒNG MỚI vào giữa YAML → cấu hình vẫn hợp lệ, vẫn khởi động,
 *     nhưng KHÔNG còn là cấu hình người ta viết.
 * Cả hai đều là đường hỏng IM LẶNG — đúng thứ mà toàn bộ script này sinh ra để chặn.
 *
 * Bản vá đưa giá trị qua MÔI TRƯỜNG và đọc bằng `ENVIRON[...]`, thứ không diễn giải gì cả.
 *
 * ── `AM_BIN` ───────────────────────────────────────────────────────────────
 * Dòng cuối script `exec` Alertmanager, không có trên máy dev. `AM_BIN` là khe để bài kiểm thay
 * bằng một lệnh vô hại — nhờ nó bài này chạy TRỌN script thật, kể cả chốt chặn ở bước 3.
 * ============================================================================
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(ROOT, "infra/observability/alertmanager-entrypoint.sh");
const MAU = join(ROOT, "infra/observability/alertmanager.yml.tpl");

// `sh` có trên Linux/macOS và trong Git Bash trên Windows. Thiếu nó thì BỎ QUA, chứ không giả vờ
// xanh: một bài kiểm hạ tầng "pass" vì không chạy được còn tệ hơn không có bài nào.
const coSh = spawnSync("sh", ["-c", "exit 0"]).status === 0;

/** Chạy trọn entrypoint, trả về {status, stdout, stderr, config}. */
function chay(env) {
  const thuMuc = mkdtempSync(join(tmpdir(), "am-ep-"));
  const ra = join(thuMuc, "alertmanager.yml");
  const r = spawnSync("sh", [SCRIPT], {
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      AM_TEMPLATE: MAU,
      AM_RENDERED: ra,
      AM_BIN: "true", // lệnh POSIX không làm gì, thoát 0 — thay cho /bin/alertmanager
      // Trỏ sang một đường CHẮC CHẮN KHÔNG TỒN TẠI để mặc định là "Telegram tắt". Bài nào cần
      // bật thì ghi đè bằng tệp token giả.
      AM_TELEGRAM_TOKEN_FILE: join(tmpdir(), "khong-bao-gio-ton-tai-telegram-token"),
      ...env,
    },
  });
  let config = null;
  try { config = readFileSync(ra, "utf8"); } catch { /* script thoát trước khi dựng xong */ }
  rmSync(thuMuc, { recursive: true, force: true });
  return { ...r, config };
}

const DU = {
  SMTP_HOST: "smtp.example.com",
  SMTP_PORT: "587",
  SMTP_FROM: "bao-gia@example.com",
  ALERT_EMAIL_TO: "truc@example.com",
};

describe.runIf(coSh)("alertmanager-entrypoint.sh — chạy thật", () => {
  it("đủ biến → dựng xong, thoát 0, và KHÔNG còn `${` nào", () => {
    const r = chay(DU);
    expect(r.status, `stderr: ${r.stderr}`).toBe(0);
    expect(r.config).toBeTruthy();
    const khongChuThich = r.config.split("\n").filter((d) => !/^\s*#/.test(d)).join("\n");
    expect(khongChuThich, "còn biến chưa thay trong cấu hình đã dựng").not.toMatch(/\$\{/);
    expect(r.config).toContain("smtp.example.com:587");
  });

  it("giá trị chứa DẤU CHÉO NGƯỢC giữ nguyên NGHĨA ĐEN — không thành tab", () => {
    // Đây là bài chính. Với bản dùng `awk -v`, `\t` dưới đây biến thành một ký tự TAB thật và
    // smarthost trỏ vào một máy chủ KHÔNG TỒN TẠI, im lặng.
    const r = chay({ ...DU, SMTP_HOST: "mail\\thost.example" });
    expect(r.status, `stderr: ${r.stderr}`).toBe(0);
    expect(r.config, "awk đã diễn giải \\t thành TAB — giá trị bị bóp méo im lặng")
      .toContain("mail\\thost.example");
    expect(r.config).not.toContain("mail\thost.example");
  });

  it("một cặp chéo-ngược-n KHÔNG được chèn dòng mới vào YAML", () => {
    // Nguy hiểm hơn ca trên: cấu hình vẫn HỢP LỆ nên container vẫn lên, chỉ là nó không còn là
    // cấu hình người ta viết.
    const r = chay({ ...DU, SMTP_FROM: "Gia Nguyen\\nBao Gia <a@b.vn>" });
    expect(r.status, `stderr: ${r.stderr}`).toBe(0);
    const dong = r.config.split("\n").find((d) => d.includes("smtp_from:"));
    expect(dong, "không thấy dòng smtp_from").toBeTruthy();
    expect(dong, "giá trị đã bị tách làm hai dòng — YAML không còn như đã viết")
      .toContain("Gia Nguyen\\nBao Gia");
  });

  it("SMTP_USER CHƯA ĐẶT (không phải rỗng) vẫn chạy bình thường dưới `set -u`", () => {
    // `$SMTP_USER` trần dưới `set -u` làm script chết với "unbound variable" và mã thoát 1 — mất
    // luôn thông điệp đã soạn sẵn. Compose luôn đặt biến này, nhưng bộ test và người vận hành thì
    // gọi thẳng.
    const r = chay(DU); // DU cố ý KHÔNG có SMTP_USER
    expect(r.status).toBe(0);
    expect(r.stderr, "chết vì biến chưa đặt thay vì đi đúng nhánh 'không xác thực'")
      .not.toMatch(/unbound variable|parameter not set/i);
    // BỎ DÒNG CHÚ THÍCH trước khi soi: bản mẫu GIẢI THÍCH về `smtp_auth_*` trong phần chú thích,
    // và soi cả chú thích thì bài này đỏ vì chính lời giải thích — đúng cái bẫy đã gặp vài lần ở
    // repo này (xem tests/pe-prisma-loi-trung.test.js).
    const khongChuThich = r.config.split("\n").filter((d) => !/^\s*#/.test(d)).join("\n");
    expect(khongChuThich, "không xác thực thì phải GỠ HẲN hai dòng smtp_auth_*").not.toMatch(/smtp_auth_/);
  });

  it("thiếu biến bắt buộc → thoát 78 và NÊU TÊN biến còn thiếu", () => {
    const { SMTP_FROM, ...thieu } = DU;
    const r = chay(thieu);
    expect(r.status, "thiếu biến mà vẫn khởi động = kênh cảnh báo câm").toBe(78);
    expect(r.stderr).toContain("SMTP_FROM");
  });

  it("có SMTP_USER mà KHÔNG có tệp mật khẩu → thoát 78, không lên với AUTH hỏng", () => {
    // Alertmanager chỉ đọc tệp mật khẩu lúc GỬI THƯ ĐẦU TIÊN. Không chặn ở đây là để lỗi nổ đúng
    // vào lúc đang có sự cố.
    const r = chay({ ...DU, SMTP_USER: "bao-gia@example.com" });
    expect(r.status).toBe(78);
    expect(r.stderr).toMatch(/smtp_password/);
  });
});

describe.runIf(coSh)("Kênh Telegram — mặc định TẮT, bật thì thay hẳn email", () => {
  /** Tạo một tệp token giả, trả về đường dẫn. */
  function tokenGia() {
    const d = mkdtempSync(join(tmpdir(), "am-tg-"));
    const p = join(d, "telegram_bot_token");
    writeFileSync(p, "123456:FAKE-TOKEN-CHI-DE-KIEM\n");
    return p;
  }

  it("KHÔNG cấu hình gì → chỉ có email, KHÔNG có telegram", () => {
    // Đây là mặc định, và là hành vi y như trước 2026-09-17. Bản vá không được đổi nó một ly.
    const r = chay(DU);
    expect(r.status, `stderr: ${r.stderr}`).toBe(0);
    expect(r.config).toMatch(/^\s*email_configs:/m);
    expect(r.config, "khối telegram lọt vào dù không ai bật").not.toMatch(/^\s*telegram_configs:/m);
  });

  it("đủ token + chat id → chỉ có telegram, khối email bị GỠ HẲN", () => {
    const r = chay({ ...DU, AM_TELEGRAM_TOKEN_FILE: tokenGia(), TELEGRAM_CHAT_ID: "-1001234567890" });
    expect(r.status, `stderr: ${r.stderr}`).toBe(0);
    expect(r.config).toMatch(/^\s*telegram_configs:/m);
    expect(r.config, "còn email_configs — cảnh báo vẫn đổ vào hộp thư nghiệp vụ")
      .not.toMatch(/^\s*email_configs:/m);
    expect(r.config, "chat id chưa được thay").toContain("chat_id: -1001234567890");
    // Token KHÔNG được nằm trong cấu hình: nó đi bằng đường tệp, cùng lý do với mật khẩu SMTP.
    expect(r.config, "token lọt vào file cấu hình đã dựng").not.toContain("FAKE-TOKEN");
    expect(r.config).toContain("bot_token_file:");
  });

  it("CÓ chat id nhưng KHÔNG token → thoát 78, không chạy nửa vời", () => {
    // Bật nửa vời khiến người ta tin mình có kênh mà thật ra không có — tệ hơn hẳn việc biết
    // mình chỉ có một kênh.
    const r = chay({ ...DU, TELEGRAM_CHAT_ID: "-100" });
    expect(r.status).toBe(78);
    expect(r.stderr).toMatch(/NỬA VỜI/);
    expect(r.stderr).toMatch(/telegram_bot_token|TELEGRAM_BOT_TOKEN/);
  });

  it("CÓ token nhưng KHÔNG chat id → cũng thoát 78", () => {
    const r = chay({ ...DU, AM_TELEGRAM_TOKEN_FILE: tokenGia() });
    expect(r.status).toBe(78);
    expect(r.stderr).toMatch(/TELEGRAM_CHAT_ID/);
  });

  it("bật telegram thì KHÔNG còn `${` nào sót — chat id phải nằm trong phép thay", () => {
    // Mối nối dễ đứt nhất: thêm biến vào bản mẫu mà quên thêm vào khối awk. Chốt chặn bước 3 của
    // entrypoint bắt được, nhưng chỉ khi có bài kiểm CHẠY ở chế độ bật.
    const r = chay({ ...DU, AM_TELEGRAM_TOKEN_FILE: tokenGia(), TELEGRAM_CHAT_ID: "-100" });
    expect(r.status, `stderr: ${r.stderr}`).toBe(0);
    const khongChuThich = r.config.split("\n").filter((d) => !/^\s*#/.test(d)).join("\n");
    expect(khongChuThich).not.toMatch(/\$\{/);
  });

  it("KHÔNG BAO GIỜ gỡ cả hai khối — receiver rỗng là vứt cảnh báo trong im lặng", () => {
    // Alertmanager KHÔNG báo lỗi khi receiver không có đường gửi nào: nó nhận cảnh báo rồi bỏ đi.
    // Đây là bài chốt cho đúng chế độ hỏng đó, ở cả hai cấu hình.
    for (const env of [DU, { ...DU, AM_TELEGRAM_TOKEN_FILE: tokenGia(), TELEGRAM_CHAT_ID: "-100" }]) {
      const r = chay(env);
      expect(r.status).toBe(0);
      const coEmail = /^\s*email_configs:/m.test(r.config);
      const coTg = /^\s*telegram_configs:/m.test(r.config);
      expect(coEmail || coTg, "receiver KHÔNG có đường gửi nào — cảnh báo bị vứt im lặng").toBe(true);
    }
  });
});
