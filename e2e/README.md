# LocalSheets — Browser E2E Tests

Headless browser verification using [Playwright](https://playwright.dev). **This directory is dev tooling — it is NOT part of the shipped product.** The deliverable (`localsheets.html`) still has zero runtime dependencies. Playwright lives here so it never touches what users download.

## What it covers

**28 specs across 6 files (Chromium primary, WebKit cross-engine, Firefox out of scope for v1.1).**

| Spec | Count | What it checks |
|---|---|---|
| `render.spec.js` | 5 | Grid mounts, A1 visible, typing numbers/text commits with correct alignment, Ctrl+G jumps and auto-extends, **freeze-pane regression** (vertical scroll on narrow sheet doesn't auto-extend columns) |
| `editing.spec.js` | 5 | Enter navigation, Ctrl+Z/Y undo+redo, right-click doesn't trigger edit mode, right-click → Delete row works |
| `structural.spec.js` | 4 | Insert/delete row/col rewrites pointing formulas (`#REF!` invalidation, range shift); fill-handle drag propagates relative refs |
| `formulas.spec.js` | 6 | `SUM`, recalc cascades, `=SPARKLINE()` actually emits SVG (line + bar variants), `#DIV/0!` propagation, XSS guard on user-typed `SVG<svg>` text |
| `persistence.spec.js` | 5 | `Store.toJSON()` produces v2.0 schema with formulas stripped of cached values; round-trip restores formulas and re-evaluates; opening a template loads multi-sheet workbook with live computed values; **JSONL import** auto-detects + maps union of keys to headers; **template SPARKLINE renders inline SVG** with XSS guard |
| `panels.spec.js` | 3 | AI panel opens/closes with mode toggle visible; Chart modal opens, switches type (bar↔line), renders real `<svg>` with rects/paths/labels; Help overlay shows version |

## Live AI verification

`verify-ai-live.js` is a standalone Node script (not a Playwright spec) that talks to a real local Ollama instance and runs the same HTTP calls the AI panel makes from the browser. Run it before tagging any release that touches the AI module.

```bash
node verify-ai-live.js                    # uses first available model
node verify-ai-live.js --model=llama3.2:3b
```

It tests reachability, CORS for `Origin: null` (the `file://` case the app actually hits), text-mode generation, and JSON-patch-mode structured output — exit 0 on all pass. See [STATUS.md](STATUS.md#live-ai-verification-ollama) for full details + last-verified results.

## What it doesn't cover

Subjective things you still need eyeballs for:
- Colors look right in light + dark themes
- Font sizing / wrapping looks ok
- Animations feel smooth
- Drag interactions are responsive (not janky)
- Mouse cursor changes during format-painter mode
- Browser-controlled prompts (`beforeunload`, file-save dialog title)
- Cross-platform clipboard interop with real Excel / Google Sheets

Spot-check those in a real browser before tagging a release.

## Run

```bash
cd e2e
npm install              # ~50 MB for Playwright (one-time)
npm run install-browsers # ~600 MB for Chromium + Firefox + WebKit (one-time)
npm test                 # runs all three browsers in parallel
```

Other useful commands:
```bash
npm run test:chromium    # just Chromium (fastest)
npm run test:headed      # watch the browser run the tests
npm run report           # open the HTML report after a run
```

## Why not bundle this with the shipped repo?

The whole point of LocalSheets is **zero runtime dependencies**. The `localsheets.html` file you download and use has no npm, no CDN, no build step. The `e2e/` directory contains dev tooling that the maintainer uses to verify releases before tagging — it's analogous to the test suite of any compiler, but kept physically separate so the line is unambiguous.

`e2e/node_modules/`, `e2e/test-results/`, and `e2e/playwright-report/` are gitignored. Only the spec files, config, and `package.json` (with one devDependency) are tracked.
