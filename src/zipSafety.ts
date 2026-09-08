// Kiểm an toàn cho tệp .xlsx do người dùng tải lên.
//
// VÌ SAO KHÔNG DÙNG MAGIC BYTES LÀ ĐỦ: `PK\x03\x04` chỉ chứng minh "đây là một tệp zip". Mọi zip đều
// khớp — kể cả zip chứa 4 GB số 0 nén xuống vài KB (bom giải nén), zip có đường dẫn `../../etc/x`
// (thoát thư mục lúc giải nén), hay zip 200.000 mục rỗng (bom số lượng). Bộ đọc xlsx phía sau sẽ là
// bên gánh hậu quả, và nó chạy trong tiến trình ứng dụng.
//
// CÁCH LÀM: đọc THƯ MỤC TRUNG TÂM (central directory) của zip trước — bảng mục lục ở cuối tệp, khai
// tên + kích thước từng mục — để bắt sớm zip-slip / quá nhiều mục / cấu trúc hỏng KHÔNG cần giải nén
// một byte nào.
//
// ── LỖ ĐÃ VÁ (ultracode audit 2026-09-09, finding H1) ────────────────────────────────────────────
// Bản trước CHỈ tin kích thước "uncompressed" do CHÍNH TỆP khai trong central directory — và có một
// ngưỡng miễn trừ (`e.uncomp > 1MB` mới bật kiểm tỉ lệ nén). Một mục khai `uncomp` DƯỚI 1MB trong
// khi dữ liệu nén thật giải ra hàng trăm MB thì trượt qua MỌI kiểm tra ở đây, rồi mới nổ bom thật
// khi exceljs/JSZip giải nén nó. ĐÃ DỰNG PoC: central directory khai `uncompressed=1.048.575`
// (dưới 1MB đúng 1 byte), dữ liệu nén thật là 50MB số 0 nén còn ~50KB — `inspectXlsx` bản cũ trả
// `{ok:true}`, JSZip giải nén ra đủ 50MB thật.
//
// CÁCH VÁ: không tin số khai nữa. GIẢI NÉN THẬT từng mục (đọc thẳng local file header + luồng
// zlib inflate CHUẨN, streaming — xem `giaiNenThatCoTran`), đếm dồn byte ra THẬT, và HUỶ NGAY khi
// vượt trần — không đợi giải nén xong. Với một bom thật, luồng chạm trần trong vài mili-giây (bom
// đạt tỉ lệ nén cao ngay từ những byte đầu), nên chi phí kiểm KHÔNG tỉ lệ với kích thước bom mà kẻ
// tấn công khai — chỉ tỉ lệ với TRẦN mình đặt ra. Với tệp hợp lệ, tổng giải nén thật vốn đã nhỏ
// (vài MB) nên việc giải nén thật không tốn hơn đáng kể so với đọc central directory.
import { createInflateRaw } from "node:zlib";

const EOCD_SIG = 0x06054b50;
const CD_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

// Ngưỡng: xlsx báo giá thật ở hệ này lớn nhất khoảng vài MB / vài chục sheet.
const MAX_ENTRIES = 2_000;                    // xlsx bình thường vài chục mục
const MAX_UNCOMPRESSED = 200 * 1024 * 1024;   // 200 MB tổng sau giải nén — nay là TRẦN THẬT, không phải số khai

// Mục BẮT BUỘC của một workbook OOXML. Thiếu bất kỳ cái nào thì đó không phải xlsx, bất kể đuôi tệp.
const REQUIRED = ["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml"];

export type ZipVerdict = { ok: true; entries: number; uncompressed: number } | { ok: false; reason: string };

// Trần THẬT dùng để kiểm ngược trong test (tests/zipSafety.test.js) mà không phải chép lại số
// "200 * 1024 * 1024" — chép tay hằng số này ở hai nơi là chỗ chắc chắn sẽ trôi khỏi nhau.
export const _TRAN_GIAI_NEN_THAT_TEST = MAX_UNCOMPRESSED;

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

  const entries: { name: string; comp: number; uncomp: number; method: number; localOffset: number }[] = [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CD_SIG) return null;
    const method = buf.readUInt16LE(p + 10);
    const comp = buf.readUInt32LE(p + 20);
    const uncomp = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const cmtLen = buf.readUInt16LE(p + 32);
    // Offset của LOCAL FILE HEADER — cần để giải nén THẬT mục này (xem giaiNenThatCoTran).
    // 0xFFFFFFFF cũng là cờ ZIP64 ở trường này; đã từ chối ZIP64 ở nhánh cdOffset/count phía trên
    // nên tới đây một giá trị như vậy là cấu trúc hỏng, không phải zip64 hợp lệ.
    const localOffset = buf.readUInt32LE(p + 42);
    if (p + 46 + nameLen > buf.length) return null;
    entries.push({ name: buf.toString("utf8", p + 46, p + 46 + nameLen), comp, uncomp, method, localOffset });
    p += 46 + nameLen + extraLen + cmtLen;
    // Chặn sớm: tệp khai 200.000 mục thì dừng ngay, không duyệt hết rồi mới báo.
    if (entries.length > MAX_ENTRIES) break;
  }
  return entries;
}

