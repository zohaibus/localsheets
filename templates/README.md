# LocalSheets Templates

Each `.localsheet.json` here is a working workbook with live formulas. Open any via the toolbar **Open** button in `localsheets.html`.

### Personal finance

| Template | Sheets | Demonstrates |
|---|---|---|
| **monthly-budget.localsheet.json** | 1 | Income vs. expense tracker with totals (`SUM`) and net savings. Good first-time template. |
| **rsu-tracker.localsheet.json** | 2 | RSU vest schedule with cross-sheet refs. Edit `Inputs!B1` (stock price) and `Inputs!B2` (tax rate); the `Vesting` sheet recomputes all four events. |
| **startup-burn.localsheet.json** | 1 | Monthly burn rollup, runway in months/years, projected out-of-cash date (`EDATE`, `TODAY`), and a "cut 20% of burn" sensitivity row. |
| **rental-cashflow.localsheet.json** | 1 | Per-property net monthly cash flow, annualized, cap rate, portfolio totals (`SUM` rollup). |
| **kids-allowance.localsheet.json** | 1 | Earned/spent log with a running balance formula chained down the column. |
| **mortgage-calculator.localsheet.json** | 1 | Loan affordability with `PMT()` for monthly principal+interest, total interest, and the 28%-rule income requirement. |

### Edge / Robotics

| Template | Sheets | Demonstrates |
|---|---|---|
| **robot-arm-pid-calibration.localsheet.json** | 2 | 6-DOF arm PID tuning. The `Joints` sheet holds per-joint `Kp`, `Ki`, `Kd`, inertia `J`, velocity/torque limits, and encoder offsets. The `Computed` sheet derives natural frequency `ωn = √(Kp/J)`, damping ratio `ζ = Kd/(2√(Kp·J))`, 2% settling time, and a damping class (`Underdamped`, `Critical`, `Overdamped`). Cross-sheet formulas + `IF`, `AND`, `SQRT`, `MIN/MAX/COUNTIF`. |

All templates are v2.0 schema (multi-sheet workbook) with live formulas, verified to evaluate without error.

### Data import sample (JSONL, not a workbook)

| File | What it is |
|---|---|
| **joint-telemetry.jsonl** | 25 lines of synthetic 6-DOF joint telemetry (timestamp, angle, velocity, torque, current, temp, status). Open via *Import CSV / JSONL* in the toolbar — auto-detected as JSONL by content. Header row populates from the union of keys; rows with a missing key (e.g. early rows without `status`) leave those cells blank. JSONL is the standard format for robotics/embedded log streaming because it stays valid even if power dies mid-write — each completed line is a self-contained event. |

## Using a template

1. Open `localsheets.html` in your browser.
2. Click **Open** in the toolbar.
3. Pick the `.localsheet.json` file.
4. Edit the input cells to fit your situation — the formulas recompute on every change.
5. Save with `Ctrl+S` (Chrome/Edge/Brave write in-place via the File System Access API; Safari downloads a new copy each time). See the main [README's Browser support section](../README.md#browser-support) — Firefox is not officially supported in v1.1.

## File format

These files are plain JSON. You can read them in any text editor, version-control them with `git diff`, or generate them programmatically. The schema:

```json
{
  "version": "2.0",
  "tool": "localsheets",
  "meta": { "title": "..." },
  "sheets": {
    "s_xxx": {
      "name": "Sheet Name",
      "cells": {
        "A1": { "raw": "Hello", "value": "Hello", "type": "text" },
        "B1": { "raw": "5", "value": 5, "type": "number", "format": { "numfmt": "currency" } },
        "C1": { "raw": "=B1*12", "formula": "=B1*12" }
      },
      "colWidths": { "0": 180 },
      "rowHeights": {}
    }
  },
  "sheetOrder": ["s_xxx"],
  "activeSheet": "s_xxx"
}
```

Formula cells have `raw` + `formula` only — the value is re-evaluated on load (so you can edit the file by hand without worrying about stale cached values).

## Contributing a template

Templates that are generally useful, free of personal data, and stable to recompute are welcome. Open a PR with:

- A clear filename like `category-purpose.localsheet.json`.
- A 1–2 sentence row added to the table above.
- A check that every formula evaluates without error (you can verify by opening the file in `localsheets.html`).
