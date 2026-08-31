/**
 * ============================================================================
 * CỤM xf-observability-gaps — ba lỗ hổng quan trắc, và các chốt để chúng không quay lại.
 *
 * ── LỖ 1: KHÔNG CÓ PROMETHEUS NÀO TỒN TẠI TRONG REPO ───────────────────────
 * Repo có 21 metric ứng dụng, 17 quy tắc cảnh báo đã qua `promtool test rules`, và một bảng Grafana
 * 9 panel. Nhưng `grep -ril prometheus infra/` chỉ ra QUY TẮC và ANNOTATION — không một định nghĩa
 * máy chủ Prometheus nào: không compose, không overlay, không manifest.
 *
 * Hệ quả, cả ba đều im lặng:
 *   · 21 metric không ai thu thập;
 *   · 17 quy tắc cảnh báo KHÔNG THỂ kêu ở bất kỳ môi trường nào (không có gì đánh giá chúng);
 *   · datasource Prometheus của Grafana trỏ vào một chỗ KHÔNG TỒN TẠI — panel vẽ đường trống và
 *     người trực đọc thành "hệ thống đang yên".
 * Đây là dạng hỏng tệ nhất của hệ giám sát: mọi cổng CI đều xanh, mọi file đều có, và không có gì
 * hoạt động.
 *
 * ── LỖ 2: §18 ĐÒI BA METRIC SSE, REPO CÓ MỘT ───────────────────────────────
 * `sse_connections` / `sse_reconnects` / `sse_events`. Repo có `sse_clients` (đúng nghĩa
 * `sse_connections`, khác tên); hai cái còn lại grep toàn repo ra RỖNG.
 *
 * ── LỖ 3: §28 THIẾU BA QUY TẮC ─────────────────────────────────────────────
 *   (a) CSDL chết — không metric `db_up`, không quy tắc. `up` vẫn 1 vì tiến trình Node vẫn trả
 *       /metrics; ban đêm không ai bấm nên 5xx cũng không tăng.
 *   (b) Redis chết — quy tắc DUY NHẤT dính Redis (`QuanlySseBackplaneChet`) gác thêm vế
 *       `sse_backplane_mode{mode="redis"}==1`, nên bản triển khai KHÔNG dùng backplane im lặng
 *       hoàn toàn dù Redis (hàng đợi BullMQ/rate-limit/Pub-Sub SSE — KHÔNG giữ phiên) đã chết.
 *   (c) Đĩa đầy — không metric, không quy tắc. Mà docker-compose.prod.yml đã ghi rõ: đĩa đầy →
 *       Postgres không ghi nổi WAL → MẤT DỮ LIỆU.
 *
 * ── VÌ SAO PHẦN LỚN BÀI DƯỚI ĐÂY ĐỌC FILE HẠ TẦNG ──────────────────────────
 * `npm run check:alerts` đã kiểm CÚ PHÁP, LOGIC và TÊN METRIC của quy tắc. Thứ nó KHÔNG kiểm được
 * — và là thứ đã hỏng suốt — là có ai NẠP chúng hay không. Một quy tắc hoàn hảo không được nạp thì
 * bằng không. Nên các bài ở đây khoá đúng những mối nối giữa file: compose ↔ prometheus.yml ↔
 * alerts.yaml ↔ datasource Grafana.
 *
 * CỐ Ý parse bằng regex/thụt lề thay vì kéo thư viện YAML — cùng lý do đã ghi ở
 * tests/ic-infra-compose.test.js: `yaml` chỉ là phụ thuộc BẮC CẦU, một lượt `npm ci` khác là biến mất.
 * ============================================================================
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const doc = (p) => readFileSync(join(ROOT, p), "utf8");

const COMPOSE = doc("infra/observability/docker-compose.observability.yml");
const PROMYML = doc("infra/observability/prometheus.yml");
const ALERTS = doc("infra/prometheus/alerts.yaml");
const ALERTS_TEST = doc("infra/prometheus/alerts.test.yaml");
const DS = doc("infra/observability/grafana/provisioning/datasources/ds.yaml");
const README = doc("infra/observability/README.md");

// KHÔNG có REDIS_URL → `pub` của sse.ts giữ null → publish/broadcast đi đường CỤC BỘ, nên bài đo
// `sse_events` là tất định dù máy chạy test có Redis hay không (CI có, máy dev thường không).
vi.mock("../src/config.js", () => ({ config: { REDIS_URL: undefined, NODE_ENV: "test" } }));

const sse = await import("../src/sse.js");
const { registry } = await import("../src/observability.js");

/** Giả lập tối thiểu cặp req/res mà `attach` cần (cùng khuôn với tests/sse-shutdown.test.js). */
function gia() {
  const res = {
    daGhi: [],
    writableLength: 0,
    setHeader() {},
    flushHeaders() {},
    status() { return this; },
    json() { return this; },
    write(s) { this.daGhi.push(s); return true; },
    end() {},
    destroy() {},
  };
  const hs = {};
  const req = { on(ev, fn) { hs[ev] = fn; } };
  return { req, res, dongSocket: () => hs.close?.() };
}

