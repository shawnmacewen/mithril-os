# Mithril-OS Ops Console (Phase 1)

Phase 1.2 delivers:
- Left-hand navigation shell with sections
- Dashboard page (OpenClaw + HA + Docker status)
- Watchers page (running/systemd/interval/last update table)
- OpenClaw overview page
- Agents page (bindings-based)
- Models page (primary model + connected auth profiles)
- Home Assistant status page
- Gateway logs page

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
