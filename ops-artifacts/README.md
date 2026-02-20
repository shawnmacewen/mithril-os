# Ops Artifacts (Shared)

Shared cross-agent workspace for coordination artifacts.

Files:
- `delegations.jsonl` — append-only delegation events/status updates.
- `coordination-log.jsonl` — standardized cross-agent output envelopes (summary/evidence/next-actions).
- `handoffs/` (optional) — large handoff bundles per task.

Principles:
- Keep durable operational trace, avoid secrets.
- COO (OddEye/main) owns synthesis and final reporting.
