#!/bin/sh
# Phần chạy BÊN TRONG container node cho scripts/db/migration-rehearsal.sh. Tách file để tránh lồng
# nhiều lớp trích dẫn shell — thứ đã làm hỏng hai lần thử trước và che mất kết quả thật.
# `-u` (biến chưa đặt là lỗi) + `pipefail`. KHÔNG dùng `-e`: script CỐ Ý tích luỹ `FAIL` để chạy
# hết bốn bước rồi mới kết luận — `-e` sẽ thoát ở bước hỏng đầu tiên và mất phần chẩn đoán.
# `pipefail` là thứ THẬT SỰ cần ở đây: hai lệnh `prisma migrate deploy` bên dưới đều pipe vào
# `grep | tail`, mà không có pipefail thì mã thoát lấy từ `tail` — LUÔN LUÔN 0. Migration hỏng bị
# nuốt sạch, và diễn tập báo ĐẠT.
# (busybox ash trong node:alpine có hỗ trợ `set -o pipefail`.)
set -u
set -o pipefail

apk add --no-cache openssl libc6-compat >/dev/null 2>&1
npm ci >/dev/null 2>&1
FAIL=0

echo "── BƯỚC 1: đưa CSDL về ĐÚNG trạng thái production (chỉ migration có ở master)"
mv prisma/migrations prisma/migrations.rc
cp -r /prodmig prisma/migrations
npx prisma migrate deploy 2>&1 | grep -Ei "applied|already|error" | tail -3 || {
  echo "✖ BƯỚC 1 hỏng: không đưa được CSDL về trạng thái production. Dừng — ba bước sau vô nghĩa."
  exit 1
}

echo "── BƯỚC 2: nạp dữ liệu ở schema CŨ (giống production đang có dữ liệu)"
node --import tsx scripts/db/migration-rehearsal-seed.mjs || FAIL=1

echo "── BƯỚC 3: NÂNG CẤP lên schema bản phát hành"
rm -rf prisma/migrations
mv prisma/migrations.rc prisma/migrations
# ĐÂY LÀ BƯỚC ĐANG ĐƯỢC DIỄN TẬP. Hỏng ở đây nghĩa là bản phát hành sẽ hỏng trên production —
# tuyệt đối không được đi tiếp rồi báo ĐẠT.
npx prisma migrate deploy 2>&1 | grep -Ei "applying|applied|error" | tail -8 || {
  echo "✖ BƯỚC 3 hỏng: NÂNG CẤP schema thất bại — đây chính là thứ diễn tập sinh ra để bắt."
  rm -rf node_modules
  exit 1
}

echo "── BƯỚC 4: dữ liệu cũ còn nguyên? cột/bảng mới có mặt?"
npx prisma generate >/dev/null 2>&1
node --import tsx scripts/db/migration-rehearsal-check.mjs || FAIL=1

rm -rf node_modules
exit $FAIL
