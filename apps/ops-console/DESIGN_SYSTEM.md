# Mithril-OS Ops Console Design Infrastructure

> Note: v2.0 foundation is documented in `DESIGN_SYSTEM_V2.md` and `docs/agent-ops/UI_ARCHITECTURE_V2.md`.

This project uses a **Tailwind-free** design infrastructure built from reusable CSS tokens + component classes.

## Files

- `public/styles/design-tokens.css`
  - Color, spacing, radius, typography, and theme tokens.
- `public/styles/components.css`
  - Reusable primitives: cards, buttons, pills, inputs, tables, responsive grids.
- `public/design-system.html`
  - Visual reference page for tokens/components.

## Rules

1. **Use tokens first**
   - Prefer `var(--color-*)`, `var(--space-*)`, `var(--radius-*)`.
2. **Use reusable classes before inline styling**
   - `ds-card`, `ds-btn`, `ds-pill`, `ds-table`, etc.
3. **Avoid one-off styles unless necessary**
   - If repeated twice, move it into `components.css`.
4. **Keep dark/light compatibility**
   - New components should read from tokens only.

## Quick Start

- Open reference: `http://<host>:3001/design-system.html`
- Add new component styles in `public/styles/components.css`.
- Document component usage with a small example in `design-system.html`.

## Initial component set

- Surface/Card: `.ds-card`
- Buttons: `.ds-btn`, `.ds-btn-primary`, `.ds-btn-danger`
- Pills: `.ds-pill`, `.ds-pill-ok`, `.ds-pill-warn`, `.ds-pill-bad`
- Inputs: `.ds-input`, `.ds-select`
- Tables: `.ds-table`
- Layout: `.ds-grid-2`, `.ds-row`, `.ds-layout`
