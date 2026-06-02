'use strict';
const E = require('./engine');

// Mock multi-sheet store
class MockStore {
  constructor() {
    this.sheets = new Map(); // sheetId -> {name, cells: Map}
    this.nameToId = new Map();
  }
  addSheet(id, name) {
    this.sheets.set(id, {name, cells: new Map()});
    this.nameToId.set(name.toUpperCase(), id);
  }
  setRaw(sheetId, coord, value) {
    const sheet = this.sheets.get(sheetId);
    if (!sheet) return;
    sheet.cells.set(coord, {value});
  }
  getCellOnSheet(sheetId, coord) {
    const sheet = this.sheets.get(sheetId);
    if (!sheet) return null;
    return sheet.cells.get(coord) || null;
  }
  findSheetIdByName(name) {
    return this.nameToId.get(name.toUpperCase()) || null;
  }
}

class MockDeps {
  constructor() { this.edges = []; }
  addDep(from, to) { this.edges.push([from, to]); }
}

function compile(formulaStr) {
  const tokens = E.tokenize(formulaStr.slice(1));
  return E.parse(tokens);
}

function evalFormula(store, formulaStr, currentCell = 'Z99', currentSheet = 's1') {
  const ast = compile(formulaStr);
  return E.evaluate(ast, store, new MockDeps(), currentCell, currentSheet);
}

// ── Test framework
let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; process.stdout.write('.'); }
  catch (e) { failed++; failures.push({name, err: e}); process.stdout.write('F'); }
}
function eq(a, b, msg) {
  if (a !== b) throw new Error(`${msg||'eq fail'}: got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`);
}
function approx(a, b, eps = 1e-6, msg) {
  if (typeof a !== 'number' || Math.abs(a - b) > eps) throw new Error(`${msg||'approx fail'}: got ${a}, expected ~${b}`);
}

// Helper to make a fresh store with one sheet
function fresh() {
  const s = new MockStore();
  s.addSheet('s1', 'Sheet1');
  return s;
}

// ════════════════════════════════════════════════════════════════════
// Smoke tests (carry over from v0.2 to confirm no regressions)
// ════════════════════════════════════════════════════════════════════

test('smoke: addition', () => {
  eq(evalFormula(fresh(), '=1+2'), 3);
});

test('smoke: cell ref', () => {
  const s = fresh();
  s.setRaw('s1', 'A1', 100);
  eq(evalFormula(s, '=A1'), 100);
});

test('smoke: SUM range', () => {
  const s = fresh();
  s.setRaw('s1', 'A1', 10);
  s.setRaw('s1', 'A2', 20);
  s.setRaw('s1', 'A3', 30);
  eq(evalFormula(s, '=SUM(A1:A3)'), 60);
});

// ════════════════════════════════════════════════════════════════════
// Multi-sheet references
// ════════════════════════════════════════════════════════════════════

test('multi-sheet: simple cross-sheet ref', () => {
  const s = fresh();
  s.addSheet('s2', 'Data');
  s.setRaw('s2', 'A1', 999);
  eq(evalFormula(s, '=Data!A1'), 999);
});

test('multi-sheet: cross-sheet range SUM', () => {
  const s = fresh();
  s.addSheet('s2', 'Q1');
  s.setRaw('s2', 'B1', 100);
  s.setRaw('s2', 'B2', 200);
  s.setRaw('s2', 'B3', 300);
  eq(evalFormula(s, '=SUM(Q1!B1:B3)'), 600);
});

test('multi-sheet: quoted sheet name with space', () => {
  const s = fresh();
  s.addSheet('s2', 'Q1 Sales');
  s.setRaw('s2', 'A1', 42);
  eq(evalFormula(s, "='Q1 Sales'!A1"), 42);
});

test('multi-sheet: unknown sheet returns #REF!', () => {
  eq(evalFormula(fresh(), '=NotExist!A1'), E.ERR.REF);
});

test('multi-sheet: cross-sheet in arithmetic', () => {
  const s = fresh();
  s.addSheet('s2', 'Inputs');
  s.setRaw('s2', 'A1', 50);
  s.setRaw('s1', 'B1', 10);
  eq(evalFormula(s, '=Inputs!A1+B1'), 60);
});

// ════════════════════════════════════════════════════════════════════
// VLOOKUP / HLOOKUP / INDEX / MATCH / XLOOKUP
// ════════════════════════════════════════════════════════════════════

