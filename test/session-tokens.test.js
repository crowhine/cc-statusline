// Guards the per-session token segment: the transcript summer (whose
// deduplication is the easy thing to get wrong), the compact formatter's
// rounding boundaries, and the render-side rules that decide whether the
// segment appears at all. The render cases drive the real CLI, so they cover
// the wiring rather than just pure functions.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { formatTokens, sumTranscriptTokens } from '../lib/render.js';

const CLI = fileURLToPath(new URL('../bin/cli.js', import.meta.url));
const CACHE_DIR = path.join(os.homedir(), '.cache', 'cc-statusline');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-statusline-test-'));

let passed = 0;
function ok(name) {
  console.log(`ok  ${name}`);
  passed++;
}

// --- formatTokens ----------------------------------------------------------
const formatCases = [
  [0, '0'],
  [999, '999'],
  [1000, '1.0K'],
  [54296, '54.3K'],
  [999949, '999.9K'],
  // 999999/1e3 is 999.999, which toFixed(1) rounds to "1000.0K" -- the whole
  // reason the thresholds are 999.95x rather than 1000x.
  [999999, '1.0M'],
  [1000000, '1.0M'],
  [17058499, '17.1M'],
  [999950000, '1.0B'],
  [-1, null],
  [Number.NaN, null],
];
for (const [input, want] of formatCases) {
  assert.equal(formatTokens(input), want, `formatTokens(${input})`);
  ok(`formatTokens(${input}) → ${want}`);
}

// --- sumTranscriptTokens ---------------------------------------------------
function line(id, input, output, cacheCreate, cacheRead) {
  return JSON.stringify({
    type: 'assistant',
    message: {
      id,
      usage: {
        input_tokens: input,
        output_tokens: output,
        cache_creation_input_tokens: cacheCreate,
        cache_read_input_tokens: cacheRead,
      },
    },
  });
}

function transcript(name, lines) {
  const p = path.join(TMP, name);
  fs.writeFileSync(p, lines.join('\n') + '\n');
  return p;
}

// msg_B is repeated three times, exactly as Claude Code writes a single
// assistant message that emitted several content blocks. Summing lines would
// give 1130; only the first occurrence of each id counts, so the answer is 1110.
const repeated = transcript('repeated.jsonl', [
  line('msg_A', 10, 20, 30, 40),
  line('msg_B', 1, 2, 3, 4),
  line('msg_B', 1, 2, 3, 4),
  line('msg_B', 1, 2, 3, 4),
  line('msg_C', 100, 200, 300, 400),
]);
assert.equal(sumTranscriptTokens(repeated), 1110, 'dedupes on message.id');
ok('sums a transcript, deduplicating repeated message.id (1110, not 1130)');

const noisy = transcript('noisy.jsonl', [
  line('msg_A', 10, 20, 30, 40),
  // A user line carries no billable assistant usage even if it looks similar.
  JSON.stringify({ type: 'user', message: { id: 'u1', usage: { input_tokens: 9999 } } }),
  // Assistant lines missing usage or id can't be attributed; skip them.
  JSON.stringify({ type: 'assistant', message: { id: 'msg_X' } }),
  JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: 8888 } } }),
]);
assert.equal(sumTranscriptTokens(noisy), 100, 'ignores non-assistant and unattributable lines');
ok('ignores user lines and assistant lines without usage/id');

// A live session is being appended to, so the last line is routinely partial.
const truncated = path.join(TMP, 'truncated.jsonl');
fs.writeFileSync(truncated, line('msg_A', 10, 20, 30, 40) + '\n{"type":"assistant","mess');
assert.equal(sumTranscriptTokens(truncated), 100, 'tolerates a half-written trailing line');
ok('tolerates a half-written trailing line');

for (const [name, value] of [
  ['missing file', path.join(TMP, 'nope.jsonl')],
  ['empty path', ''],
  ['a directory', TMP],
]) {
  assert.equal(sumTranscriptTokens(value), null, name);
  ok(`returns null for ${name}`);
}

