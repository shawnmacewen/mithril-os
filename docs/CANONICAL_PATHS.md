# Canonical Paths (mini-home-lab)

Use these as source-of-truth paths for host operations.

## Core
- OpenClaw compose project: `/home/mini-home-lab/openclaw`
- OpenClaw data/config/workspace: `/home/mini-home-lab/.openclaw`
- Mithril-OS live repo: `/mithril-os`
- Ops Console app: `/mithril-os/apps/ops-console`

## Project Repos
- BW-Shell: `/home/mini-home-lab/.openclaw/workspace/work/bw-shell`
- Railfin: `/home/mini-home-lab/work/railfin.io`

## Home Assistant
- Config: `/home/mini-home-lab/homelab/homeassistant/config`

## Productivity
- Obsidian vault: `/home/mini-home-lab/.openclaw/workspace/productivity/Personal Assistant`

## Synology Offsite (SMB mode)
- Mount point on host: `/mnt/synology_backup`
- Offsite backup root inside mount: `/mnt/synology_backup/backups`
- Expected per-domain targets:
  - `/mnt/synology_backup/backups/openclaw`
  - `/mnt/synology_backup/backups/mithril-os`
  - `/mnt/synology_backup/backups/bw-shell`
  - `/mnt/synology_backup/backups/railfin-io`
  - `/mnt/synology_backup/backups/homeassistant`
  - `/mnt/synology_backup/backups/productivity-vault`

## Discipline Rules
1. Prefer `/home/mini-home-lab/...` for host-run commands.
2. Treat `/home/node/...` paths as container/runtime-scoped unless explicitly mounted.
3. Before destructive/long-running tasks, verify path existence:
   - `test -d <path> && echo ok || echo missing`
4. Keep scripts/docs aligned with this file when paths change.
