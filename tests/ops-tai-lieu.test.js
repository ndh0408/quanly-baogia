/**
 * OPS · tài liệu nói ĐÚNG mã và ĐÚNG thực tế đã đo (audit 2026-09-22).
 * DOC-01, DOC-04, DOC-05, DOC-06, DOC-07, DOC-09, DOC-10, DOC-12, DOC-13, DOC-15.
 *
 * Tài liệu vận hành là thứ được làm theo NGUYÊN VĂN lúc 2 giờ sáng — mỗi bài dưới đây khoá một câu
 * sai đã tìm thấy, để nó không quay lại khi ai đó chép tài liệu cũ.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const GOC = path.resolve(import.meta.dirname, "..");
const doc = (f) => readFileSync(path.join(GOC, f), "utf8");
const khoiLenh = (md) => [...md.matchAll(/```[a-z]*\n([\s\S]*?)```/g)].map((m) => m[1]).join("\n");

describe("DOC-01 — trạng thái sao lưu production ghi đúng phép đo, tách khỏi 'cơ chế trong repo'", () => {
  for (const f of ["docs/operations/BACKUP_RESTORE.md", "docs/operations/DISASTER_RECOVERY.md"]) {
    it(`${f} có bảng trạng thái đã đo, nói rõ CHƯA có bản ngoài máy và CHƯA sao lưu kho object`, () => {
      const s = doc(f);
      expect(s).toMatch(/Trạng thái production (ĐÃ ĐO|đã đo)/);
      expect(s).toMatch(/KHÔNG CÓ|không có bản sao/i);
      expect(s).toMatch(/kho object/i);
    });
  }
  it("BACKUP_RESTORE không còn ghi quanly-backup 'pg_dump → gzip → checksum → NAS' như thể NAS luôn có", () => {
    expect(doc("docs/operations/BACKUP_RESTORE.md")).not.toMatch(/`pg_dump` → gzip → checksum → NAS \|/);
  });
  it("SLO không còn khẳng định nhóm sao lưu 'đã được đo và có chốt tự động'", () => {
    expect(doc("docs/operations/SLO.md")).not.toMatch(/đã được đo và có chốt tự động/);
  });
  it("DR nhắc khoá dựng lại server giữ NGOÀI repo, ở kho khoá của chủ repo", () => {
    expect(doc("docs/operations/DISASTER_RECOVERY.md")).toMatch(/kho khoá của chủ repo/);
  });
});

describe("DOC-04 — 'converted là bất biến' đã sai từ 2026-09-07", () => {
  for (const f of ["docs/product/QUOTE_WORKFLOW.md", "docs/architecture/DATA_FLOW.md", "docs/architecture/diagrams/quote-lifecycle.md", "docs/architecture/diagrams/quote-save.md", "docs/product/ROLES_PERMISSIONS.md"]) {
    it(`${f}: không còn nói canEdit khoá theo converted/lost`, () => {
      const s = doc(f);
      for (const cu of [
        "`canEdit`: **không** phải `converted`/`lost`",
        "`converted`/`lost` là **bất biến**",
        "BẤT BIẾN. canEdit trả false",
        "canEdit — converted/lost là BẤT BIẾN",
        "terminal bất biến",
        "**`converted` là bất biến.** Không sửa",
      ]) expect(s, `còn câu cũ: ${cu}`).not.toContain(cu);
    });
  }
});

describe("DOC-05 — runbook không dùng lệnh luôn thất bại trên production", () => {
  it("không khối lệnh nào trong docs/operations/*.md gọi `curl … localhost:3000`", () => {
    const tep = readdirSync(path.join(GOC, "docs/operations")).filter((f) => f.endsWith(".md"));
    // Bỏ dòng chú thích `#` trong khối lệnh — chúng được phép KỂ lại lệnh hỏng để giải thích.
    for (const f of tep) {
      const lenh = khoiLenh(doc(`docs/operations/${f}`)).split("\n").filter((d) => !/^\s*#/.test(d)).join("\n");
      expect(lenh, f).not.toMatch(/curl[^\n]*localhost:3000/);
    }
  });
  it("mục Redis chết nói đúng: rate-limit rơi về bộ đếm trong bộ nhớ", () => {
    const s = doc("docs/operations/INCIDENT_RESPONSE.md");
    expect(s).not.toMatch(/rate-limit theo IP \*\*bị bỏ qua\*\*/);
    expect(s).toMatch(/trong bộ\s+nhớ/);
  });
});

