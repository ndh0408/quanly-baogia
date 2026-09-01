// CỔNG SỐ LIỆU TÀI LIỆU — kiểm LOGIC của scripts/ci/check-doc-numbers.mjs, không chỉ chạy nó.
//
// ── VÌ SAO KHÔNG CHỈ GỌI `--check` RỒI XEM MÃ THOÁT ────────────────────────
// Một cổng "xanh" nói được hai điều rất khác nhau: "đã soi và không thấy gì" hoặc "chẳng soi cái
// gì cả". Một lỗi đánh máy trong regex đơn vị (`/^bươc/` thiếu dấu) làm cổng ngừng bắt được BẤT KỲ
// con số nào — và vẫn thoát 0, vẫn in ✓. Đó đúng là hình dạng tệ nhất của lỗi ngầm: cổng nói xanh
// về một thứ nó không hề kiểm.
//
// Nên bài dưới đây kẹp cổng từ CẢ HAI PHÍA, trên dữ liệu dựng sẵn (không phụ thuộc cây thật):
//   · số SAI thì PHẢI bị bắt      → chứng minh cổng còn răng;
//   · số LỊCH SỬ thì PHẢI bỏ qua  → chứng minh cổng không báo động giả, thứ khiến nó bị tắt đi.
//
// Phần cuối kiểm các HÀM ĐO trên cây thật: mỗi hàm đo được đối chiếu với một phép đếm ĐỘC LẬP
// viết ngay trong bài (đọc thẳng tệp nguồn), chứ không gọi lại chính hàm đó.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import {
  PHEP_DO,
  quet,
  danhDauLichSu,
  tachDoan,
  danhSachTep,
  doTatCa,
  NGOAI_PHAM_VI,
} from "../scripts/ci/check-doc-numbers.mjs";

const GOC = path.resolve(import.meta.dirname, "..");
const doc = (p) => readFileSync(path.join(GOC, p), "utf8");