/** Giá trị counter theo nhãn; `null` khi chuỗi đó chưa tồn tại. */
async function demSuKien(nhan) {
  const m = await registry.getSingleMetric("sse_events").get();
  const v = m.values.find((x) => x.labels?.event === nhan);
  return v ? v.value : null;
}
async function demNoiLai() {
  const m = await registry.getSingleMetric("sse_reconnects").get();
  return m.values[0]?.value ?? 0;
}

afterEach(() => { vi.useRealTimers(); });

// ── §18: ba metric SSE ──────────────────────────────────────────────────────
describe("§18 — ba metric SSE phải TỒN TẠI", () => {
  it("`sse_clients` là bản hiện thực của `sse_connections` (giữ tên cũ, KHÔNG đổi)", () => {
    // Đổi tên là thay đổi PHÁ VỠ: bảng Grafana và cảnh báo đang dùng tên này. Quan hệ tên được ghi
    // ở docs/operations/MONITORING.md; bài này khoá lại để không ai "sửa cho đúng spec" rồi làm
    // panel + cảnh báo trỏ vào hư không.
    expect(registry.getSingleMetric("sse_clients"), "sse_clients biến mất → bảng điều khiển và cảnh báo SSE trỏ vào metric không tồn tại").toBeTruthy();
    expect(registry.getSingleMetric("sse_connections"), "đừng thêm tên thứ hai cho cùng một số — hai tên là hai bản sẽ trôi khỏi nhau").toBeFalsy();
  });

  it("`sse_reconnects` và `sse_events` phải có thật trong registry", () => {
    for (const ten of ["sse_reconnects", "sse_events"]) {
      expect(registry.getSingleMetric(ten), `${ten} không tồn tại — §18 đòi đích danh tên này`).toBeTruthy();
    }
  });
});

describe("sse_events — đếm KHUNG sự kiện giao thành công", () => {
  it("mỗi kết nối nhận được một khung là một lần tăng (broadcast tới 2 tab = +2)", async () => {
    const truoc = (await demSuKien("changed")) ?? 0;
    const a = gia(), b = gia();
    sse.attach(a.req, a.res, 940101);
    sse.attach(b.req, b.res, 940101); // hai tab của CÙNG người
    sse.emitChange("quote", "update", 1);
    expect(await demSuKien("changed"), "phải đếm theo số lần GIAO, không phải số lần gọi broadcast").toBe(truoc + 2);
    a.dongSocket(); b.dongSocket();
  });

  it("keepalive KHÔNG được tính — nó không phải sự kiện", async () => {
    const a = gia();
    sse.attach(a.req, a.res, 940102);
    const tong = async () => (await registry.getSingleMetric("sse_events").get()).values.reduce((s, v) => s + v.value, 0);
    const truoc = await tong();
    // `attach` ghi ": connected" và keepalive ghi ": keepalive" — cả hai là DÒNG CHÚ THÍCH của giao
    // thức SSE, không có trường `event:`. Đếm chúng vào đây thì con số hoá ra chỉ đo... thời gian.
    expect(a.res.daGhi.join("")).toContain(": connected");
    expect(await tong(), "khung không có trường `event:` mà bị đếm thì sse_events chỉ còn đo thời gian").toBe(truoc);
    a.dongSocket();
  });

  it("tên sự kiện LẠ được gộp về nhãn `khac` — chặn nổ cardinality", async () => {
    // `publish` là hàm export. Một chỗ gọi mới đặt tên động (ghép id, ghép tên người) mà nhãn lấy
    // thẳng tham số thì mỗi giá trị là một chuỗi thời gian riêng — cách nhanh nhất để giết Prometheus.
    const a = gia();
    sse.attach(a.req, a.res, 940103);
    const truoc = (await demSuKien("khac")) ?? 0;
    sse.publish(940103, "su-kien-dong-12345", { x: 1 });
    expect(await demSuKien("su-kien-dong-12345"), "tên động KHÔNG được thành nhãn Prometheus").toBeNull();
    expect(await demSuKien("khac")).toBe(truoc + 1);
    a.dongSocket();
  });
});

