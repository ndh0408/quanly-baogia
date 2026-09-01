// P3 — HỢP ĐỒNG .docx (src/services/contractDocx.ts): hai lỗi sinh XML.
//  1) escXml chỉ thay & < > " → ký tự điều khiển (U+000B…) lọt thẳng vào word/document.xml,
//     mà chúng NẰM NGOÀI tập Char của XML 1.0 → file .docx không còn là XML hợp lệ.
//  2) dropParagraphWith/cutSection tìm ranh giới đoạn bằng lastIndexOf("<w:p>") — chỉ khớp thẻ
//     TRẦN. Mẫu mở/lưu lại bằng Word thì mọi <w:p> đều có w:rsidR=… → không tìm thấy → THẤT BẠI
//     ÂM THẦM: khối PHIẾU CHI còn nguyên và in ra chuỗi {{PC_START}}/{{PC_END}} cho khách.
import { describe, it, expect, vi, beforeEach } from "vitest";
import JSZip from "jszip";
import { SaxesParser } from "saxes";

const VT = String.fromCharCode(0x0b);   // vertical tab — ký tự điều khiển hợp lệ trong JS, KHÔNG hợp lệ trong XML
const NONCHAR = String.fromCharCode(0xffff);   // U+FFFF — LỚN HƠN 0x1f nên vị từ `c > 0x1f` giữ lại, mà XML thì cấm
const LE_LOI = "\uD800";                       // surrogate ĐƠN LẺ — UTF-8 hoá thành U+FFFD, in ra dấu thay thế
const ASTRAL = String.fromCodePoint(0x1f600);  // chữ astral HỢP LỆ — không được lọc nhầm

/**
 * Có code point nào ngoài tập Char của XML 1.0 không.
 *   Char ::= #x9 | #xA | #xD | [#x20-#xD7FF] | [#xE000-#xFFFD] | [#x10000-#x10FFFF]
 * Duyệt bằng `[...s]` + `codePointAt(0)` chứ không `charCodeAt(0)`: cặp thay thế hợp lệ phải đọc ra
 * code point THẬT (U+10000+), nếu không thì chữ astral bị chấm nhầm là surrogate đơn lẻ.
 */
const ngoaiCharXml = (s) => [...s].some((ch) => {
  const cp = ch.codePointAt(0);
  return !(cp === 0x09 || cp === 0x0a || cp === 0x0d
    || (cp >= 0x20 && cp <= 0xd7ff) || (cp >= 0xe000 && cp <= 0xfffd) || cp >= 0x10000);
});

// Mẫu GIẢ đúng như Word ghi ra: MỌI <w:p> đều mang thuộc tính rsid (không có thẻ trần nào).
// Đây là điểm khác biệt duy nhất so với templates/hd-dichvu-template.docx hiện tại.
function fakeTemplateXml() {
  const p = (inner, rsid) => `<w:p w:rsidR="${rsid}" w:rsidRDefault="${rsid}"><w:r><w:t>${inner}</w:t></w:r></w:p>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>`
    + p("HỢP ĐỒNG SỐ {{SO_HD}} — {{TEN_HOA}}", "00A11111")
    + p("{{PC_START}}", "00B22222")
    + p("PHIẾU CHI — ngày {{NGAY_CHI}}", "00C33333")
    + p("{{PC_END}}", "00D44444")
    + p("Ký ngày {{NGAY_KY}}", "00E55555")
    + `</w:body></w:document>`;
}

async function fakeTemplateBuffer() {
  const zip = new JSZip();
  zip.file("word/document.xml", fakeTemplateXml());
  return zip.generateAsync({ type: "nodebuffer" });
}

let templateBuffer;
vi.mock("node:fs/promises", async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    readFile: vi.fn(async (p, ...rest) =>
      String(p).endsWith("hd-dichvu-template.docx") ? templateBuffer : real.readFile(p, ...rest)),
  };
});

const { buildContractDocx } = await import("../src/services/contractDocx.js");

const rec = (over = {}) => ({
  id: 7, fullName: "Nguyễn Văn A", birthYear: "1993", idCard: "079000000001", address: "123 Đường X",
  phone: "0900000000", salary: 31_500_000, workStart: new Date("2026-03-10"),
  workEnd: new Date("2026-03-20"), projectNameContract: "Dựng gian hàng",
  projectName: null, laborContractNo: null, paidAt: null, ...over,
});

async function docXml(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  return zip.file("word/document.xml").async("string");
}

