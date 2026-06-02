const { test, expect } = require('@playwright/test');
const { openApp, cell, clickCell, typeIntoCell, readCell, rightClickCell } = require('./_helpers');

test.describe('Editing — keyboard, selection, undo/redo', () => {
  test('Enter commits and moves down; arrows navigate', async ({ page }) => {
    await openApp(page);
    await typeIntoCell(page, 0, 0, '1');
    await page.keyboard.type('2');
    await page.keyboard.press('Enter');
    await page.keyboard.type('3');
    await page.keyboard.press('Enter');
    expect(await readCell(page, 0, 0)).toBe('1');
    expect(await readCell(page, 1, 0)).toBe('2');
    expect(await readCell(page, 2, 0)).toBe('3');
  });

  test('Ctrl+Z undoes the last typed cell', async ({ page }) => {
    await openApp(page);
    await typeIntoCell(page, 0, 0, '99');
    expect(await readCell(page, 0, 0)).toBe('99');
    await page.keyboard.press('Control+z');
    expect(await readCell(page, 0, 0)).toBe('');
  });

  test('Ctrl+Y redoes', async ({ page }) => {
    await openApp(page);
    await typeIntoCell(page, 0, 0, '99');
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+y');
    expect(await readCell(page, 0, 0)).toBe('99');
  });

  test('Right-click does NOT deselect or enter edit mode (regression)', async ({ page }) => {
    await openApp(page);
    await typeIntoCell(page, 0, 0, 'keep');
    await clickCell(page, 0, 0);
    // Right-click the selected cell
    await rightClickCell(page, 0, 0);
    // Context menu should be visible
    const ctx = page.locator('#ctx-menu');
    await expect(ctx).toBeVisible();
    // Close it (click elsewhere)
    await page.keyboard.press('Escape');
    // Cell value should be unchanged (no accidental edit-then-blank)
    expect(await readCell(page, 0, 0)).toBe('keep');
  });

  test('Right-click → Delete row removes the row', async ({ page }) => {
    await openApp(page);
    await typeIntoCell(page, 0, 0, 'top');
    await typeIntoCell(page, 1, 0, 'middle');
    await typeIntoCell(page, 2, 0, 'bottom');
    await clickCell(page, 1, 0);
    await rightClickCell(page, 1, 0);
    await page.locator('#ctx-menu .dd-item', { hasText: /Delete row/ }).first().click();
    expect(await readCell(page, 0, 0)).toBe('top');
    expect(await readCell(page, 1, 0)).toBe('bottom');
  });
});
