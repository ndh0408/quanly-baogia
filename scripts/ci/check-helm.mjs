#!/usr/bin/env node
// ============================================================================
// check-helm.mjs — CHART PHẢI RENDER RA THỨ CHẠY ĐƯỢC, VÀ PHẢI TỪ CHỐI THỨ KHÔNG NÊN CHẠY.
//
//   node scripts/ci/check-helm.mjs
//
// ── VÌ SAO CẦN ─────────────────────────────────────────────────────────────
// `helm lint` (thứ duy nhất chạy trước đây) chỉ soi CÚ PHÁP và Chart.yaml. Nó KHÔNG render
// template, nên hai lỗi từng làm chết cụm đều lọt qua nó:
//   · app/worker gọi `node src/server.js` — file KHÔNG có trong image (pod chết vòng lặp);
//   · `image.tag` mặc định `latest` — hai pod cùng ReplicaSet chạy hai bản mã khác nhau.
//
// Chart NAY đã có chốt cho cả hai (helper `quanly.image` gọi `fail`, `quanly.postgresPassword`
// gọi `required`). Nhưng CÓ CHỐT và CHỐT CÒN SỐNG là hai chuyện: một lần sửa helper, một giá trị
// mặc định mới ở values.yaml là chốt im lặng biến mất. File này render THẬT rồi đòi chốt phải nổ.
//
// ── BỐN NHÓM ───────────────────────────────────────────────────────────────
//   [H1] render đầy đủ với bộ values tối thiểu hợp lệ, ra đủ mọi kind cần có;
//   [H2] TỪ CHỐI `image.tag=latest` (và vẫn cho qua khi khai báo tường minh allowMutableTag);
//   [H3] TỪ CHỐI mật khẩu Postgres/Redis để trống;
//   [H4] manifest hợp lệ theo schema Kubernetes (kubeconform) + các bất biến ngữ nghĩa mà
//        kubeconform KHÔNG thấy được (secretKeyRef trỏ vào khoá có thật, image được ghim,
//        container nào cũng có resources, lệnh khởi động trỏ dist/).
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseAllDocuments } from "yaml";

const GOC = path.resolve(import.meta.dirname, "../..");
const CHART = path.join(GOC, "infra/helm/quanly");

let loi = 0;
const buoc = (s) => console.log(`\n\x1b[1m▶ ${s}\x1b[0m`);
const ok = (s) => console.log(`  \x1b[32m✓ ${s}\x1b[0m`);
const xau = (s) => { console.log(`  \x1b[31m✗ ${s}\x1b[0m`); loi = 1; };
const doi = (dk, s) => (dk ? ok(s) : xau(s));

const co = (b) => { try { execFileSync("sh", ["-c", `command -v ${b}`], { stdio: "ignore" }); return true; } catch { return false; } };
if (!co("helm")) {
  console.log("\x1b[33m— helm không có trên máy này, bỏ qua toàn bộ cổng chart\x1b[0m");
  process.exit(0);
}

// Bộ values TỐI THIỂU để chart render được. Cố ý KHÔNG dùng values.yaml nguyên bản: mặc định ở đó
// để trống mật khẩu (có chủ ý — xem [H3]), nên render trần sẽ luôn hỏng.
const TOI_THIEU = [
  "--set", "image.tag=v0.0.0-test",
  "--set", "postgres.password=kiem-thu-pg",
  "--set", "redis.password=kiem-thu-rd",
  "--set", "secrets.SESSION_SECRET=kiem-thu-session-secret-du-32-ky-tu-abc",
  "--set", "secrets.MFA_ENC_KEY=kiem-thu-mfa-key-16",
];

/** Chạy `helm template`. Trả { ma, ra } — KHÔNG ném, vì "hỏng" chính là kết quả cần đo ở H2/H3. */
function render(themArgs = []) {
  try {
    const ra = execFileSync("helm", ["template", "kiemthu", CHART, ...TOI_THIEU, ...themArgs],
      { encoding: "utf8", maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "pipe"] });
    return { ma: 0, ra };
  } catch (e) {
    return { ma: e.status ?? 1, ra: `${e.stdout || ""}${e.stderr || ""}` };
  }
}

