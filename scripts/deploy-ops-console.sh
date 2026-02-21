#!/usr/bin/env bash
set -euo pipefail

LOCK_FILE="/tmp/mithril-ops-console-deploy.lock"
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "Another ops-console deploy is already running. Try again in a moment."
  exit 1
fi

DST="/mithril-os/apps/ops-console"
REQ_FILES=("package.json" "public/index.html" "src/server.js")

# Optional explicit source override
if [[ -n "${OPS_CONSOLE_SRC:-}" ]]; then
  CANDIDATES=("$OPS_CONSOLE_SRC")
else
  # Prefer canonical repo path first (safest), then workspace mirrors.
  CANDIDATES=(
    "/mithril-os/apps/ops-console"
    "/home/node/.openclaw/workspace/mithril-os/apps/ops-console"
    "/home/mini-home-lab/.openclaw/workspace/mithril-os/apps/ops-console"
  )
fi

SRC=""
for c in "${CANDIDATES[@]}"; do
  if [[ -d "$c" ]]; then
    missing=0
    for f in "${REQ_FILES[@]}"; do
      if [[ ! -f "$c/$f" ]]; then
        missing=1
        break
      fi
    done
    if [[ $missing -eq 0 ]]; then
      SRC="$c"
      break
    fi
  fi
done

if [[ -z "$SRC" ]]; then
  echo "No valid ops-console source found. Candidates checked:"
  printf ' - %s\n' "${CANDIDATES[@]}"
  echo "Required files:" && printf ' - %s\n' "${REQ_FILES[@]}"
  exit 1
fi

mkdir -p "$DST"

TMP_ENV=""
if [[ -f "$DST/.env" ]]; then
  TMP_ENV="$(mktemp)"
  cp "$DST/.env" "$TMP_ENV"
fi

if [[ "$SRC" != "$DST" ]]; then
  if command -v rsync >/dev/null 2>&1; then
    rsync -av --delete --exclude '.env' --exclude '.git' "$SRC/" "$DST/"
  else
    find "$DST" -mindepth 1 -maxdepth 1 ! -name '.env' ! -name '.git' -exec rm -rf {} +
    cp -a "$SRC/." "$DST/"
  fi
fi

if [[ -n "$TMP_ENV" ]]; then
  mv "$TMP_ENV" "$DST/.env"
fi

# Post-sync guard (prevents serving half-copied app)
for f in "${REQ_FILES[@]}"; do
  if [[ ! -f "$DST/$f" ]]; then
    echo "Deploy aborted: destination missing required file: $DST/$f"
    exit 1
  fi
done

cd "$DST"
npm install
pkill -f "node src/server.js" >/dev/null 2>&1 || true
nohup npm run dev >/tmp/mithril-os-ops-console.log 2>&1 &

echo "Deployed and started Mithril-OS Ops Console"
echo "Source: $SRC"
echo "Destination: $DST"
echo "URL: http://192.168.2.58:3001"
echo "Log: /tmp/mithril-os-ops-console.log"
