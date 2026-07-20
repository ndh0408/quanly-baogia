-- "Tên dự án (HĐ)" trước đây chỉ hiện tham chiếu từ Dự án và không cho nhập.
-- Nay đổi thành "Tên hợp đồng" lưu riêng; giữ nguyên tên đang thấy cho các hồ sơ cũ
-- bằng cách lấy tên dự án đã lưu làm giá trị ban đầu, sau đó người dùng có thể sửa tùy ý.
UPDATE "PersonnelRecord"
SET "projectNameContract" = "projectName"
WHERE "projectNameContract" IS NULL
  AND "projectName" IS NOT NULL
  AND BTRIM("projectName") <> '';
