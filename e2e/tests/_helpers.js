// Shared helpers for the LocalSheets e2e suite.
// Coordinates are 0-based (r, c) to match the dataset attributes on cells.
const { APP_URL } = require('../playwright.config.js');

async function openApp(page) {
  await page.goto(APP_URL);
  await page.waitForSelector('.cell[data-r="0"][data-c="0"]', { state: 'attached' });
  await page.waitForLoadState('domcontentloaded');
}

async function cell(page, r, c) {
  return page.locator(`.cell[data-r="${r}"][data-c="${c}"]`).first();
}

async function clickCell(page, r, c) {
  // If an editor is currently open, commit it first (Enter) so the click on a
  // new cell doesn't get swallowed by the editor blur logic.
  if (await page.locator('input.editor').count()) {
    await page.keyboard.press('Enter').catch(() => {});
    await page.waitForSelector('input.editor', { state: 'detached' }).catch(() => {});
  }
  const td = await cell(page, r, c);
  await td.click();
}

// Setup helper: write a value to a cell via the Store API. Bypasses the
// keyboard/click dance entirely. Use for arranging test fixtures.
async function setCell(page, r, c, raw) {
  await page.evaluate(({ r, c, raw }) => {
    const { Store, E, Grid } = window.LocalSheets;
    Store.setCell(E.toCoord(r, c), raw);
    // Full re-render so any auto-extend + dependents get repainted
    if (Grid && typeof Grid.build === 'function') { Grid.build(); Grid.renderAll(); }
  }, { r, c, raw });
}

// Real-keyboard typing — for tests that specifically verify the typing UX.
// Forces the editor open + focused via JS, then types, then commits with Enter.
async function typeIntoCell(page, r, c, text) {
  await clickCell(page, r, c);
  // The click may or may not have entered edit mode depending on what was
  // selected previously. Force-open the editor.
  await page.evaluate(({ r, c }) => {
    const Sel = window.Selection || (window.LocalSheets && window.LocalSheets.Selection);
    // Selection isn't exposed on LocalSheets — but startEdit acts on current focus.
    // We already clicked the cell so focus is on (r, c).
    if (typeof window.startEdit === 'function' && !window.editing) {
      window.startEdit(null, true);
    }
  }, { r, c });
  const editor = page.locator('input.editor').first();
  await editor.waitFor({ state: 'visible', timeout: 1000 });
  await editor.focus();
  await editor.fill('');  // clear any preserved value
  await editor.type(String(text));
  await page.keyboard.press('Enter');
  // Wait for editor to close so the next op doesn't race with commit
  await page.waitForSelector('input.editor', { state: 'detached', timeout: 2000 }).catch(() => {});
}

async function readCell(page, r, c) {
  const td = await cell(page, r, c);
  const span = td.locator('.cell-val').first();
  return (await span.textContent())?.trim() || '';
}

async function readCellHtml(page, r, c) {
  const td = await cell(page, r, c);
  return await td.locator('.cell-val').first().innerHTML();
}

async function rightClickCell(page, r, c) {
  await clickCell(page, r, c);
  const td = await cell(page, r, c);
  await td.click({ button: 'right' });
}

async function selectRange(page, r1, c1, r2, c2) {
  const start = await cell(page, r1, c1);
  const end = await cell(page, r2, c2);
  await start.click();
  await end.click({ modifiers: ['Shift'] });
}

module.exports = { openApp, cell, clickCell, setCell, typeIntoCell, readCell, readCellHtml, rightClickCell, selectRange };
