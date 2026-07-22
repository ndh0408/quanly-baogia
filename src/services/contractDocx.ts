// Sinh HỢP ĐỒNG DỊCH VỤ (.docx) cho hồ sơ Nhân sự từ mẫu templates/hd-dichvu-template.docx
// (mẫu = file HĐDV thật của công ty, các giá trị đã thay bằng token {{...}}).
// - Bên B (tên/năm sinh/CCCD/địa chỉ/liên hệ) + thời hạn (workStart→workEnd) + thù lao (salary)
//   + nội dung công việc (projectNameContract) lấy từ hồ sơ.
// - Ngày ký hợp đồng = workStart LÙI 5 NGÀY (yêu cầu chủ dự án).
// - Biên bản nghiệm thu đề ngày workEnd; PHIẾU CHI chỉ kèm khi ĐÃ thanh toán có ngày (paidAt) —
//   chưa thanh toán thì cắt trọn khối giữa 2 marker {{PC_START}}/{{PC_END}}.
import JSZip from "jszip";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { httpError } from "../httpError.js";

const TEMPLATE = path.join(process.cwd(), "templates", "hd-dichvu-template.docx");

const escXml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const pad2 = (n: number) => String(n).padStart(2, "0");
const ddmmyyyy = (d: Date) => `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
/** "15 tháng 01 năm 2025" — đúng định dạng ngày chữ trong mẫu. */
const ngayChu = (d: Date) => `${pad2(d.getDate())} tháng ${pad2(d.getMonth() + 1)} năm ${d.getFullYear()}`;

// ===== Số tiền → CHỮ tiếng Việt (chuẩn kế toán: mốt/lăm/lẻ/mươi) =====
const DIGIT = ["không", "một", "hai", "ba", "bốn", "năm", "sáu", "bảy", "tám", "chín"];
function readTriple(n: number, full: boolean): string {
  const tr = Math.floor(n / 100), ch = Math.floor((n % 100) / 10), dv = n % 10;
  const p: string[] = [];
  if (full || tr > 0) p.push(DIGIT[tr], "trăm");
  if (ch > 1) {
    p.push(DIGIT[ch], "mươi");
    if (dv === 1) p.push("mốt");
    else if (dv === 4) p.push("tư");
    else if (dv === 5) p.push("lăm");
    else if (dv > 0) p.push(DIGIT[dv]);
  } else if (ch === 1) {
    p.push("mười");
    if (dv === 5) p.push("lăm");
    else if (dv > 0) p.push(DIGIT[dv]);
  } else if (dv > 0) {
    if (p.length) p.push("lẻ");
    p.push(DIGIT[dv]);
  }
  return p.join(" ");
}
export function moneyWordsVN(amount: number): string {
  let n = Math.round(Math.abs(amount));
  if (!n) return "Không đồng";
  const UNITS = ["", " nghìn", " triệu", " tỷ", " nghìn tỷ", " triệu tỷ"];
  const triples: number[] = [];
  while (n > 0) { triples.push(n % 1000); n = Math.floor(n / 1000); }
  const parts: string[] = [];
  for (let i = triples.length - 1; i >= 0; i--) {
    if (triples[i] === 0) continue;
    parts.push(readTriple(triples[i], i !== triples.length - 1) + UNITS[i]);
  }
  const s = parts.join(" ").replace(/\s+/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1) + " đồng";
}

/** Bỏ nguyên đoạn <w:p> chứa token (marker khi GIỮ phiếu chi). */
function dropParagraphWith(xml: string, token: string): string {
  const i = xml.indexOf(token);
  if (i < 0) return xml;
  const start = xml.lastIndexOf("<w:p>", i);
  const end = xml.indexOf("</w:p>", i);
  if (start < 0 || end < 0) return xml;
  return xml.slice(0, start) + xml.slice(end + "</w:p>".length);
}
/** Cắt từ đầu đoạn chứa PC_START đến hết đoạn chứa PC_END (khi CHƯA thanh toán → bỏ phiếu chi). */
function cutSection(xml: string, startToken: string, endToken: string): string {
  const si = xml.indexOf(startToken), ei = xml.indexOf(endToken);
  if (si < 0 || ei < 0) return xml;
  const start = xml.lastIndexOf("<w:p>", si);
  const end = xml.indexOf("</w:p>", ei);
  if (start < 0 || end < 0) return xml;
  return xml.slice(0, start) + xml.slice(end + "</w:p>".length);
}

type ContractRecord = {
  id: number;
  fullName: string;
  birthYear: string | null;
  idCard: string | null;
  address: string | null;
  phone: string | null;
  salary: unknown;               // Prisma Decimal
  workStart: Date | null;
  workEnd: Date | null;
  projectNameContract: string | null;
  projectName: string | null;
  laborContractNo: string | null;
  paidAt: Date | null;
};

export async function buildContractDocx(rec: ContractRecord): Promise<{ buffer: Buffer; fileName: string }> {
  // Hợp đồng phải đủ dữ liệu tối thiểu — báo rõ thiếu gì để bổ sung trước khi tải.
  const missing: string[] = [];
  if (!rec.fullName?.trim()) missing.push("Họ & Tên");
  if (!rec.workStart) missing.push("Thời gian làm việc (ngày bắt đầu)");
  if (!rec.workEnd) missing.push("Thời gian làm việc (ngày kết thúc)");
  if (rec.salary == null || !(Number(rec.salary) > 0)) missing.push("Lương");
  if (missing.length) throw httpError(400, `Hồ sơ thiếu: ${missing.join(", ")} — bổ sung rồi tải lại.`);

  const workStart = new Date(rec.workStart as Date);
  const workEnd = new Date(rec.workEnd as Date);
  const signDate = new Date(workStart.getTime() - 5 * 86400000);   // ngày ký = bắt đầu - 5 ngày
  const salary = Number(rec.salary);
  const soHd = rec.laborContractNo?.trim() || `${String(rec.id).padStart(2, "0")}/${signDate.getFullYear()}`;
  const dots = "…………………...";

  const birth = rec.birthYear?.trim() || "";
  const tokens: Record<string, string> = {
    SO_HD: soHd,
    NGAY_KY: ngayChu(signDate),
    TEN_HOA: rec.fullName.trim().toLocaleUpperCase("vi"),
    // Hồ sơ hay chỉ nhập NĂM ("1993") → nhãn tự đổi "Ngày sinh"/"Năm sinh" cho khỏi ngang tai.
    NS_LABEL: /^\d{4}$/.test(birth) ? "Năm sinh" : "Ngày sinh",
    NGAY_SINH: birth || dots,
    CCCD: rec.idCard?.trim() || dots,
    DIA_CHI: rec.address?.trim() || dots,
    LIEN_HE: rec.phone?.trim() || dots,
    TU_NGAY: ddmmyyyy(workStart),
    DEN_NGAY: ddmmyyyy(workEnd),
    NOI_DUNG: rec.projectNameContract?.trim() || rec.projectName?.trim() || dots,
    THU_LAO: salary.toLocaleString("en-US"),                        // 31,500,000 — đúng kiểu mẫu gốc
    THU_LAO_CHU: moneyWordsVN(salary),
    NGAY_NT: ngayChu(workEnd),
    NGAY_CHI: rec.paidAt ? ngayChu(new Date(rec.paidAt)) : "",
  };

  const zip = await JSZip.loadAsync(await readFile(TEMPLATE));
  let xml = await zip.file("word/document.xml")!.async("string");

  // Phiếu chi: có ngày thanh toán → giữ (chỉ gỡ 2 marker); chưa → cắt trọn khối.
  xml = rec.paidAt
    ? dropParagraphWith(dropParagraphWith(xml, "{{PC_START}}"), "{{PC_END}}")
    : cutSection(xml, "{{PC_START}}", "{{PC_END}}");

  for (const [k, v] of Object.entries(tokens)) xml = xml.split(`{{${k}}}`).join(escXml(v));

  zip.file("word/document.xml", xml);
  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  return { buffer, fileName: `HD DV - ${rec.fullName.trim()}.docx` };
}
