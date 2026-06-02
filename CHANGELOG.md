# Changelog

All notable changes are recorded here. Date format: YYYY-MM-DD.

## [v1.1] — 2026-05-26

### Engine
- `=SPARKLINE(range, [type], [color])` — inline SVG line/bar charts in a single cell
- Row cap raised from 1,000 → 10,000 per sheet
- **Absolute references** — `$A$1`, `$A1`, `A$1` are now tokenized and preserved through fill-handle drags (relative parts shift, absolute parts stay)
- **Fill-handle propagates formulas** — dragging `=A1+B1` down one row produces `=A2+B2` (was just copying the value)
- **Insert / delete row/col rewrites formula text across all sheets** — Excel-style behavior: refs pointing past the change shift; refs pointing AT a deleted row/col become `#REF!`. Cross-sheet refs to the affected sheet shift too. Absolute refs shift on structural ops (unlike fill).
- **Error literals in formulas** — `=#REF!+5`, `=IFERROR(#DIV/0!, 0)` now parse and propagate correctly.
- Right-click no longer triggers left-click logic (no more accidental edit-mode on right-click)
- Fix: the HTML's Store was missing the entire `insertRow`/`deleteRow`/`insertCol`/`deleteCol`/metadata-shift layer (the UI called them but the methods only existed in `src/app-layer.js`). All 9 methods now in both files.

### Charts
- **Chart selection** (Data ▾ → Chart selection…) — bar / line / pie SVG of the active range; auto-detects first-row headers and first-column labels; copy or download as SVG

### Data import
- **JSONL / NDJSON import** — *Import CSV / JSONL* now accepts `.jsonl`, `.log`, `.ndjson` (and content-sniffs other extensions). One JSON object per line maps to one row; the union of keys becomes a bold header row. Common format in robotics, telemetry, and structured log streaming.
- Sample input: `templates/joint-telemetry.jsonl` (25 lines of synthetic 6-DOF joint data with mixed schema — `status` field only on later lines)

### UX
- **Local AI panel** (toolbar **AI** button) — talks to a local [Ollama](https://ollama.com) instance
  - **Text mode**: freeform reply, optionally with current selection as TSV context; insert into active cell or paste as TSV below selection
  - **JSON-patch mode**: model returns `{"A1": "=SUM(B1:B10)", ...}`, panel validates each cell key, previews the patch, applies as a single undoable bulk action

### Templates
- Robot-arm PID damping classifier uses `ABS(C-1)<0.01` for the critical-damping branch (floating-point safe)

### Tests
- 199 unit tests pass (143 engine, 56 store)
- New coverage: edge cases (div/0 propagation, empty-cell coercion, error literals, IFERROR), structural ops (insert/delete row/col rewriting bare and cross-sheet refs, undo round-trip), perf benchmark (1000-row cascade)
- **New `e2e/` browser test harness** (Playwright, dev-only — NOT shipped). 28 specs across render / editing / structural / formulas / persistence / panels run headlessly on Chromium + WebKit. Catches real DOM regressions (SPARKLINE rendering as SVG, fill-handle drag, context-menu actions, AI/chart panels opening, JSONL import header mapping, freeze-pane vertical-scroll column-extend bug) that Node-level tests miss.

## [v1.0] — 2026-05-25

First public release. Single-file local-first spreadsheet, MIT, ~206 KB.

### Engine
- Hand-written tokenizer, recursive-descent parser, AST evaluator
- 80+ functions: math/stats, logical, text, lookup (VLOOKUP/HLOOKUP/INDEX/MATCH/XLOOKUP), conditional aggregates (SUMIF/COUNTIF/etc.), dates, financial (PMT/FV/PV/NPV/IRR), info
- Multi-sheet workbooks (up to 100), cross-sheet references via `Sheet1!A1`
- Dependency graph with topological recalc, cycle detection, error tokens (`#CIRC!`, `#DIV/0!`, `#REF!`, `#NAME?`, `#PARSE!`, `#N/A`, `#NUM!`, `#VALUE!`)
- 145 unit tests pass (98 engine, 47 store)

### Grid & navigation
- 10,000 rows × 702 columns (A–ZZ) per sheet
- Scroll-to-edge auto-extends in 26-col / 50-row chunks
- Editable Name Box (`Ctrl+G`) for direct cell navigation including cross-sheet (`Sheet2!AA10`)
- `Ctrl+Home` / `Ctrl+End` jump to A1 / last cell with data
- Whole row / column / sheet selection from headers, with Shift+click and drag for multi-row/col selection
- Freeze panes (top row, first col, both, at selection) with visible edge line

### Editing
- Range selection (click+drag, Shift+click, Shift+arrows)
- Multi-cell copy/paste as TSV (round-trips with Excel and Google Sheets)
- **Fill handle** — drag the bottom-right corner to extend; detects arithmetic series or repeats
- **Formula reference picking** — click cells while editing a formula to insert refs
- **Auto-pair parentheses** in formulas
- Insert/delete rows and columns
- Column and row resize
- Undo (`Ctrl+Z`) / Redo (`Ctrl+Y` / `Ctrl+Shift+Z`) up to 100 actions

### Formatting
- Bold, Italic, Underline, Strikethrough (`Ctrl+B` / `Ctrl+I` / `Ctrl+U`)
- Font size (9–32 pt), text alignment (L/C/R)
- Wrap text (rows auto-grow)
- Number formats: General, Number, Currency, Percent, Integer, Date (ISO), Date (US)
- Fill color, text color (palette + custom picker)
- Borders (All / Outside / per-side / None)
- Format painter
- **Conditional formatting** (rules: `> N`, `< N`, `=`, `contains`)

### Data
- **Sort** (column A→Z / Z→A; sort range with header option)
- **Filter** (per-column unique-value checklist; multi-column filtering)
- **Data validation lists** (right-click → Set list values → dropdown picker on cell)
- **Named ranges** (`Names…` toolbar dialog; usable in formulas: `=SUM(Revenue)`)
- **Cell notes** (red triangle indicator + hover popup)
- **Tables / Lists** (`Ctrl+L` or `Ctrl+T`) — auto-detects contiguous range, styled header with ▾ filter chip, zebra stripes
- **Merge cells** (right-click or Data ▾)

### Files
- Save / load as `.localsheet.json` (sparse JSON, human-readable, git-diffable)
- File System Access API in Chrome/Edge (in-place save); download fallback elsewhere
- Import CSV / Export CSV
- v1.0 (single-sheet) files auto-migrate to v2.0 (multi-sheet)
- Unsaved-changes dot + `beforeunload` warning

### UX
- Find / Replace / Find All (`Ctrl+F`) — current sheet or all sheets, case-sensitive option, clickable results list
- Theme toggle (Light / Dark / Auto, remembered)
- Right-click context menu (cells, column headers, tabs)
- Help overlay (`?`)
- Multi-sheet tab bar with rename, duplicate, move, delete

### Templates (in `templates/`)

Personal finance:
- Monthly Budget
- RSU Vest Tracker (multi-sheet: Inputs + Vesting)
- Startup Burn Rate
- Rental Cash Flow
- Kids Allowance Tracker
- Mortgage Calculator

Edge / Robotics:
- Robot Arm PID Calibration (multi-sheet: Joints + Computed — per-joint Kp/Ki/Kd → natural freq, damping ratio, settling time)
