#!/usr/bin/env bash
set -euo pipefail

# Offsite sync to Synology (or any rsync-over-SSH target)
# Usage:
#   SYN_HOST=192.168.2.10 SYN_USER=ocbackup SYN_ROOT=/volume1/backups /mithril-os/scripts/backup-offsite-synology.sh

SYN_HOST="${SYN_HOST:-}"
SYN_USER="${SYN_USER:-}"
SYN_ROOT="${SYN_ROOT:-/volume1/backups}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519_synology}"
SSH_PORT="${SSH_PORT:-22}"
RSYNC_FLAGS="${RSYNC_FLAGS:--aHAX --delete}"

if [[ -z "$SYN_HOST" || -z "$SYN_USER" ]]; then
  echo "SYN_HOST and SYN_USER are required" >&2
  exit 2
fi

SSH_OPTS=(-p "$SSH_PORT")
if [[ -f "$SSH_KEY" ]]; then
  SSH_OPTS+=(-i "$SSH_KEY")
fi
SSH_OPTS+=(-o BatchMode=yes -o StrictHostKeyChecking=accept-new)
SSH_CMD="ssh ${SSH_OPTS[*]}"

log(){ echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"; }

sync_one(){
  local src="$1"
  local dst="$2"
  if [[ ! -d "$src" ]]; then
    log "warn: missing source $src"
    return 0
  fi
  log "sync: $src -> $dst"
  rsync $RSYNC_FLAGS -e "$SSH_CMD" "$src/" "$SYN_USER@$SYN_HOST:$dst/latest/"
  log "ok: $dst"
}

log "offsite sync start: host=$SYN_HOST root=$SYN_ROOT"

# Ensure destination roots exist
$SSH_CMD "$SYN_USER@$SYN_HOST" "mkdir -p \
  '$SYN_ROOT/openclaw' \
  '$SYN_ROOT/mithril-os' \
  '$SYN_ROOT/bw-shell' \
  '$SYN_ROOT/railfin-io' \
  '$SYN_ROOT/homeassistant' \
  '$SYN_ROOT/productivity-vault'"

sync_one "/home/mini-home-lab/.openclaw" "$SYN_ROOT/openclaw"
sync_one "/mithril-os" "$SYN_ROOT/mithril-os"
sync_one "/home/mini-home-lab/work/bw-shell" "$SYN_ROOT/bw-shell"
sync_one "/home/mini-home-lab/work/railfin.io" "$SYN_ROOT/railfin-io"
sync_one "/home/mini-home-lab/homelab/homeassistant/config" "$SYN_ROOT/homeassistant"
sync_one "/home/node/.openclaw/workspace/productivity/Personal Assistant" "$SYN_ROOT/productivity-vault"

log "offsite sync done"
