# Mithril-OS Design System — Component Inventory

Scope: `apps/ops-console/public/assets/css/{tokens,layouts,components}.css`

Last reviewed: 2026-02-21

## 1) Foundations

### Theme Tokens (`tokens.css`)
- Color surface/background/text tokens
  - `--bg`, `--panel`, `--panel-2`, `--border`, `--text`, `--muted`
- Semantic status/accent tokens
  - `--ok`, `--bad`, `--highlight`, `--nav-text`
- Theme variants
  - Dark default on `:root`
  - Light theme override on `:root[data-theme="light"]`

## 2) Layout Primitives (`layouts.css`)

- App shell
  - `.layout`, `.layout.nav-collapsed`
  - `.main`
- Navigation shell
  - `.nav`, `.nav-links`, `.brand`, `.brand-icon`, `.brand-text`
  - `.nav a`, `.nav a.active`, `.nav-icon`
  - per-view nav icon color hooks via `a[data-view="..."] .nav-icon`
- Collapsed-nav behaviors
  - `.layout.nav-collapsed ...` variants
- Background/parallax
  - `.bg-parallax`, `.bg-layer`, `.bg-layer.far|mid|near`

## 3) Core Components (`components.css`)

### Container + Structure
- `.cards` (responsive card grid)
- `.card` (panel shell)
- `.toolbar`
- `.row`
- `.grid2`
- `.hidden`

### Typography / Utility
- `.muted`
- `.ok`, `.bad`

### Inputs / Controls
- `button`, `button.danger`
- `input`, `select`
- `pre`
- `table`, `th`, `td`
- `.clickable-row`

### Metrics + Status
- `.metric-grid`, `.metric-card`, `.metric-label`, `.metric-value`
- `.active-badge`, `.inactive-badge`
- `.status-pill`, `.status-pill.ok|warn|bad`
- `.queue-badges`, `.spark`
- `.pill`, `.pill.ok|bad`

### Home Assistant Specific
- `#view-homeassistant` skin override
- `#view-homeassistant .card`
- `#view-homeassistant h2/h3/strong/.muted/li`
- `.ha-item`, `.ha-item-top`, `.ha-actions`

### Agents Specific
- `.agent-tile`, `.avatar`
- `.agent-file-buttons`, `.agent-file-row`
- `.agent-tiles-grid`, `.agent-tile-card`, `.agent-tile-top`

### Theme Toggle
- `.theme-wrap`, `.switch-row`
- `.switch`, `.slider`
- collapsed-state label hiding hooks

## 4) Current Gaps / Follow-ups

1. Move remaining element selectors (`button`, `input`, `table`, etc.) to a `base.css` layer.
2. Replace repeated inline style attributes in HTML with class utilities.
3. Normalize naming (`.ok/.bad` utilities vs semantic variants).
4. Add motion tokens and focus-visible standards for accessibility.
5. Add a component usage page (visual reference) under `docs/design-system/`.

## 5) Suggested Next Files

- `apps/ops-console/public/assets/css/base.css`
- `apps/ops-console/public/assets/css/utilities.css`
- `docs/design-system/component-specs.md`
- `docs/design-system/accessibility-baseline.md`
