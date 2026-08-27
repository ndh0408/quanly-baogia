// W1 — IMPORT_MAX_QUEUED đặt RỖNG phải rơi về MẶC ĐỊNH, không phải 0.
//
// ── LỖI ─────────────────────────────────────────────────────────────────────
// `soNguyen` (src/routes/import.routes.ts) dùng thẳng `Number(raw)`. `Number("")` và
// `Number("   ")` đều bằng 0 và đều `Number.isFinite`, nên với sàn 0 —
// `IMPORT_MAX_QUEUED = soNguyen(env, 4, 0)` — một biến môi trường RỖNG lọt qua kiểm tra và cho
// ra trần hàng chờ 0, tức TẮT HẲN hàng chờ: mọi lượt nhập vượt IMPORT_MAX_CONCURRENT bị 429
// ngay thay vì được xếp hàng chờ tối đa IMPORT_WAIT_MS.
//
// Vì sao đáng lo: .env.example (dòng ~225) ghi sẵn `# IMPORT_MAX_QUEUED=4`. Bỏ dấu `#` rồi xoá
// số là thao tác rất dễ xảy ra, và hệ hỏng IM LẶNG — không log, chỉ 429 lác đác lúc tải cao.
//
// ĐO ĐƯỢC trên mã CŨ: `_tranNhap.MAX_QUEUED` = 0 (chạy chính bài này trước khi vá, xem
// AssertionError "expected +0 to be 4").
//
// Env phải đặt TRƯỚC khi nạp module vì trần được đọc một lần lúc nạp — nên nạp động.
process.env.IMPORT_MAX_QUEUED = "";

import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const { _tranNhap, _soNguyen } = await import("../src/routes/import.routes.js");

describe("W1 — IMPORT_MAX_QUEUED rỗng", () => {
  it("trần hàng chờ rơi về mặc định 4 chứ không phải 0", () => {
    expect(process.env.IMPORT_MAX_QUEUED).toBe("");
    expect(_tranNhap.MAX_QUEUED).toBe(4);
  });

  it("hệ quả hành vi: lượt vượt trần vẫn được XẾP HÀNG, không bị từ chối ngay", async () => {
    // Lấp đủ số suất chạy song song trước đã.
    for (let i = 0; i < _tranNhap.MAX_CONCURRENT; i++) await _tranNhap.xin();
    expect(_tranNhap.soDangChay()).toBe(_tranNhap.MAX_CONCURRENT);

    // Lượt kế: với MAX_QUEUED=0 (mã cũ) promise này bị reject NGAY (429).
    let daNhan = false;
    let daTuChoi = null;
    const cho = _tranNhap.xin().then(() => { daNhan = true; }, (e) => { daTuChoi = e; });
    await Promise.resolve();
    expect(daTuChoi).toBe(null);
    expect(_tranNhap.soDangCho()).toBe(1);

    // Trả một suất → người đang chờ được chuyển tay.
    _tranNhap.tra();
    await cho;
    expect(daNhan).toBe(true);
    expect(_tranNhap.soDangCho()).toBe(0);
  });

  afterEach(() => {
    // Dọn sạch phễu để bài sau không thừa suất.
    while (_tranNhap.soDangChay() > 0 || _tranNhap.soDangCho() > 0) _tranNhap.tra();
  });
});

describe("W1 — soNguyen: từng nhánh", () => {
  it("rỗng / chỉ khoảng trắng / chưa đặt → mặc định", () => {
    expect(_soNguyen("", 4, 0)).toBe(4);
    expect(_soNguyen("   ", 4, 0)).toBe(4);
    expect(_soNguyen(undefined, 4, 0)).toBe(4);
    expect(_soNguyen("\t\n", 4, 0)).toBe(4);
  });

  it("số 0 GÕ TƯỜNG MINH vẫn là 0 — người vận hành cố ý tắt hàng chờ thì được tắt", () => {
    expect(_soNguyen("0", 4, 0)).toBe(0);
    expect(_soNguyen(" 0 ", 4, 0)).toBe(0);
  });

  it("số hợp lệ giữ nguyên, có phần lẻ thì làm tròn xuống", () => {
    expect(_soNguyen("7", 4, 0)).toBe(7);
    expect(_soNguyen(" 12 ", 4, 0)).toBe(12);
    expect(_soNguyen("3.9", 4, 0)).toBe(3);
  });

  it("không phải số, dưới sàn, hoặc vô hạn → mặc định", () => {
    expect(_soNguyen("abc", 4, 0)).toBe(4);
    expect(_soNguyen("-1", 4, 0)).toBe(4);
    expect(_soNguyen("Infinity", 4, 0)).toBe(4);
    expect(_soNguyen("0", 2, 1)).toBe(2);   // sàn 1 như IMPORT_MAX_CONCURRENT
  });
});

