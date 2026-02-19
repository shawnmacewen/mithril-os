#!/usr/bin/env bash
set -euo pipefail

CANDIDATES=(
  "/home/mini-home-lab/.openclaw/workspace/mithril-os/apps/ops-console"
  "/home/node/.openclaw/workspace/mithril-os/apps/ops-console"
)

SRC=""
for c in "${CANDIDATES[@]}"; do
  if [ -d "$c" ]; then SRC="$c"; break; fi
done

if [ -z "$SRC" ]; then
  echo "Could not find source ops-console directory. Checked:"
  printf ' - %s\n' "${CANDIDATES[@]}"
  exit 1
fi

DST="/mithril-os/apps/ops-console"
mkdir -p "$DST"

# Preserve runtime secrets/config across deploys
TMP_ENV=""
if [ -f "$DST/.env" ]; then
  TMP_ENV="$(mktemp)"
  cp "$DST/.env" "$TMP_ENV"
fi

if command -v rsync >/dev/null 2>&1; then
  # Do not delete runtime .env
  rsync -av --delete --exclude '.env' --exclude '.git' "$SRC/" "$DST/"
else
  find "$DST" -mindepth 1 -maxdepth 1 ! -name '.env' ! -name '.git' -exec rm -rf {} +
  cp -a "$SRC/." "$DST/"
fi

if [ -n "$TMP_ENV" ]; then
  mv "$TMP_ENV" "$DST/.env"
fi

cd "$DST"
npm install
pkill -f "node src/server.js" >/dev/null 2>&1 || true
nohup npm run dev >/tmp/mithril-os-ops-console.log 2>&1 &

echo "Deployed and started Mithril-OS Ops Console"
echo "Source: $SRC"
echo "URL: http://192.168.2.58:3001"
echo "Log: /tmp/mithril-os-ops-console.log"
