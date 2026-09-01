/**
 * ============================================================================
 * CỤM infra-compose — test hồi quy cho hạ tầng (compose / Dockerfile / CI / Helm / k8s / backup).
 *
 * LỖI LÀ GÌ
 *   20 phát hiện về hạ tầng, tất cả cùng một dạng: đường triển khai ĐANG CHẠY THẬT
 *   (docker compose trên VM coolify) yếu hơn hẳn đường k8s/Helm mà CI vẫn kiểm.
 *   Cụ thể:
 *     - Bản dump CSDL (chứa CCCD / số tài khoản / lương thô) sinh ra ở chế độ 0644.
 *     - Hai script diễn tập khôi phục nạp cả bản dump vào CHÍNH volume của Postgres
 *       production mà không hề kiểm chỗ trống — đúng thứ mà backup-db.sh đã phải kiểm.
 *     - Compose prod/staging không giới hạn RAM, không bỏ capability: một lượt xuất
 *       Excel bất thường lớn để OOM killer chọn nạn nhân, và Postgres là ứng viên.
 *     - Compose dev đăng cổng Postgres/Redis/MinIO/MailHog ra MỌI giao diện mạng
 *       kèm mật khẩu mặc định ghi thẳng trong file.
 *     - Không service nào có xoay vòng log → json-file mặc định ăn hết đĩa.
 *     - CI: không dựng Docker trên PR, không quét lỗ hổng image, action không ghim SHA,
 *       kubeconform tải về chạy thẳng không kiểm checksum, vẫn đẩy tag `latest`.
 *     - Helm/k8s: mật khẩu Redis/Postgres mặc định trong repo, PDB worker chặn drain,
 *       không có preStop, Postgres/Redis nhúng không siết securityContext,
 *       thiếu MFA_ENC_KEY / PII_ENC_KEY / METRICS_TOKEN trong secret mẫu.
 *
 * TÁI HIỆN
 *   Đây là lỗi cấu hình tĩnh: không có đầu vào nào để gọi. Cách tái hiện DUY NHẤT
 *   lặp lại được là đọc chính các file cấu hình và khẳng định thuộc tính an toàn —
 *   giống hệt cách scripts/ci/check-runtime-command.sh đang gác lệnh khởi động.
 *   Mỗi khối `it` dưới đây ĐỎ trên mã trước khi vá.
 *
 * HẬU QUẢ
 *   Ưu tiên số 1 của repo là không mất dữ liệu. Ba trong số này chạm thẳng vào đó:
 *   đĩa đầy vì log → Postgres không ghi được WAL; diễn tập khôi phục làm đầy volume
 *   lúc 3h30 sáng Chủ nhật → production ngừng ghi; OOM killer chọn Postgres giữa
 *   transaction. Phần còn lại là lộ PII và siết chuỗi cung ứng.
 * ============================================================================
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");
/** Bỏ dòng chú thích trước khi soi: phần giải thích VÌ SAO thường nhắc lại đúng cái tên xấu
 *  mà bản vá vừa loại bỏ ("không dùng minAvailable nữa"), và sẽ tự làm đỏ chính bài test này. */
const readCode = (p) => read(p).replace(/^\s*#.*$/gm, "");

const COMPOSE_FILES = ["docker-compose.yml", "docker-compose.prod.yml", "docker-compose.staging.yml"];

/** Cắt file compose thành từng khối service. Cố ý parse bằng thụt lề thay vì kéo thêm
 *  thư viện YAML: `yaml` chỉ là phụ thuộc bắc cầu, một lượt `npm ci` khác là biến mất. */
function composeServices(text) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => /^services:\s*$/.test(l));
  if (start < 0) throw new Error("không thấy khối `services:`");
  const out = {};
  let name = null;
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (/^\S/.test(l) && l.trim() !== "") break; // sang khoá cấp cao khác (volumes:/networks:)
    const m = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(l);
    if (m) { name = m[1]; out[name] = []; continue; }
    if (name) out[name].push(l);
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.join("\n")]));
}

