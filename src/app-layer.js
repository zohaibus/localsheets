// ════════════════════════════════════════════════════════════════════
// LocalSheets v0.5 APP LAYER
// To be embedded inside <script> in the HTML shell.
// Depends on engine.js code being inlined above this in the script tag.
// (Engine exports: E.ROWS, E.COLS, E.toCoord, E.parseCoord, E.tokenize,
//  E.parse, E.evaluate, E.FUNCTIONS, E.ERR, E.isError, E.isStrictNumber,
//  E.serialToDate, E.COL_NAMES, E.MAX_SHEETS)
// ════════════════════════════════════════════════════════════════════
'use strict';

/* ════════════════════════════════════════════════════════════════════
   DEPENDENCY GRAPH — workbook-wide
   Keys are fully qualified: "sheetId!coord"
   ════════════════════════════════════════════════════════════════════ */

const DepGraph = {
  forward: new Map(),
  reverse: new Map(),

  clear() { this.forward.clear(); this.reverse.clear(); },

  addDep(from, to) {
    if (!this.forward.has(from)) this.forward.set(from, new Set());
    this.forward.get(from).add(to);
    if (!this.reverse.has(to)) this.reverse.set(to, new Set());
    this.reverse.get(to).add(from);
  },

  clearDepsOf(cell) {
    const deps = this.forward.get(cell);
    if (!deps) return;
    for (const d of deps) {
      const rev = this.reverse.get(d);
      if (rev) { rev.delete(cell); if (rev.size === 0) this.reverse.delete(d); }
    }
    this.forward.delete(cell);
  },

  recalcOrder(cell) {
    const reachable = new Set();
    const stack = [cell];
    while (stack.length) {
      const c = stack.pop();
      const dependents = this.reverse.get(c);
      if (!dependents) continue;
      for (const d of dependents) {
        if (!reachable.has(d)) { reachable.add(d); stack.push(d); }
      }
    }
    if (reachable.size === 0) return [];
    const inDeg = new Map();
    for (const c of reachable) inDeg.set(c, 0);
    for (const c of reachable) {
      const fwd = this.forward.get(c);
      if (!fwd) continue;
      for (const d of fwd) {
        if (d === cell || reachable.has(d)) inDeg.set(c, (inDeg.get(c) || 0) + 1);
      }
    }
    const queue = [];
    for (const c of reachable) {
      const fwd = this.forward.get(c);
      if (fwd && fwd.has(cell)) inDeg.set(c, inDeg.get(c) - 1);
      if (inDeg.get(c) === 0) queue.push(c);
    }
    const order = [];
    while (queue.length) {
      const c = queue.shift();
      order.push(c);
      const dependents = this.reverse.get(c);
      if (!dependents) continue;
      for (const d of dependents) {
        if (!reachable.has(d)) continue;
        inDeg.set(d, inDeg.get(d) - 1);
        if (inDeg.get(d) === 0) queue.push(d);
      }
    }
    if (order.length !== reachable.size) return null;
    return order;
  },

  wouldCycle(from, to) {
    if (from === to) return true;
    const stack = [to];
    const seen = new Set();
    while (stack.length) {
      const c = stack.pop();
      if (c === from) return true;
      if (seen.has(c)) continue;
      seen.add(c);
      const fwd = this.forward.get(c);
      if (fwd) for (const d of fwd) stack.push(d);
    }
    return false;
  }
};

/* ════════════════════════════════════════════════════════════════════
   STORE — multi-sheet workbook
   ════════════════════════════════════════════════════════════════════ */

const SCHEMA_VERSION = '2.0';
const SUPPORTED_MAJOR = 2;
const DEFAULT_COL_WIDTH = 100;
const ROW_HEIGHT = 22;

function genSheetId() { return 's' + Math.random().toString(36).slice(2, 10); }
function nowISO() { return new Date().toISOString(); }

function freshSheet(name) {
  return {
    name,
    cells: {},
    colWidths: {},
    selR: 0, selC: 0
  };
}

