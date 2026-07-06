// Central RBAC: a permission catalog + static role→permission map + a can() helper.
// Replaces ad-hoc `session.role === "admin"` checks scattered across routes.
//
// Permission format: "resource:action" or "resource:action:scope".
//   scope "own"  → only resources the user created
//   scope "all"  → any resource
// A role granted "quote:update:all" implicitly also has "own".

import type { Request, Response, NextFunction } from "express";

export const PERMISSIONS = {
  // Quotes
  QUOTE_CREATE:       "quote:create",
  QUOTE_READ_OWN:     "quote:read:own",
  QUOTE_READ_ALL:     "quote:read:all",
  QUOTE_UPDATE_OWN:   "quote:update:own",
  QUOTE_UPDATE_ALL:   "quote:update:all",
  QUOTE_DELETE_OWN:   "quote:delete:own",
  QUOTE_DELETE_ALL:   "quote:delete:all",
  // Luồng duyệt nội bộ (quote:submit/approve/approve:own/reject) ĐÃ BỎ 2026-06-22:
  // vòng đời mới draft → converted/lost; "duyệt" thật = quyết định của khách.
  QUOTE_SEND:         "quote:send",
  QUOTE_EXPORT:       "quote:export",
  // Customers (CRM)
  CUSTOMER_READ_OWN:   "customer:read:own",
  CUSTOMER_READ_ALL:   "customer:read:all",
  CUSTOMER_MANAGE_OWN: "customer:manage:own",
  CUSTOMER_MANAGE_ALL: "customer:manage:all",
  // Products / price book
  PRODUCT_READ:        "product:read",
  PRODUCT_READ_COST:   "product:read:cost", // see costPrice / margin
  PRODUCT_MANAGE:      "product:manage",
  // Admin / management
  USER_MANAGE:        "user:manage",
  ROLE_ASSIGN:        "role:assign",
  TEMPLATE_MANAGE:    "template:manage",
  COMPANY_MANAGE:     "company:manage",
  AUDIT_VIEW:         "audit:view",
  SETTINGS_MANAGE:    "settings:manage",
  // Nhân sự (hồ sơ nhân công — trang "Nhân sự"). Account tạo + sở hữu; hr/accountant chỉ đọc.
  PERSONNEL_CREATE:     "personnel:create",
  PERSONNEL_READ_OWN:   "personnel:read:own",
  PERSONNEL_READ_ALL:   "personnel:read:all",
  PERSONNEL_MANAGE_OWN: "personnel:manage:own",
  PERSONNEL_MANAGE_ALL: "personnel:manage:all",
  PERSONNEL_MARK_PAYMENT: "personnel:pay", // Kế toán bấm "đã thanh toán" (có ngày) — KHÔNG sửa hồ sơ
  PERSONNEL_CONFIRM:      "personnel:confirm", // ADMIN bấm xác nhận "đã ký" (có ngày) — chỉ admin
  PERSONNEL_ACCOUNTING_NOTE: "personnel:accounting-note", // Kế toán ghi cột "KẾ TOÁN GHI CHÚ" (chỉ kế toán/admin)
  // Báo giá — nâng cao: thay các check ROLE CỨNG (account_hn / admin) bằng quyền gán được per-user.
  QUOTE_HN_FILL:          "quote:hn:fill",     // điền/gửi phần Hà Nội — CHỈ thấy bảng HN (lược phần khác)
  QUOTE_HN_MANAGE:        "quote:hn:manage",   // giao/duyệt phần Hà Nội + danh sách account HN
  QUOTE_INTERNAL_APPROVE: "quote:internal:approve", // duyệt dòng bảng nội bộ (HCM/khách)
  AUDIT_VIEW_FULL:        "audit:view:full",   // xem CHI TIẾT nhật ký (tên đối tượng + before/after + IP)
  // Hóa đơn / Quản lý dự án. TÁCH NGUYÊN TỬ: xem / sửa-thông-tin / đánh-dấu-thanh-toán RIÊNG —
  // để phân "người này sửa hóa đơn, người kia đánh dấu thanh toán" (thanh toán per-trang, không gộp).
  INVOICE_READ:           "invoice:read",      // xem trang "Quản lý dự án" (mọi dự án + tình trạng hóa đơn)
  INVOICE_PAGE:           "invoice:page",      // xem trang "HÓA ĐƠN" (kế toán) — nơi NHẬP mọi thông tin hóa đơn
  INVOICE_EDIT:           "invoice:edit",      // nhập số HĐ/PO/link + ngày gửi/nhận chứng từ (trang Hóa đơn)
  INVOICE_PAY:            "invoice:pay",        // ĐÁNH DẤU đã thanh toán hóa đơn (ngày thu tiền)
  INVOICE_MANAGE:         "invoice:manage",    // [CŨ] gộp sửa+thanh toán — giữ để bắc cầu → edit+pay
  // Ký chứng từ (trang Quản lý dự án) — TÁCH cờ canSign cũ thành quyền gán được, có phạm vi rõ.
  QUOTE_SIGN_OWN:         "quote:sign:own",    // ký chứng từ dự án DO MÌNH TẠO
  QUOTE_SIGN_ALL:         "quote:sign:all",    // ký chứng từ MỌI dự án (admin/giám đốc)
  // (KHÔNG thêm quote:duplicate / quote:members — nhân bản đã kiểm create+đọc-nguồn; members đã đúng
  //  chủ-báo-giá/admin. Thêm scope là sai logic + thừa — bỏ theo phản hồi chủ dự án.)
  // Bảng nội bộ (HCM/HN/Phí KH) — tài khoản "chi phí": CHỈ xem nội bộ + thanh toán per-hàng.
  QUOTE_INTERNAL_VIEW:    "quote:internal:view", // CHỈ thấy bảng nội bộ — ẩn báo giá/giá/khách
  QUOTE_INTERNAL_PAY:     "quote:internal:pay",  // tích "đã thanh toán" + ảnh cho TỪNG HÀNG nội bộ
  // Khách hàng — TÁCH manage gộp → create/edit/delete nguyên tử + ghi chú.
  CUSTOMER_CREATE:        "customer:create",
  CUSTOMER_EDIT_OWN:      "customer:edit:own",
  CUSTOMER_EDIT_ALL:      "customer:edit:all",
  CUSTOMER_DELETE_OWN:    "customer:delete:own",
  CUSTOMER_DELETE_ALL:    "customer:delete:all",
  CUSTOMER_NOTE_ADD:      "customer:note:add",   // thêm ghi chú / theo dõi khách hàng
  // Nhân sự — TÁCH manage gộp → edit/delete nguyên tử.
  PERSONNEL_EDIT_OWN:     "personnel:edit:own",
  PERSONNEL_EDIT_ALL:     "personnel:edit:all",
  PERSONNEL_DELETE_OWN:   "personnel:delete:own",
  PERSONNEL_DELETE_ALL:   "personnel:delete:all",
  // Danh bạ nhân sự (Employee) — DOMAIN RIÊNG (trước mượn personnel:create).
  EMPLOYEE_READ_OWN:      "employee:read:own",
  EMPLOYEE_READ_ALL:      "employee:read:all",
  EMPLOYEE_CREATE:        "employee:create",
  EMPLOYEE_EDIT_OWN:      "employee:edit:own",
  EMPLOYEE_EDIT_ALL:      "employee:edit:all",
  EMPLOYEE_DELETE_OWN:    "employee:delete:own",
  EMPLOYEE_DELETE_ALL:    "employee:delete:all",
};

