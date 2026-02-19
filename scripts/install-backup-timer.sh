#!/usr/bin/env bash
set -euo pipefail

SERVICE_SRC="/mithril-os/systemd/mithril-backup.service"
TIMER_SRC="/mithril-os/systemd/mithril-backup.timer"
SERVICE_DST="/etc/systemd/system/mithril-backup.service"
TIMER_DST="/etc/systemd/system/mithril-backup.timer"

sudo mkdir -p /backup/snapshots
sudo cp "$SERVICE_SRC" "$SERVICE_DST"
sudo cp "$TIMER_SRC" "$TIMER_DST"
sudo systemctl daemon-reload
sudo systemctl enable --now mithril-backup.timer
sudo systemctl status mithril-backup.timer --no-pager -n 20

echo
echo "Backup timer installed."
echo "Manual run: sudo systemctl start mithril-backup.service"
echo "Watch logs:  sudo journalctl -u mithril-backup.service -n 80 --no-pager"
echo "Backups root: /backup"
