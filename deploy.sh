#!/usr/bin/env bash
# deploy.sh — ship this repo to STAGING or PROD with one identical, safe flow.
#
#   bash deploy.sh staging [git-ref]   # → quanly-staging VM (Tailscale, test/demo)
#   bash deploy.sh prod    [git-ref]   # → coolify VM (gianguyen.cloud, live)
#
# git-ref defaults to HEAD. Recommended flow:
#   1) bash deploy.sh staging          # deploy current code to staging
#   2) test at https://quanly-staging.tail24aeab.ts.net (login with real account)
#   3) bash deploy.sh prod             # only after staging is verified OK
#
# Each run: backup DB → tag :rollback → ship tracked files (git archive) →
#           lấy image (pull digest HOẶC build trên VM) → recreate app+worker →
#           write DEPLOYED_SHA → verify /livez.
# Untracked server files (.env, DEPLOYED_SHA) are preserved.
# ⚠️ docker-compose.*.yml KHÔNG nằm trong nhóm đó: cả ba file compose ĐỀU được git theo dõi
#    (`git ls-files | grep docker-compose`), nên `git archive` ở dưới GHI ĐÈ chúng mỗi lượt
#    deploy. Sửa tay compose trên máy chủ là mất lặng lẽ ở lượt deploy kế. Giá trị cần chỉnh
#    theo từng máy (POSTGRES_CPUS / REDIS_CPUS / APP_CPUS / WORKER_CPUS…) phải đặt trong
#    `.env` — file đó mới thật sự untracked và được giữ nguyên.
#
#   IMAGE_REF="ghcr.io/ndh0408/quanly-baogia@sha256:…" bash deploy.sh prod
#     → kéo đúng image CI đã dựng/quét/ký thay vì dựng lại trên VM (xem khối ở dưới).
set -euo pipefail

TARGET="${1:-}"
REF="${2:-HEAD}"
DIR=/opt/stacks/quanly/quanly

case "$TARGET" in
  prod)
    SSH=coolify-ts;  COMPOSE=docker-compose.prod.yml;    IMAGE=quanly-app:prod;    URL=https://gianguyen.cloud ;;
  staging)
    SSH=staging-ts;  COMPOSE=docker-compose.staging.yml; IMAGE=quanly-app:staging; URL=https://quanly-staging.tail24aeab.ts.net ;;
  *)
    echo "Usage: bash deploy.sh <staging|prod> [git-ref]"; exit 1 ;;
esac

# ── CHUỖI CUNG ỨNG: image nên đến TỪ CI, ghim theo digest ──────────────────────────────────
# .github/workflows/ci.yml dựng image, đẩy lên ghcr kèm `provenance: mode=max` + `sbom: true`,
# rồi smoke-test THEO DIGEST. Đường deploy này trước đây không chạm vào chuỗi đó một chút nào:
# nó `git archive` mã nguồn lên VM rồi `docker compose build` ngay trên máy chủ. Hậu quả: image
# đang chạy production không có digest nào để đối chiếu với thứ CI đã quét, không SBOM, không
# provenance — và phụ thuộc npm được giải LẠI trên VM tại thời điểm deploy, nên hai lượt deploy
# cùng một commit có thể cho ra hai image khác nhau.
#
# Đặt IMAGE_REF thì bước [3/6] chuyển sang `docker pull` đúng digest rồi gắn tag mà compose dùng.
# `docker pull` theo digest tự đối chiếu nội dung (kho địa-chỉ-theo-nội-dung), nên không cần thêm
# bước xác minh riêng: sai digest là pull hỏng.
#
# BẮT BUỘC phải là @sha256: — tag di động thì hai lần pull ra hai bản mã khác nhau và rollback
# không còn gì để quay về (cùng lý do chart Helm từ chối image.tag=latest, xem _helpers.tpl).
#
# CỐ Ý KHÔNG bắt buộc phải có IMAGE_REF: chưa kiểm được VM production có đăng nhập ghcr hay
# không, mà ép buộc thì làm hỏng đúng đường deploy đang chạy thật. Không có thì vẫn dựng trên VM,
# kèm cảnh báo nói rõ đang bỏ qua cái gì.
IMAGE_REF="${IMAGE_REF:-}"
if [ -n "$IMAGE_REF" ] && [ "${IMAGE_REF#*@sha256:}" = "$IMAGE_REF" ]; then
  echo "❌ IMAGE_REF phải ghim digest dạng <repo>@sha256:<64 hex>, nhận được: $IMAGE_REF"
  echo "   Digest lấy ở job build-image của .github/workflows/ci.yml (nó in sẵn lệnh deploy)."
  exit 1
