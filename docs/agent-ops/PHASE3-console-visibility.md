# Phase 3 — Ops Console Visibility

Added COO hierarchy/delegation visibility in Agents view.

## New API
- `GET /api/agent-control/overview`
  - routing policy summary
  - known agents
  - latest delegations
  - running/blocked counts

## UI updates
- Agents page now displays:
  - COO agent id
  - direct-user override state
  - delegation running/blocked counts
  - recent delegation table
