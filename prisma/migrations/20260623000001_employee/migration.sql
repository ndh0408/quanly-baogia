-- Danh bạ NHÂN VIÊN — kho thông tin cá nhân tái dùng (chọn khi tạo hồ sơ Nhân sự để tự điền).
CREATE TABLE "Employee" (
    "id" SERIAL NOT NULL,
    "createdById" INTEGER NOT NULL,
    "fullName" TEXT NOT NULL,
    "taxCode" TEXT,
    "birthYear" TEXT,
    "idCard" TEXT,
    "idIssueDate" TIMESTAMP(3),
    "idIssuePlace" TEXT,
    "address" TEXT,
    "bankAccount" TEXT,
    "bankName" TEXT,
    "phone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Employee_createdById_idx" ON "Employee"("createdById");
CREATE INDEX "Employee_deletedAt_idx" ON "Employee"("deletedAt");

ALTER TABLE "Employee" ADD CONSTRAINT "Employee_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