describe("DOC-06 — khôi phục CSDL dừng app/worker TRƯỚC khi nạp", () => {
  it("DR: bước dừng app/worker đứng trước lệnh nạp dump", () => {
    const s = doc("docs/operations/DISASTER_RECOVERY.md");
    const dung = s.indexOf("stop app worker");
    const nap = s.indexOf("| docker exec -i quanly-postgres psql -U quanly -d quanly -v ON_ERROR_STOP=1");
    expect(dung).toBeGreaterThan(-1);
    expect(nap).toBeGreaterThan(dung);
  });
});

describe("DOC-07 — tệp bàn giao không tự xưng 'private' trên repo public", () => {
  it("docx bàn giao không còn ghi repo '(private)' và nói thẳng repo đang công khai", async () => {
    const { default: JSZip } = await import("jszip");
    const z = await JSZip.loadAsync(readFileSync(path.join(GOC, "docs/handoff/QuanLY_Ban_Giao_Du_An.docx")));
    const x = (await z.file("word/document.xml").async("string")).replace(/<[^>]+>/g, "");
    expect(x).not.toMatch(/quanly-baogia \(private\)/);
    expect(x).toMatch(/CÔNG KHAI/);
  });
  it("không còn IP NAS nội bộ trong tài liệu vận hành", () => {
    expect(doc("docs/operations/DISASTER_RECOVERY.md")).not.toMatch(/192\.168\.\d+\.\d+/);
    expect(doc("scripts/backup/install-backup.sh")).not.toMatch(/192\.168\.\d+\.\d+/);
  });
});

describe("DOC-09 — sơ đồ request đúng thứ tự app.ts", () => {
  it("apiLimiter đứng TRƯỚC giải nén và csrfGuard", () => {
    const s = doc("docs/architecture/diagrams/request-lifecycle.md");
    expect(s.indexOf('RL["apiLimiter')).toBeLessThan(s.indexOf('DEC["decompressBody'));
    expect(s).not.toMatch(/CSRF --> RL/);
  });
  it("SECURITY_MODEL/SECURITY không còn nói rate-limit bỏ qua khi Redis chết / '15 limiter'", () => {
    expect(doc("docs/architecture/SECURITY_MODEL.md")).not.toMatch(/\*\*Rate limit bỏ qua khi Redis chết\.\*\*/);
    expect(doc("SECURITY.md")).not.toMatch(/15 limiter/);
  });
});

describe("DOC-10 — nhánh Hà Nội mô tả mô hình mới (Quote.hnTables, khoá Quote, hnRev)", () => {
  it("quote-save.md không còn khoá QuoteSheet / suy đoán theo sheetId cho saveHn", () => {
    const s = doc("docs/architecture/diagrams/quote-save.md");
    expect(s).not.toMatch(/sheetId client gửi/);
    expect(s).toMatch(/hnRev/);
  });
  it("quote-lifecycle.md: tiền Hà Nội nằm ở Quote.hnTables", () => {
    expect(doc("docs/architecture/diagrams/quote-lifecycle.md")).toMatch(/Quote\.hnTables/);
  });
});

describe("DOC-12 / DOC-15 — phiên bản & tài liệu phụ", () => {
  it("README không còn ghi TypeScript 5.7 / Node 22", () => {
    const s = doc("README.md");
    expect(s).not.toMatch(/TypeScript 5\.7/);
    expect(s).not.toMatch(/Node\.js 22/);
  });
  it("infra/k8s/README nói rõ chưa dùng cho production và không trỏ minio.yaml như có thật", () => {
    const s = doc("infra/k8s/README.md");
    expect(s).toMatch(/CHƯA DÙNG CHO PRODUCTION/);
    expect(s).not.toMatch(/`minio\.yaml` is included/);
  });
  it("fonts/README trỏ src/pdf.ts, không còn hướng dẫn apt-get cho image alpine", () => {
    const s = doc("fonts/README.md");
    expect(s).not.toMatch(/src\/pdf\.js/);
    expect(s).not.toMatch(/apt-get install/);
  });
});