// ── [H1] ────────────────────────────────────────────────────────────────────
buoc("[H1] Render đầy đủ với bộ values tối thiểu");
const goc = render();
if (goc.ma !== 0) {
  xau("helm template hỏng ngay với values hợp lệ");
  console.log(goc.ra.slice(0, 2000));
  process.exit(1);
}
const docs = parseAllDocuments(goc.ra).map((d) => d.toJS()).filter((d) => d && d.kind);
ok(`render ra ${docs.length} tài nguyên`);

const CAN_CO = {
  Deployment: 3,           // app + worker + redis
  StatefulSet: 1,          // postgres
  Service: 3,
  Ingress: 1,
  ConfigMap: 1,
  Secret: 1,
  CronJob: 2,              // dump CSDL + sao lưu kho object
  PodDisruptionBudget: 2,
  NetworkPolicy: 2,
  ServiceAccount: 1,
  HorizontalPodAutoscaler: 2,
};
const dem = {};
for (const d of docs) dem[d.kind] = (dem[d.kind] || 0) + 1;
for (const [k, n] of Object.entries(CAN_CO)) {
  doi((dem[k] || 0) >= n, `${k}: có ${dem[k] || 0} (cần ≥ ${n})`);
}

// ── [H2] ────────────────────────────────────────────────────────────────────
buoc("[H2] Tag di động phải bị TỪ CHỐI");
const latest = render(["--set", "image.tag=latest"]);
doi(latest.ma !== 0, "image.tag=latest → chart TỪ CHỐI render");
doi(/latest/.test(latest.ra) && /digest|git-sha/.test(latest.ra),
  "lời từ chối nói rõ phải thay bằng digest hoặc git-sha");

// Chiều ngược: cửa thoát tường minh vẫn phải dùng được, nếu không người ta sẽ gỡ chốt.
const thoat = render(["--set", "image.tag=latest", "--set", "image.allowMutableTag=true"]);
doi(thoat.ma === 0, "allowMutableTag=true → vẫn render được (cửa thoát tường minh còn sống)");

// Digest phải được ưu tiên hơn tag.
const dg = render(["--set", "image.digest=sha256:" + "a".repeat(64)]);
doi(dg.ma === 0 && dg.ra.includes("@sha256:" + "a".repeat(64)), "image.digest được dùng khi có");

// ── [H3] ────────────────────────────────────────────────────────────────────
buoc("[H3] Mật khẩu nội bộ để trống phải bị TỪ CHỐI");
for (const [ten, khoa] of [["Postgres", "postgres.password"], ["Redis", "redis.password"]]) {
  const r = render(["--set", `${khoa}=`]);
  doi(r.ma !== 0, `${khoa} rỗng → chart TỪ CHỐI render`);
  doi(new RegExp(khoa.replace(".", "\\.")).test(r.ra), `lời từ chối gọi đúng tên khoá ${khoa}`);
}

