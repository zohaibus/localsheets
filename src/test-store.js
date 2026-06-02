// Multi-sheet Store integration test
'use strict';
const fs = require('fs');
const path = require('path');

// Load engine
const E = require('./engine');
global.E = E; // app-layer references E as global

// Load app-layer code (it's not a module, just script)
const appCode = fs.readFileSync(path.join(__dirname, 'app-layer.js'), 'utf-8');
// Strip 'use strict' and execute in global scope by wrapping in IIFE that assigns to globals
const wrappedCode = appCode.replace(/^'use strict';\s*/m, '') + `
  // Expose to globals
  global.Store = Store;
  global.DepGraph = DepGraph;
  global.applyNumFmt = applyNumFmt;
  global.SCHEMA_VERSION = SCHEMA_VERSION;
  global.DEFAULT_COL_WIDTH = DEFAULT_COL_WIDTH;
`;
eval(wrappedCode);

// ──────────────────────────────────────────────
let passed = 0, failed = 0; const failures = [];
function test(name, fn) {
  try { fn(); passed++; process.stdout.write('.'); }
  catch (e) { failed++; failures.push({name, err: e}); process.stdout.write('F'); }
}
function eq(a, b, msg) {
  if (a !== b) throw new Error(`${msg||'eq'}: got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`);
}
function approx(a, b, eps = 1e-6) {
  if (typeof a !== 'number' || Math.abs(a - b) > eps) throw new Error(`approx: got ${a}, expected ~${b}`);
}

// Note: Store is a singleton, reset before each test
function resetStore() { Store.reset(); }

// ════════════════════════════════════════════════════════════════════
test('Store: single-sheet basic ops', () => {
  resetStore();
  Store.setCell('A1', '10');
  Store.setCell('A2', '20');
  Store.setCell('A3', '=A1+A2');
  eq(Store.getCell('A3').value, 30);
});

test('Store: dependency update', () => {
  resetStore();
  Store.setCell('A1', '10');
  Store.setCell('B1', '=A1*2');
  eq(Store.getCell('B1').value, 20);
  Store.setCell('A1', '50');
  eq(Store.getCell('B1').value, 100);
});

test('Store: undo', () => {
  resetStore();
  Store.setCell('A1', '10');
  Store.setCell('A1', '20');
  Store.undo();
  eq(Store.getCell('A1').value, 10);
});

test('Store: add sheet', () => {
  resetStore();
  const id = Store.addSheet('Q1');
  eq(Store.data.sheets[id].name, 'Q1');
  eq(Store.activeSheetId(), id);
  eq(Store.data.sheetOrder.length, 2);
});

test('Store: add sheet duplicate name auto-renames', () => {
  resetStore();
  Store.addSheet('Data');
  Store.addSheet('Data');
  // Second should be 'Data (2)'
  const names = Store.data.sheetOrder.map(id => Store.data.sheets[id].name);
  eq(names.includes('Data'), true);
  eq(names.includes('Data (2)'), true);
});

test('Store: cross-sheet formula', () => {
  resetStore();
  // Sheet1 already exists; add a Data sheet and reference it
  const dataId = Store.addSheet('Data');
  Store.setCell('A1', '999', {sheetId: dataId});
  // Switch back to Sheet1
  Store.setActiveSheet(Store.data.sheetOrder[0]);
  Store.setCell('A1', '=Data!A1');
  eq(Store.getCell('A1').value, 999);
});

test('Store: cross-sheet SUM', () => {
  resetStore();
  const dataId = Store.addSheet('Data');
  Store.setCell('B1', '100', {sheetId: dataId});
  Store.setCell('B2', '200', {sheetId: dataId});
  Store.setCell('B3', '300', {sheetId: dataId});
  Store.setActiveSheet(Store.data.sheetOrder[0]);
  Store.setCell('A1', '=SUM(Data!B1:B3)');
  eq(Store.getCell('A1').value, 600);
});

test('Store: cross-sheet auto-recalc on input change', () => {
  resetStore();
  const dataId = Store.addSheet('Inputs');
  Store.setCell('A1', '10', {sheetId: dataId});
  Store.setActiveSheet(Store.data.sheetOrder[0]);
  Store.setCell('B1', '=Inputs!A1*2');
  eq(Store.getCell('B1').value, 20);
  // Update on other sheet
  Store.setCell('A1', '50', {sheetId: dataId});
  eq(Store.getCell('B1').value, 100);
});

