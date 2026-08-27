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
echo "▶ Deploy $SHA ($REF) → $TARGET  [$SSH]"

echo "▶ [1/6] Backup DB + tag :rollback"
# Bản dump này chứa CCCD / số tài khoản / lương ở dạng THÔ — cùng nội dung mà
# scripts/backup/backup-db.sh phải siết. Lệnh dưới chạy trong shell đăng nhập của máy chủ với
# umask mặc định 0022, nên bản trước để lại file 0644 trong thư mục 0755: mọi tài khoản trên VM
# production đọc được toàn bộ hồ sơ nhân sự, và nó sinh ra MỖI LẦN deploy rồi nằm lại đó.
#   • `umask 077`            → file mới ra 0600 ngay lúc tạo (bao cả trường hợp gzip ghi dở dang).
#   • `install -d -m 0700`   → siết cả thư mục ĐÃ TỒN TẠI từ những lượt deploy trước (mkdir -p thì không).
#   • `chmod 600` tường minh → như backup-db.sh:66-68, phòng shell đăng nhập có umask khác.
ssh "$SSH" "umask 077 && install -d -m 0700 ~/quanly-backups && \
  F=~/quanly-backups/predeploy-\$(date +%F-%H%M%S).sql.gz && \
  docker exec quanly-postgres pg_dump -U quanly -d quanly | gzip > \"\$F\" && chmod 600 \"\$F\" && \
  docker tag $IMAGE ${IMAGE%%:*}:rollback 2>/dev/null || true"

echo "▶ [2/6] Ship tracked files"
git archive --format=tar.gz "$REF" | ssh "$SSH" "tar xzf - -C $DIR"
# tar KHÔNG xóa file cũ. Sau khi migrate .js→.ts (git mv), các .js cũ từ deploy trước CÒN SÓT trên
# $DIR và SHADOW .ts (import './x.js' resolve vào file .js thật nếu tồn tại) → app chạy code CŨ.
# Dọn mọi .js có .ts cùng tên (trong src/ + shared/) để .ts mới thực sự được dùng.
ssh "$SSH" "cd $DIR && find src shared -name '*.js' 2>/dev/null | while read f; do [ -f \"\${f%.js}.ts\" ] && rm -f \"\$f\" && echo \"  gỡ stale \$f\"; done; true"

if [ -n "$IMAGE_REF" ]; then
  echo "▶ [3/6] Kéo image đã ghim digest (KHÔNG dựng trên VM)"
  echo "   $IMAGE_REF"
  ssh "$SSH" "docker pull $IMAGE_REF && docker tag $IMAGE_REF $IMAGE"
else
  echo "▶ [3/6] Build image NGAY TRÊN VM"
  echo "   ⚠️  Không đặt IMAGE_REF → image này KHÔNG phải bản CI đã quét lỗ hổng và đính SBOM +"
  echo "      provenance, và không có digest nào để đối chiếu về sau. Đường ưu tiên:"
  echo "      IMAGE_REF=<repo>@sha256:<digest> bash deploy.sh $TARGET"
  ssh "$SSH" "cd $DIR && docker compose -f $COMPOSE build app"
fi

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
# Ghi NỐI THÊM vào $DIR/RELEASES.log (untracked, `git archive` không đụng tới) — một dòng JSON
# mỗi lần, đọc bằng `tail`/`jq` được, và không bao giờ mất lịch sử.
echo "▶ [5b/6] Ghi sổ phát hành"
REL=$(ssh "$SSH" "cd $DIR && \
  MIG=\$(docker exec quanly-postgres psql -U quanly -d quanly -tAc \
        \"SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1\" 2>/dev/null || echo unknown) && \
  DG=\$(docker inspect --format '{{if .RepoDigests}}{{index .RepoDigests 0}}{{else}}local:{{.Id}}{{end}}' $IMAGE 2>/dev/null || echo unknown) && \
  TS=\$(date -u +%Y-%m-%dT%H:%M:%SZ) && \
  LINE=\$(printf '{\"ts\":\"%s\",\"target\":\"%s\",\"sha\":\"%s\",\"migration\":\"%s\",\"image\":\"%s\"}' \"\$TS\" '$TARGET' '$SHA' \"\$MIG\" \"\$DG\") && \
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
  echo "   Rollback: ssh $SSH \"cd $DIR && docker tag ${IMAGE%%:*}:rollback $IMAGE && docker compose -f $COMPOSE up -d app worker\""
  exit 1
fi
echo
echo "✅ $TARGET now running $SHA  →  $URL"
echo "   Rollback: ssh $SSH \"cd $DIR && docker tag ${IMAGE%%:*}:rollback $IMAGE && docker compose -f $COMPOSE up -d app worker\""
