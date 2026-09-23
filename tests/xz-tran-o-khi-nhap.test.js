// XLSX-05 — trần nhập chỉ đếm DÒNG, không đếm Ô; worker OOM trả 422 tiếng Anh thay vì 413.
//
// ĐÃ ĐO (audit): tệp 6,7 MB, 20.000 dòng × 150 cột = 3 triệu ô lọt inspectXlsx (79 MB, 20k dòng),
// đốt 14 s CPU rồi worker chết ERR_WORKER_OUT_OF_MEMORY → 422 "Không đọc được file Excel: Worker
// terminated due to reaching memory limit: JS heap out of memory".
import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { inspectXlsx, _TRAN_O_THAT_TEST as TRAN_O } from "../src/zipSafety.js";
import { _loiTuWorkerNhap } from "../src/routes/import.routes.js";

async function xlsx(soDong, soCot) {
  const o = Array.from({ length: soCot }, (_, c) => `<c r="${String.fromCharCode(65 + (c % 26))}1" t="n"><v>1</v></c>`).join("");
  const dong = [];
  for (let r = 1; r <= soDong; r++) dong.push(`<row r="${r}">${o}</row>`);
  const z = new JSZip();
  z.file("[Content_Types].xml", "<Types/>");
  z.file("_rels/.rels", "<Relationships/>");
  z.file("xl/workbook.xml", "<workbook/>");
  z.file("xl/styles.xml", `<styleSheet><cellXfs count="1"><xf/></cellXfs><cols><col min="1" max="2"/></cols></styleSheet>`);
  z.file("xl/worksheets/sheet1.xml", `<worksheet><cols><col min="1" max="${soCot}" width="9"/></cols><sheetData>${dong.join("")}</sheetData></worksheet>`);
  return z.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

describe("XLSX-05: trần số ô", () => {
  it("vượt trần ô (dòng ÍT, cột RẤT nhiều) → bị từ chối kèm lý do tiếng Việt", async () => {
    const soCot = 200, soDong = Math.ceil((TRAN_O + 1) / soCot);   // ~7.500 dòng — dưới xa trần 120.000 dòng
    const kq = await inspectXlsx(await xlsx(soDong, soCot));
    expect(kq.ok, "tệp nhiều ô lọt qua — worker sẽ OOM").toBe(false);
    expect(kq.reason).toMatch(/quá nhiều ô/);
  });

  it("báo giá cỡ thật (1.000 dòng × 20 cột) vẫn qua", async () => {
    const kq = await inspectXlsx(await xlsx(1000, 20));
    expect(kq.ok, JSON.stringify(kq)).toBe(true);
  });
});

describe("XLSX-05: worker OOM → 413", () => {
  it("ERR_WORKER_OUT_OF_MEMORY → LoiNhap 413 tiếng Việt; lỗi khác giữ nguyên", () => {
    const oom = _loiTuWorkerNhap(Object.assign(new Error("Worker terminated due to reaching memory limit: JS heap out of memory"), { code: "ERR_WORKER_OUT_OF_MEMORY" }));
    expect(oom.status).toBe(413);
    expect(oom.message).toMatch(/quá lớn/);
    const khac = new Error("khác");
    expect(_loiTuWorkerNhap(khac)).toBe(khac);
  });
});