test('Store: rename sheet rewrites referencing formulas (bare name)', () => {
  resetStore();
  const dataId = Store.addSheet('Old');
  Store.setCell('A1', '42', {sheetId: dataId});
  Store.setActiveSheet(Store.data.sheetOrder[0]);
  Store.setCell('A1', '=Old!A1');
  eq(Store.getCell('A1').value, 42);
  Store.renameSheet(dataId, 'New');
  eq(Store.getCell('A1').formula, '=New!A1');
  eq(Store.getCell('A1').value, 42);
});

test('Store: rename to a name with spaces produces a quoted ref', () => {
  resetStore();
  const dataId = Store.addSheet('Old');
  Store.setCell('A1', '7', {sheetId: dataId});
  Store.setActiveSheet(Store.data.sheetOrder[0]);
  Store.setCell('B1', '=Old!A1*3');
  Store.renameSheet(dataId, 'My Data');
  eq(Store.getCell('B1').formula, "='My Data'!A1*3");
  eq(Store.getCell('B1').value, 21);
});

test('Store: delete sheet makes references break', () => {
  resetStore();
  const dataId = Store.addSheet('Temp');
  Store.setCell('A1', '99', {sheetId: dataId});
  Store.setActiveSheet(Store.data.sheetOrder[0]);
  Store.setCell('A1', '=Temp!A1');
  eq(Store.getCell('A1').value, 99);
  Store.deleteSheet(dataId);
  eq(Store.getCell('A1').value, E.ERR.REF);
});

test('Store: bulk undo restores tables, merges, rowHeights (regression)', () => {
  resetStore();
  Store.setCell('A1', 'x');
  Store._pushBulkUndo();
  let s = Store.activeSheet();
  s.rowHeights = { 0: 50 };
  s.tables = [{range: 'A1:C3'}];
  s.merges = ['A1:B2'];
  Store.undo();
  s = Store.activeSheet();
  eq(!!(s.rowHeights && s.rowHeights[0]), false, 'rowHeights restored');
  eq((s.tables || []).length, 0, 'table removed');
  eq((s.merges || []).length, 0, 'merge removed');
});

test('Store: redo replays after undo (regression)', () => {
  resetStore();
  Store.setCell('A1', '100');
  Store.setCell('A1', '200');
  Store.undo();
  eq(Store.getCell('A1').value, 100);
  Store.redo();
  eq(Store.getCell('A1').value, 200);
});

test('Store: redo of bulk action restores structural changes', () => {
  resetStore();
  Store.setCell('A1', 'before');
  Store._pushBulkUndo();
  const s = Store.activeSheet();
  s.cells['A1'] = { raw: 'after', value: 'after', type: 'text' };
  s.tables = [{range: 'A1:Z9'}];
  Store.undo();
  eq(Store.getCell('A1').value, 'before');
  eq((Store.activeSheet().tables || []).length, 0);
  Store.redo();
  eq(Store.getCell('A1').value, 'after');
  eq(Store.activeSheet().tables.length, 1);
});

test('Store: duplicate sheet preserves formulas', () => {
  resetStore();
  Store.setCell('A1', '10');
  Store.setCell('A2', '20');
  Store.setCell('A3', '=SUM(A1:A2)');
  const orig = Store.data.sheetOrder[0];
  const dup = Store.duplicateSheet(orig);
  eq(Store.activeSheetId(), dup);
  eq(Store.getCell('A3').value, 30);
});

test('Store: save and load v2.0 file with multi-sheet', () => {
  resetStore();
  Store.setCell('A1', '10');
  Store.setCell('A2', '20');
  Store.setCell('A3', '=SUM(A1:A2)');
  const dataId = Store.addSheet('Data');
  Store.setCell('B1', '999', {sheetId: dataId});
  Store.setActiveSheet(Store.data.sheetOrder[0]);
  Store.setCell('B1', '=Data!B1');

  const json = Store.toJSON();
  Store.reset();
  Store.loadJSON(json);

  eq(Store.getCell('A3').value, 30);
  eq(Store.getCell('B1').value, 999);
});

