#!/usr/bin/env bash
set -euo pipefail

BACKUP_ROOT="${BACKUP_ROOT:-/backup}"
SNAPSHOT_ROOT="$BACKUP_ROOT/snapshots"
LATEST_LINK="$BACKUP_ROOT/latest"
HISTORY_LOG="$BACKUP_ROOT/backup-history.log"

KEEP_DAILY="${KEEP_DAILY:-14}"
KEEP_WEEKLY="${KEEP_WEEKLY:-8}"
KEEP_MONTHLY="${KEEP_MONTHLY:-6}"

# Optional gzip tarballs for portable off-device copy
MAKE_TARBALLS="${MAKE_TARBALLS:-0}"

TIMESTAMP="$(date -u +%Y-%m-%d_%H%M%S)"
SNAP="$SNAPSHOT_ROOT/$TIMESTAMP"

# Sources
SRC_OPENCLAW="/home/mini-home-lab/.openclaw"
SRC_HA_CONFIG="/home/mini-home-lab/homelab/homeassistant/config"
SRC_MITHRIL="/mithril-os"
SRC_SYSTEMD_DIR="/etc/systemd/system"
SRC_OBSIDIAN_VAULT_PRIMARY="/home/node/.openclaw/workspace/productivity/Personal Assistant"
SRC_OBSIDIAN_VAULT_FALLBACK="/home/mini-home-lab/.openclaw/workspace/productivity/Personal Assistant"

log() {
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || { echo "Missing required command: $1"; exit 1; }
}

copy_tree() {
  local src="$1"
  local dst="$2"
  if [ -d "$src" ]; then
    mkdir -p "$dst"
    rsync -a --delete "$src/" "$dst/"
    return 0
  fi
  return 1
}

mkdir -p "$SNAP"
mkdir -p "$BACKUP_ROOT"
require_cmd rsync
require_cmd find

log "backup start: snapshot=$SNAP"

mkdir -p "$SNAP/openclaw" "$SNAP/homeassistant" "$SNAP/mithril-os" "$SNAP/obsidian" "$SNAP/meta"

if copy_tree "$SRC_OPENCLAW" "$SNAP/openclaw/.openclaw"; then
  log "ok: copied $SRC_OPENCLAW"
else
  log "warn: missing $SRC_OPENCLAW"
fi

if copy_tree "$SRC_HA_CONFIG" "$SNAP/homeassistant/config"; then
  log "ok: copied $SRC_HA_CONFIG"
else
  log "warn: missing $SRC_HA_CONFIG"
fi

if copy_tree "$SRC_MITHRIL" "$SNAP/mithril-os/repo"; then
  log "ok: copied $SRC_MITHRIL"
else
  log "warn: missing $SRC_MITHRIL"
fi

if copy_tree "$SRC_OBSIDIAN_VAULT_PRIMARY" "$SNAP/obsidian/personal-assistant"; then
  log "ok: copied obsidian vault ($SRC_OBSIDIAN_VAULT_PRIMARY)"
elif copy_tree "$SRC_OBSIDIAN_VAULT_FALLBACK" "$SNAP/obsidian/personal-assistant"; then
  log "ok: copied obsidian vault ($SRC_OBSIDIAN_VAULT_FALLBACK)"
else
  log "warn: missing obsidian vault ($SRC_OBSIDIAN_VAULT_PRIMARY | $SRC_OBSIDIAN_VAULT_FALLBACK)"
fi

# Save selected systemd units (best-effort)
mkdir -p "$SNAP/systemd"
for unit in mithril-ops-console.service mithril-ops-console-watcher.service; do
  if [ -f "$SRC_SYSTEMD_DIR/$unit" ]; then
    cp -f "$SRC_SYSTEMD_DIR/$unit" "$SNAP/systemd/$unit"
  fi
done

# Metadata
{
  echo "timestamp_utc=$TIMESTAMP"
  echo "host=$(hostname || true)"
  echo "kernel=$(uname -a || true)"
} > "$SNAP/meta/backup-meta.txt"

if [ -d /mithril-os/.git ]; then
  git -C /mithril-os rev-parse HEAD > "$SNAP/meta/mithril-os-commit.txt" 2>/dev/null || true
  git -C /mithril-os status --short > "$SNAP/meta/mithril-os-status.txt" 2>/dev/null || true
fi

# Checksums (snapshot-local)
(
  cd "$SNAP"
  find . -type f ! -name "sha256sums.txt" -print0 | sort -z | xargs -0 sha256sum > sha256sums.txt
)

ln -sfn "$SNAP" "$LATEST_LINK"

if [ "$MAKE_TARBALLS" = "1" ]; then
  require_cmd tar
  tar -czf "$BACKUP_ROOT/mithril-backup-$TIMESTAMP.tar.gz" -C "$SNAPSHOT_ROOT" "$TIMESTAMP"
  log "ok: tarball created"
fi

# Retention:
# Keep newest KEEP_DAILY snapshots, plus weekly (Sundays) and monthly (1st day) representatives.
mapfile -t snaps < <(find "$SNAPSHOT_ROOT" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort -r)

keep_set_file="$(mktemp)"

# Daily keep
for s in "${snaps[@]:0:$KEEP_DAILY}"; do
  echo "$s" >> "$keep_set_file"
done

# Weekly (first KEEP_WEEKLY Sundays encountered)
weekly_count=0
for s in "${snaps[@]}"; do
  d="${s%%_*}"
  if [ "$(date -u -d "$d" +%u 2>/dev/null || echo 0)" = "7" ]; then
    echo "$s" >> "$keep_set_file"
    weekly_count=$((weekly_count + 1))
    [ "$weekly_count" -ge "$KEEP_WEEKLY" ] && break
  fi
done

# Monthly (first KEEP_MONTHLY snapshots on day 01 encountered)
monthly_count=0
for s in "${snaps[@]}"; do
  d="${s%%_*}"
  day="$(date -u -d "$d" +%d 2>/dev/null || echo 00)"
  if [ "$day" = "01" ]; then
    echo "$s" >> "$keep_set_file"
    monthly_count=$((monthly_count + 1))
    [ "$monthly_count" -ge "$KEEP_MONTHLY" ] && break
  fi
done

sort -u "$keep_set_file" -o "$keep_set_file"

for s in "${snaps[@]}"; do
  if ! grep -qx "$s" "$keep_set_file"; then
    rm -rf "$SNAPSHOT_ROOT/$s"
    log "retention: pruned $s"
  fi
done

rm -f "$keep_set_file"

log "backup done: snapshot=$SNAP"
log "latest => $(readlink -f "$LATEST_LINK" || true)"

{
  log "backup run complete"
  echo
} >> "$HISTORY_LOG"