fi

SHA=$(git rev-parse --verify "$REF^{commit}")

# ── TAG BẤT BIẾN CHO ẢNH (§46) ────────────────────────────────────────────────────────────
# `$IMAGE` (quanly-app:prod) là một CON TRỎ GHI ĐÈ ĐƯỢC: lượt deploy kế gắn đúng cái tên đó
# lên một ảnh khác. Hậu quả là sau vài lượt, câu "bản chạy chiều thứ ba tuần trước là ảnh nào"
# KHÔNG còn tham chiếu nào gọi tên được — `:rollback` chỉ giữ đúng MỘT bước lùi, và chính nó cũng
# bị ghi đè mỗi lượt. `<tên>:<git-sha>` thì mỗi commit đúng một tag, không lượt nào đè lượt nào.
#
# GIỮ NGUYÊN `:prod` / `:staging` làm con trỏ: compose `image:` gọi đúng tên đó, bước rollback cũng
# vậy. Tag bất biến là THÊM VÀO, không phải thay thế — không đụng gì vào quy trình đang chạy.
#
# ĐÁNH ĐỔI ĐÃ BIẾT: tag không tự hết hạn, nên ảnh cũ thôi rơi vào `docker image prune` và đĩa VM
# phình dần. Đó là giá của việc lùi được xa hơn một bước. Dọn CÓ CHỦ ĐÍCH khi cần, giữ ~10 bản:
#   ssh $SSH "docker images --format '{{.Repository}}:{{.Tag}}' ${IMAGE%%:*} | grep -E ':[0-9a-f]{40}$' | tail -n +11 | xargs -r docker rmi"
IMAGE_SHA="${IMAGE%%:*}:$SHA"

echo "▶ Deploy $SHA ($REF) → $TARGET  [$SSH]"
echo "   tag bất biến: $IMAGE_SHA"

