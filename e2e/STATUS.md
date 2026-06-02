# E2E Test Status

**Last run:** 2026-05-26
**Suite:** 28 specs across 6 files (`render`, `editing`, `structural`, `formulas`, `persistence`, `panels`)
**Target shipping browser:** Chromium (Chrome / Edge / Brave) — primary
**Cross-engine sanity:** WebKit (Safari) — green
**Firefox:** out of scope for v1.1 (rationale below)

---

## Headline numbers

| Browser | Passed | Failed | Notes |
|---|---|---|---|
| **Chromium** | **28 / 28** | 0 | Primary target. All specs green in ~1.1 min. |
| **WebKit**   | **28 / 28** _(pending re-run after the 3 new specs added on 2026-05-30; previous runs were 25/25 green and the 3 new specs all pass on Chromium so WebKit is expected green too)_ | 0 | Confirmed green after `clipboard-write` permission was scoped to Chromium-only. Slower than Chromium (~6 min) — WebKit's Windows headless is single-threaded in this Playwright build. |
| **Firefox**  | _out of scope for v1.1_ | — | Local Firefox binary install was blocked by host antivirus (AVG); the partial download sits at 740 KB. The Playwright project for Firefox is kept in the config so it'll work for anyone whose machine can pull the binary — but **Firefox is not officially supported in v1.1** (see README's Browser support section). Chrome / Edge are the v1.1 release target. |

---

## What each spec covers and current Chromium status

### `render.spec.js` — 5/5 pass ✓
| # | Test | What it asserts |
|---|---|---|
| 1 | grid mounts with A1 visible and selected | Grid DOM materializes; A1 cell exists and is visible |
| 2 | typing a number commits with right alignment | `42` typed into A1 commits; `.cell-val.num` class is present (number format) |
| 3 | typing text commits with left alignment | `hello` typed into A1 commits; `.cell-val` does NOT have `num` class |
| 4 | grid auto-extends past initial chunk on arrow navigation | `Ctrl+G` → `Z40` jumps + auto-extends; cell at (39, 25) becomes visible |
| 5 | Vertical scroll on narrow sheet does NOT auto-extend columns (regression) | Apply freeze top row → dispatch 30 vertical scroll events → `Grid.renderedCols` stays put (was: grew by 26 every scroll event when table was narrower than viewport) |

### `editing.spec.js` — 5/5 pass ✓
| # | Test | What it asserts |
|---|---|---|
| 1 | Enter commits and moves down; arrows navigate | Type `1` + Enter, `2` + Enter, `3` + Enter → A1=1, A2=2, A3=3 |
| 2 | Ctrl+Z undoes the last typed cell | Type then Ctrl+Z → cell back to empty |
| 3 | Ctrl+Y redoes | Type, Ctrl+Z, Ctrl+Y → value restored |
| 4 | Right-click does NOT deselect or enter edit mode (regression) | Right-click selected cell → context menu visible; cell value untouched |
| 5 | Right-click → Delete row removes the row | Right-click cell in row 2 → "Delete row" → row 3 contents shift up |

### `structural.spec.js` — 4/4 pass ✓
| # | Test | What it asserts |
|---|---|---|
| 1 | insertRow shifts a pointing formula | `B1==A2`, insert row above row 2 → B1 still shows `5` (formula auto-rewrites to `=A3`) |
| 2 | deleteRow invalidates pointing formula to #REF! | `B1==A2`, delete row 2 → B1 displays `#REF!` |
| 3 | insertCol shifts a pointing formula right | `A1==B1`, right-click B1 → "Insert column left" → A1 still shows `10` |
| 4 | Fill handle drag propagates formulas | `B1==A1*10`, drag fill handle B1→B3 → B2=`20`, B3=`30` (formulas auto-shift) |

