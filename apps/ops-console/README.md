# Mithril-OS Ops Console (Phase 1)

Phase 1.3 delivers:
- Watchers page with per-row controls (start/stop/restart)
- Service Health table
- Logs UX: level filter, text filter, auto-refresh, copy
- Config diagnostics panel
- Quick Actions panel
- Audit trail widget (branch/remote/last commit)

## Run

```bash
cd /mithril-os/apps/ops-console
npm install
cp .env.example .env
# edit .env with HA token
npm run dev
```

Open:
- http://<mini-pc-ip>:3001

## Notes

- `OPENCLAW_CONFIG` should point to your host OpenClaw config path.
- `HA_TOKEN` is required for Home Assistant API checks.

## Host service (systemd)

To keep the Ops Console available on LAN after reboot:

```bash
/mithril-os/scripts/install-ops-console-service.sh
```

Service unit source:
- `/mithril-os/systemd/mithril-ops-console.service`
