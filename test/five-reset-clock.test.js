// Guards the 5H reset string "XhYm→HH:MM". Two things are easy to get wrong
// here and both are silent: the countdown and the clock drifting a minute apart
// (floor vs round), and a non-seconds `resets_at` rendering an absurd countdown
// that wrecks the whole line instead of falling back to ccusage.
import assert from 'node:assert/strict';
import { fmtFiveReset } from '../lib/render.js';

const CACHE = '🤖 claude-opus-5 | 💰 $3.41 block (3h 57m left) | 🔥 $8.05/hr | 🧠 121,343 (12%)';
const CACHE_MIN = 3 * 60 + 57;

const pad = (n) => String(n).padStart(2, '0');
const clockOf = (ms) => {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const parse = (s) => {
  const m = /^(\d+)h(\d+)m→(\d{2}:\d{2})$/.exec(s);
  assert.ok(m, `malformed reset string: ${JSON.stringify(s)}`);
  return { min: Number(m[1]) * 60 + Number(m[2]), clock: m[3] };
};

// The countdown is recomputed against Date.now() inside the callee, so a clock
// tick between our timestamp and theirs is legitimate; the clock itself is
// derived from a fixed instant and must match to the minute.
const near = (got, want, name) =>
  assert.ok(Math.abs(got - want) <= 1, `${name}: got ${got}m, want ~${want}m`);

let n = 0;
const ok = (name) => {
  n += 1;
  console.log(`ok  ${name}`);
};

{
  const name = 'official seconds epoch: countdown and clock agree';
  const at = Date.now() + (4 * 60 + 45) * 60000;
  const { min, clock } = parse(fmtFiveReset({ resets_at: at / 1000 }, ''));
  near(min, 4 * 60 + 45, name);
  assert.equal(clock, clockOf(at), name);
  ok(name);
}

{
  // The bug this pins: Math.floor turned an exact 4h45m into "4h44m→14:30".
  const name = 'exact epoch does not round down away from its own clock';
  const at = Date.now() + 285 * 60000 + 500; // 4h45m plus a sliver
  const { min } = parse(fmtFiveReset({ resets_at: at / 1000 }, ''));
  assert.equal(min, 285, name);
  ok(name);
}

{
  const name = 'ISO 8601 resets_at is accepted too';
  const at = Date.now() + 90 * 60000;
  const { min, clock } = parse(fmtFiveReset({ resets_at: new Date(at).toISOString() }, ''));
  near(min, 90, name);
  assert.equal(clock, clockOf(at), name);
  ok(name);
}

{
  const name = 'clock is zero-padded and 24-hour';
  // 01:05 and 23:05 local, tomorrow, so both stay inside the sanity window.
  for (const hour of [1, 23]) {
    const d = new Date();
    d.setHours(hour, 5, 0, 0);
    if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
    const { clock } = parse(fmtFiveReset({ resets_at: d.getTime() / 1000 }, ''));
    assert.equal(clock, `${pad(hour)}:05`, `${name} (${hour})`);
  }
  ok(name);
}

{
  const name = 'a reset already due reads 0h0m, never negative';
  const { min } = parse(fmtFiveReset({ resets_at: (Date.now() - 5000) / 1000 }, ''));
  assert.equal(min, 0, name);
  ok(name);
}

{
  const name = 'implausible resets_at falls back to ccusage instead of exploding';
  // 1.7e12 is the classic milliseconds-epoch mistake; the rest are junk.
  for (const bad of [1.7e12, -1, NaN, Infinity, 0, null, undefined, {}, '', 'later']) {
    const s = fmtFiveReset({ resets_at: bad }, CACHE);
    const { min } = parse(s);
    near(min, CACHE_MIN, `${name} (${String(bad)})`);
  }
  ok(name);
}

{
  const name = 'ccusage fallback derives the clock from the countdown';
  const s = fmtFiveReset({}, CACHE);
  const { min, clock } = parse(s);
  assert.equal(min, CACHE_MIN, name);
  assert.equal(clock, clockOf(Date.now() + CACHE_MIN * 60000), name);
  ok(name);
}

{
  const name = 'ccusage minutes-only form "(45m left)"';
  const { min } = parse(fmtFiveReset({}, '💰 $1.00 block (45m left) | 🔥 $2.00/hr'));
  assert.equal(min, 45, name);
  ok(name);
}

{
  const name = 'no official field and no cache: no reset segment at all';
  assert.equal(fmtFiveReset({}, ''), null, name);
  assert.equal(fmtFiveReset({}, '🤖 claude-opus-5 | 🧠 123 (1%)'), null, name);
  ok(name);
}

console.log(`\n${n} passed`);