echo "▶ [1/6] Backup DB + tag :rollback"
# Bản dump này chứa CCCD / số tài khoản / lương ở dạng THÔ — cùng nội dung mà
# scripts/backup/backup-db.sh phải siết. Lệnh dưới chạy trong shell đăng nhập của máy chủ với
# umask mặc định 0022, nên bản trước để lại file 0644 trong thư mục 0755: mọi tài khoản trên VM
# production đọc được toàn bộ hồ sơ nhân sự, và nó sinh ra MỖI LẦN deploy rồi nằm lại đó.
#   • `umask 077`            → file mới ra 0600 ngay lúc tạo (bao cả trường hợp gzip ghi dở dang).
#   • `install -d -m 0700`   → siết cả thư mục ĐÃ TỒN TẠI từ những lượt deploy trước (mkdir -p thì không).
#   • `chmod 600` tường minh → như backup-db.sh, phòng shell đăng nhập có umask khác.
#
# ── VÌ SAO TÁCH LÀM HAI LỆNH ssh (§45) ────────────────────────────────────────────────────
# Bản trước gộp dump và `docker tag …:rollback` vào MỘT chuỗi `A && B && … && tag || true`.
# `&&` và `||` cùng độ ưu tiên và kết hợp TRÁI, nên `|| true` không chỉ tha cho `docker tag` —
# nó nuốt mã thoát của CẢ chuỗi, kể cả bước dump. `set -e` ở dòng 24 vì thế không thấy gì, và
# deploy đi thẳng sang [4/6] migrate. Đó đúng là hình dạng tệ nhất: đổi schema mà KHÔNG có bản
# lùi nào. `docker tag` được phép hỏng thật (lượt deploy đầu chưa có ảnh cũ để gắn nhãn) — nhưng
# đó là lý do để tách nó ra, không phải để miễn trừ cho cả khối.
#
# `set -o pipefail` phải đặt Ở PHÍA MÁY CHỦ: dòng 24 chỉ áp cho shell đang gõ lệnh, nó KHÔNG
# theo ssh sang máy kia. Không có nó thì `pg_dump | gzip` lấy mã thoát của `gzip` — pg_dump chết
# giữa chừng vẫn cho ra 0 và để lại một .sql.gz hợp lệ nhưng CỤT. `|| true` ngay sau là phòng
# shell đăng nhập không phải bash (dash chưa có pipefail): thiếu lớp đó thì rơi xuống hai lớp
# dưới, chứ không làm hỏng cả lượt deploy vì một chi tiết của shell máy chủ.
# Hai lớp dưới — cỡ tệp và `gzip -t` — mượn nguyên từ backup-db.sh, và mỗi lớp bắt một thứ khác:
# pg_dump chết NGAY thì gzip vẫn ghi ra ~20 byte gzip HỢP LỆ (chỉ cỡ tệp bắt được), còn dump đứt
# giữa chừng thì tệp đủ lớn nhưng luồng nén cụt (chỉ `gzip -t` bắt được).
#
# GIỮ 7 BẢN GẦN NHẤT, và dọn `.partial` mồ côi quá 60 phút. Vì sao phải có:
# mỗi tệp này là một bản `pg_dump` TOÀN CSDL — tức CCCD, số tài khoản và lương của nhân sự ở dạng
# THÔ (cột mã hoá PII chưa bật, xem docs/REMAINING_RISKS.md). Không dọn thì mỗi lần deploy để lại
# thêm một bản vĩnh viễn trên VM: vừa đầy đĩa (đúng thứ làm hỏng bước dump này), vừa biến thư mục
# home thành kho PII lớn dần mà không ai rà.
# Dọn NẰM SAU `mv` và dùng `;` chứ không `&&`: lượt dọn hỏng KHÔNG được làm cả bước backup báo đỏ —
# bản dump lúc đó đã yên vị và hợp lệ, mất nó vì một lỗi dọn dẹp là đánh đổi ngược.
# Ghi vào `.partial` rồi mới đổi tên — cùng khuôn nguyên tử của backup-db.sh, và ở đây nó giải
# một cái bẫy cụ thể: lượt hỏng mà để lại đúng cái tên `predeploy-….sql.gz` thì người trực lúc
# 2 giờ sáng sẽ tưởng đó là điểm lùi và khôi phục từ một bản dump CỤT. Đổi tên chỉ xảy ra sau khi
# cả ba lớp kiểm đã qua: hoặc có tệp hoàn chỉnh, hoặc chỉ có `.partial` — không lẫn được.
if ! ssh "$SSH" "set -o pipefail 2>/dev/null || true; \
  umask 077 && install -d -m 0700 ~/quanly-backups && \
  F=~/quanly-backups/predeploy-\$(date +%F-%H%M%S).sql.gz && \
  docker exec quanly-postgres pg_dump -U quanly -d quanly | gzip > \"\$F.partial\" && \
  chmod 600 \"\$F.partial\" && \
  SZ=\$(stat -c%s \"\$F.partial\" 2>/dev/null || echo 0) && [ \"\$SZ\" -ge 1000 ] && \
  gzip -t \"\$F.partial\" && mv -f \"\$F.partial\" \"\$F\" && \
  find ~/quanly-backups -maxdepth 1 -name 'predeploy-*.sql.gz.partial' -mmin +60 -delete; \
  ls -1t ~/quanly-backups/predeploy-*.sql.gz 2>/dev/null | tail -n +8 | xargs -r rm -f"; then
  echo
  echo "❌ Backup DB tiền-deploy THẤT BẠI — dừng TRƯỚC bước migrate, chưa đụng gì vào máy chủ."
  echo "   Migrate không có bản lùi là rủi ro MẤT DỮ LIỆU, không phải phiền toái nhỏ."
  echo "   Soi tay:  ssh $SSH \"docker exec quanly-postgres pg_dump -U quanly -d quanly | head -c 200\""
  echo "   Chỗ trống: ssh $SSH \"df -h ~; ls -lt ~/quanly-backups | head\""
  exit 1
