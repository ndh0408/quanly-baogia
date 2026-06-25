-- Kế toán đánh dấu ĐÃ THANH TOÁN cho từng hồ sơ Nhân sự (lưu NGÀY + người đánh dấu).
ALTER TABLE "PersonnelRecord" ADD COLUMN "paidAt" TIMESTAMP(3);
ALTER TABLE "PersonnelRecord" ADD COLUMN "paidById" INTEGER;

CREATE INDEX "PersonnelRecord_paidById_idx" ON "PersonnelRecord"("paidById");

ALTER TABLE "PersonnelRecord" ADD CONSTRAINT "PersonnelRecord_paidById_fkey"
    FOREIGN KEY ("paidById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
