/**
 * ============================================================================
 * CỤM ha-tang-trienkhai — hai phát hiện CÒN MỞ sau các đợt vá trước:
 *   · k8s-worker-no-termination-grace
 *   · k8s-no-poddisruptionbudget
 *
 * LỖI LÀ GÌ
 *   1) Worker bắt SIGTERM rồi `await Promise.all(workers.map((w) => w.close()))`
 *      (src/worker.ts:170-178). `Worker.close()` KHÔNG cưỡng bức — nó chờ job đang
 *      chạy xong. Nhưng không nền tảng nào cho nó chừng ấy thời gian:
 *        · docker-compose.prod.yml / .staging.yml: không khai `stop_grace_period`
 *          → mặc định Docker là 10s, rồi SIGKILL. Đây là đường ĐANG CHẠY THẬT.
 *        · infra/k8s/worker.yaml: không khai `terminationGracePeriodSeconds`
 *          → mặc định k8s là 30s, rồi SIGKILL.
 *      Trong khi đó chính lượt sinh file của một job xuất đã được cấp trần CỨNG
 *      30s (`EXPORT_GEN_TIMEOUT_MS` ở src/exportQueue.ts), chưa
 *      kể còn phải tải lên kho object và ghi CSDL sau đó. Tức trần 10s của Docker
 *      NHỎ HƠN trần của chính job — mọi lần deploy đều có thể cắt ngang một job
 *      đang xuất file. Chart Helm thì đã đúng từ trước (values.yaml
 *      `worker.terminationGracePeriodSeconds`), nên đây là chỗ ba đường triển khai
 *      của cùng một hệ thống lệch nhau.
 *
 *   2) infra/k8s/ không có PodDisruptionBudget nào (`grep PodDisruption` trả rỗng,
 *      kustomization.yaml liệt kê 10 resource, không có pdb). Chart Helm thì có
 *      (templates/pdb.yaml). Không PDB thì một lệnh `kubectl drain` hạ được cả hai
 *      replica app cùng lúc = API đứt hẳn giữa lúc bảo trì. app.yaml cũng thiếu
 *      podAntiAffinity mà app-deployment.yaml của Helm đã có, nên hai replica có
 *      thể nằm chung một node — mất node là mất cả hai, PDB cũng không cứu được.
 *
 * TÁI HIỆN
 *   Đây là lỗi cấu hình TĨNH — không có đầu vào nào để gọi. Cách tái hiện lặp lại
 *   được duy nhất là đọc chính các file cấu hình và khẳng định thuộc tính, đúng
 *   cách tests/ic-infra-compose.test.js và scripts/ci/check-runtime-command.sh đang
 *   làm. Để bài test KHÔNG chỉ là "khẳng định lại hằng số vừa viết", con số ân hạn
 *   được đối chiếu với trần thời gian THẬT đọc ra từ src/exportQueue.ts: đổi trần
 *   đó lên mà quên nới ân hạn là bài test này đỏ.
 *
 * HẬU QUẢ
 *   Job xuất file bị SIGKILL giữa chừng không phải "chậm một chút": BullMQ mất khoá,
 *   job treo tới hết lockDuration (5 phút, src/queue.ts:199) rồi chạy lại từ đầu —
 *   người dùng thấy bản xuất báo giá đứng im suốt lượt deploy. Với PDB thì hậu quả
 *   là downtime API trong một thao tác bảo trì đáng lẽ không downtime.
 *
 * ⚠️ CHƯA KIỂM CHỨNG TRÊN CỤM THẬT: sandbox không có Docker daemon lẫn cụm k8s.
 *   Bài test này khẳng định manifest KHAI ĐÚNG thứ cần khai, KHÔNG khẳng định rằng
 *   `kubectl drain` thực sự kết thúc hay worker thực sự đóng êm trong 90s.
 * ============================================================================
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");
/** Bỏ dòng chú thích trước khi soi: phần giải thích VÌ SAO hay nhắc lại đúng cái tên xấu mà bản
 *  vá vừa loại bỏ ("không dùng minAvailable nữa") và sẽ tự làm đỏ chính bài test này. */
const readCode = (p) => read(p).replace(/^\s*#.*$/gm, "");

/** Cắt file compose thành từng khối service. Parse bằng thụt lề thay vì kéo thêm thư viện YAML:
 *  `yaml` chỉ là phụ thuộc BẮC CẦU ở repo này, một lượt `npm ci` khác là biến mất. */
function composeService(text, want) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => /^services:\s*$/.test(l));
  if (start < 0) throw new Error("không thấy khối `services:`");
  let name = null;
  const out = [];
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (/^\S/.test(l) && l.trim() !== "") break; // sang khoá cấp cao khác (volumes:/networks:)
    const m = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(l);
    if (m) { name = m[1]; continue; }
    if (name === want) out.push(l);
  }
  if (!out.length) throw new Error(`không thấy service \`${want}\``);
  return out.join("\n");
}