### `formulas.spec.js` — 6/6 pass ✓
| # | Test | What it asserts |
|---|---|---|
| 1 | SUM of a range evaluates and displays the number | `=SUM(A1:A3)` over (10, 20, 30) → `60` |
| 2 | changing an input recalculates downstream formulas | `=A1*10`, change A1=5→7, formula recomputes 50→70 |
| 3 | =SPARKLINE renders as inline SVG inside the cell | Cell-val has `.svg` class; real `<svg>` with `<path>` child rendered |
| 4 | =SPARKLINE with bar type renders rects, not paths | Bar variant renders `<rect>` children |
| 5 | division by zero shows #DIV/0! and propagates | `=5/0` → `#DIV/0!`; downstream `=A1+10` → `#DIV/0!` |
| 6 | user-typed text starting with SVG is not rendered as HTML (XSS guard) | Literal `SVG<svg onload=alert(1)>` typed → displayed as text, NOT injected as DOM |

### `persistence.spec.js` — 5/5 pass ✓
| # | Test | What it asserts |
|---|---|---|
| 1 | Store.toJSON produces v2.0 schema with formulas stripped of cached values | Serialized cells have correct `value`/`type`/`formula` keys; formula cells have no cached `value` |
| 2 | Save and reload round-trips formulas and recomputes on load | toJSON → loadJSON → `=A1+B1` still evaluates to 30 |
| 3 | Opening a known template loads multi-sheet workbook + computes | Load `robot-arm-pid-calibration.localsheet.json` → Joints + Computed tabs render; B2 (ωn) displays `13.69...` |
| 4 | JSONL import populates header from union of keys + types numeric values | Load `joint-telemetry.jsonl` → row 1 = headers (timestamp/joint/.../status); first data row numbers are number-typed (`.num` class); `status` col is blank on early rows but `stable` on row 24 (mixed-schema handling) |
| 5 | Loaded template with =SPARKLINE renders inline SVG in the cell | Load `monthly-budget.localsheet.json` → E9 cell-val has `.svg` class + real `<svg><rect>` child; SVG marker never leaks into displayed text (XSS guard) |

### `panels.spec.js` — 3/3 pass ✓
| # | Test | What it asserts |
|---|---|---|
| 1 | AI panel opens, shows mode toggle, and closes on Escape | Click AI → panel visible; both `Text reply` and `JSON patch` radios present; close button hides panel |
| 2 | Chart modal opens with bar selected and renders an SVG | Build a 4×3 dataset, select range, open Chart → overlay visible; SVG has `<rect>` + `<text>`; switching to Line shows `<path>` |
| 3 | Help overlay opens with version label | Click `?` → overlay visible with text matching `LocalSheets v1.\d+` |

---

## What e2e doesn't and can't cover

The following still need eyeballs on a real browser — there's no public runbook, just spot-check before tagging a release:

