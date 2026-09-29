/**
 * OPS · cổng kiểm và công cụ — DOC-11, GAP1-08, INFRA-10, INFRA-11.
 *
 * DOC-11: check-line-refs viết `/^[}\])];,]+$/` — lớp ký tự đóng ở `]` thứ hai, nên `}`, `});`, `]`
 *   KHÔNG bị bắt; AGENTS/CONTRIBUTING khai cổng bắt "tham chiếu trỏ vào `}` lẻ" mà nó chưa từng bắt.
 *   Sửa regex lộ ngay 13 tham chiếu trôi (đã sửa về tên hàm/hằng).
 * GAP1-08: rc-qa.mjs coi 404 là đạt khi mong 200, và bỏ qua 403 khi đo hiệu năng.
 * INFRA-10: app không khai stop_grace_period (Docker SIGKILL sau 10s = đúng lưới tắt 10s của app).
 * INFRA-11: không đường nào đang chạy quét lỗ hổng của IMAGE.
 * §17: explain-hot-paths đỏ/xanh theo LỊCH SỬ của bảng (thứ tự vật lý), không theo index; không
 *   dựng trang (QuoteSheet) nên mù trước truy vấn đếm trang.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { dongVoNghia } from "../scripts/ci/check-line-refs.mjs";

const GOC = path.resolve(import.meta.dirname, "..");
const doc = (f) => readFileSync(path.join(GOC, f), "utf8");

describe("DOC-11 — dongVoNghia bắt dòng chỉ có dấu đóng", () => {
  for (const d of ["}", "  });", "]", ")", "];", "]],", "  )  "]) {
    it(`"${d}" là đích KHÔNG THỂ (cổng đỏ)`, () => {
      expect(dongVoNghia(d)?.muc).toBe("cung");
    });
  }
  it("dòng mã thật không bị bắt", () => {
    expect(dongVoNghia("const x = f(1);")).toBeNull();
  });
});

// Người soát (2026-09-29): commit đổi tham chiếu sang TÊN còn sót sáu chỗ `tệp:dòng` ĐÃ TRÔI mà
// check-line-refs không thể bắt — bốn chỗ rơi vào một dòng MÃ khác nghĩa (vd `src/logger.ts:51` giờ
// là `export const redactConfig`), hai chỗ rơi vào dòng chú thích (cổng chỉ liệt kê, không chặn).
// Cổng không kiểm được ngữ nghĩa, nên ở đây neo từng chỗ: số dòng cũ không còn, và TÊN được nêu thay
// thế có thật ở tệp đích — đổi tên bước/hàm mà quên tài liệu thì bài này đỏ, thay vì im lặng trôi.
describe("DOC-11 — tham chiếu đã đổi sang TÊN trỏ vào thứ có thật", () => {
  const NEO = [
    {
      tep: "tests/qua-token-in-flat-path-key.test.js", cu: /src\/middleware\.ts:\d/, nhac: /logger\.error trong errorHandler \(src\/middleware\.ts\)/,
      dich: "src/middleware.ts", neo: /export function errorHandler[\s\S]*?logger\.error\(\{ reqId: req\.id, path: req\.path/,
    },
    {
      tep: "tests/ch3-npm-manifest.test.js", cu: /src\/logger\.ts:\d/, nhac: /src\/logger\.ts \(`export const logger = pino\(…\)`\)/,
      dich: "src/logger.ts", neo: /export const logger = pino\(\{[\s\S]*?target: "pino-pretty"/,
    },
    {
      tep: "tests/ch3-npm-manifest.test.js", cu: /ci\.yml:\d/, nhac: /"Dependency audit \(high\+\) — gate" của job `security`/,
      dich: ".github/workflows/ci.yml", neo: /^ {2}security:\n[\s\S]*?- name: Dependency audit \(high\+\) — gate\n\s+run: npm audit --omit=dev --audit-level=high$/m,
    },
    {
      tep: "tests/ch3-npm-manifest.test.js", cu: /scripts\/ci\/ui-smoke\.mjs:\d/, nhac: /`scripts\/ci\/ui-smoke\.mjs` nhập `chromium`/,
      dich: "scripts/ci/ui-smoke.mjs", neo: /^import \{ chromium \} from "playwright";$/m,
    },
    {
      tep: "docs/development/TESTING.md", cu: /ci\.yml:\d/, nhac: /"Smoke test artifact production \(dist\/\)" của job `test`/,
      dich: ".github/workflows/ci.yml", neo: /^ {2}test:\n[\s\S]*?- name: Smoke test artifact production \(dist\/\)\n[\s\S]*?run: bash scripts\/ci\/smoke-dist\.sh$/m,
    },
    {
      tep: "docs/adr/0006-go-spa-vanilla-cu.md", cu: /web\/src\/main\.tsx:\d/, nhac: /`import "\.\.\/\.\.\/public\/style\.css"` trong `web\/src\/main\.tsx`/,
      dich: "web/src/main.tsx", neo: /^import "\.\.\/\.\.\/public\/style\.css";$/m,
    },
  ];
  for (const { tep, cu, nhac, dich, neo } of NEO) {
    it(`${tep}: không còn ${cu.source.replace(/\\d/g, "N").replace(/\\/g, "")}, và tên nêu thay có thật ở ${dich}`, () => {
      const s = doc(tep);
      expect(s, "vẫn còn tham chiếu số dòng").not.toMatch(cu);
      expect(s, "tài liệu không nêu tên thay thế").toMatch(nhac);
      expect(doc(dich).replace(/\r\n/g, "\n"), `${dich} không còn thứ tài liệu nêu tên`).toMatch(neo);
    });
  }
});

describe("GAP1-08 — rc-qa.mjs không chấm đạt quá dễ", () => {
  const src = doc("scripts/dev/rc-qa.mjs");
  it("không còn luật ngầm 'mong 200 thì 404 cũng được'", () => {
    expect(src).not.toMatch(/want\[i\] === 200 && g === 404/);
  });
  it("measure() coi MỌI mã không-2xx (kể cả 403) là lỗi", () => {
    expect(src).not.toMatch(/!r\.ok && r\.status !== 403/);
    expect(src).toMatch(/if \(!r\.ok\) return \{ path, error: r\.status \}/);
  });
});

describe("INFRA-10 — ân hạn dừng của app bao được lưới tắt cưỡng bức", () => {
  // Hạn cưỡng bức nay là SHUTDOWN_TIMEOUT_MS (HTTP-08, mặc định trong src/config.ts) — gộp với INFRA-10.
  const tat = Number(/SHUTDOWN_TIMEOUT_MS:[^\n]*\.default\(([\d_]+)\)/.exec(doc("src/config.ts"))?.[1].replace(/_/g, ""));
  for (const f of ["docker-compose.prod.yml", "docker-compose.staging.yml"]) {
    it(`${f}: app.stop_grace_period ≥ lưới tắt + 5s`, () => {
      const s = doc(f);
      const i = s.search(/^ {2}app:\s*$/m);
      const khoi = s.slice(i, i + s.slice(i + 1).search(/^ {2}[a-z]/m) + 1);
      const m = /^\s*stop_grace_period:\s*(\d+)s\s*$/m.exec(khoi);
      expect(m, `${f}: service app không khai stop_grace_period → SIGKILL sau 10s`).not.toBeNull();
      expect(Number(m[1]) * 1000).toBeGreaterThanOrEqual(tat + 5000);
    });
  }
});

describe("INFRA-11 — docker-smoke quét lỗ hổng của image", () => {
  it("có bước trivy image làm cổng (exit-code 1) trên gói OS + phụ thuộc ứng dụng", () => {
    const s = doc("scripts/ci/docker-smoke.sh");
    expect(s).toMatch(/trivy image[^\n]*\\\n[^\n]*--ignorefile \.trivyignore\.yaml[^\n]*\\\n[^\n]*--exit-code 1/);
  });
});

// Lớp `apk add` của stage runtime bị Docker CACHE theo chuỗi lệnh; ảnh nền ghim digest nên nó không
// bao giờ tự dựng lại → bản vá của kho alpine không tới image (2026-09-29: libexpat 2.8.4-r0,
// CVE-2026-93990, trong khi kho đã có 2.8.5-r0; trivy [D3] đỏ). Sàn `>=` đổi chuỗi lệnh — mọi cache,
// kể cả của VM, buộc dựng lại — và apk tự từ chối bản thấp hơn. Chú thích đầy đủ ở Dockerfile.
describe("INFRA-11 — stage runtime ghi SÀN cho gói OS đã có bản vá", () => {
  const df = doc("Dockerfile");
  const runtime = df.slice(df.search(/^FROM \S+ AS runtime\s*$/m));
  // Khối RUN apk add đầu tiên của stage runtime, kể cả các dòng tiếp nối bằng `\`.
  const apk = /^RUN apk add(?:[^\n]*\\\r?\n)*[^\n]*/m.exec(runtime)?.[0] ?? "";
  // So phiên bản kiểu apk "2.8.5-r0": từng số của phần chính, rồi số bản dựng -rN.
  const so = (v) => v.split(/[.-]r?/).map(Number);
  const soSanh = (a, b) => {
    const x = so(a), y = so(b);
    for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
    return 0;
  };

  it("tìm thấy lệnh apk add của stage runtime (các bài dưới không lạc chỗ)", () => {
    expect(apk).toMatch(/font-dejavu/);
    expect(apk).toMatch(/addgroup/);
  });
  it("libexpat >= 2.8.5-r0 (CVE-2026-93990) — fontconfig ← font-dejavu kéo nó vào", () => {
    const m = /'libexpat>=(\d[\d.]*-r\d+)'/.exec(apk);
    expect(m, "stage runtime không ghi sàn libexpat — lớp apk dựng từ cache vẫn mang 2.8.4-r0").not.toBeNull();
    expect(soSanh(m[1], "2.8.5-r0")).toBeGreaterThanOrEqual(0);
  });
  it("mọi ràng buộc phiên bản nằm trong nháy đơn — shell đọc `>` trần là CHUYỂN HƯỚNG, sàn biến mất", () => {
    expect(apk.replace(/'[^']*'/g, "").match(/\S*[<>=~]\S*/g) ?? []).toEqual([]);
  });
  it("bộ so phiên bản phân biệt đúng chỗ cần phân biệt", () => {
    expect(soSanh("2.8.4-r0", "2.8.5-r0")).toBeLessThan(0);
    expect(soSanh("2.8.5-r1", "2.8.5-r0")).toBeGreaterThan(0);
    expect(soSanh("2.10.0-r0", "2.8.5-r0")).toBeGreaterThan(0);
  });
});

