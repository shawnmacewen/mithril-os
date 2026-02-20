# Phase 4 — Delegation Tooling

Added delegation control-plane support and guardrails for COO-led execution.

## API
- `GET /api/delegation-template`
- `POST /api/delegations/control/spawn` (sessions_spawn wrapper)
- `GET /api/delegations/control/subagents` (inspect)
- `POST /api/delegations/control/steer`
- `POST /api/delegations/control/kill`

## Guardrails (enforced at `POST /api/delegations`)
- Duplicate loop prevention: blocks same objective + same assignee while active.
- Single-owner enforcement: blocks same objective assigned to a different active assignee.
- Parallel exception: pass `allowParallel=true` to bypass with explicit intent.

## Files
- `templates/delegation-contract.json` — standard delegation contract payload.
- `scripts/delegate-task.sh` — helper to enqueue delegated task via Ops Console API.

## Intent
- standardize delegation inputs
- reduce malformed handoffs
- make delegation scriptable and auditable
- provide a control plane for spawn/steer/inspect/kill operations
