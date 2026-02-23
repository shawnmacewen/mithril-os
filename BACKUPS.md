# Mithril Backup Plan

Backups include:
- OpenClaw state: `/home/mini-home-lab/.openclaw`
- Home Assistant config: `/home/mini-home-lab/homelab/homeassistant/config`
- Mithril-OS repo: `/mithril-os`
- BW-Shell repo: `/home/mini-home-lab/.openclaw/workspace/work/bw-shell`
- Railfin repo: `/home/mini-home-lab/work/railfin.io`
- Obsidian vault: `/home/mini-home-lab/.openclaw/workspace/productivity/Personal Assistant`
- Selected systemd unit files

Output root:
- `/backup`
- snapshots: `/backup/snapshots/<UTC timestamp>`
- latest symlink: `/backup/latest`
- run history: `/backup/backup-history.log`

## Install daily backup timer

```bash
/mithril-os/scripts/install-backup-timer.sh
```

## Run backup immediately

```bash
sudo systemctl start mithril-backup.service
sudo journalctl -u mithril-backup.service -n 120 --no-pager
```

## Verify timer

```bash
systemctl list-timers --all | grep mithril-backup
systemctl status mithril-backup.timer --no-pager
```

## Retention defaults

Configured in script via env vars (defaults):
- `KEEP_DAILY=14`
- `KEEP_WEEKLY=8`
- `KEEP_MONTHLY=6`

Optional tarball export:
- `MAKE_TARBALLS=1`

Example one-off with tarball:

```bash
sudo MAKE_TARBALLS=1 /mithril-os/scripts/backup-mithril.sh
```