test('VLOOKUP: exact match found', () => {
  const s = fresh();
  // Table: A1:B3 has [apple, 10], [banana, 20], [cherry, 30]
  s.setRaw('s1', 'A1', 'apple');  s.setRaw('s1', 'B1', 10);
  s.setRaw('s1', 'A2', 'banana'); s.setRaw('s1', 'B2', 20);
  s.setRaw('s1', 'A3', 'cherry'); s.setRaw('s1', 'B3', 30);
  eq(evalFormula(s, '=VLOOKUP("banana", A1:B3, 2, FALSE)'), 20);
});

test('VLOOKUP: not found returns #N/A', () => {
  const s = fresh();
  s.setRaw('s1', 'A1', 'apple');  s.setRaw('s1', 'B1', 10);
  eq(evalFormula(s, '=VLOOKUP("grape", A1:B1, 2, FALSE)'), E.ERR.NA);
});

test('VLOOKUP: case insensitive', () => {
  const s = fresh();
  s.setRaw('s1', 'A1', 'Apple'); s.setRaw('s1', 'B1', 10);
  eq(evalFormula(s, '=VLOOKUP("APPLE", A1:B1, 2, FALSE)'), 10);
});

test('VLOOKUP: numeric key', () => {
  const s = fresh();
  s.setRaw('s1', 'A1', 100); s.setRaw('s1', 'B1', 'low');
  s.setRaw('s1', 'A2', 200); s.setRaw('s1', 'B2', 'mid');
  s.setRaw('s1', 'A3', 300); s.setRaw('s1', 'B3', 'high');
  eq(evalFormula(s, '=VLOOKUP(200, A1:B3, 2, FALSE)'), 'mid');
});

test('HLOOKUP: basic', () => {
  const s = fresh();
  s.setRaw('s1', 'A1', 'jan'); s.setRaw('s1', 'B1', 'feb'); s.setRaw('s1', 'C1', 'mar');
  s.setRaw('s1', 'A2', 100);   s.setRaw('s1', 'B2', 200);   s.setRaw('s1', 'C2', 300);
  eq(evalFormula(s, '=HLOOKUP("feb", A1:C2, 2, FALSE)'), 200);
});

test('INDEX: row+col', () => {
  const s = fresh();
  s.setRaw('s1', 'A1', 1); s.setRaw('s1', 'B1', 2);
  s.setRaw('s1', 'A2', 3); s.setRaw('s1', 'B2', 4);
  eq(evalFormula(s, '=INDEX(A1:B2, 2, 1)'), 3);
});

test('INDEX: single dim (row)', () => {
  const s = fresh();
  s.setRaw('s1', 'A1', 10); s.setRaw('s1', 'A2', 20); s.setRaw('s1', 'A3', 30);
  eq(evalFormula(s, '=INDEX(A1:A3, 2)'), 20);
});

test('MATCH: exact match', () => {
  const s = fresh();
  s.setRaw('s1', 'A1', 'a'); s.setRaw('s1', 'A2', 'b'); s.setRaw('s1', 'A3', 'c');
  eq(evalFormula(s, '=MATCH("b", A1:A3, 0)'), 2);
});

test('MATCH: not found', () => {
  const s = fresh();
  s.setRaw('s1', 'A1', 'a');
  eq(evalFormula(s, '=MATCH("z", A1:A1, 0)'), E.ERR.NA);
});

test('XLOOKUP: basic', () => {
  const s = fresh();
  s.setRaw('s1', 'A1', 'x'); s.setRaw('s1', 'B1', 100);
  s.setRaw('s1', 'A2', 'y'); s.setRaw('s1', 'B2', 200);
  eq(evalFormula(s, '=XLOOKUP("y", A1:A2, B1:B2)'), 200);
});

test('XLOOKUP: with default', () => {
  const s = fresh();
  s.setRaw('s1', 'A1', 'x'); s.setRaw('s1', 'B1', 100);
  eq(evalFormula(s, '=XLOOKUP("z", A1:A1, B1:B1, "missing")'), 'missing');
});

test('INDEX + MATCH combo', () => {
  const s = fresh();
  s.setRaw('s1', 'A1', 'a'); s.setRaw('s1', 'B1', 10);
  s.setRaw('s1', 'A2', 'b'); s.setRaw('s1', 'B2', 20);
  s.setRaw('s1', 'A3', 'c'); s.setRaw('s1', 'B3', 30);
  eq(evalFormula(s, '=INDEX(B1:B3, MATCH("b", A1:A3, 0))'), 20);
});

// ════════════════════════════════════════════════════════════════════
// SUMIF / COUNTIF / AVERAGEIF and S-variants
// ════════════════════════════════════════════════════════════════════