test('Store: load v1.x file migrates to v2.0', () => {
  resetStore();
  const v1 = JSON.stringify({
    tool: 'localsheets',
    version: '1.1',
    meta: { title: 'Old file' },
    cells: {
      A1: { raw: '10', value: 10, type: 'number' },
      A2: { raw: '20', value: 20, type: 'number' },
      A3: { raw: '=A1+A2', formula: '=A1+A2' }
    },
    settings: {}
  });
  Store.loadJSON(v1);
  eq(Store.data.version, '2.0');
  eq(Store.data.sheetOrder.length, 1);
  eq(Store.getCell('A3').value, 30);
});

test('Store: rejects v3.x file', () => {
  resetStore();
  let threw = false;
  try {
    Store.loadJSON(JSON.stringify({tool:'localsheets', version:'3.0', sheets:{}, sheetOrder:[], activeSheet:''}));
  } catch { threw = true; }
  eq(threw, true);
});

test('Store: cell count across sheets', () => {
  resetStore();
  Store.setCell('A1', 'a');
  Store.setCell('B1', 'b');
  const s2 = Store.addSheet('Two');
  Store.setCell('A1', 'c', {sheetId: s2});
  eq(Store.cellCount(), 3);
});

test('Store: column width per sheet', () => {
  resetStore();
  Store.setColWidth(0, 150);
  eq(Store.getColWidth(0), 150);
  const s2 = Store.addSheet('Two'); // active becomes s2
  eq(Store.getColWidth(0), DEFAULT_COL_WIDTH); // default on new sheet
});

test('Store: quoted sheet name', () => {
  resetStore();
  const id = Store.addSheet('Q1 Sales');
  Store.setCell('A1', '5000', {sheetId: id});
  Store.setActiveSheet(Store.data.sheetOrder[0]);
  Store.setCell('A1', "='Q1 Sales'!A1");
  eq(Store.getCell('A1').value, 5000);
});

test('Store: deleting active sheet switches active', () => {
  resetStore();
  const orig = Store.data.sheetOrder[0];
  const s2 = Store.addSheet('Two');
  Store.deleteSheet(s2);
  eq(Store.activeSheetId(), orig);
});

test('Store: cannot delete the last remaining sheet', () => {
  resetStore();
  const orig = Store.data.sheetOrder[0];
  const result = Store.deleteSheet(orig);
  eq(result, false);
});

test('Store: percent format', () => {
  resetStore();
  Store.setCell('A1', '0.42');
  Store.setFormat('A1', {numfmt: 'percent'});
  eq(Store.getDisplay('A1'), '42%');
});

test('Store: date format', () => {
  resetStore();
  Store.setCell('A1', '=DATE(2026, 5, 24)');
  Store.setFormat('A1', {numfmt: 'date'});
  eq(Store.getDisplay('A1'), '2026-05-24');
});

test('Store: undo workbook-level (delete sheet)', () => {
  resetStore();
  const s2 = Store.addSheet('Two');
  Store.setCell('A1', '999', {sheetId: s2});
  Store.deleteSheet(s2);
  eq(Store.data.sheetOrder.length, 1);
  Store.undo();
  eq(Store.data.sheetOrder.length, 2);
});

// ════════════════════════════════════════════════════════════════════
// Structural operations: insertRow / deleteRow / insertCol / deleteCol
// ════════════════════════════════════════════════════════════════════

test('Store: shiftRangeRow on insert (delta=+1)', () => {
  resetStore();
  // insert at row 1 (zero-based) — rows >= 1 shift down by 1
  eq(Store.shiftRangeRow('A1:C3', 1, +1), 'A1:C4');   // r1=0 stays, r2=2 → 3
  eq(Store.shiftRangeRow('A2:C3', 1, +1), 'A3:C4');   // both shift
  eq(Store.shiftRangeRow('A1:C1', 5, +1), 'A1:C1');   // before insertion point — unchanged
});

test('Store: shiftRangeRow on delete (delta=-1)', () => {
  resetStore();
  // delete row 2 (zero-based)
  eq(Store.shiftRangeRow('A1:C5', 2, -1), 'A1:C4');   // r2=4 → 3, r1=0 stays
  eq(Store.shiftRangeRow('A4:C6', 2, -1), 'A3:C5');   // both shift up
  eq(Store.shiftRangeRow('A3:C3', 2, -1), null);      // single-row range collapses (=> caller drops it)
});