const P = PERMISSIONS;

// Human-readable labels (Vietnamese) for the permission-matrix UI.
export const PERMISSION_LABELS = {
  [P.QUOTE_CREATE]:     "Tạo báo giá",
  [P.QUOTE_READ_OWN]:   "Xem báo giá của mình",
  [P.QUOTE_READ_ALL]:   "Xem mọi báo giá",
  [P.QUOTE_UPDATE_OWN]: "Sửa báo giá của mình",
  [P.QUOTE_UPDATE_ALL]: "Sửa mọi báo giá",
  [P.QUOTE_DELETE_OWN]: "Xóa báo giá của mình",
  [P.QUOTE_DELETE_ALL]: "Xóa mọi báo giá",
  [P.QUOTE_SEND]:       "Gửi cho khách",
  [P.QUOTE_EXPORT]:     "Xuất Excel/PDF",
  [P.CUSTOMER_READ_OWN]:   "Xem KH của mình",
  [P.CUSTOMER_READ_ALL]:   "Xem mọi khách hàng",
  [P.CUSTOMER_MANAGE_OWN]: "Quản lý KH của mình",
  [P.CUSTOMER_MANAGE_ALL]: "Quản lý mọi khách hàng",
  [P.PRODUCT_READ]:        "Xem sản phẩm",
  [P.PRODUCT_READ_COST]:   "Xem giá vốn / biên LN",
  [P.PRODUCT_MANAGE]:      "Quản lý sản phẩm",
  [P.USER_MANAGE]:      "Quản lý nhân viên",
  [P.ROLE_ASSIGN]:      "Phân vai trò",
  [P.TEMPLATE_MANAGE]:  "Quản lý mẫu",
  [P.COMPANY_MANAGE]:   "Quản lý công ty",
  [P.AUDIT_VIEW]:       "Xem nhật ký",
  [P.SETTINGS_MANAGE]:  "Cài đặt hệ thống",
  [P.PERSONNEL_CREATE]:     "Tạo hồ sơ nhân sự",
  [P.PERSONNEL_READ_OWN]:   "Xem hồ sơ mình tạo",
  [P.PERSONNEL_READ_ALL]:   "Xem mọi hồ sơ nhân sự",
  [P.PERSONNEL_MANAGE_OWN]: "Sửa/xóa hồ sơ mình tạo",
  [P.PERSONNEL_MANAGE_ALL]: "Sửa/xóa mọi hồ sơ nhân sự",
  [P.PERSONNEL_MARK_PAYMENT]: "Đánh dấu đã thanh toán",
  [P.PERSONNEL_CONFIRM]: "Xác nhận đã ký",
  [P.PERSONNEL_ACCOUNTING_NOTE]: "Ghi 'Kế toán ghi chú'",
  [P.QUOTE_HN_FILL]:   "Điền phần Hà Nội (chỉ bảng HN)",
  [P.QUOTE_HN_MANAGE]: "Giao / duyệt phần Hà Nội",
  [P.QUOTE_INTERNAL_APPROVE]: "Duyệt dòng bảng nội bộ",
  [P.AUDIT_VIEW_FULL]: "Xem chi tiết nhật ký (tên + thay đổi)",
  [P.INVOICE_READ]:   "Xem trang Quản lý dự án (hóa đơn)",
  [P.INVOICE_PAGE]:   "Xem trang Hóa đơn (kế toán)",
  [P.INVOICE_EDIT]:   "Sửa hóa đơn (số HĐ/PO/ngày)",
  [P.INVOICE_PAY]:    "Đánh dấu thanh toán (ngày thu tiền)",
  [P.INVOICE_MANAGE]: "Sửa hóa đơn / đánh dấu thanh toán",
  [P.QUOTE_SIGN_OWN]: "Ký chứng từ — dự án của mình",
  [P.QUOTE_SIGN_ALL]: "Ký chứng từ — mọi dự án",
  [P.QUOTE_INTERNAL_VIEW]: "Xem CHỈ bảng nội bộ (ẩn báo giá)",
  [P.QUOTE_INTERNAL_PAY]:  "Thanh toán từng dòng nội bộ (tích + ảnh)",
  [P.CUSTOMER_CREATE]:     "Tạo khách hàng",
  [P.CUSTOMER_EDIT_OWN]:   "Sửa KH của mình",
  [P.CUSTOMER_EDIT_ALL]:   "Sửa mọi khách hàng",
  [P.CUSTOMER_DELETE_OWN]: "Xóa KH của mình",
  [P.CUSTOMER_DELETE_ALL]: "Xóa mọi khách hàng",
  [P.CUSTOMER_NOTE_ADD]:   "Thêm ghi chú khách hàng",
  [P.PERSONNEL_EDIT_OWN]:   "Sửa hồ sơ của mình",
  [P.PERSONNEL_EDIT_ALL]:   "Sửa mọi hồ sơ nhân sự",
  [P.PERSONNEL_DELETE_OWN]: "Xóa hồ sơ của mình",
  [P.PERSONNEL_DELETE_ALL]: "Xóa mọi hồ sơ nhân sự",
  [P.EMPLOYEE_READ_OWN]:    "Xem danh bạ của mình",
  [P.EMPLOYEE_READ_ALL]:    "Xem cả danh bạ nhân sự",
  [P.EMPLOYEE_CREATE]:      "Thêm vào danh bạ",
  [P.EMPLOYEE_EDIT_OWN]:    "Sửa danh bạ của mình",
  [P.EMPLOYEE_EDIT_ALL]:    "Sửa cả danh bạ",
  [P.EMPLOYEE_DELETE_OWN]:  "Xóa danh bạ của mình",
  [P.EMPLOYEE_DELETE_ALL]:  "Xóa cả danh bạ",
};