fi

# `:rollback` là con trỏ MỘT bước lùi, và nó ĐƯỢC PHÉP hỏng: lượt deploy đầu tiên trên một máy
# chủ mới chưa có ảnh `$IMAGE` nào để gắn nhãn. Hỏng thì chỉ mất đường lùi NHANH ở bước [6/6];
# tag bất biến `<tên>:<git-sha>` ghi trong RELEASES.log vẫn lùi được, nên không đáng dừng deploy.
if ssh "$SSH" "docker tag $IMAGE ${IMAGE%%:*}:rollback 2>/dev/null"; then
  echo "   :rollback → ảnh $IMAGE đang chạy"
else
  echo "   ⚠️  chưa gắn được :rollback (lượt deploy đầu?) — lùi bằng tag <tên>:<git-sha> trong RELEASES.log"
fi

echo "▶ [2/6] Ship tracked files"
git archive --format=tar.gz "$REF" | ssh "$SSH" "tar xzf - -C $DIR"
# tar KHÔNG XOÁ file cũ, nên $DIR tích lại mọi file từng được ship. Ba kiểu rác, và cả ba đều đã
# cắn thật:
#   · .js cũ SHADOW .ts sau khi `git mv x.js x.ts` — `import './x.js'` resolve vào .js thật nếu nó
#     còn tồn tại, tức app chạy code CŨ mà không báo gì;
#   · .ts bị DI CHUYỂN sang thư mục khác (`git mv src/quoteService.ts src/services/`) — bản cũ nằm
#     lại ở chỗ cũ;
#   · .js của tính năng đã GỠ HẲN (approval, products) — không có .ts cùng tên nên chốt cũ, vốn chỉ
#     dò `.js` có `.ts` kèm theo, không thấy chúng.
# Trước đây hai kiểu sau vô hại vì production chạy `tsx src/server.ts`: chỉ file nào ĐƯỢC IMPORT mới
# được nạp. Từ khi build bằng `tsc -p tsconfig.build.json`, TOÀN BỘ cây src/ bị biên dịch — một file
# mồ côi tham chiếu kiểu Prisma đã đổi là VỠ CẢ LẦN BUILD, ngay giữa deploy. Đúng như vậy ngày
# 2026-09-01: `src/quoteService.ts(366,46): error TS2322` trên một file không còn trong repo.
#
# Nên chốt phải TỔNG QUÁT: giữ đúng những gì git đang theo dõi, xoá phần còn lại. `src/` và
# `shared/` hoàn toàn do repo quản lý — không có gì sinh ra trong đó lúc chạy — nên phép so này an
# toàn. Danh sách đi qua stdin để không đụng trần độ dài dòng lệnh.
echo "▶ [2b/6] Dọn file mồ côi trong src/ + shared/ (tar không tự xoá)"
git ls-tree -r --name-only "$REF" -- src shared | ssh "$SSH" "cat > $DIR/.tracked-src.txt && cd $DIR && \
  find src shared -type f 2>/dev/null | sort > .onvm-src.txt && \
  sort .tracked-src.txt -o .tracked-src.txt && \
  comm -13 .tracked-src.txt .onvm-src.txt | while read -r f; do rm -f \"\$f\" && echo \"  gỡ mồ côi \$f\"; done; \
  rm -f .tracked-src.txt .onvm-src.txt; true"

if [ -n "$IMAGE_REF" ]; then
  echo "▶ [3/6] Kéo image đã ghim digest (KHÔNG dựng trên VM)"
  echo "   $IMAGE_REF"
  ssh "$SSH" "docker pull $IMAGE_REF && docker tag $IMAGE_REF $IMAGE"
