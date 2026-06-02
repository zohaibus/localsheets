const { test, expect } = require('@playwright/test');
const { openApp, cell, clickCell, typeIntoCell, readCell, rightClickCell } = require('./_helpers');

test.describe('Structural ops rewrite formula text (Excel-style)', () => {
  test('insertRow shifts a pointing formula', async ({ page }) => {
    await openApp(page);
    await typeIntoCell(page, 1, 0, '5');      // A2 = 5
    await typeIntoCell(page, 0, 1, '=A2');    // B1 = =A2
    expect(await readCell(page, 0, 1)).toBe('5');
    // Right-click row 1 (the second row) → Insert row above
    await clickCell(page, 1, 0);
    await rightClickCell(page, 1, 0);
    await page.locator('#ctx-menu .dd-item', { hasText: /Insert row above/ }).first().click();
    // The data formerly at A2 is now at A3; B1 should still show 5
    expect(await readCell(page, 0, 1)).toBe('5');
    expect(await readCell(page, 2, 0)).toBe('5');
  });

  test('deleteRow invalidates pointing formula to #REF!', async ({ page }) => {
    await openApp(page);
    await typeIntoCell(page, 1, 0, '5');
    await typeIntoCell(page, 0, 1, '=A2');
    expect(await readCell(page, 0, 1)).toBe('5');
    await clickCell(page, 1, 0);
    await rightClickCell(page, 1, 0);
    await page.locator('#ctx-menu .dd-item', { hasText: /Delete row/ }).first().click();
    // B1 should now show #REF!
    expect(await readCell(page, 0, 1)).toBe('#REF!');
  });

  test('insertCol shifts a pointing formula right', async ({ page }) => {
    await openApp(page);
    await typeIntoCell(page, 0, 1, '10');       // B1 = 10
    await typeIntoCell(page, 0, 0, '=B1');      // A1 = =B1
    expect(await readCell(page, 0, 0)).toBe('10');
    // Right-click a cell in column B → Insert column left
    await rightClickCell(page, 0, 1);
    await page.locator('#ctx-menu .dd-item', { hasText: /Insert column left/ }).first().click();
    // After inserting a column before B, the previous B1 shifts to C1.
    // A1's formula =B1 should rewrite to =C1, so value still shows 10.
    expect(await readCell(page, 0, 0)).toBe('10');
  });
});

test.describe('Fill handle drag propagates formulas', () => {
  test('drag formula down → row refs shift', async ({ page }) => {
    await openApp(page);
    await typeIntoCell(page, 0, 0, '1');
    await typeIntoCell(page, 1, 0, '2');
    await typeIntoCell(page, 2, 0, '3');
    await typeIntoCell(page, 0, 1, '=A1*10');
    expect(await readCell(page, 0, 1)).toBe('10');
    // Select B1 to expose the fill handle
    await clickCell(page, 0, 1);
    const handle = page.locator('.fill-handle').first();
    await expect(handle).toBeVisible();
    // Drag from the fill handle down to B3
    const handleBox = await handle.boundingBox();
    const targetCell = await cell(page, 2, 1);
    const targetBox = await targetCell.boundingBox();
    if (!handleBox || !targetBox) throw new Error('Could not measure fill handle / target');
    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 10 });
    await page.mouse.up();
    // B2 should show 20 (=A2*10), B3 should show 30 (=A3*10)
    expect(await readCell(page, 1, 1)).toBe('20');
    expect(await readCell(page, 2, 1)).toBe('30');
  });
});
