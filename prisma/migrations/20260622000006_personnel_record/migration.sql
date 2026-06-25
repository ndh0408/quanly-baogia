-- Bảng hồ sơ NHÂN SỰ / chi phí nhân công (trang "Nhân sự"). Account tạo + sở hữu (createdById).
CREATE TABLE "PersonnelRecord" (
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
    "salary" DECIMAL(18,2),
    "pit" DECIMAL(18,2),
    "taxableIncome" DECIMAL(18,2),
    "workStart" TIMESTAMP(3),
    "workEnd" TIMESTAMP(3),
    "workLocation" TEXT,
    "projectName" TEXT,
    "projectCode" TEXT,
    "teamNote" TEXT,
    "accountName" TEXT,
    "company" TEXT,
    "projectNameContract" TEXT,
    "laborContractNo" TEXT,
    "laborContractDate" TIMESTAMP(3),
    "salesContractNo" TEXT,
    "salesContractDate" TIMESTAMP(3),
    "purchaseOrder" TEXT,
    "preTaxAmount" DECIMAL(18,2),
    "accountingNote" TEXT,
    "payment" TEXT,
    "confirmed" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "PersonnelRecord_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PersonnelRecord_createdById_idx" ON "PersonnelRecord"("createdById");
CREATE INDEX "PersonnelRecord_deletedAt_idx" ON "PersonnelRecord"("deletedAt");

ALTER TABLE "PersonnelRecord" ADD CONSTRAINT "PersonnelRecord_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
