const { test, expect } = require('@playwright/test');
const { openApp, cell, readCell, typeIntoCell } = require('./_helpers');

test.describe('Render — grid materializes and shows what you type', () => {
  test('grid mounts with A1 visible and selected', async ({ page }) => {
    await openApp(page);
    const a1 = await cell(page, 0, 0);
    await expect(a1).toBeVisible();
    // Address box should show A1
    const addr = page.locator('#address-box, [data-test="address"]').first();
    // Fall back: status bar or formula-bar address label
    const anyAddr = page.locator('text=/^A1$/');
    await expect(anyAddr.first()).toBeVisible({ timeout: 3000 }).catch(() => {});
  });

  test('typing a number into a cell commits and is right-aligned', async ({ page }) => {
    await openApp(page);
    await typeIntoCell(page, 0, 0, '42');
    expect(await readCell(page, 0, 0)).toBe('42');
    const span = (await cell(page, 0, 0)).locator('.cell-val').first();
    await expect(span).toHaveClass(/num/);
  });

  test('typing text into a cell commits and is left-aligned (no num class)', async ({ page }) => {
    await openApp(page);
    await typeIntoCell(page, 0, 0, 'hello');
    expect(await readCell(page, 0, 0)).toBe('hello');
    const span = (await cell(page, 0, 0)).locator('.cell-val').first();
    await expect(span).not.toHaveClass(/num/);
  });

  test('grid auto-extends past initial chunk on arrow navigation', async ({ page }) => {
    await openApp(page);
    await (await cell(page, 0, 0)).click();
    // Use Ctrl+G to jump (Name Box should accept a coord)
    await page.keyboard.press('Control+g');
    await page.keyboard.type('Z40');
    await page.keyboard.press('Enter');
    // Z40 should now be rendered
    const target = await cell(page, 39, 25);
    await expect(target).toBeVisible({ timeout: 3000 });
  });

  test('Vertical scroll on narrow sheet does NOT auto-extend columns (freeze-pane regression)', async ({ page }) => {
    // Bug: when the table is narrower than the scroller (common with freeze
    // panes or just narrow data), `tbl.offsetWidth - scrollLeft - clientWidth`
    // went negative and tripped the column-extend branch on every vertical
    // wheel-scroll, so the column count kept growing to AZ, BZ, etc.
    await openApp(page);
    // Apply freeze top row to match the reported scenario
    await page.locator('#btn-freeze').click();
    await page.locator('#dd-freeze .dd-item', { hasText: /Freeze top row/ }).first().click();
    // Capture initial column count
    const before = await page.evaluate(() => window.LocalSheets.Grid.renderedCols);
    // Dispatch many vertical scroll events to trigger the auto-extend handler
    const scroller = page.locator('#grid-scroller');
    await scroller.evaluate(el => {
      for (let i = 0; i < 30; i++) {
        el.scrollTop += 200;
        el.dispatchEvent(new Event('scroll'));
      }
    });
    // Allow the requestAnimationFrame-debounced handler to fire
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => window.LocalSheets.Grid.renderedCols);
    expect(after).toBe(before);
  });
});