describe("INFRA-08 — CronJob backup (k8s) không bị NetworkPolicy của chính repo chặn", () => {
  it("pod template của quanly-db-backup mang nhãn app: quanly mà postgres-allow-app-only cho vào", () => {
    const cron = doc("infra/k8s/backup-cronjob.yaml");
    expect(doc("infra/k8s/networkpolicy.yaml")).toMatch(/matchLabels: \{ app: quanly \}/);
    expect(cron).toMatch(/template:\s*\n(?:\s*#.*\n)*\s*metadata:\s*\n\s*labels: \{ app: quanly, component: db-backup \}/);
  });
});

// Cổng [5/13] của verify đỏ trong lượt đầy đủ rồi xanh khi chạy riêng (2026-09-29). Gốc rễ, đo trên
// CSDL test: autovacuum rơi vào giữa lúc script chèn 5.000 báo giá → các lô sau vào ĐẦU bảng →
// correlation(createdAt) 0,98 → −0,46 → trang 100 (bỏ qua 40% bảng) lật sang Seq Scan + Sort, chi phí
// 779 so với 851 của đường index. Bộ hoạch định chọn ĐÚNG; cổng đỏ vì lịch sử của bảng, không vì
// thiếu index. Khối THỨ TỰ VẬT LÝ đầu script có đủ số đo.
describe("§17 — explain-hot-paths: phán quyết theo INDEX, không theo thứ tự vật lý của bảng", () => {
  const TEP = "scripts/db/explain-hot-paths.mjs";
  const src = doc(TEP);
  // Chỉ import khi phần CHẠY cổng đã được chốt: thiếu chốt thì chính lần import sẽ dựng 5.000 dòng
  // vào CSDL test ngay giữa bộ test song song (rồi process.exit giết luôn worker).
  const coChot = /^if \(process\.argv\[1\] && import\.meta\.url === pathToFileURL\(path\.resolve\(process\.argv\[1\]\)\)\.href\) await chayCong\(\);$/m.test(src);
  let m = {};
  beforeAll(async () => {
    if (coChot) m = await import("../scripts/db/explain-hot-paths.mjs");
  });
  const tuongQuan = (x, y) => {
    const n = x.length;
    const tb = (a) => a.reduce((s, v) => s + v, 0) / n;
    const mx = tb(x), my = tb(y);
    let sxy = 0, sx = 0, sy = 0;
    for (let i = 0; i < n; i++) {
      sxy += (x[i] - mx) * (y[i] - my);
      sx += (x[i] - mx) ** 2;
      sy += (y[i] - my) ** 2;
    }
    return sxy / Math.sqrt(sx * sy);
  };

  it("phần chạy cổng nằm sau chốt import.meta.url === argv[1] — import từ test không chạm CSDL", () => {
    expect(coChot).toBe(true);
  });

  it("dữ liệu thử có TRANG cho mỗi báo giá — bảng QuoteSheet rỗng thì truy vấn đếm trang không bao giờ đỏ", () => {
    // quoteSheetsSchema đòi ≥ 1 trang mỗi báo giá: ở CSDL thật QuoteSheet luôn lớn ít nhất bằng Quote.
    expect(m.TRANG_MOI_BAO_GIA).toBeGreaterThanOrEqual(1);
    expect(src).toMatch(/INSERT INTO "QuoteSheet" \("quoteId", "templateId", "order"\)\s+SELECT q\.id, \$1, o FROM "Quote" q CROSS JOIN generate_series\(1, \$2\) o WHERE q\."companyId" = \$3`,\s+mau\.id, TRANG_MOI_BAO_GIA, co\.id,/);
    expect(src, "mẫu thử phải được dọn (QuoteSheet trỏ tới nó; Company bị nó trỏ tới)").toMatch(/prisma\.quoteTemplate\.deleteMany\(\{ where: \{ code: \{ startsWith: TAG \} \}/);
  });

  it("trang SÂU bỏ qua ~10% số dòng dựng: ở 40% (trang 100 cũ) Seq Scan là lựa chọn ĐÚNG khi thứ tự lệch", () => {
    for (const n of [5000, 20000]) {
      const boQua = (m.trangSau(n) - 1) * m.CO_TRANG;
      expect(boQua, `${n} dòng: vẫn phải là trang SÂU`).toBeGreaterThanOrEqual(10 * m.CO_TRANG);
      // Điểm hoà đo được ở correlation ≈ 0 là ~30–35% bảng; 15% là trần có biên.
      expect((boQua + m.CO_TRANG) / n, `${n} dòng: trang SÂU đọc quá sâu`).toBeLessThanOrEqual(0.15);
    }
    expect(src, "đường trang SÂU phải lấy số trang từ trangSau()").toMatch(/const sau = trangSau\(SO_DONG\);/);
    expect(src).not.toMatch(/page: 100\b/);
  });

  it("createdAt dữ liệu thử KHÔNG tương quan với thứ tự chèn — cả toàn bộ lẫn trong từng lô 500", () => {
    const goc = Date.UTC(2026, 0, 1);
    for (const n of [5000, 20000]) {
      const chiSo = Array.from({ length: n }, (_, i) => i);
      const t = chiSo.map((i) => m.thoiDiemTao(i, n, goc).getTime());
      expect(new Set(t).size, "mỗi dòng một thời điểm riêng").toBe(n);
      expect(Math.max(...t)).toBeLessThan(goc);
      expect(Math.abs(tuongQuan(chiSo, t))).toBeLessThan(0.05);
      // FSM xếp được các LÔ vào bất cứ đâu trong bảng; bên trong một lô thì thứ tự chèn giữ nguyên.
      for (let lo = 0; lo < n; lo += 500) {
        expect(Math.abs(tuongQuan(chiSo.slice(lo, lo + 500), t.slice(lo, lo + 500)))).toBeLessThan(0.1);
      }
    }
  });

  it("mã dựng dữ liệu dùng thoiDiemTao cho CẢ khách hàng lẫn báo giá", () => {
    expect(src.match(/createdAt: thoiDiemTao\(lo \+ i, SO_DONG, goc\)/g) ?? []).toHaveLength(2);
  });

  it("timSeqScan đếm số dòng ĐỌC (ra + bị lọc bỏ, nhân số vòng), không phải số dòng ra", () => {
    const ke = {
      "Node Type": "Limit",
      Plans: [{ "Node Type": "Seq Scan", "Relation Name": "Quote", "Actual Rows": 1, "Rows Removed by Filter": 4999, "Actual Loops": 2 }],
    };
    expect(m.timSeqScan(ke).map((s) => [s.bang, s.dong])).toEqual([["Quote", 10000]]);
  });
});
