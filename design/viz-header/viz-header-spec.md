# Viz — toolbar and header spec

Reference files in this folder:
- `viz-header.html` + `viz-header.css` — static markup/styles of the table shell: toolbar, column headers (sort, filter, drag handle, resize handle) and a few sample rows. Source of truth for spacing, colors and component shapes.
- `viz-header.js` — vanilla JS demonstrating the interaction states (sort cycling, filter open/close, drag-to-reorder, drag-to-resize) purely visually. **Not** the real logic — the real app must reorder/resize the actual column model and re-render every row, not just move DOM/CSS.
- `design-spec.md` (same folder) — the earlier spec for the column **configuration panel**. This file only covers the **read view** of the table once that panel is closed: the toolbar and the column headers above the data.

This replaces the original two-corner layout (a floating download icon top-left, a floating gear icon top-right, each in its own box) with a single toolbar bar that sits directly above the table.

## 1. Toolbar

One row, full width, above the table:
- **Left**: an "Export" button (icon + label). It currently has no dropdown in the design — clicking it should trigger the export directly, or open a menu, depending on how many export formats the extension ends up supporting; that's an implementation decision, not fixed by this mockup.
- **Right**: a "Configure columns" button (gear icon + label) that opens the column configuration panel (see `design-spec.md`). It gets an active/pressed visual state (`accent-soft` background, `accent` text and border) while that panel is open, so the user can see which mode they're in.
- An optional `mode-help` text slot next to the configure button, for a short status message (e.g. "Editing — only visible to you") — shown only while the config panel is open.

## 2. Column header — anatomy

Each column header (`.col-header`) stacks three things:
1. **Header row** (40px): drag handle (⠿) · column name (click = cycle sort) · filter icon (if filterable).
2. **Filter panel** (only when open): either a text search input, or a numeric range slider — see §4.
3. **Resize handle**: an invisible 6px-wide strip on the right edge, `cursor: col-resize`.

### Sort
Clicking the column name cycles: `none → ascending → descending → none`. The sort icon is a chevron that:
- is light grey (`--text-hairline`) and upright when inactive,
- turns `--accent` (green) when the column is the active sort,
- rotates 180° for descending.

Only one column sorts at a time in this design (clicking a different column's name should reset the previous one) — not shown in the static mockup, but implied by "which column is sorted" being a single piece of state, not per-column.

### Filter
The funnel icon toggles the filter panel open/closed per column. Its background goes to `--accent-soft` and its stroke to `--accent` when the panel is open **or** a filter is actually active (so a closed-but-filtered column still reads as "filtered"). The "12-month trend" column has no filter icon at all — it isn't filterable.

## 3. Column reorder (drag and drop)

The ⠿ handle at the left of each header is `draggable="true"`. Drag it onto another column's header to swap position. In the real implementation:
- Track column **order** as an array of column keys (identity), separate from the columns' own definitions (name, type, field, etc. — those don't change when a column moves).
- Every render (header row **and** every data row) must iterate columns in that order array — not in a hardcoded left-to-right sequence — so a row's cells visually follow their header.
- Border-right on the last column in the current order should be dropped (no trailing border), which means "is this the last column" is computed per-render from the order array, not hardcoded per column.

## 4. Column resize (drag handle)

The thin strip on the right edge of each header is a mousedown target: dragging it left/right changes that column's width, live, by writing to a `grid-template-columns` value on the table's outer grid container — e.g. `300px 260px 220px 240px`. Each column's width is independent state (a map of column key → px), with a sane minimum (120px in the reference JS) so a column can't be dragged to zero. Widths persist per column even if the column is reordered (identity-based, not position-based), same reasoning as §3.

## 5. Filter panel — two kinds

- **Text** (hierarchy/dimension columns): a single search input, placeholder "Enter filter value".
- **Numeric range** (any measure column — cost, quantity, etc.): a dual-handle slider plus two editable number inputs above it (min / max), all three kept in sync:
  - Dragging either slider thumb updates the corresponding number input and the filled track between them.
  - Typing in a number input updates the corresponding thumb position.
  - A thin formatted label pair under the slider shows the current bounds in the column's own format (e.g. "0 €" / "15,3 M€" for currency, plain thousands-separated integers for a count) — never the raw unformatted number.
  - The slider's absolute min/max come from the actual data range for that field, not from the current filter selection.

This replaces the earlier design, which showed a single free-text "Enter filter value" box on every column regardless of its data type — including numeric ones, which is what motivated the split.

## 6. Data cells (per column type)

Cells render in the current column order (§3), one of three kinds:
- **Hierarchy**: an indented label (indent = `14 + depth * 18` px) with an expand/collapse caret (▾ expanded / ▸ collapsed) at every level, ellipsis + no wrap for long labels. The root level is bold/dark text; child levels are the link color (`--link`), matching the sport-hierarchy drill-down pattern.
- **Bar** (a measure with a bar encoding): a fixed-width mini bar (its fill % relative to the column's max value in the current row set), then a fixed-width right-aligned formatted value, then an optional variation badge (▲/▼, colored bad/good per the column's "increase is bad/good" setting from the config panel).
- **Trend** a small dual-line sparkline (current period solid, prior period faint grey). Every point of the current period is marked with a small filled circle (r 1.6px), not just the last one — this makes month-to-month variability readable at this size and gives a natural hover/click target per point for a future tooltip. The last point is marked larger (r 2.5px) to keep it as the "current" anchor. The prior-period (grey) line stays unmarked, to avoid doubling the visual noise. No axis or label clutter otherwise.

All three share the same 40px row height and the same right/bottom hairline borders (`--row-border`), so mixed column types stay visually aligned as a grid.
