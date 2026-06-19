-- Chặn race của "Bản mới cùng mã dự án": trước đây chỉ quoteNumber là unique, còn
-- (projectCode, projectVersion) thì không — nên hai request song song có thể cùng tạo _v2.
-- Thêm unique để DB từ chối bản trùng (code retry sẽ tính sang version kế tiếp).
-- projectCode NULL → Postgres coi mỗi NULL là khác nhau → quote không có mã KHÔNG bị ảnh hưởng.
CREATE UNIQUE INDEX "Quote_projectCode_projectVersion_key" ON "Quote"("projectCode", "projectVersion");
