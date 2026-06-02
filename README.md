# LocalSheets

A single-file, local-first, multi-sheet spreadsheet.

No accounts. No cloud. No subscription. No analytics. No tracking. One HTML file.

MIT licensed. Your data stays in a plain JSON file on your disk.

Part of the LocalOffice suite, alongside
[DeckBuilder](https://github.com/zohaibus/deckbuilder) and
[Context Protocol](https://github.com/zohaibus/context-protocol).

---

**The local AI reading the budget and flagging every over-budget row, applied as one undoable patch:**
<img width="1280" height="720" alt="LocalSheets local AI flagging over-budget rows in the budget template" src="https://github.com/user-attachments/assets/9bf1db60-5d68-4881-aefd-cb9ad7298850" />

**Change one gain on the Joints sheet and the Computed sheet recomputes damping ratio, settling time, and class live. Here, J2 tunes from underdamped to critically damped:**
<img width="1280" height="720" alt="LocalSheets recomputing a 6-DOF PID calibration as a joint gain changes" src="https://github.com/user-attachments/assets/bfa048e9-4aa9-4d60-b274-ef67689e3848" />


## Why LocalSheets feels different

Most spreadsheet tools want your data on their servers, your access behind their login, your money in their subscription, and your workflow locked into their format.

LocalSheets assumes the opposite: **software disappears, but files persist.**

- **No cloud.** No accounts. No telemetry. The app is a single HTML file you open from disk.
- **No vendor format.** Workbooks are plain JSON: `git diff` works on them, you can edit one in a text editor, and the schema is short enough to read in five minutes.
- **No dependencies.** Zero npm packages, zero CDN calls, zero embedded fonts. The whole product is one ~260 KB file; mirror it, fork it, archive it, run it on an air-gapped laptop in 2046.
- **MIT.** Use it, modify it, ship it inside your own product. No callbacks home.

### Provable zero-leak

The repo contains a network-surface audit you can re-run. Every potential outbound channel in `localsheets.html`:

| Surface | Count | Notes |
|---|---|---|
| `fetch(...)` | 2 | Both to `http://localhost:11434` (Ollama), only fired when you click **AI** in the toolbar |
| `XMLHttpRequest` | 0 | |
| `WebSocket` / `EventSource` | 0 | |
| `navigator.sendBeacon` | 0 | |
| Dynamic `import(...)` | 0 | |
| `<script src=>` / `<link rel=...>` to external | 0 | The one `<link>` is a `data:` URI favicon |
| `<img src=>` / `<iframe>` | 0 | |
| CSS `url(http*)` / `@import` | 0 | |

The AI panel is the only outbound call. Don't click it (or don't run Ollama) and the app is fully airgapped.

### Verify it yourself (60 seconds)

Don't take this on faith. Run these two commands against the file you downloaded:

```bash
# 1. Network surface: should print exactly 2 lines, both fetches to localhost:11434
grep -nE 'fetch\(|XMLHttpRequest|WebSocket|sendBeacon' localsheets.html   # Linux / macOS / Git Bash
Select-String -Path .\localsheets.html -Pattern "fetch\(", "XMLHttpRequest", "WebSocket", "sendBeacon"  # Windows PowerShell
```

Expected output (line numbers will match the version you downloaded):
```
5494:      const res = await fetch(this.host + '/api/tags', { method: 'GET' });
5594:      const res = await fetch(this.host + '/api/generate', {
```

`this.host` is a hard-coded `const 'http://localhost:11434'` (see `const AI = {` near the top of the AI section). There is no `let`, no DOM input, no env var that can override it.

```bash
# 2. Integrity: confirm the file you have is the file the maintainer audited
sha256sum localsheets.html      # Linux / Git Bash on Windows
shasum -a 256 localsheets.html  # macOS
```

Compare with the SHA-256 published on the [GitHub Releases page](https://github.com/zohaibus/localsheets/releases) for the version you downloaded. If they match, the file you have is the file that was audited. If they don't, don't run it.

This is the design that lets the same workbook hold a household budget and a 6-DOF robot-arm PID calibration, because the engine is just files and formulas.

---

## Features in v1.1

### New in v1.1
- **Charts:** *Data ▾ → Chart selection…* renders a bar / line / pie SVG of the selected range, with copy + download
- **`=SPARKLINE(range, [type], [color])`:** inline SVG line or bar chart inside a single cell
- **Absolute references:** `$A$1`, `$A1`, `A$1` are tokenized and honored by the fill handle
- **Insert / delete row or column auto-rewrites formula text:** including cross-sheet refs. Refs to a deleted row become `#REF!`; refs past it shift up. Same for columns.
- **Fill-handle propagates formulas:** dragging `=A1+B1` down one row produces `=A2+B2` instead of copying the value
- **Local AI panel** (toolbar **AI**): talks to a local [Ollama](https://ollama.com) instance, with two modes: freeform text reply or structured JSON-patch mutations
- **JSONL / NDJSON import:** drop a `.jsonl` or `.log` file (one JSON object per line, common in robotics/telemetry/log streaming) into *Import CSV / JSONL*. The union of keys becomes the header row; one row per line. Auto-detects by content, so `.txt` files containing JSONL also work.
- **10,000-row sheets** (up from 1,000)
- **Browser e2e suite:** 28 Playwright specs across 6 files run headlessly on Chromium and WebKit (see [e2e/STATUS.md](e2e/STATUS.md))

### Workbook
- **Multi-sheet workbooks:** up to 100 sheets per file, each up to 10,000 rows × 702 columns (A–ZZ)
- **Tab bar** at the bottom: click to switch, double-click to rename, right-click to duplicate/delete/reorder
- **Save / load** as `.localsheet.json` (schema v2.0); v1.0 files auto-migrate on open
- **File System Access API** in Chrome/Edge: real in-place save; download fallback elsewhere

### Formula & Equations
- **99 functions** across math, stats, text, lookup, dates, financial, info
- Multi-sheet references: `=Sheet2!A1`, `=SUM('My Data'!A1:B10)`
- Cycle detection (`#CIRC!`), proper error tokens (`#DIV/0!`, `#VALUE!`, `#REF!`, `#NAME?`, `#PARSE!`, `#N/A`, `#NUM!`)
- Dependency graph with topological recalc: change a cell and all dependents update

### Editing
- **Range selection:** click+drag, Shift+click, Shift+arrows
- **Whole row / column / sheet selection:** click a row number, column letter, or the top-left corner to select all of it
- **Jump to any cell:** click the address box (top-left) or press `Ctrl+G` and type a cell like `ZZ500` or `Sheet2!AA10`
- **Auto-extend:** scroll near the right or bottom edge and the grid expands in chunks (26 cols / 50 rows) all the way to ZZ × row 10000
- **Formula reference picking:** while editing a formula, click or drag any cell to insert its reference (`A1` or `A1:A10`) at the cursor; picked range shows a dashed accent outline
- **Auto-pair parentheses:** typing `(` in a formula inserts `()` with the cursor between; `)` skips over a matching close; Backspace deletes the pair
- **Multi-cell copy/paste** as TSV (round-trips with Excel and Google Sheets)
- **Undo / Redo** up to 100 actions (`Ctrl+Z` / `Ctrl+Y` or `Ctrl+Shift+Z`) including bulk ops (paste, clear, format, sort, replace-all)
- **Insert/delete/sort** rows and columns via toolbar dropdown or right-click
- **Column and row resize** by dragging the right edge of a column header or bottom edge of a row header
- **Freeze panes:** top row / first column / both / freeze at selection / unfreeze
- **Sort columns** A→Z or Z→A from the right-click menu or **Data ▾ toolbar** dropdown (sorts the populated range, preserves row groups)
- **Sort range with / without header:** select cells, then *Data → Sort range with header…*; treats the first row as a label and keeps it in place while sorting the rest
- **Format painter:** pick the format of the active cell, then click anywhere to paint it

### Formatting
- **Bold / Italic / Underline / Strikethrough** per cell (`Ctrl+B` / `Ctrl+I` / `Ctrl+U` + S button)
- **Wrap text:** toggle word-wrap; row auto-grows to fit
- **Font size:** 9 through 32 pt, rows auto-grow for larger text
- **Text alignment:** Left, Center, Right
- **Number formats:** General, Number (1,234.56), Currency ($1,234.56), Percent (42%), Integer (1,235), Date (2026-05-24), Date US (05/24/2026)
- **Fill color:** 11-swatch palette plus a custom color picker; applies to empty cells too
- **Text color:** same palette mechanic for foreground
- **Borders:** All / Outside-only / Top / Bottom / Left / Right / None (medium-gray, visible in both themes)
- **Conditional formatting:** per-sheet rules (`> 0` → green, `< 0` → red, etc.) applied at render time

### Data
- **Data validation lists:** right-click → *Set list values…* gives the cell a dropdown of allowed values; a small ▾ arrow on the cell opens the picker
- **Cell notes:** right-click → *Add / edit note*; a red triangle in the corner marks notes; hover to read
- **Named ranges:** toolbar *Names…* dialog (e.g. `Revenue = Sheet1!B2:B13`); names work inside formulas: `=SUM(Revenue)`
- **Tables / Lists (Excel-style "Format as Table"):** `Ctrl+L` or `Ctrl+T` (or *Data → Format selection as table*, or right-click → *Create list / table*). If you have a range selected it uses that; if you're on a single cell inside data, it **auto-detects the contiguous range** like Excel does. The first row becomes a styled header (accent background, white text) with a ▾ filter chip on each column. Body rows get zebra stripes. To convert back to a plain range, use *Remove table* from the same menus.
- **Fill handle:** select one or more cells, then drag the **small accent square** at the bottom-right corner down or right. If the source values are an arithmetic series (`1, 2, 3` or `10, 20, 30`), it continues the pattern; otherwise it repeats the source values in cycle.
- **Merge cells:** select a range and pick *Merge cells* (right-click or *Data ▾*). Cells visually combine into one block; only the top-left value is kept. *Unmerge* on the merged cell restores it.

### UX
- **Find / Replace / Find All** (`Ctrl+F`): current sheet or all sheets, optional case-sensitive; Enter advances; Find All highlights every match in yellow and shows a **clickable results list** at the bottom of the panel (click a result to jump to that cell; the current one is highlighted in orange)
- **Column filter:** right-click → *Filter column…* shows a checklist of unique values; uncheck to hide rows. No header row required. Multiple columns can be filtered at once; filtered columns get a ▾ chip on the header.
- **Theme toggle:** Light / Dark / Auto, remembered across sessions
- **Range summary** in the status bar: count, sum, average for the active selection
- **Right-click context menu:** copy, paste, insert/delete row+col without leaving the grid
- **Help overlay** (`?`): full keyboard reference and function list
- **Unsaved changes dot** in the toolbar, browser warning on close

---

## Usage

1. Download `localsheets.html`
2. Open it in Chrome, Edge, Brave, or Safari (see Browser support below; Firefox is not officially supported in v1.1)
3. Start typing. That's it

No install. No npm. No build step. No telemetry.

---

## Keyboard shortcuts

| Key | Action |
|---|---|
| Click | Select cell |
| Click+drag / Shift+click | Select range |
| Click row number / column letter / top-left corner | Select whole row / column / sheet |
| Click/drag in grid while editing `=…` | Insert cell or range reference into the formula |
| Type | Start editing (overwrites) |
| F2 / Enter | Edit current cell (keeps value) |
| Escape | Cancel edit / close panel |
| Enter / Tab | Commit + move down / right |
| Shift+Tab / Shift+Enter | Commit + move left / up |
| Arrow keys | Navigate |
| Shift+Arrows | Extend selection |
| Page Up / Page Down | Page through rows |
| Home / End | Start / end of row |
| Delete / Backspace | Clear cell(s) |
| Ctrl+S / Ctrl+Shift+S | Save / Save As |
| Ctrl+N / Ctrl+O | New / Open |
| Ctrl+Z | Undo |
| Ctrl+Y / Ctrl+Shift+Z | Redo |
| Ctrl+Home / Ctrl+End | Jump to A1 / last cell with data |
| Ctrl+G | Focus the address box (then type any cell like `ZZ500` and Enter) |
| Ctrl+L / Ctrl+T | Create list / table from selection (or auto-detect contiguous range) |
| Alt+Enter (in cell editor) | Insert newline + auto-enable wrap text |
| Ctrl+= / Ctrl+- / Ctrl+0 | Zoom in / out / reset |
| Enter (in Find box) | Find next match |
| Enter (in Replace box) | Replace current and find next |
| Ctrl+C / Ctrl+V | Copy / Paste (cell or range, as TSV) |
| Ctrl+B / Ctrl+I / Ctrl+U | Bold / Italic / Underline |
| Ctrl+F | Find / Replace |
| Ctrl+PgDn / Ctrl+PgUp | Next / previous sheet |
| Right-click | Context menu |
| Double-click title | Rename workbook |
| Double-click tab | Rename sheet |
| ? | Help overlay |

---

## Formula reference

Start a formula with `=`. Function names are case-insensitive. Cross-sheet refs use `SheetName!A1` or `'Sheet Name'!A1`.

**Math / Stats:** SUM, AVERAGE, COUNT, COUNTA, COUNTBLANK, MIN, MAX, MEDIAN, STDEV, VAR, PRODUCT, ROUND, ROUNDUP, ROUNDDOWN, FLOOR, CEILING, INT, MOD, ABS, SQRT, POWER, EXP, LN, LOG, LOG10, PI, RAND, RANDBETWEEN, SIGN

**Logical:** IF, IFS, SWITCH, IFERROR, IFNA, AND, OR, NOT, XOR

**Text:** CONCAT, CONCATENATE, TEXTJOIN, LEN, UPPER, LOWER, PROPER, TRIM, LEFT, RIGHT, MID, FIND, SEARCH, SUBSTITUTE, REPLACE, REPT, VALUE, TEXT, EXACT

**Lookup:** VLOOKUP, HLOOKUP, INDEX, MATCH, XLOOKUP, ROW, COLUMN, ROWS, COLUMNS

**Conditional aggregates:** SUMIF, COUNTIF, AVERAGEIF, SUMIFS, COUNTIFS, AVERAGEIFS

**Dates:** TODAY, NOW, DATE, YEAR, MONTH, DAY, WEEKDAY, EOMONTH, EDATE, DATEDIF, DAYS, NETWORKDAYS

**Financial:** PMT, FV, PV, NPV, IRR

**Info:** ISNUMBER, ISTEXT, ISBLANK, ISERROR, ISERR, ISNA, ISLOGICAL, N

**Inline charts:** SPARKLINE: `=SPARKLINE(A1:A10)` returns an inline SVG line chart in the cell. Optional 2nd arg `"bar"` for a bar variant; optional 3rd arg is a hex color like `"#ef4444"`.

**Cell references:** plain `A1` (relative), `$A$1` (both absolute), `$A1` / `A$1` (mixed). The fill handle preserves absolute parts when dragging.

---

## File format

Files are saved as `.localsheet.json`: plain JSON, fully portable, git-diffable. Multi-sheet schema (v2.0):

```json
{
  "version": "2.0",
  "tool": "localsheets",
  "meta": { "title": "My Budget" },
  "sheets": {
    "sAbc12345": {
      "name": "Sheet1",
      "cells": {
        "A1": { "raw": "Salary", "value": "Salary", "type": "text", "format": { "bold": true } },
        "B1": { "raw": "5000",   "value": 5000,     "type": "number", "format": { "numfmt": "currency" } },
        "B2": { "raw": "=B1*12", "formula": "=B1*12" }
      },
      "colWidths": {}
    }
  },
  "sheetOrder": ["sAbc12345"],
  "activeSheet": "sAbc12345"
}
```

- **Sparse**: only populated cells are stored
- **Formulas re-evaluate on load:** saved files never trust the cached `value` for formula cells
- **v1.0 files** (single-sheet `cells` map) auto-migrate to v2.0 on open

---

## Templates

Seven ready-to-use templates ship in `templates/`. Open any via the toolbar **Open** button. See `templates/README.md` for the full breakdown.

**Personal finance**
| File | What it shows |
|---|---|
| `monthly-budget.localsheet.json` | Income vs. expense tracker with totals and net savings. |
| `rsu-tracker.localsheet.json` | **Two sheets:** an `Inputs` sheet (stock price, tax rate) feeds a `Vesting` schedule via cross-sheet formulas. Change the stock price on one sheet, every vest event recomputes. |
| `startup-burn.localsheet.json` | Monthly burn rollup, runway in months/years, projected out-of-cash date, and a "cut 20%" sensitivity row. |
| `rental-cashflow.localsheet.json` | Property-by-property net monthly / annual cash flow + cap rate, with portfolio totals. |
| `kids-allowance.localsheet.json` | Earned / spent log with a running balance formula. |
| `mortgage-calculator.localsheet.json` | Loan amount, monthly P+I via `PMT()`, total interest, and a 28%-rule affordability calc. |

**Edge / Robotics**
| File | What it shows |
|---|---|
| `robot-arm-pid-calibration.localsheet.json` | 6-DOF robotic arm PID calibration. Per-joint `Kp`/`Ki`/`Kd`/inertia on the `Joints` sheet; `Computed` sheet derives natural frequency, damping ratio, 2% settling time, and damping class. Same multi-sheet pattern as the RSU tracker, applied to motion control. |

All templates use the v2.0 multi-sheet schema with live formulas that recompute when you edit the inputs.

---

## Local AI (optional)

Click **AI** in the toolbar to open a panel that talks to a local [Ollama](https://ollama.com) instance. **No data ever leaves your machine.** The panel auto-detects the model list and offers two modes:

- **Text reply:** freeform response, optionally including the selection as TSV context. Insert into the active cell or paste as TSV below the selection.
- **JSON patch:** the model returns a structured object like `{"A1": "=SUM(B1:B10)", "B12": 42}`. The panel validates every cell key, shows a preview, applies as a single undoable bulk action.

Use cases that work well: *"categorize these expenses into Needs/Wants/Savings"*, *"explain this formula"*, *"draft a budget for a $90k salary"*, *"what's the next likely value in this series?"*.

### Hardware

Tested on a 7-year-old laptop with no usable GPU. Slow but correct. On modern hardware where a 7B model fits in VRAM, it's snappier. We chose to verify the floor, not the ceiling. If it works here, it works on whatever you have.

### Setup

This is a one-time setup. Because LocalSheets runs from `file://`, Ollama has to be told to accept browser connections. The full per-OS guide is in **[OLLAMA_SETUP.md](OLLAMA_SETUP.md)**, but the short version:

| OS | Command (one terminal session) |
|---|---|
| macOS | `launchctl setenv OLLAMA_ORIGINS "*"` then relaunch Ollama from the menu bar |
| Linux | `OLLAMA_ORIGINS="*" ollama serve` (or persistent: `sudo systemctl edit ollama.service`) |
| Windows | Quit Ollama from system tray → set `OLLAMA_ORIGINS=*` in user env vars → relaunch |

If the AI panel says "Cannot reach Ollama", see [OLLAMA_SETUP.md](OLLAMA_SETUP.md), which covers troubleshooting and recommended models. There's also a standalone verifier, `node e2e/verify-ai-live.js`, that runs the same HTTP calls the browser makes (reachability, CORS for `Origin: null`, text-mode, JSON-patch-mode) and exits 0 on success.

---

## Repository layout

```
localsheets/
├── .gitignore
├── localsheets.html          ← the app (single-file, ~260 KB, what you ship)
├── README.md
├── LICENSE                   ← MIT
├── CHANGELOG.md
├── templates/                ← 7 ready-to-use sample workbooks (see templates/README.md)
│   ├── README.md
│   ├── monthly-budget.localsheet.json
│   ├── rsu-tracker.localsheet.json
│   ├── startup-burn.localsheet.json
│   ├── rental-cashflow.localsheet.json
│   ├── kids-allowance.localsheet.json
│   ├── mortgage-calculator.localsheet.json
│   └── robot-arm-pid-calibration.localsheet.json
├── src/                      ← un-bundled engine + tests (for review / CI)
│   ├── engine.js             (~1,800 lines: tokenizer + parser + evaluator + 99 fns + SPARKLINE + absolute refs + formula-shift helpers)
│   ├── app-layer.js          (~790 lines: DepGraph + Store including structural ops)
│   ├── test-engine.js        (143 tests)
│   └── test-store.js         (56 tests)
└── e2e/                      ← browser end-to-end tests (dev tooling, NOT shipped)
    ├── README.md
    ├── package.json          (one devDep: @playwright/test)
    ├── playwright.config.js  (Chromium + Firefox + WebKit)
    ├── verify-ai-live.js     (standalone Node script: exercises the real Ollama round-trip end-to-end)
    └── tests/                (render, editing, structural, formulas, persistence, panels)
```

- **Engine** has no DOM dependencies: pure compute, fully unit-tested (143/143 pass)
- **Store** has no DOM dependencies: wraps the engine with state, undo, serialization, and structural ops (56/56 pass)
- **UI** wires the HTML shell to the Store
- **Zero runtime dependencies in the shipped artifact:** no React, no jQuery, no charting lib, no npm. The `e2e/` test harness uses Playwright but is isolated dev tooling; it never ships to users.
- Run engine + store tests with `node src/test-engine.js && node src/test-store.js`
- Run browser e2e tests with `cd e2e && npm install && npx playwright test`

---

## Limits (by design)

| Limit | Value |
|---|---|
| Sheets per workbook | 100 |
| Rows per sheet | 10,000 |
| Columns per sheet | 702 (A through ZZ) |
| Undo history | 100 actions |
| File size target | < 300 KB (currently ~260 KB) |

---

## What LocalSheets will NOT do

Real-time collaboration. Cloud sync. Pivot tables. Macros / VBA. Image embedding. Sheet protection. Excel format parity (`.xlsx` import is planned). Multi-user editing. Mobile UI (desktop only by design).

## Browser support

| Browser | Status | Notes |
|---|---|---|
| **Chrome / Edge / Brave** (Chromium) | ✓ **Primary target** | Full feature set. File System Access API enables in-place save (`Ctrl+S` writes back to the same file, no download dance). E2E test suite green on Chromium. |
| **Safari** (WebKit) | ✓ Supported | All formulas, editing, charts, AI panel work. Save falls back to a download (Safari doesn't expose FSAPI). E2E test suite green on WebKit. |
| **Firefox** | Not officially supported in v1.1 | Engine math + UI should work, but Firefox lacks FSAPI (so every save is a download), and we don't yet run cross-engine regression tests against it. Use Chrome/Edge for the intended UX. |

The "no Firefox" call is pragmatic, not philosophical. Chrome + Edge cover the audiences that care about a local-first spreadsheet, and the in-place-save UX is a core part of the product that Firefox can't deliver. If there's user demand we'll add it back; PRs welcome.

## Known limitations

Honest list of things that are *missing or partial*, not just unsupported. The first user to hit one shouldn't be surprised.

- **Drag-and-drop column or row reordering is not supported.** Use Insert + cut/paste, or sort.
- **While editing a formula, you can't click a tab on another sheet to pick a reference from there.** Type `Sheet2!A1` manually, or finish the formula on the current sheet first.
- **Sort doesn't update formula references inside the sorted range:** if your sort range contains cells that reference each other, those refs will point at the original positions after sort. Put formulas outside the sort range.
- **Sort / Fill ignore filter state:** they operate on the full populated range, not just visible rows.
- **Named ranges use string substitution**, so a name that *looks* like a cell ref (e.g. `Q1`) will collide. The Names dialog warns about this.
- **Conditional formatting** is single-rule-per-cell: the first matching rule wins, no rule priority UI yet.
- **Fill handle pattern detection** covers arithmetic series (`1, 2, 3 → 4, 5, 6`) and repeats only, no month/weekday/date increment yet.
- **Tables:** the filter chip on a table header opens the existing column filter, which applies to the whole sheet, not just the table's row range.
- **Cell merging** is supported, but selection navigation into a merged block lands on the owner cell; arrow keys from inside the merge feel slightly different from Excel.
- **Freeze at selection** uses the focus cell, so freezing while at `A1` is a no-op; select a different cell first.
- **Chrome may prompt for clipboard permission on every paste:** that's a Chrome security policy, not something this app can override. Edge tends to remember.
- **Function names must be exact:** `=conc(...)` returns `#NAME?`. The right name is `CONCAT`. No fuzzy match.
- **No print view or PDF export.** Use the browser's built-in print.
- **File System Access API** (in-place save) only works in Chromium-based browsers. Safari falls back to a download on every save. (Firefox: see Browser support above; not officially supported in v1.1.)
- **Mobile** shows a warning splash; touch isn't supported by design.


---

## Roadmap

| Version | Status | Focus |
|---|---|---|
| v0.1 | shipped | Single-sheet grid, save/load, CSV, formatting |
| v1.0 | shipped | Multi-sheet, formula engine (80 fns), undo, find/replace, range select, TSV paste, column resize |
| **v1.1** | **shipped** | **`=SPARKLINE()`, basic charts (bar/line/pie SVG), Ollama AI panel (text + JSON-patch modes), absolute references (`$A$1`), insert/delete row+col rewrites formula text (incl. cross-sheet refs), fill-handle propagates formulas, 10k row cap, right-click bug fix, 199 unit + 28 e2e tests (Chromium + WebKit)** |
| v1.2 | planned | XLSX import (SheetJS CE, Apache 2.0, lazy-loaded), Firefox cross-engine support, domain template packs (RF link budget, PID, thermal, BMS) |
| v2.0 | future | Pivot tables, array formulas / SPILL, real-time collab via Yjs (opt-in) |

---

## License

MIT. Yours forever.