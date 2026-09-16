/**
 * ============================================================================
 * CỤM am — CẢNH BÁO PHẢI ĐI ĐẾN ĐƯỢC MỘT CON NGƯỜI.
 *
 * ── VẤN ĐỀ ─────────────────────────────────────────────────────────────────
 * Tới 2026-09-16, repo có 22 quy tắc cảnh báo đã qua `promtool test rules`, một Prometheus đang
 * chạy thật trên production, và 3/3 target `up`. Nhưng khối `alerting:` trong prometheus.yml bị
 * CHÚ THÍCH và không có Alertmanager. Nghĩa là quy tắc chuyển sang `firing` thật rồi DỪNG LẠI ở
 * giao diện Prometheus — kể cả hai quy tắc viết cho đúng hai chế độ hỏng đã TÁI HIỆN ĐƯỢC trên
 * máy chủ thật (cạn pool CSDL, oom-kill). Có người mở mới thấy.
 *
 * ── VÌ SAO CẦN CỤM KIỂM RIÊNG ──────────────────────────────────────────────
 * Đường cảnh báo hỏng theo kiểu IM LẶNG, và nó có một cái bẫy đo được:
 *
 *     Alertmanager KHÔNG nội suy biến môi trường trong cấu hình.
 *     `amtool check-config` trên một file còn nguyên ${SMTP_HOST} vẫn in "SUCCESS".
 *
 * Tức mọi phép kiểm cú pháp đều xanh trong khi thư đi tới một máy chủ tên `${SMTP_HOST}`. Vì thế
 * bản mẫu mang đuôi `.tpl` và có `alertmanager-entrypoint.sh` dựng cấu hình trước khi chạy. Các
 * bài dưới đây khoá đúng những mối nối mà một lần sửa vô tình sẽ làm đứt mà không cổng nào đỏ.
 * ============================================================================
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const doc = (p) => readFileSync(join(ROOT, p), "utf8");

const TPL = doc("infra/observability/alertmanager.yml.tpl");
const ENTRY = doc("infra/observability/alertmanager-entrypoint.sh");
const COMPOSE = doc("infra/observability/docker-compose.observability.yml");
const PROMYML = doc("infra/observability/prometheus.yml");
const ALERTS = doc("infra/prometheus/alerts.yaml");
const GITATTR = doc(".gitattributes");

/** Bỏ dòng chú thích TRỌN VẸN — chúng cố ý nhắc tới cú pháp hỏng để giải thích vì sao tránh nó. */
const khongChuThich = (s) => s.split("\n").filter((d) => !/^\s*#/.test(d)).join("\n");

/** Cắt đúng khối YAML của một service trong compose. */
const khoiService = (ten) => {
  const m = COMPOSE.match(new RegExp(`^ {2}${ten}:$[\\s\\S]*?(?=^ {2}\\w|^\\w)`, "m"));
  if (!m) throw new Error(`compose không có service ${ten}`);
  return m[0];
};

describe("Prometheus phải THẬT SỰ gửi cảnh báo đi", () => {
  it("khối `alerting:` KHÔNG còn bị chú thích", () => {
    // Đây là một dòng duy nhất ngăn cách "có giám sát" với "có cảnh báo". Chú thích lại nó là quay
    // về đúng trạng thái cũ, và không có gì đỏ: Prometheus vẫn chạy, bảng Grafana vẫn vẽ.
    expect(khongChuThich(PROMYML), "alerting: bị chú thích → cảnh báo dừng ở giao diện Prometheus")
      .toMatch(/^alerting:$/m);
  });

  it("trỏ đúng service `alertmanager` cổng 9093 mà compose dựng", () => {
    expect(khongChuThich(PROMYML)).toMatch(/alertmanager:9093/);
    expect(COMPOSE, "prometheus.yml trỏ vào alertmanager nhưng compose không có service đó")
      .toMatch(/^ {2}alertmanager:$/m);
  });
});

describe("Cấu hình PHẢI đi qua bước dựng — không mount thẳng bản mẫu", () => {
  it("bản mẫu mang đuôi .tpl, không phải .yml", () => {
    // Đuôi .yml là lời mời trỏ `--config.file` vào nó. Và nếu ai làm vậy, Alertmanager KHỞI ĐỘNG
    // BÌNH THƯỜNG rồi gửi thư tới một máy chủ tên `${SMTP_HOST}` — im lặng, không lỗi ở đâu cả.
    expect(COMPOSE).toMatch(/alertmanager\.yml\.tpl/);
  });

  it("compose chạy entrypoint dựng cấu hình, không gọi thẳng /bin/alertmanager", () => {
    expect(khoiService("alertmanager")).toMatch(/entrypoint\.sh/);
    expect(ENTRY, "entrypoint phải kết thúc bằng exec sang alertmanager thật")
      .toMatch(/exec \/bin\/alertmanager/);
  });

  it("MỌI biến trong bản mẫu đều được entrypoint thay — mối nối dễ đứt nhất", () => {
    // Thêm một ${BIEN_MOI} vào bản mẫu mà quên thêm vào khối awk là lỗi DỄ mắc nhất ở đây. Chốt
    // "còn-sót" trong entrypoint bắt được lúc CHẠY (container không lên); bài này bắt được lúc CI,
    // tức trước khi ai đó phát hiện bằng cách mất một đêm cảnh báo.
    const bien = [...new Set([...TPL.matchAll(/\$\{([A-Z_]+)\}/g)].map((m) => m[1]))];
    expect(bien.length, "bản mẫu không còn biến nào — đã bị dựng sẵn?").toBeGreaterThan(0);
    for (const b of bien) {
      expect(ENTRY, `bản mẫu dùng \${${b}} nhưng entrypoint không thay nó`).toContain("${" + b + "}");
    }
  });

  it("entrypoint TỪ CHỐI khởi động khi còn sót biến chưa thay", () => {
    expect(ENTRY, "thiếu chốt này thì một biến quên thay sẽ thành cấu hình im lặng")
      .toMatch(/grep -n .\\\$\{/);
    expect(ENTRY).toMatch(/exit 78/);
  });

  it("entrypoint TỪ CHỐI khởi động khi thiếu biến bắt buộc", () => {
    expect(ENTRY).toMatch(/for v in SMTP_HOST SMTP_PORT SMTP_FROM ALERT_EMAIL_TO; do/);
    // SMTP_USER CỐ Ý không nằm trong danh sách: dev dùng MailHog, vốn không xác thực.
    expect(ENTRY).not.toMatch(/for v in [A-Z_ ]*SMTP_USER/);
  });
});

describe("Mật khẩu SMTP không được nằm trong cấu hình", () => {
  it("dùng smtp_auth_password_file, KHÔNG phải smtp_auth_password", () => {
    expect(TPL).toMatch(/smtp_auth_password_file:\s*\/run\/secrets\/smtp_password/);
    expect(khongChuThich(TPL), "mật khẩu dạng chuỗi sẽ nằm trong file đã dựng và lộ qua docker inspect")
      .not.toMatch(/smtp_auth_password:/);
  });

  it("compose bày SMTP_PASS ra bằng đường TỆP, không phải biến môi trường của container", () => {
    expect(COMPOSE).toMatch(/smtp_password:\s*\n(?:\s*#.*\n)*\s*environment: SMTP_PASS/);
    expect(khoiService("alertmanager"), "đừng truyền SMTP_PASS thẳng vào environment của alertmanager")
      .not.toMatch(/SMTP_PASS:/);
  });

  it("có xác thực thì BẮT BUỘC TLS — hai thứ buộc chặt vào nhau", () => {
    // TLS ở đây tồn tại để che MẬT KHẨU trên đường truyền. Tách chúng ra là mở đường cho một cấu
    // hình production gửi mật khẩu Gmail qua kết nối trần.
    expect(TPL).toMatch(/smtp_require_tls:\s*\$\{SMTP_REQUIRE_TLS\}/);
    const coUser = ENTRY.match(/if \[ -n "\$\{SMTP_USER:-\}" \]; then([\s\S]*?)\nelse\n/);
    expect(coUser, "không tìm thấy nhánh có-SMTP_USER trong entrypoint").toBeTruthy();
    expect(coUser[1], "có tài khoản mà không bắt buộc TLS").toMatch(/SMTP_REQUIRE_TLS=true/);
    expect(coUser[1], "có tài khoản mà không kiểm sự tồn tại của mật khẩu").toMatch(/\$KHOA/);
  });
});

describe("Luật định tuyến và nén im lặng phải trỏ vào thứ CÓ THẬT", () => {
  const tenCanhBao = [...new Set([...ALERTS.matchAll(/^\s*- alert:\s*(\S+)/gm)].map((m) => m[1]))];
  const mucDo = [...new Set([...ALERTS.matchAll(/severity:\s*(\w+)/g)].map((m) => m[1]))];

  it("đọc được danh sách quy tắc từ alerts.yaml", () => {
    expect(tenCanhBao.length).toBeGreaterThan(15);
    expect(mucDo).toContain("critical");
  });

  it("mọi `alertname=` trong inhibit_rules là một quy tắc CÓ THẬT", () => {
    // Viện dẫn sai tên thì luật nén im lặng không bao giờ khớp — và nó hỏng theo hướng ỒN ÀO (gửi
    // thừa), nên sẽ bị bỏ qua như "cảnh báo hơi nhiều" thay vì bị sửa. Chính bản đầu của
    // alertmanager.yml đã viện dẫn tên chưa kiểm.
    const vienDan = [...TPL.matchAll(/alertname="([^"]+)"/g)].map((m) => m[1]);
    expect(vienDan.length, "không còn inhibit_rules nào?").toBeGreaterThan(0);
    for (const t of vienDan) {
      expect(tenCanhBao, `inhibit_rules trỏ vào "${t}" nhưng alerts.yaml không có quy tắc đó`).toContain(t);
    }
  });

  it("mọi `severity=` trong route/inhibit là mức ĐANG được dùng", () => {
    const vienDan = [...TPL.matchAll(/severity="([^"]+)"/g)].map((m) => m[1]);
    expect(vienDan.length).toBeGreaterThan(0);
    for (const m of vienDan) {
      expect(mucDo, `định tuyến theo severity="${m}" nhưng không quy tắc nào mang mức đó`).toContain(m);
    }
  });

  it("mẫu thư dùng `with` cho runbook — vì còn quy tắc KHÔNG có chú thích đó", () => {
    // `if .Annotations.runbook` in ra một ô rỗng. Một lá thư khẩn cấp có ô rỗng làm người đọc mất
    // vài giây đoán xem mình bỏ sót gì — đúng lúc không có vài giây để mất.
    const thieu = ALERTS.split(/\n(?=\s*- alert: )/).filter((b) => /- alert: /.test(b) && !/runbook:/.test(b));
    expect(thieu.length, "mọi quy tắc đã có runbook → lúc đó mới được đổi sang `if`").toBeGreaterThan(0);
    expect(TPL).toMatch(/\{\{ with \.Annotations\.runbook \}\}/);
    expect(TPL, "đừng dùng `if` cho runbook khi còn quy tắc thiếu nó")
      .not.toMatch(/\{\{ if \.Annotations\.runbook \}\}/);
  });

  it("gửi cả thư KHI ĐÃ HẾT — im lặng không phải bằng chứng đã xong", () => {
    expect(TPL).toMatch(/send_resolved:\s*true/);
  });
});

describe("Những thứ sẽ hỏng ở máy chủ mà máy dev không thấy", () => {
  it("entrypoint và bản mẫu bị ép LF trong .gitattributes", () => {
    // Máy phát triển là Windows. `* text=auto` trả CRLF khi checkout, và một shebang kết thúc bằng
    // \r cho lỗi `/bin/sh^M: bad interpreter` — container không lên, với một thông điệp lỗi chẳng
    // liên quan gì tới cảnh báo.
    expect(GITATTR).toMatch(/^\*\.sh\s+text eol=lf/m);
    expect(GITATTR).toMatch(/^\*\.tpl\s+text eol=lf/m);
  });

  it("KHÔNG có ký tự CR nào trong hai tệp đó ngay lúc này", () => {
    expect(ENTRY.includes("\r"), "entrypoint có CR → /bin/sh^M: bad interpreter").toBe(false);
    expect(TPL.includes("\r"), "bản mẫu có CR").toBe(false);
  });

  it("có chỗ GHI ĐƯỢC cho cấu hình đã dựng — ảnh chạy bằng `nobody`", () => {
    // ĐÃ ĐO: thiếu tmpfs thì container thoát ngay với
    //   mkdir: can't create directory '/render': Permission denied
    // Thư mục gốc của ảnh không cho `nobody` ghi.
    const khoi = khoiService("alertmanager");
    expect(khoi, "thiếu tmpfs cho chỗ ghi cấu hình đã dựng").toMatch(/tmpfs:/);
    const dich = ENTRY.match(/AM_RENDERED:-(\/[^/\s}]+)\//);
    expect(dich, "không đọc được đường dẫn đích trong entrypoint").toBeTruthy();
    expect(khoi, `entrypoint ghi vào ${dich[1]}/ nhưng compose không cấp tmpfs ở đó`).toContain(dich[1]);
  });

  it("silence + nhật ký đã-gửi nằm trên volume, không mất khi khởi động lại", () => {
    // Mất chúng = mọi cảnh báo đang im bỗng kêu lại sau restart, và mọi `silence` người vận hành
    // đặt trong lúc bảo trì biến mất — tức ồn nhất đúng lúc đang bảo trì.
    expect(COMPOSE).toMatch(/alertmanager-data:\/alertmanager/);
    expect(COMPOSE).toMatch(/^ {2}alertmanager-data:$/m);
    expect(COMPOSE).toMatch(/--storage\.path=\/alertmanager/);
  });

  it("Prometheus KHÔNG chờ alertmanager khoẻ mới chạy", () => {
    // Buộc `service_healthy` là biến một trục trặc của KÊNH THÔNG BÁO thành mất luôn cả phần ĐO.
    expect(khoiService("prometheus")).toMatch(/alertmanager:\s*\{\s*condition:\s*service_started\s*\}/);
  });
});
