/**
 * ============================================================================
 * B7 · k8s-backup-path-incomplete + metrics-unreachable-shipped-scrape-config
 *
 * LỖI LÀ GÌ
 *   1) SAO LƯU: nhánh kustomize (infra/k8s/) có CronJob dump CSDL và CronJob sao lưu kho
 *      object. Nhánh HELM — cùng chart mà CI render và kubeconform kiểm — KHÔNG có cái nào:
 *      `ls infra/helm/quanly/templates/` ra 12 file, không file nào nhắc `pg_dump`/`CronJob`.
 *      Cài bằng Helm thì cụm chạy KHÔNG có bản sao lưu nào, và không có gì báo cho biết.
 *   2) METRICS: ServiceMonitor đã gửi Bearer lấy từ khoá METRICS_TOKEN của Secret, nhưng giá
 *      trị mặc định là RỖNG và template Secret vẫn tạo khoá rỗng đó. Prometheus scrape với
 *      `Authorization: Bearer ` rỗng → src/app.ts trả 404 im lặng → bảng số liệu trống trơn
 *      đúng như trước khi vá, và KHÔNG có chốt nào bắt tổ hợp này.
 *
 * TÁI HIỆN
 *   Render chart thật bằng `helm template` (helm v3 có sẵn) rồi đọc kết quả — không grep
 *   template thô, vì cái quan trọng là thứ CUỐI CÙNG cụm nhận được.
 *
 * HẬU QUẢ
 *   (1) mất cụm = mất dữ liệu, không có bản sao nào để quay về.
 *   (2) mất quan trắc đúng lúc cần nhìn nhất, mà không ai được báo.
 * ============================================================================
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const CHART = join(ROOT, "infra/helm/quanly");

/** Giá trị tối thiểu để chart chịu render (mật khẩu kho dữ liệu + SESSION_SECRET là `required`). */
const CO_BAN = [
  "--set", "secrets.SESSION_SECRET=b7-session-secret-32-chars-minimum-value",
  "--set", "postgres.password=b7-pg",
  "--set", "redis.password=b7-redis",
  "--set", "image.tag=b7-test",
];

function render(themArgs = []) {
  try {
    return { code: 0, out: execFileSync("helm", ["template", "quanly", CHART, ...CO_BAN, ...themArgs], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) };
  } catch (e) {
    return { code: e.status ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

/** Cắt bản render thành từng tài liệu YAML để soi đúng đối tượng cần. */
function taiLieu(out) {
  return out.split(/^---$/m);
}

describe("[b7] Helm: nhánh chart phải có lịch sao lưu như nhánh kustomize", () => {
  it("chart render ra CronJob dump CSDL nguyên tử + có checksum", () => {
    const { code, out } = render();
    expect(code, `helm template thất bại:\n${out}`).toBe(0);

    const cron = taiLieu(out).filter((d) => /kind: CronJob/.test(d) && /pg_dump/.test(d));
    expect(cron.length, "chart Helm KHÔNG có CronJob sao lưu CSDL nào — cài bằng Helm là không có bản sao lưu").toBe(1);

    const c = cron[0];
    expect(c, "dump ghi thẳng vào tên cuối — pod bị evict giữa chừng để lại file cụt").toMatch(/\$OUT\.partial/);
    expect(c, "không kiểm dump có đọc lại được không").toMatch(/pg_restore -l/);
    expect(c, "không ghi checksum cạnh bản dump").toMatch(/sha256sum/);
    expect(c, "dump PII mà không siết umask").toMatch(/umask 077/);
    // Phải lấy DATABASE_URL từ chính Secret của release, không hardcode tên như bản kustomize.
    expect(c, "CronJob không tham chiếu Secret của release").toMatch(/key: DATABASE_URL/);
  });

  it("chart render ra CronJob sao lưu kho object (bản dump CSDL KHÔNG chứa ảnh chứng từ)", () => {
    const { code, out } = render();
    expect(code, out).toBe(0);
    const cron = taiLieu(out).filter((d) => /kind: CronJob/.test(d) && /mc mirror/.test(d));
    expect(cron.length, "chart Helm không sao lưu kho object: mất bucket = mất chứng từ tài chính").toBe(1);
  });
});

describe("[b7] Helm: ServiceMonitor bật mà METRICS_TOKEN rỗng thì phải TỪ CHỐI render", () => {
  it("serviceMonitor.enabled=true + METRICS_TOKEN rỗng → chart dừng, nói rõ vì sao", () => {
    const { code, out } = render(["--set", "metrics.serviceMonitor.enabled=true"]);
    expect(code, "chart vẫn render: Prometheus sẽ scrape bằng Bearer rỗng và nhận 404 im lặng mãi mãi").not.toBe(0);
    expect(out, "thông báo lỗi không nhắc METRICS_TOKEN thì người cài không biết sửa gì").toMatch(/METRICS_TOKEN/);
  });

  it("có METRICS_TOKEN → render bình thường, ServiceMonitor vẫn gửi Bearer", () => {
    const { code, out } = render([
      "--set", "metrics.serviceMonitor.enabled=true",
      "--set", "secrets.METRICS_TOKEN=b7-metrics-token",
    ]);
    expect(code, out).toBe(0);
    const sm = taiLieu(out).filter((d) => /kind: ServiceMonitor/.test(d));
    expect(sm.length).toBe(1);
    expect(sm[0]).toMatch(/authorization:/);
    expect(sm[0]).toMatch(/key: METRICS_TOKEN/);
  });

  it("existingSecret → KHÔNG chặn (chart không đọc được Secret do người khác quản)", () => {
    const { code, out } = render([
      "--set", "metrics.serviceMonitor.enabled=true",
      "--set", "existingSecret=quanly-secrets-ngoai",
    ]);
    expect(code, `chặn nhầm khi dùng Secret bên ngoài:\n${out}`).toBe(0);
  });
});