describe("[infra-compose] sao lưu: quyền tệp và chỗ trống đĩa", () => {
  it("backup-files-world-readable: dump PII không được sinh ra ở chế độ ai-cũng-đọc", () => {
    const install = read("scripts/backup/install-backup.sh");
    expect(install).toMatch(/install -d -m 0700 \/opt\/quanly \/opt\/quanly-backups/);

    for (const f of ["backup-db.sh", "backup-objects.sh", "restore-drill.sh", "restore-test.sh"]) {
      expect(read(`scripts/backup/${f}`), `${f} thiếu umask 077`).toMatch(/^umask 077$/m);
    }
    // Ngay cả khi ai đó chạy tay với umask khác, file dump vẫn phải bị siết lại.
    expect(read("scripts/backup/backup-db.sh")).toMatch(/chmod 600 "\$FILE" "\$FILE\.sha256"/);
    expect(read("scripts/backup/backup-objects.sh")).toMatch(/chmod -R go-rwx "\$MIRROR_DIR"/);
  });

  it("restore-drill-fills-production-volume: diễn tập phải kiểm chỗ trống trước khi nạp dump", () => {
    for (const f of ["restore-test.sh", "restore-drill.sh"]) {
      const s = read(`scripts/backup/${f}`);
      expect(s, `${f} không kiểm cỡ CSDL hiện tại`).toMatch(/pg_database_size/);
      expect(s, `${f} không kiểm chỗ trống volume Postgres`).toMatch(/df -Pm \/var\/lib\/postgresql\/data/);
      // Kiểm phải nằm TRƯỚC lệnh tạo CSDL tạm, nếu không thì vô nghĩa.
      expect(s.indexOf("pg_database_size")).toBeLessThan(s.indexOf("CREATE DATABASE"));
    }
  });

  it("nas-password-in-process-table: NAS_PASS không được nội suy vào chuỗi lệnh smbclient", () => {
    for (const f of ["backup-db.sh", "backup-objects.sh"]) {
      const s = read(`scripts/backup/${f}`);
      expect(s, `${f} vẫn nhét mật khẩu vào argv`).not.toMatch(/NAS_USER\}%\$\{NAS_PASS/);
      expect(s, `${f} chưa dùng file credentials`).toMatch(/smbclient "\$NAS_SHARE" -A \/tmp\/cred/);
    }
  });
});

