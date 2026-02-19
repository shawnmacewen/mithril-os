#!/usr/bin/env bash
set -euo pipefail

SERVICE_SRC="/mithril-os/systemd/mithril-ops-console.service"
SERVICE_DST="/etc/systemd/system/mithril-ops-console.service"

if [ ! -f "$SERVICE_SRC" ]; then
  echo "Missing service file: $SERVICE_SRC"
  exit 1
fi

sudo cp "$SERVICE_SRC" "$SERVICE_DST"
sudo systemctl daemon-reload
sudo systemctl enable --now mithril-ops-console.service
sudo systemctl restart mithril-ops-console.service
sudo systemctl status mithril-ops-console.service --no-pager -n 30

echo "Ops Console service installed and running."
echo "URL: http://192.168.2.58:3001"
