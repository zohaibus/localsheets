#!/usr/bin/env node
// Live verification of the LocalSheets ↔ Ollama integration. Runs the same
// HTTP calls the AI panel makes from the browser, against a real Ollama
// instance at http://localhost:11434.
//
// Usage:  node e2e/verify-ai-live.js [--model llama3.2:3b]
// Exits 0 on success, non-zero on any failure (good for CI / pre-release gate).

'use strict';

const HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
const MODEL_ARG = process.argv.find(a => a.startsWith('--model='));
const PREFERRED_MODEL = MODEL_ARG ? MODEL_ARG.split('=')[1] : null;

// ANSI color helpers (work in modern terminals, ignored elsewhere)
const c = (n) => (s) => `\x1b[${n}m${s}\x1b[0m`;
const green = c(32), red = c(31), yellow = c(33), dim = c(2), bold = c(1);

let passed = 0, failed = 0;
const failures = [];

function pass(name, detail) {
  passed++;
  console.log('  ' + green('✓') + ' ' + name + (detail ? dim(' — ' + detail) : ''));
}
function fail(name, detail) {
  failed++;
  failures.push({name, detail});
  console.log('  ' + red('✗') + ' ' + name + (detail ? red(' — ' + detail) : ''));
}

async function fetchJson(url, opts) {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 60000);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* leave null */ }
    return { ok: res.ok, status: res.status, headers: res.headers, text, json };
  } finally {
    clearTimeout(timeout);
  }
}

// ─── Test 1: Reachability ────────────────────────────────
async function testReachability() {
  console.log(bold('\n[1] Reachability'));
  try {
    const r = await fetchJson(HOST + '/api/tags');
    if (!r.ok) { fail('GET /api/tags', `HTTP ${r.status}`); return null; }
    if (!r.json || !Array.isArray(r.json.models)) {
      fail('GET /api/tags', 'response is not the expected {models:[...]} shape');
      return null;
    }
    pass('GET /api/tags', `${r.json.models.length} model(s) available`);
    return r.json.models;
  } catch (e) {
    fail('GET /api/tags', e.message);
    if (e.message.includes('fetch failed') || e.message.includes('ECONNREFUSED')) {
      console.log(dim('     → Ollama doesn\'t appear to be running. Start it (see OLLAMA_SETUP.md).'));
    }
    return null;
  }
}

// ─── Test 2: CORS — the file:// path the app actually uses ──────
async function testCorsForFileOrigin() {
  console.log(bold('\n[2] CORS for file:// origin (the path the app uses)'));
  try {
    const r = await fetchJson(HOST + '/api/tags', {
      // Browsers loading from file:// send Origin: null. This is the exact
      // scenario the app hits. If OLLAMA_ORIGINS isn't set to allow it,
      // Ollama responds without Access-Control-Allow-Origin and the browser
      // (not Node) would reject the response.
      headers: { 'Origin': 'null' },
    });
    const acao = r.headers.get('access-control-allow-origin');
    if (!acao) {
      fail('CORS Access-Control-Allow-Origin header', 'header is missing — set OLLAMA_ORIGINS=* and restart Ollama (see OLLAMA_SETUP.md)');
      return false;
    }
    if (acao !== '*' && acao !== 'null') {
      fail('CORS Access-Control-Allow-Origin header', `header is "${acao}" but app needs "*" or "null"`);
      return false;
    }
    pass('CORS allows file:// (Origin: null)', `header is "${acao}"`);
    return true;
  } catch (e) {
    fail('CORS preflight', e.message);
    return false;
  }
}

