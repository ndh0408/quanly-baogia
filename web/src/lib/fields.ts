// Metadata 1 nguồn cho cả FORM lẫn BẢNG. Khớp model PersonnelRecord + công thức/tham chiếu ở server.
export type FieldType = "text" | "number" | "money" | "date" | "textarea" | "status";
// Nguồn dữ liệu (khớp chú giải màu Excel của chủ dự án):
//   input       🟡 nhập tay  → hiện trong form, sửa được
//   formula     🔵 công thức  → server tự tính (Thuế TNCN=Lương/9, Thu nhập chịu thuế=Lương×10/9), KHÔNG nhập
//   ref-project 🩷 tham chiếu → server tự lấy từ Dự án theo Mã dự án, KHÔNG nhập
//   action      🟢 hành động  → KẾ TOÁN bấm đánh dấu (vd Thanh toán), KHÔNG nhập tay trong form
export type FieldSource = "input" | "formula" | "ref-project" | "action";
// AI được sửa-tại-chỗ ô này (khớp endpoint + quyền backend): owner=Account chủ dòng · accounting=Kế toán ·
// admin=Admin · pay=đánh dấu thanh toán (Kế toán) · confirm=xác nhận đã ký (Admin). Không có = read-only ở bảng.
export type FieldEdit = "owner" | "accounting" | "admin" | "pay" | "confirm";
export type Field = { key: string; label: string; type: FieldType; group: string; source: FieldSource; edit?: FieldEdit; ph?: string };

export const GROUPS = ["Cá nhân", "Lương / Thuế", "Dự án", "Hợp đồng", "Thanh toán"] as const;

