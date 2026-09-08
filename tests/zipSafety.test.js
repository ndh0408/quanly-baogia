// Kiểm an toàn .xlsx (src/zipSafety.ts) — chốt chặn TRƯỚC khi bộ đọc Excel chạm vào buffer người lạ.
//
// Trước đây cả hai đường nhận .xlsx chỉ kiểm 4 byte `PK\x03\x04`. Mọi tệp zip đều khớp — kể cả bom
// giải nén và zip có đường dẫn thoát thư mục. Test dưới đây dựng zip THẬT bằng zlib (không dùng thư
// viện zip ngoài, để chính bộ test không phụ thuộc thứ đang kiểm).
//
// ── VÌ SAO TỆP NÀY VIẾT LẠI (ultracode audit 2026-09-09, finding H1) ─────────────────────────────
// Bản test cũ dựng bom bằng cách CHỈ khai gian metadata (`fakeUncompressed`) trong khi dữ liệu nén
// thật chỉ vài byte ("a", "x".repeat(100)…) — đúng cách bản `inspectXlsx` CŨ bị lừa (nó tin số
// khai). Sau bản vá, `inspectXlsx` KHÔNG còn đọc số khai để quyết định gì cả — nó giải nén THẬT rồi
// đếm byte ra thật. Test cũ chạy trên code MỚI sẽ XANH SAI LÝ DO (hoặc đỏ sai lý do): "khai 50MB,
// thật 1 byte" nay KHÔNG PHẢI bom thật, phải được CHẤP NHẬN — đúng bằng chứng sống rằng số khai
// không còn được tin. Test bom nén ở dưới nay dựng dữ liệu nén thật (zero-fill nén cực tốt) để bom
// nén THẬT SỰ TỒN TẠI trong buffer, không chỉ trong mục lục.
import { describe, it, expect } from "vitest";
import { deflateRawSync } from "node:zlib";
import { inspectXlsx, _TRAN_GIAI_NEN_THAT_TEST as TRAN } from "../src/zipSafety.js";

/**
 * Dựng một tệp zip tối giản, đúng chuẩn, với danh sách mục cho trước.
 *
 * Mỗi mục hoặc có `data` (chuỗi ngắn, nén tại chỗ) hoặc `rawBytes` (số byte 0x00 THẬT sẽ được nén —
 * dùng để dựng bom nén thật, zero-fill nén xuống gần như 0 nhưng giải nén ra đúng `rawBytes`).
 * `fakeDeclared` (tuỳ chọn) GHI ĐÈ số "uncompressed" khai trong metadata (cả local header lẫn
 * central directory) khác với kích thước THẬT — để kiểm rằng `inspectXlsx` không còn tin số này.
 */
function makeZip(entries, { fakeDeclared } = {}) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data, rawBytes } of entries) {
    const raw = rawBytes != null ? Buffer.alloc(rawBytes) : Buffer.from(data);
    const comp = deflateRawSync(raw);
    const nameBuf = Buffer.from(name, "utf8");
    const declaredUncomp = fakeDeclared?.[name] ?? raw.length;

    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);           // version
    local.writeUInt16LE(0, 6);            // flags
    local.writeUInt16LE(8, 8);            // method = deflate
    local.writeUInt32LE(0, 14);           // crc (bộ kiểm không đọc crc)
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(declaredUncomp, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    nameBuf.copy(local, 30);
    locals.push(local, comp);

    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(comp.length, 20);
    central.writeUInt32LE(declaredUncomp, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    nameBuf.copy(central, 46);
    centrals.push(central);

    offset += local.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

/** Bộ mục tối thiểu để được coi là workbook hợp lệ. */
const validEntries = () => [
  { name: "[Content_Types].xml", data: "<Types/>" },
  { name: "_rels/.rels", data: "<Relationships/>" },
  { name: "xl/workbook.xml", data: "<workbook/>" },
  { name: "xl/worksheets/sheet1.xml", data: "<worksheet/>" },
];

describe("inspectXlsx — workbook hợp lệ", () => {
  it("chấp nhận zip có đủ thành phần OOXML", async () => {
    const v = await inspectXlsx(makeZip(validEntries()));
    expect(v.ok).toBe(true);
    expect(v.entries).toBe(4);
  });
});

describe("inspectXlsx — chặn tệp KHÔNG phải xlsx", () => {
  it("không phải zip → từ chối", async () => {
    expect((await inspectXlsx(Buffer.from("day khong phai zip, chi la van ban"))).ok).toBe(false);
  });

  it("tệp quá nhỏ → từ chối", async () => {
    expect((await inspectXlsx(Buffer.from("PK\x03\x04"))).ok).toBe(false);
  });

  it("zip HỢP LỆ nhưng KHÔNG phải workbook → từ chối (đây là ca magic bytes bỏ lọt)", async () => {
    const v = await inspectXlsx(makeZip([{ name: "anh.jpg", data: "noi dung bat ky" }]));
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/thiếu thành phần bắt buộc/i);
  });

  it("thiếu xl/workbook.xml → từ chối", async () => {
    const e = validEntries().filter((x) => x.name !== "xl/workbook.xml");
    expect((await inspectXlsx(makeZip(e))).ok).toBe(false);
  });

  it("có đủ thành phần nhưng KHÔNG có trang tính nào → từ chối", async () => {
    const e = validEntries().filter((x) => !x.name.startsWith("xl/worksheets/"));
    const v = await inspectXlsx(makeZip(e));
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/trang tính/i);
  });
});

