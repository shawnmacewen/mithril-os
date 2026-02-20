# Phase 1 — Routing & Governance

- Default: OddEye (`main`) is COO and routes work.
- Delegation is intentional and outcome-focused.
- **Direct user override is allowed**: Shawn can work with any agent directly.
- Confidence threshold for delegation: `0.7` (configurable).
- Escalation defaults:
  - low confidence => fallback agent
  - missing category => COO
- COO maintains visibility, status integration, and escalation support.

## Routing APIs
- `GET /api/agent-routing`
- `POST /api/agent-routing`
- `POST /api/agent-routing/recommend` (category/confidence/urgent/direct-user override aware)

## Delegation Contract (minimum)
- Objective
- Context/constraints
- Deliverable
- Priority/deadline
- Definition of done
- Escalation rule (optional)