test('Store: shiftRangeCol on insert / delete', () => {
  resetStore();
  eq(Store.shiftRangeCol('A1:C3', 1, +1), 'A1:D3');   // insert col 1 (B) — A stays, C→D
  eq(Store.shiftRangeCol('B1:D3', 1, +1), 'C1:E3');   // both shift right
  eq(Store.shiftRangeCol('A1:E5', 2, -1), 'A1:D5');   // delete col C → E→D
  eq(Store.shiftRangeCol('C1:C5', 2, -1), null);      // single-col range collapses
});

test('Store: insertRow shifts cells below', () => {
  resetStore();
  Store.setCell('A1', 'top');
  Store.setCell('A2', 'mid');
  Store.setCell('A3', 'bot');
  Store.insertRow(1); // insert at row 1 (zero-based, between A1 and A2)
  eq(Store.getCell('A1').value, 'top');
  eq(Store.getCell('A2'), null);
  eq(Store.getCell('A3').value, 'mid');
  eq(Store.getCell('A4').value, 'bot');
});

test('Store: insertRow shifts row heights', () => {
  resetStore();
  Store.setRowHeight(0, 40);
  Store.setRowHeight(2, 60);
  Store.insertRow(1);
  eq(Store.getRowHeight(0), 40);   // before insertion point — unchanged
  eq(Store.getRowHeight(1), 22);   // newly inserted row — default
  eq(Store.getRowHeight(3), 60);   // row 2 shifted to row 3
});

test('Store: insertRow shifts table ranges', () => {
  resetStore();
  Store.activeSheet().tables = [{range: 'A1:C5'}];
  Store.insertRow(2);
  eq(Store.activeSheet().tables[0].range, 'A1:C6');
});

test('Store: insertRow shifts merges', () => {
  resetStore();
  Store.activeSheet().merges = ['B2:D3'];
  Store.insertRow(1);
  eq(Store.activeSheet().merges[0], 'B3:D4');
});

test('Store: insertRow shifts conditional rules', () => {
  resetStore();
  Store.activeSheet().conditionalRules = [{range: 'A2:A5', op: '>', value: 100}];
  Store.insertRow(1);
  eq(Store.activeSheet().conditionalRules[0].range, 'A3:A6');
});

test('Store: deleteRow removes cells in that row, shifts below up', () => {
  resetStore();
  Store.setCell('A1', 'top');
  Store.setCell('A2', 'mid');
  Store.setCell('A3', 'bot');
  Store.deleteRow(1); // delete A2
  eq(Store.getCell('A1').value, 'top');
  eq(Store.getCell('A2').value, 'bot');
  eq(Store.getCell('A3'), null);
});

test('Store: deleteRow collapses single-row table', () => {
  resetStore();
  Store.activeSheet().tables = [
    {range: 'A2:C2'},  // single-row table on row 1 — will collapse
    {range: 'A4:C6'},  // multi-row — will shift up
  ];
  Store.deleteRow(1);
  eq(Store.activeSheet().tables.length, 1);
  eq(Store.activeSheet().tables[0].range, 'A3:C5');
});

test('Store: deleteRow shifts row heights past the deletion', () => {
  resetStore();
  Store.setRowHeight(0, 40);
  Store.setRowHeight(2, 60);   // will shift to row 1
  Store.setRowHeight(1, 30);   // gets deleted
  Store.deleteRow(1);
  eq(Store.getRowHeight(0), 40);
  eq(Store.getRowHeight(1), 60);
  eq(Store.getRowHeight(2), 22); // default — row 2 had nothing originally
});

test('Store: insertCol shifts cells right', () => {
  resetStore();
  Store.setCell('A1', 'a');
  Store.setCell('B1', 'b');
  Store.setCell('C1', 'c');
  Store.insertCol(1); // insert between A and B
  eq(Store.getCell('A1').value, 'a');
  eq(Store.getCell('B1'), null);
  eq(Store.getCell('C1').value, 'b');
  eq(Store.getCell('D1').value, 'c');
});

