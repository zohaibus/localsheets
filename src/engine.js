// ════════════════════════════════════════════════════════════════════
// LocalSheets v1.0 Formula Engine
// Multi-sheet, ~50 functions, real recursive-descent parser + AST evaluator
// ════════════════════════════════════════════════════════════════════
'use strict';

// Configuration — multi-sheet workbooks
const ROWS = 10000;
const COLS = 702; // A through ZZ
const MAX_SHEETS = 100;

// Generate column letters A, B, ..., Z, AA, AB, ..., CV (100 cols)
function colLetters(n) {
  let s = '';
  while (n >= 0) { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; }
  return s;
}
const COL_NAMES = Array.from({length: COLS}, (_, i) => colLetters(i));
const COL_INDEX = new Map(COL_NAMES.map((n, i) => [n, i]));
const LAST_COL = COL_NAMES[COLS - 1]; // "ZZ"

function toCoord(r, c) { return COL_NAMES[c] + (r + 1); }

// Parse a coord "A1" or "AA42" into {r, c}
function parseCoord(s) {
  if (typeof s !== 'string') return null;
  const m = s.match(/^([A-Z]+)(\d+)$/);
  if (!m) return null;
  const c = COL_INDEX.get(m[1]);
  if (c === undefined) return null;
  const r = parseInt(m[2], 10) - 1;
  return (r >= 0 && r < ROWS && c >= 0 && c < COLS) ? {r, c} : null;
}

// Strict numeric — same logic as v0.2 but exposed
const STRICT_NUMBER_RE = /^-?\d+(\.\d+)?$/;
function isStrictNumber(s) {
  if (typeof s !== 'string') return false;
  const t = s.trim();
  return t !== '' && STRICT_NUMBER_RE.test(t);
}

// Error tokens (Excel-compatible)
const ERR = {
  CIRC: '#CIRC!', DIV0: '#DIV/0!', VALUE: '#VALUE!',
  REF: '#REF!', NAME: '#NAME?', PARSE: '#PARSE!', NA: '#N/A', NUM: '#NUM!'
};
const ALL_ERRORS = new Set(Object.values(ERR));
function isError(v) { return typeof v === 'string' && ALL_ERRORS.has(v); }

