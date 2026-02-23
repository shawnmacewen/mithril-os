# New Agent Checklist

Use this checklist when creating a new specialist agent.

## A) Scope + routing
- [ ] Assign a single primary scope (project-first).
- [ ] Update `/home/node/.openclaw/workspace/docs/agent-ops/AGENT_TOPOLOGY.md` with role and ownership.

## B) Memory bootstrap
- [ ] Ensure project memory file exists:
  - `docs/project-memory/mithril-os.md`
  - `docs/project-memory/bw-shell.md`
  - `docs/project-memory/railfin-io.md`
- [ ] Ensure agent has daily template + long-term memory scaffolding.

## C) Permissions + mounts preflight
- [ ] Run `/home/mini-home-lab/openclaw/oc-agent-preflight.sh`
- [ ] Confirm all required mounts and writable paths are present.

## D) Git baseline
- [ ] Confirm `git ls-remote origin refs/heads/main` works in runtime path.
- [ ] If broken: run `/home/mini-home-lab/openclaw/oc-github-auth-sync.sh`.

## E) Operational validation
- [ ] Agent can read assigned project path.
- [ ] Agent can write and commit in assigned scope (dry run if needed).
- [ ] Agent can produce weekly input file in `docs/weekly-inputs/YYYY-WW/`.

## F) Reporting alignment
- [ ] Agent received weekly input template.
- [ ] Agent knows Sunday reporting deadline.
