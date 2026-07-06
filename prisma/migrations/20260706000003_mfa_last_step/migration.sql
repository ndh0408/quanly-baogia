-- Chống replay mã TOTP trong cửa sổ ±30s: lưu step (mốc 30 giây) của mã đã dùng gần nhất.
-- Login chỉ chấp nhận mã có step MỚI HƠN → một mã 6 số không thể trình lại lần 2 khi vẫn còn hạn.
ALTER TABLE "User" ADD COLUMN "mfaLastStep" INTEGER;