// ── [H4] ────────────────────────────────────────────────────────────────────
buoc("[H4] Manifest hợp lệ + bất biến ngữ nghĩa");
const tam = mkdtempSync(path.join(tmpdir(), "helm-check-"));
try {
  const f = path.join(tam, "render.yaml");
  writeFileSync(f, goc.ra);
  if (co("kubeconform")) {
    // `-strict`: cấm field lạ (bắt lỗi gõ sai tên như `contaners`).
    // `-ignore-missing-schemas`: CRD ngoài (ServiceMonitor…) không có schema công khai —
    // bỏ qua CHÚNG chứ không bỏ qua tài nguyên chuẩn.
    let ra = "";
    try {
      ra = execFileSync("kubeconform", ["-strict", "-summary", "-ignore-missing-schemas", f],
        { encoding: "utf8", stdio: "pipe" });
    } catch (e) {
      ra = `${e.stdout || ""}${e.stderr || ""}`;
    }
    // ── "Invalid" VÀ "Errors" LÀ HAI CHUYỆN KHÁC HẲN ────────────────────────
    // kubeconform TẢI schema từ raw.githubusercontent.com. Máy không ra được mạng thì nó báo
    // `Valid: 0, Invalid: 0, Errors: 21` — KHÔNG tài nguyên nào sai, chỉ là không kiểm được.
    // Nhập hai thứ đó làm một sẽ cho một cổng đỏ mỗi lần mạng chập — và một cổng hay báo động
    // giả thì sớm muộn bị tắt. Nên: `Invalid` mới làm đỏ; `Errors` chỉ cảnh báo vàng.
    const m = ra.match(/Valid:\s*(\d+),\s*Invalid:\s*(\d+),\s*Errors:\s*(\d+),\s*Skipped:\s*(\d+)/);
    if (!m) {
      xau("kubeconform không in được dòng tổng kết — chạy tay để xem");
      console.log(ra.slice(0, 1500));
    } else {
      const [, hopLe, saiSchema, khongKiemDuoc] = m.map(Number);
      doi(saiSchema === 0, `kubeconform: ${hopLe} tài nguyên hợp schema, ${saiSchema} sai`);
      if (saiSchema > 0) console.log(ra.split("\n").filter((l) => /invalid/i.test(l)).slice(0, 8).join("\n"));
      if (khongKiemDuoc > 0) {
        console.log(`  \x1b[33m— ${khongKiemDuoc} tài nguyên KHÔNG kiểm được (kubeconform tải schema qua mạng).`);
        console.log(`    Không làm đỏ: đó là chuyện mạng, không phải chuyện chart.\x1b[0m`);
      }
    }
  } else {
    console.log("  \x1b[33m— kubeconform chưa cài, bỏ qua kiểm schema (cài: https://github.com/yannh/kubeconform)\x1b[0m");
    console.log("    (các bất biến ngữ nghĩa bên dưới VẪN chạy — chúng không cần kubeconform)");
  }
} finally {
  rmSync(tam, { recursive: true, force: true });
}

/** Mọi pod spec trong bản render, kèm tên để báo lỗi cho người đọc hiểu được. */
function moiPodSpec() {
  const ra = [];
  for (const d of docs) {
    const ten = `${d.kind}/${d.metadata?.name}`;
    if (d.kind === "CronJob") {
      const p = d.spec?.jobTemplate?.spec?.template?.spec;
      if (p) ra.push([ten, p]);
    } else if (d.spec?.template?.spec) {
      ra.push([ten, d.spec.template.spec]);
    }
  }
  return ra;
}
const podSpecs = moiPodSpec();
doi(podSpecs.length >= 6, `tìm được ${podSpecs.length} pod spec để soi`);

const moiContainer = () =>
  podSpecs.flatMap(([ten, p]) =>
    [...(p.initContainers || []).map((c) => [`${ten}:init/${c.name}`, c]),
     ...(p.containers || []).map((c) => [`${ten}/${c.name}`, c])]);

// H4a — image nào cũng phải GHIM. `latest` hoặc không có tag đều là bản di động.
{
  const xauList = moiContainer().filter(([, c]) => {
    const img = String(c.image || "");
    if (img.includes("@sha256:")) return false;
    const sau = img.split("/").pop() || "";
    return !sau.includes(":") || /:latest$/.test(img);
  }).map(([t, c]) => `${t} → ${c.image}`);
  doi(xauList.length === 0, `image đều được ghim (digest hoặc tag tường minh)${xauList.length ? `: ${xauList.join(", ")}` : ""}`);
}

// H4b — container nào cũng phải có requests VÀ limits. Thiếu requests thì scheduler xếp bừa;
// thiếu limits thì một pod ngốn hết node.
{
  const xauList = moiContainer()
    .filter(([, c]) => !c.resources?.requests || !c.resources?.limits)
    .map(([t]) => t);
  doi(xauList.length === 0, `container nào cũng có resources.requests + limits${xauList.length ? `: ${xauList.join(", ")}` : ""}`);
}

