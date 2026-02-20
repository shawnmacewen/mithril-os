# Phase 5 — Operational Cadence

Completed review-loop automation, routing learnings, and SLA guard behavior.

## API
- `GET /api/delegations/health`
- `POST /api/delegations/review/run`
- `GET /api/delegations/reviews`
- `GET /api/agent-routing/insights`

## What this adds
- Periodic COO review record (blocked, stale-running, urgent-off-COO counts).
- Durable review history in `ops-artifacts/review-log.jsonl`.
- Routing insights generated from outcomes and written to `ops-artifacts/routing-insights.json`.
- SLA-style behavior check: urgent/high active tasks assigned away from COO are flagged for review.

## Automation
- Script: `scripts/run-delegation-review.sh`
- Systemd units:
  - `systemd/mithril-delegation-review.service`
  - `systemd/mithril-delegation-review.timer` (every 30m)
- Installer: `scripts/install-delegation-review-timer.sh`

## Suggested cadence
- Keep timer at 30m during active ops windows.
- Review any blocked/stale/urgent-off-COO alerts at next COO check.