// Mô tả 1 dòng "nghĩa là gì + phạm vi" cho GIÁM ĐỐC đọc hiểu khi cấp quyền (hiện dưới mỗi ô + tooltip).
export const PERMISSION_DESC: Record<string, string> = {
  [P.QUOTE_CREATE]:     "Tạo báo giá mới.",
  [P.QUOTE_READ_OWN]:   "Xem báo giá tự tạo HOẶC được thêm làm thành viên.",
  [P.QUOTE_READ_ALL]:   "Xem MỌI báo giá trong hệ thống (kể cả của người khác).",
  [P.QUOTE_UPDATE_OWN]: "Sửa báo giá của mình (khi chưa chốt/không-chốt).",
  [P.QUOTE_UPDATE_ALL]: "Sửa BẤT KỲ báo giá nào, mọi trạng thái.",
  [P.QUOTE_DELETE_OWN]: "Xóa báo giá của mình.",
  [P.QUOTE_DELETE_ALL]: "Xóa BẤT KỲ báo giá nào.",
  [P.QUOTE_SEND]:       "Gửi khách + đánh dấu Chốt / Không chốt.",
  [P.QUOTE_EXPORT]:     "Tải Excel / PDF báo giá.",
  [P.QUOTE_HN_FILL]:    "CHỈ thấy & điền bảng giá Hà Nội của báo giá được giao (không thấy phần khác).",
  [P.QUOTE_HN_MANAGE]:  "Giao người điền phần Hà Nội + duyệt/trả phần đó.",
  [P.QUOTE_INTERNAL_APPROVE]: "Đóng dấu DUYỆT các dòng bảng nội bộ (HCM/khách).",
  [P.QUOTE_SIGN_OWN]:   "Bấm 'Ký chứng từ' ở trang Quản lý dự án — CHỈ dự án mình tạo.",
  [P.QUOTE_SIGN_ALL]:   "Bấm 'Ký chứng từ' cho MỌI dự án (không giới hạn người tạo).",
  [P.CUSTOMER_READ_OWN]:   "Xem khách hàng mình phụ trách.",
  [P.CUSTOMER_READ_ALL]:   "Xem mọi mã khách hàng (danh bạ chung).",
  [P.CUSTOMER_MANAGE_OWN]: "Thêm/sửa/xóa khách hàng của mình.",
  [P.CUSTOMER_MANAGE_ALL]: "Thêm/sửa/xóa MỌI khách hàng.",
  [P.PRODUCT_READ]:        "Xem sản phẩm + giá bán.",
  [P.PRODUCT_READ_COST]:   "Xem thêm GIÁ VỐN + biên lợi nhuận.",
  [P.PRODUCT_MANAGE]:      "Thêm/sửa/xóa sản phẩm + bảng giá.",
  [P.PERSONNEL_CREATE]:     "Tạo hồ sơ nhân sự mới.",
  [P.PERSONNEL_READ_OWN]:   "Xem hồ sơ nhân sự mình tạo.",
  [P.PERSONNEL_READ_ALL]:   "Xem MỌI hồ sơ nhân sự + bảng TỔNG lương/thuế.",
  [P.PERSONNEL_MANAGE_OWN]: "Sửa/xóa hồ sơ mình tạo.",
  [P.PERSONNEL_MANAGE_ALL]: "Sửa/xóa MỌI hồ sơ nhân sự.",
  [P.PERSONNEL_MARK_PAYMENT]: "Trang Nhân sự: tích 'đã thanh toán' + up ảnh (kế toán).",
  [P.PERSONNEL_CONFIRM]:      "Trang Nhân sự: xác nhận 'đã ký' (admin).",
  [P.PERSONNEL_ACCOUNTING_NOTE]: "Trang Nhân sự: ghi cột 'Kế toán ghi chú'.",
  [P.INVOICE_READ]:   "Mở trang Quản lý dự án (THAM CHIẾU — dữ liệu hóa đơn chỉ xem, nhập ở trang Hóa đơn).",
  [P.INVOICE_PAGE]:   "Mở trang HÓA ĐƠN (kế toán) — nơi NHẬP mọi thông tin hóa đơn; xem MỌI dự án đã chốt.",
  [P.INVOICE_EDIT]:   "Nhập thông tin hóa đơn ở trang Hóa đơn: số HĐ, ngày HĐ, PO, CTy, hình thức TT, chứng từ, link… (KHÔNG gồm ngày thu tiền).",
  [P.INVOICE_PAY]:    "CHỈ nhập 'Ngày thu tiền' (đánh dấu đã thanh toán) ở trang Hóa đơn.",
  [P.USER_MANAGE]:      "Mời/khóa tài khoản + TÍCH QUYỀN cho người khác.",
  [P.AUDIT_VIEW]:       "Xem nhật ký (tóm tắt: ai-làm-gì-khi-nào).",
  [P.AUDIT_VIEW_FULL]:  "Xem nhật ký CHI TIẾT (tên đối tượng + nội dung thay đổi + IP).",
  [P.SETTINGS_MANAGE]:  "Cài đặt hệ thống (email, sao lưu, tích hợp).",
  [P.QUOTE_INTERNAL_VIEW]: "CHỈ thấy các bảng nội bộ (HCM/HN/Phí KH) của báo giá — KHÔNG lộ báo giá chính (giá/khách/tổng). Dành tài khoản 'chi phí'.",
  [P.QUOTE_INTERNAL_PAY]:  "Tích 'đã thanh toán' + up ẢNH chứng từ cho TỪNG HÀNG bảng nội bộ (thanh toán nội bộ, riêng trang này).",
  [P.CUSTOMER_CREATE]:     "Thêm mã khách hàng mới.",
  [P.CUSTOMER_EDIT_OWN]:   "Sửa khách hàng mình phụ trách.",
  [P.CUSTOMER_EDIT_ALL]:   "Sửa BẤT KỲ khách hàng nào.",
  [P.CUSTOMER_DELETE_OWN]: "Xóa khách hàng mình phụ trách.",
  [P.CUSTOMER_DELETE_ALL]: "Xóa BẤT KỲ khách hàng nào.",
  [P.CUSTOMER_NOTE_ADD]:   "Thêm ghi chú / lịch theo dõi cho khách hàng.",
  [P.PERSONNEL_EDIT_OWN]:   "Sửa hồ sơ nhân sự mình tạo (lương/ngày/ghi chú…).",
  [P.PERSONNEL_EDIT_ALL]:   "Sửa BẤT KỲ hồ sơ nhân sự nào.",
  [P.PERSONNEL_DELETE_OWN]: "Xóa hồ sơ nhân sự mình tạo.",
  [P.PERSONNEL_DELETE_ALL]: "Xóa BẤT KỲ hồ sơ nhân sự nào.",
  [P.EMPLOYEE_READ_OWN]:    "Xem danh bạ nhân sự MÌNH thêm.",
  [P.EMPLOYEE_READ_ALL]:    "Xem TOÀN BỘ danh bạ nhân sự (mọi người).",
  [P.EMPLOYEE_CREATE]:      "Thêm người vào danh bạ nhân sự.",
  [P.EMPLOYEE_EDIT_OWN]:    "Sửa mục danh bạ MÌNH thêm.",
  [P.EMPLOYEE_EDIT_ALL]:    "Sửa BẤT KỲ mục danh bạ nào.",
  [P.EMPLOYEE_DELETE_OWN]:  "Xóa mục danh bạ MÌNH thêm.",
  [P.EMPLOYEE_DELETE_ALL]:  "Xóa BẤT KỲ mục danh bạ nào.",
};

