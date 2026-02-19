# Mithril-OS Ops Console (Phase 1)

Phase 1.4 delivers:
- Agents nav moved near top for faster access
- Agents page includes Current Agent tile (OddEye + active model)
- Raw agents JSON is now collapsible
- Full light/dark theme support (dark default)
- Theme toggle in left nav (bottom), applies app-wide
- Nav menu icons added
- Golden highlight accents across panels

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
