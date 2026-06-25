-- Phân quyền ĐỘNG: bảng quyền ghi-đè theo vai trò. Có row → dùng tập quyền này thay mặc định hard-code.
-- KHÔNG có row (mặc định sau migration) → hành vi Y HỆT cũ. 'admin' không ghi đè (luôn full).
CREATE TABLE "RolePermission" (
    "role" TEXT NOT NULL,
    "permissions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" INTEGER,
    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("role")
);
