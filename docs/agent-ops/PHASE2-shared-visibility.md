# Phase 2 — Shared Visibility & Workspace

Completed shared visibility foundation with memory split mapping + standardized coordination outputs.

- Shared workspace: `/mithril-os/ops-artifacts`
- Delegation log: `/mithril-os/ops-artifacts/delegations.jsonl`
- Coordination log: `/mithril-os/ops-artifacts/coordination-log.jsonl`

## API
- `GET /api/delegations`
- `POST /api/delegations`
- `POST /api/delegations/:id/status`
- `GET /api/coordination/overview`

## Memory split
- Agent-local memory remains under each agent workspace (`MEMORY.md` + `memory/YYYY-MM-DD.md`).
- Shared operational state is written to `ops-artifacts` logs.

## Standard output envelope
Status updates for `done | blocked | needs-review` now require:
- `summary` (required)
- `evidence` (array)
- `nextActions` (array)

Envelope template: `templates/delegation-output-envelope.json`
