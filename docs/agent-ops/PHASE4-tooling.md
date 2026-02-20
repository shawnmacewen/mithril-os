# Phase 4 — Delegation Tooling

Added lightweight tooling for COO-led delegation execution.

## API
- `GET /api/delegation-template`

## Files
- `templates/delegation-contract.json` — standard delegation contract payload.
- `scripts/delegate-task.sh` — helper to enqueue delegated task via Ops Console API.

## Intent
- standardize delegation inputs
- reduce malformed handoffs
- make delegation scriptable and auditable
