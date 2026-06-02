const { test, expect } = require('@playwright/test');
const { openApp, cell, typeIntoCell, readCell, readCellHtml } = require('./_helpers');

test.describe('Formula evaluation surfaces correctly in the DOM', () => {
  test('SUM of a range evaluates and displays the number', async ({ page }) => {
    await openApp(page);
    await typeIntoCell(page, 0, 0, '10');
    await typeIntoCell(page, 1, 0, '20');
    await typeIntoCell(page, 2, 0, '30');
    await typeIntoCell(page, 3, 0, '=SUM(A1:A3)');
    expect(await readCell(page, 3, 0)).toBe('60');
  });

  test('changing an input recalculates downstream formulas', async ({ page }) => {
    await openApp(page);
    await typeIntoCell(page, 0, 0, '5');
    await typeIntoCell(page, 0, 1, '=A1*10');
    expect(await readCell(page, 0, 1)).toBe('50');
    await typeIntoCell(page, 0, 0, '7');
    expect(await readCell(page, 0, 1)).toBe('70');
  });

  test('=SPARKLINE renders as inline SVG inside the cell', async ({ page }) => {
    await openApp(page);
    for (let r = 0; r < 5; r++) await typeIntoCell(page, r, 0, String(r + 1));
    await typeIntoCell(page, 0, 1, '=SPARKLINE(A1:A5)');
    const span = (await cell(page, 0, 1)).locator('.cell-val').first();
    await expect(span).toHaveClass(/svg/);
    const svg = span.locator('svg');
    await expect(svg).toBeVisible();
    // Confirm SVG was real geometry (has a path) and not a literal text fallback
    await expect(svg.locator('path')).toBeVisible();
  });

  test('=SPARKLINE with bar type renders rects, not paths', async ({ page }) => {
    await openApp(page);
    for (let r = 0; r < 4; r++) await typeIntoCell(page, r, 0, String((r + 1) * 5));
    await typeIntoCell(page, 0, 1, '=SPARKLINE(A1:A4, "bar")');
    const svg = (await cell(page, 0, 1)).locator('.cell-val svg');
    await expect(svg).toBeVisible();
    await expect(svg.locator('rect').first()).toBeVisible();
  });

  test('division by zero shows #DIV/0! and propagates', async ({ page }) => {
    await openApp(page);
    await typeIntoCell(page, 0, 0, '=5/0');
    await typeIntoCell(page, 0, 1, '=A1+10');
    expect(await readCell(page, 0, 0)).toBe('#DIV/0!');
    expect(await readCell(page, 0, 1)).toBe('#DIV/0!');
  });

  test('user-typed text starting with SVG is not rendered as HTML (XSS guard)', async ({ page }) => {
    await openApp(page);
    // Try to inject — typed text gets stored verbatim
    await typeIntoCell(page, 0, 0, 'SVG<svg onload=alert(1)>');
    // The cell must show literal text, NOT render as an SVG element
    const span = (await cell(page, 0, 0)).locator('.cell-val').first();
    await expect(span).not.toHaveClass(/svg/);
    const html = await span.innerHTML();
    expect(html.toLowerCase()).not.toContain('<svg');
  });
});