describe("sse_reconnects — đo đường realtime có CHẬP CHỜN không", () => {
  it("lần nối ĐẦU TIÊN của một tài khoản KHÔNG phải nối lại", async () => {
    const truoc = await demNoiLai();
    const a = gia();
    sse.attach(a.req, a.res, 940201);
    expect(await demNoiLai(), "đếm lần đầu là nối lại thì mỗi buổi sáng cả công ty đăng nhập sẽ thành một đợt 'chập chờn'").toBe(truoc);
    a.dongSocket();
  });

  it("rớt hết kết nối rồi nối lại NGAY → tính là một lần nối lại", async () => {
    const truoc = await demNoiLai();
    const a = gia();
    sse.attach(a.req, a.res, 940202);
    a.dongSocket(); // rớt về 0 kết nối
    const b = gia();
    sse.attach(b.req, b.res, 940202);
    expect(await demNoiLai()).toBe(truoc + 1);
    b.dongSocket();
  });

  it("mở thêm TAB THỨ HAI không phải nối lại (số kết nối chưa hề về 0)", async () => {
    const truoc = await demNoiLai();
    const a = gia(), b = gia();
    sse.attach(a.req, a.res, 940203);
    sse.attach(b.req, b.res, 940203);
    expect(await demNoiLai(), "không phân biệt được 'mở thêm tab' với 'nối lại' thì con số này vô nghĩa").toBe(truoc);
    a.dongSocket(); b.dongSocket();
  });

  it("quay lại SAU cửa sổ (mặc định 90s) KHÔNG tính — đó là phiên làm việc mới", async () => {
    // Chỉ giả lập `Date`, KHÔNG giả lập setInterval: `attach` đặt một keepalive 25s và giả lập luôn
    // bộ hẹn giờ sẽ biến bài này thành bài kiểm keepalive.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const truoc = await demNoiLai();
    const a = gia();
    sse.attach(a.req, a.res, 940204);
    a.dongSocket();
    vi.setSystemTime(new Date(Date.now() + sse.SSE_RECONNECT_WINDOW_MS + 60_000));
    const b = gia();
    sse.attach(b.req, b.res, 940204);
    expect(await demNoiLai(), "người đi ăn trưa rồi quay lại không phải một lần 'chập chờn'").toBe(truoc);
    b.dongSocket();
  });
});