// ── CHỈ CHẠY ĐƯỢC TRONG MỘT GIT REPO ────────────────────────────────────────
// `doTatCa()` → `scripts/ci/check-doc-numbers.mjs` đếm tệp bằng `git ls-files`, nên nó cần
// metadata của git. Bản ship lên máy chủ đi qua `git archive | tar x` (deploy.sh) — thư mục ở đó
// KHÔNG có `.git`, và lệnh kia ngã với "fatal: not a git repository" ngay ở mức module, tức cả
// file chết ở bước collect chứ không phải đỏ một bài. Trong lượt chạy trên hạ tầng dev
// (`test-on-dev.sh`, mount thẳng thư mục đã ship) thì điều đó xảy ra MỖI LƯỢT.
//
// Bỏ qua CÓ LÝ DO, không im lặng: in một dòng nói rõ vì sao, để không ai nhìn con số "đã chạy"
// mà tưởng cổng này vừa gác. Nơi nó thật sự cần gác — máy lập trình viên và CI, cả hai đều có
// `.git` — thì nó vẫn chạy đủ.
const laGitRepo = (() => {
  try {
    execFileSync("git", ["rev-parse", "--git-dir"], { cwd: GOC, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();
if (!laGitRepo) {
   
  console.warn("[xg-doc-numbers] BỎ QUA: thư mục không phải git repo (bản ship qua `git archive` không mang .git), mà check-doc-numbers.mjs đếm bằng `git ls-files`.");
}

// Đo MỘT LẦN ở mức module: `doTatCa()` gọi `endpoint-inventory` và đọc chục tệp.
const soThuc = laGitRepo ? await doTatCa() : null;

// Số đo GIẢ, cố định — bài kiểm logic không được đổi kết quả khi ai đó thêm một quy tắc cảnh báo.
const GIA = {
  "quy-tac-canh-bao": 17,
  "nhom-quy-tac": 6,
  "bai-promtool": 28,
  "buoc-ui-smoke": 18,
  metric: 21,
  endpoint: 137,
  adr: 9,
  "tep-test-backend": 177,
  "tep-test-web": 21,
};
const q = (vanBan) => quet(vanBan, GIA);
const lech = (vanBan) => q(vanBan).filter((k) => !k.khop);

describe.runIf(laGitRepo)("bắt được số SAI", () => {
  it("số quy tắc cảnh báo lệch → báo, kèm đúng số dòng và cả hai con số", () => {
    const r = lech("dòng đệm\n`alerts.yaml` có 14 quy tắc cảnh báo.\n");
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ id: "quy-tac-canh-bao", dong: 2, soTaiLieu: 14, soThuc: 17 });
  });

  it("bắt cả lối viết tiếng Anh `rule` lẫn lối in đậm markdown", () => {
    expect(lech("Cảnh báo: **14 rule** đang bật.")).toHaveLength(1);
  });

  it("mỗi đại lượng đều còn răng — không cái nào chết âm thầm vì lỗi regex", () => {
    // Nếu một mẫu đơn vị hỏng (thiếu dấu tiếng Việt, quên `^`), đại lượng đó ngừng bắt được gì
    // mà cổng vẫn xanh. Bài này ép TỪNG đại lượng phải bắt được ít nhất một câu sai.
    const cau = {
      "quy-tac-canh-bao": "alerts.yaml có 99 quy tắc",
      "nhom-quy-tac": "`alerts.yaml` — 99 nhóm quy tắc",
      "bai-promtool": "alerts.test.yaml có 99 bài promtool test rules",
      "buoc-ui-smoke": "ui-smoke.mjs lái Chromium qua 99 bước",
      metric: "src/observability.ts khai 99 metric",
      endpoint: "ma trận phủ 99 endpoint",
      adr: "repo có 99 ADR",
      "tep-test-backend": "`npx vitest run` (backend): 99 tệp",
      "tep-test-web": "`cd web && npx vitest run`: 99 tệp",
    };
    expect(Object.keys(cau).sort()).toEqual(Object.keys(PHEP_DO).sort());
    for (const [id, s] of Object.entries(cau)) {
      const r = lech(s).filter((k) => k.id === id);
      expect(r.length, `đại lượng "${id}" KHÔNG bắt được câu sai: ${s}`).toBeGreaterThan(0);
      expect(r[0].soTaiLieu).toBe(99);
    }
  });

  it("số ĐÚNG thì không báo", () => {
    expect(lech("alerts.yaml có 17 quy tắc và 6 nhóm quy tắc.")).toHaveLength(0);
  });
});

describe.runIf(laGitRepo)("KHÔNG báo số lịch sử — quy ước khai mốc", () => {
  it("mốc bằng lời làm mờ số đứng SAU nó trong cùng đoạn", () => {
    expect(lech("Trước đợt 2026-08-27 hai con số này là **14 metric và 14 quy tắc**.")).toHaveLength(0);
  });

  it("mốc ở dòng trên vẫn phủ dòng dưới KHI CÙNG MỘT ĐOẠN", () => {
    // Ca thật: infra/observability/README.md — câu trải ba dòng, số nằm ở dòng thứ ba.
    const s = "Trước đợt 2026-08-27 hai con số này là 14 metric và 14 quy tắc. Đợt đó thêm 7 metric\n" +
      "(`db_up`, `disk_free_bytes`)\n" +
      "và 3 quy tắc (`QuanlyRedisChet`).";
    expect(lech(s)).toHaveLength(0);
  });

  it("mốc KHÔNG tràn qua dòng trống — số hiện tại ở đoạn sau vẫn bị soi", () => {
    const s = "Trước đợt 2026-08-27 là 14 quy tắc.\n\nNay alerts.yaml có 14 quy tắc.";
    const r = lech(s);
    expect(r).toHaveLength(1);
    expect(r[0].dong).toBe(3);
  });

  it("mốc KHÔNG tràn sang hàng bảng khác — nếu không, một ô làm mờ cả bảng", () => {
    const s = "| Phase 0 | ảnh chụp lúc Phase 0: 6 ADR |\n| Nay | alerts.yaml có 14 quy tắc |";
    const r = lech(s);
    expect(r.map((k) => k.dong)).toEqual([2]);
  });

  it("mốc chỉ phủ VỀ SAU: số hiện tại đứng TRƯỚC mốc trong cùng đoạn vẫn bị soi", () => {
    // Ca thật: docs/REMAINING_RISKS.md mục "Quy tắc cảnh báo Prometheus" — dòng đầu là số hiện
    // tại, mốc nằm ở dòng sau, số lịch sử ở dòng sau nữa.
    const s = "`alerts.yaml` — 14 quy tắc, 6 nhóm\nthật. Trước đó repo không có quy tắc nào\n(rỗng): 14 metric (số của mốc đó — nay là 21)";
    const r = lech(s);
    expect(r.map((k) => k.dong)).toEqual([1]); // chỉ dòng 1, KHÔNG có dòng 3
  });

  it("nhãn tường minh <!-- so-lich-su --> phủ chính dòng đó", () => {
    expect(lech("Ma trận cũ phủ 133 endpoint. <!-- so-lich-su -->")).toHaveLength(0);
  });

  it("nhãn tường minh đặt ở dòng NGAY TRƯỚC cũng có tác dụng", () => {
    expect(lech("<!-- so-lich-su -->\nMa trận cũ phủ 133 endpoint.")).toHaveLength(0);
  });

  it("dạng tỉ lệ N/M là lời khai của lúc đó, không phải tổng hiện tại", () => {
    expect(lech("| **8/8 ADR** | mỗi cái nay có mục Đường lùi |")).toHaveLength(0);
    expect(lech("`endpoint-inventory.mjs` khớp 133/133 endpoint")).toHaveLength(0);
  });

  it("danhDauLichSu trả đúng mặt nạ theo từng dòng", () => {
    const mat = danhDauLichSu(["số hiện tại", "bản đầu ghi 133", "vẫn trong đoạn cũ", "", "đoạn mới"]);
    expect(mat).toEqual([false, true, true, false, false]);
  });
});

describe.runIf(laGitRepo)("KHÔNG báo động giả — những ca đã thật sự gặp khi dựng cổng", () => {
  it.each([
    ["S3_ENDPOINT không phải '3 endpoint'", ': "${S3_ENDPOINT:=http://127.0.0.1:9000}"'],
    ["app:3000/metrics không phải '3000 metric'", "scrape `app:3000/metrics` và `worker:9091/metrics`"],
    ["tên tệp hq3-bullmq-metrics không phải '3 metric'", "đo trong `tests/hq3-bullmq-metrics.test.js`"],
    ["16 MB … endpoint nào — số là dung lượng, không phải số endpoint", "dùng chung 16 MB nghĩa là bơm được vào bất kỳ endpoint nào"],
    ["/api/v1/rules không phải '1 rule'", "wget -qO- http://127.0.0.1:9090/api/v1/rules"],
    ["tiêu đề mục con của ma trận khai số NHÓM, không phải tổng", "## `/api/auth` — 12 endpoint"],
    ["mục 'Ngoài router' cũng là số nhóm", "## Ngoài router — 9 endpoint"],
    ["wizard 3 bước là bước MÀN HÌNH, không phải bước của smoke", "Chromium thật, 18 bước: … tạo báo giá qua wizard 3 bước → lưu"],
    ["'thêm 7 endpoint' là mức tăng, không phải tổng", "Đợt 2 vá thêm 7 endpoint: `/api/files/sign-download`"],
  ])("%s", (_ten, vanBan) => {
    expect(lech(vanBan)).toHaveLength(0);
  });

  it("đơn vị dùng chung: 'bước' của verify KHÔNG bị chấm theo bước của ui-smoke", () => {
    // Ca thật, docs/REMAINING_RISKS.md bảng Phase: hai đại lượng khác nhau, cùng đơn vị, CÙNG DÒNG.
    const s = "| 9 · Final QA | `npm run verify` nay **13 bước**, gồm quét bảo mật, smoke giao diện Chromium 18 bước, EXPLAIN ANALYZE |";
    const r = q(s);
    expect(r.filter((k) => k.id === "buoc-ui-smoke").map((k) => k.soTaiLieu)).toEqual([18]);
    expect(lech(s)).toHaveLength(0);
  });

  it("đơn vị dùng chung: 'tệp' của web KHÔNG bị chấm theo số tệp backend", () => {
    const s = "| `npx vitest run` (backend) | **177 tệp** |\n| `npx vitest run` trong `web/` | **21 tệp** |";
    const r = q(s);
    expect(r.map((k) => [k.id, k.soTaiLieu])).toEqual([
      ["tep-test-backend", 177],
      ["tep-test-web", 21],
    ]);
  });

  it("thiếu neo thì BỎ QUA, không đoán", () => {
    // "18 bước" mà không có gì cho biết là bước của cái gì → cổng im lặng. Bỏ sót còn sửa được;
    // đoán sai thì cổng bị tắt.
    expect(q("Quy trình gồm 7 bước.")).toHaveLength(0);
    expect(q("Đợt này chạm 40 tệp.")).toHaveLength(0);
  });

  it("tachDoan cắt một dòng bảng thành từng lời khai riêng", () => {
    expect(tachDoan("| a | b, c |").map((d) => d.text.trim())).toEqual(["", "a", "b", "c", ""]);
    // Vị trí bắt đầu phải đúng: cửa sổ "40 ký tự trước con số" của `loaiTru` tính từ đó.
    expect(tachDoan("| a | b, c |").map((d) => d.tu)).toEqual([0, 1, 5, 8, 12]);
  });
});

describe.runIf(laGitRepo)("phạm vi quét", () => {
  it("bỏ CHANGELOG.md, docs/archive/**, chính cổng, và bài kiểm này", () => {
    for (const f of [
      "CHANGELOG.md",
      "docs/archive/audits/SECURITY_AUDIT_2026-08.md",
      "scripts/ci/check-doc-numbers.mjs",
      "tests/xg-doc-numbers.test.js",
    ]) {
      expect(NGOAI_PHAM_VI.some((bo) => bo(f)), `${f} phải nằm NGOÀI phạm vi`).toBe(true);
    }
  });

  it("có quét những tệp tài liệu chính — danh sách không được rỗng vì lỗi lọc", () => {
    const ds = danhSachTep();
    for (const f of ["AGENTS.md", "README.md", "docs/REMAINING_RISKS.md", "infra/observability/README.md"]) {
      expect(ds, `thiếu ${f}`).toContain(f);
    }
    expect(ds.some((f) => f === "CHANGELOG.md")).toBe(false);
  });
});

describe.runIf(laGitRepo)("hàm đo — đối chiếu với phép đếm ĐỘC LẬP trên cây thật", () => {
  // Mỗi khẳng định dưới đây đếm lại bằng một cách KHÁC với cách hàm đo dùng. Đếm lại bằng chính
  // hàm đo thì bài test chỉ chứng minh `x === x`.

  it("số quy tắc cảnh báo = số khoá `alert:` trong alerts.yaml", () => {
    const n = doc("infra/prometheus/alerts.yaml").split("\n").filter((d) => d.trimStart().startsWith("- alert:")).length;
    expect(soThuc["quy-tac-canh-bao"]).toBe(n);
    expect(n).toBeGreaterThan(0);
  });

  it("số nhóm quy tắc = số mục `- name:` ở mức thụt 2 dấu cách", () => {
    const n = doc("infra/prometheus/alerts.yaml").split("\n").filter((d) => /^ {2}- name:/.test(d)).length;
    expect(soThuc["nhom-quy-tac"]).toBe(n);
    expect(n).toBeGreaterThan(0);
  });

  it("số bài promtool = số khối `alert_rule_test:`", () => {
    const n = doc("infra/prometheus/alerts.test.yaml").split("\n").filter((d) => d.includes("alert_rule_test:")).length;
    expect(soThuc["bai-promtool"]).toBe(n);
  });

  it("số bước ui-smoke = số lời gọi buoc( trong ui-smoke.mjs", () => {
    const n = doc("scripts/ci/ui-smoke.mjs").split("\n").filter((d) => /^\s*(await )?buoc\("/.test(d)).length;
    expect(soThuc["buoc-ui-smoke"]).toBe(n);
  });

  it("số metric = số khoá `name: \"...\"` trong src/observability.ts", () => {
    const n = doc("src/observability.ts").split("\n").filter((d) => /name: "[a-z_]+"/.test(d)).length;
    expect(soThuc.metric).toBe(n);
  });

  it("số endpoint = dòng TỔNG mà endpoint-inventory.mjs tự in ra", () => {
    const ra = execFileSync("node", ["scripts/ci/endpoint-inventory.mjs"], { cwd: GOC, encoding: "utf8", maxBuffer: 32 << 20 });
    expect(soThuc.endpoint).toBe(Number(ra.match(/TỔNG: (\d+) endpoint/)[1]));
  });

  it("số tệp (ADR, test backend, test web) = số dòng `git ls-files` tương ứng", () => {
    const ls = (...mau) => execFileSync("git", ["ls-files", ...mau], { cwd: GOC, encoding: "utf8" }).split("\n").filter(Boolean).length;
    expect(soThuc.adr).toBe(ls("docs/adr/[0-9][0-9][0-9][0-9]-*.md"));
    expect(soThuc["tep-test-backend"]).toBe(ls("tests/*.test.js"));
    expect(soThuc["tep-test-web"]).toBe(ls("web/src/**/*.test.ts", "web/src/**/*.test.tsx"));
  });

  it("mỗi đại lượng khai một `lenh` đo lại, và `lenh` đó phải chạy ra ĐÚNG con số", () => {
    // Chốt đắt giá nhất của bộ này: thông báo lỗi bảo người ta "đo lại bằng lệnh X". Nếu X ra số
    // khác hàm đo thì lời hướng dẫn đó là nói dối, và người sửa sẽ sửa tài liệu thành số sai.
    for (const [id, dl] of Object.entries(PHEP_DO)) {
      expect(dl.lenh, `${id} thiếu lệnh đo lại`).toBeTruthy();
      // endpoint chạy qua node và in cả bảng — đã đối chiếu ở bài trên, không chạy lại ở đây.
      if (id === "endpoint") continue;
      const ra = execFileSync("bash", ["-c", dl.lenh], { cwd: GOC, encoding: "utf8", maxBuffer: 32 << 20 });
      expect(Number(ra.trim()), `lệnh của "${id}" ra ${ra.trim()}, hàm đo ra ${soThuc[id]}`).toBe(soThuc[id]);
    }
  });
});