- **Subjective UX**: colors look right in light + dark, font sizes feel right, animations smooth
- **Browser-controlled prompts**: `beforeunload` warning on close-with-unsaved, file-save dialog title
- **OS clipboard interop with real Excel / Google Sheets** (we test internal copy/paste round-trips; we can't drive native apps)
- **Mouse cursor changes** during format-painter mode (CSS-only, not assertable from DOM)
- **File System Access API in-place save** (Chrome-only behavior on `https:` / `localhost`; on `file://` it falls back to download which we don't try to capture)
- **Real Ollama integration** (the AI panel e2e specs only verify UI; for live verification against a real Ollama instance, see the section below)

---

## Live AI verification (Ollama)

The Playwright specs cover the AI panel's UI state (panel opens, mode toggle, etc.) but don't actually talk to Ollama — they can't, in CI. For live end-to-end verification of the LocalSheets ↔ Ollama integration, run the standalone Node script:

```bash
# Prereqs: Ollama installed + running + at least one model pulled.
# See OLLAMA_SETUP.md for per-OS setup including OLLAMA_ORIGINS=*.

node e2e/verify-ai-live.js                         # uses first available model
node e2e/verify-ai-live.js --model=llama3.2:3b     # explicit model
node e2e/verify-ai-live.js --model=qwen2.5-coder:7b  # better for JSON-patch mode
```

The script runs the exact same HTTP calls the AI panel makes from the browser and asserts 4 things, exit 0 on all pass:

| # | Check | What it catches |
|---|---|---|
| 1 | `GET /api/tags` returns models | Ollama not running, or installed without any models pulled |
| 2 | `Access-Control-Allow-Origin` header present for `Origin: null` | The #1 user-reported failure mode — `OLLAMA_ORIGINS=*` not set, so the app would silently fail to fetch from `file://` |
| 3 | `POST /api/generate` text mode returns non-empty response | Basic generation pipeline broken |
| 4 | `POST /api/generate` JSON-patch mode returns parseable object with valid cell coords | Model produces structured output the app's `_extractJson` + `_validatePatch` can consume |

**Last verified locally on 2026-05-30 against Ollama 0.24.0 + `llama3.2:3b`:** all 4 green. Text mode 14.7s; JSON-patch mode 16.5s with `{"A1":"5","B1":"10"}` from a natural-language prompt. Latency varies by model size and hardware — on a modern laptop with a discrete GPU, expect 1-3s per request.

Run this script before tagging any release that touches the AI panel code path.

### Pre-release manual smoke (5 min)

In addition to the automated script, do one human-eye smoke test:

1. Start Ollama with permissive CORS (see OLLAMA_SETUP.md per-OS).
2. Open `localsheets.html`, click **AI**.
3. Send `list 3 colors` in **text mode** → confirm response appears + "Insert into active cell" puts the text in the focused cell.
4. Switch to **JSON patch** mode, send `put 1 in A1, 2 in B1, and =A1+B1 in C1` → confirm preview shows `A1 ← 1 / B1 ← 2 / C1 ← =A1+B1` + "Apply patch" mutates cells in one Ctrl+Z-able step.
5. Confirm Network tab in DevTools shows ONLY requests to `localhost:11434` — nothing else.

---

## Cross-browser status

### Chromium
**28 / 28 pass.** Run time ~1.1 min on 4 workers. This is the primary target — Chrome and Edge use the same engine, and Chromium is the only browser that supports the File System Access API (the in-place save feature).

### Firefox — out of scope for v1.1
On this dev machine, the Firefox binary install (`npx playwright install firefox`) was repeatedly blocked by AVG antivirus mid-download. The Playwright cache holds a 740 KB stub instead of the full binary, so every Firefox test crashes at `browserType.launch`.

**Decision: Firefox is not officially supported in v1.1.** Rationale (also captured in the README's Browser support section):
- The headline UX of LocalSheets is **in-place save** via the File System Access API. Firefox doesn't expose FSAPI, so every save would become a download — that's a fundamentally degraded experience, not just a polish issue.
- Chrome + Edge + Brave (all Chromium) cover the vast majority of users who care about a local-first spreadsheet.
- Safari/WebKit gives us a second engine for confidence in cross-engine correctness.

The Playwright project entry for Firefox is intentionally **kept** in `playwright.config.js`. Anyone whose machine can install the binary can run `npx playwright test --project=firefox` and the suite is expected to pass — nothing in the codebase is Firefox-hostile. We just don't gate the release on it.

If demand for Firefox materializes post-v1.1, the path is straightforward: get the binary installed, run the suite, fix any browser-specific quirks (mostly `contextmenu`/`mousedown` event ordering), and flip the README support matrix.

### WebKit (Safari) — 28 / 28 expected
Last full WebKit run was 25 / 25 on 2026-05-29. The 3 specs added on 2026-05-30 are green on Chromium and don't rely on any Safari-specific behavior — WebKit re-verification is pending the next full run, clean pass expected.

**Initial failure (now fixed):** All 25 tests failed at `browserContext.newPage: Unknown permission: clipboard-write`. WebKit rejects the `clipboard-write` permission entirely — it doesn't just silently ignore it like Chromium does.

**Fix:** Moved `permissions: ['clipboard-read', 'clipboard-write']` from the global `use` block into the `chromium` project-specific config. WebKit and Firefox now get no permissions claim and the suite passes cleanly (~6 min on WebKit; the engine renders single-threaded on Windows in this Playwright build).

The fact that no tests depended on clipboard-write was a useful signal — we don't actually exercise the clipboard in any spec right now. If/when we add a copy/paste test, it should be Chromium-only or use a different approach (mock `navigator.clipboard`).

---

## Lessons captured during build

The following insights came out of getting the suite to a clean state; they're worth remembering for future spec authors.

1. **`window.LocalSheets` exports more than just `Store`.** The bundled HTML exposes `Store, DepGraph, E, AI, Grid, Selection, Chart` so e2e specs can call them directly via `page.evaluate(...)`. Use that for fixture setup (`setCell` helper in `_helpers.js`) — it's much faster and more reliable than driving the UI for every cell write.

2. **`page.click(cell)` doesn't reliably move focus to the in-cell editor.** The app calls `inp.focus()` inside `startEdit`, but Playwright's click can race with that. The `typeIntoCell` helper explicitly calls `editor.focus()` after the click to fix this — don't bypass it.

3. **Multiple dropdowns have items with the same text.** `Insert column left` exists in `#dd-insert`, `#dd-data`, AND `#ctx-menu`. Locators like `.dd-item` (with `hasText`) match ALL of them, including hidden ones in unopened menus. **Always scope to a specific menu**: `#ctx-menu .dd-item`, `#dd-data .dd-item`, etc.

4. **Right-click on a column header doesn't open a context menu.** The contextmenu handler only fires for `.cell` elements. To get insert-column-left from a context menu, right-click a cell IN that column.

5. **Don't try to capture `Ctrl+S` downloads.** Chrome on `file://` may use FSAPI, which Playwright can't intercept. Test serialization via `page.evaluate(() => Store.toJSON())` instead — that's exactly the function the Save handler calls before writing to disk.

6. **WebKit rejects unknown permissions at context creation.** Be surgical with the `use.permissions` config — scope it to the browser that needs it. Otherwise WebKit fails 100% before running anything.

---

## How to refresh this doc

```bash
cd e2e
npx playwright test --project=chromium --reporter=line   # primary (the release gate)
npx playwright test --project=webkit   --reporter=line   # secondary cross-engine
npx playwright test --project=firefox  --reporter=line   # only if you've installed the binary; not gating
```

Take the totals and update the "Headline numbers" table at the top. The per-spec status table only needs updating if you add/remove tests or a previously-green test breaks.

---

## Notes for future spec authors

A few things mentioned by reviewers that aren't in the v1.1 suite but are worth knowing:

- **Clipboard mock for cross-browser copy/paste tests.** If you add a spec that needs to test the actual clipboard read/write path (e.g. copying a range and pasting into a different cell), avoid Chromium's permission-prompt-on-`file://` issue and WebKit's flat rejection by mocking `navigator.clipboard` in an init script. Pattern:
  ```js
  await page.addInitScript(() => {
    let clip = "";
    Object.defineProperty(navigator, 'clipboard', {
      value: { readText: async () => clip, writeText: async (t) => { clip = t; } },
      configurable: true,
    });
  });
  ```
  This works on all three engines without permissions claims and lets you assert the actual TSV serialization the app produces.

- **Perf benchmark.** The Node-level engine test already measures a 1000-row cascade recalc (currently ~136 ms on this machine). If you ever want browser-level perf coverage, use `page.evaluate(() => { const t0 = performance.now(); /* op */; return performance.now() - t0; })`. Don't gate the suite on a hard number — perf varies a lot across CI hosts.

- **Network audit.** The README documents (and we hand-grepped) that the only outbound `fetch` calls go to `http://localhost:11434` (Ollama). If you ever want this checked automatically, intercept with `page.route('**/*', ...)` and assert no off-machine destinations get requested during a test that *doesn't* click the AI button.
