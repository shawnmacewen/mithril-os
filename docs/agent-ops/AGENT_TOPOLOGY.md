# Agent Topology (COO + Specialists)

## Objective
Reduce AI drift by combining:
- centralized COO coordination (cross-project decisions)
- specialist agents with narrow project scope and tighter memory

## Roles

### 1) COO (main agent)
- Scope: all projects + cross-cutting operations
- Responsibilities:
  - prioritize work across projects
  - track dependencies/risk
  - own weekly all-project summary
  - maintain global runbooks/checklists

### 2) Mithril Specialist
- Scope: `/mithril-os`
- Responsibilities:
  - Ops Console features, deploy safety, diagnostics, backup UX
  - project-level memory hygiene

### 3) BW-Shell Specialist
- Scope: BW-Shell codebase and parity work
- Responsibilities:
  - feature delivery and verification for BW-Shell
  - maintain BW-Shell project memory + weekly input

### 4) railfin.io Specialist
- Scope: railfin project code and operations
- Responsibilities:
  - project implementation + operational notes
  - maintain railfin memory + weekly input

---

## Shared Memory Contract

### Global (COO-owned)
- `/home/node/.openclaw/workspace/docs/WEEKLY_COO_SUMMARY.md`
- `/home/node/.openclaw/workspace/memory/state/openclaw-runtime.json`

### Project memory files (specialist-owned)
- Mithril: `/home/node/.openclaw/workspace/docs/project-memory/mithril-os.md`
- BW-Shell: `/home/node/.openclaw/workspace/docs/project-memory/bw-shell.md`
- railfin.io: `/home/node/.openclaw/workspace/docs/project-memory/railfin-io.md`

### Weekly input files (specialist -> COO)
- `/home/node/.openclaw/workspace/docs/weekly-inputs/YYYY-WW/<agent>.md`

---

## Operational Workflow

1. Specialist executes project work.
2. Specialist updates project memory file with high-signal changes.
3. Specialist writes weekly input file by Sunday 7pm EST.
4. COO runs 9pm EST centralized weekly summary (all projects).

---

## Anti-Drift Rules

1. Every significant decision is written to file (not chat-only).
2. Every project has one canonical memory file.
3. Weekly summaries must include date range + concrete outputs.
4. COO summary references specialist inputs and global incidents.
5. If context is uncertain, check files first before acting.
