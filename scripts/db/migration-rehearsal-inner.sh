#!/bin/sh
# Phần chạy BÊN TRONG container node cho scripts/db/migration-rehearsal.sh. Tách file để tránh lồng
# nhiều lớp trích dẫn shell — thứ đã làm hỏng hai lần thử trước và che mất kết quả thật.
set -u

apk add --no-cache openssl libc6-compat >/dev/null 2>&1
npm ci >/dev/null 2>&1
FAIL=0

echo "── BƯỚC 1: đưa CSDL về ĐÚNG trạng thái production (chỉ migration có ở master)"
mv prisma/migrations prisma/migrations.rc
cp -r /prodmig prisma/migrations
npx prisma migrate deploy 2>&1 | grep -Ei "applied|already|error" | tail -3

echo "── BƯỚC 2: nạp dữ liệu ở schema CŨ (giống production đang có dữ liệu)"
node --import tsx scripts/db/migration-rehearsal-seed.mjs || FAIL=1

echo "── BƯỚC 3: NÂNG CẤP lên schema bản phát hành"
rm -rf prisma/migrations
mv prisma/migrations.rc prisma/migrations
npx prisma migrate deploy 2>&1 | grep -Ei "applying|applied|error" | tail -8

echo "── BƯỚC 4: dữ liệu cũ còn nguyên? cột/bảng mới có mặt?"
npx prisma generate >/dev/null 2>&1
node --import tsx scripts/db/migration-rehearsal-check.mjs || FAIL=1

rm -rf node_modules
exit $FAIL