test('Store: insertCol shifts colWidths', () => {
  resetStore();
  Store.setColWidth(0, 150);
  Store.setColWidth(2, 200);
  Store.insertCol(1);
  eq(Store.getColWidth(0), 150);
  eq(Store.getColWidth(1), DEFAULT_COL_WIDTH);
  eq(Store.getColWidth(3), 200);
});

test('Store: insertCol shifts filter keys', () => {
  resetStore();
  Store.activeSheet().filters = { 2: ['x', 'y'] };
  Store.insertCol(1);
  eq(Store.activeSheet().filters[3].length, 2);
  eq(Store.activeSheet().filters[2], undefined);
});

test('Store: deleteCol removes column, shifts right side left', () => {
  resetStore();
  Store.setCell('A1', 'a');
  Store.setCell('B1', 'b');
  Store.setCell('C1', 'c');
  Store.deleteCol(1); // delete B
  eq(Store.getCell('A1').value, 'a');
  eq(Store.getCell('B1').value, 'c');
  eq(Store.getCell('C1'), null);
});

test('Store: deleteCol collapses single-col table/merge', () => {
  resetStore();
  Store.activeSheet().tables = [{range: 'B1:B5'}];
  Store.activeSheet().merges = ['B1:B5'];
  Store.deleteCol(1);
  eq(Store.activeSheet().tables.length, 0);
  eq(Store.activeSheet().merges.length, 0);
});

test('Store: insertRow undo restores cells + tables + rowHeights', () => {
  resetStore();
  Store.setCell('A2', 'original');
  Store.activeSheet().tables = [{range: 'A1:C3'}];
  Store.setRowHeight(2, 80);
  Store.insertRow(1);
  // verify shift happened
  eq(Store.getCell('A3').value, 'original');
  eq(Store.activeSheet().tables[0].range, 'A1:C4');
  eq(Store.getRowHeight(3), 80);
  // undo
  Store.undo();
  eq(Store.getCell('A2').value, 'original');
  eq(Store.getCell('A3'), null);
  eq(Store.activeSheet().tables[0].range, 'A1:C3');
  eq(Store.getRowHeight(2), 80);
});

test('Store: deleteRow undo restores deleted cells', () => {
  resetStore();
  Store.setCell('A1', 'a');
  Store.setCell('A2', 'b');
  Store.setCell('A3', 'c');
  Store.deleteRow(1);
  eq(Store.getCell('A2').value, 'c');
  Store.undo();
  eq(Store.getCell('A1').value, 'a');
  eq(Store.getCell('A2').value, 'b');
  eq(Store.getCell('A3').value, 'c');
});

test('Store: deleteCol undo restores deleted cells', () => {
  resetStore();
  Store.setCell('A1', 'a');
  Store.setCell('B1', 'b');
  Store.setCell('C1', 'c');
  Store.deleteCol(1);
  eq(Store.getCell('B1').value, 'c');
  Store.undo();
  eq(Store.getCell('A1').value, 'a');
  eq(Store.getCell('B1').value, 'b');
  eq(Store.getCell('C1').value, 'c');
});

test('Store: insertRow + redo replays the insertion', () => {
  resetStore();
  Store.setCell('A1', 'one');
  Store.setCell('A2', 'two');
  Store.insertRow(1);
  Store.undo();
  eq(Store.getCell('A2').value, 'two');
  Store.redo();
  eq(Store.getCell('A2'), null);
  eq(Store.getCell('A3').value, 'two');
});

test('Store: insertRow opts.pushUndo=false skips undo capture', () => {
  resetStore();
  Store.setCell('A1', 'keep'); // single cell-level undo
  const stackLen = Store.undoStack.length;
  Store.insertRow(0, {pushUndo: false});
  eq(Store.undoStack.length, stackLen); // no new frame pushed
});

// ── Structural changes rewrite formula text (regression for the missing layer)
test('Store: insertRow rewrites formula text in pointing cells', () => {
  resetStore();
  Store.setCell('A2', '5');
  Store.setCell('B1', '=A2');
  eq(Store.getCell('B1').value, 5);
  Store.insertRow(1);  // insert at row index 1 (between A1 and A2)
  eq(Store.getCell('A3').value, 5);
  eq(Store.getCell('B1').formula, '=A3', 'formula text should shift A2 → A3');
  eq(Store.getCell('B1').value, 5);
});

