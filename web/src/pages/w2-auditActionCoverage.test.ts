// Bộ lọc "Hoạt động" của Nhật ký hoạt động phải PHỦ mọi mã action mà máy chủ thực sự ghi.
//
// ── LỖI ─────────────────────────────────────────────────────────────────────
// `ACTION_GROUPS` trong `web/src/pages/Audit.tsx` là nguồn DUY NHẤT dựng <select> lọc hoạt động
// (và `ACTION_LABEL` suy ra từ chính nó). Ô lọc là <select>, KHÔNG có ô nhập tự do — mã nào
// không có trong bảng thì admin không có cách nào chọn để lọc, và cột "Hoạt động" hiện mã thô
// (`actionLabel` fallback `a`) thay vì tiếng Việt.
// Các đợt vá gần đây thêm 15 mã mới vào máy chủ (file.sign-download, file.sign-upload,
// file.finalize, personnel.payment-proof.view, …) mà không cập nhật bảng này.
//
// ── VÌ SAO KHOÁ BẰNG TEST ĐỌC NGUỒN ─────────────────────────────────────────
// Danh sách này trôi khỏi máy chủ một cách IM LẶNG: thêm một `audit(req, "x.y")` ở `src/` không
// làm hỏng build của `web/`. Test này đọc CẢ HAI nguồn dưới dạng văn bản (`?raw` /
// `import.meta.glob`) rồi so, nên mọi mã mới thêm ở máy chủ về sau đều làm test đỏ ngay.
// Dùng `?raw` chứ không phải `node:fs` vì web/tsconfig chỉ nạp types "vite/client",
// không có @types/node — tiền lệ: web/src/lib/imgSrcGuard.test.ts, b6-gridMemo.test.ts.
import { describe, it, expect } from "vitest";
import AUDIT_PAGE from "./Audit.tsx?raw";

// Toàn bộ mã nguồn máy chủ (repo-root/src), KHÔNG phải web/src.
const SERVER_SRC = {
  ...import.meta.glob("../../../src/**/*.ts", { query: "?raw", import: "default", eager: true }),
  ...import.meta.glob("../../../src/**/*.js", { query: "?raw", import: "default", eager: true }),
} as Record<string, string>;

// ── BỘ DÒ NÀY TỪNG BỎ SÓT 10 MÃ. ĐỌC KỸ TRƯỚC KHI "ĐƠN GIẢN HOÁ" NÓ. ─────────
// Bản đầu chỉ khớp `audit(<ctx>, "<chuỗi>"` — đòi đối số thứ hai BẮT ĐẦU bằng dấu nháy. Thực tế
// mã nguồn còn hai dạng khác, và cả hai đều lọt sạch:
//
//   1. TERNARY — `audit(req, signed ? "quote.sign" : "quote.unsign", …)`
//      Có 8 mã kiểu này: quote.sign/unsign, quote.internal.pay/unpay,
//      personnel.pay/unpay, personnel.confirm/unconfirm.
//
//   2. BIẾN — `audit(req, action, …)` trong `writeNoteField`, với `action` do nơi gọi truyền
//      ("personnel.accounting-note" và "personnel.note"). Không regex nào lần được.
//
// Hậu quả của việc bỏ sót: 10 mã đó KHÔNG có trong bộ lọc "Hoạt động" (ô <select>, không có nhập
// tự do), nên admin không lọc ra được; và cột Hoạt động hiện MÃ THÔ thay vì tiếng Việt.
// Mà bài test thì XANH — nó không biết có gì để mà đòi.
//
// Cách bịt: đối số thứ hai được CẮT TRỌN (tới dấu phẩy ở ĐỘ SÂU 0), rồi lấy MỌI chuỗi trong đó.
// Ternary vì thế lộ ra. Còn dạng BIẾN thì không thể phân tích tĩnh, nên nó bị BẮT LỖI TƯỜNG MINH:
// bài "mọi audit() phải phân tích được" dưới đây đỏ cho tới khi mã ấy được khai vào
// `MA_NHAT_KY_GIAN_TIEP` (src/audit.ts). Thêm một lời gọi gián tiếp mới mà quên khai = đỏ ngay,
// chứ không lặng lẽ biến mất như trước.