describe("[infra-compose] compose production/staging", () => {
  it("prod-compose-no-resource-limits: mọi service phải có trần RAM", () => {
    for (const f of ["docker-compose.prod.yml", "docker-compose.staging.yml"]) {
      const svcs = composeServices(read(f));
      for (const [name, body] of Object.entries(svcs)) {
        expect(body, `${f} · service ${name} không có deploy.resources.limits.memory`).toMatch(/limits:\s*\n\s+memory:/);
      }
    }
  });

  it("prod-compose-no-container-hardening: app/worker phải bỏ sạch capability và cấm leo thang", () => {
    for (const f of ["docker-compose.prod.yml", "docker-compose.staging.yml"]) {
      const svcs = composeServices(read(f));
      for (const name of ["app", "worker"]) {
        expect(svcs[name], `${f} · ${name} thiếu cap_drop`).toMatch(/cap_drop:\s*(\[\s*"ALL"\s*\]|\n\s+- "?ALL"?)/);
        expect(svcs[name], `${f} · ${name} thiếu no-new-privileges`).toMatch(/security_opt:\s*(\[\s*"no-new-privileges:true"\s*\]|\n\s+- "?no-new-privileges:true"?)/);
      }
    }
  });

  it("compose-mutable-tags-and-no-log-rotation: mọi service phải xoay vòng log, không service nào dùng tag :latest", () => {
    for (const f of COMPOSE_FILES) {
      const text = read(f);
      expect(text, `${f} còn image tag :latest (di động)`).not.toMatch(/^\s+image:.*:latest\s*$/m);
      // Mỗi service phải KHAI logging, và file phải định nghĩa trần cỡ + số tệp (trực tiếp hoặc
      // qua anchor YAML dùng chung — alias trỏ vào anchor không tồn tại thì compose tự báo lỗi).
      expect(text, `${f} không đặt max-size cho log`).toMatch(/max-size/);
      expect(text, `${f} không đặt max-file cho log`).toMatch(/max-file/);
      for (const [name, body] of Object.entries(composeServices(text))) {
        expect(body, `${f} · service ${name} không khai logging → json-file mặc định ăn hết đĩa`).toMatch(/^\s+logging:/m);
      }
    }
  });

  it("dev-compose-publishes-datastores-on-all-interfaces: cổng kho dữ liệu dev chỉ mở trên loopback", () => {
    const svcs = composeServices(read("docker-compose.yml"));
    for (const name of ["postgres", "redis", "minio", "mailhog"]) {
      const published = svcs[name].split("\n").filter((l) => /^\s+- "[^"]*\d+:\d+"/.test(l));
      const exposed = published.filter((l) => !/- "127\.0\.0\.1:/.test(l));
      expect(published.length, `service ${name} không còn đăng cổng nào — test đã lạc chỗ`).toBeGreaterThan(0);
      expect(exposed, `service ${name} vẫn đăng cổng ra mọi giao diện: ${exposed.join(", ")}`).toEqual([]);
    }
  });
});

describe("[infra-compose] Dockerfile / build context", () => {
  it("dockerignore-misses-nested-node-modules: node_modules lồng nhau phải bị loại khỏi build context", () => {
    const di = read(".dockerignore").split(/\r?\n/);
    expect(di, "pattern `node_modules` không khớp `web/node_modules` — dockerignore so khớp cả đường dẫn").toContain("**/node_modules");
  });
});

describe("[infra-compose] CI (.github/workflows/ci.yml)", () => {
  const ci = () => read(".github/workflows/ci.yml");

  it("actions-not-sha-pinned: mọi `uses:` phải ghim SHA 40 ký tự", () => {
    const bad = ci()
      .split(/\r?\n/)
      .filter((l) => /^\s*(-\s*)?uses:/.test(l))
      .filter((l) => !/@[0-9a-f]{40}\b/.test(l));
    expect(bad, `action chưa ghim SHA:\n${bad.join("\n")}`).toEqual([]);
  });

  it("no-docker-build-on-pr: phải có job dựng Docker chạy trên PR và build-image phụ thuộc nó", () => {
    const t = ci();
    expect(t, "thiếu job docker-build").toMatch(/^ {2}docker-build:/m);
    expect(t, "build-image phải chờ docker-build").toMatch(/needs: \[[^\]]*docker-build[^\]]*\]/);
  });

  it("no-container-image-vuln-scan: phải quét lỗ hổng trên chính image vừa dựng", () => {
    expect(ci(), "không có bước trivy scan-type: image").toMatch(/scan-type: image/);
  });

  it("kubeconform-download-unverified: tải kubeconform phải đối chiếu checksum", () => {
    const t = ci();
    expect(t, "curl kubeconform không kiểm sha256").toMatch(/sha256sum -c -/);
    expect(t, "curl thiếu -f nên trang lỗi HTML vẫn đi tiếp").toMatch(/curl -sSLf -o \/tmp\/kc\.tgz/);
  });

  it("sbom-not-attached-and-latest-tag-pushed: SBOM+provenance đi kèm image, và không đẩy tag latest", () => {
    const t = ci();
    expect(t, "build-push-action chưa bật provenance").toMatch(/provenance: mode=max/);
    expect(t, "build-push-action chưa bật sbom").toMatch(/^\s+sbom: true$/m);
    expect(t, "vẫn đẩy tag di động `latest` trong khi chart lại từ chối nó").not.toMatch(/type=raw,value=latest/);
  });
});

