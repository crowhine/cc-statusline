# cc-statusline

**English** | [简体中文](./README.zh-CN.md)

A [Claude Code](https://claude.com/claude-code) status line that shows a **context line** (project directory, git branch, model, reasoning effort, output style) above your **official subscription quota** (context window + 5-hour + weekly) as truecolor **gradient progress bars**, plus **spend**: this session's token usage alongside the billing block's cost and burn rate.

<img alt="cc-statusline colored demo" src="https://raw.githubusercontent.com/crowhine/cc-statusline/main/assets/statusline.png?v=2" width="880">

<sub>Plain-text (no color):</sub>

```
📁 acme/webapp 🌿 main | 🤖 Opus ⚡︎high | 🎨 explanatory
🧠 ctx ██░░░░░ 32% | 5H ██░░░░░ 34% (4h35m→14:30) | 7D █████░░ 65% (Wed) | 🪙 12.4M 💰 $9.60 🔥 $15.30/hr
```

The context line groups fields as `[path branch] | [model effort] | [style]`; the effort level is prefixed with a small peach `⚡` bolt. The second line uses per-metric Catppuccin gradients (ported from [AwesomeJun/CC-statusline](https://github.com/AwesomeJun/CC-statusline)): **ctx** fades pink → red, **5H** lavender → blue, **7D** yellow → orange, so a glance at the hue tells you how loaded each budget is.

- **Context line** — path (last 2 segments), git branch, model, reasoning effort, and output style, grouped as `[path branch] | [model effort] | [style]` and read from the stdin JSON. Any field is omitted when absent (e.g. a non-git directory).
- **🧠 ctx / 5H / 7D** — gradient bars showing **used %**. `5H` shows the reset countdown *and* the wall-clock time it resets at (`4h35m→14:30`); `7D` shows its reset weekday (`Wed`). Requires a truecolor (24-bit) terminal.
- The `5H` clock is worth its width because the status line only repaints when Claude Code asks it to: a countdown you read five minutes after the last paint is five minutes wrong, while `14:30` stays true. It is formatted straight from the official `resets_at` instant when there is one, and derived from ccusage's `(Xh Ym left)` otherwise.
- The **5H / 7D** bars come straight from Claude Code's official `rate_limits` data (`used_percentage`) — not an estimate.
- **🪙 session tokens** — everything *this window* has consumed (input + output + cache), summed from its own transcript. Each window shows its own number. Not the context window; that's 🧠 ctx. See [Session token usage](#session-token-usage).
- **💰 block cost / 🔥 burn rate** come from [`ccusage`](https://github.com/ryoppippi/ccusage) (optional) and describe the machine-wide *billing block*, so they read the same in every window. Before `rate_limits` arrives, `5H`/`7D` show empty bars with `(loading..)`.

---

## Why another status line?

Most usage status lines only show dollars spent. This one surfaces the two numbers that actually tell you how close you are to a throttle:

1. **Real quota %** — Claude Code 2.1+ passes `rate_limits.five_hour` and `rate_limits.seven_day` (with `used_percentage` and `resets_at`) on stdin. We read them directly, so the percentages are exact, not guessed.
2. **Zero-dependency core** — quota %, reset countdown, and the loading state need no extra tools. Cost and burn rate are an *optional* enhancement layered on top of `ccusage`.
3. **Instant render** — `ccusage` has a ~12s cold start, so we never call it synchronously. The foreground renders in milliseconds from a cache; a fully detached background process refreshes that cache for the next render.

## Privacy

Everything is read locally. The tool reads the JSON Claude Code hands it on stdin and (optionally) your local `ccusage` cache. **Nothing is uploaded anywhere.**

The one time anything leaves your machine is when `ccusage`'s bundled price table is missing your model: the background refresh then asks `ccusage` for live pricing, which downloads a public price list. That request carries no usage data — and `CC_STATUSLINE_NO_ONLINE_PRICING=1` turns it off entirely. See [Cost shows $0.00 on a brand-new model](#cost-shows-000-on-a-brand-new-model).

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
| `CC_STATUSLINE_NO_SESSION_TOKENS` | `1` to disable | enabled |
| `CC_STATUSLINE_NO_ONLINE_PRICING` | `1` to disable | enabled |

## How it works

```
Claude Code ──stdin JSON──▶ cc-statusline render
                                 │
                 ┌───────────────┴────────────────┐
       (foreground, ms)                   (background, detached)
   parse rate_limits + read caches      node cli.js refresh
   print the line, exit                 ├─ ccusage statusline --offline
                                        │  └─ atomically rewrite session cache
                                        └─ sum this session's transcript
                                           └─ per-session token cache
```

- **Quota / reset** — parsed from `rate_limits` on every render (no network, no cache needed).
- **Cost / burn rate** — pulled from the `ccusage` cache, refreshed in the background so the slow cold start never blocks the line.
- **Session tokens** — summed from this session's transcript into a per-session cache; see [Session token usage](#session-token-usage).
- If `ccusage` isn't installed, the cost/rate/token segments are simply omitted and the quota segments still work.

### Session token usage

🪙 counts every token **this window** has consumed — input, output, and cache. On a cache-heavy session it runs far ahead of what the context window would suggest, because cache reads are re-billed on every turn. For the context window itself, read 🧠 ctx.

Note that 🪙 and 💰/🔥 deliberately have different scopes: the token count is per window, while cost and burn rate come from `ccusage` and describe the machine-wide billing block. A billing block spans whatever windows are open during its five hours; a session spans however long you keep one window alive, which is often several blocks.

The number is summed from the session's own transcript (`transcript_path` on stdin), which takes ~0.04s on a typical file and ~0.10s on the largest one measured (18 MB). `ccusage blocks --active` would have been the obvious source, but it walks *every* transcript on disk — ~40 CPU-seconds, a thousand times more — to produce a single number that would read identically in every window. Set `CC_STATUSLINE_NO_SESSION_TOKENS=1` to drop the segment.

Summing has one subtlety worth knowing if you compare against other tools: an assistant message that emits several content blocks is written as several transcript lines, **each repeating the same message-level usage**. Totals are deduplicated on `message.id`; adding up lines instead inflated the result by 2.16x on the transcript this was developed against.

If the refresh breaks, the segment disappears after 30 minutes rather than freezing on a number that quietly stopped updating.

### Cost shows $0.00 on a brand-new model

`ccusage --offline` prices tokens from a table bundled at its release, so a model that shipped after that release has no entry and every cost reads `$0.00` — silently, since `ccusage` only warns about it on `daily` / `monthly`, never on `statusline`.

When the background refresh sees that fingerprint (nothing spent today, yet the session is clearly active), it retries once against live pricing and remembers the outcome for 6 hours, so the steady state is still a single `ccusage` call per refresh. Upgrading `ccusage` past the gap puts it back on the bundled table by itself.

Set `CC_STATUSLINE_NO_ONLINE_PRICING=1` to disable that retry and keep the refresh strictly offline, accepting `$0.00` until `ccusage` ships the price entry.

## Compatibility notes

- The quota segments depend on Claude Code's `rate_limits` stdin field (Claude Code 2.1.x, Pro/Max plans). It appears after the first API response of a session; before that `5H`/`7D` render as empty bars with `(loading..)`.
- The cost/rate segments parse `ccusage statusline` text output. If a future `ccusage` release changes that format, those segments may need an update; the quota segments are unaffected.
- API-key (pay-as-you-go) usage never populates `rate_limits`, so `5H`/`7D` stay as empty `(loading..)` bars — there's no subscription quota to display.

## Credits

Cost and burn-rate data come from [`ccusage`](https://github.com/ryoppippi/ccusage) by ryoppippi. The truecolor gradient progress bars are ported from [AwesomeJun/CC-statusline](https://github.com/AwesomeJun/CC-statusline). This project composes them with the official quota data into two compact lines.

## License

[MIT](./LICENSE)