test('Store: deleteRow invalidates pointing formulas to #REF!', () => {
  resetStore();
  Store.setCell('A2', '5');
  Store.setCell('B1', '=A2');
  eq(Store.getCell('B1').value, 5);
  Store.deleteRow(1);  // delete row 2 (index 1)
  eq(Store.getCell('B1').formula, '=#REF!');
  eq(Store.getCell('B1').value, E.ERR.REF);
});

test('Store: insertCol rewrites formula refs in same sheet', () => {
  resetStore();
  Store.setCell('B1', '10');
  Store.setCell('A1', '=B1');
  eq(Store.getCell('A1').value, 10);
  Store.insertCol(1);  // insert before B → B becomes C
  eq(Store.getCell('A1').formula, '=C1');
  eq(Store.getCell('A1').value, 10);
});

test('Store: deleteCol invalidates pointing formulas to #REF!', () => {
  resetStore();
  Store.setCell('B1', '10');
  Store.setCell('A1', '=B1');
  Store.deleteCol(1);  // delete column B
  eq(Store.getCell('A1').formula, '=#REF!');
  eq(Store.getCell('A1').value, E.ERR.REF);
});

test('Store: cross-sheet ref shifts when target sheet has row inserted', () => {
  resetStore();
  const dataId = Store.addSheet('Data');
  Store.setCell('A2', '99', {sheetId: dataId});
  Store.setActiveSheet(Store.data.sheetOrder[0]);
  Store.setCell('A1', '=Data!A2');
  eq(Store.getCell('A1').value, 99);
  // Switch to Data sheet and insert a row
  Store.setActiveSheet(dataId);
  Store.insertRow(1);
  // Switch back to Sheet1 and verify ref was updated
  Store.setActiveSheet(Store.data.sheetOrder[0]);
  eq(Store.getCell('A1').formula, '=Data!A3');
  eq(Store.getCell('A1').value, 99);
});

test('Store: cross-sheet ref to deleted row becomes #REF!', () => {
  resetStore();
  const dataId = Store.addSheet('Data');
  Store.setCell('A2', '99', {sheetId: dataId});
  Store.setActiveSheet(Store.data.sheetOrder[0]);
  Store.setCell('A1', '=Data!A2');
  // Switch to Data and delete row 2
  Store.setActiveSheet(dataId);
  Store.deleteRow(1);
  Store.setActiveSheet(Store.data.sheetOrder[0]);
  // Sheet prefix is dropped when ref is invalidated (=Data!#REF! wouldn't tokenize)
  eq(Store.getCell('A1').formula, '=#REF!');
  eq(Store.getCell('A1').value, E.ERR.REF);
});

test('Store: insertRow undo restores original formulas', () => {
  resetStore();
  Store.setCell('A2', '5');
  Store.setCell('B1', '=A2');
  Store.insertRow(1);
  eq(Store.getCell('B1').formula, '=A3');
  Store.undo();
  eq(Store.getCell('B1').formula, '=A2');
  eq(Store.getCell('B1').value, 5);
});

test('Store: deleteRow undo restores invalidated formulas', () => {
  resetStore();
  Store.setCell('A2', '5');
  Store.setCell('B1', '=A2');
  Store.deleteRow(1);
  eq(Store.getCell('B1').formula, '=#REF!');
  Store.undo();
  eq(Store.getCell('B1').formula, '=A2');
  eq(Store.getCell('B1').value, 5);
});

test('Store: insertRow into middle of SUM range shifts upper bound', () => {
  resetStore();
  for (let r = 0; r < 5; r++) Store.setCell(E.toCoord(r, 0), String(r + 1));
  Store.setCell('B1', '=SUM(A1:A5)');
  eq(Store.getCell('B1').value, 15);
  Store.insertRow(2); // insert between A2 and A3
  eq(Store.getCell('B1').formula, '=SUM(A1:A6)');
  eq(Store.getCell('B1').value, 15);  // new empty row is 0
});

// ════════════════════════════════════════════════════════════════════

console.log('\n');
console.log(`${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures) {
    console.log(`  ✗ ${f.name}`);
    console.log(`    ${f.err.message}`);
  }
  process.exit(1);
}
process.exit(0);