// ── .env.example PHẢI MÔ TẢ ĐÚNG NĂM BIẾN, VÀ MẶC ĐỊNH PHẢI KHỚP MÃ NGUỒN ──
// Bản đầu của khối này canh SỐ DÒNG: ".env.example nói IMPORT_X khai ở dòng N" rồi kiểm dòng N.
// Nó bắt được thật (và bắt đúng chính tôi, ngay sau khi tôi thêm dòng vào import.routes.ts) —
// nhưng nó canh một thứ vốn không đáng tồn tại. Số dòng trong tài liệu trôi mỗi lần có người sửa
// file đích; giữ nó nghĩa là ký hợp đồng sửa vặt mãi mãi.
//
// Nay .env.example trỏ bằng TÊN BIẾN, không số dòng. Thứ đáng canh không còn là vị trí mà là
// NỘI DUNG: tài liệu có nêu đủ năm biến không, và CON SỐ MẶC ĐỊNH nó hứa có đúng với mã không —
// một mặc định ghi sai còn tai hại hơn một số dòng lệch, vì người vận hành tin nó mà đặt cấu hình.
describe("W1 — .env.example mô tả đúng năm biến IMPORT_*", () => {
  const goc = new URL("..", import.meta.url).pathname;
  const doc = (p) => readFileSync(join(goc, p), "utf8");

  it("nêu đủ NĂM biến, và tên khớp mã nguồn", () => {
    const env = doc(".env.example");
    const ma = doc("src/routes/import.routes.ts");
    // Lọc theo `process.env`: `IMPORT_WORKER_URL` cũng bắt đầu bằng IMPORT_ nhưng là `new URL(...)`,
    // không phải nút cấu hình — đưa nó vào là đòi tài liệu mô tả một thứ người vận hành không đặt được.
    const trongMa = [...ma.matchAll(/^const (IMPORT_[A-Z_]+)\s*=\s*(.+)$/gm)]
      .filter((m) => m[2].includes("process.env"))
      .map((m) => m[1]).sort();
    expect(trongMa.length, "số biến IMPORT_* trong mã đã đổi").toBe(5);
    for (const ten of trongMa) {
      expect(env, `.env.example không nhắc ${ten} — người vận hành không biết nó tồn tại`)
        .toMatch(new RegExp(`^#\\s+${ten}\\s*:`, "m"));
    }
  });

  it("CON SỐ MẶC ĐỊNH trong tài liệu khớp mã nguồn", () => {
    const env = doc(".env.example");
    const ma = doc("src/routes/import.routes.ts");
    // Lấy mặc định thật từ mã: `soNguyen(process.env.X, <mac>, <san>)` hoặc `|| <mac>`.
    const thatSu = {};
    for (const m of ma.matchAll(/^const (IMPORT_[A-Z_]+)\s*=\s*(.+)$/gm)) {
      if (!m[2].includes("process.env")) continue;   // xem chú thích ở bài trên
      const so = [...m[2].matchAll(/(\d[\d_]*)/g)].map((x) => Number(x[1].replace(/_/g, "")));
      // Math.max(san, Number(env) || mac) → số lớn nhất là mặc định; soNguyen(env, mac, san) → mac trước san.
      thatSu[m[1]] = /Math\.max/.test(m[2]) ? Math.max(...so) : so[0];
    }
    for (const [ten, mac] of Object.entries(thatSu)) {
      const dong = new RegExp(`^#\\s+${ten}\\s*:[^\\n]*$`, "m").exec(env)?.[0] ?? "";
      expect(dong, `.env.example không có dòng mô tả ${ten}`).not.toBe("");
      expect(dong.replace(/_/g, ""),
        `.env.example hứa mặc định khác mã nguồn cho ${ten} (mã: ${mac}) — dòng: ${dong.trim()}`)
        .toMatch(new RegExp(`Mặc định ${mac}\\b`));
    }
  });

  it("KHÔNG quay lại ghi số dòng trong khối IMPORT_*", () => {
    const env = doc(".env.example");
    const khoi = env.slice(env.indexOf("IMPORT_TIMEOUT_MS     :"), env.indexOf("# IMPORT_WAIT_MS="));
    const lac = [...khoi.matchAll(/\(dòng \d+\)/g)].map((m) => m[0]);
    expect(lac, `số dòng trôi mỗi lần sửa import.routes.ts — dùng tên biến: ${lac.join(", ")}`).toEqual([]);
  });
});