// ── §28: ba metric sức khoẻ phụ thuộc ───────────────────────────────────────
describe("§28 — metric cho CSDL / Redis / đĩa", () => {
  const GAUGE_SUCKHOE = ["db_up", "redis_up", "redis_configured", "disk_free_bytes", "disk_total_bytes"];

  it("năm gauge phải tồn tại trong registry — ở cấu hình MẶC ĐỊNH", () => {
    for (const ten of GAUGE_SUCKHOE) {
      expect(registry.getSingleMetric(ten), `${ten} không tồn tại → quy tắc cảnh báo dùng nó sẽ KHÔNG BAO GIỜ kêu`).toBeTruthy();
    }
  });

  // ── CHỐT CHO MỘT LỖI ĐÃ XẢY RA THẬT, DO CHÍNH BẢN VÁ §28 SINH RA ──────────
  // Bản vá §28 mở nút `HEALTH_METRICS=0` và ghi trong .env.example rằng bật nó thì "mất cảnh báo
  // CSDL chết". ĐO THẬT THÌ NGƯỢC: prom-client KHỞI TẠO SẴN Gauge KHÔNG NHÃN ở 0, còn nút tắt chỉ
  // chặn phép ĐO chứ không chặn việc ĐĂNG KÝ — nên /metrics vẫn phát `db_up 0` và quy tắc critical
  // `db_up == 0` kêu suốt ngày đêm trên một Postgres hoàn toàn khoẻ. Cảnh báo kêu oan là cảnh báo
  // SẼ BỊ TẮT, tức nút "giảm tải" hoá ra là nút phá hệ giám sát.
  // (`disk_*` thoát nạn chỉ vì TÌNH CỜ có nhãn — prom-client không tạo mẫu mặc định cho metric có
  //  nhãn. Nay cả năm cùng một hành vi CÓ CHỦ Ý.)
  //
  // Bài trên KHÔNG bắt được lỗi này: nó chạy ở cấu hình mặc định nên năm gauge luôn có mặt.
  // Tệ hơn, đọc một mình nó thì cách "sửa" hiển nhiên là bỏ `registers: DK_SUCKHOE` — tức làm lại
  // đúng lỗi vừa vá. Bài dưới đây tồn tại để chặn đúng đường đó.
  it("HEALTH_METRICS=0 thì KHÔNG PHÁT CHUỖI NÀO — không phải phát 0", async () => {
    vi.resetModules();
    const truoc = process.env.HEALTH_METRICS;
    process.env.HEALTH_METRICS = "0";
    try {
      const mod = await import("../src/observability.js");
      const ra = await mod.registry.metrics();
      for (const ten of GAUGE_SUCKHOE) {
        expect(ra, `${ten} vẫn được phát khi đã TẮT → quy tắc "${ten} == 0" sẽ kêu oan trên hệ thống khoẻ`)
          .not.toMatch(new RegExp(`^${ten}[ {]`, "m"));
      }
      // Vế đối chứng: tắt phép đo sức khoẻ KHÔNG được kéo theo các metric khác.
      expect(ra, "tắt HEALTH_METRICS không được làm mất luôn metric thường").toMatch(/^sse_clients[ {]/m);
    } finally {
      if (truoc === undefined) delete process.env.HEALTH_METRICS;
      else process.env.HEALTH_METRICS = truoc;
      vi.resetModules();
    }
  });

  it("`config_missing` chỉ phát ở production — máy dev thiếu SMTP/S3 là bình thường", async () => {
    // Đây là lớp bù cho §10: `src/config.ts` CỐ Ý chỉ console.warn khi thiếu REDIS_URL/S3_*/SMTP_HOST
    // (lập luận: chết cả ứng dụng vì một tính năng phụ còn tệ hơn). Lập luận đó chỉ đứng được nếu có
    // TÍN HIỆU thay thế — mà trước bản vá thì không: quy tắc Redis gác bằng `redis_configured == 1`,
    // nên một production QUÊN đặt REDIS_URL không sinh ra tín hiệu nào ở đâu cả.
    //
    // Gọi thẳng hàm thay vì đổi NODE_ENV rồi nạp lại module — đúng như chú thích của chính nó dặn.
    // Nạp lại với NODE_ENV=production còn kích hoạt fail-fast của config.ts trên các bí mật cỡ test.
    const { capNhatCauHinhThieu, registry: reg } = await import("../src/observability.js");

    expect(await reg.metrics(), "ngoài production KHÔNG được phát chuỗi nào — `absent()` trung thực hơn phát 0")
      .not.toMatch(/^config_missing[ {]/m);

    capNhatCauHinhThieu(true);
    const ra = await reg.metrics();
    expect(ra, "ở production phải phát, nếu không thì §10 vẫn không có lớp bù nào").toMatch(/^config_missing[ {]/m);
    for (const khoa of ["REDIS_URL", "S3_ENDPOINT", "S3_ACCESS_KEY", "S3_SECRET_KEY", "SMTP_HOST", "PII_ENC_KEY"]) {
      expect(ra, `thiếu nhãn key="${khoa}" → quên biến đó ở production vẫn không ai thấy`)
        .toMatch(new RegExp(`config_missing\\{[^}]*key="${khoa}"`));
    }
  });

  it("`redis_configured` TÁCH khỏi `redis_up` — không có nó thì cảnh báo kêu oan ở bản không Redis", () => {
    // Cùng bài học với cặp sse_backplane_up / sse_backplane_mode: `REDIS_URL` là `.optional()`
    // (src/config.ts), nên chạy không Redis là cấu hình HỢP LỆ. Một quy tắc `redis_up == 0` trần
    // sẽ kêu suốt ở đó, và cảnh báo kêu suốt là cảnh báo bị tắt.
    expect(ALERTS, "quy tắc Redis thiếu vế redis_configured → sẽ kêu oan ở bản triển khai cố ý không dùng Redis")
      .toMatch(/redis_configured\s*==\s*1\s+and\b/);
  });

  it("ngưỡng đĩa theo TỈ LỆ, không phải số byte viết cứng", () => {
    // Mẫu số `disk_total_bytes` do chính app phát — cùng khuôn với `export_max_queue_depth`. Viết
    // cứng "dưới 10GB" thì đổi ổ đĩa là quy tắc sai âm thầm.
    expect(ALERTS).toMatch(/disk_free_bytes\s*\/\s*disk_total_bytes/);
  });

  it("ba quy tắc §28 có mặt và mỗi quy tắc có ít nhất một BÀI KIỂM", () => {
    for (const ten of ["QuanlyCsdlKhongToiDuoc", "QuanlyRedisChet", "QuanlyDiaSapDay"]) {
      expect(ALERTS, `thiếu quy tắc ${ten}`).toContain(`alert: ${ten}`);
      expect(ALERTS_TEST, `${ten} chưa có bài kiểm — promtool check rules MÙ với lỗi logic`).toContain(`alertname: ${ten}`);
    }
  });
});

describe("Mọi quy tắc cảnh báo phải có bài kiểm — không chừa cái nào", () => {
  it("không quy tắc nào vắng mặt trong alerts.test.yaml", () => {
    // `promtool check rules` chỉ nói "PromQL này phân tích được". Lỗi LOGIC (thiếu vế `and`, so sai
    // chiều, `for:` quá dài) chỉ lộ ra ở `test rules`. Một quy tắc không có bài kiểm là một quy tắc
    // chưa ai chứng minh là kêu đúng lúc.
    const ten = [...ALERTS.matchAll(/^\s*-\s*alert:\s*(\S+)/gm)].map((m) => m[1]);
    expect(ten.length, "không tách được quy tắc nào — bộ tách hỏng?").toBeGreaterThan(10);
    const thieu = ten.filter((t) => !ALERTS_TEST.includes(`alertname: ${t}`));
    expect(thieu, `quy tắc chưa có bài kiểm: ${thieu.join(", ")}`).toEqual([]);
  });
});

// ── LỖ LỚN NHẤT: có ai NẠP đống quy tắc đó không ────────────────────────────
describe("Phải TỒN TẠI một máy chủ Prometheus trong repo", () => {
  it("ngăn xếp quan sát có service `prometheus`", () => {
    expect(COMPOSE, "không có định nghĩa Prometheus nào thì 21 metric + 17 quy tắc + 9 panel đều là giấy tờ")
      .toMatch(/^\s{2}prometheus:$/m);
  });

  it("Prometheus nạp ĐÚNG bản gốc infra/prometheus/alerts.yaml, không phải bản chép", () => {
    // Hai bản của cùng một tập quy tắc là hai bản sẽ trôi khỏi nhau — và `npm run check:alerts`
    // chỉ kiểm bản gốc, nên bản chép sẽ hỏng mà không cổng CI nào đỏ.
    expect(COMPOSE).toMatch(/\.\/infra\/prometheus\/alerts\.yaml:/);
  });

  it("đường mount quy tắc trong compose KHỚP `rule_files:` của prometheus.yml", () => {
    // Đây là mối nối im lặng nhất trong cả ngăn xếp: lệch một ký tự thì Prometheus khởi động bình
    // thường, /metrics vẫn được scrape, bảng vẫn vẽ — và KHÔNG quy tắc nào được đánh giá.
    const mount = COMPOSE.match(/\.\/infra\/prometheus\/alerts\.yaml:([^\s:]+)/);
    expect(mount, "compose không mount alerts.yaml").toBeTruthy();
    const rules = [...PROMYML.matchAll(/^\s*-\s*(\/etc\/prometheus\/[^\s#]+)/gm)].map((m) => m[1]);
    expect(rules, `rule_files của prometheus.yml (${rules.join(", ")}) không chứa đích mount ${mount[1]}`)
      .toContain(mount[1]);
  });

  it("prometheus.yml được mount vào đúng chỗ `--config.file` trỏ tới", () => {
    const cfg = COMPOSE.match(/--config\.file=(\S+)/);
    expect(cfg, "compose không truyền --config.file").toBeTruthy();
    expect(COMPOSE, `prometheus.yml không được mount vào ${cfg[1]}`)
      .toContain(`./infra/observability/prometheus.yml:${cfg[1]}`);
  });
});

describe("Cấu hình scrape phải THẬT SỰ lấy được số liệu", () => {
  const jobs = [...PROMYML.matchAll(/^\s*-\s*job_name:\s*(\S+)/gm)].map((m) => m[1]);

  it("scrape cả tiến trình app LẪN tiến trình worker", () => {
    // Bỏ worker thì `export_duration_seconds`, `export_jobs_total` và `bullmq_jobs` chỉ có số của
    // đường chạy nội tuyến trong API — tức phần KHÔNG phải đường chạy chính.
    expect(PROMYML, "thiếu target app").toMatch(/app:3000/);
    expect(PROMYML, "thiếu target worker (cổng WORKER_METRICS_PORT, mặc định 9091)").toMatch(/worker:9091/);
  });

  it("tên job của app/worker KHỚP bộ lọc `job=~\"quanly.*\"` mà alerts.yaml dùng", () => {
    // 4 quy tắc lọc theo tiền tố này. Đổi tên job mà quên sửa quy tắc = cảnh báo im lặng vĩnh viễn,
    // và ngay cả `QuanlyKhongConTargetNao` — thứ sinh ra để bắt "mất sạch target" — cũng im, vì
    // chính nó cũng lọc theo tên job.
    expect(ALERTS, "alerts.yaml không còn lọc theo quanly.* — sửa bài này cho khớp").toContain('job=~"quanly.*"');
    const ungDung = jobs.filter((j) => j !== "prometheus");
    expect(ungDung.length, "không có job ứng dụng nào").toBeGreaterThan(0);
    for (const j of ungDung) expect(j, `job "${j}" không khớp quanly.* → mọi quy tắc lọc theo job sẽ bỏ qua nó`).toMatch(/^quanly/);
  });

  it("job tự-giám-sát của Prometheus CỐ Ý không khớp quanly.*", () => {
    // Nếu khớp thì `absent(up{job=~"quanly.*"})` không bao giờ đúng — luôn còn chuỗi `up` của chính
    // Prometheus — và quy tắc "mất sạch target ứng dụng" thành vô dụng.
    expect(jobs, "job tự giám sát nên tên là `prometheus`").toContain("prometheus");
  });

  it("mọi job ứng dụng gửi Bearer — thiếu nó thì production trả 404 im lặng", () => {
    // src/app.ts: production + không METRICS_TOKEN → 404; có token nhưng Bearer sai → 401. Cả hai
    // đều là "scrape hỏng mà không ai báo lỗi".
    for (const khoi of PROMYML.split(/^\s*-\s*job_name:/m).slice(1)) {
      const ten = khoi.split("\n")[0].trim();
      if (ten === "prometheus") continue; // job tự giám sát, không đi qua /metrics của ứng dụng
      expect(khoi, `job "${ten}" scrape /metrics mà không gửi Bearer → production trả 404/401`).toMatch(/authorization:/);
    }
  });

  it("credentials_file trỏ đúng chỗ compose bày secret ra", () => {
    const cf = PROMYML.match(/credentials_file:\s*(\S+)/);
    expect(cf, "không khai credentials_file").toBeTruthy();
    // Prometheus KHÔNG nội suy biến môi trường trong cấu hình, nên token BẮT BUỘC đi bằng đường tệp.
    expect(PROMYML, "đừng viết token thẳng vào cấu hình — nó được tracked trong git").not.toMatch(/credentials:\s*\S/);
    expect(COMPOSE, "compose không bày secret metrics_token").toMatch(/metrics_token:/);
    expect(cf[1]).toBe("/run/secrets/metrics_token");
  });

  it("compose DỪNG ngay khi thiếu METRICS_TOKEN thay vì dựng một hệ giám sát mù", () => {
    expect(COMPOSE, "không có ${METRICS_TOKEN:?…} → thiếu token vẫn `up` được, rồi scrape ra 404 mãi mãi")
      .toMatch(/\$\{METRICS_TOKEN:\?/);
  });
});

describe("Datasource Grafana phải trỏ vào Prometheus có thật", () => {
  it("KHÔNG dùng dạng `${VAR:-mặc định}` — Grafana không hiểu cú pháp đó", () => {
    // Grafana nội suy kiểu `os.ExpandEnv`: hiểu `$VAR` và `${VAR}`, KHÔNG hiểu dạng-có-mặc-định của
    // shell. `${PROMETHEUS_URL:-http://prometheus:9090}` nở ra RỖNG → datasource URL trống → mọi
    // panel metric vẽ đường không dữ liệu. Bước [A4] của check-alerts soi TÊN METRIC, không soi URL,
    // nên nó không bắt được lỗi này.
    // Bỏ dòng chú thích trước khi soi: khối chú thích trong ds.yaml CỐ Ý dẫn lại nguyên văn cú pháp
    // hỏng để giải thích vì sao không được dùng — soi cả chú thích thì bài này đỏ vì chính lời cảnh báo.
    const thuc = DS.split("\n").filter((d) => !/^\s*#/.test(d)).join("\n");
    expect(thuc, "URL datasource dùng cú pháp mặc-định của shell → Grafana nở ra chuỗi rỗng").not.toMatch(/\$\{[A-Z_]+:-/);
  });

  it("uid datasource khớp uid mà bảng điều khiển tham chiếu", () => {
    const bang = JSON.parse(doc("infra/observability/grafana/dashboards/quanly.json"));
    const uids = new Set();
    for (const p of bang.panels || []) {
      for (const t of p.targets || []) {
        const d = t.datasource || p.datasource;
        if (d?.type === "prometheus" && d.uid) uids.add(d.uid);
      }
    }
    expect(uids.size, "bảng không tham chiếu datasource prometheus nào").toBeGreaterThan(0);
    for (const u of uids) expect(DS, `bảng trỏ uid "${u}" nhưng ds.yaml không khai uid đó → panel không có nguồn`).toMatch(new RegExp(`uid:\\s*${u}\\b`));
  });
});

describe("Tài liệu phải nói THẬT về chỗ cảnh báo DỪNG LẠI", () => {
  it("README ghi rõ tình trạng Alertmanager và hệ quả", () => {
    // "Có cảnh báo" theo nghĩa kỹ thuật (quy tắc chuyển sang firing) KHÁC HẲN "có cảnh báo" theo
    // nghĩa vận hành (có người bị đánh thức). README phải nói rõ đang ở vế nào.
    expect(README).toMatch(/Alertmanager/);
    expect(README, "README nhắc Alertmanager nhưng không nói cảnh báo dừng ở đâu").toMatch(/\/alerts|không ai|KHÔNG AI/);
  });

  it("SLO.md không còn khai 'chưa cấu hình cảnh báo nào' trong khi repo có 17 quy tắc", () => {
    const slo = doc("docs/operations/SLO.md");
    expect(slo, "SLO.md phải trỏ tới tập quy tắc có thật").toMatch(/infra\/prometheus\/alerts\.yaml/);
    expect(slo, "câu 'Chưa cái nào được cấu hình' nói ngược mã nguồn").not.toMatch(/Chưa cái nào được cấu hình/);
  });

  it("MONITORING.md không còn liệt kê metric ĐÃ BỊ GỠ", () => {
    // `quote_operations_total` bị gỡ khỏi src/observability.ts vì khai mà không chỗ nào `.inc()`.
    // Bảng metric trong tài liệu vẫn liệt kê nó — người đọc sẽ dựng panel/cảnh báo trên một metric
    // không tồn tại.
    const mon = doc("docs/operations/MONITORING.md");
    // Soi các DÒNG BẢNG (`| \`ten\` |`), không soi văn xuôi: tài liệu CÓ QUYỀN nhắc tới metric đã gỡ
    // để giải thích vì sao nó biến mất — thứ không được phép là liệt kê nó như một metric đang có.
    const dongBang = mon.split("\n").filter((d) => /^\|\s*`/.test(d));
    expect(dongBang.length, "không tách được dòng bảng metric nào — bảng đã đổi định dạng?").toBeGreaterThan(10);
    expect(dongBang.join("\n"), "quote_operations_total đã bị gỡ khỏi src/observability.ts, đừng liệt kê nó như metric đang có")
      .not.toMatch(/quote_operations_total/);
    for (const ten of ["sse_reconnects", "sse_events", "db_up", "redis_up", "disk_free_bytes", "bullmq_jobs"]) {
      expect(dongBang.join("\n"), `bảng metric thiếu ${ten}`).toContain(ten);
    }
  });
});
