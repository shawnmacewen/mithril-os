#!/usr/bin/env bash
set -euo pipefail

sudo cp /mithril-os/systemd/mithril-delegation-review.service /etc/systemd/system/
sudo cp /mithril-os/systemd/mithril-delegation-review.timer /etc/systemd/system/
sudo chmod +x /mithril-os/scripts/run-delegation-review.sh
sudo systemctl daemon-reload
sudo systemctl enable --now mithril-delegation-review.timer
sudo systemctl start mithril-delegation-review.service
sudo systemctl status mithril-delegation-review.timer --no-pager -n 20

echo "Installed delegation review cadence timer."
echo "Review logs: /mithril-os/ops-artifacts/review-log.jsonl"