export const FIELDS: Field[] = [
  // Cá nhân (Stage 1: nhập tay — Stage 2 sẽ chuyển sang chọn từ Danh bạ nhân sự)
  { key: "fullName", label: "Họ & Tên", type: "text", group: "Cá nhân", source: "input" },
  { key: "taxCode", label: "Mã số thuế", type: "text", group: "Cá nhân", source: "input" },
  // 2026-07-20 "Năm sinh"→"Ngày sinh": hợp đồng dịch vụ cần ĐỦ dd/mm/yyyy; dữ liệu cũ chỉ có năm
  // vẫn hợp lệ (text tự do) — hợp đồng tải ra sẽ tự in nhãn "Năm sinh" cho hồ sơ chỉ có năm.
  { key: "birthYear", label: "Ngày sinh", type: "text", group: "Cá nhân", source: "input", ph: "VD: 16/08/1993 — nhập đủ ngày/tháng/năm để in hợp đồng" },
  { key: "idCard", label: "Căn cước", type: "text", group: "Cá nhân", source: "input" },
  { key: "idIssueDate", label: "Ngày cấp", type: "date", group: "Cá nhân", source: "input" },
  { key: "idIssuePlace", label: "Nơi cấp", type: "text", group: "Cá nhân", source: "input" },
  { key: "address", label: "Địa chỉ", type: "text", group: "Cá nhân", source: "input" },
  { key: "bankAccount", label: "STK", type: "text", group: "Cá nhân", source: "input" },
  { key: "bankName", label: "Ngân hàng", type: "text", group: "Cá nhân", source: "input" },
  { key: "phone", label: "Số điện thoại", type: "text", group: "Cá nhân", source: "input" },
  // Lương / Thuế
  { key: "salary", label: "Lương", type: "money", group: "Lương / Thuế", source: "input" },
  { key: "pit", label: "Thuế TNCN", type: "money", group: "Lương / Thuế", source: "formula" },
  { key: "taxableIncome", label: "Thu nhập chịu thuế", type: "money", group: "Lương / Thuế", source: "formula" },
  // Dự án
  { key: "workStart", label: "Thời gian làm việc (ngày bắt đầu)", type: "date", group: "Dự án", source: "input" },
  { key: "workEnd", label: "Thời gian làm việc (ngày kết thúc)", type: "date", group: "Dự án", source: "input" },
  { key: "workLocation", label: "Địa điểm làm việc", type: "text", group: "Dự án", source: "input" },
  { key: "projectName", label: "Tên dự án", type: "text", group: "Dự án", source: "input" },
  { key: "projectCode", label: "Mã dự án", type: "text", group: "Dự án", source: "input" },
  { key: "teamNote", label: "Team ghi chú", type: "text", group: "Dự án", source: "input", edit: "owner" },
  { key: "accountName", label: "Account", type: "text", group: "Dự án", source: "input" },
  { key: "company", label: "CTY", type: "text", group: "Dự án", source: "input" },
  // Hợp đồng
  // 2026-07-20 đổi nhãn "Tên hợp đồng" → "Nội dung hợp đồng": giá trị này đổ vào mục
  // "Công việc phải làm" của Hợp đồng dịch vụ tải ra (.docx) — key DB giữ nguyên.
  { key: "projectNameContract", label: "Nội dung hợp đồng", type: "text", group: "Hợp đồng", source: "input" },
  { key: "laborContractNo", label: "Số HĐ LĐ", type: "text", group: "Hợp đồng", source: "input" },
  { key: "laborContractDate", label: "Ngày HĐ LĐ", type: "date", group: "Hợp đồng", source: "input" },
  { key: "salesContractNo", label: "Số HĐ bán", type: "text", group: "Hợp đồng", source: "ref-project" },
  { key: "salesContractDate", label: "Ngày HĐ bán", type: "date", group: "Hợp đồng", source: "ref-project" },
  { key: "purchaseOrder", label: "Đơn đặt hàng", type: "text", group: "Hợp đồng", source: "ref-project" },
  { key: "preTaxAmount", label: "Tiền trước thuế", type: "money", group: "Hợp đồng", source: "ref-project" },
  // Thanh toán — KHÔNG nằm trong form chung; mỗi cột sửa-tại-chỗ theo đúng quyền (edit).
  { key: "accountingNote", label: "Kế toán ghi chú", type: "textarea", group: "Thanh toán", source: "action", edit: "accounting" },
  { key: "payment", label: "Thanh toán", type: "status", group: "Thanh toán", source: "action", edit: "pay" },
  { key: "confirmed", label: "Xác nhận (C.Hồng)", type: "status", group: "Thanh toán", source: "action", edit: "confirm" },
  { key: "note", label: "Note", type: "textarea", group: "Thanh toán", source: "action", edit: "admin" },
];

// Chỉ field NHẬP TAY mới hiện trong form (công thức/tham chiếu là read-only).
export const INPUT_FIELDS = FIELDS.filter((f) => f.source === "input");

// Bảng hiện ĐỦ MỌI CỘT theo đúng thứ tự file Excel gốc (= thứ tự FIELDS). Cuộn ngang; cột đầu ghim.
export const TABLE_COLS = FIELDS.map((f) => f.key);
// Backend cho sort theo các cột THẬT này (khớp enum ở personnel.routes.ts). Cột nào có
// trong set → header bấm sắp xếp được.
export const SORTABLE = new Set(["fullName", "taxCode", "salary", "workStart", "workEnd"]);

export const FIELD_BY_KEY: Record<string, Field> = Object.fromEntries(FIELDS.map((f) => [f.key, f]));

// Giá trị cột trạng thái → class màu (.status.ok / .danger / .neutral).
export function statusClass(v: unknown): "ok" | "danger" | "neutral" {
  const s = String(v ?? "").toLowerCase().trim();
  if (!s) return "neutral";
  if (/(chưa|không|hủy|huỷ|trễ|nợ|fail)/.test(s)) return "danger";
  if (/(đã|done|ok|xong|duyệt|ký|thanh ?toán|hoàn|đủ)/.test(s)) return "ok";
  return "neutral";
}