else
  echo "▶ [3/6] Build image NGAY TRÊN VM"
  echo "   ⚠️  Không đặt IMAGE_REF → image này KHÔNG phải bản CI đã quét lỗ hổng và đính SBOM +"
  echo "      provenance, và không có digest nào để đối chiếu về sau. Đường ưu tiên:"
  echo "      IMAGE_REF=<repo>@sha256:<digest> bash deploy.sh $TARGET"
  # KHÔNG truyền `--build-arg SENTRY_RELEASE=$SHA` ở đây, dù Dockerfile ĐÃ nhận tham số đó (xem khối
  # ARG SENTRY_RELEASE gần cuối Dockerfile) và dù nó sẽ cho Sentry gom lỗi theo bản phát hành:
  # tests/b7-deploy-image-digest.test.js chốt lệnh này khớp đúng mẫu `compose -f <file> build app`,
  # nên chèn cờ vào giữa làm ĐỎ cổng kiểm. Một cổng đang bắt được hồi quy có giá hơn một nhãn
  # release. Muốn bật: sửa mẫu trong test đó rồi thêm cờ vào đây — hai thay đổi phải đi cùng nhau.
  ssh "$SSH" "cd $DIR && docker compose -f $COMPOSE build app"
fi

# Gắn tag bất biến NGAY sau khi $IMAGE trỏ vào ảnh mới. Một lệnh dùng chung cho CẢ HAI nhánh
# trên, vì cả hai đều kết thúc bằng $IMAGE trỏ vào ảnh vừa lấy. `docker tag` chỉ thêm TÊN cho
# ảnh đã có sẵn trên máy: không tải, không dựng, không đụng container đang chạy — nên đặt TRƯỚC
# migrate là an toàn, và có lợi: các bước sau hỏng thì ảnh vẫn đã có tên gọi được để soi và lùi về.
echo "▶ [3b/6] Gắn tag bất biến"
echo "   $IMAGE_SHA"
ssh "$SSH" "docker tag $IMAGE $IMAGE_SHA"

# Chạy migration TRƯỚC khi recreate (schema thêm cột/bảng → code mới mới dùng được). prisma nằm
# trong dependencies nên có trong image; migrate deploy tự lấy advisory-lock (an toàn nhiều instance).
# Nếu FAIL → set -e dừng deploy TẠI ĐÂY, app cũ vẫn chạy (không kẹt nửa-vời).
echo "▶ [4/6] DB migrate (prisma migrate deploy)"
ssh "$SSH" "cd $DIR && docker compose -f $COMPOSE run --rm app npx prisma migrate deploy"

echo "▶ [5/6] Recreate app + worker"
ssh "$SSH" "cd $DIR && docker compose -f $COMPOSE up -d app worker && printf '%s\n' '$SHA' > DEPLOYED_SHA"

