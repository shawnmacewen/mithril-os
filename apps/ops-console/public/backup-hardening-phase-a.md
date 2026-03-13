# Backup Hardening — Phase A (No-Restart, Low-Risk)

Purpose: improve backup reliability and restore confidence without changing runtime topology.

## Scope (Phase A)
- Read-only verification + documentation hardening
- No gateway restart required
- No compose/path rewiring

## 1) Canonical Layout Verification

Confirm snapshot layout matches restore assumptions:

```bash
SNAP=/backup/latest
for p in \
  "$SNAP/openclaw/.openclaw" \
  "$SNAP/openclaw-stack" \
  "$SNAP/mithril-os/repo" \
  "$SNAP/homeassistant/config" \
  "$SNAP/meta/backup-meta.txt"; do
  [ -e "$p" ] && echo "ok: $p" || echo "missing: $p"
done
```

## 2) Auth Path Guardrail Check

Run the auth-path checker:

```bash
/mithril-os/scripts/check-openclaw-auth-paths.sh
```

Expected:
- Active auth store found
- No nested `.openclaw/.openclaw/...` auth path warning

If nested path warning appears, treat as drift and resolve before next auth operation.

## 3) Retention Mode Confirmation

Retention is temporarily disabled to preserve oldest snapshots.

```bash
grep -n "RETENTION_ENABLED" /mithril-os/scripts/backup-mithril.sh
```

Expected for temporary hold:
- `RETENTION_ENABLED` default `0`

## 4) Offsite Visibility Check (non-disruptive)

```bash
curl -sS http://127.0.0.1:18790/api/backups/status | jq '.offsite'
```

Capture:
- mount readiness
- last sync start/done
- any errors

## 5) Access Baseline (documented)

Current known-good access:
- Primary local UI: `http://127.0.0.1:18790/chat?session=main`
- SSH fallback: `ssh -N -L 62000:127.0.0.1:18790 mini-home-lab@192.168.2.58`
- SSH fallback UI: `http://127.0.0.1:62000/chat?session=main`

## 6) Acceptance Criteria

Phase A is complete when:
- Canonical snapshot layout checks all pass
- Auth path checker passes (or known warning documented with action)
- Retention mode explicitly confirmed
- Offsite status captured and logged
- Access baseline documented and verified

## Out of Scope (Phase B+)

- Retention re-enable tuning
- Automated checksum verification jobs
- Restore drill automation
- Compose/topology changes
