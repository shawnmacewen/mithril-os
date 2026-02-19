#!/usr/bin/env bash
set -euo pipefail

sudo cp /mithril-os/systemd/openclaw-usage-collector.service /etc/systemd/system/
sudo cp /mithril-os/systemd/openclaw-usage-collector.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now openclaw-usage-collector.timer
sudo systemctl start openclaw-usage-collector.service
sudo systemctl status openclaw-usage-collector.timer --no-pager -n 20

echo "Installed usage collector."
echo "Telemetry output: /backup/telemetry/openclaw-usage.json"