/** Tách file k8s nhiều tài liệu thành từng document rời. */
const docs = (text) => text.split(/^---\s*$/m);
const docOfKind = (text, kind, nameRe) =>
  docs(text).find((d) => new RegExp(`^kind:\\s*${kind}\\s*$`, "m").test(d) && (!nameRe || nameRe.test(d)));

/**
 * Trần CỨNG của một lượt sinh file xuất — đọc từ mã nguồn, KHÔNG chép tay vào đây.
 *
 * ── VÌ SAO NEO Ở ĐÂY MỚI CÓ NGHĨA ────────────────────────────────────────────
 * Bản trước neo vào `generateInWorker(..., timeoutMs = 30_000)` và tự quảng cáo là "đổi trần đó
 * lên mà quên nới ân hạn thì test đỏ". Lời đó SAI, vì lúc ấy src/worker.ts KHÔNG hề import
 * exportQueue.js: processor xuất gọi thẳng buildQuoteBuffer/renderQuotePdf, tức trần đó không nằm
 * trên đường thực thi của tiến trình worker — thứ mà `stop_grace_period` nói về. Neo vào một hằng
 * số ở module worker không dùng thì vừa không gác được cái cần gác, vừa đỏ oan khi module đó đổi.
 *
 * Nay src/worker.ts đi qua `runExportJob(..., { choPhepNoiTuyen: false })`, nên trần này là trần
 * THẬT của job worker. `docWorkerCoTran()` bên dưới khẳng định đúng điều kiện đó — mất nó thì
 * "worker chạy job xuất không giới hạn thời gian" là trạng thái ĐỎ, không phải im lặng.
 */