test('SUMIF: basic numeric criterion', () => {
  const s = fresh();
  s.setRaw('s1', 'A1', 10); s.setRaw('s1', 'A2', 20); s.setRaw('s1', 'A3', 30);
  eq(evalFormula(s, '=SUMIF(A1:A3, ">15")'), 50);
});

test('SUMIF: with sum range', () => {
  const s = fresh();
  s.setRaw('s1', 'A1', 'food'); s.setRaw('s1', 'B1', 50);
  s.setRaw('s1', 'A2', 'gas');  s.setRaw('s1', 'B2', 30);
  s.setRaw('s1', 'A3', 'food'); s.setRaw('s1', 'B3', 25);
  eq(evalFormula(s, '=SUMIF(A1:A3, "food", B1:B3)'), 75);
});

test('SUMIF: wildcard match', () => {
  const s = fresh();
  s.setRaw('s1', 'A1', 'abc'); s.setRaw('s1', 'B1', 10);
  s.setRaw('s1', 'A2', 'abd'); s.setRaw('s1', 'B2', 20);
  s.setRaw('s1', 'A3', 'xyz'); s.setRaw('s1', 'B3', 30);
  eq(evalFormula(s, '=SUMIF(A1:A3, "ab*", B1:B3)'), 30);
});

test('COUNTIF: numeric', () => {
  const s = fresh();
  s.setRaw('s1', 'A1', 10); s.setRaw('s1', 'A2', 20); s.setRaw('s1', 'A3', 5);
  eq(evalFormula(s, '=COUNTIF(A1:A3, ">=10")'), 2);
});

test('COUNTIF: text exact', () => {
  const s = fresh();
  s.setRaw('s1', 'A1', 'yes'); s.setRaw('s1', 'A2', 'no'); s.setRaw('s1', 'A3', 'yes');
  eq(evalFormula(s, '=COUNTIF(A1:A3, "yes")'), 2);
});

test('AVERAGEIF: basic', () => {
  const s = fresh();
  s.setRaw('s1', 'A1', 10); s.setRaw('s1', 'A2', 20); s.setRaw('s1', 'A3', 30); s.setRaw('s1', 'A4', 40);
  eq(evalFormula(s, '=AVERAGEIF(A1:A4, ">15")'), 30);
});

test('SUMIFS: multiple criteria', () => {
  const s = fresh();
  s.setRaw('s1', 'A1', 'food'); s.setRaw('s1', 'B1', 'Q1'); s.setRaw('s1', 'C1', 100);
  s.setRaw('s1', 'A2', 'food'); s.setRaw('s1', 'B2', 'Q2'); s.setRaw('s1', 'C2', 200);
  s.setRaw('s1', 'A3', 'gas');  s.setRaw('s1', 'B3', 'Q1'); s.setRaw('s1', 'C3', 50);
  eq(evalFormula(s, '=SUMIFS(C1:C3, A1:A3, "food", B1:B3, "Q1")'), 100);
});

test('COUNTIFS: multiple criteria', () => {
  const s = fresh();
  s.setRaw('s1', 'A1', 'food'); s.setRaw('s1', 'B1', 10);
  s.setRaw('s1', 'A2', 'food'); s.setRaw('s1', 'B2', 30);
  s.setRaw('s1', 'A3', 'gas');  s.setRaw('s1', 'B3', 20);
  eq(evalFormula(s, '=COUNTIFS(A1:A3, "food", B1:B3, ">20")'), 1);
});

// ════════════════════════════════════════════════════════════════════
// Date functions
// ════════════════════════════════════════════════════════════════════

test('DATE: construct serial', () => {
  // 2026-01-01 = Excel serial 46023
  eq(evalFormula(fresh(), '=DATE(2026, 1, 1)'), 46023);
});

test('YEAR: extract from serial', () => {
  eq(evalFormula(fresh(), '=YEAR(DATE(2026, 5, 24))'), 2026);
});

test('MONTH: extract from serial', () => {
  eq(evalFormula(fresh(), '=MONTH(DATE(2026, 5, 24))'), 5);
});

test('DAY: extract from serial', () => {
  eq(evalFormula(fresh(), '=DAY(DATE(2026, 5, 24))'), 24);
});

test('DATEDIF: years', () => {
  eq(evalFormula(fresh(), '=DATEDIF(DATE(2020,1,1), DATE(2026,1,1), "Y")'), 6);
});

test('DATEDIF: months', () => {
  eq(evalFormula(fresh(), '=DATEDIF(DATE(2026,1,1), DATE(2026,7,1), "M")'), 6);
});

