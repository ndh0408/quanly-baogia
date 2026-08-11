// Kiểm an toàn .xlsx (src/zipSafety.ts) — chốt chặn TRƯỚC khi bộ đọc Excel chạm vào buffer người lạ.
//
// Trước đây cả hai đường nhận .xlsx chỉ kiểm 4 byte `PK\x03\x04`. Mọi tệp zip đều khớp — kể cả bom
// giải nén và zip có đường dẫn thoát thư mục. Test dưới đây dựng zip THẬT bằng zlib (không dùng thư
// viện zip ngoài, để chính bộ test không phụ thuộc thứ đang kiểm).
import { describe, it, expect } from "vitest";
import { deflateRawSync } from "node:zlib";
import { inspectXlsx } from "../src/zipSafety.js";

/** Dựng một tệp zip tối giản, đúng chuẩn, với danh sách mục cho trước. */
function makeZip(entries, { fakeUncompressed } = {}) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const raw = Buffer.from(data);
    const comp = deflateRawSync(raw);
    const nameBuf = Buffer.from(name, "utf8");
    const uncompSize = fakeUncompressed?.[name] ?? raw.length;

    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);           // version
    local.writeUInt16LE(0, 6);            // flags
    local.writeUInt16LE(8, 8);            // method = deflate
    local.writeUInt32LE(0, 14);           // crc (bộ kiểm không đọc crc)
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(uncompSize, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    nameBuf.copy(local, 30);
    locals.push(local, comp);

    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(comp.length, 20);
    central.writeUInt32LE(uncompSize, 24);
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
  it("chấp nhận zip có đủ thành phần OOXML", () => {
    const v = inspectXlsx(makeZip(validEntries()));
    expect(v.ok).toBe(true);
    expect(v.entries).toBe(4);
  });
});

describe("inspectXlsx — chặn tệp KHÔNG phải xlsx", () => {
  it("không phải zip → từ chối", () => {
    expect(inspectXlsx(Buffer.from("day khong phai zip, chi la van ban")).ok).toBe(false);
  });

  it("tệp quá nhỏ → từ chối", () => {
    expect(inspectXlsx(Buffer.from("PK\x03\x04")).ok).toBe(false);
  });

  it("zip HỢP LỆ nhưng KHÔNG phải workbook → từ chối (đây là ca magic bytes bỏ lọt)", () => {
    const v = inspectXlsx(makeZip([{ name: "anh.jpg", data: "noi dung bat ky" }]));
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/thiếu thành phần bắt buộc/i);
  });

  it("thiếu xl/workbook.xml → từ chối", () => {
    const e = validEntries().filter((x) => x.name !== "xl/workbook.xml");
    expect(inspectXlsx(makeZip(e)).ok).toBe(false);
  });

  it("có đủ thành phần nhưng KHÔNG có trang tính nào → từ chối", () => {
    const e = validEntries().filter((x) => !x.name.startsWith("xl/worksheets/"));
    const v = inspectXlsx(makeZip(e));
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
  ])("tên mục %s → từ chối", (bad) => {
    const v = inspectXlsx(makeZip([...validEntries(), { name: bad, data: "x" }]));
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/không an toàn/i);
  });

  it("tên có 'xl/..data' KHÔNG bị chặn nhầm (chỉ chặn thành phần '..' đứng riêng)", () => {
    const v = inspectXlsx(makeZip([...validEntries(), { name: "xl/..data.xml", data: "x" }]));
    expect(v.ok).toBe(true);
  });
});

describe("inspectXlsx — chặn bom nén", () => {
  it("tỉ lệ nén dị thường trên 1 mục → từ chối", () => {
    // Mục lục khai 50 MB sau giải nén cho vài byte nén — đúng dấu hiệu bom.
    const v = inspectXlsx(makeZip([...validEntries(), { name: "xl/bom.xml", data: "a" }],
      { fakeUncompressed: { "xl/bom.xml": 50 * 1024 * 1024 } }));
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/bom nén/i);
  });

  it("tổng dung lượng sau giải nén vượt trần → từ chối", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ name: `xl/big${i}.xml`, data: "x".repeat(100) }));
    const fake = Object.fromEntries(many.map((m) => [m.name, 20 * 1024 * 1024]));
    const v = inspectXlsx(makeZip([...validEntries(), ...many], { fakeUncompressed: fake }));
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/bom nén|quá lớn/i);
  });

  it("quá nhiều mục → từ chối", () => {
    const many = Array.from({ length: 2100 }, (_, i) => ({ name: `xl/e${i}.xml`, data: "x" }));
    const v = inspectXlsx(makeZip([...validEntries(), ...many]));
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/quá nhiều mục/i);
  });
});

describe("inspectXlsx — cấu trúc hỏng", () => {
  it("cắt cụt phần đuôi (mất EOCD) → từ chối, không ném", () => {
    const z = makeZip(validEntries());
    expect(inspectXlsx(z.subarray(0, z.length - 30)).ok).toBe(false);
  });

  it("mục lục trỏ ra ngoài tệp → từ chối", () => {
    const z = makeZip(validEntries());
    z.writeUInt32LE(z.length + 5000, z.length - 22 + 16); // hỏng offset thư mục trung tâm
    expect(inspectXlsx(z).ok).toBe(false);
  });
});
