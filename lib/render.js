import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CACHE_DIR = path.join(os.homedir(), '.cache', 'cc-statusline');
const CACHE_FILE = path.join(CACHE_DIR, 'ccusage.txt');

const I18N = {
  zh: {
    block: (v) => `🔋 5h块 ${v}`,
    reset: (v) => `距重置 ${v}`,
    rate: (v) => `🔥 ${v}`,
    remain: (v) => `剩余 ${v}`,
    week: (v) => `周 ${v}`,
    ctx: (v) => `ctx ${v}`,
    loading: '📊 用量加载中…',
  },
  en: {
    block: (v) => `🔋 5h ${v}`,
    reset: (v) => `⏳ ${v}`,
    rate: (v) => `🔥 ${v}`,
    remain: (v) => `${v} left`,
    week: (v) => `${v} wk`,
    ctx: (v) => `ctx ${v}`,
    loading: '📊 loading…',
  },
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
  const cwd = (data.workspace && data.workspace.current_dir) || data.cwd || '';
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
    segs.push('🧠 ' + color(ecolor, effort));
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
  return Math.min(100, Math.max(0, Math.round(n)));
}

// Second line (quota): context-window % / remaining quota (or session cost) /
// reset countdown / billing-block cost / burn rate.
function buildQuotaLine(data, cacheText, lang) {
  const t = I18N[lang] || I18N.en;
  const rl = data.rate_limits || {};
  const five = rl.five_hour || {};
  const week = rl.seven_day || {};

  // ccusage cache: capture "$X block" cost and "$Y/hr" burn rate.
  const mBlock = /(\$[\d.]+)\s+block/.exec(cacheText);
  const mHr = /\$[\d.]+\/hr/.exec(cacheText);
  const block = mBlock ? mBlock[1] : null;
  const hr = mHr ? mHr[0] : null;

  const parts = [];

  // Context-window usage: prefer the ccusage cache "🧠 N (X%)" (stdin's
  // context_window is null on some plans), fall back to stdin. >=80% red / >=50% yellow.
  let pct = null;
  const mCtx = /🧠\s+[\d,]+\s+\((\d+)%\)/.exec(cacheText);
  if (mCtx) {
    pct = Number(mCtx[1]);
  } else {
    const cwu = data.context_window && data.context_window.used_percentage;
    if (typeof cwu === 'number') pct = Math.round(cwu);
  }
  if (pct != null) {
    const label = t.ctx(`${pct}%`);
    if (pct >= 80) parts.push('🪟 ' + color('91', label));
    else if (pct >= 50) parts.push('🪟 ' + color('33', label));
    else parts.push('🪟 ' + label);
  }

  // Quota remaining (official rate_limits); fall back to session cost (ccusage).
  const used = five.used_percentage;
  if (typeof used === 'number') {
    parts.push(t.remain(`${clampPct(100 - used)}%`));
    const weekUsed = week.used_percentage;
    if (typeof weekUsed === 'number') parts.push(t.week(`${clampPct(100 - weekUsed)}%`));
  } else {
    const mSess = /(\$[\d.]+)\s+session/.exec(cacheText);
    if (mSess) parts.push(`💰 ${mSess[1]}`);
    // rate_limits not present yet (first frame of a session, or non Pro/Max plan).
    else parts.push(t.remain('—'));
  }

  // Reset countdown: official resets_at first, ccusage "(Wm left)" as fallback.
  const resetMin = parseResetMinutes(five, cacheText);
  if (resetMin != null) {
    const rh = Math.floor(resetMin / 60);
    const rm = resetMin % 60;
    parts.push(t.reset(rh ? `${rh}h${String(rm).padStart(2, '0')}m` : `${rm}m`));
  }

  // Billing-block cost (ccusage).
  if (block) parts.push(t.block(block));

  // Burn rate (ccusage).
  if (hr) parts.push(t.rate(hr));

  return parts.length ? parts.join(' · ') : t.loading;
}

// Hand stdin to a fully detached child over a pipe so the slow ccusage cold
// start (~12s) never blocks Claude Code's status line render. No temp files:
// the child reads stdin, and the kernel pipe buffer holds the small Claude Code
// JSON even after this foreground process exits.
function scheduleRefresh(stdinRaw) {
  try {
    // Throttle: if the cache was refreshed in the last few seconds, skip
    // spawning so rapid successive renders don't stack ccusage processes.
    try {
      if (Date.now() - fs.statSync(CACHE_FILE).mtimeMs < 2500) return;
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

  let cacheText = '';
  try {
    cacheText = fs.readFileSync(CACHE_FILE, 'utf8');
  } catch {
    // No cache on the very first render; cost/rate simply omitted.
  }

  const ctxLine = buildContextLine(data);
  const quotaLine = buildQuotaLine(data, cacheText, pickLang());
  process.stdout.write(ctxLine ? `${ctxLine}\n${quotaLine}` : quotaLine);

  if (raw) scheduleRefresh(raw);
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

  try {
    const out = execFileSync('ccusage', ['statusline', '--offline'], {
      input: raw,
      env: augmentedEnv(),
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
      timeout: 60000,
    });
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    const tmp = `${CACHE_FILE}.tmp`;
    fs.writeFileSync(tmp, out);
    fs.renameSync(tmp, CACHE_FILE);
  } catch {
    // ccusage missing or failed: keep the previous cache, stay silent.
  }
}
