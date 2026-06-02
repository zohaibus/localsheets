const { test, expect } = require('@playwright/test');
const path = require('path');
const { openApp, typeIntoCell, readCell, setCell } = require('./_helpers');

test.describe('Persistence — save/load round-trips through real JSON', () => {
  // Save-as-download is browser-specific (Chrome on file:// may use FSAPI).
  // We assert the serialization contract directly via Store.toJSON() — the
  // SAME function the Ctrl+S handler calls before writing to disk.
  test('Store.toJSON produces v2.0 schema with formulas stripped of cached values', async ({ page }) => {
    await openApp(page);
    await setCell(page, 0, 0, 'hello');
    await setCell(page, 0, 1, '42');
    await setCell(page, 1, 0, '=B1*2');

    const jsonText = await page.evaluate(() => window.LocalSheets.Store.toJSON());
    const json = JSON.parse(jsonText);

    expect(json.tool).toBe('localsheets');
    expect(json.version).toBe('2.0');
    const sheetId = json.sheetOrder[0];
    const cells = json.sheets[sheetId].cells;
    expect(cells.A1.value).toBe('hello');
    expect(cells.B1.value).toBe(42);
    expect(cells.A2.formula).toBe('=B1*2');
    // Formula cells should NOT carry a cached value in the saved file
    expect(cells.A2.value).toBeUndefined();
  });

  test('Save and reload round-trips formulas and recomputes on load', async ({ page }) => {
    await openApp(page);
    await setCell(page, 0, 0, '10');
    await setCell(page, 0, 1, '20');
    await setCell(page, 0, 2, '=A1+B1');
    expect(await readCell(page, 0, 2)).toBe('30');

    const roundTripped = await page.evaluate(() => {
      const json = window.LocalSheets.Store.toJSON();
      window.LocalSheets.Store.loadJSON(json);
      return window.LocalSheets.Store.getCell('C1').value;
    });
    expect(roundTripped).toBe(30);
  });

  test('Opening a known template loads multi-sheet workbook + computes', async ({ page }) => {
    await openApp(page);
    const templatePath = path.resolve(__dirname, '..', '..', 'templates', 'robot-arm-pid-calibration.localsheet.json');
    // Use the hidden file input to load
    const fileInput = page.locator('#input-open');
    await fileInput.setInputFiles(templatePath);
    // Wait for sheet tabs to render (template has Joints + Computed)
    await expect(page.locator('.tab', { hasText: 'Joints' })).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.tab', { hasText: 'Computed' })).toBeVisible();
    // On the Computed sheet, verify the first joint's natural frequency rounds to ~13.69
    await page.locator('.tab', { hasText: 'Computed' }).click();
    const b2 = await readCell(page, 1, 1);
    expect(b2).toMatch(/^13\.69/);
  });

  test('JSONL import populates header from union of keys + types numeric values', async ({ page }) => {
    await openApp(page);
    const jsonlPath = path.resolve(__dirname, '..', '..', 'templates', 'joint-telemetry.jsonl');
    // The same hidden input handles CSV + JSONL; dispatcher auto-detects by content
    await page.locator('#input-csv').setInputFiles(jsonlPath);
    // Header row from the union of keys (in first-appearance order)
    expect(await readCell(page, 0, 0)).toBe('timestamp');
    expect(await readCell(page, 0, 1)).toBe('joint');
    expect(await readCell(page, 0, 4)).toBe('torque_Nm');
    expect(await readCell(page, 0, 7)).toBe('status');
    // First data row: numbers should be typed as number (right-aligned via .num)
    expect(await readCell(page, 1, 1)).toBe('J1');
    const a2 = (await page.locator('.cell[data-r="1"][data-c="0"] .cell-val').first());
    await expect(a2).toHaveClass(/num/);
    // 'status' field only appears on later lines — early row should be blank
    expect(await readCell(page, 2, 7)).toBe('');
    // First row with status (line 23 in source, sheet row 23 because of header)
    expect(await readCell(page, 23, 7)).toBe('stable');
  });

  test('Loaded template with =SPARKLINE renders inline SVG in the cell', async ({ page }) => {
    await openApp(page);
    const templatePath = path.resolve(__dirname, '..', '..', 'templates', 'monthly-budget.localsheet.json');
    await page.locator('#input-open').setInputFiles(templatePath);
    // monthly-budget E9 has =SPARKLINE(B9:C9, "bar", "#5a4a2f")
    const e9 = page.locator('.cell[data-r="8"][data-c="4"]').first();
    await expect(e9.locator('.cell-val')).toHaveClass(/svg/, { timeout: 3000 });
    await expect(e9.locator('.cell-val svg')).toBeVisible();
    await expect(e9.locator('.cell-val svg rect').first()).toBeVisible();
    // Verify the SVG_MARKER never leaked into displayed text (XSS / sanitization regression)
    const text = await e9.locator('.cell-val').first().textContent();
    expect(text).not.toContain('SVG');
    expect(text).not.toContain('<svg');
  });
});
