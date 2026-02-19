#!/usr/bin/env bash
set -euo pipefail

DEPLOY_SCRIPT="/mithril-os/scripts/deploy-ops-console.sh"
INTERVAL_SECONDS="${1:-2}"
STATE_DIR="/mithril-os/watchers/state"
STATE_FILE="$STATE_DIR/ops-console-watcher.json"

mkdir -p "$STATE_DIR"

CANDIDATES=(
  "/home/mini-home-lab/.openclaw/workspace/mithril-os/apps/ops-console"
  "/home/node/.openclaw/workspace/mithril-os/apps/ops-console"
)

SRC=""
for c in "${CANDIDATES[@]}"; do
  if [ -d "$c" ]; then SRC="$c"; break; fi
done

if [ -z "$SRC" ]; then
  echo "Could not find source ops-console directory."
  exit 1
fi

hash_dir() {
  find "$SRC" -type f \( -name '*.js' -o -name '*.html' -o -name '*.json' -o -name '*.css' -o -name '.env*' -o -name '*.md' \) \
    -print0 | sort -z | xargs -0 sha256sum | sha256sum | awk '{print $1}'
}

write_state() {
  local status="$1"
  local note="${2:-}"
  cat > "$STATE_FILE" <<JSON
{
  "name": "ops-console-watcher",
  "status": "$status",
  "intervalSeconds": $INTERVAL_SECONDS,
  "source": "$SRC",
  "pid": $$,
  "updatedAt": "$(date -u +%FT%TZ)",
  "note": "$note"
}
JSON
}

echo "Watching: $SRC"
echo "Interval: ${INTERVAL_SECONDS}s"
echo "Deploy script: $DEPLOY_SCRIPT"

last_hash="$(hash_dir)"
write_state "running" "initial hash: $last_hash"

while true; do
  sleep "$INTERVAL_SECONDS"
  new_hash="$(hash_dir)"
  write_state "running" "tick"
  if [ "$new_hash" != "$last_hash" ]; then
    echo "[$(date -u +%FT%TZ)] Change detected. Deploying..."
    if "$DEPLOY_SCRIPT"; then
      last_hash="$new_hash"
      write_state "running" "deployed"
      echo "[$(date -u +%FT%TZ)] Deploy complete."
    else
      write_state "error" "deploy failed"
      echo "[$(date -u +%FT%TZ)] Deploy failed."
    fi
  fi
done