// Permission groups for nicer matrix rendering.
export const PERMISSION_GROUPS = [
  { key: "quote", label: "Báo giá", perms: [
    P.QUOTE_CREATE, P.QUOTE_READ_OWN, P.QUOTE_READ_ALL, P.QUOTE_UPDATE_OWN, P.QUOTE_UPDATE_ALL,
    P.QUOTE_DELETE_OWN, P.QUOTE_DELETE_ALL,
    P.QUOTE_SEND, P.QUOTE_EXPORT,
    P.QUOTE_HN_FILL, P.QUOTE_HN_MANAGE, P.QUOTE_INTERNAL_APPROVE,
    P.QUOTE_INTERNAL_VIEW, P.QUOTE_INTERNAL_PAY,
  ] },
  { key: "customer", label: "Khách hàng", perms: [
    P.CUSTOMER_READ_OWN, P.CUSTOMER_READ_ALL, P.CUSTOMER_CREATE,
    P.CUSTOMER_EDIT_OWN, P.CUSTOMER_EDIT_ALL, P.CUSTOMER_DELETE_OWN, P.CUSTOMER_DELETE_ALL, P.CUSTOMER_NOTE_ADD,
  ] },
  // Nhóm "Sản phẩm" ĐÃ BỎ khỏi ma trận: app KHÔNG có tính năng sản phẩm (price book chưa làm) — quyền
  // product:* là tàn dư RBAC gốc, không route/trang/check nào dùng → ẩn cho khỏi rối giám đốc.
  // (Hằng số quyền + role default vẫn giữ để không vỡ test/SPA cũ; chỉ bỏ HIỂN THỊ.)
  { key: "admin", label: "Quản trị", perms: [
    P.USER_MANAGE, P.ROLE_ASSIGN, P.TEMPLATE_MANAGE, P.COMPANY_MANAGE,
    P.AUDIT_VIEW, P.AUDIT_VIEW_FULL, P.SETTINGS_MANAGE,
  ] },
  { key: "personnel", label: "Nhân sự (hồ sơ)", perms: [
    P.PERSONNEL_CREATE, P.PERSONNEL_READ_OWN, P.PERSONNEL_READ_ALL,
    P.PERSONNEL_EDIT_OWN, P.PERSONNEL_EDIT_ALL, P.PERSONNEL_DELETE_OWN, P.PERSONNEL_DELETE_ALL,
    P.PERSONNEL_MARK_PAYMENT, P.PERSONNEL_CONFIRM, P.PERSONNEL_ACCOUNTING_NOTE,
  ] },
  { key: "employee", label: "Danh bạ nhân sự", perms: [
    P.EMPLOYEE_READ_OWN, P.EMPLOYEE_READ_ALL, P.EMPLOYEE_CREATE,
    P.EMPLOYEE_EDIT_OWN, P.EMPLOYEE_EDIT_ALL, P.EMPLOYEE_DELETE_OWN, P.EMPLOYEE_DELETE_ALL,
  ] },
  { key: "invoice", label: "Hóa đơn / Quản lý dự án", perms: [
    P.INVOICE_READ, P.INVOICE_PAGE, P.INVOICE_EDIT, P.INVOICE_PAY, P.QUOTE_SIGN_OWN, P.QUOTE_SIGN_ALL,
  ] },
];