function freshWorkbook() {
  const s1 = freshSheet('Sheet1');
  const id1 = genSheetId();
  return {
    version: SCHEMA_VERSION,
    tool: 'localsheets',
    meta: { title: 'New Workbook' },
    created: nowISO(),
    modified: nowISO(),
    sheets: { [id1]: s1 },
    sheetOrder: [id1],
    activeSheet: id1,
    settings: { theme: 'auto' }
  };
}

const Store = {
  data: freshWorkbook(),
  handle: null,
  dirty: false,
  undoStack: [],
  redoStack: [],
  MAX_UNDO: 100,

  activeSheet() { return this.data.sheets[this.data.activeSheet]; },
  activeSheetId() { return this.data.activeSheet; },

  setActiveSheet(id) {
    if (!this.data.sheets[id]) return;
    this.data.activeSheet = id;
    this.dirty = true;
  },

  findSheetIdByName(name) {
    const target = String(name).toUpperCase();
    for (const id of this.data.sheetOrder) {
      if (this.data.sheets[id].name.toUpperCase() === target) return id;
    }
    return null;
  },

  // Engine evaluator calls these:
  getCellOnSheet(sheetId, coord) {
    const sheet = this.data.sheets[sheetId];
    if (!sheet) return null;
    return sheet.cells[coord] || null;
  },

  setCell(coord, rawText, opts = {pushUndo: true, sheetId: null}) {
    const sheetId = opts.sheetId || this.data.activeSheet;
    const sheet = this.data.sheets[sheetId];
    if (!sheet) return;
    const before = sheet.cells[coord] ? JSON.parse(JSON.stringify(sheet.cells[coord])) : null;

    const v = (rawText ?? '').trim();
    const existing = sheet.cells[coord];
    const fmt = existing && existing.format ? existing.format : null;

    const fqKey = `${sheetId}!${coord}`;
    DepGraph.clearDepsOf(fqKey);

    if (!v) {
      if (fmt && Object.values(fmt).some(Boolean)) {
        sheet.cells[coord] = { raw: '', value: '', type: 'text', format: fmt };
      } else {
        delete sheet.cells[coord];
      }
    } else if (v.startsWith('=') && v.length > 1) {
      const result = this._computeFormula(sheetId, coord, v);
      sheet.cells[coord] = {
        raw: v, formula: v, value: result,
        type: E.isError(result) ? 'error' : (typeof result === 'number' ? 'number' : (typeof result === 'boolean' ? 'bool' : 'text')),
        ...(fmt ? { format: fmt } : {})
      };
    } else {
      const num = E.isStrictNumber(v);
      sheet.cells[coord] = {
        raw: v,
        value: num ? Number(v) : v,
        type: num ? 'number' : 'text',
        ...(fmt ? { format: fmt } : {})
      };
    }

    this.data.modified = nowISO();
    this.dirty = true;
    if (opts.pushUndo) this._pushUndo({type: 'cell', sheetId, coord, before});
    this._recalcDependents(fqKey);
  },

  _computeFormula(sheetId, coord, formulaStr) {
    try {
      const tokens = E.tokenize(formulaStr.slice(1));
      const ast = E.parse(tokens);
      const refs = this._collectRefs(ast, sheetId);
      const currentKey = `${sheetId}!${coord}`;
      for (const ref of refs) {
        if (DepGraph.wouldCycle(currentKey, ref)) return E.ERR.CIRC;
      }
      return E.evaluate(ast, this, DepGraph, coord, sheetId);
    } catch (e) {
      return E.ERR.PARSE;
    }
  },

  _collectRefs(ast, sheetId) {
    const refs = new Set();
    const self = this;
    function walk(n) {
      if (!n || typeof n !== 'object') return;
      if (n.type === 'CellRef' && !n.invalid) {
        let sid = sheetId;
        if (n.sheet) {
          sid = self.findSheetIdByName(n.sheet);
          if (!sid) return;
        }
        refs.add(`${sid}!${n.val}`);
      }
      if (n.type === 'Range' && !n.invalid) {
        let sid = sheetId;
        if (n.sheet) {
          sid = self.findSheetIdByName(n.sheet);
          if (!sid) return;
        }
        const a = E.parseCoord(n.start), b = E.parseCoord(n.end);
        if (a && b) {
          const r1=Math.min(a.r,b.r), r2=Math.max(a.r,b.r);
          const c1=Math.min(a.c,b.c), c2=Math.max(a.c,b.c);
          for (let r=r1; r<=r2; r++) for (let c=c1; c<=c2; c++) refs.add(`${sid}!${E.toCoord(r,c)}`);
        }
      }
      for (const k in n) if (n[k] && typeof n[k] === 'object') {
        if (Array.isArray(n[k])) n[k].forEach(walk); else walk(n[k]);
      }
    }
    walk(ast);
    return refs;
  },

  _recalcDependents(fqKey) {
    const order = DepGraph.recalcOrder(fqKey);
    if (order === null) {
      const reachable = new Set();
      const stack = [fqKey];
      while (stack.length) {
        const c = stack.pop();
        const deps = DepGraph.reverse.get(c);
        if (!deps) continue;
        for (const d of deps) if (!reachable.has(d)) { reachable.add(d); stack.push(d); }
      }
      for (const k of reachable) {
        const [sid, crd] = k.split('!');
        const cell = this.data.sheets[sid]?.cells[crd];
        if (cell && cell.formula) { cell.value = E.ERR.CIRC; cell.type = 'error'; }
      }
      return;
    }
    for (const k of order) {
      const [sid, crd] = k.split('!');
      const cell = this.data.sheets[sid]?.cells[crd];
      if (!cell || !cell.formula) continue;
      DepGraph.clearDepsOf(k);
      const result = this._computeFormula(sid, crd, cell.formula);
      cell.value = result;
      cell.type = E.isError(result) ? 'error' : (typeof result === 'number' ? 'number' : (typeof result === 'boolean' ? 'bool' : 'text'));
    }
  },

  recalcAll() {
    DepGraph.clear();
    for (let pass = 0; pass < 2; pass++) {
      for (const sid of this.data.sheetOrder) {
        const sheet = this.data.sheets[sid];
        for (const [coord, cell] of Object.entries(sheet.cells)) {
          if (cell.formula) {
            const key = `${sid}!${coord}`;
            DepGraph.clearDepsOf(key);
            const result = this._computeFormula(sid, coord, cell.formula);
            cell.value = result;
            cell.type = E.isError(result) ? 'error' : (typeof result === 'number' ? 'number' : (typeof result === 'boolean' ? 'bool' : 'text'));
          }
        }
      }
    }
  },

  setFormat(coord, patch, opts = {pushUndo: true}) {
    const sheet = this.activeSheet();
    const before = sheet.cells[coord] ? JSON.parse(JSON.stringify(sheet.cells[coord])) : null;
    if (!sheet.cells[coord]) {
      sheet.cells[coord] = { raw: '', value: '', type: 'text', format: {} };
    }
    const cell = sheet.cells[coord];
    cell.format = Object.assign(cell.format || {}, patch);
    Object.keys(cell.format).forEach(k => { if (!cell.format[k]) delete cell.format[k]; });
    if (!Object.keys(cell.format).length) delete cell.format;
    if (!cell.raw && !cell.format) delete sheet.cells[coord];
    this.data.modified = nowISO();
    this.dirty = true;
    if (opts.pushUndo) this._pushUndo({type: 'cell', sheetId: this.data.activeSheet, coord, before});
  },

  _pushUndo(action) {
    this.undoStack.push(action);
    if (this.undoStack.length > this.MAX_UNDO) this.undoStack.shift();
    this.redoStack = []; // any new edit invalidates redo history
  },

  _pushBulkUndo(sheetId) {
    sheetId = sheetId || this.data.activeSheet;
    // Capture WHOLE sheet so structural ops (insert/delete row/col, merge, tables) undo correctly.
    this._pushUndo({type: 'bulk', sheetId, before: JSON.parse(JSON.stringify(this.data.sheets[sheetId]))});
  },

  _applyAction(action) {
    let inverse = null;
    if (action.type === 'cell') {
      const sheet = this.data.sheets[action.sheetId]; if (!sheet) return null;
      const current = sheet.cells[action.coord];
      inverse = { type: 'cell', sheetId: action.sheetId, coord: action.coord,
                  before: current ? JSON.parse(JSON.stringify(current)) : null };
      const key = `${action.sheetId}!${action.coord}`;
      DepGraph.clearDepsOf(key);
      if (action.before) {
        sheet.cells[action.coord] = action.before;
        if (action.before.formula) {
          const result = this._computeFormula(action.sheetId, action.coord, action.before.formula);
          action.before.value = result;
        }
      } else { delete sheet.cells[action.coord]; }
      this._recalcDependents(key);
    } else if (action.type === 'bulk') {
      const sheet = this.data.sheets[action.sheetId]; if (!sheet) return null;
      const before = action.before;
      const isWholeSheet = before && typeof before === 'object' && before.cells && typeof before.cells === 'object';
      inverse = { type: 'bulk', sheetId: action.sheetId,
                  before: JSON.parse(JSON.stringify(isWholeSheet ? sheet : sheet.cells)) };
      if (isWholeSheet) this.data.sheets[action.sheetId] = before;
      else sheet.cells = before;
      this.recalcAll();
    } else if (action.type === 'workbook') {
      inverse = { type: 'workbook', before: JSON.parse(JSON.stringify(this.data)) };
      this.data = action.before;
      this.recalcAll();
    }
    this.dirty = true;
    return inverse;
  },

  undo() {
    const action = this.undoStack.pop();
    if (!action) return false;
    const inverse = this._applyAction(action);
    if (inverse) this.redoStack.push(inverse);
    return true;
  },

  redo() {
    const action = this.redoStack.pop();
    if (!action) return false;
    const inverse = this._applyAction(action);
    if (inverse) this.undoStack.push(inverse);
    return true;
  },

  // ── Sheet ops ──────────────────────────────────────────
  addSheet(name) {
    if (this.data.sheetOrder.length >= E.MAX_SHEETS) return null;
    if (!name) {
      let n = this.data.sheetOrder.length + 1;
      while (this.findSheetIdByName('Sheet' + n)) n++;
      name = 'Sheet' + n;
    } else if (this.findSheetIdByName(name)) {
      let n = 2;
      while (this.findSheetIdByName(name + ' (' + n + ')')) n++;
      name = name + ' (' + n + ')';
    }
    this._pushUndo({type: 'workbook', before: JSON.parse(JSON.stringify(this.data))});
    const id = genSheetId();
    this.data.sheets[id] = freshSheet(name);
    this.data.sheetOrder.push(id);
    this.data.activeSheet = id;
    this.dirty = true;
    return id;
  },

  deleteSheet(id) {
    if (this.data.sheetOrder.length <= 1) return false;
    this._pushUndo({type: 'workbook', before: JSON.parse(JSON.stringify(this.data))});
    const idx = this.data.sheetOrder.indexOf(id);
    if (idx === -1) return false;
    this.data.sheetOrder.splice(idx, 1);
    delete this.data.sheets[id];
    for (const key of [...DepGraph.forward.keys()]) {
      if (key.startsWith(id + '!')) DepGraph.clearDepsOf(key);
    }
    if (this.data.activeSheet === id) {
      this.data.activeSheet = this.data.sheetOrder[Math.max(0, idx - 1)];
    }
    this.recalcAll();
    this.dirty = true;
    return true;
  },

  renameSheet(id, newName) {
    if (!this.data.sheets[id]) return false;
    const existing = this.findSheetIdByName(newName);
    if (existing && existing !== id) return false;
    this._pushUndo({type: 'workbook', before: JSON.parse(JSON.stringify(this.data))});
    const oldName = this.data.sheets[id].name;
    this.data.sheets[id].name = newName;
    this._rewriteSheetRefs(oldName, newName);
    this.recalcAll();
    this.dirty = true;
    return true;
  },

  _rewriteSheetRefs(oldName, newName) {
    if (oldName === newName) return;
    const needsQuote = !/^[A-Za-z_][A-Za-z0-9_]*$/.test(newName);
    const replacement = (needsQuote ? "'" + newName.replace(/'/g, "''") + "'" : newName) + '!';
    const esc = oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const bareRe   = new RegExp('(^|[^A-Za-z0-9_\\\'])' + esc + '!', 'g');
    const quotedRe = new RegExp("'" + esc.replace(/'/g, "''") + "'!", 'g');
    for (const sid of this.data.sheetOrder) {
      const sheet = this.data.sheets[sid];
      for (const cell of Object.values(sheet.cells)) {
        if (!cell.formula) continue;
        let next = cell.formula
          .replace(quotedRe, replacement)
          .replace(bareRe, (m, pre) => pre + replacement);
        if (next !== cell.formula) {
          cell.formula = next;
          cell.raw = next;
        }
      }
    }
  },

  duplicateSheet(id) {
    if (this.data.sheetOrder.length >= E.MAX_SHEETS) return null;
    const src = this.data.sheets[id];
    if (!src) return null;
    this._pushUndo({type: 'workbook', before: JSON.parse(JSON.stringify(this.data))});
    let name = src.name + ' (copy)';
    let n = 2;
    while (this.findSheetIdByName(name)) { name = src.name + ' (copy ' + n + ')'; n++; }
    const newId = genSheetId();
    this.data.sheets[newId] = JSON.parse(JSON.stringify(src));
    this.data.sheets[newId].name = name;
    const idx = this.data.sheetOrder.indexOf(id);
    this.data.sheetOrder.splice(idx + 1, 0, newId);
    this.data.activeSheet = newId;
    this.dirty = true;
    this.recalcAll();
    return newId;
  },

  moveSheet(id, delta) {
    const idx = this.data.sheetOrder.indexOf(id);
    const newIdx = idx + delta;
    if (newIdx < 0 || newIdx >= this.data.sheetOrder.length) return false;
    this.data.sheetOrder.splice(idx, 1);
    this.data.sheetOrder.splice(newIdx, 0, id);
    this.dirty = true;
    return true;
  },

  // ── Display ────────────────────────────────────────────
  getCell(coord) { return this.activeSheet().cells[coord] || null; },
  getRaw(coord) { const c = this.getCell(coord); return c ? c.raw : ''; },
  getFormat(coord) { const c = this.getCell(coord); return (c && c.format) ? c.format : {}; },
  getValue(coord) { const c = this.getCell(coord); return c ? c.value : ''; },

  getDisplay(coord) {
    const cell = this.getCell(coord);
    if (!cell) return '';
    if (cell.type === 'error') return cell.value;
    if (cell.raw === '' && (!cell.format || !Object.values(cell.format).some(Boolean))) return '';
    const fmt = (cell.format && cell.format.numfmt) ? cell.format.numfmt : 'general';
    return applyNumFmt(cell, fmt);
  },

  getColWidth(c) {
    const sheet = this.activeSheet();
    return sheet.colWidths[c] || DEFAULT_COL_WIDTH;
  },

  setColWidth(c, w) {
    this.activeSheet().colWidths[c] = w;
    this.dirty = true;
  },

  getRowHeight(r) {
    const s = this.activeSheet();
    return (s.rowHeights && s.rowHeights[r]) || 22;
  },

  setRowHeight(r, h) {
    const s = this.activeSheet();
    if (!s.rowHeights) s.rowHeights = {};
    s.rowHeights[r] = h;
    this.dirty = true;
  },

  // ── Range shift helpers (for insert/delete row/col) ────
  // delta = +1 for insert, -1 for delete. Returns null if the range collapses.
  shiftRangeRow(rangeStr, r, delta) {
    const m = rangeStr && rangeStr.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/i);
    if (!m) return rangeStr;
    let r1 = parseInt(m[2], 10) - 1, r2 = parseInt(m[4], 10) - 1;
    if (delta > 0) { if (r1 >= r) r1 += delta; if (r2 >= r) r2 += delta; }
    else            { if (r1 > r)  r1 += delta; if (r2 >= r) r2 += delta; if (r2 < r1) return null; }
    return m[1] + (r1 + 1) + ':' + m[3] + (r2 + 1);
  },

  shiftRangeCol(rangeStr, c, delta) {
    const m = rangeStr && rangeStr.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/i);
    if (!m) return rangeStr;
    const c1Idx = E.COL_INDEX.get(m[1]), c2Idx = E.COL_INDEX.get(m[3]);
    if (c1Idx == null || c2Idx == null) return rangeStr;
    let c1 = c1Idx, c2 = c2Idx;
    if (delta > 0) { if (c1 >= c) c1 += delta; if (c2 >= c) c2 += delta; }
    else            { if (c1 > c)  c1 += delta; if (c2 >= c) c2 += delta; if (c2 < c1) return null; }
    return E.COL_NAMES[c1] + m[2] + ':' + E.COL_NAMES[c2] + m[4];
  },

  _shiftMetaRow(r, delta) {
    const sheet = this.activeSheet();
    if (sheet.tables) {
      sheet.tables = sheet.tables.map(t => { const nr = this.shiftRangeRow(t.range, r, delta); return nr ? Object.assign({}, t, {range: nr}) : null; }).filter(Boolean);
    }
    if (sheet.merges) sheet.merges = sheet.merges.map(rg => this.shiftRangeRow(rg, r, delta)).filter(Boolean);
    if (sheet.conditionalRules) {
      sheet.conditionalRules = sheet.conditionalRules.map(cr => { const nr = this.shiftRangeRow(cr.range, r, delta); return nr ? Object.assign({}, cr, {range: nr}) : null; }).filter(Boolean);
    }
    if (sheet.rowHeights) {
      const m = {};
      for (const [k, v] of Object.entries(sheet.rowHeights)) {
        const ki = +k;
        if (delta > 0) m[ki >= r ? ki + delta : ki] = v;
        else if (ki !== r) m[ki > r ? ki + delta : ki] = v;
      }
      sheet.rowHeights = m;
    }
  },

  _shiftMetaCol(c, delta) {
    const sheet = this.activeSheet();
    if (sheet.tables) {
      sheet.tables = sheet.tables.map(t => { const nr = this.shiftRangeCol(t.range, c, delta); return nr ? Object.assign({}, t, {range: nr}) : null; }).filter(Boolean);
    }
    if (sheet.merges) sheet.merges = sheet.merges.map(rg => this.shiftRangeCol(rg, c, delta)).filter(Boolean);
    if (sheet.conditionalRules) {
      sheet.conditionalRules = sheet.conditionalRules.map(cr => { const nr = this.shiftRangeCol(cr.range, c, delta); return nr ? Object.assign({}, cr, {range: nr}) : null; }).filter(Boolean);
    }
    if (sheet.colWidths) {
      const m = {};
      for (const [k, v] of Object.entries(sheet.colWidths)) {
        const ki = +k;
        if (delta > 0) m[ki >= c ? ki + delta : ki] = v;
        else if (ki !== c) m[ki > c ? ki + delta : ki] = v;
      }
      sheet.colWidths = m;
    }
    if (sheet.filters) {
      const m = {};
      for (const [k, v] of Object.entries(sheet.filters)) {
        const ki = +k;
        if (delta > 0) m[ki >= c ? ki + delta : ki] = v;
        else if (ki !== c) m[ki > c ? ki + delta : ki] = v;
      }
      sheet.filters = m;
    }
  },

  // Rewrite every formula in every sheet for a structural change on `targetSheetName`.
  // `applyFn` is one of E.applyRow{Insert,Delete}ToFormula / E.applyCol{Insert,Delete}ToFormula.
  // `indexArg` is the 1-based row OR 0-based col, depending on the operation.
  _rewriteAllFormulasFor(targetSheetName, applyFn, indexArg) {
    for (const sid of this.data.sheetOrder) {
      const s = this.data.sheets[sid];
      for (const cell of Object.values(s.cells)) {
        if (!cell.formula) continue;
        const next = applyFn(cell.formula, s.name, targetSheetName, indexArg);
        if (next !== cell.formula) { cell.formula = next; cell.raw = next; }
      }
    }
  },

  insertRow(r, opts) {
    opts = opts || {};
    if (opts.pushUndo !== false) this._pushBulkUndo();
    const sheet = this.activeSheet();
    this._rewriteAllFormulasFor(sheet.name, E.applyRowInsertToFormula, r + 1);
    const newCells = {};
    for (const [k, v] of Object.entries(sheet.cells)) {
      const p = E.parseCoord(k);
      if (!p) continue;
      if (p.r < r) newCells[k] = v;
      else if (p.r < E.ROWS - 1) newCells[E.toCoord(p.r + 1, p.c)] = v;
    }
    sheet.cells = newCells;
    this._shiftMetaRow(r, +1);
    this.data.modified = nowISO();
    this.dirty = true;
    this.recalcAll();
  },

  deleteRow(r, opts) {
    opts = opts || {};
    if (opts.pushUndo !== false) this._pushBulkUndo();
    const sheet = this.activeSheet();
    this._rewriteAllFormulasFor(sheet.name, E.applyRowDeleteToFormula, r + 1);
    const newCells = {};
    for (const [k, v] of Object.entries(sheet.cells)) {
      const p = E.parseCoord(k);
      if (!p || p.r === r) continue;
      newCells[p.r > r ? E.toCoord(p.r - 1, p.c) : k] = v;
    }
    sheet.cells = newCells;
    this._shiftMetaRow(r, -1);
    this.data.modified = nowISO();
    this.dirty = true;
    this.recalcAll();
  },

  insertCol(c, opts) {
    opts = opts || {};
    if (opts.pushUndo !== false) this._pushBulkUndo();
    const sheet = this.activeSheet();
    this._rewriteAllFormulasFor(sheet.name, E.applyColInsertToFormula, c);
    const newCells = {};
    for (const [k, v] of Object.entries(sheet.cells)) {
      const p = E.parseCoord(k);
      if (!p) continue;
      if (p.c < c) newCells[k] = v;
      else if (p.c < E.COLS - 1) newCells[E.toCoord(p.r, p.c + 1)] = v;
    }
    sheet.cells = newCells;
    this._shiftMetaCol(c, +1);
    this.data.modified = nowISO();
    this.dirty = true;
    this.recalcAll();
  },

  deleteCol(c, opts) {
    opts = opts || {};
    if (opts.pushUndo !== false) this._pushBulkUndo();
    const sheet = this.activeSheet();
    this._rewriteAllFormulasFor(sheet.name, E.applyColDeleteToFormula, c);
    const newCells = {};
    for (const [k, v] of Object.entries(sheet.cells)) {
      const p = E.parseCoord(k);
      if (!p || p.c === c) continue;
      newCells[p.c > c ? E.toCoord(p.r, p.c - 1) : k] = v;
    }
    sheet.cells = newCells;
    this._shiftMetaCol(c, -1);
    this.data.modified = nowISO();
    this.dirty = true;
    this.recalcAll();
  },

  cellCount() {
    let n = 0;
    for (const sid of this.data.sheetOrder) n += Object.keys(this.data.sheets[sid].cells).length;
    return n;
  },

  toJSON() {
    this.data.modified = nowISO();
    this.data.version = SCHEMA_VERSION;
    const out = JSON.parse(JSON.stringify(this.data));
    for (const sid of out.sheetOrder) {
      const sheet = out.sheets[sid];
      for (const cell of Object.values(sheet.cells)) {
        if (cell.formula) { delete cell.value; delete cell.type; }
      }
    }
    return JSON.stringify(out, null, 2);
  },

  loadJSON(text) {
    let p;
    try { p = JSON.parse(text); } catch { throw new Error('File is not valid JSON.'); }
    if (p.tool !== 'localsheets') throw new Error('Not a LocalSheets file.');
    const major = parseInt(String(p.version || '0').split('.')[0], 10);
    if (major === 1) {
      p = this._migrateV1toV2(p);
    } else if (major !== SUPPORTED_MAJOR) {
      throw new Error(`File version ${p.version} is not supported (this build expects v${SUPPORTED_MAJOR}.x).`);
    }
    if (!p.sheets || !p.sheetOrder || !p.activeSheet) {
      throw new Error('File missing required fields.');
    }
    this.data = p;
    this.undoStack = [];
    this.redoStack = [];
    this.dirty = false;
    DepGraph.clear();
    this.recalcAll();
  },

  _migrateV1toV2(v1) {
    const id = genSheetId();
    return {
      version: SCHEMA_VERSION,
      tool: 'localsheets',
      meta: v1.meta || { title: 'Imported workbook' },
      created: v1.created || nowISO(),
      modified: nowISO(),
      sheets: {
        [id]: { name: 'Sheet1', cells: v1.cells || {}, colWidths: {}, selR: 0, selC: 0 }
      },
      sheetOrder: [id],
      activeSheet: id,
      settings: v1.settings || {}
    };
  },

  reset() {
    this.data = freshWorkbook();
    this.handle = null;
    this.dirty = false;
    this.undoStack = [];
    this.redoStack = [];
    DepGraph.clear();
  }
};

function applyNumFmt(cell, fmt) {
  const v = cell.value;
  if (v === '' || v == null) return '';
  if (E.isError(v)) return v;
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v !== 'number') return String(v);
  switch (fmt) {
    case 'number':   return v.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});
    case 'currency': return v.toLocaleString('en-US', {style:'currency', currency:'USD'});
    case 'percent':  return (v * 100).toLocaleString('en-US', {minimumFractionDigits:0, maximumFractionDigits:2}) + '%';
    case 'integer':  return Math.round(v).toLocaleString('en-US');
    case 'date': {
      const d = E.serialToDate(v);
      const y = d.getUTCFullYear(), m = String(d.getUTCMonth()+1).padStart(2,'0'), day = String(d.getUTCDate()).padStart(2,'0');
      return `${y}-${m}-${day}`;
    }
    case 'date-us': {
      const d = E.serialToDate(v);
      const m = String(d.getUTCMonth()+1).padStart(2,'0'), day = String(d.getUTCDate()).padStart(2,'0');
      return `${m}/${day}/${d.getUTCFullYear()}`;
    }
    default:
      if (Number.isInteger(v)) return String(v);
      return v.toLocaleString('en-US', {maximumFractionDigits: 10});
  }
}

/* ════════════════════════════════════════════════════════════════════
   APP-LAYER CODE ENDS HERE.
   The HTML shell needs to add:
   - Renderer (simpler DOM table, render only visible rows ~50 at a time)
   - Selection (single cell + range)
   - Edit cell / commit / cancel
   - Tab bar UI wiring
   - Toolbar wiring (new/open/save/save-as/import-csv/export-csv)
   - Format bar wiring (bold/italic/align/numfmt)
   - Find/replace panel wiring
   - Keyboard handler
   - Mouse handler (click, drag for range, dblclick, contextmenu)
   - Multi-cell paste (tab-separated text parsing)
   - Initial render call
   ════════════════════════════════════════════════════════════════════ */