function exportHardTimeoutSec() {
  const m = /EXPORT_GEN_TIMEOUT_MS\s*=\s*Math\.max\([\s\S]*?\|\|\s*([\d_]+)/.exec(read("src/exportQueue.ts"));
  if (!m) throw new Error("không đọc được EXPORT_GEN_TIMEOUT_MS — mã đã đổi, cập nhật test");
  return Number(m[1].replace(/_/g, "")) / 1000;
}

/** Đường xuất của TIẾN TRÌNH WORKER có thật sự đi qua trần đó không. */
function workerDiQuaTran() {
  const w = read("src/worker.ts");
  return {
    nhapKhau: /import\s*\{[^}]*runExportJob[^}]*\}\s*from\s*"\.\/exportQueue\.js"/.test(w),
    tatNoiTuyen: /runExportJob\([^;]*choPhepNoiTuyen:\s*false/s.test(w),
    khongGoiThang: !/await\s+buildQuoteBuffer\(/.test(w) && !/await\s+renderQuotePdf\(/.test(w),
  };
}

describe("[ht3] k8s-worker-no-termination-grace: worker phải được cho đủ thời gian đóng job đang chạy", () => {
  const floor = exportHardTimeoutSec(); // 30s — chỉ riêng bước sinh file, chưa kể upload + ghi CSDL

  // GÁC TRỰC TIẾP LỚP LỖI. Ba khẳng định ân hạn bên dưới chỉ có nghĩa khi job xuất của worker
  // THẬT SỰ có trần. Bỏ `choPhepNoiTuyen: false` là mở lại đường sinh file NỘI TUYẾN không trần;
  // quay về gọi thẳng buildQuoteBuffer là bỏ trần hoàn toàn. Cả hai phải ĐỎ ở đây.
  it("processor xuất của src/worker.ts đi qua runExportJob và TẮT đường nội tuyến không trần", () => {
    const { nhapKhau, tatNoiTuyen, khongGoiThang } = workerDiQuaTran();
    expect(nhapKhau, "src/worker.ts không import runExportJob → job xuất chạy KHÔNG có trần thời gian").toBe(true);
    expect(tatNoiTuyen, "thiếu choPhepNoiTuyen: false → quá hạn sẽ rơi về sinh file nội tuyến, thứ KHÔNG có trần").toBe(true);
    expect(khongGoiThang, "src/worker.ts vẫn await thẳng buildQuoteBuffer/renderQuotePdf → nằm ngoài trần").toBe(true);
  });

  it("infra/k8s/worker.yaml khai terminationGracePeriodSeconds lớn hơn trần của chính job xuất", () => {
    const spec = docOfKind(readCode("infra/k8s/worker.yaml"), "Deployment");
    const m = /^\s*terminationGracePeriodSeconds:\s*(\d+)\s*$/m.exec(spec);
    expect(m, "worker Deployment không khai terminationGracePeriodSeconds → dùng mặc định 30s của k8s").not.toBeNull();
    // KHÔNG chỉ `> floor`: 31s cũng qua được phép so đó mà chẳng chừa chỗ nào cho tải lên kho
    // object và ghi CSDL. Đòi ÍT NHẤT 2× trần sinh file, và không dưới 60s.
    expect(Number(m[1])).toBeGreaterThanOrEqual(Math.max(60, floor * 2));
  });

  it("worker trong compose prod/staging khai stop_grace_period — mặc định 10s của Docker NHỎ HƠN trần job", () => {
    for (const f of ["docker-compose.prod.yml", "docker-compose.staging.yml"]) {
      const svc = composeService(readCode(f), "worker");
      const m = /^\s*stop_grace_period:\s*(\d+)s\s*$/m.exec(svc);
      expect(m, `${f}: service worker không khai stop_grace_period → Docker SIGKILL sau 10s`).not.toBeNull();
      expect(Number(m[1]), `${f}: stop_grace_period phải ít nhất 2× trần ${floor}s và không dưới 60s`)
        .toBeGreaterThanOrEqual(Math.max(60, floor * 2));
    }
  });

  it("ba đường triển khai (compose / k8s / Helm) dùng CÙNG một con số ân hạn cho worker", () => {
    const nums = new Set();
    nums.add(/^\s*terminationGracePeriodSeconds:\s*(\d+)\s*$/m.exec(docOfKind(readCode("infra/k8s/worker.yaml"), "Deployment"))?.[1]);
    nums.add(/^\s*terminationGracePeriodSeconds:\s*(\d+)\s*$/m.exec(readCode("infra/helm/quanly/values.yaml"))?.[1]);
    for (const f of ["docker-compose.prod.yml", "docker-compose.staging.yml"]) {
      nums.add(/^\s*stop_grace_period:\s*(\d+)s\s*$/m.exec(composeService(readCode(f), "worker"))?.[1]);
    }
    expect([...nums], "ba đường lệch nhau thì bản vá chỉ dời chỗ hỏng, không đóng nó").toHaveLength(1);
    expect([...nums][0]).toBeDefined();
  });
});

describe("[ht3] k8s-no-poddisruptionbudget: drain có kế hoạch không được hạ sạch replica", () => {
  it("infra/k8s/pdb.yaml tồn tại và được đăng ký trong kustomization.yaml", () => {
    expect(existsSync(join(ROOT, "infra/k8s/pdb.yaml")), "chưa có infra/k8s/pdb.yaml").toBe(true);
    expect(readCode("infra/k8s/kustomization.yaml")).toMatch(/^\s*-\s*pdb\.yaml\s*$/m);
  });

  it("PDB app dùng minAvailable, PDB worker dùng maxUnavailable (worker autoscale xuống 1 pod)", () => {
    const pdbFile = readCode("infra/k8s/pdb.yaml");

    const app = docOfKind(pdbFile, "PodDisruptionBudget", /component:\s*api/);
    expect(app, "thiếu PDB cho component: api").toBeDefined();
    expect(app).toMatch(/^\s*minAvailable:\s*\d+\s*$/m);

    const worker = docOfKind(pdbFile, "PodDisruptionBudget", /component:\s*worker/);
    expect(worker, "thiếu PDB cho component: worker").toBeDefined();
    // HPA worker (infra/k8s/worker.yaml) có minReplicas: 1. `minAvailable: 1` trên một Deployment
    // đúng 1 pod làm eviction API TỪ CHỐI MÃI MÃI → `kubectl drain` treo. Đúng lỗi đã vá ở chart Helm.
    expect(worker, "PDB worker dùng minAvailable = tái lập lại worker-pdb-blocks-drain").not.toMatch(/^\s*minAvailable:/m);
    expect(worker).toMatch(/^\s*maxUnavailable:\s*\d+\s*$/m);
  });

  it("kubeconform ở CI phải kiểm cả pdb.yaml — manifest không được kiểm là manifest sẽ trôi", () => {
    expect(read(".github/workflows/ci.yml")).toMatch(/infra\/k8s\/pdb\.yaml/);
  });

  it("app.yaml rải replica ra node khác nhau — PDB vô nghĩa nếu cả hai pod chung một node", () => {
    const dep = docOfKind(readCode("infra/k8s/app.yaml"), "Deployment");
    expect(dep, "app.yaml thiếu podAntiAffinity (Helm app-deployment.yaml đã có)").toMatch(/podAntiAffinity/);
    expect(dep).toMatch(/topologyKey:\s*kubernetes\.io\/hostname/);
  });
});
