#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/home/mini-home-lab/openclaw}"
SYNC_SCRIPT="${SYNC_SCRIPT:-/home/mini-home-lab/openclaw/oc-github-auth-sync.sh}"

cd "$PROJECT_DIR"

echo "== pulling compose updates (if repo) =="
# Non-fatal if not a git checkout
(git pull --ff-only || true)

echo "== docker pull =="
docker compose pull openclaw-gateway

echo "== recreate gateway + socat =="
docker compose up -d --force-recreate openclaw-gateway socat-proxy

echo "== optional github auth re-sync =="
if [[ -n "${GITHUB_TOKEN:-}" && -x "$SYNC_SCRIPT" ]]; then
  "$SYNC_SCRIPT" || true
fi

echo "== post-upgrade checks =="
if [[ -x /mithril-os/scripts/oc-post-upgrade-check.sh ]]; then
  /mithril-os/scripts/oc-post-upgrade-check.sh
else
  docker compose ps
fi

echo "upgrade flow complete"