// ─── Test 3: Text mode (freeform reply) ──────────────────
async function testTextMode(model) {
  console.log(bold('\n[3] Text mode generation'));
  const body = { model, prompt: 'Reply with exactly: OK', stream: false };
  try {
    const t0 = Date.now();
    const r = await fetchJson(HOST + '/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const dt = Date.now() - t0;
    if (!r.ok) { fail('POST /api/generate (text)', `HTTP ${r.status}: ${r.text.slice(0, 200)}`); return false; }
    if (!r.json || typeof r.json.response !== 'string') {
      fail('text response shape', 'expected {response: string}, got ' + JSON.stringify(r.json).slice(0, 200));
      return false;
    }
    if (!r.json.response.trim()) {
      fail('text response content', 'response is empty');
      return false;
    }
    pass(`text generation with ${model}`, `${dt}ms, ${r.json.response.length} char reply`);
    console.log(dim(`     → "${r.json.response.trim().slice(0, 80)}"`));
    return true;
  } catch (e) {
    fail('POST /api/generate (text)', e.message);
    return false;
  }
}

// ─── Test 4: JSON-patch mode (structured output) ─────────
async function testJsonPatchMode(model) {
  console.log(bold('\n[4] JSON-patch mode (structured cell mutations)'));
  // This prompt mirrors what AI.buildPatchPrompt() in the app produces
  const prompt = `You are an offline local-first spreadsheet automation assistant.
Output ONLY a JSON object — no markdown, no commentary, no code fences.
Schema: {"A1": "value or =formula", "B2": "=SUM(B3:B10)", ...}

Active sheet: "Sheet1". Populated cells:
(empty)

User request: Put the number 5 in A1 and the number 10 in B1.

Respond with the JSON patch only:`;

  const body = { model, prompt, stream: false, options: { temperature: 0 } };
  try {
    const t0 = Date.now();
    const r = await fetchJson(HOST + '/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const dt = Date.now() - t0;
    if (!r.ok) { fail('POST /api/generate (patch)', `HTTP ${r.status}`); return false; }
    const raw = (r.json && r.json.response) || '';
    if (!raw.trim()) { fail('patch response content', 'response is empty'); return false; }

    // Reproduce the app's _extractJson logic: strip code fences, find first balanced {...}
    let s = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    const start = s.indexOf('{');
    let patch = null;
    if (start >= 0) {
      let depth = 0;
      for (let i = start; i < s.length; i++) {
        if (s[i] === '{') depth++;
        else if (s[i] === '}') { depth--; if (depth === 0) {
          try { patch = JSON.parse(s.slice(start, i + 1)); } catch {}
          break;
        }}
      }
    }
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      fail(`JSON-patch parse with ${model}`, 'response did not contain a parseable object');
      console.log(dim(`     → raw: "${raw.trim().slice(0, 200)}"`));
      return false;
    }
    const keys = Object.keys(patch);
    const cellRefRe = /^[A-Z]+\d+$/;
    const validKeys = keys.filter(k => cellRefRe.test(k));
    if (validKeys.length === 0) {
      fail(`patch validation with ${model}`, `none of [${keys.join(', ')}] are valid cell coords`);
      return false;
    }
    pass(`JSON-patch with ${model}`, `${dt}ms, ${validKeys.length}/${keys.length} valid cell keys`);
    console.log(dim(`     → ${JSON.stringify(patch).slice(0, 120)}`));
    if (validKeys.length < keys.length) {
      console.log(yellow(`     ⚠ ${keys.length - validKeys.length} key(s) were not valid cell coords — app would skip them`));
    }
    return true;
  } catch (e) {
    fail('POST /api/generate (patch)', e.message);
    return false;
  }
}

// ─── Main ────────────────────────────────────────────────
(async () => {
  console.log(bold('LocalSheets AI integration — live verification'));
  console.log(dim('Target: ' + HOST));

  const models = await testReachability();
  if (!models) { exit(); return; }
  if (models.length === 0) {
    console.log(yellow('\n  ⚠ No models installed. Run: ollama pull llama3.2:3b'));
    exit(); return;
  }

  await testCorsForFileOrigin();

  // Pick a model to test against: preferred from --model=, else first available
  const model = PREFERRED_MODEL || models[0].name;
  if (PREFERRED_MODEL && !models.some(m => m.name === PREFERRED_MODEL)) {
    fail('preferred model availability', `--model=${PREFERRED_MODEL} not installed. Available: ${models.map(m => m.name).join(', ')}`);
    exit(); return;
  }

  await testTextMode(model);
  await testJsonPatchMode(model);

  exit();
})();

function exit() {
  console.log('');
  console.log(bold(`${passed} passed`) + ', ' + (failed ? red(bold(`${failed} failed`)) : `${failed} failed`));
  if (failed) {
    console.log('');
    console.log(bold('Failures:'));
    for (const f of failures) console.log('  ' + red(f.name) + (f.detail ? dim(' — ' + f.detail) : ''));
    console.log('');
    console.log(dim('Setup help: see OLLAMA_SETUP.md in the repo root.'));
    process.exit(1);
  }
  console.log('');
  console.log(green('AI integration verified end-to-end.'));
  process.exit(0);
}