const empty = transcript('empty.jsonl', []);
assert.equal(sumTranscriptTokens(empty), null, 'empty transcript');
ok('returns null for an empty transcript (caller keeps the old value)');

const junk = path.join(TMP, 'junk.jsonl');
fs.writeFileSync(junk, 'not json at all\nnor this\n');
assert.equal(sumTranscriptTokens(junk), null, 'unparsable transcript');
ok('returns null for an unparsable transcript');

// --- render wiring ---------------------------------------------------------
// `render` spawns a detached background refresh unless this session's ccusage
// cache is a couple of seconds old. Writing it up front keeps each case from
// re-reading transcripts in the background and makes the run deterministic.
function renderWith({ sid = 'session-tokens-test', content, mtimeMsAgo = 0, env = {} } = {}) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const tokenFile = path.join(CACHE_DIR, `sesstokens-${sid}.txt`);
  const ccusageFile = path.join(CACHE_DIR, `ccusage-${sid}.txt`);
  try {
    fs.writeFileSync(ccusageFile, '');
    if (content == null) {
      try {
        fs.unlinkSync(tokenFile);
      } catch {}
    } else {
      fs.writeFileSync(tokenFile, content);
      if (mtimeMsAgo) {
        const when = new Date(Date.now() - mtimeMsAgo);
        fs.utimesSync(tokenFile, when, when);
      }
    }
    const stdin = JSON.stringify({
      session_id: sid,
      rate_limits: { five_hour: { used_percentage: 39 }, seven_day: { used_percentage: 19 } },
    });
    const out = execFileSync(process.execPath, [CLI, 'render'], {
      input: stdin,
      encoding: 'utf8',
      env: { ...process.env, CC_STATUSLINE_LANG: 'en', ...env },
    });
    return out.replace(/\x1b\[[0-9;]*m/g, '');
  } finally {
    for (const f of [tokenFile, ccusageFile]) {
      try {
        fs.unlinkSync(f);
      } catch {}
    }
  }
}

const renderCases = [
  ['fresh cache renders the segment', { content: '17058499' }, (s) => s.includes('🪙 17.1M')],
  ['missing cache hides the segment', { content: null }, (s) => !s.includes('🪙')],
  ['empty cache hides the segment', { content: '' }, (s) => !s.includes('🪙')],
  ['non-numeric cache hides the segment', { content: 'garbage' }, (s) => !s.includes('🪙')],
  ['negative count hides the segment', { content: '-5' }, (s) => !s.includes('🪙')],
  ['zero renders', { content: '0' }, (s) => s.includes('🪙 0')],
  [
    'stale cache hides the segment',
    { content: '17058499', mtimeMsAgo: 31 * 60 * 1000 },
    (s) => !s.includes('🪙'),
  ],
  [
    'opt-out hides the segment even with a fresh cache',
    { content: '17058499', env: { CC_STATUSLINE_NO_SESSION_TOKENS: '1' } },
    (s) => !s.includes('🪙'),
  ],
];

for (const [name, opts, predicate] of renderCases) {
  const line = renderWith(opts);
  assert.ok(predicate(line), `${name}\n  got: ${line}`);
  ok(name);
}

// The whole point of keying by session: two windows must not show each other's
// numbers the way a single machine-wide cache would have made them.
const windowA = renderWith({ sid: 'window-a', content: '19852118' });
const windowB = renderWith({ sid: 'window-b', content: '61551113' });
assert.ok(windowA.includes('🪙 19.9M'), `window A\n  got: ${windowA}`);
assert.ok(windowB.includes('🪙 61.6M'), `window B\n  got: ${windowB}`);
ok('separate sessions render their own totals (19.9M vs 61.6M)');

// The quota segments must survive every degraded state above.
const degraded = renderWith({ content: 'garbage' });
assert.ok(degraded.includes('39%') && degraded.includes('19%'), 'quota bars survive a bad cache');
ok('quota bars survive a bad cache');

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n${passed} passed`);
