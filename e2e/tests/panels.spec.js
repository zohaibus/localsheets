const { test, expect } = require('@playwright/test');
const { openApp, setCell, selectRange } = require('./_helpers');

test.describe('Modals & panels render and respond to controls', () => {
  test('AI panel opens, shows mode toggle, and closes on Escape', async ({ page }) => {
    await openApp(page);
    await page.locator('#btn-ai').click();
    const panel = page.locator('#ai-panel');
    await expect(panel).toBeVisible();
    // Both mode radios are present
    await expect(panel.locator('input[name="ai-mode"][value="text"]')).toBeVisible();
    await expect(panel.locator('input[name="ai-mode"][value="patch"]')).toBeVisible();
    // Close
    await page.locator('#ai-close').click();
    await expect(panel).toBeHidden();
  });

  test('Chart modal opens with bar selected and renders an SVG', async ({ page }) => {
    await openApp(page);
    // Lay out a small dataset: header row + 3 rows × 2 series
    await setCell(page, 0, 0, 'Month'); await setCell(page, 0, 1, 'Revenue'); await setCell(page, 0, 2, 'Costs');
    await setCell(page, 1, 0, 'Jan');   await setCell(page, 1, 1, '100');    await setCell(page, 1, 2, '60');
    await setCell(page, 2, 0, 'Feb');   await setCell(page, 2, 1, '120');    await setCell(page, 2, 2, '70');
    await setCell(page, 3, 0, 'Mar');   await setCell(page, 3, 1, '90');     await setCell(page, 3, 2, '80');
    await selectRange(page, 0, 0, 3, 2);

    // Open the Data menu and pick Chart selection
    await page.locator('#btn-data').click();
    await page.locator('#dd-data .dd-item', { hasText: /Chart selection/ }).first().click();
    const overlay = page.locator('#chart-overlay');
    await expect(overlay).toBeVisible();
    // SVG rendered with both bars and at least one text label
    const svg = page.locator('#chart-svg-wrap svg');
    await expect(svg).toBeVisible();
    await expect(svg.locator('rect').first()).toBeVisible();
    await expect(svg.locator('text').first()).toBeVisible();

    // Switch to Line and confirm path appears
    await page.locator('#chart-type').selectOption('line');
    await expect(page.locator('#chart-svg-wrap svg path').first()).toBeVisible();

    // Close
    await page.locator('#chart-close').click();
    await expect(overlay).toBeHidden();
  });

  test('Help overlay opens with version label', async ({ page }) => {
    await openApp(page);
    await page.locator('#btn-help').click();
    const overlay = page.locator('#help-overlay');
    await expect(overlay).toBeVisible();
    await expect(overlay).toContainText(/LocalSheets v1\.\d+/);
    await page.locator('#help-close').click();
    await expect(overlay).toBeHidden();
  });
});