// H4c — lệnh khởi động phải trỏ dist/, không phải src/. Đây là ĐÚNG sự cố đã làm chết cụm;
// scripts/ci/check-runtime-command.sh soi FILE TEMPLATE, còn đây soi BẢN ĐÃ RENDER.
{
  const xauList = moiContainer()
    .filter(([, c]) => JSON.stringify([c.command || [], c.args || []]).match(/src\/(server|worker)\.(js|ts)/))
    .map(([t]) => t);
  doi(xauList.length === 0, `không container nào khởi động từ src/${xauList.length ? `: ${xauList.join(", ")}` : ""}`);
}

// H4d — MỖI secretKeyRef / configMapKeyRef phải trỏ vào khoá CÓ THẬT.
// kubeconform KHÔNG thấy được chuyện này: manifest vẫn hợp schema, nhưng trên cụm thật pod kẹt
// CreateContainerConfigError và CronJob sao lưu KHÔNG BAO GIỜ chạy — im lặng, cho tới hôm cần
// khôi phục. Đây là bất biến đắt giá nhất của cả file.
//
// Chỉ soi được khi chart TỰ TẠO nguồn đó. Đặt `existingSecret` thì Secret nằm ngoài bản render
// và không có gì để đối chiếu — bỏ qua chứ không đoán bừa.
{
  const nguon = new Map();   // "Secret/ten" | "ConfigMap/ten" → Set(khoá)
  for (const d of docs) {
    if (d.kind !== "Secret" && d.kind !== "ConfigMap") continue;
    nguon.set(`${d.kind}/${d.metadata.name}`,
      new Set([...Object.keys(d.data || {}), ...Object.keys(d.stringData || {})]));
  }
  const thieu = [];
  for (const [ten, c] of moiContainer()) {
    const refs = [
      ...(c.env || []).filter((e) => e.valueFrom?.secretKeyRef)
        .map((e) => ["Secret", e.valueFrom.secretKeyRef.name, e.valueFrom.secretKeyRef.key, e.name]),
      ...(c.env || []).filter((e) => e.valueFrom?.configMapKeyRef)
        .map((e) => ["ConfigMap", e.valueFrom.configMapKeyRef.name, e.valueFrom.configMapKeyRef.key, e.name]),
      ...(c.envFrom || []).filter((e) => e.secretRef).map((e) => ["Secret", e.secretRef.name, null, null]),
      ...(c.envFrom || []).filter((e) => e.configMapRef).map((e) => ["ConfigMap", e.configMapRef.name, null, null]),
    ];
    for (const [kind, ref, key, bien] of refs) {
      const s = nguon.get(`${kind}/${ref}`);
      if (!s) { thieu.push(`${ten} → ${kind} "${ref}" không có trong bản render`); continue; }
      if (key && !s.has(key)) thieu.push(`${ten} → biến ${bien} lấy khoá "${key}" mà ${kind} "${ref}" không có`);
    }
  }
  const soRef = moiContainer().reduce((n, [, c]) =>
    n + (c.env || []).filter((e) => e.valueFrom?.secretKeyRef || e.valueFrom?.configMapKeyRef).length
      + (c.envFrom || []).length, 0);
  doi(soRef >= 8, `soi được ${soRef} tham chiếu Secret/ConfigMap (bảo hiểm: bộ lọc không rỗng)`);
  doi(thieu.length === 0, `mọi secretKeyRef/configMapKeyRef trỏ vào khoá có thật${thieu.length ? `:\n      · ${thieu.join("\n      · ")}` : ""}`);
}

// H4e — app phải có cả liveness lẫn readiness. Thiếu readiness thì Service đẩy traffic vào pod
// chưa nối được CSDL; thiếu liveness thì pod treo nằm mãi trong endpoints.
{
  const app = docs.find((d) => d.kind === "Deployment" && /-app$/.test(d.metadata?.name || ""));
  const c = app?.spec?.template?.spec?.containers?.[0];
  doi(!!c?.livenessProbe, "Deployment app có livenessProbe");
  doi(!!c?.readinessProbe, "Deployment app có readinessProbe");
}

console.log(loi ? "\n\x1b[31m❌ CỔNG CHART ĐỎ\x1b[0m" : "\n\x1b[32m✅ CỔNG CHART XANH\x1b[0m");
process.exit(loi);