/**
 * Giải nén THẬT một mục deflate, đếm dồn byte ra thật, HUỶ NGAY khi vượt `tran` — không đợi xong.
 *
 * KHÔNG tin `comp` (kích thước nén khai trong central directory) để biết dữ liệu THẬT có bao nhiêu
 * byte — chỉ dùng nó làm mốc cắt, và mốc đó luôn bị KẸP lại trong biên buffer thật đang có
 * (`Math.min(buf.length, dataStart + comp)`). Khai `comp` sai (kể cả 0 hoặc số khổng lồ) chỉ có thể
 * làm luồng inflate thấy input CỤT hoặc THỪA garbage ở cuối (zlib tự dừng đọc sau khối BFINAL) —
 * không bao giờ đọc vượt quá dữ liệu thật sự nằm trong buffer.
 *
 * Trả về số byte giải nén được. Reject nếu: local header hỏng, method không phải deflate/stored,
 * lỗi inflate (dữ liệu nén hỏng), hoặc vượt `tran` (message cố định "vuot-tran" để nơi gọi phân
 * biệt được với lỗi cấu trúc).
 */
function giaiNenThatCoTran(buf: Buffer, e: { comp: number; uncomp: number; method: number; localOffset: number }, tran: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const off = e.localOffset;
    if (off < 0 || off + 30 > buf.length || buf.readUInt32LE(off) !== LOCAL_SIG) {
      return reject(new Error("local file header hỏng"));
    }
    const nameLen = buf.readUInt16LE(off + 26);
    const extraLen = buf.readUInt16LE(off + 28);
    const dataStart = off + 30 + nameLen + extraLen;
    if (dataStart > buf.length) return reject(new Error("local file header hỏng (vượt buffer)"));

    // method 0 = STORED (không nén): kích thước thật CHÍNH LÀ số byte vật lý đang có, kẹp trong
    // buffer thật — không cần zlib, và bản thân số này đã bị chặn bởi trần tải lên (multer).
    if (e.method === 0) {
      const thuc = Math.max(0, Math.min(buf.length, dataStart + Math.max(0, e.comp)) - dataStart);
      return thuc > tran ? reject(new Error("vuot-tran")) : resolve(thuc);
    }
    if (e.method !== 8) return reject(new Error(`phương thức nén không hỗ trợ (${e.method})`));

    const dataEnd = Math.min(buf.length, dataStart + Math.max(0, e.comp));
    const raw = buf.subarray(dataStart, dataEnd);

    const inflater = createInflateRaw();
    let tong = 0;
    let xong = false;
    const ketThuc = (fn: (a: any) => void, a: any) => {
      if (xong) return;
      xong = true;
      inflater.destroy();
      fn(a);
    };
    inflater.on("data", (chunk: Buffer) => {
      tong += chunk.length;
      // HUỶ NGAY tại đây — KHÔNG đợi 'end'. Đây chính là điều làm chi phí kiểm không tỉ lệ với
      // kích thước bom: một bom thật vượt `tran` trong vài chunk đầu, luồng bị destroy() ngay lập
      // tức, không bao giờ giải nén hết phần còn lại (có thể là hàng trăm MB/GB).
      if (tong > tran) ketThuc(reject, new Error("vuot-tran"));
    });
    inflater.on("end", () => ketThuc(resolve, tong));
    inflater.on("error", (e2: Error) => ketThuc(reject, e2));
    inflater.end(raw);
  });
}

/**
 * Tệp này có thực sự là workbook .xlsx an toàn để đưa cho bộ đọc không.
 * Gọi TRƯỚC khi trao buffer cho exceljs / bộ nhập Excel.
 *
 * BẤT ĐỒNG BỘ (khác bản trước): giải nén thật cần luồng zlib streaming để huỷ giữa chừng được —
 * `inflateRawSync` sẽ giải nén TRỌN trước khi trả về, đúng cái cần tránh với một bom thật.
 */
export async function inspectXlsx(buf: Buffer): Promise<ZipVerdict> {
  if (buf.length < 22) return { ok: false, reason: "tệp quá nhỏ để là .xlsx" };
  if (!(buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04)) {
    return { ok: false, reason: "không phải tệp zip (.xlsx là zip)" };
  }
  const entries = readCentralDirectory(buf);
  if (!entries) return { ok: false, reason: "cấu trúc zip hỏng hoặc không hỗ trợ (ZIP64)" };
  if (entries.length > MAX_ENTRIES) return { ok: false, reason: `quá nhiều mục bên trong (>${MAX_ENTRIES})` };
  if (entries.length === 0) return { ok: false, reason: "zip rỗng" };

  for (const e of entries) {
    if (isUnsafeEntryName(e.name)) return { ok: false, reason: `tên mục không an toàn: ${e.name.slice(0, 60)}` };
  }

  // TRẦN THẬT, không phải số khai — xem chú thích đầu file. Chạy TUẦN TỰ (không Promise.all) để
  // running total dừng được NGAY khi mục hiện tại đã đủ vượt trần, không tốn công giải nén thêm
  // các mục còn lại.
  let totalUncomp = 0;
  for (const e of entries) {
    let thucTe: number;
    try {
      thucTe = await giaiNenThatCoTran(buf, e, MAX_UNCOMPRESSED - totalUncomp);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === "vuot-tran") return { ok: false, reason: "tổng dung lượng sau giải nén quá lớn (nghi bom nén)" };
      return { ok: false, reason: `không giải nén được mục ${e.name.slice(0, 60)} (${msg.slice(0, 80)})` };
    }
    totalUncomp += thucTe;
    if (totalUncomp > MAX_UNCOMPRESSED) return { ok: false, reason: "tổng dung lượng sau giải nén quá lớn (nghi bom nén)" };
  }

  const names = new Set(entries.map((e) => e.name));
  const missing = REQUIRED.filter((r) => !names.has(r));
  if (missing.length) return { ok: false, reason: `thiếu thành phần bắt buộc của workbook: ${missing.join(", ")}` };
  if (![...names].some((n) => n.startsWith("xl/worksheets/"))) {
    return { ok: false, reason: "không có trang tính nào (xl/worksheets/)" };
  }

  return { ok: true, entries: entries.length, uncompressed: totalUncomp };
}
