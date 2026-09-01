/**
 * ============================================================================
 * HAI BLOCKER CỦA VÒNG PHẢN BIỆN TRÊN NHÁNH HELM.
 *
 * ── 1. CỔNG KIỂM BẢN GƯƠNG CHÉP LẠI BẢN ĐÃ BỊ GỠ ────────────────────────────
 * `templates/backup-objects-cronjob.yaml` mang cổng `[ "$LOCAL_N" -ge "$REMOTE_N" ]` — đúng phép so
 * SỐ ĐẾM mà `scripts/backup/backup-objects.sh` đã phải gỡ, với lý do ghi ngay trong file đó: bước
 * mirror là CỘNG DỒN (`mc mirror` không `--remove`), nên LOCAL_N chỉ có tăng; ngay khi retention
 * bắt đầu xoá object khỏi bucket thì LOCAL_N > REMOTE_N VĨNH VIỄN và cổng không bao giờ đỏ nữa.
 * Lịch này lại BẬT SẴN (values.yaml `backup.objects.enabled: true`).
 *
 * ── 2. CHỐT METRICS_TOKEN NẰM SAU MỘT NHÁNH TẮT MẶC ĐỊNH ────────────────────
 * Khối `fail` nằm trong `if and metrics.enabled metrics.serviceMonitor.enabled`, mà
 * `serviceMonitor.enabled` mặc định FALSE — nên bản cài mặc định không bao giờ chạm tới nó.
 * Cấu hình scrape chart THỰC SỰ ship mặc định là ba annotation `prometheus.io/*` trên pod app, và
 * kiểu scrape đó KHÔNG mang được Bearer. Với `NODE_ENV=production` + token rỗng, src/app.ts
 * fail-closed trả 404 — tức chart chỉ dẫn Prometheus tới một endpoint trả 404 mãi mãi, im lặng.
 * ============================================================================
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { readFileSync } from "node:fs";

const ROOT = join(import.meta.dirname, "..");
const CHART = join(ROOT, "infra/helm/quanly");
const CO_BAN = [
  "--set", "secrets.SESSION_SECRET=b9-session-secret-32-chars-minimum-value",
  "--set", "postgres.password=b9-pg",
  "--set", "redis.password=b9-redis",
  "--set", "image.tag=b9-test",
];

function render(themArgs = []) {
  try {
    return { code: 0, out: execFileSync("helm", ["template", "quanly", CHART, ...CO_BAN, ...themArgs], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) };
  } catch (e) {
    return { code: e.status ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}
const taiLieu = (out) => out.split(/^---$/m);

/**
 * Bỏ dòng chú thích trước khi khẳng định. Chú thích của bản vá TRÍCH LẠI NGUYÊN VĂN mã cũ để giải
 * thích vì sao gỡ, nên grep trần sẽ khớp đúng thứ vừa bị gỡ và báo động giả. (Đã mắc đúng lỗi này
 * một lần khi viết bài test này.)
 */