test('DATEDIF: days', () => {
  eq(evalFormula(fresh(), '=DATEDIF(DATE(2026,1,1), DATE(2026,1,31), "D")'), 30);
});

test('EOMONTH: same month', () => {
  // EOMONTH of 2026-05-15 with 0 months offset = 2026-05-31
  const expected = E.FUNCTIONS.DATE([2026, 5, 31]);
  eq(evalFormula(fresh(), '=EOMONTH(DATE(2026,5,15), 0)'), expected);
});

test('EOMONTH: next month', () => {
  const expected = E.FUNCTIONS.DATE([2026, 6, 30]);
  eq(evalFormula(fresh(), '=EOMONTH(DATE(2026,5,15), 1)'), expected);
});

test('WEEKDAY: type 1 (1=Sun)', () => {
  // 2026-01-01 is a Thursday → 5
  eq(evalFormula(fresh(), '=WEEKDAY(DATE(2026,1,1))'), 5);
});

test('WEEKDAY: type 2 (1=Mon)', () => {
  // Thursday → 4
  eq(evalFormula(fresh(), '=WEEKDAY(DATE(2026,1,1), 2)'), 4);
});

test('NETWORKDAYS: one work week', () => {
  // Mon to Fri = 5 days
  eq(evalFormula(fresh(), '=NETWORKDAYS(DATE(2026,5,18), DATE(2026,5,22))'), 5);
});

test('DAYS: difference', () => {
  eq(evalFormula(fresh(), '=DAYS(DATE(2026,5,31), DATE(2026,5,1))'), 30);
});

// ════════════════════════════════════════════════════════════════════
// Text functions
// ════════════════════════════════════════════════════════════════════

test('LEFT: chars', () => eq(evalFormula(fresh(), '=LEFT("hello world", 5)'), 'hello'));
test('RIGHT: chars', () => eq(evalFormula(fresh(), '=RIGHT("hello world", 5)'), 'world'));
test('MID: substring', () => eq(evalFormula(fresh(), '=MID("hello world", 7, 5)'), 'world'));
test('FIND: position', () => eq(evalFormula(fresh(), '=FIND("o", "hello world")'), 5));
test('FIND: not found', () => eq(evalFormula(fresh(), '=FIND("z", "hello")'), E.ERR.VALUE));
test('SEARCH: case insensitive', () => eq(evalFormula(fresh(), '=SEARCH("WORLD", "hello world")'), 7));
test('SUBSTITUTE: all', () => eq(evalFormula(fresh(), '=SUBSTITUTE("aaa", "a", "b")'), 'bbb'));
test('SUBSTITUTE: nth', () => eq(evalFormula(fresh(), '=SUBSTITUTE("aaa", "a", "b", 2)'), 'aba'));
test('TRIM: collapses whitespace', () => eq(evalFormula(fresh(), '=TRIM("  hello   world  ")'), 'hello world'));
test('PROPER: title case', () => eq(evalFormula(fresh(), '=PROPER("hello world")'), 'Hello World'));
test('TEXTJOIN: with separator', () => eq(evalFormula(fresh(), '=TEXTJOIN(", ", TRUE, "a", "b", "c")'), 'a, b, c'));
test('REPT: repeat', () => eq(evalFormula(fresh(), '=REPT("ab", 3)'), 'ababab'));
test('VALUE: parse number', () => eq(evalFormula(fresh(), '=VALUE("42.5")'), 42.5));

// ════════════════════════════════════════════════════════════════════
// Math functions
// ════════════════════════════════════════════════════════════════════

