#!/usr/bin/env bash
# deploy.sh — ship this repo to STAGING or PROD with one identical, safe flow.
#
#   bash deploy.sh staging [git-ref]   # → quanly-staging VM (Tailscale, test/demo)
#   bash deploy.sh prod    [git-ref]   # → coolify VM (gianguyen.cloud, live)
#   bash deploy.sh rollback <staging|prod> [git-sha|rollback]
#                                      # → lùi ẢNH về tag bất biến <git-sha> (RELEASES.log) hoặc
#                                      #   :rollback (bản chạy trước lượt deploy gần nhất). KHÔNG lùi
#                                      #   migration — xem "Lùi schema" trong docs/operations/DEPLOYMENT.md.
#
# git-ref defaults to HEAD. Recommended flow:
#   1) npm run verify                  # đủ 13 bước trên cây SẠCH → ghi DẤU XANH cho commit HEAD
#   2) bash deploy.sh staging          # deploy current code to staging
#   3) test at https://dev.gianguyen.cloud (login with real account)
#   4) bash deploy.sh prod             # only after staging is verified OK
#
# ── CỔNG TRƯỚC KHI SHIP (audit 2026-09-22 INFRA-04; chủ repo chốt 2026-09-23: CI = verify-local) ──
# Không cổng nào từng nối "mã đã kiểm" với "mã lên production": deploy.sh ship BẤT KỲ commit cục bộ
# nào. Nay bước [0/6] đòi (1) commit có DẤU XANH do `npm run verify` ghi (chạy đủ, cây sạch), và
# (2) cây làm việc sạch. Với `prod` đó là CHẶN; với `staging` chỉ CẢNH BÁO — staging là nơi thử.
# Commit chưa có trên origin: chỉ cảnh báo (chủ repo làm việc local).
# Khẩn cấp (vá nóng khi verify không chạy được): đặt LÝ DO, nó được ghi vào RELEASES.log:
#   DEPLOY_KHAN_CAP="vá nóng lỗi X, verify hỏng vì Y" bash deploy.sh prod
#
# Each run: [0] cổng → backup DB → tag :rollback (ảnh ĐANG CHẠY) → ship tracked files (git archive) →
#           lấy image (pull digest HOẶC build trên VM) → soát migration huỷ → migrate →
#           recreate app+worker → đối chiếu ảnh → sổ phát hành → verify /livez + /readyz + worker +
#           đường public.
# Untracked server files (.env, DEPLOYED_SHA) are preserved.
# ⚠️ docker-compose.*.yml KHÔNG nằm trong nhóm đó: cả ba file compose ĐỀU được git theo dõi
#    (`git ls-files | grep docker-compose`), nên `git archive` ở dưới GHI ĐÈ chúng mỗi lượt
#    deploy. Sửa tay compose trên máy chủ là mất lặng lẽ ở lượt deploy kế. Giá trị cần chỉnh
#    theo từng máy (POSTGRES_CPUS / REDIS_CPUS / APP_CPUS / WORKER_CPUS…) phải đặt trong
#    `.env` — file đó mới thật sự untracked và được giữ nguyên.
#
#   IMAGE_REF="ghcr.io/ndh0408/quanly-baogia@sha256:…" bash deploy.sh prod
#     → kéo đúng image đã dựng sẵn, ghim digest, thay vì dựng lại trên VM (xem khối ở dưới).
#     (Chưa có đường nào dựng image đó: GitHub Actions không dùng — xem AGENTS.md.)
set -euo pipefail

MODE=deploy
if [ "${1:-}" = "rollback" ]; then
  MODE=rollback
  TARGET="${2:-}"
  TO="${3:-rollback}"
  REF=HEAD
else
  TARGET="${1:-}"
  REF="${2:-HEAD}"
fi
DIR=/opt/stacks/quanly/quanly

case "$TARGET" in
  prod)
    SSH=coolify-ts;  COMPOSE=docker-compose.prod.yml;    IMAGE=quanly-app:prod;    URL=https://gianguyen.cloud ;;
  staging)
    SSH=staging-ts;  COMPOSE=docker-compose.staging.yml; IMAGE=quanly-app:staging; URL=https://dev.gianguyen.cloud ;;   # Cloudflare tunnel (cloudflared trên chính VM staging → :3000). Địa chỉ ts.net cũ chỉ vào được trong tailnet; chủ repo chốt 2026-09-23 dùng một địa chỉ dev công khai này. SSH vẫn qua tailnet (staging-ts).
  *)
    echo "Usage: bash deploy.sh <staging|prod> [git-ref]"
    echo "       bash deploy.sh rollback <staging|prod> [git-sha|rollback]"
    exit 1 ;;