const EMPLOYEE = [
  P.QUOTE_CREATE, P.QUOTE_READ_OWN, P.QUOTE_UPDATE_OWN, P.QUOTE_DELETE_OWN,
  P.QUOTE_EXPORT,
  // CRM: danh bạ mã KH là DANH BẠ CHUNG — ai cũng đọc/chọn được; salesperson chỉ tạo/sửa/xóa của MÌNH.
  P.CUSTOMER_READ_OWN, P.CUSTOMER_READ_ALL, P.CUSTOMER_CREATE, P.CUSTOMER_EDIT_OWN, P.CUSTOMER_DELETE_OWN, P.CUSTOMER_NOTE_ADD,
  // Danh bạ nhân sự: xem cả danh bạ + thêm + sửa/xóa của mình.
  P.EMPLOYEE_READ_ALL, P.EMPLOYEE_CREATE, P.EMPLOYEE_EDIT_OWN, P.EMPLOYEE_DELETE_OWN,
  P.PRODUCT_READ,
];

const MANAGER = [
  ...EMPLOYEE,
  P.QUOTE_SEND,
  P.QUOTE_HN_MANAGE, // giao/duyệt phần Hà Nội (trước là check role admin||manager)
  P.AUDIT_VIEW,
  // Manager thấy + sửa/xóa MỌI khách hàng + giá vốn + quản sản phẩm (ẩn).
  P.CUSTOMER_READ_ALL, P.CUSTOMER_EDIT_ALL, P.CUSTOMER_DELETE_ALL, P.PRODUCT_READ_COST, P.PRODUCT_MANAGE,
  // Nhân sự: Account TẠO hồ sơ + chỉ thấy/sửa/xóa của MÌNH (owner-scoped).
  P.PERSONNEL_CREATE, P.PERSONNEL_READ_OWN, P.PERSONNEL_EDIT_OWN, P.PERSONNEL_DELETE_OWN,
];

