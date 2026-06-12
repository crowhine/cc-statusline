# cc-statusline

A [Claude Code](https://claude.com/claude-code) status line that shows your **official subscription quota** (5-hour window + weekly) alongside the current **billing-block cost** and **burn rate**.

```
🔋 5h块 $9.60 · 距重置 4h14m · 🔥 $15.30/hr · 剩余 61% · 周 81%
```

```
🔋 5h $9.60 · ⏳ 4h14m · 🔥 $15.30/hr · 61% left · 81% wk
```

- **剩余% / 周% (left / wk)** come straight from Claude Code's official `rate_limits` data — not an estimate.
- **5h块 / burn rate** come from [`ccusage`](https://github.com/ryoppippi/ccusage) (optional).

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

```bash
npm install -g cc-statusline
cc-statusline init        # writes the statusLine block into ~/.claude/settings.json (backs up first)
```

Then restart Claude Code.

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

- The quota segments depend on Claude Code's `rate_limits` stdin field (Claude Code 2.1.x, Pro/Max plans). It appears after the first API response of a session; before that you'll see `剩余 —` / `— left`.
- The cost/rate segments parse `ccusage statusline` text output. If a future `ccusage` release changes that format, those segments may need an update; the quota segments are unaffected.
- API-key (pay-as-you-go) usage has no weekly quota, so the `周` / `wk` segment won't appear.

## Credits

Cost and burn-rate data come from [`ccusage`](https://github.com/ryoppippi/ccusage) by ryoppippi. This project just composes it with the official quota data into one line.

## License

[MIT](./LICENSE)