esac

# Chờ bao lâu để coi worker là "đã đứng vững" ở bước [6/6] (giây). Test đặt 0.
CHO_WORKER_S="${DEPLOY_CHO_WORKER_S:-20}"

# ── ĐỐI CHIẾU ẢNH ĐANG CHẠY (dùng chung cho deploy và rollback) ──────────────────────────────
# Xem chú thích ở bước [5/6]: `compose up` có thể báo thành công mà container vẫn chạy ảnh cũ.
doi_chieu_anh() {
  ssh "$SSH" "
    muon=\$(docker images $IMAGE --format '{{.ID}}' | head -1)
    for c in quanly-app quanly-worker; do
      dang=\$(docker inspect \$c --format '{{.Image}}' 2>/dev/null | cut -c8-19)
      [ \"\$dang\" = \"\$muon\" ] || { echo \"✖ \$c đang chạy ảnh \$dang, đáng lẽ phải là \$muon\"; exit 1; }
      echo \"   \$c → \$dang ✓\"
    done"
}

# ── KIỂM SAU KHI THAY CONTAINER (audit 2026-09-22, INFRA-05) ─────────────────────────────────
# Bản trước chỉ gọi /livez — `res.json({ok:true})`, không chạm CSDL/Redis — nên deploy báo ✅ khi app
# không nối được Postgres, khi worker chết vòng ngay lúc khởi động (healthcheck của worker TẮT, nên
# `Restarting` không làm gì đỏ), hoặc khi tunnel/hostname hỏng. Bốn lớp, mỗi lớp bắt một kiểu hỏng:
#   1. app healthy + /livez   — tiến trình lên
#   2. /readyz                — app CHẠM ĐƯỢC CSDL (pool riêng, xem src/app.ts)
#   3. worker Running và RestartCount KHÔNG tăng sau ${CHO_WORKER_S}s, và log có "worker registered"
#   4. đường PUBLIC ($URL/livez từ máy đang gõ lệnh) — tunnel/DNS/Cloudflare. prod: hỏng là đỏ;
#      staging: chỉ cảnh báo (máy gõ lệnh có thể không ở trong tailnet). DEPLOY_BO_QUA_KIEM_PUBLIC=1
#      để bỏ riêng lớp này khi biết chắc máy mình không tới được URL.
kiem_sau_khi_thay() {
  local kq
  if ! kq=$(ssh "$SSH" "for i in \$(seq 1 20); do s=\$(docker inspect -f '{{.State.Health.Status}}' quanly-app 2>/dev/null); [ \"\$s\" = healthy ] && break; sleep 3; done; \
    docker exec quanly-app wget -qO- http://127.0.0.1:3000/livez"); then kq=""; fi
  case "$kq" in *'"ok":true'*) echo "   livez OK" ;; *) echo "✖ /livez không trả ok"; return 1 ;; esac

  if ! kq=$(ssh "$SSH" "docker exec quanly-app wget -qO- http://127.0.0.1:3000/readyz"); then kq=""; fi
  case "$kq" in *'"ok":true'*) echo "   readyz OK (app chạm được CSDL)" ;; *) echo "✖ /readyz không trả ok — app không chạm được CSDL"; return 1 ;; esac

  if ! kq=$(ssh "$SSH" "r0=\$(docker inspect -f '{{.RestartCount}}' quanly-worker 2>/dev/null) || { echo WORKER_KHONG_CO; exit 1; }; \
    sleep $CHO_WORKER_S; \
    st=\$(docker inspect -f '{{.State.Running}} {{.RestartCount}}' quanly-worker 2>/dev/null); \
    [ \"\$st\" = \"true \$r0\" ] || { echo \"WORKER_KHONG_ON trạng thái='\$st' RestartCount trước=\$r0\"; exit 1; }; \
    docker logs --since 10m quanly-worker 2>&1 | grep -q 'worker registered' || { echo WORKER_CHUA_DANG_KY; exit 1; }; \
    echo WORKER_OK"); then kq="${kq:-WORKER_LOI}"; fi
  case "$kq" in *WORKER_OK*) echo "   worker OK (đang chạy, không khởi động lại, đã đăng ký hàng đợi)" ;;
    *) echo "✖ worker hỏng: $kq"; echo "   Xem: ssh $SSH \"docker logs quanly-worker --tail 100\""; return 1 ;; esac

  if [ "${DEPLOY_BO_QUA_KIEM_PUBLIC:-0}" = "1" ]; then
    echo "   (bỏ qua kiểm đường public — DEPLOY_BO_QUA_KIEM_PUBLIC=1)"
  elif curl -fsS -m 15 "$URL/livez" 2>/dev/null | grep -q '"ok":true'; then
    echo "   đường public OK ($URL/livez)"
  elif [ "$TARGET" = prod ]; then
    echo "✖ $URL/livez KHÔNG tới được từ máy này — tunnel/DNS/Cloudflare hỏng, hoặc máy này mất mạng."
    echo "   Container đã chạy bản mới và đã qua /readyz; kiểm tunnel trước khi rollback."
    return 1
  else
    echo "   ⚠️  không tới được $URL/livez từ máy này (staging: chỉ cảnh báo — tunnel dev.gianguyen.cloud / Cloudflare có đang chạy không?)"
  fi
  return 0
}