describe("[infra-compose] Helm chart", () => {
  const values = () => read("infra/helm/quanly/values.yaml");

  it("helm-redis-password-default-unguarded: mật khẩu kho dữ liệu nhúng không có mặc định trong repo", () => {
    const v = values();
    expect(v, "postgres.password vẫn có placeholder dùng được").not.toMatch(/^\s+password: CHANGE_ME_INTERNAL\s*$/m);
    expect(v, "redis.password vẫn có placeholder dùng được").not.toMatch(/^\s+password: CHANGE_ME_INTERNAL_REDIS\s*$/m);
    const h = read("infra/helm/quanly/templates/_helpers.tpl");
    expect(h, "thiếu helper bắt buộc mật khẩu Postgres").toMatch(/define "quanly\.postgresPassword"/);
    expect(h, "thiếu helper bắt buộc mật khẩu Redis").toMatch(/define "quanly\.redisPassword"/);
    // Template không được đọc thẳng .Values.*.password nữa — phải qua helper `required`.
    expect(readCode("infra/helm/quanly/templates/redis.yaml")).not.toMatch(/\.Values\.redis\.password/);
    expect(readCode("infra/helm/quanly/templates/postgres.yaml")).not.toMatch(/\.Values\.postgres\.password/);
  });

  it("worker-pdb-blocks-drain: PDB worker phải dùng maxUnavailable, không dùng minAvailable dùng chung", () => {
    const pdb = readCode("infra/helm/quanly/templates/pdb.yaml");
    const workerBlock = pdb.slice(pdb.indexOf("-worker"));
    expect(workerBlock, "PDB worker vẫn minAvailable — 1 worker duy nhất làm `kubectl drain` treo").toMatch(/maxUnavailable:/);
    expect(workerBlock).not.toMatch(/minAvailable:/);
    expect(values(), "values thiếu podDisruptionBudget.workerMaxUnavailable").toMatch(/workerMaxUnavailable:/);
  });

  it("no-prestop-drain-delay: pod app phải trễ preStop để endpoint kịp rút", () => {
    for (const f of ["infra/helm/quanly/templates/app-deployment.yaml", "infra/k8s/app.yaml"]) {
      const s = read(f);
      expect(s, `${f} thiếu lifecycle.preStop`).toMatch(/preStop:/);
      expect(s, `${f} thiếu terminationGracePeriodSeconds`).toMatch(/terminationGracePeriodSeconds:/);
    }
  });

  it("helm-embedded-datastores-unhardened: Postgres/Redis nhúng phải siết như bản kustomize", () => {
    for (const f of ["postgres.yaml", "redis.yaml"]) {
      const s = read(`infra/helm/quanly/templates/${f}`);
      expect(s, `${f} thiếu podSecurityContext`).toMatch(/seccompProfile/);
      expect(s, `${f} thiếu readOnlyRootFilesystem`).toMatch(/readOnlyRootFilesystem: true/);
      expect(s, `${f} chưa bỏ capability`).toMatch(/drop: \["ALL"\]/);
    }
    // readOnlyRootFilesystem mà thiếu volume socket thì Postgres không tạo nổi socket → pod chết.
    expect(read("infra/helm/quanly/templates/postgres.yaml")).toMatch(/\/var\/run\/postgresql/);
  });

  it("metrics-unreachable-shipped-scrape-config: METRICS_TOKEN phải có trong secret và ServiceMonitor phải gửi kèm", () => {
    expect(values(), "values.secrets thiếu METRICS_TOKEN").toMatch(/^\s+METRICS_TOKEN:/m);
    expect(read("infra/k8s/secret.example.yaml"), "secret mẫu k8s thiếu METRICS_TOKEN").toMatch(/METRICS_TOKEN/);
    const sm = read("infra/helm/quanly/templates/sa.yaml");
    expect(sm, "ServiceMonitor scrape /metrics mà không gửi Bearer → prod trả 404").toMatch(/authorization:/);
  });
});

describe("[infra-compose] đường triển khai k8s", () => {
  it("k8s-backup-path-incomplete: secret mẫu phải đủ khoá mã hoá, và CronJob dump phải nguyên tử + có checksum", () => {
    const sec = read("infra/k8s/secret.example.yaml");
    expect(sec, "thiếu MFA_ENC_KEY → src/config.ts process.exit(1) ngay lúc khởi động").toMatch(/MFA_ENC_KEY/);
    expect(sec, "thiếu PII_ENC_KEY → ghi thô âm thầm, hàng đã mã hoá thì ném").toMatch(/PII_ENC_KEY/);
    const v = read("infra/helm/quanly/values.yaml");
    expect(v).toMatch(/^\s+MFA_ENC_KEY:/m);
    expect(v).toMatch(/^\s+PII_ENC_KEY:/m);

    const cron = read("infra/k8s/backup-cronjob.yaml");
    expect(cron, "dump ghi thẳng vào tên cuối — mất điện giữa chừng để lại file cụt").toMatch(/\$OUT\.partial/);
    expect(cron, "không kiểm dump đọc lại được").toMatch(/pg_restore -l/);
    expect(cron, "không ghi checksum").toMatch(/sha256sum/);

    // Kho object KHÔNG nằm trong dump CSDL — nhánh k8s phải có lịch sao lưu riêng.
    expect(existsSync(join(ROOT, "infra/k8s/backup-objects-cronjob.yaml")), "nhánh k8s không sao lưu kho object: mất bucket = mất chứng từ tài chính").toBe(true);
  });
});