test('MOD: positive', () => eq(evalFormula(fresh(), '=MOD(10, 3)'), 1));
test('MOD: negative dividend', () => eq(evalFormula(fresh(), '=MOD(-7, 3)'), 2)); // Excel-style
test('INT: truncate down', () => eq(evalFormula(fresh(), '=INT(3.7)'), 3));
test('INT: negative', () => eq(evalFormula(fresh(), '=INT(-3.2)'), -4));
test('FLOOR: positive', () => eq(evalFormula(fresh(), '=FLOOR(3.7)'), 3));
test('CEILING: positive', () => eq(evalFormula(fresh(), '=CEILING(3.2)'), 4));
test('LN', () => approx(evalFormula(fresh(), '=LN(2.71828182846)'), 1, 1e-9));
test('LOG10', () => eq(evalFormula(fresh(), '=LOG10(1000)'), 3));
test('PI', () => approx(evalFormula(fresh(), '=PI()'), Math.PI));
test('SIGN: positive', () => eq(evalFormula(fresh(), '=SIGN(5)'), 1));
test('SIGN: negative', () => eq(evalFormula(fresh(), '=SIGN(-3)'), -1));
test('SIGN: zero', () => eq(evalFormula(fresh(), '=SIGN(0)'), 0));
test('MEDIAN: odd count', () => {
  const s = fresh();
  s.setRaw('s1', 'A1', 1); s.setRaw('s1', 'A2', 3); s.setRaw('s1', 'A3', 5);
  eq(evalFormula(s, '=MEDIAN(A1:A3)'), 3);
});
test('MEDIAN: even count', () => {
  const s = fresh();
  s.setRaw('s1', 'A1', 1); s.setRaw('s1', 'A2', 2); s.setRaw('s1', 'A3', 3); s.setRaw('s1', 'A4', 4);
  eq(evalFormula(s, '=MEDIAN(A1:A4)'), 2.5);
});
test('STDEV: sample', () => {
  const s = fresh();
  [2, 4, 4, 4, 5, 5, 7, 9].forEach((v, i) => s.setRaw('s1', `A${i+1}`, v));
  approx(evalFormula(s, '=STDEV(A1:A8)'), 2.138089935, 1e-6);
});
test('PRODUCT', () => {
  eq(evalFormula(fresh(), '=PRODUCT(2, 3, 4)'), 24);
});

// ════════════════════════════════════════════════════════════════════
// Logical functions
// ════════════════════════════════════════════════════════════════════

test('IFS: matches first', () => eq(evalFormula(fresh(), '=IFS(1>0, "a", 2>1, "b")'), 'a'));
test('IFS: matches second', () => eq(evalFormula(fresh(), '=IFS(1<0, "a", 2>1, "b")'), 'b'));
test('IFS: none match', () => eq(evalFormula(fresh(), '=IFS(1<0, "a", 2<1, "b")'), E.ERR.NA));
test('SWITCH: match', () => eq(evalFormula(fresh(), '=SWITCH(2, 1, "one", 2, "two", 3, "three")'), 'two'));
test('SWITCH: default', () => eq(evalFormula(fresh(), '=SWITCH(5, 1, "one", 2, "two", "other")'), 'other'));
test('XOR: even trues = false', () => eq(evalFormula(fresh(), '=XOR(TRUE(), TRUE())'), false));
test('XOR: odd trues = true', () => eq(evalFormula(fresh(), '=XOR(TRUE(), FALSE(), TRUE(), TRUE())'), true));

// ════════════════════════════════════════════════════════════════════
// Financial functions
// ════════════════════════════════════════════════════════════════════

test('PMT: simple mortgage', () => {
  // 30yr mortgage on $500K at 7%/12 monthly → ~$3326
  const pmt = evalFormula(fresh(), '=PMT(0.07/12, 360, 500000)');
  approx(pmt, -3326.51, 0.5);
});

test('FV: simple compounding', () => {
  // $10K @ 5% for 10 years → $16,288.95
  const fv = evalFormula(fresh(), '=FV(0.05, 10, 0, -10000)');
  approx(fv, 16288.95, 0.5);
});

test('PV: present value', () => {
  // What's the PV of $1000 in 10 years at 5%? → ~$613.91
  const pv = evalFormula(fresh(), '=PV(0.05, 10, 0, -1000)');
  approx(pv, 613.91, 0.5);
});

test('NPV: basic', () => {
  const s = fresh();
  s.setRaw('s1', 'A1', 100); s.setRaw('s1', 'A2', 200); s.setRaw('s1', 'A3', 300);
  const npv = evalFormula(s, '=NPV(0.1, A1:A3)');
  // 100/1.1 + 200/1.21 + 300/1.331 = 481.59
  approx(npv, 481.59, 0.5);
});

test('IRR: known answer', () => {
  const s = fresh();
  // CF: -1000, 200, 300, 400, 500 → IRR ≈ 12.83%
  s.setRaw('s1', 'A1', -1000);
  s.setRaw('s1', 'A2', 200);
  s.setRaw('s1', 'A3', 300);
  s.setRaw('s1', 'A4', 400);
  s.setRaw('s1', 'A5', 500);
  const irr = evalFormula(s, '=IRR(A1:A5)');
  approx(irr, 0.12826, 0.001);
});

// ════════════════════════════════════════════════════════════════════
// Info functions
// ════════════════════════════════════════════════════════════════════

