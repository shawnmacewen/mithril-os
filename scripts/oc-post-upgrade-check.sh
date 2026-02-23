#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/home/mini-home-lab/openclaw}"
STATUS_URL="${STATUS_URL:-http://127.0.0.1:3001/api/status}"
LIVE_UI_URL="${LIVE_UI_URL:-http://192.168.2.58:3001/index.html}"

cd "$PROJECT_DIR"

echo "== compose ps =="
docker compose ps

echo
echo "== gateway logs (tail 80) =="
docker compose logs --tail=80 openclaw-gateway || true

echo
echo "== socat logs (tail 80) =="
docker compose logs --tail=80 socat-proxy || true

echo
echo "== compose working_dir label =="
docker inspect openclaw-gateway --format '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}' || true

echo
echo "== mounts =="
docker inspect openclaw-gateway --format '{{range .Mounts}}{{println .Source "->" .Destination}}{{end}}' || true

echo
echo "== api status =="
curl -sS "$STATUS_URL" | jq . || curl -sS "$STATUS_URL" || true

echo
echo "== live UI markers =="
TMP_HTML=/tmp/mithril-live-index.html
curl -sS "$LIVE_UI_URL" -o "$TMP_HTML"
grep -n "OpenClaw Updates\|update-openclaw-gateway\|postupdate-openclaw-check" "$TMP_HTML" || true

echo
echo "post-upgrade checks complete"
