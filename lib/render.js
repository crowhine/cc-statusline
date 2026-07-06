import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CACHE_DIR = path.join(os.homedir(), '.cache', 'cc-statusline');

// Per-session cache file. Multiple Claude Code windows each refresh ccusage in
// the background; a single shared file let them clobber each other, so one
// window's ctx% bled into another. Key the cache by session_id to isolate them.
function cacheFileFor(data) {
  const sid = String((data && data.session_id) || '').replace(/[^A-Za-z0-9_-]/g, '') || 'default';
  return path.join(CACHE_DIR, `ccusage-${sid}.txt`);
}

// Drop stale per-session caches (and orphaned .tmp files from killed refreshes)
// so the cache dir doesn't grow unbounded as sessions come and go.
function pruneCaches() {
  const now = Date.now();
  let files;
  try {
    files = fs.readdirSync(CACHE_DIR);
  } catch {
    return;
  }
  for (const f of files) {
    const isTmp = /^ccusage-.*\.txt\.tmp/.test(f);
    const isCache = /^ccusage-.*\.txt$/.test(f);
    if (!isTmp && !isCache) continue;
    const ttl = isTmp ? 24 * 3600 * 1000 : 7 * 24 * 3600 * 1000;
    const p = path.join(CACHE_DIR, f);
    try {
      if (now - fs.statSync(p).mtimeMs > ttl) fs.unlinkSync(p);
    } catch {}
  }
}

const I18N = {
  zh: { loading: '📊 用量加载中…', weekLocale: 'zh-CN' },
  en: { loading: '📊 loading…', weekLocale: 'en-US' },
};

function pickLang() {
  const explicit = (process.env.CC_STATUSLINE_LANG || '').toLowerCase();
  if (explicit.startsWith('zh')) return 'zh';
  if (explicit.startsWith('en')) return 'en';
  const locale = (process.env.LANG || process.env.LC_ALL || '').toLowerCase();
  return locale.includes('zh') ? 'zh' : 'en';
}

// statusLine child processes (e.g. under nvm) may start with a PATH that has no
// node/ccusage. Prepend this node's own bin dir plus common locations so the
// background `ccusage` lookup succeeds regardless of the version manager used.
function augmentedEnv() {
  const env = { ...process.env };
  const extra = [path.dirname(process.execPath), '/usr/local/bin', '/opt/homebrew/bin'];
  const sep = path.delimiter;
  const current = (env.PATH || '').split(sep);
  env.PATH = [...extra, ...current].filter(Boolean).join(sep);
  return env;
}