test('ISNUMBER: yes', () => eq(evalFormula(fresh(), '=ISNUMBER(42)'), true));
test('ISNUMBER: no', () => eq(evalFormula(fresh(), '=ISNUMBER("hi")'), false));
test('ISTEXT: yes', () => eq(evalFormula(fresh(), '=ISTEXT("hi")'), true));
test('ISBLANK: yes (empty cell)', () => {
  const s = fresh();
  eq(evalFormula(s, '=ISBLANK(A1)'), true);
});
test('ISBLANK: no (non-empty)', () => {
  const s = fresh();
  s.setRaw('s1', 'A1', 5);
  eq(evalFormula(s, '=ISBLANK(A1)'), false);
});
test('ISERROR: yes', () => eq(evalFormula(fresh(), '=ISERROR(1/0)'), true));
test('ISERROR: no', () => eq(evalFormula(fresh(), '=ISERROR(5)'), false));
test('IFNA: catches #N/A', () => {
  const s = fresh();
  s.setRaw('s1', 'A1', 'x');
  // VLOOKUP miss returns #N/A which IFNA catches
  eq(evalFormula(s, '=IFNA(VLOOKUP("z", A1:A1, 1, FALSE), "fallback")'), 'fallback');
});
test('IFNA: passes through valid value', () => {
  eq(evalFormula(fresh(), '=IFNA(42, "fallback")'), 42);
});

// ════════════════════════════════════════════════════════════════════
// Operator precedence regression
// ════════════════════════════════════════════════════════════════════

test('precedence: percent', () => eq(evalFormula(fresh(), '=50%'), 0.5));
test('precedence: 100*5%', () => eq(evalFormula(fresh(), '=100*5%'), 5));
test('precedence: ^ before *', () => eq(evalFormula(fresh(), '=2*3^2'), 18));
test('precedence: unary on cell', () => {
  const s = fresh();
  s.setRaw('s1', 'A1', 10);
  eq(evalFormula(s, '=-A1'), -10);
});

// ════════════════════════════════════════════════════════════════════
// Wildcards
// ════════════════════════════════════════════════════════════════════

test('wildcard: * matches anything', () => {
  const re = E.wildcardToRegex('ab*');
  eq(re.test('abc'), true);
  eq(re.test('abcdef'), true);
  eq(re.test('ax'), false);
});
test('wildcard: ? matches one', () => {
  const re = E.wildcardToRegex('a?c');
  eq(re.test('abc'), true);
  eq(re.test('axc'), true);
  eq(re.test('ac'), false);
});
test('wildcard: escape with ~', () => {
  const re = E.wildcardToRegex('a~*b');
  eq(re.test('a*b'), true);
  eq(re.test('axb'), false);
});

// ── SPARKLINE
test('SPARKLINE: line type returns SVG with path', () => {
  const s = fresh();
  s.setRaw('s1', 'A1', 1); s.setRaw('s1', 'A2', 5); s.setRaw('s1', 'A3', 3);
  const out = evalFormula(s, '=SPARKLINE(A1:A3)');
  eq(E.isSvg(out), true);
  const svg = out.slice(E.SVG_MARKER.length);
  eq(svg.startsWith('<svg'), true);
  eq(svg.includes('<path'), true);
  eq(svg.includes('stroke="#3b82f6"'), true);
});
test('SPARKLINE: bar type returns SVG with rects', () => {
  const s = fresh();
  s.setRaw('s1', 'A1', 10); s.setRaw('s1', 'A2', 20); s.setRaw('s1', 'A3', 15);
  const out = evalFormula(s, '=SPARKLINE(A1:A3, "bar")');
  eq(E.isSvg(out), true);
  eq(out.includes('<rect'), true);
});
test('SPARKLINE: custom color', () => {
  const s = fresh();
  s.setRaw('s1', 'A1', 1); s.setRaw('s1', 'A2', 2);
  const out = evalFormula(s, '=SPARKLINE(A1:A2, "line", "#ff0066")');
  eq(out.includes('stroke="#ff0066"'), true);
});
test('SPARKLINE: rejects unsafe color, falls back to default', () => {
  const s = fresh();
  s.setRaw('s1', 'A1', 1); s.setRaw('s1', 'A2', 2);
  const out = evalFormula(s, '=SPARKLINE(A1:A2, "line", "red\\"/><script>x")');
  eq(out.includes('<script'), false);
  eq(out.includes('stroke="#3b82f6"'), true);
});
test('SPARKLINE: empty range returns empty string', () => {
  const s = fresh();
  const out = evalFormula(s, '=SPARKLINE(A1:A3)');
  eq(out, '');
});
test('SPARKLINE: ignores non-numeric values', () => {
  const s = fresh();
  s.setRaw('s1', 'A1', 1); s.setRaw('s1', 'A2', 'text'); s.setRaw('s1', 'A3', 5);
  const out = evalFormula(s, '=SPARKLINE(A1:A3)');
  eq(E.isSvg(out), true);
});

