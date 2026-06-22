// Metadata 1 nguồn cho cả FORM (đủ cột) lẫn BẢNG (cột rút gọn). Khớp model PersonnelRecord.
export type FieldType = "text" | "number" | "money" | "date" | "textarea";
export type Field = { key: string; label: string; type: FieldType; group: string };

export const GROUPS = ["Cá nhân", "Lương / Thuế", "Dự án", "Hợp đồng", "Thanh toán"] as const;

export const FIELDS: Field[] = [
  // Cá nhân
  { key: "fullName", label: "Họ & Tên", type: "text", group: "Cá nhân" },
  { key: "taxCode", label: "Mã số thuế", type: "text", group: "Cá nhân" },
  { key: "birthYear", label: "Năm sinh", type: "text", group: "Cá nhân" },
  { key: "idCard", label: "Căn cước", type: "text", group: "Cá nhân" },
  { key: "idIssueDate", label: "Ngày cấp", type: "date", group: "Cá nhân" },
  { key: "idIssuePlace", label: "Nơi cấp", type: "text", group: "Cá nhân" },
  { key: "address", label: "Địa chỉ", type: "text", group: "Cá nhân" },
  { key: "bankAccount", label: "Số tài khoản", type: "text", group: "Cá nhân" },
  { key: "bankName", label: "Ngân hàng", type: "text", group: "Cá nhân" },
  { key: "phone", label: "Số điện thoại", type: "text", group: "Cá nhân" },
  // Lương / Thuế
  { key: "salary", label: "Lương", type: "money", group: "Lương / Thuế" },
  { key: "pit", label: "Thuế TNCN", type: "money", group: "Lương / Thuế" },
  { key: "taxableIncome", label: "Thu nhập chịu thuế", type: "money", group: "Lương / Thuế" },
  // Dự án
  { key: "workStart", label: "Bắt đầu làm việc", type: "date", group: "Dự án" },
  { key: "workEnd", label: "Kết thúc làm việc", type: "date", group: "Dự án" },
  { key: "workLocation", label: "Địa điểm làm việc", type: "text", group: "Dự án" },
  { key: "projectName", label: "Tên dự án", type: "text", group: "Dự án" },
  { key: "projectCode", label: "Mã dự án", type: "text", group: "Dự án" },
  { key: "teamNote", label: "Team ghi chú", type: "text", group: "Dự án" },
  { key: "accountName", label: "Account", type: "text", group: "Dự án" },
  { key: "company", label: "Công ty", type: "text", group: "Dự án" },
  // Hợp đồng
  { key: "projectNameContract", label: "Tên dự án (HĐ)", type: "text", group: "Hợp đồng" },
  { key: "laborContractNo", label: "Số HĐ LĐ", type: "text", group: "Hợp đồng" },
  { key: "laborContractDate", label: "Ngày HĐ LĐ", type: "date", group: "Hợp đồng" },
  { key: "salesContractNo", label: "Số HĐ bán", type: "text", group: "Hợp đồng" },
  { key: "salesContractDate", label: "Ngày HĐ bán", type: "date", group: "Hợp đồng" },
  { key: "purchaseOrder", label: "Đơn đặt hàng", type: "text", group: "Hợp đồng" },
  { key: "preTaxAmount", label: "Tiền trước thuế", type: "money", group: "Hợp đồng" },
  // Thanh toán
  { key: "accountingNote", label: "Kế toán ghi chú", type: "textarea", group: "Thanh toán" },
  { key: "payment", label: "Thanh toán", type: "text", group: "Thanh toán" },
  { key: "confirmed", label: "Xác nhận", type: "text", group: "Thanh toán" },
  { key: "note", label: "Note", type: "textarea", group: "Thanh toán" },
];

// Cột hiển thị trong bảng danh sách (rút gọn — phần còn lại xem trong form).
export const TABLE_COLS = ["fullName", "projectName", "projectCode", "salary", "pit", "workStart", "payment", "confirmed"];

export const FIELD_BY_KEY: Record<string, Field> = Object.fromEntries(FIELDS.map((f) => [f.key, f]));