/** Cắt đối số thứ hai của `audit(...)` từ vị trí sau dấu phẩy đầu, tới dấu phẩy ở độ sâu 0. */
function doiSoThuHai(text: string, tuViTri: number): string {
  let sau = 0;
  for (let i = tuViTri; i < text.length; i++) {
    const c = text[i];
    if (c === "(" || c === "[" || c === "{") sau++;
    else if (c === ")" || c === "]" || c === "}") { if (sau === 0) return text.slice(tuViTri, i); sau--; }
    else if (c === "," && sau === 0) return text.slice(tuViTri, i);
  }
  return text.slice(tuViTri);
}

/** Vị trí bắt đầu đối số thứ hai của mỗi `audit(...)`. `<ctx>` là req/null/tên biến. */
const MO_AUDIT = /\baudit\(\s*[^,()]*,/g;
// Mã hành động: bắt đầu bằng chữ thường, gồm chữ/số/dấu chấm/gạch. KHÔNG đòi phải có dấu chấm —
// bản đầu của tôi đòi, và thế là loại mất mã một từ như `logout` (có thật, auth.routes.ts).
const LA_MA = /^[a-z][\w.-]*$/;

function serverActions(): { actions: Set<string>; files: number; khongDoc: { file: string; bieuThuc: string }[] } {
  const found = new Set<string>();
  const khongDoc: { file: string; bieuThuc: string }[] = [];
  const texts = Object.entries(SERVER_SRC);
  for (const [file, text] of texts) {
    if (file.includes("/audit.ts")) continue;            // chính khai báo hàm, không phải nơi gọi
    for (const m of text.matchAll(MO_AUDIT)) {
      const bt = doiSoThuHai(text, m.index + m[0].length);
      const chuoi = [...bt.matchAll(/"([^"]+)"/g)].map((x) => x[1]).filter((x) => LA_MA.test(x));
      if (chuoi.length) { for (const c of chuoi) found.add(c); continue; }
      // Không có chuỗi nào → đối số là BIẾN/lời gọi hàm. Ghi lại để bài dưới đòi khai tường minh.
      khongDoc.push({ file, bieuThuc: bt.trim().slice(0, 60) });
    }
  }
  // Mã đi qua biến: đọc từ danh sách KHAI TƯỜNG MINH trong src/audit.ts.
  const audit = SERVER_SRC[Object.keys(SERVER_SRC).find((k) => k.endsWith("/audit.ts")) ?? ""] ?? "";
  const kh = audit.indexOf("MA_NHAT_KY_GIAN_TIEP");
  if (kh >= 0) {
    const khoi = audit.slice(kh, audit.indexOf("]", kh) + 1);
    for (const m of khoi.matchAll(/"([^"]+)"/g)) if (LA_MA.test(m[1])) found.add(m[1]);
  }
  return { actions: found, files: texts.length, khongDoc };
}

// Trích các cặp ["mã", "nhãn"] bên trong đúng khối `const ACTION_GROUPS … ];`.
function uiActions(): { pairs: [string, string][] } {
  const start = AUDIT_PAGE.indexOf("const ACTION_GROUPS");
  expect(start, "không tìm thấy ACTION_GROUPS trong Audit.tsx").toBeGreaterThanOrEqual(0);
  const end = AUDIT_PAGE.indexOf("\n];", start);
  expect(end, "không tìm thấy điểm kết thúc của ACTION_GROUPS").toBeGreaterThan(start);
  const block = AUDIT_PAGE.slice(start, end);
  const pairs: [string, string][] = [];
  for (const m of block.matchAll(/\["([a-z][\w.-]*)",\s*"([^"]+)"\]/g)) pairs.push([m[1], m[2]]);
  return { pairs };
}

describe("Nhật ký hoạt động — bộ lọc Hoạt động phủ hết mã máy chủ ghi", () => {
  it("đọc được cả hai nguồn (nếu glob hỏng thì mọi khẳng định dưới đây thành vô nghĩa)", () => {
    const { actions, files } = serverActions();
    expect(files).toBeGreaterThan(30);            // src/ có ~50 file .ts + 2 worker .js
    expect(actions.size).toBeGreaterThanOrEqual(82);   // 82 = số đếm thật lúc viết bài này
    expect(actions.has("quote.create")).toBe(true);
    expect(uiActions().pairs.length).toBeGreaterThan(60);
  });

  it("MỌI mã action `audit()` ghi ở src/ đều có trong ACTION_GROUPS", () => {
    const { actions } = serverActions();
    const known = new Set(uiActions().pairs.map(([a]) => a));
    const missing = [...actions].filter((a) => !known.has(a)).sort();
    expect(missing, `thiếu trong ACTION_GROUPS (admin không lọc được): ${missing.join(", ")}`).toEqual([]);
  });

  it("không có mã nào trùng lặp, và mã nào cũng có nhãn tiếng Việt (không phải chính nó)", () => {
    const { pairs } = uiActions();
    const seen = new Set<string>(); const dup: string[] = [];
    for (const [a] of pairs) { if (seen.has(a)) dup.push(a); seen.add(a); }
    expect(dup, `mã trùng: ${dup.join(", ")}`).toEqual([]);
    // Nhãn phải là chữ, không được để nguyên mã (dấu chấm) hay bỏ trống.
    const xau = pairs.filter(([a, l]) => !l.trim() || l === a).map(([a]) => a);
    expect(xau, `nhãn chưa dịch: ${xau.join(", ")}`).toEqual([]);
  });

  it("KHÔNG có mã thừa: mọi mã trong bảng đều thực sự được src/ ghi", () => {
    // Mã thừa không gây hại hiển thị nhưng làm dropdown có lựa chọn LUÔN ra 0 dòng.
    const { actions } = serverActions();
    const extra = uiActions().pairs.map(([a]) => a).filter((a) => !actions.has(a)).sort();
    expect(extra, `có trong bảng nhưng src/ không ghi: ${extra.join(", ")}`).toEqual([]);
  });
});

describe("bộ dò phải TỰ TỐ CÁO khi gặp lời gọi nó không đọc được", () => {
  // Đây là chốt quan trọng nhất của file. Bản đầu của bộ dò bỏ sót 10 mã mà vẫn XANH — vì nó
  // không biết mình đã bỏ sót. Một bộ đo im lặng về giới hạn của chính nó thì tệ hơn không có.
  //
  // Nay mọi `audit(...)` có đối số thứ hai KHÔNG phải chuỗi văn tự đều bị ghi lại, và bài này đòi
  // chúng phải được khai tường minh ở `MA_NHAT_KY_GIAN_TIEP` (src/audit.ts). Thêm một lời gọi
  // gián tiếp mới mà quên khai = ĐỎ, chứ không biến mất.
  it("mọi audit() không đọc được đều đã có mã khai tường minh trong src/audit.ts", () => {
    const { khongDoc, actions } = serverActions();
    // Danh sách khai không được rỗng nếu thực tế CÓ lời gọi gián tiếp.
    if (khongDoc.length) {
      expect(actions.has("personnel.accounting-note") || actions.has("personnel.note"),
        `có ${khongDoc.length} lời gọi audit() truyền biến (${khongDoc.map((k) => k.bieuThuc).join(", ")}) ` +
        `nhưng MA_NHAT_KY_GIAN_TIEP trong src/audit.ts không khai mã nào — chúng sẽ vô hình với bộ lọc ` +
        `trang Nhật ký, y như 10 mã từng bị bỏ sót.`)
        .toBe(true);
    }
    // Và số lời gọi gián tiếp phải ĐÚNG như đã biết. Thêm một cái nữa = phải khai thêm mã.
    expect(khongDoc.length,
      `số lời gọi audit() truyền biến đã đổi (${khongDoc.map((k) => `${k.file}: ${k.bieuThuc}`).join(" | ")}). ` +
      `Nếu là lời gọi MỚI: khai mã của nó vào MA_NHAT_KY_GIAN_TIEP (src/audit.ts) rồi cập nhật số này.`)
      .toBe(1);
  });

  it("bắt được dạng TERNARY — 8 mã từng lọt sạch qua bản dò cũ", () => {
    const { actions } = serverActions();
    for (const ma of ["quote.sign", "quote.unsign", "quote.internal.pay", "quote.internal.unpay",
                      "personnel.pay", "personnel.unpay", "personnel.confirm", "personnel.unconfirm"]) {
      expect(actions.has(ma), `bộ dò không thấy \`${ma}\` — nó lại chỉ khớp dạng chuỗi trực tiếp?`).toBe(true);
    }
  });

  it("bắt được mã MỘT TỪ (không có dấu chấm) — `logout` từng bị bộ lọc của tôi loại", () => {
    expect(serverActions().actions.has("logout")).toBe(true);
  });
});
