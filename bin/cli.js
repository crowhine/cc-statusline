#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { render, refresh } from '../lib/render.js';
import { init } from '../lib/init.js';

const cmd = process.argv[2] || 'render';

function version() {
  const pkg = fileURLToPath(new URL('../package.json', import.meta.url));
  try {
    return JSON.parse(fs.readFileSync(pkg, 'utf8')).version;
  } catch {
    return '0.0.0';
  }
}

function help() {
  process.stdout.write(`cc-statusline ${version()}
Claude Code status line: official 5h/weekly quota + ccusage cost & burn rate.

Usage:
  cc-statusline render      Render the status line (reads Claude Code JSON from stdin)
  cc-statusline init        Write statusLine config into ~/.claude/settings.json
  cc-statusline --help      Show this help
  cc-statusline --version   Show version

Environment:
  CC_STATUSLINE_LANG=zh|en  Force language (default: auto-detect from $LANG)
`);
}

switch (cmd) {
  case 'render':
    render();
    break;
  case 'refresh':
    // Hidden subcommand: background ccusage cache refresh, spawned by render.
    refresh();
    break;
  case 'init':
    init();
    break;
  case '-v':
  case '--version':
    process.stdout.write(version() + '\n');
    break;
  case '-h':
  case '--help':
  case 'help':
    help();
    break;
  default:
    process.stderr.write(`Unknown command: ${cmd}\n`);
    help();
    process.exit(1);
}
