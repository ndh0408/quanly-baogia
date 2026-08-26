// Không hồi quy trên MẪU THẬT: bản vá ranh giới đoạn (paragraphStartBefore) và chốt chặn
// "{{PC_" phải giữ nguyên hành vi với templates/hd-dichvu-template.docx đang dùng.
// (tests/xp3-docx-contract.test.js thay mẫu bằng bản Word-hoá để bắt lỗi; ở đây dùng file thật.)
import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { SaxesParser } from "saxes";
import { buildContractDocx } from "../src/services/contractDocx.js";

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

function xmlError(xml) {
  const p = new SaxesParser();
  let err = null;
  p.on("error", (e) => { if (!err) err = e.message; });
  try { p.write(xml).close(); } catch (e) { if (!err) err = e.message; }
  return err;
}

describe("mẫu hợp đồng thật", () => {
  it("CHƯA thanh toán: bỏ khối phiếu chi, XML hợp lệ", async () => {
    const { buffer, fileName } = await buildContractDocx(rec({ paidAt: null }));
    const xml = await docXml(buffer);
    expect(xmlError(xml)).toBeNull();
    expect(xml).not.toContain("{{PC_");
    expect(xml).not.toContain("{{");            // mọi token đều đã thay
    expect(xml).toContain("NGUYỄN VĂN A");
    expect(xml).toContain("31,500,000");
    expect(fileName).toBe("HD DV - Nguyễn Văn A.docx");
  });

  it("ĐÃ thanh toán: giữ khối phiếu chi, chỉ gỡ marker", async () => {
    const { buffer } = await buildContractDocx(rec({ paidAt: new Date("2026-03-25") }));
    const xml = await docXml(buffer);
    expect(xmlError(xml)).toBeNull();
    expect(xml).not.toContain("{{");
    expect(xml).toContain("25 tháng 03 năm 2026");   // ngày chi đã điền
  });

  it("hồ sơ thiếu dữ liệu vẫn báo 400 chứ không sinh file rỗng", async () => {
    await expect(buildContractDocx(rec({ salary: 0 }))).rejects.toMatchObject({ status: 400 });
  });
});
