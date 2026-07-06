# cc-statusline

**English** | [简体中文](./README.zh-CN.md)

A [Claude Code](https://claude.com/claude-code) status line that shows a **context line** (project directory, git branch, model, reasoning effort) above your **official subscription quota** (Context window + 5-hour + weekly) as truecolor **gradient progress bars**, plus **money spend** (billing-block cost and burn rate).

```
📁 acme/webapp · 🌿 main · 🤖 Opus · ⚡ high
🧠 Context ███░░░░░░░ 32% │ 5H ███░░░░░░░ 34% (4h35m) │ 7D ███████░░░ 65% (Wed) │ 💰 $9.60 🔥 $15.30/hr
```

The second line uses per-metric Catppuccin gradients (ported from [AwesomeJun/CC-statusline](https://github.com/AwesomeJun/CC-statusline)): **Context** fades pink → red, **5H** lavender → blue, **7D** yellow → orange, so a glance at the hue tells you how loaded each budget is.

- **Context line** — path (last 2 segments), git branch, model, and reasoning effort, read from the stdin JSON. Any field is omitted when absent (e.g. a non-git directory).
- **🧠 Context / 5H / 7D** — gradient bars showing **used %**. `5H` shows the reset countdown (`4h35m`); `7D` shows its reset weekday (`Wed`). Requires a truecolor (24-bit) terminal.
- The **5H / 7D** bars come straight from Claude Code's official `rate_limits` data (`used_percentage`) — not an estimate.
- **💰 block cost / 🔥 burn rate** come from [`ccusage`](https://github.com/ryoppippi/ccusage) (optional). Before `rate_limits` arrives, `5H`/`7D` show empty bars with `(loading..)`.

---

## Why another status line?

Most usage status lines only show dollars spent. This one surfaces the two numbers that actually tell you how close you are to a throttle:

1. **Real quota %** — Claude Code 2.1+ passes `rate_limits.five_hour` and `rate_limits.seven_day` (with `used_percentage` and `resets_at`) on stdin. We read them directly, so the percentages are exact, not guessed.
2. **Zero-dependency core** — quota %, reset countdown, and the loading state need no extra tools. Cost and burn rate are an *optional* enhancement layered on top of `ccusage`.
3. **Instant render** — `ccusage` has a ~12s cold start, so we never call it synchronously. The foreground renders in milliseconds from a cache; a fully detached background process refreshes that cache for the next render.

## Privacy

Everything is read locally. The tool reads the JSON Claude Code hands it on stdin and (optionally) your local `ccusage` cache. **Nothing is uploaded anywhere.**

## Requirements

- Node.js >= 18
- Claude Code 2.1+ (for the official `rate_limits` quota data)
- *(optional)* [`ccusage`](https://github.com/ryoppippi/ccusage) on your `PATH` for cost / burn rate

## Install

Install straight from GitHub (works today):

```bash
npm install -g github:crowhine/cc-statusline
cc-statusline init        # writes the statusLine block into ~/.claude/settings.json (backs up first)
```

Then restart Claude Code.

> Once this is published to npm, `npm install -g cc-statusline` will work too.

> `init` backs up your existing `settings.json` to `settings.json.bak-<timestamp>` before editing, and aborts untouched if the file isn't valid JSON.

### Manual configuration

If you'd rather not run `init`, add this to `~/.claude/settings.json` (use the absolute path printed by `which cc-statusline`, or `node /abs/path/to/cc-statusline/bin/cli.js render`):

```json
{
  "statusLine": {
    "type": "command",
    "command": "cc-statusline render",
    "padding": 0
  }
}
```

## Configuration

| Env var | Values | Default |
|---|---|---|
| `CC_STATUSLINE_LANG` | `zh` / `en` | auto-detect from `$LANG` |
| `CLAUDE_CONFIG_DIR` | path | `~/.claude` (where `init` writes) |

## How it works

```
Claude Code ──stdin JSON──▶ cc-statusline render
                                 │
                 ┌───────────────┴────────────────┐
       (foreground, ms)                   (background, detached)
   parse rate_limits + read cache       node cli.js refresh <tmp>
   print the line, exit                 └─ ccusage statusline --offline
                                            └─ atomically rewrite cache
```

- **Quota / reset** — parsed from `rate_limits` on every render (no network, no cache needed).
- **Cost / burn rate** — pulled from the `ccusage` cache, refreshed in the background so the slow cold start never blocks the line.
- If `ccusage` isn't installed, the cost/rate segments are simply omitted and the quota segments still work.

## Compatibility notes

- The quota segments depend on Claude Code's `rate_limits` stdin field (Claude Code 2.1.x, Pro/Max plans). It appears after the first API response of a session; before that `5H`/`7D` render as empty bars with `(loading..)`.
- The cost/rate segments parse `ccusage statusline` text output. If a future `ccusage` release changes that format, those segments may need an update; the quota segments are unaffected.
- API-key (pay-as-you-go) usage never populates `rate_limits`, so `5H`/`7D` stay as empty `(loading..)` bars — there's no subscription quota to display.

## Credits

Cost and burn-rate data come from [`ccusage`](https://github.com/ryoppippi/ccusage) by ryoppippi. The truecolor gradient progress bars are ported from [AwesomeJun/CC-statusline](https://github.com/AwesomeJun/CC-statusline). This project composes them with the official quota data into two compact lines.

## License

[MIT](./LICENSE)
