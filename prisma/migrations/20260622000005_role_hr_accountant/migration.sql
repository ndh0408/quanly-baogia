-- Thêm 2 vai trò mới: hr (Nhân sự) + accountant (Kế toán).
-- PG hỗ trợ ADD VALUE; chỉ THÊM giá trị enum (không dùng ngay trong cùng migration) nên an toàn.
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'hr';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'accountant';