/** Thông báo lỗi của trình phân tích XML nghiêm ngặt, hoặc null nếu XML hợp lệ. */
function xmlError(xml) {
  const p = new SaxesParser();
  let err = null;
  p.on("error", (e) => { if (!err) err = e.message; });
  try { p.write(xml).close(); } catch (e) { if (!err) err = e.message; }
  return err;
}

beforeEach(async () => { templateBuffer = await fakeTemplateBuffer(); });

describe("buildContractDocx — XML sinh ra phải hợp lệ", () => {
  it("lọc ký tự điều khiển khỏi giá trị người dùng nhập", async () => {
    // U+000B lọt được vào DB: route nhân sự chỉ giới hạn ĐỘ DÀI, và gọi API trực tiếp
    // thì không có trình duyệt nào lọc hộ.
    const { buffer } = await buildContractDocx(rec({ fullName: `Nguyễn${VT}Văn${VT}A` }));
    const xml = await docXml(buffer);
    expect(xmlError(xml)).toBeNull();
    expect(ngoaiCharXml(xml)).toBe(false);
    // Chỉ bỏ ký tự điều khiển, KHÔNG bỏ nội dung.
    expect(xml).toContain("NGUYỄNVĂNA");
  });

  // ĐỎ trên vị từ cũ `c > 0x1f`: U+FFFF lớn hơn 0x1f nên lọt thẳng vào word/document.xml và saxes
  // báo "disallowed character". Đây là hồ sơ thật sự sinh ra được: route nhân sự chỉ chặn ĐỘ DÀI.
  // (mẫu giả chỉ dựng token {{TEN_HOA}}, nên mọi ca dưới đây đi qua `fullName` — đường duy nhất
  //  chở được giá trị người dùng nhập ra tới XML trong mẫu này.)
  it("lọc U+FFFF/U+FFFE — noncharacter ngoài tập Char, KHÔNG phải ký tự điều khiển", async () => {
    const { buffer } = await buildContractDocx(rec({
      fullName: `Ngu${NONCHAR}yen${String.fromCharCode(0xfffe)} Van A`,
    }));
    const xml = await docXml(buffer);
    expect(xmlError(xml)).toBeNull();
    expect(ngoaiCharXml(xml)).toBe(false);
    expect(xml).toContain("NGUYEN VAN A");   // nội dung liền lại, không mất chữ
  });

  // ĐỎ trên vị từ cũ: surrogate đơn lẻ (0xD800) cũng > 0x1f nên được giữ, rồi JSZip mã hoá UTF-8
  // đổi nó thành U+FFFD — hợp đồng gửi khách in ra một dấu thay thế giữa tên người.
  it("bỏ surrogate ĐƠN LẺ nhưng GIỮ NGUYÊN chữ astral hợp lệ", async () => {
    const { buffer } = await buildContractDocx(rec({ fullName: `Ngu${LE_LOI}yen ${ASTRAL}` }));
    const xml = await docXml(buffer);
    expect(xmlError(xml)).toBeNull();
    expect(ngoaiCharXml(xml)).toBe(false);
    expect(xml).not.toContain("\uFFFD");      // không còn dấu thay thế
    expect(xml).toContain("NGUYEN");          // tên liền lại
    expect(xml).toContain(ASTRAL);            // chữ astral KHÔNG bị lọc nhầm
  });

  it("KHÔNG lọc U+FDD0/U+D7FF/U+E000 — vẫn nằm trong tập Char", async () => {
    const giu = "\uFDD0\uD7FF\uE000";
    const { buffer } = await buildContractDocx(rec({ fullName: `Ten ${giu}` }));
    const xml = await docXml(buffer);
    expect(xmlError(xml)).toBeNull();
    for (const ch of giu) expect(xml).toContain(ch);
  });
});

describe("buildContractDocx — cắt khối PHIẾU CHI trên mẫu do Word ghi lại", () => {
  it("CHƯA thanh toán: cắt trọn khối, không để lọt marker {{PC_…}}", async () => {
    const { buffer } = await buildContractDocx(rec({ paidAt: null }));
    const xml = await docXml(buffer);
    expect(xml).not.toContain("{{PC_");
    expect(xml).not.toContain("PHIẾU CHI");
    expect(xml).toContain("Ký ngày");          // phần sau khối vẫn còn nguyên
  });

  it("ĐÃ thanh toán: giữ khối nhưng gỡ sạch 2 marker", async () => {
    const { buffer } = await buildContractDocx(rec({ paidAt: new Date("2026-03-25") }));
    const xml = await docXml(buffer);
    expect(xml).not.toContain("{{PC_");
    expect(xml).toContain("PHIẾU CHI");
    expect(xml).toContain("25 tháng 03 năm 2026");
  });
});