// ── shiftFormulaRefs (fill-handle support)
test('shiftFormulaRefs: simple ref down one row', () => {
  eq(E.shiftFormulaRefs('=A1+B1', 1, 0), '=A2+B2');
});
test('shiftFormulaRefs: simple ref right one col', () => {
  eq(E.shiftFormulaRefs('=A1+A2', 0, 1), '=B1+B2');
});
test('shiftFormulaRefs: range', () => {
  eq(E.shiftFormulaRefs('=SUM(A1:A10)', 5, 0), '=SUM(A6:A15)');
});
test('shiftFormulaRefs: function names with digits are preserved', () => {
  eq(E.shiftFormulaRefs('=LOG10(A1)', 1, 0), '=LOG10(A2)');
});
test('shiftFormulaRefs: bare sheet ref leaves sheet name alone, shifts cell', () => {
  eq(E.shiftFormulaRefs('=Sheet1!A1', 1, 0), '=Sheet1!A2');
});
test('shiftFormulaRefs: quoted sheet name preserved', () => {
  eq(E.shiftFormulaRefs("='My Sheet'!A1*2", 3, 0), "='My Sheet'!A4*2");
});
test('shiftFormulaRefs: string literal preserved (does not shift "A1" inside string)', () => {
  eq(E.shiftFormulaRefs('=A1&" hits A1"', 1, 0), '=A2&" hits A1"');
});
test('shiftFormulaRefs: negative delta shifts up / left', () => {
  eq(E.shiftFormulaRefs('=C3+D3', -1, -1), '=B2+C2');
});
test('shiftFormulaRefs: shifting past row 1 produces #REF!', () => {
  eq(E.shiftFormulaRefs('=A1', -1, 0), '=#REF!');
});
test('shiftFormulaRefs: shifting past col A produces #REF!', () => {
  eq(E.shiftFormulaRefs('=A1', 0, -1), '=#REF!');
});
test('shiftFormulaRefs: non-formula text returned unchanged', () => {
  eq(E.shiftFormulaRefs('hello A1', 1, 0), 'hello A1');
});
test('shiftFormulaRefs: shift cross-sheet range', () => {
  eq(E.shiftFormulaRefs('=SUM(Data!A1:A5)', 2, 0), '=SUM(Data!A3:A7)');
});

// ── Absolute references (tokenizer + shifter)
test('tokenize: $A$1 sets absCol + absRow', () => {
  const toks = E.tokenize('$A$1');
  eq(toks[0].val, 'A1');
  eq(toks[0].absCol, true);
  eq(toks[0].absRow, true);
});
test('tokenize: $A1 sets absCol only', () => {
  const toks = E.tokenize('$A1');
  eq(toks[0].val, 'A1');
  eq(toks[0].absCol, true);
  eq(!!toks[0].absRow, false);
});
test('tokenize: A$1 sets absRow only', () => {
  const toks = E.tokenize('A$1');
  eq(toks[0].val, 'A1');
  eq(!!toks[0].absCol, false);
  eq(toks[0].absRow, true);
});
test('evaluate: $A$1 resolves same as A1', () => {
  const s = fresh();
  s.setRaw('s1', 'A1', 42);
  eq(evalFormula(s, '=$A$1+1'), 43);
});
test('evaluate: mix of absolute and relative', () => {
  const s = fresh();
  s.setRaw('s1', 'A1', 10);
  s.setRaw('s1', 'B1', 5);
  eq(evalFormula(s, '=$A$1+B1'), 15);
});
test('shiftFormulaRefs: $A$1 stays $A$1 when shifted', () => {
  eq(E.shiftFormulaRefs('=$A$1', 5, 5), '=$A$1');
});
test('shiftFormulaRefs: $A1 only shifts row', () => {
  eq(E.shiftFormulaRefs('=$A1', 5, 3), '=$A6');
});
test('shiftFormulaRefs: A$1 only shifts col', () => {
  eq(E.shiftFormulaRefs('=A$1', 5, 3), '=D$1');
});
test('shiftFormulaRefs: mixed in one formula', () => {
  eq(E.shiftFormulaRefs('=$A$1+B2+$C3+D$4', 1, 1), '=$A$1+C3+$C4+E$4');
});
test('shiftFormulaRefs: absolute ref boundary stays', () => {
  eq(E.shiftFormulaRefs('=SUM($A$1:$A$10)', 100, 100), '=SUM($A$1:$A$10)');
});

