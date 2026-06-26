-- Phân quyền PER-USER: tập quyền riêng từng tài khoản (key trong PERMISSIONS).
-- TRỐNG = chưa tùy biến → dùng quyền mặc định theo role (tương thích ngược, không vỡ gì khi deploy).
ALTER TABLE "User" ADD COLUMN "permissions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