in_duong_lui() {
  echo "   Rollback 1 bước (về bản chạy trước lượt deploy này):  bash deploy.sh rollback $TARGET"
  echo "   Rollback về BẤT KỲ bản đã phát hành (sha trong RELEASES.log):  bash deploy.sh rollback $TARGET <git-sha>"
  echo "   ⚠️  Lùi ẢNH không lùi MIGRATION: bản cũ phải chạy được trên schema mới. Có migration DROP/RENAME"
  echo "      thì đọc mục \"Lùi schema\" trong docs/operations/DEPLOYMENT.md trước."
}

# ══ ROLLBACK (audit 2026-09-22, DOC-02 / INFRA-02) ═══════════════════════════════════════════
# Bản trước IN RA lệnh lùi `docker tag … && docker compose up -d app worker` — đúng mẫu mà bước [5/6]
# đã ĐO là KHÔNG thay container (compose thấy cấu hình y nguyên, thoát 0, container vẫn chạy ảnh
# lỗi). Lệnh lùi dùng đúng lúc sự cố mà báo thành công giả. Nay lùi là một lệnh con dùng CHUNG
# `--force-recreate`, CHUNG phép đối chiếu ảnh và CHUNG bước kiểm của lượt deploy.
if [ "$MODE" = rollback ]; then
  case "$TO" in
    rollback|[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]*) : ;;
    *) echo "❌ đích lùi phải là 'rollback' hoặc một git sha (xem RELEASES.log), nhận: $TO"; exit 1 ;;
  esac
  echo "▶ ROLLBACK $TARGET → ${IMAGE%%:*}:$TO  [$SSH]"
  if ! ssh "$SSH" "docker image inspect ${IMAGE%%:*}:$TO >/dev/null 2>&1"; then
    echo "❌ không có ảnh ${IMAGE%%:*}:$TO trên máy chủ. Các tag bất biến hiện có:"
    ssh "$SSH" "docker images ${IMAGE%%:*} --format '{{.Tag}}  {{.CreatedSince}}' | head -15" || true
    exit 1
  fi
  echo "▶ [R1] Gắn tag + dựng lại app/worker (--no-deps --force-recreate)"
  ssh "$SSH" "cd $DIR && docker tag ${IMAGE%%:*}:$TO $IMAGE && docker compose -f $COMPOSE up -d --no-deps --force-recreate app worker"
  echo "▶ [R2] Đối chiếu ảnh đang chạy"
  doi_chieu_anh
  echo "▶ [R3] Kiểm sau khi lùi"
  if ! kiem_sau_khi_thay; then
    echo "❌ Đã lùi ảnh nhưng $TARGET vẫn CHƯA khoẻ — xem log: ssh $SSH \"docker logs quanly-app --tail 200\""
    exit 1
  fi
  ssh "$SSH" "cd $DIR && printf '%s\n' '$TO' > DEPLOYED_SHA && \
    printf '{\"ts\":\"%s\",\"target\":\"%s\",\"rollback_to\":\"%s\",\"image\":\"%s\"}\n' \"\$(date -u +%Y-%m-%dT%H:%M:%SZ)\" '$TARGET' '$TO' \
      \"\$(docker inspect --format '{{.Id}}' $IMAGE 2>/dev/null)\" >> RELEASES.log" || true
  echo "✅ $TARGET đã lùi về ${IMAGE%%:*}:$TO"
  echo "   ⚠️  Lùi ẢNH không lùi MIGRATION — nếu bản lỗi đã áp migration DROP/RENAME, xem \"Lùi schema\" trong docs/operations/DEPLOYMENT.md."
  exit 0
fi

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