describe("inspectXlsx — chặn zip-slip (thoát thư mục)", () => {
  it.each([
    "../../../etc/passwd",
    "..\\..\\Windows\\System32\\x.dll",
    "/tuyet/doi/x.xml",
    "C:\\Windows\\x.xml",
  ])("tên mục %s → từ chối", async (bad) => {
    const v = await inspectXlsx(makeZip([...validEntries(), { name: bad, data: "x" }]));
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/không an toàn/i);
  });

  it("tên có 'xl/..data' KHÔNG bị chặn nhầm (chỉ chặn thành phần '..' đứng riêng)", async () => {
    const v = await inspectXlsx(makeZip([...validEntries(), { name: "xl/..data.xml", data: "x" }]));
    expect(v.ok).toBe(true);
  });
});

describe("inspectXlsx — chặn bom nén (giải nén THẬT, không tin số khai)", () => {
  // ĐÚNG PoC đã dùng để tìm ra H1: khai "uncompressed" NHỎ hơn 1 byte so với ngưỡng miễn trừ cũ
  // (1MB) của bản trước, trong khi dữ liệu nén thật giải ra một buffer LỚN GẤP BỘI. Bản cũ (tin số
  // khai) trả {ok:true} ở đây — chính là cách JSZip/exceljs downstream ăn đủ bom thật.
  it("PoC H1: khai NHỎ HƠN 1MB (né ngưỡng miễn trừ cũ) nhưng giải nén thật vượt trần → từ chối", async () => {
    const thatSu = TRAN + 10 * 1024 * 1024; // vượt trần thật một khoảng rõ ràng
    const v = await inspectXlsx(makeZip(
      [...validEntries(), { name: "xl/bom.xml", rawBytes: thatSu }],
      { fakeDeclared: { "xl/bom.xml": 1024 * 1024 - 1 } }, // khai 1.048.575 byte — DƯỚI ngưỡng cũ
    ));
    expect(v.ok, "phải bị chặn dù metadata khai nhỏ — vì giờ đây kiểm THẬT, không đọc số khai").toBe(false);
    expect(v.reason).toMatch(/bom nén|quá lớn/i);
  });

  it("khai metadata SAI (thấp hơn thật rất nhiều) nhưng nội dung thật KHÔNG PHẢI bom → vẫn được chấp nhận", async () => {
    // Đối chứng cho ca trên: metadata nói dối không còn là tiêu chí — chỉ khi nội dung THẬT vượt
    // trần mới bị chặn. Một tệp khai sai số nhưng vô hại thì không nên bị từ chối oan.
    const v = await inspectXlsx(makeZip(
      [...validEntries(), { name: "xl/nho.xml", data: "chi la mot chuoi ngan" }],
      { fakeDeclared: { "xl/nho.xml": 999_999_999 } }, // khai gần 1GB, thật chỉ vài chục byte
    ));
    expect(v.ok, "metadata nói dối không còn là căn cứ để từ chối — nội dung thật mới quyết định").toBe(true);
  });

  it("MỘT mục giải nén thật vượt trần → từ chối (không cần cộng dồn)", async () => {
    const v = await inspectXlsx(makeZip([...validEntries(), { name: "xl/mot-bom.xml", rawBytes: TRAN + 1024 }]));
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/bom nén|quá lớn/i);
  });

  it("KHÔNG mục nào một mình vượt trần, nhưng TỔNG cộng dồn nhiều mục thì vượt → từ chối", async () => {
    // Mỗi mục ~60% trần — không mục nào tự mình đủ để bị chặn — nhưng 2 mục cộng lại vượt hẳn.
    const moiMuc = Math.floor(TRAN * 0.6);
    const v = await inspectXlsx(makeZip([
      ...validEntries(),
      { name: "xl/a.xml", rawBytes: moiMuc },
      { name: "xl/b.xml", rawBytes: moiMuc },
    ]));
    expect(v.ok, "tổng 2 mục = 120% trần, phải bị chặn dù từng mục riêng lẻ chỉ 60%").toBe(false);
    expect(v.reason).toMatch(/quá lớn|bom nén/i);
  });

  it("tổng giải nén thật của workbook hợp lệ (nhỏ) vẫn qua bình thường", async () => {
    const v = await inspectXlsx(makeZip([...validEntries(), { name: "xl/vua-du.xml", rawBytes: 1024 * 1024 }]));
    expect(v.ok).toBe(true);
    expect(v.uncompressed).toBeGreaterThan(1024 * 1024);
  });

  it("quá nhiều mục → từ chối", async () => {
    const many = Array.from({ length: 2100 }, (_, i) => ({ name: `xl/e${i}.xml`, data: "x" }));
    const v = await inspectXlsx(makeZip([...validEntries(), ...many]));
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/quá nhiều mục/i);
  });
});

describe("inspectXlsx — cấu trúc hỏng", () => {
  it("cắt cụt phần đuôi (mất EOCD) → từ chối, không ném", async () => {
    const z = makeZip(validEntries());
    expect((await inspectXlsx(z.subarray(0, z.length - 30))).ok).toBe(false);
  });

  it("mục lục trỏ ra ngoài tệp → từ chối", async () => {
    const z = makeZip(validEntries());
    z.writeUInt32LE(z.length + 5000, z.length - 22 + 16); // hỏng offset thư mục trung tâm
    expect((await inspectXlsx(z)).ok).toBe(false);
  });

  it("local file header hỏng (offset trỏ sai) → từ chối, không ném", async () => {
    const z = makeZip(validEntries());
    // Tìm bản ghi central directory ĐẦU TIÊN rồi phá offset local header của nó (trường ở +42).
    const cdSig = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
    const p = z.indexOf(cdSig);
    expect(p).toBeGreaterThanOrEqual(0);
    z.writeUInt32LE(0xdeadbeef % z.length, p + 42);
    const v = await inspectXlsx(z);
    expect(v.ok).toBe(false);
  });
});
