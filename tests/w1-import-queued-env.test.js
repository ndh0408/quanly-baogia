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

// ── SỐ DÒNG TRONG .env.example PHẢI TRỎ ĐÚNG CHỖ ────────────────────────────
// Khối chú thích IMPORT_* của .env.example dẫn người đọc tới đúng dòng khai báo trong
// src/routes/import.routes.ts. Ba trong năm số đó đã trôi một lần (75/76/79 trong khi thực tế là
// 94/95/98) — không có gì làm chúng đỏ nên chúng sống qua nhiều lượt sửa. Bài này ĐỌC số ghi
// trong .env.example rồi đòi dòng ấy trong mã nguồn phải thật sự khai đúng biến đó.
//
// Ghi chú tham chiếu bằng SỐ DÒNG vốn mong manh. Giữ được vì nó rẻ, và vì có bài test này thì lần
// trôi kế tiếp là một dòng đỏ chứ không phải một người đọc bị dẫn sai chỗ.
describe("W1 — .env.example trỏ đúng dòng khai báo IMPORT_*", () => {
  const goc = new URL("..", import.meta.url).pathname;
  const doc = (p) => readFileSync(join(goc, p), "utf8");

  it("mỗi '(dòng N)' trong khối IMPORT_* trỏ tới đúng dòng khai báo biến ấy", () => {
    const env = doc(".env.example");
    const maNguon = doc("src/routes/import.routes.ts").split("\n");

    // Bắt các dòng dạng `#   IMPORT_XXX  : … (dòng N).`
    const cap = [...env.matchAll(/^#\s+(IMPORT_[A-Z_]+)\s*:[^\n]*?\(dòng (\d+)\)/gm)]
      .map((m) => [m[1], Number(m[2])]);
    expect(cap.length, "khối chú thích IMPORT_* trong .env.example biến mất hoặc đổi dạng")
      .toBe(5);

    for (const [ten, so] of cap) {
      const dong = maNguon[so - 1] ?? "";
      // Thông báo NÓI LUÔN số đúng: chú thích kiểu này trôi mỗi lần ai đó thêm dòng vào
      // import.routes.ts, nên bắt được thôi chưa đủ — phải sửa được ngay mà không phải đi đếm.
      const dungLa = maNguon.findIndex((l) => new RegExp(`^const ${ten}\\s*=`).test(l)) + 1;
      expect(dong, `.env.example nói ${ten} khai ở dòng ${so}, nhưng dòng đó là: ${dong.trim()}`
        + (dungLa ? ` — SỬA THÀNH "(dòng ${dungLa})".` : ` — không tìm thấy khai báo ${ten} nào.`))
        .toMatch(new RegExp(`^const ${ten}\\s*=`));
    }
  });
});
