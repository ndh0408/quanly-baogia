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
#           docker compose build → recreate app+worker → write DEPLOYED_SHA → verify /livez.
# Untracked server files (.env, docker-compose.*.yml, DEPLOYED_SHA) are preserved.
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

SHA=$(git rev-parse --verify "$REF^{commit}")
echo "▶ Deploy $SHA ($REF) → $TARGET  [$SSH]"

echo "▶ [1/5] Backup DB + tag :rollback"
ssh "$SSH" "mkdir -p ~/quanly-backups && \
  docker exec quanly-postgres pg_dump -U quanly -d quanly | gzip > ~/quanly-backups/predeploy-\$(date +%F-%H%M%S).sql.gz && \
  docker tag $IMAGE ${IMAGE%%:*}:rollback 2>/dev/null || true"

echo "▶ [2/5] Ship tracked files"
git archive --format=tar.gz "$REF" | ssh "$SSH" "tar xzf - -C $DIR"

echo "▶ [3/5] Build image"
ssh "$SSH" "cd $DIR && docker compose -f $COMPOSE build app"

echo "▶ [4/5] Recreate app + worker"
ssh "$SSH" "cd $DIR && docker compose -f $COMPOSE up -d app worker && printf '%s\n' '$SHA' > DEPLOYED_SHA"

echo "▶ [5/5] Verify /livez"
ssh "$SSH" "for i in \$(seq 1 20); do s=\$(docker inspect -f '{{.State.Health.Status}}' quanly-app 2>/dev/null); [ \"\$s\" = healthy ] && break; sleep 3; done; \
  echo -n 'livez: '; docker exec quanly-app wget -qO- http://127.0.0.1:3000/livez || echo FAILED"
echo
echo "✅ $TARGET now running $SHA  →  $URL"
echo "   Rollback: ssh $SSH \"cd $DIR && docker tag ${IMAGE%%:*}:rollback $IMAGE && docker compose -f $COMPOSE up -d app worker\""