const boChuThich = (t) => t.split("\n").filter((d) => !/^\s*#/.test(d)).join("\n");

describe("[b9] Helm: cổng kiểm bản gương phải so THÀNH VIÊN, không so số đếm", () => {
  it("CronJob sao lưu object KHÔNG được dùng phép so số đếm đã bị gỡ", () => {
    const { code, out } = render();
    expect(code, out).toBe(0);
    const cron = taiLieu(out).filter((d) => /kind: CronJob/.test(d) && /mc mirror/.test(d));
    expect(cron.length, "chart không có CronJob sao lưu kho object").toBe(1);
    const c = boChuThich(cron[0]);
    expect(c, 'vẫn dùng `[ "$LOCAL_N" -ge "$REMOTE_N" ]` — cổng đó tự vô hiệu ngay khi retention xoá object khỏi bucket')
      .not.toMatch(/LOCAL_N["\s]*-ge/);
    // Phải kiểm TỪNG khoá của bucket có mặt trong gương.
    expect(c, "không có phép kiểm từng khoá `[ -f /objects/$k ]`").toMatch(/-f "\/objects\/\$k"/);
    expect(c, "không đếm số object THIẾU").toMatch(/THIEU_N/);
    expect(c, "cảnh báo không nêu tên object thiếu → người trực không biết mất cái gì").toMatch(/head -20 \/tmp\/thieu\.txt/);
  });

  it("cùng một logic với scripts/backup/backup-objects.sh — hai đường không được lệch nhau", () => {
    const sh = boChuThich(readFileSync(join(ROOT, "scripts/backup/backup-objects.sh"), "utf8"));
    expect(sh, "bản shell cũng phải so thành viên").toMatch(/THIEU_N/);
    expect(sh, "bản shell vẫn còn phép so số đếm").not.toMatch(/LOCAL_N["\s]*-lt/);
  });

  it("lọc manifest phải neo ĐẦU CHUỖI — khoá của mc là tương đối, không có '/' phía trước", () => {
    const { out } = render();
    const c = boChuThich(taiLieu(out).filter((d) => /kind: CronJob/.test(d) && /mc mirror/.test(d))[0]);
    expect(c, "`grep -v '/manifest_'` không khớp gì vì khoá là `manifest_….tsv`, không có '/' đầu")
      .not.toMatch(/grep -v '\/manifest_'/);
  });
});

describe("[b9] Helm: không được dẫn Prometheus tới endpoint không thể xác thực", () => {
  it("MẶC ĐỊNH (production, không token): KHÔNG khai annotation prometheus.io", () => {
    const { code, out } = render();
    expect(code, out).toBe(0);
    expect(out, "chart khai prometheus.io/scrape trong khi /metrics fail-closed 404 ở production không token — Prometheus dò mãi, không ai được báo")
      .not.toMatch(/prometheus\.io\/scrape/);
  });

  // `helm template` KHÔNG render NOTES.txt (nó chỉ hiện lúc install/upgrade), nên đọc thẳng mẫu
  // và khẳng định cả ĐIỀU KIỆN lẫn NỘI DUNG — đó là hai thứ có thể trôi ra khỏi nhau.
  it("NOTES.txt phải NÓI RA rằng số liệu đang không scrape được bằng đường nào", () => {
    const notes = readFileSync(join(CHART, "templates/NOTES.txt"), "utf8");
    expect(notes).toMatch(/KHÔNG SCRAPE ĐƯỢC BẰNG BẤT KỲ ĐƯỜNG NÀO/);
    expect(notes, "cảnh báo không gắn với đúng tổ hợp (production + token rỗng)")
      .toMatch(/METRICS_TOKEN[\s\S]{0,120}NODE_ENV/);
    expect(notes, "không chỉ ra cách bật thật").toMatch(/serviceMonitor\.enabled=true/);
  });

  it("dev + không token: VẪN khai annotation — ở đó /metrics trả lời được, đừng chặn oan", () => {
    const { code, out } = render(["--set", "config.NODE_ENV=development"]);
    expect(code, out).toBe(0);
    expect(out).toMatch(/prometheus\.io\/scrape/);
  });

  it("có token + serviceMonitor: ra ServiceMonitor CÓ authorization", () => {
    const { code, out } = render(["--set", "secrets.METRICS_TOKEN=b9tok", "--set", "metrics.serviceMonitor.enabled=true"]);
    expect(code, out).toBe(0);
    expect(out).toMatch(/kind: ServiceMonitor/);
    expect(out, "ServiceMonitor không mang Bearer → scrape nhận 401").toMatch(/authorization/);
  });

  it("serviceMonitor bật mà token rỗng: vẫn PHẢI fail (không hồi quy chốt cũ)", () => {
    const { code, out } = render(["--set", "metrics.serviceMonitor.enabled=true"]);
    expect(code, "render lọt trong khi Prometheus sẽ scrape bằng Bearer rỗng").not.toBe(0);
    expect(out).toMatch(/METRICS_TOKEN dang RONG/);
  });
});
