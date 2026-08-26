#!/usr/bin/env bash
# Diễn tập nâng cấp CSDL: schema PRODUCTION HIỆN TẠI → schema của bản phát hành.
#
# Vì sao cần: `prisma migrate deploy` trên CSDL RỖNG chỉ chứng minh "các migration chạy được cạnh
# nhau". Nó KHÔNG chứng minh điều thật sự quan trọng — rằng chúng chạy được trên CSDL đã có dữ liệu ở
# schema cũ, và dữ liệu cũ vẫn đọc được sau đó. Đó mới là thứ sẽ xảy ra lúc deploy production.
#
# Kịch bản: dựng DB ở đúng trạng thái production (chỉ các migration có ở master) → nạp dữ liệu →
# nâng cấp bằng toàn bộ migration của bản phát hành → kiểm dữ liệu cũ còn nguyên + cột/bảng mới có mặt.
#
# Chạy TRÊN VM DEV, dùng CSDL riêng `quanly_migtest`. KHÔNG đụng DEV chính, KHÔNG đụng production.
set -uo pipefail

DB=quanly_migtest
PGUSER=$(docker exec quanly-postgres printenv POSTGRES_USER)
PGPASS=$(docker exec quanly-postgres printenv POSTGRES_PASSWORD)
NET=$(docker inspect quanly-postgres -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}')
DIR=/opt/stacks/quanly/quanly

psqlq() { docker exec quanly-postgres psql -U "$PGUSER" -d "$1" -tAc "$2"; }

echo "▶ Dựng CSDL diễn tập sạch ($DB)"
docker exec quanly-postgres psql -U "$PGUSER" -d quanly -c "DROP DATABASE IF EXISTS $DB;" >/dev/null 2>&1
docker exec quanly-postgres psql -U "$PGUSER" -d quanly -c "CREATE DATABASE $DB;" >/dev/null

EF=$(mktemp); chmod 600 "$EF"
printf 'DATABASE_URL=postgresql://%s:%s@quanly-postgres:5432/%s?schema=public\nNODE_ENV=development\n' "$PGUSER" "$PGPASS" "$DB" > "$EF"

mkdir -p /tmp/mig && rm -rf /tmp/mig/* && tar xzf /tmp/prodmig.tgz -C /tmp/mig

docker run --rm --network "$NET" -v "$DIR":/app -v /tmp/mig/migrations:/prodmig:ro -w /app --env-file "$EF" node:22-alpine sh /app/scripts/db/migration-rehearsal-inner.sh
RC=$?
rm -f "$EF"
exit $RC
