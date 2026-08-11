// Kiểm an toàn cho tệp .xlsx do người dùng tải lên.
//
// VÌ SAO KHÔNG DÙNG MAGIC BYTES LÀ ĐỦ: `PK\x03\x04` chỉ chứng minh "đây là một tệp zip". Mọi zip đều
// khớp — kể cả zip chứa 4 GB số 0 nén xuống vài KB (bom giải nén), zip có đường dẫn `../../etc/x`
// (thoát thư mục lúc giải nén), hay zip 200.000 mục rỗng (bom số lượng). Bộ đọc xlsx phía sau sẽ là
// bên gánh hậu quả, và nó chạy trong tiến trình ứng dụng.
//
// CÁCH LÀM: đọc THƯ MỤC TRUNG TÂM (central directory) của zip. Đó là bảng mục lục ở cuối tệp, khai
// báo sẵn tên, kích thước nén và kích thước giải nén của từng mục. Đọc nó KHÔNG giải nén một byte
// nào — nên chính bước kiểm này không thể bị bom. Mọi ngưỡng dưới đây được kiểm TRƯỚC khi bất kỳ
// thư viện nào chạm vào tệp.
//
// Giới hạn đã biết: các trường kích thước trong mục lục do người tạo tệp khai, một tệp cố tình khai
// sai vẫn qua được bước này. Nó không thay thế được giới hạn tài nguyên lúc giải nén — nó là lớp
// lọc rẻ tiền, chặn đại đa số tệp độc và mọi tệp KHÔNG-PHẢI-xlsx đội lốt.

const EOCD_SIG = 0x06054b50;
const CD_SIG = 0x02014b50;

// Ngưỡng: xlsx báo giá thật ở hệ này lớn nhất khoảng vài MB / vài chục sheet.
const MAX_ENTRIES = 2_000;                    // xlsx bình thường vài chục mục
const MAX_UNCOMPRESSED = 200 * 1024 * 1024;   // 200 MB tổng sau giải nén
const MAX_RATIO = 200;                        // tỉ lệ nén; text/XML thường 5–20 lần

// Mục BẮT BUỘC của một workbook OOXML. Thiếu bất kỳ cái nào thì đó không phải xlsx, bất kể đuôi tệp.
const REQUIRED = ["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml"];

export type ZipVerdict = { ok: true; entries: number; uncompressed: number } | { ok: false; reason: string };

/** Tên mục có thoát khỏi thư mục đích khi giải nén không (zip-slip). */
function isUnsafeEntryName(name: string) {
  if (name.startsWith("/") || name.startsWith("\\")) return true;       // đường dẫn tuyệt đối
  if (/^[a-zA-Z]:/.test(name)) return true;                            // ổ đĩa Windows
  if (name.includes("\0")) return true;
  const parts = name.replace(/\\/g, "/").split("/");
  return parts.includes("..");                                          // thoát lên thư mục cha
}

/**
 * Duyệt thư mục trung tâm của zip. Trả danh sách mục, hoặc null nếu không đọc được cấu trúc zip.
 * KHÔNG giải nén.
 */
function readCentralDirectory(buf: Buffer) {
  // EOCD nằm cuối tệp, sau nó có thể còn phần chú thích tối đa 64 KB → dò ngược trong 64 KB + 22 byte.
  const maxBack = Math.min(buf.length, 0xffff + 22);
  let eocd = -1;
  for (let i = buf.length - 22; i >= buf.length - maxBack && i >= 0; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd < 0) return null;

  const count = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  // 0xFFFFFFFF là cờ ZIP64. Ở đây trần tải lên là 10 MB nên xlsx thật không bao giờ cần ZIP64;
  // gặp nó thì từ chối chứ không đoán — đoán sai ở bước phân tích tệp là chỗ sinh lỗ hổng.
  if (cdOffset === 0xffffffff || count === 0xffff) return null;
  if (cdOffset >= buf.length) return null;

  const entries: { name: string; comp: number; uncomp: number }[] = [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CD_SIG) return null;
    const comp = buf.readUInt32LE(p + 20);
    const uncomp = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const cmtLen = buf.readUInt16LE(p + 32);
    if (p + 46 + nameLen > buf.length) return null;
    entries.push({ name: buf.toString("utf8", p + 46, p + 46 + nameLen), comp, uncomp });
    p += 46 + nameLen + extraLen + cmtLen;
    // Chặn sớm: tệp khai 200.000 mục thì dừng ngay, không duyệt hết rồi mới báo.
    if (entries.length > MAX_ENTRIES) break;
  }
  return entries;
}

/**
 * Tệp này có thực sự là workbook .xlsx an toàn để đưa cho bộ đọc không.
 * Gọi TRƯỚC khi trao buffer cho exceljs / bộ nhập Excel.
 */
export function inspectXlsx(buf: Buffer): ZipVerdict {
  if (buf.length < 22) return { ok: false, reason: "tệp quá nhỏ để là .xlsx" };
  if (!(buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04)) {
    return { ok: false, reason: "không phải tệp zip (.xlsx là zip)" };
  }
  const entries = readCentralDirectory(buf);
  if (!entries) return { ok: false, reason: "cấu trúc zip hỏng hoặc không hỗ trợ (ZIP64)" };
  if (entries.length > MAX_ENTRIES) return { ok: false, reason: `quá nhiều mục bên trong (>${MAX_ENTRIES})` };
  if (entries.length === 0) return { ok: false, reason: "zip rỗng" };

  let totalUncomp = 0;
  for (const e of entries) {
    if (isUnsafeEntryName(e.name)) return { ok: false, reason: `tên mục không an toàn: ${e.name.slice(0, 60)}` };
    totalUncomp += e.uncomp;
    if (totalUncomp > MAX_UNCOMPRESSED) return { ok: false, reason: "tổng dung lượng sau giải nén quá lớn (nghi bom nén)" };
    // Tỉ lệ nén dị thường trên MỘT mục cũng đủ là bom, không cần tổng vượt ngưỡng.
    if (e.comp > 0 && e.uncomp / e.comp > MAX_RATIO && e.uncomp > 1024 * 1024) {
      return { ok: false, reason: `tỉ lệ nén bất thường ở mục ${e.name.slice(0, 40)} (nghi bom nén)` };
    }
  }

  const names = new Set(entries.map((e) => e.name));
  const missing = REQUIRED.filter((r) => !names.has(r));
  if (missing.length) return { ok: false, reason: `thiếu thành phần bắt buộc của workbook: ${missing.join(", ")}` };
  if (![...names].some((n) => n.startsWith("xl/worksheets/"))) {
    return { ok: false, reason: "không có trang tính nào (xl/worksheets/)" };
  }

  return { ok: true, entries: entries.length, uncompressed: totalUncomp };
}
