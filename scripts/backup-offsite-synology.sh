#!/usr/bin/env bash
set -euo pipefail

# Offsite sync to Synology with two modes:
# - MODE=ssh (default): rsync-over-ssh to Synology host/path
# - MODE=smb: local rsync into mounted SMB path
#
# SSH usage:
#   MODE=ssh SYN_HOST=192.168.2.54 SYN_USER=svc_sync SYN_ROOT=/volume1/backups /mithril-os/scripts/backup-offsite-synology.sh
#
# SMB usage:
#   MODE=smb SMB_MOUNT=/mnt/synology_backup SMB_ROOT=backups /mithril-os/scripts/backup-offsite-synology.sh

MODE="${MODE:-ssh}"

SYN_HOST="${SYN_HOST:-}"
SYN_USER="${SYN_USER:-}"
SYN_ROOT="${SYN_ROOT:-/volume1/backups}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519_synology}"
SSH_PORT="${SSH_PORT:-22}"

SMB_MOUNT="${SMB_MOUNT:-/mnt/synology_backup}"
SMB_ROOT="${SMB_ROOT:-backups}"

RSYNC_FLAGS="${RSYNC_FLAGS:--aHAX --delete}"
# SMB/CIFS targets often don't support Linux symlinks/ACL/xattrs.
# Use copy-links so symlinked files are copied as regular files.
RSYNC_FLAGS_SMB="${RSYNC_FLAGS_SMB:--aH --delete --copy-links}"

log(){ echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"; }

sync_one_local(){
  local src="$1"
  local dst="$2"
  if [[ ! -d "$src" ]]; then
    log "warn: missing source $src"
    return 0
  fi
  mkdir -p "$dst/latest"
  log "sync: $src -> $dst"
  rsync $RSYNC_FLAGS_SMB "$src/" "$dst/latest/"
  log "ok: $dst"
}

if [[ "$MODE" == "ssh" ]]; then
  if [[ -z "$SYN_HOST" || -z "$SYN_USER" ]]; then
    echo "SYN_HOST and SYN_USER are required for MODE=ssh" >&2
    exit 2
  fi

  SSH_OPTS=(-p "$SSH_PORT")
  if [[ -f "$SSH_KEY" ]]; then
    SSH_OPTS+=(-i "$SSH_KEY")
  fi
  SSH_OPTS+=(-o BatchMode=yes -o StrictHostKeyChecking=accept-new)
  SSH_CMD="ssh ${SSH_OPTS[*]}"

  sync_one_ssh(){
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

  log "offsite sync start (ssh): host=$SYN_HOST root=$SYN_ROOT"
  $SSH_CMD "$SYN_USER@$SYN_HOST" "mkdir -p \
    '$SYN_ROOT/openclaw' \
    '$SYN_ROOT/mithril-os' \
    '$SYN_ROOT/bw-shell' \
    '$SYN_ROOT/railfin-io' \
    '$SYN_ROOT/homeassistant' \
    '$SYN_ROOT/productivity-vault'"

  sync_one_ssh "/home/mini-home-lab/.openclaw" "$SYN_ROOT/openclaw"
  sync_one_ssh "/mithril-os" "$SYN_ROOT/mithril-os"
  sync_one_ssh "/home/mini-home-lab/work/bw-shell" "$SYN_ROOT/bw-shell"
  sync_one_ssh "/home/mini-home-lab/work/railfin.io" "$SYN_ROOT/railfin-io"
  sync_one_ssh "/home/mini-home-lab/homelab/homeassistant/config" "$SYN_ROOT/homeassistant"
  sync_one_ssh "/home/mini-home-lab/.openclaw/workspace/productivity/Personal Assistant" "$SYN_ROOT/productivity-vault"

elif [[ "$MODE" == "smb" ]]; then
  if [[ ! -d "$SMB_MOUNT" ]]; then
    echo "SMB_MOUNT not found: $SMB_MOUNT" >&2
    exit 2
  fi

  BASE="$SMB_MOUNT/$SMB_ROOT"
  log "offsite sync start (smb): mount=$SMB_MOUNT root=$BASE"

  sync_one_local "/home/mini-home-lab/.openclaw" "$BASE/openclaw"
  sync_one_local "/mithril-os" "$BASE/mithril-os"
  sync_one_local "/home/mini-home-lab/work/bw-shell" "$BASE/bw-shell"
  sync_one_local "/home/mini-home-lab/work/railfin.io" "$BASE/railfin-io"
  sync_one_local "/home/mini-home-lab/homelab/homeassistant/config" "$BASE/homeassistant"
  sync_one_local "/home/mini-home-lab/.openclaw/workspace/productivity/Personal Assistant" "$BASE/productivity-vault"

else
  echo "Unsupported MODE=$MODE (use ssh or smb)" >&2
  exit 2
fi

log "offsite sync done"
