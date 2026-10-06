-- HÓA ĐƠN VAT của khoản chi (chủ repo 2026-10-06: "nếu có VAT thì cho thêm ô bỏ VAT vào, nếu có VAT mà chỉ mới thanh
-- toán thôi thì bên nội bộ báo là đã thanh toán chưa VAT và cho kế toán update vào nhé").
--
-- THUẦN THÊM CỘT, không đụng dữ liệu nào đang có:
--   · "InputInvoiceProof"."loai" — 'chi' (ảnh ủy nhiệm chi) | 'vat' (hóa đơn VAT: ảnh hoặc PDF). DEFAULT hằng 'chi' nên
--     mọi dòng có sẵn đúng nghĩa cũ, và từ Postgres 11 thêm cột có DEFAULT hằng chỉ ghi siêu dữ liệu (không viết lại bảng).
--   · "InputInvoiceEntry"."currentVatProofId" — HĐ VAT HIỆN TẠI, NULL được; KHÔNG FK như "currentProofId" (tránh vòng FK
--     hai chiều Entry ↔ Proof; dịch vụ giữ toàn vẹn).
-- HĐ VAT dùng chung luật CHỈ THÊM của ảnh chứng từ: thay / gỡ chỉ đặt "retiredAt", không DELETE.
--
-- Mã CŨ chạy tiếp trên schema mới: nó không biết hai cột; ảnh nó thêm nhận DEFAULT 'chi' (đúng). Lùi ảnh sau khi đã có
-- HĐ VAT: app cũ liệt kê HĐ VAT vào "Ảnh trước" của hộp Khoản chi (chỉ xem, có nhật ký) — không mất gì.
--
-- ROLLBACK (chỉ khi chưa có HĐ VAT nào): ALTER TABLE "InputInvoiceEntry" DROP COLUMN "currentVatProofId";
--   ALTER TABLE "InputInvoiceProof" DROP COLUMN "loai";  — đã có dữ liệu thì KHÔNG lùi schema, chỉ lùi ảnh.

SET lock_timeout = '10s';

-- AlterTable
ALTER TABLE "InputInvoiceEntry" ADD COLUMN "currentVatProofId" INTEGER;

-- AlterTable
ALTER TABLE "InputInvoiceProof" ADD COLUMN "loai" TEXT NOT NULL DEFAULT 'chi';