// Shift relative cell refs in a formula string by (rowDelta, colDelta). Used by
// the fill handle when extending a formula to neighboring cells — Excel-style
// behavior where dragging =A1+B1 down one row becomes =A2+B2. Quoted sheet
// names, double-quoted string literals, and function names are preserved.
function shiftFormulaRefs(formula, rowDelta, colDelta) {
  if (!formula || typeof formula !== 'string') return formula;
  if (!formula.startsWith('=')) return formula;
  const shiftCol = (col, isAbs) => {
    if (isAbs) return col;
    const idx = COL_INDEX.get(col);
    if (idx == null) return col;
    const ni = idx + colDelta;
    return (ni < 0 || ni >= COLS) ? null : COL_NAMES[ni];
  };
  const shiftRow = (row, isAbs) => {
    if (isAbs) return row;
    const nr = parseInt(row, 10) + rowDelta;
    return (nr < 1 || nr > ROWS) ? null : String(nr);
  };
  let out = '';
  let i = 0;
  while (i < formula.length) {
    const ch = formula[i];
    if (ch === "'") {
      let j = i + 1;
      while (j < formula.length) {
        if (formula[j] === "'") { if (formula[j+1] === "'") { j += 2; continue; } j++; break; }
        j++;
      }
      out += formula.slice(i, j); i = j; continue;
    }
    if (ch === '"') {
      let j = i + 1;
      while (j < formula.length && formula[j] !== '"') j++;
      if (j < formula.length) j++;
      out += formula.slice(i, j); i = j; continue;
    }
    // Absolute-col ref: $A1 or $A$1
    if (ch === '$') {
      let j = i + 1;
      while (j < formula.length && /[A-Za-z]/.test(formula[j])) j++;
      if (j > i + 1) {
        const col = formula.slice(i + 1, j).toUpperCase();
        let absRow = false;
        if (formula[j] === '$') { absRow = true; j++; }
        let dstart = j;
        while (j < formula.length && /\d/.test(formula[j])) j++;
        if (j > dstart) {
          const row = formula.slice(dstart, j);
          const nc = shiftCol(col, true);  // col is absolute
          const nr = shiftRow(row, absRow);
          if (nc === null || nr === null) { out += ERR.REF; i = j; continue; }
          out += '$' + nc + (absRow ? '$' : '') + nr;
          i = j; continue;
        }
      }
      out += ch; i++; continue;
    }
    if ((ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') || ch === '_') {
      let j = i;
      while (j < formula.length && /[A-Za-z0-9_]/.test(formula[j])) j++;
      const word = formula.slice(i, j);
      let k = j;
      while (k < formula.length && formula[k] === ' ') k++;
      const isFunction = formula[k] === '(';
      const isSheetRef = formula[j] === '!';
      if (isSheetRef) { out += word + '!'; i = j + 1; continue; }
      // Mixed ref A$1 — pure letters then $digits
      if (/^[A-Za-z]+$/.test(word) && formula[j] === '$' && /\d/.test(formula[j+1])) {
        let dstart = j + 1;
        let dend = dstart;
        while (dend < formula.length && /\d/.test(formula[dend])) dend++;
        const col = word.toUpperCase();
        const row = formula.slice(dstart, dend);
        const nc = shiftCol(col, false);  // col relative, shifted
        if (nc === null) { out += ERR.REF; i = dend; continue; }
        out += nc + '$' + row;  // row stays absolute
        i = dend; continue;
      }
      const m = word.match(/^([A-Za-z]+)(\d+)$/);
      if (m && !isFunction) {
        const col = m[1].toUpperCase();
        const row = m[2];
        const nc = shiftCol(col, false);
        const nr = shiftRow(row, false);
        if (nc === null || nr === null) { out += ERR.REF; i = j; continue; }
        out += nc + nr;
      } else {
        out += word;
      }
      i = j; continue;
    }
    out += ch; i++;
  }
  return out;
}

// Lower-level helper: walk every cell reference inside a formula and call
// handler(ref, isQualified, sheetName). Handler returns:
//   - a string to substitute for the ref (e.g. "B5" or "#REF!")
//   - null/undefined to leave the ref unchanged
// Tracks the in-flight sheet prefix (Sheet1! or 'My Sheet'!) so callers can
// scope rewrites to a specific sheet.
function _walkFormulaRefs(formula, handler) {
  if (!formula || typeof formula !== 'string') return formula;
  if (!formula.startsWith('=')) return formula;
  let out = '';
  let i = 0;
  let pendingSheet = null;
  let pendingSheetLen = 0;  // bytes emitted for "Sheet!" so we can roll back on invalidation
  const emit = (s) => { out += s; pendingSheet = null; pendingSheetLen = 0; };
  // When a ref is replaced by an error token (e.g. #REF!), drop the leading sheet
  // prefix too — `=Data!#REF!` isn't a valid token sequence.
  const emitRef = (result, origLen) => {
    if (result != null && ALL_ERRORS.has(result) && pendingSheetLen > 0) {
      out = out.slice(0, out.length - pendingSheetLen);
    }
    out += (result != null ? result : formula.slice(i, i + origLen));
    pendingSheet = null; pendingSheetLen = 0;
  };
  while (i < formula.length) {
    const ch = formula[i];
    if (ch === "'") {
      let j = i + 1; let name = '';
      while (j < formula.length) {
        if (formula[j] === "'") {
          if (formula[j+1] === "'") { name += "'"; j += 2; continue; }
          j++; break;
        }
        name += formula[j]; j++;
      }
      if (formula[j] === '!') {
        const prefix = formula.slice(i, j + 1);
        out += prefix; pendingSheet = name; pendingSheetLen = prefix.length; i = j + 1; continue;
      }
      out += formula.slice(i, j); pendingSheet = null; pendingSheetLen = 0; i = j; continue;
    }
    if (ch === '"') {
      let j = i + 1;
      while (j < formula.length && formula[j] !== '"') j++;
      if (j < formula.length) j++;
      emit(formula.slice(i, j)); i = j; continue;
    }
    if (ch === '$') {
      let j = i + 1;
      while (j < formula.length && /[A-Za-z]/.test(formula[j])) j++;
      if (j > i + 1) {
        const col = formula.slice(i + 1, j).toUpperCase();
        let absRow = false;
        if (formula[j] === '$') { absRow = true; j++; }
        let dstart = j;
        while (j < formula.length && /\d/.test(formula[j])) j++;
        if (j > dstart) {
          const row = parseInt(formula.slice(dstart, j), 10);
          const ref = { col, row, absCol: true, absRow };
          const result = handler(ref, pendingSheet !== null, pendingSheet);
          emitRef(result, j - i);
          i = j; continue;
        }
      }
      emit(ch); i++; continue;
    }
    if ((ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') || ch === '_') {
      let j = i;
      while (j < formula.length && /[A-Za-z0-9_]/.test(formula[j])) j++;
      const word = formula.slice(i, j);
      if (formula[j] === '!') {
        const prefix = word + '!';
        out += prefix; pendingSheet = word; pendingSheetLen = prefix.length;
        i = j + 1; continue;
      }
      let k = j;
      while (k < formula.length && formula[k] === ' ') k++;
      const isFunction = formula[k] === '(';
      // Mixed ref A$1
      if (!isFunction && /^[A-Za-z]+$/.test(word) && formula[j] === '$' && /\d/.test(formula[j+1])) {
        let dstart = j + 1;
        let dend = dstart;
        while (dend < formula.length && /\d/.test(formula[dend])) dend++;
        const col = word.toUpperCase();
        const row = parseInt(formula.slice(dstart, dend), 10);
        const ref = { col, row, absCol: false, absRow: true };
        const result = handler(ref, pendingSheet !== null, pendingSheet);
        emitRef(result, dend - i);
        i = dend; continue;
      }
      const m = !isFunction && word.match(/^([A-Za-z]+)(\d+)$/);
      if (m) {
        const col = m[1].toUpperCase();
        const row = parseInt(m[2], 10);
        const ref = { col, row, absCol: false, absRow: false };
        const result = handler(ref, pendingSheet !== null, pendingSheet);
        emitRef(result, j - i);
        i = j; continue;
      }
      out += word; pendingSheet = null; pendingSheetLen = 0; i = j; continue;
    }
    emit(ch); i++;
  }
  return out;
}

function _refStr(ref) {
  return (ref.absCol ? '$' : '') + ref.col + (ref.absRow ? '$' : '') + ref.row;
}

function _sameName(a, b) { return (a||'').toUpperCase() === (b||'').toUpperCase(); }

// Structural-change rewriters. Used by Store.insertRow/deleteRow/insertCol/deleteCol
// to rewrite all formulas in all sheets BEFORE shifting the cells themselves.
// Unlike shiftFormulaRefs (which is for fill-handle and preserves absolute refs),
// these shift absolute refs too — that matches Excel's behavior for structural ops.
function applyRowInsertToFormula(formula, formulaSheet, targetSheet, insertedRow1based) {
  return _walkFormulaRefs(formula, (ref, isQualified, sheetName) => {
    const applies = isQualified ? _sameName(sheetName, targetSheet) : _sameName(formulaSheet, targetSheet);
    if (!applies) return null;
    if (ref.row < insertedRow1based) return null;
    const newRow = ref.row + 1;
    if (newRow > ROWS) return ERR.REF;
    return _refStr({ ...ref, row: newRow });
  });
}

function applyRowDeleteToFormula(formula, formulaSheet, targetSheet, deletedRow1based) {
  return _walkFormulaRefs(formula, (ref, isQualified, sheetName) => {
    const applies = isQualified ? _sameName(sheetName, targetSheet) : _sameName(formulaSheet, targetSheet);
    if (!applies) return null;
    if (ref.row === deletedRow1based) return ERR.REF;
    if (ref.row > deletedRow1based) return _refStr({ ...ref, row: ref.row - 1 });
    return null;
  });
}

function applyColInsertToFormula(formula, formulaSheet, targetSheet, insertedColIdx) {
  return _walkFormulaRefs(formula, (ref, isQualified, sheetName) => {
    const applies = isQualified ? _sameName(sheetName, targetSheet) : _sameName(formulaSheet, targetSheet);
    if (!applies) return null;
    const colIdx = COL_INDEX.get(ref.col);
    if (colIdx == null || colIdx < insertedColIdx) return null;
    const newIdx = colIdx + 1;
    if (newIdx >= COLS) return ERR.REF;
    return _refStr({ ...ref, col: COL_NAMES[newIdx] });
  });
}

function applyColDeleteToFormula(formula, formulaSheet, targetSheet, deletedColIdx) {
  return _walkFormulaRefs(formula, (ref, isQualified, sheetName) => {
    const applies = isQualified ? _sameName(sheetName, targetSheet) : _sameName(formulaSheet, targetSheet);
    if (!applies) return null;
    const colIdx = COL_INDEX.get(ref.col);
    if (colIdx == null) return null;
    if (colIdx === deletedColIdx) return ERR.REF;
    if (colIdx > deletedColIdx) return _refStr({ ...ref, col: COL_NAMES[colIdx - 1] });
    return null;
  });
}

// Marker used by SPARKLINE (and any future inline-SVG fn) so the renderer
// can safely tell engine-generated SVG apart from user-typed text.
const SVG_MARKER = 'SVG';
function isSvg(v) { return typeof v === 'string' && v.startsWith(SVG_MARKER); }

// Date serial numbers — Excel-compatible (1900-based with the leap year bug skipped)
// We use a simpler ISO-based representation but maintain serial conversion
const EPOCH = Date.UTC(1899, 11, 30); // 1899-12-30 (Excel's "day 0")
const MS_PER_DAY = 86400000;
function dateToSerial(d) {
  if (!(d instanceof Date)) return ERR.VALUE;
  return Math.floor((d.getTime() - EPOCH) / MS_PER_DAY);
}
function serialToDate(n) {
  return new Date(EPOCH + n * MS_PER_DAY);
}

// ════════════════════════════════════════════════════════════════════
// TOKENIZER
// ════════════════════════════════════════════════════════════════════

const T = {
  NUM: 'NUM', STR: 'STR', IDENT: 'IDENT', CELL: 'CELL', SHEETREF: 'SHEETREF',
  LPAREN: 'LPAREN', RPAREN: 'RPAREN', COMMA: 'COMMA', COLON: 'COLON',
  OP: 'OP', EOF: 'EOF'
};

function tokenize(input) {
  const tokens = [];
  let i = 0;
  const len = input.length;

  while (i < len) {
    const ch = input[i];

    if (ch === ' ' || ch === '\t') { i++; continue; }

    // Numbers
    if ((ch >= '0' && ch <= '9') || (ch === '.' && i+1 < len && input[i+1] >= '0' && input[i+1] <= '9')) {
      let start = i;
      while (i < len && ((input[i] >= '0' && input[i] <= '9') || input[i] === '.')) i++;
      tokens.push({type: T.NUM, val: parseFloat(input.slice(start, i))});
      continue;
    }

    // Strings
    if (ch === '"') {
      i++;
      let s = '';
      while (i < len && input[i] !== '"') {
        if (input[i] === '\\' && i+1 < len) { s += input[i+1]; i += 2; }
        else { s += input[i]; i++; }
      }
      if (i >= len) throw new Error('Unterminated string');
      i++;
      tokens.push({type: T.STR, val: s});
      continue;
    }

    // Single-quoted sheet name: 'Sheet Name'!A1
    if (ch === "'") {
      i++;
      let s = '';
      while (i < len && input[i] !== "'") {
        if (input[i] === "'" && input[i+1] === "'") { s += "'"; i += 2; }
        else { s += input[i]; i++; }
      }
      if (i >= len) throw new Error('Unterminated sheet name');
      i++;
      // Must be followed by !
      if (input[i] !== '!') throw new Error('Expected "!" after quoted sheet name');
      i++;
      tokens.push({type: T.SHEETREF, sheetName: s});
      continue;
    }

    // Absolute-col cell ref starting with $: $A1, $A$1
    if (ch === '$') {
      let j = i + 1;
      while (j < len && ((input[j] >= 'A' && input[j] <= 'Z') || (input[j] >= 'a' && input[j] <= 'z'))) j++;
      if (j > i + 1) {
        const col = input.slice(i + 1, j).toUpperCase();
        let absRow = false;
        if (input[j] === '$') { absRow = true; j++; }
        let dstart = j;
        while (j < len && input[j] >= '0' && input[j] <= '9') j++;
        if (j > dstart) {
          const upper = col + input.slice(dstart, j);
          const valid = !!parseCoord(upper);
          tokens.push(valid
            ? {type: T.CELL, val: upper, absCol: true, absRow}
            : {type: T.CELL, val: upper, absCol: true, absRow, invalid: true});
          i = j;
          continue;
        }
      }
      throw new Error(`Unexpected character: '$'`);
    }

    // Identifier / cell ref / sheet-qualified ref
    if ((ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') || ch === '_') {
      let start = i;
      while (i < len && ((input[i] >= 'A' && input[i] <= 'Z') ||
                         (input[i] >= 'a' && input[i] <= 'z') ||
                         (input[i] >= '0' && input[i] <= '9') ||
                         input[i] === '_')) i++;
      const word = input.slice(start, i);

      // Could be sheet-qualified: Sheet1!A1
      if (input[i] === '!') {
        i++;
        tokens.push({type: T.SHEETREF, sheetName: word});
        continue;
      }

      // Mixed ref A$1 — pure letters followed by $digits
      if (/^[A-Za-z]+$/.test(word) && input[i] === '$' && input[i+1] >= '0' && input[i+1] <= '9') {
        i++; // skip $
        let dstart = i;
        while (i < len && input[i] >= '0' && input[i] <= '9') i++;
        const upper = word.toUpperCase() + input.slice(dstart, i);
        const valid = !!parseCoord(upper);
        tokens.push(valid
          ? {type: T.CELL, val: upper, absRow: true}
          : {type: T.CELL, val: upper, absRow: true, invalid: true});
        continue;
      }

      // Could be a cell ref: letters followed by digits inside `word`
      // BUT: if it's followed by '(', it's a function name (e.g. LOG10()).
      const cellMatch = word.match(/^([A-Z]+)(\d+)$/i);
      if (cellMatch && input[i] !== '(') {
        const upper = word.toUpperCase();
        if (parseCoord(upper)) {
          tokens.push({type: T.CELL, val: upper});
        } else {
          tokens.push({type: T.CELL, val: upper, invalid: true});
        }
        continue;
      }

      tokens.push({type: T.IDENT, val: word.toUpperCase()});
      continue;
    }

    // Operators
    if (ch === '<' || ch === '>') {
      if (i+1 < len && input[i+1] === '=') { tokens.push({type: T.OP, val: ch + '='}); i += 2; continue; }
      if (ch === '<' && i+1 < len && input[i+1] === '>') { tokens.push({type: T.OP, val: '<>'}); i += 2; continue; }
      tokens.push({type: T.OP, val: ch}); i++; continue;
    }
    if (ch === '+' || ch === '-' || ch === '*' || ch === '/' || ch === '^' || ch === '=' || ch === '&' || ch === '%') {
      tokens.push({type: T.OP, val: ch}); i++; continue;
    }
    if (ch === '(') { tokens.push({type: T.LPAREN}); i++; continue; }
    if (ch === ')') { tokens.push({type: T.RPAREN}); i++; continue; }
    if (ch === ',') { tokens.push({type: T.COMMA}); i++; continue; }
    if (ch === ':') { tokens.push({type: T.COLON}); i++; continue; }

    // Literal error tokens (#REF!, #DIV/0!, #NAME?, …) — emitted by structural
    // rewriters and round-tripped through formula text. Parse as a Str whose
    // value is the error string; downstream operators see it via isError() and
    // propagate the error naturally.
    if (ch === '#') {
      let j = i + 1;
      while (j < len && /[A-Z0-9/]/i.test(input[j])) j++;
      if (input[j] === '!' || input[j] === '?') j++;
      const errTok = input.slice(i, j);
      if (ALL_ERRORS.has(errTok)) {
        tokens.push({type: T.STR, val: errTok});
        i = j; continue;
      }
      throw new Error(`Unexpected character: '#'`);
    }

    throw new Error(`Unexpected character: '${ch}'`);
  }
  tokens.push({type: T.EOF});
  return tokens;
}

// ════════════════════════════════════════════════════════════════════
// PARSER
// ════════════════════════════════════════════════════════════════════

function parse(tokens) {
  let pos = 0;
  const peek = () => tokens[pos];
  const consume = () => tokens[pos++];
  const expect = (type) => {
    if (tokens[pos].type !== type) throw new Error(`Expected ${type}, got ${tokens[pos].type}`);
    return tokens[pos++];
  };

  function parseExpr() { return parseComparison(); }

  function parseComparison() {
    let left = parseAdditive();
    while (peek().type === T.OP && ['<','<=','>','>=','=','<>'].includes(peek().val)) {
      const op = consume().val;
      const right = parseAdditive();
      left = {type: 'BinOp', op, left, right};
    }
    return left;
  }

  function parseAdditive() {
    let left = parseMultiplicative();
    while (peek().type === T.OP && ['+','-','&'].includes(peek().val)) {
      const op = consume().val;
      const right = parseMultiplicative();
      left = {type: 'BinOp', op, left, right};
    }
    return left;
  }

  function parseMultiplicative() {
    let left = parsePower();
    while (peek().type === T.OP && ['*','/'].includes(peek().val)) {
      const op = consume().val;
      const right = parsePower();
      left = {type: 'BinOp', op, left, right};
    }
    return left;
  }

  function parsePower() {
    let left = parseUnary();
    if (peek().type === T.OP && peek().val === '^') {
      consume();
      const right = parsePower(); // right-associative
      return {type: 'BinOp', op: '^', left, right};
    }
    return left;
  }

  function parseUnary() {
    if (peek().type === T.OP && (peek().val === '-' || peek().val === '+')) {
      const op = consume().val;
      const operand = parseUnary();
      return {type: 'UnaryOp', op, operand};
    }
    let result = parsePrimary();
    // Postfix percent: 50% means 0.5
    while (peek().type === T.OP && peek().val === '%') {
      consume();
      result = {type: 'UnaryOp', op: '%', operand: result};
    }
    return result;
  }

  function parsePrimary() {
    const t = peek();
    if (t.type === T.NUM) { consume(); return {type: 'Num', val: t.val}; }
    if (t.type === T.STR) { consume(); return {type: 'Str', val: t.val}; }
    if (t.type === T.LPAREN) {
      consume();
      const expr = parseExpr();
      expect(T.RPAREN);
      return expr;
    }

    // Sheet-qualified ref: SheetRef CELL or SheetRef CELL : CELL
    if (t.type === T.SHEETREF) {
      consume();
      const sheetName = t.sheetName;
      const next = peek();
      if (next.type !== T.CELL) throw new Error('Expected cell reference after sheet name');
      consume();
      if (peek().type === T.COLON) {
        consume();
        const endTok = peek();
        if (endTok.type !== T.CELL) throw new Error('Expected cell after ":"');
        consume();
        return {type: 'Range', sheet: sheetName, start: next.val, end: endTok.val, invalid: next.invalid || endTok.invalid};
      }
      return {type: 'CellRef', sheet: sheetName, val: next.val, invalid: next.invalid};
    }

    if (t.type === T.CELL) {
      consume();
      if (t.invalid) return {type: 'CellRef', val: t.val, invalid: true};
      if (peek().type === T.COLON) {
        consume();
        const endTok = peek();
        if (endTok.type !== T.CELL) throw new Error('Expected cell after ":"');
        consume();
        return {type: 'Range', start: t.val, end: endTok.val, invalid: t.invalid || endTok.invalid};
      }
      return {type: 'CellRef', val: t.val};
    }
    if (t.type === T.IDENT) {
      consume();
      if (peek().type !== T.LPAREN) {
        // Could be a boolean literal or named constant
        if (t.val === 'TRUE') return {type: 'Bool', val: true};
        if (t.val === 'FALSE') return {type: 'Bool', val: false};
        throw new Error(`Bare identifier "${t.val}" (functions need parens)`);
      }
      consume();
      const args = [];
      if (peek().type !== T.RPAREN) {
        args.push(parseExpr());
        while (peek().type === T.COMMA) { consume(); args.push(parseExpr()); }
      }
      expect(T.RPAREN);
      return {type: 'FuncCall', name: t.val, args};
    }
    throw new Error(`Unexpected token: ${t.type} ${t.val ?? ''}`);
  }

  const result = parseExpr();
  if (peek().type !== T.EOF) throw new Error('Extra tokens after expression');
  return result;
}

// ════════════════════════════════════════════════════════════════════
// EVALUATOR
// ════════════════════════════════════════════════════════════════════

function toNum(v) {
  if (isError(v)) return v;
  if (typeof v === 'number') return v;
  if (v === '' || v == null) return 0;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string' && isStrictNumber(v)) return parseFloat(v);
  return ERR.VALUE;
}
function toStr(v) {
  if (isError(v)) return v;
  if (v == null) return '';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return String(v);
}
function toBool(v) {
  if (isError(v)) return v;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') {
    if (v.toLowerCase() === 'true') return true;
    if (v.toLowerCase() === 'false') return false;
    return v !== '';
  }
  return !!v;
}

// Smart compare for binary ops: number<>number numeric, otherwise string
function smartCmp(a, b) {
  if (typeof a === 'string' && isStrictNumber(a)) a = parseFloat(a);
  if (typeof b === 'string' && isStrictNumber(b)) b = parseFloat(b);
  return [a, b];
}

// Convert wildcard pattern (Excel-style: * ?) to regex
function wildcardToRegex(pattern) {
  if (typeof pattern !== 'string') return null;
  let re = '^';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*') re += '.*';
    else if (c === '?') re += '.';
    else if (c === '~' && (pattern[i+1] === '*' || pattern[i+1] === '?')) { re += '\\' + pattern[++i]; }
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  re += '$';
  return new RegExp(re, 'i');
}

// Check if a value matches an Excel-style criterion: ">100", "<50", "<>0", "abc", "ab*"
function matchesCriterion(value, criterion) {
  if (typeof criterion === 'number') {
    const n = toNum(value);
    return !isError(n) && n === criterion;
  }
  if (typeof criterion !== 'string') return value === criterion;

  // Parse comparator prefix
  let cmp = '=';
  let target = criterion;
  if (criterion.startsWith('>=')) { cmp = '>='; target = criterion.slice(2); }
  else if (criterion.startsWith('<=')) { cmp = '<='; target = criterion.slice(2); }
  else if (criterion.startsWith('<>')) { cmp = '<>'; target = criterion.slice(2); }
  else if (criterion.startsWith('>'))  { cmp = '>';  target = criterion.slice(1); }
  else if (criterion.startsWith('<'))  { cmp = '<';  target = criterion.slice(1); }
  else if (criterion.startsWith('='))  { cmp = '=';  target = criterion.slice(1); }

  target = target.trim();

  // Numeric comparison if target is numeric
  if (isStrictNumber(target)) {
    const tn = parseFloat(target);
    const vn = (typeof value === 'number') ? value : (typeof value === 'string' && isStrictNumber(value) ? parseFloat(value) : null);
    if (vn === null) {
      // For = and <> on text, fall through to string compare
      if (cmp === '=' || cmp === '<>') {
        return cmp === '<>' ? (String(value) !== target) : (String(value) === target);
      }
      return false;
    }
    switch (cmp) {
      case '=':  return vn === tn;
      case '<>': return vn !== tn;
      case '>':  return vn > tn;
      case '>=': return vn >= tn;
      case '<':  return vn < tn;
      case '<=': return vn <= tn;
    }
  }

  // String comparison; for = and <> support wildcards
  const sv = (value == null) ? '' : String(value);
  if (cmp === '=' || cmp === '<>') {
    if (target.includes('*') || target.includes('?')) {
      const re = wildcardToRegex(target);
      const matches = re.test(sv);
      return cmp === '<>' ? !matches : matches;
    }
    const eq = sv.toLowerCase() === target.toLowerCase();
    return cmp === '<>' ? !eq : eq;
  }
  switch (cmp) {
    case '>':  return sv > target;
    case '>=': return sv >= target;
    case '<':  return sv < target;
    case '<=': return sv <= target;
  }
  return false;
}

// ════════════════════════════════════════════════════════════════════
// BUILT-IN FUNCTIONS
// ════════════════════════════════════════════════════════════════════

const FUNCTIONS = {

  // ─── Math / Stats ─────────────────────────────────────────────────
  SUM(args, ctx) {
    const flat = ctx.flatten(args);
    let sum = 0;
    for (const v of flat) {
      if (isError(v)) return v;
      if (typeof v === 'number') sum += v;
      else if (typeof v === 'string' && isStrictNumber(v)) sum += parseFloat(v);
    }
    return sum;
  },
  AVERAGE(args, ctx) {
    const flat = ctx.flatten(args);
    let sum = 0, count = 0;
    for (const v of flat) {
      if (isError(v)) return v;
      if (typeof v === 'number') { sum += v; count++; }
      else if (typeof v === 'string' && isStrictNumber(v)) { sum += parseFloat(v); count++; }
    }
    if (count === 0) return ERR.DIV0;
    return sum / count;
  },
  COUNT(args, ctx) {
    const flat = ctx.flatten(args);
    let count = 0;
    for (const v of flat) {
      if (isError(v)) continue;
      if (typeof v === 'number') count++;
      else if (typeof v === 'string' && isStrictNumber(v)) count++;
    }
    return count;
  },
  COUNTA(args, ctx) {
    const flat = ctx.flatten(args);
    let count = 0;
    for (const v of flat) if (v !== '' && v != null && !isError(v)) count++;
    return count;
  },
  COUNTBLANK(args, ctx) {
    const flat = ctx.flatten(args);
    let count = 0;
    for (const v of flat) if (v === '' || v == null) count++;
    return count;
  },
  MIN(args, ctx) {
    const flat = ctx.flatten(args);
    let m = Infinity;
    for (const v of flat) {
      if (isError(v)) return v;
      const n = (typeof v === 'number') ? v : (typeof v === 'string' && isStrictNumber(v) ? parseFloat(v) : null);
      if (n !== null && n < m) m = n;
    }
    return m === Infinity ? 0 : m;
  },
  MAX(args, ctx) {
    const flat = ctx.flatten(args);
    let m = -Infinity;
    for (const v of flat) {
      if (isError(v)) return v;
      const n = (typeof v === 'number') ? v : (typeof v === 'string' && isStrictNumber(v) ? parseFloat(v) : null);
      if (n !== null && n > m) m = n;
    }
    return m === -Infinity ? 0 : m;
  },
  MEDIAN(args, ctx) {
    const flat = ctx.flatten(args);
    const nums = [];
    for (const v of flat) {
      if (isError(v)) return v;
      if (typeof v === 'number') nums.push(v);
      else if (typeof v === 'string' && isStrictNumber(v)) nums.push(parseFloat(v));
    }
    if (nums.length === 0) return ERR.NUM;
    nums.sort((a, b) => a - b);
    const mid = Math.floor(nums.length / 2);
    return nums.length % 2 ? nums[mid] : (nums[mid-1] + nums[mid]) / 2;
  },
  STDEV(args, ctx) {
    const flat = ctx.flatten(args);
    const nums = [];
    for (const v of flat) {
      if (isError(v)) return v;
      if (typeof v === 'number') nums.push(v);
      else if (typeof v === 'string' && isStrictNumber(v)) nums.push(parseFloat(v));
    }
    if (nums.length < 2) return ERR.DIV0;
    const mean = nums.reduce((a,b) => a+b, 0) / nums.length;
    const variance = nums.reduce((a,b) => a + (b - mean) ** 2, 0) / (nums.length - 1);
    return Math.sqrt(variance);
  },
  VAR(args, ctx) {
    const flat = ctx.flatten(args);
    const nums = [];
    for (const v of flat) {
      if (isError(v)) return v;
      if (typeof v === 'number') nums.push(v);
      else if (typeof v === 'string' && isStrictNumber(v)) nums.push(parseFloat(v));
    }
    if (nums.length < 2) return ERR.DIV0;
    const mean = nums.reduce((a,b) => a+b, 0) / nums.length;
    return nums.reduce((a,b) => a + (b - mean) ** 2, 0) / (nums.length - 1);
  },
  PRODUCT(args, ctx) {
    const flat = ctx.flatten(args);
    let p = 1, has = false;
    for (const v of flat) {
      if (isError(v)) return v;
      let n = null;
      if (typeof v === 'number') n = v;
      else if (typeof v === 'string' && isStrictNumber(v)) n = parseFloat(v);
      if (n !== null) { p *= n; has = true; }
    }
    return has ? p : 0;
  },
  ROUND(args) {
    if (args.length !== 2) return ERR.VALUE;
    const n = toNum(args[0]); if (isError(n)) return n;
    const d = toNum(args[1]); if (isError(d)) return d;
    const mul = Math.pow(10, Math.floor(d));
    return Math.round(n * mul) / mul;
  },
  ROUNDUP(args) {
    if (args.length !== 2) return ERR.VALUE;
    const n = toNum(args[0]); if (isError(n)) return n;
    const d = toNum(args[1]); if (isError(d)) return d;
    const mul = Math.pow(10, Math.floor(d));
    return (n >= 0 ? Math.ceil(n * mul) : Math.floor(n * mul)) / mul;
  },
  ROUNDDOWN(args) {
    if (args.length !== 2) return ERR.VALUE;
    const n = toNum(args[0]); if (isError(n)) return n;
    const d = toNum(args[1]); if (isError(d)) return d;
    const mul = Math.pow(10, Math.floor(d));
    return (n >= 0 ? Math.floor(n * mul) : Math.ceil(n * mul)) / mul;
  },
  FLOOR(args) {
    if (args.length < 1) return ERR.VALUE;
    const n = toNum(args[0]); if (isError(n)) return n;
    return Math.floor(n);
  },
  CEILING(args) {
    if (args.length < 1) return ERR.VALUE;
    const n = toNum(args[0]); if (isError(n)) return n;
    return Math.ceil(n);
  },
  INT(args) {
    if (args.length !== 1) return ERR.VALUE;
    const n = toNum(args[0]); if (isError(n)) return n;
    return Math.floor(n);
  },
  MOD(args) {
    if (args.length !== 2) return ERR.VALUE;
    const a = toNum(args[0]); if (isError(a)) return a;
    const b = toNum(args[1]); if (isError(b)) return b;
    if (b === 0) return ERR.DIV0;
    return a - b * Math.floor(a / b);
  },
  ABS(args) {
    if (args.length !== 1) return ERR.VALUE;
    const n = toNum(args[0]); if (isError(n)) return n;
    return Math.abs(n);
  },
  SQRT(args) {
    if (args.length !== 1) return ERR.VALUE;
    const n = toNum(args[0]); if (isError(n)) return n;
    if (n < 0) return ERR.NUM;
    return Math.sqrt(n);
  },
  POWER(args) {
    if (args.length !== 2) return ERR.VALUE;
    const b = toNum(args[0]); if (isError(b)) return b;
    const e = toNum(args[1]); if (isError(e)) return e;
    return Math.pow(b, e);
  },
  EXP(args) {
    if (args.length !== 1) return ERR.VALUE;
    const n = toNum(args[0]); if (isError(n)) return n;
    return Math.exp(n);
  },
  LN(args) {
    if (args.length !== 1) return ERR.VALUE;
    const n = toNum(args[0]); if (isError(n)) return n;
    if (n <= 0) return ERR.NUM;
    return Math.log(n);
  },
  LOG(args) {
    const n = toNum(args[0]); if (isError(n)) return n;
    if (n <= 0) return ERR.NUM;
    const base = args.length > 1 ? toNum(args[1]) : 10;
    if (isError(base)) return base;
    if (base <= 0 || base === 1) return ERR.NUM;
    return Math.log(n) / Math.log(base);
  },
  LOG10(args) {
    if (args.length !== 1) return ERR.VALUE;
    const n = toNum(args[0]); if (isError(n)) return n;
    if (n <= 0) return ERR.NUM;
    return Math.log10(n);
  },
  PI() { return Math.PI; },
  RAND() { return Math.random(); },
  RANDBETWEEN(args) {
    if (args.length !== 2) return ERR.VALUE;
    const lo = toNum(args[0]); if (isError(lo)) return lo;
    const hi = toNum(args[1]); if (isError(hi)) return hi;
    return Math.floor(Math.random() * (Math.floor(hi) - Math.ceil(lo) + 1)) + Math.ceil(lo);
  },
  SIGN(args) {
    if (args.length !== 1) return ERR.VALUE;
    const n = toNum(args[0]); if (isError(n)) return n;
    return Math.sign(n);
  },

  // ─── Logical ──────────────────────────────────────────────────────
  IF(args) {
    if (args.length < 2 || args.length > 3) return ERR.VALUE;
    if (isError(args[0])) return args[0];
    return toBool(args[0]) ? args[1] : (args.length === 3 ? args[2] : false);
  },
  IFERROR(args) {
    if (args.length !== 2) return ERR.VALUE;
    return isError(args[0]) ? args[1] : args[0];
  },
  IFNA(args) {
    if (args.length !== 2) return ERR.VALUE;
    return args[0] === ERR.NA ? args[1] : args[0];
  },
  IFS(args) {
    if (args.length < 2 || args.length % 2 !== 0) return ERR.VALUE;
    for (let i = 0; i < args.length; i += 2) {
      if (isError(args[i])) return args[i];
      if (toBool(args[i])) return args[i+1];
    }
    return ERR.NA;
  },
  SWITCH(args) {
    if (args.length < 3) return ERR.VALUE;
    const expr = args[0];
    if (isError(expr)) return expr;
    let i = 1;
    while (i + 1 < args.length) {
      if (args[i] === expr) return args[i+1];
      // Smart numeric compare
      const [a, b] = smartCmp(expr, args[i]);
      if (a === b) return args[i+1];
      i += 2;
    }
    // Default case (odd remaining arg)
    return i < args.length ? args[i] : ERR.NA;
  },
  NOT(args) {
    if (args.length !== 1) return ERR.VALUE;
    if (isError(args[0])) return args[0];
    return !toBool(args[0]);
  },
  AND(args, ctx) {
    const flat = ctx.flatten(args);
    if (flat.length === 0) return ERR.VALUE;
    for (const v of flat) {
      if (isError(v)) return v;
      if (!toBool(v)) return false;
    }
    return true;
  },
  OR(args, ctx) {
    const flat = ctx.flatten(args);
    if (flat.length === 0) return ERR.VALUE;
    for (const v of flat) {
      if (isError(v)) return v;
      if (toBool(v)) return true;
    }
    return false;
  },
  XOR(args, ctx) {
    const flat = ctx.flatten(args);
    let trueCount = 0;
    for (const v of flat) {
      if (isError(v)) return v;
      if (toBool(v)) trueCount++;
    }
    return trueCount % 2 === 1;
  },
  TRUE() { return true; },
  FALSE() { return false; },

  // ─── Text ─────────────────────────────────────────────────────────
  CONCAT(args, ctx) {
    const flat = ctx.flatten(args);
    let s = '';
    for (const v of flat) { if (isError(v)) return v; s += toStr(v); }
    return s;
  },
  CONCATENATE(args, ctx) { return FUNCTIONS.CONCAT(args, ctx); },
  TEXTJOIN(args, ctx) {
    if (args.length < 3) return ERR.VALUE;
    const sep = toStr(args[0]);
    const ignoreEmpty = toBool(args[1]);
    const rest = ctx.flatten(args.slice(2));
    const parts = [];
    for (const v of rest) {
      if (isError(v)) return v;
      const s = toStr(v);
      if (ignoreEmpty && s === '') continue;
      parts.push(s);
    }
    return parts.join(sep);
  },
  LEN(args) {
    if (args.length !== 1) return ERR.VALUE;
    if (isError(args[0])) return args[0];
    return toStr(args[0]).length;
  },
  UPPER(args) {
    if (args.length !== 1) return ERR.VALUE;
    if (isError(args[0])) return args[0];
    return toStr(args[0]).toUpperCase();
  },
  LOWER(args) {
    if (args.length !== 1) return ERR.VALUE;
    if (isError(args[0])) return args[0];
    return toStr(args[0]).toLowerCase();
  },
  PROPER(args) {
    if (args.length !== 1) return ERR.VALUE;
    if (isError(args[0])) return args[0];
    return toStr(args[0]).replace(/\b\w/g, c => c.toUpperCase());
  },
  TRIM(args) {
    if (args.length !== 1) return ERR.VALUE;
    if (isError(args[0])) return args[0];
    return toStr(args[0]).trim().replace(/\s+/g, ' ');
  },
  LEFT(args) {
    if (args.length < 1 || args.length > 2) return ERR.VALUE;
    if (isError(args[0])) return args[0];
    const s = toStr(args[0]);
    const n = args.length === 2 ? toNum(args[1]) : 1;
    if (isError(n)) return n;
    return s.slice(0, Math.max(0, Math.floor(n)));
  },
  RIGHT(args) {
    if (args.length < 1 || args.length > 2) return ERR.VALUE;
    if (isError(args[0])) return args[0];
    const s = toStr(args[0]);
    const n = args.length === 2 ? toNum(args[1]) : 1;
    if (isError(n)) return n;
    return n <= 0 ? '' : s.slice(-Math.floor(n));
  },
  MID(args) {
    if (args.length !== 3) return ERR.VALUE;
    if (isError(args[0])) return args[0];
    const s = toStr(args[0]);
    const start = toNum(args[1]); if (isError(start)) return start;
    const len = toNum(args[2]); if (isError(len)) return len;
    return s.substr(Math.max(0, Math.floor(start) - 1), Math.max(0, Math.floor(len)));
  },
  FIND(args) {
    if (args.length < 2 || args.length > 3) return ERR.VALUE;
    const needle = toStr(args[0]);
    const hay = toStr(args[1]);
    const start = args.length === 3 ? Math.max(1, Math.floor(toNum(args[2]))) : 1;
    const idx = hay.indexOf(needle, start - 1);
    return idx === -1 ? ERR.VALUE : idx + 1;
  },
  SEARCH(args) {
    if (args.length < 2 || args.length > 3) return ERR.VALUE;
    const needle = toStr(args[0]).toLowerCase();
    const hay = toStr(args[1]).toLowerCase();
    const start = args.length === 3 ? Math.max(1, Math.floor(toNum(args[2]))) : 1;
    const idx = hay.indexOf(needle, start - 1);
    return idx === -1 ? ERR.VALUE : idx + 1;
  },
  REPLACE(args) {
    if (args.length !== 4) return ERR.VALUE;
    const s = toStr(args[0]);
    const start = Math.max(1, Math.floor(toNum(args[1])));
    const len = Math.max(0, Math.floor(toNum(args[2])));
    const newStr = toStr(args[3]);
    return s.slice(0, start - 1) + newStr + s.slice(start - 1 + len);
  },
  SUBSTITUTE(args) {
    if (args.length < 3 || args.length > 4) return ERR.VALUE;
    const s = toStr(args[0]);
    const oldStr = toStr(args[1]);
    const newStr = toStr(args[2]);
    if (oldStr === '') return s;
    if (args.length === 3) return s.split(oldStr).join(newStr);
    const which = Math.floor(toNum(args[3]));
    let count = 0, result = '', i = 0;
    while (i < s.length) {
      if (s.substr(i, oldStr.length) === oldStr) {
        count++;
        if (count === which) return s.slice(0, i) + newStr + s.slice(i + oldStr.length);
        result += s[i];
        i++;
      } else { result += s[i]; i++; }
    }
    return s;
  },
  REPT(args) {
    if (args.length !== 2) return ERR.VALUE;
    const s = toStr(args[0]);
    const n = Math.max(0, Math.floor(toNum(args[1])));
    return s.repeat(n);
  },
  VALUE(args) {
    if (args.length !== 1) return ERR.VALUE;
    if (isError(args[0])) return args[0];
    const s = toStr(args[0]).trim();
    if (isStrictNumber(s)) return parseFloat(s);
    return ERR.VALUE;
  },
  TEXT(args) {
    if (args.length !== 2) return ERR.VALUE;
    const n = toNum(args[0]); if (isError(n)) return n;
    const fmt = toStr(args[1]);
    // Minimal format support: "0", "0.00", "0%", "$#,##0.00"
    if (fmt === '0') return String(Math.round(n));
    if (fmt === '0.00') return n.toFixed(2);
    if (fmt === '0%') return Math.round(n * 100) + '%';
    if (fmt === '0.00%') return (n * 100).toFixed(2) + '%';
    if (fmt.includes('$')) return n.toLocaleString('en-US', {style:'currency', currency:'USD'});
    if (fmt.includes(',')) return n.toLocaleString('en-US');
    return String(n);
  },
  EXACT(args) {
    if (args.length !== 2) return ERR.VALUE;
    return toStr(args[0]) === toStr(args[1]);
  },

  // ─── Lookup ───────────────────────────────────────────────────────
  VLOOKUP(args, ctx) {
    if (args.length < 3 || args.length > 4) return ERR.VALUE;
    const lookup = args[0];
    const range = args[1];
    const colIdx = Math.floor(toNum(args[2]));
    if (isError(colIdx)) return colIdx;
    const exact = args.length === 4 ? !toBool(args[3]) : false;
    if (!Array.isArray(range) || !ctx.rangeMeta) return ERR.VALUE;
    // range is flat; we need its 2D shape from meta
    const meta = ctx.rangeMeta(1); // metadata for args[1]
    if (!meta) return ERR.VALUE;
    const {rows, cols} = meta;
    if (colIdx < 1 || colIdx > cols) return ERR.REF;
    for (let r = 0; r < rows; r++) {
      const cellVal = range[r * cols];
      if (isError(cellVal)) continue;
      let match = false;
      if (typeof lookup === 'number' && typeof cellVal === 'number') match = lookup === cellVal;
      else if (typeof lookup === 'string' && typeof cellVal === 'string') match = lookup.toLowerCase() === cellVal.toLowerCase();
      else {
        const [a, b] = smartCmp(lookup, cellVal);
        match = a === b;
      }
      if (match) return range[r * cols + (colIdx - 1)];
      if (!exact && cellVal !== '' && cellVal != null) {
        // approximate match: return last value where cellVal <= lookup (sorted assumption)
        // For simplicity we only do exact match in this implementation. Use FALSE/0 for exact.
      }
    }
    return ERR.NA;
  },
  HLOOKUP(args, ctx) {
    if (args.length < 3 || args.length > 4) return ERR.VALUE;
    const lookup = args[0];
    const range = args[1];
    const rowIdx = Math.floor(toNum(args[2]));
    if (isError(rowIdx)) return rowIdx;
    if (!Array.isArray(range) || !ctx.rangeMeta) return ERR.VALUE;
    const meta = ctx.rangeMeta(1);
    if (!meta) return ERR.VALUE;
    const {rows, cols} = meta;
    if (rowIdx < 1 || rowIdx > rows) return ERR.REF;
    for (let c = 0; c < cols; c++) {
      const cellVal = range[c];
      if (isError(cellVal)) continue;
      let match = false;
      if (typeof lookup === 'number' && typeof cellVal === 'number') match = lookup === cellVal;
      else if (typeof lookup === 'string' && typeof cellVal === 'string') match = lookup.toLowerCase() === cellVal.toLowerCase();
      else {
        const [a, b] = smartCmp(lookup, cellVal);
        match = a === b;
      }
      if (match) return range[(rowIdx - 1) * cols + c];
    }
    return ERR.NA;
  },
  INDEX(args, ctx) {
    if (args.length < 2 || args.length > 3) return ERR.VALUE;
    const range = args[0];
    const rowIdx = Math.floor(toNum(args[1]));
    if (isError(rowIdx)) return rowIdx;
    if (!Array.isArray(range)) return range; // single value
    if (!ctx.rangeMeta) return ERR.VALUE;
    const meta = ctx.rangeMeta(0);
    if (!meta) return ERR.VALUE;
    const {rows, cols} = meta;
    if (args.length === 2) {
      // Single-dimension: if range is single row or column, treat rowIdx as the index
      if (rows === 1) {
        if (rowIdx < 1 || rowIdx > cols) return ERR.REF;
        return range[rowIdx - 1];
      }
      if (cols === 1) {
        if (rowIdx < 1 || rowIdx > rows) return ERR.REF;
        return range[rowIdx - 1];
      }
      // 2D with one arg: return whole row (but we don't have row-as-array, so use first col)
      if (rowIdx < 1 || rowIdx > rows) return ERR.REF;
      return range[(rowIdx - 1) * cols];
    }
    const colIdx = Math.floor(toNum(args[2]));
    if (isError(colIdx)) return colIdx;
    if (rowIdx < 1 || rowIdx > rows || colIdx < 1 || colIdx > cols) return ERR.REF;
    return range[(rowIdx - 1) * cols + (colIdx - 1)];
  },
  MATCH(args, ctx) {
    if (args.length < 2 || args.length > 3) return ERR.VALUE;
    const lookup = args[0];
    const range = args[1];
    const matchType = args.length === 3 ? Math.floor(toNum(args[2])) : 1;
    if (!Array.isArray(range)) return lookup === range ? 1 : ERR.NA;
    for (let i = 0; i < range.length; i++) {
      let match = false;
      if (typeof lookup === typeof range[i]) match = lookup === range[i];
      if (typeof lookup === 'string' && typeof range[i] === 'string') match = lookup.toLowerCase() === range[i].toLowerCase();
      if (!match) {
        const [a, b] = smartCmp(lookup, range[i]);
        match = a === b;
      }
      if (match) return i + 1;
    }
    return ERR.NA;
  },
  XLOOKUP(args, ctx) {
    // XLOOKUP(lookup, lookup_array, return_array, [if_not_found])
    if (args.length < 3) return ERR.VALUE;
    const lookup = args[0];
    const lookupArr = Array.isArray(args[1]) ? args[1] : [args[1]];
    const returnArr = Array.isArray(args[2]) ? args[2] : [args[2]];
    const ifNotFound = args.length >= 4 ? args[3] : ERR.NA;
    for (let i = 0; i < lookupArr.length; i++) {
      let match = false;
      if (typeof lookup === 'string' && typeof lookupArr[i] === 'string') match = lookup.toLowerCase() === lookupArr[i].toLowerCase();
      else {
        const [a, b] = smartCmp(lookup, lookupArr[i]);
        match = a === b;
      }
      if (match) return returnArr[i];
    }
    return ifNotFound;
  },
  ROW(args, ctx) {
    if (!args.length) return ctx.currentRow ? ctx.currentRow + 1 : 1;
    // First cell of the ref
    const meta = ctx.rangeMeta && ctx.rangeMeta(0);
    if (meta && meta.startRow !== undefined) return meta.startRow + 1;
    return ERR.VALUE;
  },
  COLUMN(args, ctx) {
    if (!args.length) return ctx.currentCol ? ctx.currentCol + 1 : 1;
    const meta = ctx.rangeMeta && ctx.rangeMeta(0);
    if (meta && meta.startCol !== undefined) return meta.startCol + 1;
    return ERR.VALUE;
  },
  ROWS(args, ctx) {
    const meta = ctx.rangeMeta && ctx.rangeMeta(0);
    if (meta) return meta.rows;
    return 1;
  },
  COLUMNS(args, ctx) {
    const meta = ctx.rangeMeta && ctx.rangeMeta(0);
    if (meta) return meta.cols;
    return 1;
  },

  // ─── Conditional aggregates ───────────────────────────────────────
  SUMIF(args, ctx) {
    if (args.length < 2 || args.length > 3) return ERR.VALUE;
    const criteriaRange = Array.isArray(args[0]) ? args[0] : [args[0]];
    const criterion = args[1];
    const sumRange = args.length === 3 ? (Array.isArray(args[2]) ? args[2] : [args[2]]) : criteriaRange;
    let sum = 0;
    for (let i = 0; i < criteriaRange.length; i++) {
      if (matchesCriterion(criteriaRange[i], criterion)) {
        const v = sumRange[i];
        if (typeof v === 'number') sum += v;
        else if (typeof v === 'string' && isStrictNumber(v)) sum += parseFloat(v);
      }
    }
    return sum;
  },
  COUNTIF(args) {
    if (args.length !== 2) return ERR.VALUE;
    const range = Array.isArray(args[0]) ? args[0] : [args[0]];
    const criterion = args[1];
    let count = 0;
    for (const v of range) if (matchesCriterion(v, criterion)) count++;
    return count;
  },
  AVERAGEIF(args) {
    if (args.length < 2 || args.length > 3) return ERR.VALUE;
    const criteriaRange = Array.isArray(args[0]) ? args[0] : [args[0]];
    const criterion = args[1];
    const avgRange = args.length === 3 ? (Array.isArray(args[2]) ? args[2] : [args[2]]) : criteriaRange;
    let sum = 0, count = 0;
    for (let i = 0; i < criteriaRange.length; i++) {
      if (matchesCriterion(criteriaRange[i], criterion)) {
        const v = avgRange[i];
        if (typeof v === 'number') { sum += v; count++; }
        else if (typeof v === 'string' && isStrictNumber(v)) { sum += parseFloat(v); count++; }
      }
    }
    if (count === 0) return ERR.DIV0;
    return sum / count;
  },
  SUMIFS(args) {
    if (args.length < 3 || (args.length - 1) % 2 !== 0) return ERR.VALUE;
    const sumRange = Array.isArray(args[0]) ? args[0] : [args[0]];
    let sum = 0;
    for (let i = 0; i < sumRange.length; i++) {
      let match = true;
      for (let j = 1; j < args.length; j += 2) {
        const critRange = Array.isArray(args[j]) ? args[j] : [args[j]];
        if (!matchesCriterion(critRange[i], args[j+1])) { match = false; break; }
      }
      if (match) {
        const v = sumRange[i];
        if (typeof v === 'number') sum += v;
        else if (typeof v === 'string' && isStrictNumber(v)) sum += parseFloat(v);
      }
    }
    return sum;
  },
  COUNTIFS(args) {
    if (args.length < 2 || args.length % 2 !== 0) return ERR.VALUE;
    const first = Array.isArray(args[0]) ? args[0] : [args[0]];
    let count = 0;
    for (let i = 0; i < first.length; i++) {
      let match = true;
      for (let j = 0; j < args.length; j += 2) {
        const critRange = Array.isArray(args[j]) ? args[j] : [args[j]];
        if (!matchesCriterion(critRange[i], args[j+1])) { match = false; break; }
      }
      if (match) count++;
    }
    return count;
  },
  AVERAGEIFS(args) {
    if (args.length < 3 || (args.length - 1) % 2 !== 0) return ERR.VALUE;
    const avgRange = Array.isArray(args[0]) ? args[0] : [args[0]];
    let sum = 0, count = 0;
    for (let i = 0; i < avgRange.length; i++) {
      let match = true;
      for (let j = 1; j < args.length; j += 2) {
        const critRange = Array.isArray(args[j]) ? args[j] : [args[j]];
        if (!matchesCriterion(critRange[i], args[j+1])) { match = false; break; }
      }
      if (match) {
        const v = avgRange[i];
        if (typeof v === 'number') { sum += v; count++; }
        else if (typeof v === 'string' && isStrictNumber(v)) { sum += parseFloat(v); count++; }
      }
    }
    if (count === 0) return ERR.DIV0;
    return sum / count;
  },

  // ─── Dates ────────────────────────────────────────────────────────
  TODAY() {
    const now = new Date();
    const utc = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.floor((utc - EPOCH) / MS_PER_DAY);
  },
  NOW() {
    return (Date.now() - EPOCH) / MS_PER_DAY;
  },
  DATE(args) {
    if (args.length !== 3) return ERR.VALUE;
    const y = Math.floor(toNum(args[0]));
    const m = Math.floor(toNum(args[1]));
    const d = Math.floor(toNum(args[2]));
    if (isError(y) || isError(m) || isError(d)) return ERR.VALUE;
    const dt = new Date(Date.UTC(y, m - 1, d));
    return Math.floor((dt.getTime() - EPOCH) / MS_PER_DAY);
  },
  YEAR(args) {
    if (args.length !== 1) return ERR.VALUE;
    const n = toNum(args[0]); if (isError(n)) return n;
    return serialToDate(n).getUTCFullYear();
  },
  MONTH(args) {
    if (args.length !== 1) return ERR.VALUE;
    const n = toNum(args[0]); if (isError(n)) return n;
    return serialToDate(n).getUTCMonth() + 1;
  },
  DAY(args) {
    if (args.length !== 1) return ERR.VALUE;
    const n = toNum(args[0]); if (isError(n)) return n;
    return serialToDate(n).getUTCDate();
  },
  WEEKDAY(args) {
    if (args.length < 1) return ERR.VALUE;
    const n = toNum(args[0]); if (isError(n)) return n;
    const dt = serialToDate(n);
    const type = args.length >= 2 ? Math.floor(toNum(args[1])) : 1;
    const dow = dt.getUTCDay(); // 0=Sun
    if (type === 1) return dow + 1; // 1=Sun, 7=Sat
    if (type === 2) return dow === 0 ? 7 : dow; // 1=Mon, 7=Sun
    if (type === 3) return dow === 0 ? 6 : dow - 1; // 0=Mon, 6=Sun
    return ERR.NUM;
  },
  EOMONTH(args) {
    if (args.length !== 2) return ERR.VALUE;
    const n = toNum(args[0]); if (isError(n)) return n;
    const months = Math.floor(toNum(args[1])); if (isError(months)) return months;
    const dt = serialToDate(n);
    const target = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + months + 1, 0));
    return Math.floor((target.getTime() - EPOCH) / MS_PER_DAY);
  },
  EDATE(args) {
    if (args.length !== 2) return ERR.VALUE;
    const n = toNum(args[0]); if (isError(n)) return n;
    const months = Math.floor(toNum(args[1])); if (isError(months)) return months;
    const dt = serialToDate(n);
    const target = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + months, dt.getUTCDate()));
    return Math.floor((target.getTime() - EPOCH) / MS_PER_DAY);
  },
  DATEDIF(args) {
    if (args.length !== 3) return ERR.VALUE;
    const start = toNum(args[0]); if (isError(start)) return start;
    const end = toNum(args[1]); if (isError(end)) return end;
    const unit = toStr(args[2]).toUpperCase();
    if (end < start) return ERR.NUM;
    const s = serialToDate(start);
    const e = serialToDate(end);
    switch (unit) {
      case 'D': return end - start;
      case 'M': return (e.getUTCFullYear() - s.getUTCFullYear()) * 12 + (e.getUTCMonth() - s.getUTCMonth()) - (e.getUTCDate() < s.getUTCDate() ? 1 : 0);
      case 'Y': {
        let years = e.getUTCFullYear() - s.getUTCFullYear();
        if (e.getUTCMonth() < s.getUTCMonth() || (e.getUTCMonth() === s.getUTCMonth() && e.getUTCDate() < s.getUTCDate())) years--;
        return years;
      }
      case 'MD': return Math.max(0, e.getUTCDate() - s.getUTCDate());
      case 'YM': return ((e.getUTCMonth() - s.getUTCMonth()) + 12) % 12;
      case 'YD': {
        const sameYearEnd = new Date(Date.UTC(s.getUTCFullYear(), e.getUTCMonth(), e.getUTCDate()));
        return Math.floor((sameYearEnd.getTime() - s.getTime()) / MS_PER_DAY);
      }
    }
    return ERR.VALUE;
  },
  DAYS(args) {
    if (args.length !== 2) return ERR.VALUE;
    const end = toNum(args[0]); if (isError(end)) return end;
    const start = toNum(args[1]); if (isError(start)) return start;
    return end - start;
  },
  NETWORKDAYS(args) {
    if (args.length < 2) return ERR.VALUE;
    const start = Math.floor(toNum(args[0])); if (isError(start)) return start;
    const end = Math.floor(toNum(args[1])); if (isError(end)) return end;
    const lo = Math.min(start, end), hi = Math.max(start, end);
    let count = 0;
    for (let d = lo; d <= hi; d++) {
      const dow = serialToDate(d).getUTCDay();
      if (dow !== 0 && dow !== 6) count++;
    }
    return start <= end ? count : -count;
  },

  // ─── Financial ────────────────────────────────────────────────────
  PMT(args) {
    if (args.length < 3 || args.length > 5) return ERR.VALUE;
    const rate = toNum(args[0]); if (isError(rate)) return rate;
    const n = toNum(args[1]); if (isError(n)) return n;
    const pv = toNum(args[2]); if (isError(pv)) return pv;
    const fv = args.length >= 4 ? toNum(args[3]) : 0;
    const type = args.length >= 5 ? toNum(args[4]) : 0;
    if (rate === 0) return -(pv + fv) / n;
    const pmt = -(pv * Math.pow(1+rate, n) + fv) * rate / ((1+rate*type) * (Math.pow(1+rate, n) - 1));
    return pmt;
  },
  FV(args) {
    if (args.length < 3 || args.length > 5) return ERR.VALUE;
    const rate = toNum(args[0]); if (isError(rate)) return rate;
    const n = toNum(args[1]); if (isError(n)) return n;
    const pmt = toNum(args[2]); if (isError(pmt)) return pmt;
    const pv = args.length >= 4 ? toNum(args[3]) : 0;
    const type = args.length >= 5 ? toNum(args[4]) : 0;
    if (rate === 0) return -(pv + pmt * n);
    return -(pv * Math.pow(1+rate, n) + pmt * (1+rate*type) * (Math.pow(1+rate, n) - 1) / rate);
  },
  PV(args) {
    if (args.length < 3 || args.length > 5) return ERR.VALUE;
    const rate = toNum(args[0]); if (isError(rate)) return rate;
    const n = toNum(args[1]); if (isError(n)) return n;
    const pmt = toNum(args[2]); if (isError(pmt)) return pmt;
    const fv = args.length >= 4 ? toNum(args[3]) : 0;
    const type = args.length >= 5 ? toNum(args[4]) : 0;
    if (rate === 0) return -(fv + pmt * n);
    return -(fv + pmt * (1+rate*type) * (Math.pow(1+rate, n) - 1) / rate) / Math.pow(1+rate, n);
  },
  NPV(args, ctx) {
    if (args.length < 2) return ERR.VALUE;
    const rate = toNum(args[0]); if (isError(rate)) return rate;
    const flat = ctx.flatten(args.slice(1));
    let npv = 0;
    let t = 1;
    for (const v of flat) {
      const n = (typeof v === 'number') ? v : (typeof v === 'string' && isStrictNumber(v) ? parseFloat(v) : null);
      if (n === null) continue;
      npv += n / Math.pow(1 + rate, t);
      t++;
    }
    return npv;
  },
  IRR(args, ctx) {
    if (args.length < 1) return ERR.VALUE;
    const flat = ctx.flatten([args[0]]);
    const cf = [];
    for (const v of flat) {
      if (typeof v === 'number') cf.push(v);
      else if (typeof v === 'string' && isStrictNumber(v)) cf.push(parseFloat(v));
    }
    if (cf.length < 2) return ERR.NUM;
    let guess = args.length >= 2 ? toNum(args[1]) : 0.1;
    // Newton-Raphson
    for (let iter = 0; iter < 100; iter++) {
      let npv = 0, dnpv = 0;
      for (let t = 0; t < cf.length; t++) {
        npv += cf[t] / Math.pow(1+guess, t);
        dnpv -= t * cf[t] / Math.pow(1+guess, t+1);
      }
      if (Math.abs(npv) < 1e-7) return guess;
      if (dnpv === 0) return ERR.NUM;
      guess = guess - npv / dnpv;
    }
    return ERR.NUM;
  },

  // ─── Inline charts ────────────────────────────────────────────────
  // Returns an SVG string prefixed with SVG_MARKER. The cell renderer detects
  // the marker and switches from textContent to innerHTML. Colors are validated
  // (hex only) so no other user-controlled text reaches the DOM.
  SPARKLINE(args) {
    if (args[0] == null) return ERR.VALUE;
    const data = Array.isArray(args[0]) ? args[0] : [args[0]];
    const nums = [];
    for (const v of data) {
      if (isError(v)) return v;
      const n = typeof v === 'number' ? v : (typeof v === 'string' && isStrictNumber(v) ? parseFloat(v) : null);
      if (n !== null) nums.push(n);
    }
    if (nums.length === 0) return '';
    const type = (args[1] != null ? String(args[1]) : 'line').toLowerCase();
    const colorIn = args[2] != null ? String(args[2]) : '#3b82f6';
    const color = /^#[0-9a-fA-F]{3,8}$/.test(colorIn) ? colorIn : '#3b82f6';
    const w = 80, h = 18, pad = 1;
    let min = Math.min(...nums), max = Math.max(...nums);
    const range = (max - min) || 1;
    let body;
    if (type === 'bar' || type === 'column') {
      const bw = (w - pad * 2) / nums.length;
      body = '';
      for (let i = 0; i < nums.length; i++) {
        const bh = Math.max(1, ((nums[i] - min) / range) * (h - pad * 2));
        const x = pad + i * bw;
        const y = h - pad - bh;
        body += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(1, bw - 1).toFixed(1)}" height="${bh.toFixed(1)}" fill="${color}"/>`;
      }
    } else {
      const stepX = nums.length > 1 ? (w - pad * 2) / (nums.length - 1) : 0;
      let d = '';
      for (let i = 0; i < nums.length; i++) {
        const x = pad + i * stepX;
        const y = h - pad - ((nums[i] - min) / range) * (h - pad * 2);
        d += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1);
      }
      body = `<path d="${d}" fill="none" stroke="${color}" stroke-width="1.2"/>`;
    }
    return SVG_MARKER + `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;
  },

  // ─── Info ─────────────────────────────────────────────────────────
  ISNUMBER(args) { return typeof args[0] === 'number'; },
  ISTEXT(args) { return typeof args[0] === 'string' && !isError(args[0]); },
  ISBLANK(args) { return args[0] === '' || args[0] == null; },
  ISERROR(args) { return isError(args[0]); },
  ISERR(args) { return isError(args[0]) && args[0] !== ERR.NA; },
  ISNA(args) { return args[0] === ERR.NA; },
  ISLOGICAL(args) { return typeof args[0] === 'boolean'; },
  N(args) {
    const v = args[0];
    if (typeof v === 'number') return v;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (typeof v === 'string' && isStrictNumber(v)) return parseFloat(v);
    return 0;
  }
};

// ════════════════════════════════════════════════════════════════════
// EVALUATOR
// ════════════════════════════════════════════════════════════════════

function evaluate(ast, store, deps, currentCell, currentSheet) {

  function expandRange(startCoord, endCoord) {
    const a = parseCoord(startCoord);
    const b = parseCoord(endCoord);
    if (!a || !b) return null;
    return {
      r1: Math.min(a.r, b.r), r2: Math.max(a.r, b.r),
      c1: Math.min(a.c, b.c), c2: Math.max(a.c, b.c)
    };
  }

  function getCellValue(coord, sheetId) {
    const sid = sheetId || currentSheet;
    const key = `${sid}!${coord}`;
    if (currentCell && deps) deps.addDep(`${currentSheet}!${currentCell}`, key);
    const cell = store.getCellOnSheet(sid, coord);
    if (!cell) return '';
    return cell.value;
  }

  // Store metadata about evaluated args for functions that need shape info
  let argMetas = [];

  function walk(node) {
    switch (node.type) {
      case 'Num': return node.val;
      case 'Str': return node.val;
      case 'Bool': return node.val;
      case 'CellRef': {
        if (node.invalid) return ERR.REF;
        let sheetId = currentSheet;
        if (node.sheet) {
          sheetId = store.findSheetIdByName(node.sheet);
          if (!sheetId) return ERR.REF;
        }
        return getCellValue(node.val, sheetId);
      }
      case 'Range': {
        if (node.invalid) return ERR.REF;
        let sheetId = currentSheet;
        if (node.sheet) {
          sheetId = store.findSheetIdByName(node.sheet);
          if (!sheetId) return ERR.REF;
        }
        const bbox = expandRange(node.start, node.end);
        if (!bbox) return ERR.REF;
        const arr = [];
        for (let r = bbox.r1; r <= bbox.r2; r++) {
          for (let c = bbox.c1; c <= bbox.c2; c++) {
            arr.push(getCellValue(toCoord(r, c), sheetId));
          }
        }
        // Tag the array with metadata for lookup functions
        arr.__meta = {
          rows: bbox.r2 - bbox.r1 + 1,
          cols: bbox.c2 - bbox.c1 + 1,
          startRow: bbox.r1, startCol: bbox.c1
        };
        return arr;
      }
      case 'UnaryOp': {
        const v = walk(node.operand);
        if (isError(v)) return v;
        if (node.op === '%') {
          const n = toNum(v); if (isError(n)) return n;
          return n / 100;
        }
        const n = toNum(v);
        if (isError(n)) return n;
        return node.op === '-' ? -n : n;
      }
      case 'BinOp': {
        const L = walk(node.left);
        if (isError(L)) return L;
        const R = walk(node.right);
        if (isError(R)) return R;

        if (node.op === '&') return toStr(L) + toStr(R);

        if (['=','<>','<','<=','>','>='].includes(node.op)) {
          const [a, b] = smartCmp(L, R);
          switch (node.op) {
            case '=':  return a === b;
            case '<>': return a !== b;
            case '<':  return a < b;
            case '<=': return a <= b;
            case '>':  return a > b;
            case '>=': return a >= b;
          }
        }

        const ln = toNum(L); if (isError(ln)) return ln;
        const rn = toNum(R); if (isError(rn)) return rn;
        switch (node.op) {
          case '+': return ln + rn;
          case '-': return ln - rn;
          case '*': return ln * rn;
          case '/': return rn === 0 ? ERR.DIV0 : ln / rn;
          case '^': return Math.pow(ln, rn);
        }
        return ERR.VALUE;
      }
      case 'FuncCall': {
        const fn = FUNCTIONS[node.name];
        if (!fn) return ERR.NAME;
        const evaluated = [];
        const metas = [];
        for (const arg of node.args) {
          const v = walk(arg);
          evaluated.push(v);
          metas.push(Array.isArray(v) && v.__meta ? v.__meta : null);
        }
        const ctx = {
          currentRow: currentCell ? parseCoord(currentCell)?.r : 0,
          currentCol: currentCell ? parseCoord(currentCell)?.c : 0,
          flatten(args) {
            const out = [];
            for (const a of args) {
              if (Array.isArray(a)) out.push(...a);
              else out.push(a);
            }
            return out;
          },
          rangeMeta(idx) { return metas[idx] || null; }
        };
        return fn(evaluated, ctx);
      }
    }
    return ERR.VALUE;
  }

  return walk(ast);
}

// ════════════════════════════════════════════════════════════════════
// EXPORTS (for Node testing)
// ════════════════════════════════════════════════════════════════════

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ROWS, COLS, MAX_SHEETS, COL_NAMES, COL_INDEX, LAST_COL,
    toCoord, parseCoord, isStrictNumber, isError, isSvg, ERR, SVG_MARKER,
    tokenize, parse, evaluate, FUNCTIONS, shiftFormulaRefs,
    applyRowInsertToFormula, applyRowDeleteToFormula,
    applyColInsertToFormula, applyColDeleteToFormula,
    EPOCH, MS_PER_DAY, dateToSerial, serialToDate,
    matchesCriterion, wildcardToRegex
  };
}
