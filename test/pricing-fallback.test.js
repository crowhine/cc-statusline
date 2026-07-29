// Guards the heuristic that decides whether ccusage's bundled price table is
// missing the current model. The fixtures below are verbatim `ccusage
// statusline` output, so a format change on their side shows up here as a
// failure rather than as a silent $0.00 in the status line.
import assert from 'node:assert/strict';
import { needsOnlinePricing } from '../lib/render.js';

const cases = [
  [
    'missing price entry: Claude Code reports a session cost, ccusage reports none',
    '🤖 claude-opus-5 | 💰 $0.18 session / $0.00 today / $0.00 block (3h 32m left) | 🔥 $0.00/hr | 🧠 38,822 (19%)',
    true,
  ],
  [
    'missing price entry: session cost is a signed zero, so fall back to context tokens',
    '🤖 claude-opus-5 | 💰 $-0.00 session / $0.00 today / $0.00 block (3h 19m left) | 🔥 $0.00/hr | 🧠 111,937 (56%)',
    true,
  ],
  [
    'priced normally: leave it alone',
    '🤖 claude-opus-5 | 💰 $-0.00 session / $61.95 today / $21.18 block (3h 19m left) | 🔥 $13.05/hr | 🧠 111,937 (11%)',
    false,
  ],
  [
    'genuinely idle: nothing spent and no live session',
    '🤖 claude-sonnet-5 | 💰 $0.00 session / $0.00 today / $0.00 block | 🔥 $0.00/hr | 🧠 0 (0%)',
    false,
  ],
  ['ccusage missing or cache empty', '', false],
  ['unrecognised format: never guess', '🤖 claude-opus-5 | 🧠 123 (1%)', false],
];

for (const [name, fixture, want] of cases) {
  assert.equal(needsOnlinePricing(fixture), want, name);
  console.log(`ok  ${name}`);
}

console.log(`\n${cases.length} passed`);