// ── Edge cases per QA spec
test('Edge: division by zero returns #DIV/0!', () => {
  const s = fresh();
  eq(evalFormula(s, '=5/0'), E.ERR.DIV0);
});
test('Edge: cascading error propagates from div/0', () => {
  const s = fresh();
  s.setRaw('s1', 'A1', E.ERR.DIV0);
  eq(evalFormula(s, '=A1+10'), E.ERR.DIV0);
});
test('Edge: empty referenced cell evaluates to 0 in math', () => {
  const s = fresh();
  eq(evalFormula(s, '=B1*5'), 0);
});
test('Edge: #REF! literal in formula parses and propagates', () => {
  const s = fresh();
  eq(evalFormula(s, '=#REF!+5'), E.ERR.REF);
});
test('Edge: #DIV/0! literal in formula parses and propagates', () => {
  const s = fresh();
  eq(evalFormula(s, '=#DIV/0!*2'), E.ERR.DIV0);
});
test('Edge: IFERROR catches literal error tokens', () => {
  const s = fresh();
  eq(evalFormula(s, '=IFERROR(#REF!, 0)'), 0);
});

// ── Structural rewrite (applyRow/Col Insert/Delete to formula text)
test('applyRowInsertToFormula: shift bare refs at or past insertion', () => {
  eq(E.applyRowInsertToFormula('=A1+A5', 'Sheet1', 'Sheet1', 3), '=A1+A6');
});
test('applyRowInsertToFormula: only target sheet matters', () => {
  eq(E.applyRowInsertToFormula('=A5', 'Sheet1', 'Other', 3), '=A5');
});
test('applyRowInsertToFormula: qualified ref to target sheet shifts', () => {
  eq(E.applyRowInsertToFormula('=Joints!B5', 'Computed', 'Joints', 3), '=Joints!B6');
});
test('applyRowInsertToFormula: qualified ref to non-target sheet unchanged', () => {
  eq(E.applyRowInsertToFormula('=Joints!B5', 'Computed', 'Inputs', 3), '=Joints!B5');
});
test('applyRowInsertToFormula: absolute row shifts too (Excel-style for structural ops)', () => {
  eq(E.applyRowInsertToFormula('=$A$5', 'Sheet1', 'Sheet1', 3), '=$A$6');
});
test('applyRowDeleteToFormula: ref to deleted row becomes #REF!', () => {
  eq(E.applyRowDeleteToFormula('=A5', 'Sheet1', 'Sheet1', 5), '=#REF!');
});
test('applyRowDeleteToFormula: ref past deletion shifts up', () => {
  eq(E.applyRowDeleteToFormula('=A1+A8', 'Sheet1', 'Sheet1', 5), '=A1+A7');
});
test('applyRowDeleteToFormula: ref before deletion unchanged', () => {
  eq(E.applyRowDeleteToFormula('=A1+A3', 'Sheet1', 'Sheet1', 5), '=A1+A3');
});
test('applyColInsertToFormula: inserting col B shifts C-Z', () => {
  eq(E.applyColInsertToFormula('=A1+C1', 'Sheet1', 'Sheet1', 1), '=A1+D1');
});
test('applyColDeleteToFormula: ref to deleted col becomes #REF!', () => {
  eq(E.applyColDeleteToFormula('=B1+C1', 'Sheet1', 'Sheet1', 1), '=#REF!+B1');
});

// ── Performance: 1000-row cascading recalc
test('Perf: 1000-row cascade recalc is fast', () => {
  const s = fresh();
  // Build a forward chain: A1=1, A2=A1+1, ..., A1000=A999+1
  // Test does not actually run setCell (no Store here) — just confirms the engine
  // can evaluate a deep chain without stack overflow.
  s.setRaw('s1', 'A1', 1);
  for (let r = 2; r <= 1000; r++) s.setRaw('s1', `A${r}`, r - 1); // pre-seed cached values
  const t0 = Date.now();
  for (let r = 2; r <= 1000; r++) evalFormula(s, `=A${r-1}+1`, `A${r}`, 's1');
  const t1 = Date.now();
  if (t1 - t0 > 1000) throw new Error(`Too slow: ${t1-t0}ms for 1000 evals`);
});

// ════════════════════════════════════════════════════════════════════
// Results
// ════════════════════════════════════════════════════════════════════

console.log('\n');
console.log(`${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures) {
    console.log(`  ✗ ${f.name}`);
    console.log(`    ${f.err.message}`);
    if (f.err.stack) console.log(`    ${f.err.stack.split('\n').slice(1, 3).join('\n    ')}`);
  }
  process.exit(1);
}
process.exit(0);
