# Mithril-OS Agent Ops UI Architecture v2.0

This document defines the cross-page UI architecture baseline for Agent Ops surfaces in Mithril-OS.

## Architecture principles

1. **Token-first styling**: visual decisions originate in shared tokens.
2. **Composable primitives**: UI assembled from reusable `ds-*` classes.
3. **Incremental migration**: pages updated safely without breaking runtime features.
4. **Operational realism**: examples model real ops-console patterns (jobs, delegations, agent/file workflows, status handling).

## Shared UI layers

- **Layer 1: Tokens** — `apps/ops-console/public/styles/design-tokens.css`
- **Layer 2: Primitives** — `apps/ops-console/public/styles/components.css`
- **Layer 3: App Composition** — `apps/ops-console/public/*.html`

## Canonical patterns in v2 foundation

- Tabs/Subnav: `ds-tabs`, `ds-tab`, `ds-subnav`
- Toolbar row: `ds-toolbar`
- Modal shell: `ds-modal`, `ds-modal-header`, `ds-modal-body`, `ds-modal-footer`
- Panel headers: `ds-panel-header`
- Metric cards: `ds-metric-card` (+ `is-success`, `is-warning`, `is-danger`)
- State blocks: `ds-state-empty`, `ds-state-error`, `ds-state-loading`
- Split layouts: `ds-layout-split`, `ds-layout-3col`

## Accessibility baseline (minimum)

- Visible keyboard focus ring on all controls.
- Text and control contrast meets AA intent.
- Color is not the only status signal.
- Explicit loading/empty/error messaging for dynamic content.

## Migration checklist (per page)

- [ ] Inventory repeated one-off styles
- [ ] Map to existing or new `ds-*` primitive
- [ ] Replace incrementally without changing JS selectors/IDs
- [ ] Validate desktop + tablet responsive behavior
- [ ] Validate dark/light theme parity
- [ ] Validate keyboard focus and state messages

## Page rollout order

1. Dashboard
2. Logs
3. Agents
4. Diagnostics
5. Remaining sections (OpenClaw, Models, Watchers, Projects, Policies, Changelog)

## Conversion Definition of Done

- Shared primitives used consistently
- Inline styling reduced to unavoidable edge cases
- Behavior and API interactions unchanged
- No asset path regressions, parse errors, or console-breaking JS exceptions

