# Phase 3 — Ops Console Visibility

Completed COO hierarchy/delegation visibility in Agents view.

## API
- `GET /api/agent-control/overview`
  - routing policy summary
  - known agents
  - latest delegation queue state
  - running/blocked counts
  - per-agent current activity snapshot
  - grouped delegation timeline
  - blocker summary

## UI updates
- Agents page now displays:
  - hierarchy card (COO + direct override + queue counts)
  - role badges on agent tiles (COO vs specialist)
  - delegated task queue table
  - **What each agent is doing now** table
  - delegation timeline table with handoff state progression
