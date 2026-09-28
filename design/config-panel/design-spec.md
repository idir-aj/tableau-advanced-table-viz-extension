# Config panel — design spec

Reference files in this folder:
- `config-panel.html` + `config-panel.css` + `config-panel.js` — static markup/styles of one representative state (column "Non-quality cost", type Bar, secondary metric open with a custom formula). The JS only toggles CSS classes for visual reference; it is **not** the real app logic.
- Use these as the source of truth for spacing, colors, type scale and component shapes. Everything below is what the static export can't show: state, data flow, and behavior rules.

## 1. Layout

Three-pane master/detail, not a stack of cards:
- **Sidebar (280px)** — list of columns, reorderable, one selected at a time.
- **Detail (flexible, center)** — form for the selected column only.
- **Preview (360px)** — live-updating sample of that column as it will render in the table.

Selecting a column in the sidebar swaps the entire detail pane and preview pane to that column's config. This replaces the previous horizontal-cards layout, which didn't scale past ~3 columns.

## 2. Data model

One JS object per configured column, held in a `columns: Column[]` array plus a `selectedIndex`:

```ts
type ColumnType = 'Text' | 'Hierarchy' | 'Bar' | 'Trend';

interface Column {
  name: string;                 // header label, defaults to the field name
  type: ColumnType;

  // Hierarchy only
  levels: string[];             // field names, 1–6, order = level 1 → N
  expandTo: 'Level 1 only' | 'Down to level 2' | 'Down to level 3' | 'All levels';

  // Bar / Text / Trend
  field: string;                 // main value field
  format: 'Number' | 'Currency';
  decimals: number;              // 0–3
  currency: 'EUR (€)' | 'USD ($)' | 'GBP (£)';  // only used if format = Currency
  scale: 'Auto (K/M)' | 'Thousands (K)' | 'None';

  // Bar only
  color: string;                 // hex
  barScale: 'Per level' | 'Relative to parent' | 'Whole table';

  // Trend only
  compare: boolean;              // show second curve
  field2: string;                // second curve's value field
  label2: string;                // second curve's legend label
  dateField: string;

  // Secondary metric (Bar / Text), variation vs N-1
  sec: boolean;                  // show/hide the badge
  src: 'field' | 'formula';      // where the N-1 comparison value comes from
  compField: string;             // used when src = 'field'
  formula: string;               // used when src = 'formula', e.g. "SUM([non_quality_cost_n_1])"
  calc: 'Absolute variance' | '% variance' | 'Ratio N / N-1';
  secDec: number;                // 0–3
  dir: 'bad' | 'good';           // whether an increase should read as bad (red) or good (green)
}
```

Plus panel-level UI state (not persisted): which of the three collapsible sections (`format`, `sec`, `cond`) are open, and a `dirty` flag.

## 3. Interaction rules

- **Type switch** (Text/Hierarchy/Bar/Trend) changes which sections of the detail pane are shown:
  - `Hierarchy` → shows the **Levels** section only (no Value/Format/Secondary/Conditional sections).
  - `Bar` → Value section includes bar color + bar scale; Format, Secondary metric, Conditional formatting all shown.
  - `Text` → Value section is just the value field; Format, Secondary metric, Conditional formatting shown (no bar color/scale).
  - `Trend` → Value section shows date field + "show second curve" toggle (which reveals second curve field + legend label); no Format/Secondary/Conditional sections.
- **Currency selector** only renders when `format === 'Currency'`.
- **Levels list** (Hierarchy): "Add level" appends a new level (max 6), each row has its own remove button (hidden when only 1 level remains so the list can't go empty). Reordering is drag and drop.
- **Secondary metric**:
  - The "Show variation badge" switch gates the whole sub-section below it.
  - "Compare with" segmented control switches between `field` (a plain dropdown of existing N-1 fields) and `formula` (free text). Only one of the two inputs is shown at a time.
  - The formula textarea is validated live (see §4) and the badge disappears from the preview when the formula is invalid.
  - "How to read the variation" (`dir`) controls badge coloring everywhere the column is rendered: `dir = 'bad'` means a positive delta is red and a negative delta is green; `dir = 'good'` is the inverse. This replaced a raw "Inverted (Red if <, Green if >)" toggle from the original mockup, which was unclear and had a broken label.
- **Collapsible sections** (Format / Secondary metric / Conditional formatting): each header shows a one-line summary of its current settings when collapsed, so the state is visible without opening it. Default open/closed state on first load: Format open, Secondary metric open, Conditional formatting closed.
- **Unsaved changes**: any edit anywhere in the detail pane sets a `dirty` flag, shown as a dot + label in the header. "Save" commits and clears it; "Cancel" discards changes and reverts to last saved state; "Reset to defaults" restores the column's factory defaults (should probably prompt for confirmation — not modeled in the mockup).
- **Remove this column**: removes the column from the array and selects the previous one. Because "Cancel" already provides an undo path within a session, no confirmation dialog was modeled — flag this as a decision point if the real config auto-saves instead of using Save/Cancel.

## 4. Formula validation (for the `formula` field, `src = 'formula'`)

Minimal rules the mockup demonstrates — reimplement against the extension's actual field list, not the hardcoded example list below:

1. Non-empty.
2. Balanced parentheses.
3. At least one field reference in `[brackets]`.
4. Every bracketed reference must be a known field name from the data source.
5. Every function call name (token immediately before `(`) must be in an allow-list of known Tableau functions (accept both English and localized names, e.g. `SUM`/`SOMME`).

Show a single status line below the textarea: a green check + "Valid formula · N field(s) referenced" or a red "!" + the specific reason it failed (unbalanced parens / unknown field `[x]` / unknown function `x()`).

## 5. Preview pane

Renders 3–4 sample rows using the **selected column's current settings** — this is what makes the panel "live": every field change should be reflected here without needing to save. What's rendered depends on `type`:
- `Hierarchy` → indented rows (fixed indent per level, no wrap — ellipsis + tooltip for overflow).
- `Bar` → per row: a fixed-width bar (respecting `barScale`), a fixed-width right-aligned value, and the variation badge if `sec` is on.
- `Text` → same as Bar minus the bar.
- `Trend` → per row: a small sparkline; if `compare` is on, a second grey polyline for `field2`, with a caption noting which field is which.

Formatting a raw number for preview: apply `scale` (K/M or thousands or none) then `decimals`, then prefix/suffix the currency symbol if `format === 'Currency'`. The variation badge's arrow (▲/▼) and color come from the sign of the delta combined with `dir` (§3).

## 6. Accessibility notes carried over from the mockup

- Segmented controls and swatch pickers are `role="group"` with `aria-pressed` per button, not native radios — keep this pattern if Copilot generates equivalent controls elsewhere in the extension.
- Icon-only buttons (drag handle, "…" menu, remove-level "×") need `aria-label`.
- Collapsible section headers use `aria-expanded` on the trigger button.
- Toggle switch uses `role="switch"` + `aria-checked`, not a checkbox styled as a switch.