const ADMIN = [
  ...MANAGER,
  // Director sees & edits & deletes ALL quotes.
  P.QUOTE_READ_ALL, P.QUOTE_UPDATE_ALL, P.QUOTE_DELETE_ALL,
  P.USER_MANAGE, P.ROLE_ASSIGN, P.TEMPLATE_MANAGE, P.COMPANY_MANAGE,
  P.SETTINGS_MANAGE,
  P.QUOTE_INTERNAL_APPROVE, // duyệt dòng bảng nội bộ (trước là check role===admin)
  P.QUOTE_INTERNAL_PAY,     // admin đánh dấu thanh toán hàng nội bộ (KHÔNG thêm internal:view — admin xem FULL)
  P.AUDIT_VIEW_FULL,        // xem chi tiết nhật ký (trước là check role===admin strip PII)
  P.INVOICE_READ, P.INVOICE_PAGE, P.INVOICE_EDIT, P.INVOICE_PAY, P.QUOTE_SIGN_ALL, // Quản lý dự án + trang Hóa đơn + sửa/thanh toán + ký mọi dự án
  // Nhân sự + Danh bạ: admin sửa/xóa MỌI + đánh dấu thanh toán + xác nhận đã ký + ghi kế toán ghi chú.
  P.PERSONNEL_READ_ALL, P.PERSONNEL_EDIT_ALL, P.PERSONNEL_DELETE_ALL, P.PERSONNEL_MARK_PAYMENT, P.PERSONNEL_CONFIRM, P.PERSONNEL_ACCOUNTING_NOTE,
  P.EMPLOYEE_READ_ALL, P.EMPLOYEE_EDIT_ALL, P.EMPLOYEE_DELETE_ALL,
];

// Nhân sự (hr) + Kế toán (accountant): CHỈ XEM mọi hồ sơ nhân sự (read-only). Không tạo/sửa/xóa,
// không thấy báo giá/khách/sản phẩm. (Kế toán cần xem lương/thuế/thanh toán; Nhân sự xem hồ sơ.)
const HR = [P.PERSONNEL_READ_ALL];
// Kế toán: xem mọi hồ sơ + ĐÁNH DẤU đã thanh toán (có ngày) + ghi cột "KẾ TOÁN GHI CHÚ". KHÔNG sửa hồ sơ khác.
// 2026-07-06: kế toán chuyển sang trang HÓA ĐƠN (invoice:page) — KHÔNG còn xem Quản lý dự án (invoice:read).
const ACCOUNTANT = [P.PERSONNEL_READ_ALL, P.PERSONNEL_MARK_PAYMENT, P.PERSONNEL_ACCOUNTING_NOTE, P.INVOICE_PAGE, P.INVOICE_EDIT, P.INVOICE_PAY];

// Account Hà Nội: quyền TỐI THIỂU. Chỉ với tay tới báo giá ĐƯỢC GIAO (là member) để
// đọc/sửa — nhưng presentQuote LƯỢC chỉ còn bảng nội bộ "hanoi" + route write-guard chỉ
// cho ghi đúng phần đó. KHÔNG tạo báo giá, KHÔNG thấy của người khác, KHÔNG export.
const ACCOUNT_HN = [
  P.QUOTE_READ_OWN,    // chỉ báo giá được giao (member); server lược chỉ còn phần HN
  P.QUOTE_UPDATE_OWN,  // chỉ ghi được bảng hanoi (write-guard ở route)
  P.QUOTE_HN_FILL,     // điền/gửi phần HN — đây là cờ kích hoạt LƯỢC view (presentQuote hnOnly)
];

export const ROLE_PERMISSIONS: Record<string, Set<string>> = {
  admin: new Set(ADMIN),
  manager: new Set(MANAGER),
  account_hn: new Set(ACCOUNT_HN),
  hr: new Set(HR),
  accountant: new Set(ACCOUNTANT),
  // 'employee' role bỏ từ 2026-06-15 (chỉ còn admin + manager + account_hn). EMPLOYEE vẫn
  // giữ làm danh sách quyền NỀN mà MANAGER kế thừa (`...EMPLOYEE`), không phải vai trò gán được.
};

export const ROLE_LABELS = {
  admin: "Quản trị",
  manager: "Account",
  account_hn: "Account Hà Nội",
  hr: "Nhân sự",
  accountant: "Kế toán",
};

// ── PHÂN QUYỀN ĐỘNG (override từ DB) ──────────────────────────────────────────
// Cache trong tiến trình: role → tập quyền GHI ĐÈ. Nạp lúc khởi động + sau mỗi lần admin sửa
// (src/roleOverrides.ts). KHÔNG có override cho 1 role → dùng mặc định ROLE_PERMISSIONS (hành vi cũ).
const roleOverrides = new Map<string, Set<string>>();

