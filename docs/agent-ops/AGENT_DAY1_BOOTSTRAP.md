# Agent Day-1 Bootstrap

Use this on every new specialist agent before first task.

## 1) Canonical environment
- OpenClaw compose project: `/home/mini-home-lab/openclaw`
- OpenClaw data/workspace: `/home/mini-home-lab/.openclaw`
- Mithril-OS repo: `/mithril-os`
- BW-Shell path: `/work/bw-shell`
- railfin.io path: `/work/railfin.io`
- Home Assistant config path: `/homeassistant/config`

## 2) Required read files (first session)
- `/home/node/.openclaw/workspace/SOUL.md`
- `/home/node/.openclaw/workspace/USER.md`
- `/home/node/.openclaw/workspace/docs/agent-ops/AGENT_TOPOLOGY.md`
- Project memory for assigned scope:
  - Mithril: `/home/node/.openclaw/workspace/docs/project-memory/mithril-os.md`
  - BW-Shell: `/home/node/.openclaw/workspace/docs/project-memory/bw-shell.md`
  - railfin: `/home/node/.openclaw/workspace/docs/project-memory/railfin-io.md`

## 3) Behavioral requirements
- Write decisions to files; do not rely on chat-only memory.
- Keep user-facing updates concise and low-noise.
- Report implementation outcome: changed / committed / pushed / deployed / verified.
- If blocked, report exact blocker + next best action.

## 4) Git/Auth baseline
- Git credential helper should use: `/home/node/.openclaw/.git-credentials`
- If auth breaks after recreate: run `/home/mini-home-lab/openclaw/oc-github-auth-sync.sh`

## 5) Weekly reporting contract
- Weekly agent inputs path: `/home/node/.openclaw/workspace/docs/weekly-inputs/YYYY-WW/<agent>.md`
- Template: `/home/node/.openclaw/workspace/skills/weekly-reporting-coo/references/agent-input-template.md`
- Deadline: before Sunday 9:00 PM America/New_York
