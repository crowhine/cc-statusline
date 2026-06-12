import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function settingsPath() {
  const dir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  return path.join(dir, 'settings.json');
}

// POSIX single-quote: everything inside is literal except a single quote,
// which is closed, escaped, and reopened. Safe against spaces, $, backticks, \.
function shellQuote(p) {
  return `'${p.replace(/'/g, "'\\''")}'`;
}

// Absolute `node <cli> render` so the status line works even when Claude Code's
// command runs with a PATH that lacks the npm global bin dir (common under nvm).
function commandString() {
  const cli = fileURLToPath(new URL('../bin/cli.js', import.meta.url));
  return `${shellQuote(process.execPath)} ${shellQuote(cli)} render`;
}

function fail(msg) {
  process.stderr.write(`X ${msg}\n`);
  process.exit(1);
}

export function init() {
  const file = settingsPath();
  let settings = {};

  if (fs.existsSync(file)) {
    let raw;
    try {
      raw = fs.readFileSync(file, 'utf8');
    } catch (e) {
      fail(`Cannot read ${file}: ${e.message}`);
    }
    try {
      settings = JSON.parse(raw);
    } catch {
      fail(
        `${file} is not valid JSON. Aborting so your existing config is left intact. ` +
          `Add the statusLine field manually (see README).`,
      );
    }
    const backup = `${file}.bak-${Date.now()}`;
    fs.writeFileSync(backup, raw);
    process.stdout.write(`Backed up existing settings -> ${backup}\n`);
  } else {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }

  settings.statusLine = {
    type: 'command',
    command: commandString(),
    padding: 0,
  };

  fs.writeFileSync(file, JSON.stringify(settings, null, 2) + '\n');
  process.stdout.write(`Configured statusLine -> ${file}\n`);
  process.stdout.write('Restart Claude Code to see the status line.\n');
}