// Vai trò admin LUÔN dùng mặc định (full) — chống tự khóa, KHÔNG cho ghi đè.
function effectiveRoleSet(role: string | undefined): Set<string> | undefined {
  if (role === "admin") return ROLE_PERMISSIONS.admin;
  return roleOverrides.get(role as string) ?? ROLE_PERMISSIONS[role as string];
}

/** Nạp TOÀN BỘ override từ DB vào cache (thay sạch). Bỏ qua 'admin' + role không tồn tại. */
export function loadRoleOverrides(rows: { role: string; permissions: string[] }[]) {
  roleOverrides.clear();
  for (const r of rows) if (r.role !== "admin" && ROLE_PERMISSIONS[r.role]) roleOverrides.set(r.role, new Set(r.permissions));
}
/** Cập nhật cache 1 role sau khi lưu/đặt lại. permissions=null → xóa override (về mặc định). */
export function setRoleOverrideCache(role: string, permissions: string[] | null) {
  if (role === "admin") return;
  if (permissions === null) roleOverrides.delete(role);
  else roleOverrides.set(role, new Set(permissions));
}
/** Role này có đang dùng override (khác mặc định) không. */
export function hasRoleOverride(role: string) { return roleOverrides.has(role); }
/** Vai trò ĐƯỢC PHÉP sửa quyền (mọi role trừ admin). */
export const EDITABLE_ROLES = Object.keys(ROLE_PERMISSIONS).filter((r) => r !== "admin");

// Quyền cấp-QUẢN-TRỊ chỉ-admin: KHÔNG cấp động được cho vai trò khác (enforce bằng requireRole("admin")
// cứng — user/settings — hoặc CHƯA enforce ở đâu — role:assign/template/company). Tick cho non-admin sẽ
// VÔ TÁC DỤNG → ma trận KHÓA, PUT lọc bỏ. Admin vẫn có (luôn full). LƯU Ý: audit:view KHÔNG nằm đây
// (nó cấp động được — manager mặc định có, đã test). Nếu sau enforce 1 quyền ở đây bằng can() thì BỎ nó ra.
export const ADMIN_ONLY_PERMISSIONS = new Set<string>([
  PERMISSIONS.USER_MANAGE, PERMISSIONS.ROLE_ASSIGN, PERMISSIONS.SETTINGS_MANAGE,
  PERMISSIONS.TEMPLATE_MANAGE, PERMISSIONS.COMPANY_MANAGE,
]);

// Hình dạng tối thiểu của req.session mà các hàm phân quyền cần.
// `permissions` = TẬP QUYỀN HIỆU LỰC CỦA TÀI KHOẢN (resolve ở middleware mỗi request từ User.permissions,
// fallback quyền role khi user chưa tùy biến). Đây là NGUỒN phân quyền per-user — không còn suy từ role.
type SessionLike = { userId?: number; role?: string; permissions?: string[] };

/** Tập có chứa quyền này không? (`:all` ngầm bao `:own`.) */
function permHas(set: Set<string>, permission: string): boolean {
  if (set.has(permission)) return true;
  if (permission.endsWith(":own")) return set.has(permission.replace(/:own$/, ":all"));
  return false;
}

/** Tập quyền HIỆU LỰC của 1 phiên: ưu tiên session.permissions (per-user, do middleware resolve);
 *  fallback quyền role cho các đường chỉ set role (test/biên). admin LUÔN full (chống tự khóa). */
function sessionPermSet(session: SessionLike): Set<string> {
  if (Array.isArray(session?.permissions)) return new Set(session.permissions);
  if (session?.role === "admin") return ROLE_PERMISSIONS.admin;
  return effectiveRoleSet(session?.role) ?? new Set();
}

/** Resolve tập quyền của 1 TÀI KHOẢN để nạp vào session (gọi ở middleware mỗi request).
 *  admin → luôn full (chống tự khóa). Có quyền-riêng-user → dùng đúng tập đó. Chưa có → quyền role mặc định.
 *  canSign (cờ cũ "được Ký Chứng từ") → BẮC CẦU thành quyền quote:sign:own để hợp nhất vào ma trận. */
