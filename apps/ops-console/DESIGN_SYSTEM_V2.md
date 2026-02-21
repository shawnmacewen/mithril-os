# Mithril-OS Ops Console — Design System v2.0

This document defines the **v2.0 UI architecture foundation** for Ops Console using a **homegrown CSS system** (no Tailwind).

## Scope

- Token-driven visual language (`design-tokens.css`)
- Reusable, composable primitives (`components.css`)
- In-app design playground (`public/design-system.html`)
- Incremental migration strategy for existing pages

---

## 1) Token taxonomy (v2.0)

Tokens are grouped by purpose and exposed as CSS custom properties.

### Color

- **Core surfaces/text**
  - `--color-bg`, `--color-surface`, `--color-surface-2`, `--color-border`, `--color-text`, `--color-muted`
- **Semantic status**
  - `--color-primary`, `--color-success`, `--color-warning`, `--color-danger`, `--color-info`
- **Stateful surfaces/badges**
  - `--color-surface-success`, `--color-surface-warning`, `--color-surface-danger`, `--color-surface-info`
- **Focus/accessibility**
  - `--color-focus-ring`, `--focus-ring`

### Spacing

- `--space-1` through `--space-10` (4px scale)
- Use spacing tokens for paddings, gaps, and margins; avoid raw px unless required.

### Radius

- `--radius-sm`, `--radius-md`, `--radius-lg`, `--radius-xl`, `--radius-pill`

### Typography

- Family: `--font-family-base`
- Sizes: `--font-size-xs` … `--font-size-2xl`
- Weights: `--font-weight-medium`, `--font-weight-semibold`, `--font-weight-bold`
- Line heights: `--line-height-tight`, `--line-height-base`

### Elevation / motion

- `--shadow-1`, `--shadow-2`, `--shadow-focus`
- `--transition-fast`, `--transition-base`

---

## 2) Component naming conventions

All reusable primitives use `ds-*` prefix.

- **Layout**: `ds-layout-*` (e.g., `ds-layout-split`, `ds-layout-3col`)
- **Containers**: `ds-card`, `ds-panel`, `ds-panel-header`
- **Controls**: `ds-btn`, `ds-input`, `ds-select`, `ds-toolbar`
- **Navigation**: `ds-tabs`, `ds-tab`, `ds-subnav`
- **States**: `ds-state`, `ds-state-empty`, `ds-state-error`, `ds-state-loading`
- **Utilities**: `u-*` (`u-sr-only`, `u-focus-ring`, spacing helpers)

Naming guidance:

1. Prefer **single responsibility** classes.
2. Prefer **modifier classes** (`.is-active`, `.is-sticky`) over ad-hoc duplicates.
3. Keep primitives visual-only; app behavior stays in JS.

---

## 3) Layout primitives (v2)

Primary structural primitives:

- `ds-layout`: centered page wrapper
- `ds-layout-split`: two-column split shell (jobs board / file viewer patterns)
- `ds-layout-3col`: tri-column dashboard blocks
- `ds-section-stack`: vertical section rhythm
- `ds-panel` + `ds-panel-header`: container with title/actions

Responsive behavior:

- Split and 3-col layouts collapse to single-column under tablet breakpoints.
- Toolbars wrap naturally with `flex-wrap`.

---

## 4) Accessibility baseline

v2.0 baseline requirements for all converted UI:

1. **Focus visibility**
   - Interactive controls must expose visible focus using `--focus-ring`.
2. **Keyboard navigability**
   - Primary controls reachable with tab order; no keyboard traps.
3. **Contrast**
   - Body text and UI controls should meet WCAG AA contrast guidance.
   - Status colors should not be sole signal; include labels/icons where possible.
4. **Semantic structure**
   - Use heading hierarchy and table semantics for data grids.
5. **Reduced ambiguity**
   - Loading/empty/error states rendered explicitly with state components.

---

## 5) Migration strategy (incremental)

Do not mass-rewrite. Convert page-by-page with low-risk slices.

### Suggested order

1. **Design System page** (already v2-aligned)
2. **Dashboard** (metric cards + panel headers + state blocks)
3. **Logs** (tabs/subnav + split boards + toolbar)
4. **Agents** (card/shell primitives + file viewer split)
5. **Diagnostics** (toolbars, panel headers, state blocks)
6. **OpenClaw / Models / Watchers / Projects / Policies / Changelog**

### Conversion pattern per page

1. Replace repeated inline styles with `ds-*` primitives.
2. Keep IDs and JS hooks intact.
3. Validate light/dark rendering using tokens.
4. Ship in small PR/commit slices.

---

## 6) Definition of Done (DoD) for page conversion

A page is “v2.0-converted” when:

- [ ] Uses token-driven colors/spacing/radius/typography for new/updated UI
- [ ] Uses shared `ds-*` primitives for repeated patterns
- [ ] Includes explicit loading/empty/error blocks where applicable
- [ ] Preserves existing behavior and API bindings
- [ ] No JS parse/runtime regressions from markup updates
- [ ] Dark/light theme remains functional
- [ ] Basic keyboard focus visibility verified

---

## 7) Files in this foundation release

- `apps/ops-console/public/styles/design-tokens.css`
- `apps/ops-console/public/styles/components.css`
- `apps/ops-console/public/design-system.html`
- `apps/ops-console/public/index.html` (non-breaking integration touchpoint)
- `docs/agent-ops/UI_ARCHITECTURE_V2.md`

