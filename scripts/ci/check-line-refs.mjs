#!/usr/bin/env node
// QUÉT MỌI THAM CHIẾU DẠNG `duong/dan/file.ts:123` TRONG REPO VÀ BẮT CÁI NÀO TRỎ SAI CHỖ.
//
// ── VÌ SAO CẦN ──────────────────────────────────────────────────────────────
// Repo này giải thích rất nhiều bằng chú thích trỏ sang file khác kèm SỐ DÒNG. Cách đó dễ đọc,
// nhưng số dòng trôi mỗi lần có người thêm/bớt dòng ở file ĐÍCH — và không có gì báo. Đã lặp lại
// nhiều vòng: mỗi vòng rà tay lại một lượt, rồi chính lượt rà đó thêm dòng và làm trôi tiếp.
//
// Không thể kiểm ngữ nghĩa (chú thích "nói đúng" hay không thì máy không biết). Nhưng có một dấu
// hiệu QUYẾT ĐỊNH ĐƯỢC và bắt gần hết ca thật: một tham chiếu đã trôi thường rơi vào chỗ KHÔNG
// THỂ là đích của ai — dòng trống, một dấu `}` lẻ, `fi`, `});`, một dòng chỉ có chú thích, hoặc
// quá cuối file.
//
// Bộ lọc CỐ Ý HẸP. Nó KHÔNG khẳng định "chú thích đúng"; nó chỉ khẳng định "chú thích không trỏ
// vào hư không". Bắt rộng hơn thì sẽ có báo động giả, mà một cổng hay báo động giả sẽ bị người ta
// tắt đi — lúc đó còn tệ hơn không có.
//
//   node scripts/ci/check-line-refs.mjs            # liệt kê
//   node scripts/ci/check-line-refs.mjs --check    # thoát khác 0 nếu có cái sai
import { readFileSync, existsSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const GOC = path.resolve(import.meta.dirname, "../..");
const CHECK = process.argv.includes("--check");

// Chỉ quét file được git theo dõi: node_modules/dist/.git nằm ngoài, và bản clone nào cũng như nhau.
const FILES = execFileSync("git", ["ls-files"], { cwd: GOC, encoding: "utf8", maxBuffer: 64 << 20 })
  .split("\n")
  .filter(Boolean)
  // Nhị phân và ảnh chụp thì không có chú thích.
  .filter((f) => /\.(ts|tsx|js|mjs|cjs|md|sh|yml|yaml|sql|json)$/.test(f))
  // package-lock: 30k dòng máy sinh, không ai viết chú thích ở đó.
  .filter((f) => f !== "package-lock.json")
  // docs/archive/ là ẢNH CHỤP LỊCH SỬ (bản kiểm toán của một thời điểm). Số dòng ở đó đúng VỚI
  // LÚC ẤY; sửa cho khớp HEAD là làm sai bản ghi. Bỏ ra khỏi phạm vi quét.
  .filter((f) => !f.startsWith("docs/archive/"));

// `src/foo/bar.ts:123` — đòi có dấu `/` để khỏi bắt nhầm "abc.ts:12" trong một câu văn,
// và đòi phần mở rộng là mã nguồn.
const RE = /\b((?:[\w.-]+\/)+[\w.-]+\.(?:ts|tsx|js|mjs|cjs|sh|sql|yml|yaml))(?::|,)?(\d+)\b/g;
// Dạng thứ hai, rất phổ biến trong repo này: "… src/foo.ts:12-15" hoặc ":118 và :169".
const RE_PHU = /:(\d+)\b/g;

/**
 * Dòng đích có vấn đề không, và ở mức nào.
 *
 * "cung"  = KHÔNG THỂ là đích của bất kỳ tham chiếu nào → cổng ĐỎ. Gần như không có báo động giả.
 * "mem"   = ĐÁNG NGỜ nhưng có thể hợp lệ → chỉ LIỆT KÊ, không làm đỏ.
 *
 * Vì sao tách hai mức: một tham chiếu trỏ vào dòng chú thích CÓ THỂ là cố ý ("xem khối chú thích ở
 * foo.ts:47"). Bắt cứng nó sẽ sinh báo động giả, mà một cổng hay báo động giả sẽ bị người ta tắt —
 * lúc đó còn tệ hơn không có cổng nào. Nên phần chắc chắn thì chặn, phần mờ thì nói ra để người
 * đọc tự quyết.
 */
function dongVoNghia(dong) {
  const t = dong.trim();
  if (t === "") return { muc: "cung", ly: "dòng trống" };
  if (/^[}\])];,]+$/.test(t)) return { muc: "cung", ly: `chỉ có dấu đóng: ${t}` };
  if (/^(fi|esac|done|end|else|EOF)$/.test(t)) return { muc: "cung", ly: `chỉ có từ khoá đóng: ${t}` };
  if (/^(\*|\/\/|#)/.test(t)) return { muc: "mem", ly: "trỏ vào một dòng chú thích" };
  return null;
}

const noiDung = new Map();
const doc = (f) => {
  if (!noiDung.has(f)) {
    const p = path.join(GOC, f);
    noiDung.set(f, existsSync(p) && statSync(p).isFile() ? readFileSync(p, "utf8").split("\n") : null);
  }
  return noiDung.get(f);
};

const sai = [];
for (const f of FILES) {
  const lines = readFileSync(path.join(GOC, f), "utf8").split("\n");
  lines.forEach((dong, i) => {
    // Bản thân file quét này chứa các mẫu ví dụ — đừng tự bắt mình.
    if (f === "scripts/ci/check-line-refs.mjs") return;
    for (const m of dong.matchAll(RE)) {
      const [, dich, soTho] = m;
      const so = Number(soTho);
      const dichLines = doc(dich);
      if (dichLines === null) continue;               // file không tồn tại → không phải việc của cổng này
      // node_modules: số dòng của bên thứ ba đổi theo BẢN CÀI, không theo repo này. Soi nó là tự
      // tạo ra một cổng đỏ mỗi lần `npm update` — báo động giả thuần tuý.
      if (dich.startsWith('node_modules/')) continue;
      if (so < 1) continue;
      if (so > dichLines.length) {
        sai.push({ f, i: i + 1, dich, so, muc: "cung", ly: `quá cuối file (${dichLines.length} dòng)` });
        continue;
      }
      const v = dongVoNghia(dichLines[so - 1]);
      if (v) sai.push({ f, i: i + 1, dich, so, ...v, thay: dichLines[so - 1].trim().slice(0, 60) });
    }
    // Bắt tiếp các số ":NNN" đứng riêng NGAY SAU một tham chiếu file trên cùng dòng.
    const dauFile = [...dong.matchAll(RE)];
    if (!dauFile.length) return;
    const dich = dauFile[dauFile.length - 1][1];
    const dichLines = doc(dich);
    if (dichLines === null) return;
    const sau = dong.slice(dauFile[dauFile.length - 1].index + dauFile[dauFile.length - 1][0].length);
    for (const m2 of sau.matchAll(RE_PHU)) {
      const so = Number(m2[1]);
      if (so < 1 || so > dichLines.length) {
        sai.push({ f, i: i + 1, dich, so, muc: "cung", ly: `quá cuối file (${dichLines.length} dòng)` });
        continue;
      }
      const v = dongVoNghia(dichLines[so - 1]);
      if (v) sai.push({ f, i: i + 1, dich, so, ...v, thay: dichLines[so - 1].trim().slice(0, 60) });
    }
  });
}

const cung = sai.filter((s) => s.muc === "cung");
const mem = sai.filter((s) => s.muc === "mem");

const in1 = (s) => {
  console.log(`  ${s.f}:${s.i}`);
  console.log(`      nói  → ${s.dich}:${s.so}`);
  console.log(`      thật → ${s.ly}${s.thay ? ` (${s.thay})` : ""}`);
};

if (mem.length) {
  console.log(`\n⚠ ${mem.length} tham chiếu trỏ vào DÒNG CHÚ THÍCH (có thể cố ý — KHÔNG làm đỏ):\n`);
  mem.forEach(in1);
}

if (!cung.length) {
  console.log(`\n✓ ${FILES.length} file — không tham chiếu "file:dòng" nào trỏ vào hư không`);
  process.exit(0);
}

console.log(`\n✖ ${cung.length} tham chiếu "file:dòng" trỏ vào chỗ KHÔNG THỂ là đích:\n`);
cung.forEach(in1);
console.log(`\nSố dòng trôi mỗi lần ai đó thêm/bớt dòng ở file đích. Hai cách sửa:`);
console.log(`  · cập nhật số cho đúng, hoặc`);
console.log(`  · BỎ số, trỏ bằng TÊN HÀM/HẰNG — grep ra được và không trôi (cách nên dùng).`);
process.exit(CHECK ? 1 : 0);