export function resolveUserPermissions(role: string | undefined, userPerms?: string[] | null, canSign = false): string[] {
  if (role === "admin") return [...ROLE_PERMISSIONS.admin];
  const set = new Set<string>(userPerms && userPerms.length ? userPerms : [...(effectiveRoleSet(role) ?? [])]);
  if (canSign) set.add(PERMISSIONS.QUOTE_SIGN_OWN);
  // Bắc cầu quyền GỘP cũ → quyền nguyên tử (tương thích user đã lưu quyền cũ trước khi tách).
  const Pm = PERMISSIONS;
  if (set.has(Pm.INVOICE_MANAGE)) { set.add(Pm.INVOICE_EDIT); set.add(Pm.INVOICE_PAY); }
  if (set.has(Pm.CUSTOMER_MANAGE_OWN)) { set.add(Pm.CUSTOMER_CREATE); set.add(Pm.CUSTOMER_EDIT_OWN); set.add(Pm.CUSTOMER_DELETE_OWN); set.add(Pm.CUSTOMER_NOTE_ADD); }
  if (set.has(Pm.CUSTOMER_MANAGE_ALL)) { set.add(Pm.CUSTOMER_CREATE); set.add(Pm.CUSTOMER_EDIT_ALL); set.add(Pm.CUSTOMER_DELETE_ALL); set.add(Pm.CUSTOMER_NOTE_ADD); }
  if (set.has(Pm.PERSONNEL_MANAGE_OWN)) { set.add(Pm.PERSONNEL_EDIT_OWN); set.add(Pm.PERSONNEL_DELETE_OWN); }
  if (set.has(Pm.PERSONNEL_MANAGE_ALL)) { set.add(Pm.PERSONNEL_EDIT_ALL); set.add(Pm.PERSONNEL_DELETE_ALL); }
  return [...set];
}

/** Does this role hold the given permission? (`:all` implies `:own`.) Giữ cho các đường chỉ có role. */
export function roleCan(role: string | undefined, permission: string) {
  const set = effectiveRoleSet(role);
  return set ? permHas(set, permission) : false;
}

/** can(session, permission) — đọc TẬP QUYỀN PER-USER của phiên (không còn cứng theo role). */
export function can(session: SessionLike, permission: string) {
  return permHas(sessionPermSet(session), permission);
}

/**
 * Resource-scoped check. For an action like "quote:update", returns true if the
 * role has ":all", OR has ":own" and owns the resource (createdById === userId).
 */
// Actions a non-admin gets on a quote merely by being a MEMBER (added to it).
// (Membership grants view + edit, but NOT delete.)
const QUOTE_MEMBER_ACTIONS = new Set(["read", "update"]);

export function canOnQuote(
  session: SessionLike,
  action: string,
  quote: { createdById?: number; members?: any[] } | null | undefined,
) {
  if (can(session, `quote:${action}:all`)) return true; // quyền xem/sửa MỌI báo giá
  if (can(session, `quote:${action}:own`)) {
    if (!quote) return false;
    if (quote.createdById === session.userId) return true;
    // Ai được thêm làm THÀNH VIÊN cũng với tới được (read/update).
    if (QUOTE_MEMBER_ACTIONS.has(action) && Array.isArray(quote.members)) {
      return quote.members.some((m: any) => (m.id ?? m) === session.userId);
    }
  }
  return false;
}

/**
 * Prisma `where` fragment limiting quotes to what the caller may SEE:
 *   admin             → all
 *   manager/employee  → quotes they created OR were added to as a member
 */
export function quoteScopeWhere(session: SessionLike) {
  if (can(session, "quote:read:all")) return {}; // xem mọi báo giá
  return { OR: [{ createdById: session.userId }, { members: { some: { id: session.userId } } }] };
}

/**
 * Generic resource-scoped check (e.g. customers). Returns true if the role has
 * `<resource>:<action>:all`, OR has `:own` and owns the row via `ownerField`.
 */
export function canScoped(session: SessionLike, resource: string, action: string, row: Record<string, any> | null | undefined, ownerField = "ownerId") {
  if (can(session, `${resource}:${action}:all`)) return true;
  if (can(session, `${resource}:${action}:own`)) {
    return row && row[ownerField] != null && row[ownerField] === session?.userId;
  }
  return false;
}

/** Express middleware factory: 403 unless the session holds the permission. */
export function requirePermission(permission: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.session?.userId) return res.status(401).json({ error: "Chưa đăng nhập" });
    if (!can(req.session, permission)) {
      return res.status(403).json({ error: "Không có quyền thực hiện thao tác này" });
    }
    next();
  };
}

/** 403 unless the session holds ÍT NHẤT MỘT trong các quyền (vd invoice:read HOẶC invoice:page). */
export function requireAnyPermission(...permissions: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.session?.userId) return res.status(401).json({ error: "Chưa đăng nhập" });
    if (!permissions.some((p) => can(req.session, p))) {
      return res.status(403).json({ error: "Không có quyền thực hiện thao tác này" });
    }
    next();
  };
}

/** Flat list of permissions a role holds (expanding :all → also :own) for the client matrix. */
export function permissionsForRole(role: string) {
  const set = effectiveRoleSet(role) || new Set();
  const out = new Set(set);
  for (const p of set) {
    if (p.endsWith(":all")) out.add(p.replace(/:all$/, ":own"));
  }
  return [...out];
}

/** Tập quyền HIỆU LỰC của 1 TÀI KHOẢN cho client (/me): per-user nếu có, else role; mở rộng :all→:own.
 *  admin luôn full. Đây là cái frontend dùng để ẩn/hiện (me.permissions). */
export function permissionsForUser(role: string | undefined, userPerms?: string[] | null, canSign = false) {
  const base = resolveUserPermissions(role, userPerms, canSign);
  const out = new Set(base);
  for (const p of base) if (p.endsWith(":all")) out.add(p.replace(/:all$/, ":own"));
  return [...out];
}