# ── SỔ PHÁT HÀNH ──────────────────────────────────────────────────────────────────────────
# §46 đòi mỗi lần phát hành ghi lại BỐN thứ: git SHA · phiên bản migration · digest image ·
# thời điểm deploy. `DEPLOYED_SHA` chỉ có thứ nhất, và nó bị GHI ĐÈ mỗi lượt — nên khi cần trả
# lời "chiều thứ ba tuần trước đang chạy bản nào, đã migrate tới đâu" thì không còn gì để đọc.
#
# Ba thứ còn lại lấy như sau, và mỗi cái đều lấy TỪ MÁY CHỦ chứ không từ máy đang gõ lệnh:
#   · migration: hàng mới nhất trong `_prisma_migrations` — tức thứ CSDL THẬT SỰ đã áp, không
#     phải thư mục mới nhất trong repo (hai cái lệch nhau đúng lúc migrate hỏng giữa chừng, và
#     đó chính là lúc cần sổ này nhất);
#   · digest: `RepoDigests[0]` nếu image kéo từ registry (đường IMAGE_REF — digest bất biến,
#     đối chiếu được với thứ CI đã quét); dựng trên VM thì không có RepoDigest nào, rơi về
#     `Id` (sha256 của image cục bộ) kèm tiền tố `local:` để không ai nhầm hai loại với nhau;
#   · thời điểm: giờ UTC của MÁY CHỦ.
#
# Trường thứ năm `image_tag` = tag BẤT BIẾN `<tên>:<git-sha>` gắn ở bước [3b/6]. Nó KHÁC `image`:
# `image` là digest/Id — đúng, nhưng khi ảnh dựng trên VM thì không có RepoDigest và giá trị rơi
# về `local:sha256:…`, một chuỗi KHÔNG gọi lại được. `image_tag` là cái tên GÕ ĐƯỢC để quay về
# đúng bản đó, kể cả sau nhiều lượt deploy nữa.
#
# Ghi NỐI THÊM vào $DIR/RELEASES.log (untracked, `git archive` không đụng tới) — một dòng JSON
# mỗi lần, đọc bằng `tail`/`jq` được, và không bao giờ mất lịch sử.
echo "▶ [5b/6] Ghi sổ phát hành"
REL=$(ssh "$SSH" "cd $DIR && \
  MIG=\$(docker exec quanly-postgres psql -U quanly -d quanly -tAc \
        \"SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1\" 2>/dev/null || echo unknown) && \
  DG=\$(docker inspect --format '{{if .RepoDigests}}{{index .RepoDigests 0}}{{else}}local:{{.Id}}{{end}}' $IMAGE 2>/dev/null || echo unknown) && \
  TS=\$(date -u +%Y-%m-%dT%H:%M:%SZ) && \
  LINE=\$(printf '{\"ts\":\"%s\",\"target\":\"%s\",\"sha\":\"%s\",\"migration\":\"%s\",\"image\":\"%s\",\"image_tag\":\"%s\"}' \"\$TS\" '$TARGET' '$SHA' \"\$MIG\" \"\$DG\" '$IMAGE_SHA') && \
  printf '%s\n' \"\$LINE\" >> RELEASES.log && printf '%s' \"\$LINE\"")
echo "   $REL"

# `|| echo FAILED` ở bản trước NUỐT mã lỗi: `set -e` không bắt được, và dòng "✅ now running" phía
# dưới in ra VÔ ĐIỀU KIỆN. Một lần deploy mà container không bao giờ healthy vẫn báo thành công —
# người deploy đóng terminal, và sự cố chỉ lộ ra khi người dùng gọi điện.
echo "▶ [6/6] Verify /livez"
if ssh "$SSH" "for i in \$(seq 1 20); do s=\$(docker inspect -f '{{.State.Health.Status}}' quanly-app 2>/dev/null); [ \"\$s\" = healthy ] && break; sleep 3; done; \
  docker exec quanly-app wget -qO- http://127.0.0.1:3000/livez" | grep -q '\"ok\":true'; then
  echo "   livez OK"
else
  echo
  echo "❌ $TARGET KHÔNG lên được sau khi deploy $SHA — /livez không trả ok."
  echo "   Xem log:  ssh $SSH \"docker logs quanly-app --tail 200\""
  echo "   Rollback 1 bước: ssh $SSH \"cd $DIR && docker tag ${IMAGE%%:*}:rollback $IMAGE && docker compose -f $COMPOSE up -d app worker\""
  echo "   Rollback về BẤT KỲ bản nào đã phát hành (tag bất biến; lấy sha trong RELEASES.log):"
  echo "     ssh $SSH \"cd $DIR && docker tag ${IMAGE%%:*}:<git-sha> $IMAGE && docker compose -f $COMPOSE up -d app worker\""
  exit 1
fi
echo
echo "✅ $TARGET now running $SHA  →  $URL"
echo "   Rollback: ssh $SSH \"cd $DIR && docker tag ${IMAGE%%:*}:rollback $IMAGE && docker compose -f $COMPOSE up -d app worker\""