function readStdin() {
  if (process.stdin.isTTY) return '';
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

// ANSI color wrapper for the context line segments.
function color(code, text) {
  return `\x1b[${code}m${text}\x1b[0m`;
}

// Strip trailing path separators while keeping the root separator intact, so the
// "last 2 segments" slice doesn't lose a level on a trailing-slash path.
function stripTrailingSep(s) {
  let end = s.length;
  while (end > 0 && s[end - 1] === path.sep) end--;
  return s.slice(0, end) || path.sep;
}

// Current git branch; detached HEAD falls back to a short hash. Returns '' for a
// non-git directory or on timeout so the segment is simply omitted.
function gitBranch(cwd) {
  const run = (args) => {
    try {
      return execFileSync('git', ['-C', cwd, ...args], {
        encoding: 'utf8',
        timeout: 500,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch {
      return '';
    }
  };
  const branch = run(['branch', '--show-current']);
  if (branch) return branch;
  const hash = run(['rev-parse', '--short', 'HEAD']);
  return hash ? `@${hash}` : '';
}

// First line (context): path (last 2 segments) / git branch / model / reasoning
// effort / output style. Each field is omitted when its source is absent.
function buildContextLine(data) {
  // Pin to the project root: project_dir is the directory Claude Code was
  // launched in and stays fixed for the session; current_dir/cwd drift as the
  // working directory changes (cd, extra --add-dir roots), which made 📁 jump.
  const ws = data.workspace || {};
  const cwd = ws.project_dir || ws.current_dir || data.cwd || '';
  const segs = [];

  if (cwd) {
    const home = os.homedir();
    let disp =
      cwd === home || cwd.startsWith(home + path.sep) ? '~' + cwd.slice(home.length) : cwd;
    disp = stripTrailingSep(disp);
    const segments = disp.split(path.sep);
    if (segments.length > 2) disp = segments.slice(-2).join(path.sep);
    segs.push('📁 ' + color('36', disp));
  }

  const branch = cwd ? gitBranch(cwd) : '';
  if (branch) segs.push('🌿 ' + color('32', branch));

  const model = data.model && data.model.display_name;
  if (model) segs.push('🤖 ' + color('35', model));

  // reasoning effort: brighter color the higher the level; absent on models
  // that don't support the parameter, in which case the segment is skipped.
  const effort = data.effort && data.effort.level;
  if (effort) {
    const ecolor =
      { low: '2', medium: '36', high: '32', xhigh: '33', max: '91' }[effort] || '35';
    segs.push('⚡ ' + color(ecolor, effort));
  }

  const style = data.output_style && data.output_style.name;
  if (style) segs.push('🎨 ' + color('2', style));

  return segs.join(' · ');
}

function parseResetMinutes(five, cacheText) {
  const ra = five.resets_at;
  if (typeof ra === 'number') {
    return Math.max(0, Math.floor((ra - Date.now() / 1000) / 60));
  }
  if (typeof ra === 'string') {
    const t = Date.parse(ra);
    if (!Number.isNaN(t)) return Math.max(0, Math.floor((t - Date.now()) / 60000));
  }
  // resets_at may be null/absent: fall through and omit the reset segment.
  // Fallback: ccusage prints "(1h 23m left)" / "(45m left)".
  const m = /\((?:(\d+)h\s+)?(\d+)m left\)/.exec(cacheText);
  if (m) return (m[1] ? Number(m[1]) : 0) * 60 + Number(m[2]);
  return null;
}

function clampPct(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, Math.round(n)));
}

// ---------------------------------------------------------------------------
// Truecolor (24-bit) gradient progress bars, ported from AwesomeJun/CC-statusline
// (the "small" preset). Each metric has its own Catppuccin gradient; a filled
// block is colored by its *position* along the bar (spatial gradient), empty
// slots take the color at the current percentage.
// ---------------------------------------------------------------------------
const BAR_WIDTH = 10;

// 24-bit foreground color. `triplet` is an "r;g;b" string.
function tcol(triplet, text) {
  return `\x1b[38;2;${triplet}m${text}\x1b[0m`;
}
function boldCol(triplet, text) {
  return `\x1b[1m\x1b[38;2;${triplet}m${text}\x1b[0m`;
}

// Fixed Catppuccin swatches used for labels / money.
const C = {
  pink: '245;194;231',
  lavender: '180;190;254',
  yellow: '249;226;175',
  overlay: '108;112;134',
  green: '166;227;161',
  peach: '250;179;135',
};

// Integer linear interpolation between a and b, t in [0,1].
function lerp(a, b, t) {
  return Math.round(a + (b - a) * t);
}

// Context: Pink → Red → Latte Red.
function ctxGradient(pct) {
  let r, g, b;
  if (pct < 30) {
    const t = pct / 30;
    r = lerp(245, 230, t); g = lerp(194, 69, t); b = lerp(231, 83, t);
  } else if (pct < 70) {
    const t = (pct - 30) / 40;
    r = lerp(230, 210, t); g = lerp(69, 15, t); b = lerp(83, 57, t);
  } else {
    r = 210; g = 15; b = 57;
  }
  return `${r};${g};${b}`;
}

// 5H: Mocha Lavender → Latte Blue → Latte Red.
function fiveGradient(pct) {
  let r, g, b;
  if (pct < 50) {
    const t = pct / 50;
    r = lerp(180, 30, t); g = lerp(190, 102, t); b = lerp(254, 245, t);
  } else {
    const t = (pct - 50) / 50;
    r = lerp(30, 210, t); g = lerp(102, 15, t); b = lerp(245, 57, t);
  }
  return `${r};${g};${b}`;
}

// 7D: Mocha Yellow → Latte Peach → Latte Red.
function sevenGradient(pct) {
  let r, g, b;
  if (pct < 50) {
    const t = pct / 50;
    r = lerp(249, 254, t); g = lerp(226, 100, t); b = lerp(175, 11, t);
  } else {
    const t = (pct - 50) / 50;
    r = lerp(254, 210, t); g = lerp(100, 15, t); b = lerp(11, 57, t);
  }
  return `${r};${g};${b}`;
}

const GRAD = { context: ctxGradient, '5h': fiveGradient, '7d': sevenGradient };

// Render one gradient bar (█ filled by position, ░ empty in the end color).
function gradBar(pct, type, width = BAR_WIDTH) {
  const p = clampPct(pct);
  const grad = GRAD[type] || fiveGradient;
  const filled = Math.min(width, Math.floor((p * width + 50) / 100));
  const endColor = grad(p);
  let bar = '';
  for (let i = 0; i < filled; i++) {
    bar += `\x1b[38;2;${grad(Math.floor((i * 100) / width))}m█`;
  }
  for (let i = 0; i < width - filled; i++) {
    bar += `\x1b[38;2;${endColor}m░`;
  }
  return bar + '\x1b[0m';
}

// "<emoji><Label> <bar> <NN%> (<reset>)" for one metric. emoji already carries
// its trailing space (or is empty for 5H / 7D, which have no leading icon).
function metricSegment(emoji, labelColor, label, type, pct, resetStr) {
  const p = clampPct(pct);
  let s = `${emoji}${tcol(labelColor, label)} ${gradBar(p, type)} ${boldCol(GRAD[type](p), `${p}%`)}`;
  if (resetStr) s += ` ${tcol(C.overlay, `(${resetStr})`)}`;
  return s;
}

// 5H reset as "XhYm"; null when no reset info is available.
function fmtFiveReset(five, cacheText) {
  const min = parseResetMinutes(five, cacheText);
  if (min == null) return null;
  return `${Math.floor(min / 60)}h${min % 60}m`;
}

// 7D reset as a short weekday ("Wed" / "周三") in the active language's locale.
function sevenResetDay(week, weekLocale) {
  const ra = week.resets_at;
  let d = null;
  if (typeof ra === 'number') d = new Date(ra * 1000);
  else if (typeof ra === 'string') {
    const ts = Date.parse(ra);
    if (!Number.isNaN(ts)) d = new Date(ts);
  }
  if (!d) return null;
  try {
    return d.toLocaleDateString(weekLocale, { weekday: 'short' });
  } catch {
    return null;
  }
}

// Second line (quota): Context / 5H / 7D gradient usage bars + money spend
// (billing-block cost and burn rate), styled after AwesomeJun/CC-statusline.
function buildQuotaLine(data, cacheText, lang) {
  const t = I18N[lang] || I18N.en;
  const rl = data.rate_limits || {};
  const five = rl.five_hour || {};
  const week = rl.seven_day || {};

  // ccusage cache: billing-block cost, burn rate, and session-cost fallback.
  const block = (/(\$[\d.]+)\s+block/.exec(cacheText) || [])[1] || null;
  const hr = (/\$[\d.]+\/hr/.exec(cacheText) || [])[0] || null;
  const sessionCost = (/(\$[\d.]+)\s+session/.exec(cacheText) || [])[1] || null;

  const segs = [];

  // Context bar: prefer the ccusage cache "🧠 N (X%)" (stdin's context_window
  // is null on some plans), fall back to stdin.
  let ctxPct = null;
  const mCtx = /🧠\s+[\d,]+\s+\((\d+)%\)/.exec(cacheText);
  if (mCtx) {
    ctxPct = Number(mCtx[1]);
  } else {
    const cwu = data.context_window && data.context_window.used_percentage;
    if (typeof cwu === 'number') ctxPct = Math.round(cwu);
  }
  if (ctxPct != null) segs.push(metricSegment('🧠 ', C.pink, 'Context', 'context', ctxPct, null));

  // 5H / 7D usage bars from the official rate_limits (used_percentage). Before
  // that data arrives, show empty bars with a "(loading..)" hint.
  const used = five.used_percentage;
  if (typeof used === 'number') {
    segs.push(metricSegment('', C.lavender, '5H', '5h', used, fmtFiveReset(five, cacheText)));
    const weekUsed = week.used_percentage;
    if (typeof weekUsed === 'number') {
      segs.push(metricSegment('', C.yellow, '7D', '7d', weekUsed, sevenResetDay(week, t.weekLocale)));
    }
  } else {
    segs.push(metricSegment('', C.lavender, '5H', '5h', 0, null));
    segs.push(
      `${metricSegment('', C.yellow, '7D', '7d', 0, null)} ${tcol(C.overlay, '(loading..)')}`
    );
  }

  // Money spend: billing-block cost (or session-cost fallback) + burn rate.
  const money = [];
  if (block) money.push(tcol(C.green, `💰 ${block}`));
  else if (sessionCost) money.push(tcol(C.green, `💰 ${sessionCost}`));
  if (hr) money.push(tcol(C.peach, `🔥 ${hr}`));
  if (money.length) segs.push(money.join(' '));

  return segs.length ? segs.join(' │ ') : t.loading;
}

// Hand stdin to a fully detached child over a pipe so the slow ccusage cold
// start (~12s) never blocks Claude Code's status line render. No temp files:
// the child reads stdin, and the kernel pipe buffer holds the small Claude Code
// JSON even after this foreground process exits.
function scheduleRefresh(stdinRaw, cacheFile) {
  try {
    // Throttle: if this session's cache was refreshed in the last few seconds,
    // skip spawning so rapid successive renders don't stack ccusage processes.
    try {
      if (Date.now() - fs.statSync(cacheFile).mtimeMs < 2500) return;
    } catch {
      // No cache yet: proceed with the refresh.
    }
    const self = fileURLToPath(new URL('../bin/cli.js', import.meta.url));
    const child = spawn(process.execPath, [self, 'refresh'], {
      detached: true,
      stdio: ['pipe', 'ignore', 'ignore'],
      env: augmentedEnv(),
    });
    // Swallow async stream errors (e.g. EPIPE) so a failed background spawn can
    // never bubble up as an uncaughtException and break the foreground line.
    child.on('error', () => {});
    child.stdin.on('error', () => {});
    child.stdin.write(stdinRaw);
    child.stdin.end();
    child.unref();
  } catch {
    // Background refresh is best-effort; never let it break the foreground line.
  }
}

export function render() {
  const raw = readStdin();
  let data = {};
  try {
    data = JSON.parse(raw);
  } catch {
    data = {};
  }

  const cacheFile = cacheFileFor(data);
  let cacheText = '';
  try {
    cacheText = fs.readFileSync(cacheFile, 'utf8');
  } catch {
    // No cache on the very first render; cost/rate simply omitted.
  }

  const ctxLine = buildContextLine(data);
  const quotaLine = buildQuotaLine(data, cacheText, pickLang());
  process.stdout.write(ctxLine ? `${ctxLine}\n${quotaLine}` : quotaLine);

  if (raw) scheduleRefresh(raw, cacheFile);
}

// Hidden subcommand invoked by scheduleRefresh in a detached process. Reads the
// Claude Code JSON from stdin, runs ccusage, and atomically rewrites the cache.
export function refresh() {
  // Guard against a manual `cc-statusline refresh` in a terminal hanging on
  // stdin; in normal use this is spawned with a pipe that reaches EOF.
  if (process.stdin.isTTY) process.exit(0);
  let raw = '';
  try {
    raw = fs.readFileSync(0, 'utf8');
  } catch {
    process.exit(0);
  }

  let data = {};
  try {
    data = JSON.parse(raw);
  } catch {
    data = {};
  }
  const cacheFile = cacheFileFor(data);

  try {
    const out = execFileSync('ccusage', ['statusline', '--offline'], {
      input: raw,
      env: augmentedEnv(),
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
      timeout: 60000,
    });
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    // .tmp carries the pid so two overlapping refreshes for the same session
    // don't write the same temp file and corrupt each other before rename.
    const tmp = `${cacheFile}.tmp.${process.pid}`;
    fs.writeFileSync(tmp, out);
    fs.renameSync(tmp, cacheFile);
  } catch {
    // ccusage missing or failed: keep the previous cache, stay silent.
  }
  pruneCaches();
}
