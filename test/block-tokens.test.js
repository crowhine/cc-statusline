// Guards the billing-block token segment: the compact formatter's rounding
// boundaries, and the render-side rules that decide whether the segment appears
// at all (missing / stale / corrupt cache, and the opt-out env var). The render
// cases drive the real CLI so they cover the wiring, not just a pure function.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { formatTokens } from '../lib/render.js';

const CLI = fileURLToPath(new URL('../bin/cli.js', import.meta.url));
const CACHE_DIR = path.join(os.homedir(), '.cache', 'cc-statusline');
const CACHE_FILE = path.join(CACHE_DIR, 'blocktokens.txt');

let passed = 0;
function ok(name) {
  console.log(`ok  ${name}`);
  passed++;
}

// --- formatTokens ----------------------------------------------------------
const formatCases = [
  [0, '0'],
  [1, '1'],
  [999, '999'],
  [1000, '1.0K'],
  [54296, '54.3K'],
  [999949, '999.9K'],
  // 999999/1e3 is 999.999, which toFixed(1) rounds to "1000.0K" -- the whole
  // reason the thresholds are 999.95x rather than 1000x.
  [999999, '1.0M'],
  [1000000, '1.0M'],
  [67809963, '67.8M'],
  [999949999, '999.9M'],
  [999950000, '1.0B'],
  [2500000000, '2.5B'],
  [-1, null],
  [Number.NaN, null],
  [Number.POSITIVE_INFINITY, null],
];
for (const [input, want] of formatCases) {
  assert.equal(formatTokens(input), want, `formatTokens(${input}) === ${want}`);
  ok(`formatTokens(${input}) → ${want}`);
}

// --- render wiring ---------------------------------------------------------
const STDIN = JSON.stringify({
  session_id: 'block-tokens-test',
  rate_limits: { five_hour: { used_percentage: 39 }, seven_day: { used_percentage: 19 } },
});

// `render` spawns a detached background refresh unless this session's ccusage
// cache was written in the last couple of seconds. Writing it up front keeps the
// test from kicking off a ~40 CPU-second `ccusage blocks` scan on a developer
// machine, and makes the run deterministic rather than dependent on whether
// ccusage happens to be installed.
const SESSION_CACHE = path.join(CACHE_DIR, 'ccusage-block-tokens-test.txt');

// Render once with the cache in a given state. `mtimeMsAgo` back-dates the file
// to exercise the staleness rule. Returns the line with ANSI escapes stripped.
function renderWith({ content, mtimeMsAgo = 0, env = {} } = {}) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const backup = fs.existsSync(CACHE_FILE) ? fs.readFileSync(CACHE_FILE) : null;
  const backupStat = backup ? fs.statSync(CACHE_FILE) : null;
  try {
    fs.writeFileSync(SESSION_CACHE, '');
    if (content == null) {
      try {
        fs.unlinkSync(CACHE_FILE);
      } catch {}
    } else {
      fs.writeFileSync(CACHE_FILE, content);
      if (mtimeMsAgo) {
        const when = new Date(Date.now() - mtimeMsAgo);
        fs.utimesSync(CACHE_FILE, when, when);
      }
    }
    const out = execFileSync(process.execPath, [CLI, 'render'], {
      input: STDIN,
      encoding: 'utf8',
      env: { ...process.env, CC_STATUSLINE_LANG: 'en', ...env },
    });
    return out.replace(/\x1b\[[0-9;]*m/g, '');
  } finally {
    // Leave the developer's real cache exactly as it was.
    if (backup) {
      fs.writeFileSync(CACHE_FILE, backup);
      fs.utimesSync(CACHE_FILE, backupStat.atime, backupStat.mtime);
    } else {
      try {
        fs.unlinkSync(CACHE_FILE);
      } catch {}
    }
    try {
      fs.unlinkSync(SESSION_CACHE);
    } catch {}
  }
}

const renderCases = [
  ['fresh cache renders the segment', { content: '67809963' }, (s) => s.includes('🪙 67.8M')],
  ['missing cache hides the segment', { content: null }, (s) => !s.includes('🪙')],
  ['empty cache hides the segment', { content: '' }, (s) => !s.includes('🪙')],
  ['non-numeric cache hides the segment', { content: 'garbage' }, (s) => !s.includes('🪙')],
  ['negative count hides the segment', { content: '-5' }, (s) => !s.includes('🪙')],
  ['zero renders (idle, no active block)', { content: '0' }, (s) => s.includes('🪙 0')],
  [
    'stale cache hides the segment',
    { content: '67809963', mtimeMsAgo: 31 * 60 * 1000 },
    (s) => !s.includes('🪙'),
  ],
  [
    'opt-out hides the segment even with a fresh cache',
    { content: '67809963', env: { CC_STATUSLINE_NO_BLOCK_TOKENS: '1' } },
    (s) => !s.includes('🪙'),
  ],
];

for (const [name, opts, predicate] of renderCases) {
  const line = renderWith(opts);
  assert.ok(predicate(line), `${name}\n  got: ${line}`);
  ok(name);
}

// The quota segments must survive every degraded state above.
const degraded = renderWith({ content: 'garbage' });
assert.ok(degraded.includes('39%') && degraded.includes('19%'), 'quota bars survive a bad cache');
ok('quota bars survive a bad cache');

console.log(`\n${passed} passed`);