# ── [0/6] CỔNG: mã sắp ship ĐÃ QUA verify-local chưa ────────────────────────────────────────
# Xem khối "CỔNG TRƯỚC KHI SHIP" ở đầu tệp. Dấu xanh do scripts/verify-local.sh ghi (chạy đủ, cây
# sạch) vào thư mục git chung — QUANLY_VERIFY_DIR ghi đè được (test dùng).
echo "▶ [0/6] Cổng trước khi ship"
DAU_DIR="${QUANLY_VERIFY_DIR:-$(git rev-parse --git-common-dir 2>/dev/null)/quanly-verify}"
KHAN_CAP="${DEPLOY_KHAN_CAP:-}"
# Bản đã bỏ ký tự phá chuỗi (nháy đơn/kép, gạch ngược, `, $) — nhét thẳng vào dòng JSON của RELEASES.log.
KHAN_CAP_SACH="$(printf '%s' "$KHAN_CAP" | tr -d '"\\`$' | tr -d "'" | tr '\n' ' ')"
CHAN=()
CANH=()
if [ -f "$DAU_DIR/ok-$SHA" ]; then
  echo "   ✓ có dấu xanh của npm run verify ($(sed -n 's/^luc=//p' "$DAU_DIR/ok-$SHA" 2>/dev/null))"
else
  CHAN+=("commit $SHA CHƯA có dấu xanh của \`npm run verify\` (chạy ĐỦ 13 bước trên cây SẠCH ở đúng commit này)")
fi
if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
  CHAN+=("cây làm việc BẨN — thay đổi chưa commit không được ship (git archive lấy commit), nhưng cũng chưa được kiểm cùng")
fi
if [ -z "$(git branch -r --contains "$SHA" 2>/dev/null)" ]; then
  CANH+=("commit $SHA chưa có trên nhánh remote nào — mã đang chạy chỉ tồn tại trên máy này (push lên origin khi có thể)")
fi
for c in "${CANH[@]+"${CANH[@]}"}"; do echo "   ⚠️  $c"; done
if [ "${#CHAN[@]}" -gt 0 ]; then
  for c in "${CHAN[@]}"; do echo "   ⚠️  $c"; done
  if [ "$TARGET" = prod ] && [ -z "$KHAN_CAP" ]; then
    echo
    echo "❌ prod: DỪNG trước khi đụng máy chủ. Sửa các mục trên, hoặc nếu THẬT SỰ khẩn cấp:"
    echo "     DEPLOY_KHAN_CAP=\"<lý do>\" bash deploy.sh prod $REF"
    echo "   (lý do được ghi vào RELEASES.log)"
    exit 1
  elif [ "$TARGET" = prod ]; then
    echo "   ⚠️  KHẨN CẤP — bỏ qua cổng theo DEPLOY_KHAN_CAP: $KHAN_CAP"
  else
    echo "   (staging: chỉ cảnh báo)"
  fi
fi

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
# `--no-owner --clean --if-exists` GIỐNG HỆT dump hằng đêm của backup-db.sh (audit 2026-09-22, DOC-06):
# DEPLOYMENT.md bảo dùng CHÍNH bản này để lùi một migration hỏng, mà bản thiếu `--clean` thì lệnh CREATE
# đầu tiên gặp "already exists" và `psql -v ON_ERROR_STOP=1` dừng ngay — runbook lúc 2 giờ sáng hỏng.
# tests/ops-deploy.test.js khoá hai lệnh pg_dump cùng cờ.
# Ghi vào `.partial` rồi mới đổi tên — cùng khuôn nguyên tử của backup-db.sh, và ở đây nó giải
# một cái bẫy cụ thể: lượt hỏng mà để lại đúng cái tên `predeploy-….sql.gz` thì người trực lúc
# 2 giờ sáng sẽ tưởng đó là điểm lùi và khôi phục từ một bản dump CỤT. Đổi tên chỉ xảy ra sau khi
# cả ba lớp kiểm đã qua: hoặc có tệp hoàn chỉnh, hoặc chỉ có `.partial` — không lẫn được.
if ! ssh "$SSH" "set -o pipefail 2>/dev/null || true; \
  umask 077 && install -d -m 0700 ~/quanly-backups && \
  F=~/quanly-backups/predeploy-\$(date +%F-%H%M%S).sql.gz && \
  docker exec quanly-postgres pg_dump -U quanly -d quanly --no-owner --clean --if-exists | gzip > \"\$F.partial\" && \
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
#
# Gắn từ ảnh của CONTAINER ĐANG CHẠY, không từ tag `$IMAGE` (audit 2026-09-22, INFRA-02): nếu lượt
# trước hỏng ở [4/6] SAU KHI [3/6] đã gắn `$IMAGE` cho ảnh mới, thì `$IMAGE` đang trỏ một ảnh CHƯA TỪNG
# CHẠY — và `:rollback` gắn theo tag sẽ "lùi" về đúng bản chưa ai kiểm. Chưa có container (lượt đầu)
# thì rơi về tag như cũ.
if ssh "$SSH" "IMG=\$(docker inspect quanly-app --format '{{.Image}}' 2>/dev/null); \
    if [ -n \"\$IMG\" ]; then docker tag \"\$IMG\" ${IMAGE%%:*}:rollback; else docker tag $IMAGE ${IMAGE%%:*}:rollback; fi 2>/dev/null"; then
  echo "   :rollback → ảnh của container quanly-app đang chạy"
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
# Nên chốt phải TỔNG QUÁT: giữ đúng những gì git đang theo dõi, xoá phần còn lại. `src/`,
# `shared/` và `web/src/` hoàn toàn do repo quản lý — không có gì sinh ra trong đó lúc chạy (bundle
# web ra `public/app2/`, KHÔNG ra `web/src/`) — nên phép so này an toàn. Danh sách đi qua stdin để
# không đụng trần độ dài dòng lệnh.
#
# ── VÌ SAO `web/src` CŨNG PHẢI CÓ TRONG DANH SÁCH (2026-09-07) ─────────────────────────────
# Bản trước chỉ quét `src shared`. Nhưng `web/` dính ĐÚNG cùng cái bẫy, và nó đã nổ thật: các
# trang từng nằm phẳng ở `web/src/*.tsx` rồi được `git mv` vào `web/src/pages/` +
# `web/src/components/`; 19 bản CŨ nằm lại trên VM và không lượt deploy nào xoá. Chúng vô hại
# suốt nhiều tháng — cho tới lượt deploy đổi chữ ký một hàm DÙNG CHUNG (`quoteTotals` trong
# shared/quote-math.ts), vì `web` build bằng `tsc --noEmit && vite build` mà `tsc` biên dịch TOÀN
# BỘ cây `web/src`, kể cả file mồ côi:
#     src/QuoteEditor.tsx(249,55): error TS2554: Expected 1-2 arguments, but got 3.
# Deploy chết ở bước build, trên những file KHÔNG CÒN trong repo — đúng lớp lỗi khối này sinh ra
# để chặn, chỉ khác thư mục.
#
# ── VÌ SAO THÊM `prisma` `templates` `public` (audit 2026-09-22, INFRA-09) ─────────────────
# Cùng lớp lỗi, hậu quả nặng hơn: một thư mục `prisma/migrations/<tên cũ>` đã gỡ/đổi tên trong git vẫn
# nằm trên VM → Dockerfile `COPY prisma` đưa nó vào image → `prisma migrate deploy` thấy một migration
# "chưa áp" và CHẠY nó trên CSDL production. `templates/*.xlsx` và `public/*` cũ cũng vào image và được
# phục vụ. `public/app2/` là bundle web SINH RA (không do git quản) nên loại khỏi phép dọn.
echo "▶ [2b/6] Dọn file mồ côi trong src/ shared/ web/src/ prisma/ templates/ public/ (tar không tự xoá)"
git ls-tree -r --name-only "$REF" -- src shared web/src prisma templates public | ssh "$SSH" "cat > $DIR/.tracked-src.txt && cd $DIR && \
  find src shared web/src prisma templates public -type f ! -path 'public/app2/*' 2>/dev/null | sort > .onvm-src.txt && \
  sort .tracked-src.txt -o .tracked-src.txt && \
  comm -13 .tracked-src.txt .onvm-src.txt | while read -r f; do rm -f \"\$f\" && echo \"  gỡ mồ côi \$f\"; done; \
  find prisma/migrations -mindepth 1 -type d -empty -delete 2>/dev/null; \
  rm -f .tracked-src.txt .onvm-src.txt; true"

# ── [2c/6] BỘ SAO LƯU TRÊN HOST CÓ KHỚP REPO KHÔNG (audit 2026-09-22, INFRA-06) ───────────
# Đo trên production: /opt/quanly/backup-db.sh KHÁC md5 với repo và chỉ có 2/5 timer — mọi bản vá
# backup trong repo (atomic .partial, off-host, watchdog) chưa bao giờ tới host, vì deploy.sh không
# đụng /opt/quanly. KHÔNG tự cài (cần sudo, và cài đè có thể mất bản vá chỉ có trên host) — chỉ NÓI RA.
echo "▶ [2c/6] Bộ sao lưu trên host so với repo (chỉ cảnh báo)"
LECH_BK=$(ssh "$SSH" "cd $DIR && for f in scripts/backup/*.sh; do t=/opt/quanly/\$(basename \$f); \
    if cmp -s \$f \$t 2>/dev/null || sudo -n cmp -s \$f \$t 2>/dev/null; then :; \
    elif [ -e \$t ] || sudo -n test -e \$t 2>/dev/null; then echo \"LỆCH \$t\"; \
    else echo \"THIẾU/KHÔNG ĐỌC ĐƯỢC \$t\"; fi; done" 2>/dev/null || true)
if [ -n "$LECH_BK" ]; then
  printf '%s\n' "$LECH_BK" | sed 's/^/   ⚠️  /'
  echo "   → bộ sao lưu đang chạy KHÔNG phải bản trong repo. Xem docs/operations/BACKUP_RESTORE.md, mục \"Đưa production về đúng cơ chế\"."
else
  echo "   ✓ khớp repo"
fi

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

# ── [3c/6] MIGRATION HUỶ ĐANG CHỜ (audit 2026-09-22, INFRA-03) ──────────────────────────────
# Migration chạy TRƯỚC khi thay app, và rollback chỉ lùi ẢNH. Với migration chỉ THÊM (đa số) thì app
# cũ vẫn chạy trên schema mới. Với migration HUỶ/ĐỔI DẠNG (DROP TABLE/COLUMN, RENAME, đổi kiểu cột)
# thì trong cửa sổ migrate→recreate VÀ sau mọi lần rollback, app cũ gọi vào thứ đã mất → 500; người
# trực buộc phải restore dump trước-deploy và mất mọi ghi mới. Ví dụ thật: 20260915090000 đã
# `DROP TABLE "_QuoteMembers"` mà code trước f84a4ff còn dùng.
# Luật expand/contract (prisma/migrations/README.md): DROP/RENAME chỉ phát hành ở lượt SAU lượt đã
# ngừng dùng thứ đó. Bước này đọc migration ĐANG CHỜ (có trong commit, chưa có trong _prisma_migrations
# của máy chủ) và chặn nếu có lệnh huỷ — prod: chặn trừ khi CHO_PHEP_MIGRATION_HUY=1; staging: cảnh báo.
echo "▶ [3c/6] Soát migration HUỶ đang chờ"
DA_AP=$(ssh "$SSH" "docker exec quanly-postgres psql -U quanly -d quanly -tAc \
  \"SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL\"" 2>/dev/null) || DA_AP="__KHONG_DOC_DUOC__"
if [ "$DA_AP" = "__KHONG_DOC_DUOC__" ]; then
  echo "   ⚠️  không đọc được _prisma_migrations trên máy chủ (lượt deploy đầu?) — bỏ qua bước soát"
else
  HUY=()
  while IFS= read -r m; do
    [ -n "$m" ] || continue
    printf '%s\n' "$DA_AP" | grep -qxF "$m" && continue
    if git show "$REF:prisma/migrations/$m/migration.sql" 2>/dev/null \
        | grep -v '^[[:space:]]*--' \
        | grep -qiE 'DROP[[:space:]]+(TABLE|COLUMN)|RENAME[[:space:]]+(TO|COLUMN)|ALTER[[:space:]]+COLUMN[[:space:]]+[^[:space:]]+[[:space:]]+(SET[[:space:]]+DATA[[:space:]]+)?TYPE'; then
      HUY+=("$m")
    fi
  done < <(git ls-tree --name-only "$REF" prisma/migrations/ 2>/dev/null | sed -n 's#^prisma/migrations/##p')
  if [ "${#HUY[@]}" -eq 0 ]; then
    echo "   ✓ không có migration huỷ đang chờ"
  else
    for m in "${HUY[@]}"; do echo "   ⚠️  migration HUỶ/ĐỔI DẠNG đang chờ: $m"; done
    echo "      Sau lượt này, rollback ẢNH về bản cũ có thể hỏng (bản cũ còn dùng thứ bị huỷ)."
    if [ "$TARGET" = prod ] && [ "${CHO_PHEP_MIGRATION_HUY:-0}" != "1" ]; then
      echo "❌ prod: dừng. Đã theo luật expand/contract (bản ĐANG CHẠY đã ngừng dùng thứ bị huỷ)? thì:"
      echo "     CHO_PHEP_MIGRATION_HUY=1 bash deploy.sh prod $REF"
      exit 1
    fi
  fi
fi

# Chạy migration TRƯỚC khi recreate (schema thêm cột/bảng → code mới mới dùng được). prisma nằm
# trong dependencies nên có trong image; migrate deploy tự lấy advisory-lock (an toàn nhiều instance).
# Nếu FAIL → set -e dừng deploy TẠI ĐÂY, app cũ vẫn chạy (không kẹt nửa-vời).
echo "▶ [4/6] DB migrate (prisma migrate deploy)"
if ! ssh "$SSH" "cd $DIR && docker compose -f $COMPOSE run --rm app npx prisma migrate deploy"; then
  echo ""
  echo "✖ [4/6] MIGRATE HỎNG. App CŨ vẫn đang chạy — chưa ai bị ảnh hưởng. ĐỌC HẾT TRƯỚC KHI GÕ LẠI."
  echo ""
  echo "  Vài migration đặt SET lock_timeout='10s' để không treo cả CSDL khi có ai đang giữ khoá"
  echo "  bảng. Hết giờ thì Postgres huỷ lệnh (SQLSTATE 55P03) và Prisma ghi migration đó là"
  echo "  FAILED. Điều quan trọng: chạy LẠI deploy.sh KHÔNG tự khỏi — prisma từ chối đi tiếp khi"
  echo "  còn một migration FAILED, nên mọi lượt sau đều hỏng y hệt cho tới khi có người gỡ tay."
  echo ""
  echo "  1) Xem migration nào hỏng và vì sao:"
  echo "       ssh $SSH \"cd $DIR && docker compose -f $COMPOSE run --rm app npx prisma migrate status\""
  echo ""
  echo "  2) Nếu hỏng vì lock_timeout (55P03) — migration KHÔNG ghi được gì, mọi lệnh nằm trong"
  echo "     một transaction nên đã rollback sạch. Đánh dấu nó là đã-lùi rồi chạy lại deploy:"
  echo "       ssh $SSH \"cd $DIR && docker compose -f $COMPOSE run --rm app npx prisma migrate resolve --rolled-back <ten_migration>\""
  echo ""
  echo "  3) Tìm ai đang giữ khoá trước khi thử lại, nếu không sẽ hết giờ lần nữa:"
  echo "       SELECT pid, state, left(query,80) FROM pg_stat_activity WHERE datname='quanly' AND state<>'idle';"
  echo ""
  echo "  ĐỪNG dùng 'migrate resolve --applied': nó nói dối rằng migration ĐÃ chạy, và lượt sau sẽ"
  echo "  bỏ qua nó — schema thiếu cột trong khi mã mới tưởng đã có."
  exit 1
fi

echo "▶ [5/6] Recreate app + worker"
# `--force-recreate` KHÔNG phải để cho chắc — nó vá một lỗi ĐÃ ĐO ĐƯỢC.
#
# Bước [3/6] dựng image rồi gắn lại tag `quanly-app:staging` (hoặc :prod) cho ảnh MỚI. Nhưng
# `docker compose up -d` với một service có khối `build:` KHÔNG so ảnh mà tag đang trỏ tới với ảnh
# container đang chạy — nó thấy cấu hình service y nguyên và kết luận "không có gì để làm". Lệnh
# thoát 0, deploy.sh in "✅ now running <sha>", RELEASES.log ghi digest MỚI — trong khi container
# vẫn chạy ảnh CŨ.
#
# Đo ngày 2026-09-01 trên staging: sau BA lượt deploy liên tiếp, `quanly-app:staging` trỏ ảnh
# 0c1aa87b4bbc còn container vẫn chạy 954ee4fafcdf — bản của ba lượt trước, giờ khởi động đứng im
# ở lượt đầu. Chạy tay `docker compose up -d app worker` một lần nữa cũng không đổi gì. Đây là lỗi
# nguy hiểm nhất trong cả tệp này: nó không hỏng ồn ào mà báo THÀNH CÔNG cho một việc chưa xảy ra,
# nên bản vá bảo mật có thể nằm im hàng tuần mà không ai biết.
#
# Bước [6/6] verify /livez cũng không bắt được: app CŨ vẫn trả 200.
ssh "$SSH" "cd $DIR && docker compose -f $COMPOSE up -d --force-recreate app worker && printf '%s\n' '$SHA' > DEPLOYED_SHA"


# CHỐT: ảnh container ĐANG CHẠY phải khớp ảnh mà tag vừa trỏ tới. Không có bước này thì lần sau
# Compose đổi hành vi lần nữa là ta lại không biết. (Hàm `doi_chieu_anh` ở đầu tệp — dùng chung với
# lệnh con rollback.)
echo "▶ [5c/6] Đối chiếu ảnh đang chạy với ảnh vừa dựng"
doi_chieu_anh

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
# Trường `khan_cap` = lý do bỏ qua cổng [0/6] (DEPLOY_KHAN_CAP), rỗng khi đi đường thường — để về sau
# đọc sổ biết lượt nào lên production mà chưa qua verify.
#
# Ghi NỐI THÊM vào $DIR/RELEASES.log (untracked, `git archive` không đụng tới) — một dòng JSON
# mỗi lần, đọc bằng `tail`/`jq` được, và không bao giờ mất lịch sử.
echo "▶ [5b/6] Ghi sổ phát hành"
REL=$(ssh "$SSH" "cd $DIR && \
  MIG=\$(docker exec quanly-postgres psql -U quanly -d quanly -tAc \
        \"SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1\" 2>/dev/null || echo unknown) && \
  DG=\$(docker inspect --format '{{if .RepoDigests}}{{index .RepoDigests 0}}{{else}}local:{{.Id}}{{end}}' $IMAGE 2>/dev/null || echo unknown) && \
  TS=\$(date -u +%Y-%m-%dT%H:%M:%SZ) && \
  LINE=\$(printf '{\"ts\":\"%s\",\"target\":\"%s\",\"sha\":\"%s\",\"migration\":\"%s\",\"image\":\"%s\",\"image_tag\":\"%s\",\"khan_cap\":\"%s\"}' \"\$TS\" '$TARGET' '$SHA' \"\$MIG\" \"\$DG\" '$IMAGE_SHA' '$KHAN_CAP_SACH') && \
  printf '%s\n' \"\$LINE\" >> RELEASES.log && printf '%s' \"\$LINE\"")
echo "   $REL"


# ── [5d/6] NẠP LẠI CẤU HÌNH QUAN SÁT (audit 2026-09-22, OBS-13) ─────────────────────────────
# `git archive` ship tệp mới (thư mục được mount nên tệp mới hiện ra trong container), nhưng Prometheus
# chỉ đọc rule_files lúc khởi động hoặc khi /-/reload, và Alertmanager chỉ dựng cấu hình trong
# entrypoint lúc khởi động container. Không có bước này thì sửa alerts.yaml rồi deploy → production
# vẫn chạy bộ quy tắc CŨ cho tới khi có người reload tay. Ngăn quan sát không chạy (dev, staging chưa
# bật) thì bỏ qua êm — nó KHÔNG được làm hỏng lượt deploy ứng dụng.
echo "▶ [5d/6] Nạp lại Prometheus / Alertmanager (nếu đang chạy)"
ssh "$SSH" "cd $DIR && \
  if docker inspect quanly-prometheus >/dev/null 2>&1; then \
    docker kill -s HUP quanly-prometheus >/dev/null 2>&1 && echo '   prometheus: đã gửi SIGHUP (nạp lại rule_files)' || echo '   ⚠️  prometheus: không nạp lại được'; \
  else echo '   (không có quanly-prometheus — bỏ qua)'; fi; \
  if docker inspect quanly-alertmanager >/dev/null 2>&1; then \
    moi=\$(sha256sum infra/observability/alertmanager.yml.tpl infra/observability/alertmanager-entrypoint.sh 2>/dev/null | sha256sum | cut -c1-16); \
    cu=\$(cat .alertmanager-tpl.sha 2>/dev/null); \
    if [ \"\$moi\" != \"\$cu\" ]; then docker restart quanly-alertmanager >/dev/null 2>&1 && printf '%s\n' \"\$moi\" > .alertmanager-tpl.sha && echo '   alertmanager: bản mẫu đổi → đã khởi động lại' || echo '   ⚠️  alertmanager: không khởi động lại được'; \
    else echo '   alertmanager: bản mẫu không đổi'; fi; \
  fi" || echo "   ⚠️  bước nạp lại quan sát hỏng — nạp tay (docs/operations/MONITORING.md)"

# `|| echo FAILED` ở bản trước NUỐT mã lỗi: `set -e` không bắt được, và dòng "✅ now running" phía
# dưới in ra VÔ ĐIỀU KIỆN. Một lần deploy mà container không bao giờ healthy vẫn báo thành công —
# người deploy đóng terminal, và sự cố chỉ lộ ra khi người dùng gọi điện.
echo "▶ [6/6] Verify: /livez · /readyz · worker · đường public"
if ! kiem_sau_khi_thay; then
  echo
  echo "❌ $TARGET CHƯA khoẻ sau khi deploy $SHA."
  echo "   Xem log:  ssh $SSH \"docker logs quanly-app --tail 200\""
  in_duong_lui
  exit 1
fi
echo
echo "✅ $TARGET now running $SHA  →  $URL"
in_duong_lui
