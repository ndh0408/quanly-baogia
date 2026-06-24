-- ADMIN xác nhận "đã ký" cho từng hồ sơ Nhân sự (lưu NGÀY + người xác nhận).
ALTER TABLE "PersonnelRecord" ADD COLUMN "confirmedAt" TIMESTAMP(3);
ALTER TABLE "PersonnelRecord" ADD COLUMN "confirmedById" INTEGER;

CREATE INDEX "PersonnelRecord_confirmedById_idx" ON "PersonnelRecord"("confirmedById");

ALTER TABLE "PersonnelRecord" ADD CONSTRAINT "PersonnelRecord_confirmedById_fkey"
    FOREIGN KEY ("confirmedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
