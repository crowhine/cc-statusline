# cc-statusline

[English](./README.md) | **简体中文**

一个 [Claude Code](https://claude.com/claude-code) 状态栏，在你的**官方订阅配额**（5 小时窗口 + 每周）、当前**计费块成本**和**消耗速率**之上，再显示一行**上下文信息**（工作目录、git 分支、模型、推理强度）。

```
📁 acme/webapp · 🌿 main · 🤖 Opus · 🧠 high
🪟 ctx 35% · 剩余 61% · 周 81% · 距重置 4h14m · 🔋 5h块 $9.60 · 🔥 $15.30/hr
```

```
📁 acme/webapp · 🌿 main · 🤖 Opus · 🧠 high
🪟 ctx 35% · 61% left · 81% wk · ⏳ 4h14m · 🔋 5h $9.60 · 🔥 $15.30/hr
```

- **上下文行** —— 路径（末 2 层）、git 分支、模型、推理强度，均从 stdin JSON 读取；对应字段缺失时自动省略（如非 git 目录不显示分支）。
- **🪟 ctx %** —— 上下文窗口占用；≥50% 变黄、≥80% 变红，提醒及时 `/compact`。
- **剩余% / 周%** 直接来自 Claude Code 官方 `rate_limits` 数据 —— 不是估算。
- **5h块 / 消耗速率** 来自 [`ccusage`](https://github.com/ryoppippi/ccusage)（可选）。

---

## 为什么再造一个状态栏？

大多数用量状态栏只显示花了多少钱。这个工具额外给出真正能告诉你“离限流还有多远”的两个数字：

1. **真实配额百分比** —— Claude Code 2.1+ 会在 stdin 传入 `rate_limits.five_hour` 和 `rate_limits.seven_day`（含 `used_percentage` 与 `resets_at`）。我们直接读取，所以百分比是精确值，不是猜测。
2. **核心零依赖** —— 配额百分比、重置倒计时、加载状态都不需要任何外部工具。成本和速率是建立在 `ccusage` 之上的*可选*增强。
3. **即时渲染** —— `ccusage` 冷启动约 12 秒，所以我们绝不在前台同步调用它。前台从缓存毫秒级渲染；一个完全脱离的后台进程负责刷新该缓存供下次渲染使用。

## 隐私

全部在本地读取。工具只读取 Claude Code 通过 stdin 传入的 JSON，以及（可选的）本地 `ccusage` 缓存。**不会向任何地方上传数据。**

## 环境要求

- Node.js >= 18
- Claude Code 2.1+（用于官方 `rate_limits` 配额数据）
- *（可选）* `PATH` 中安装 [`ccusage`](https://github.com/ryoppippi/ccusage) 以显示成本 / 消耗速率

## 安装

直接从 GitHub 安装（现在就能用）：

```bash
npm install -g github:crowhine/cc-statusline
cc-statusline init        # 把 statusLine 配置写进 ~/.claude/settings.json（会先备份）
```

然后重启 Claude Code。

> 发布到 npm 之后，`npm install -g cc-statusline` 也可用。

> `init` 在修改前会把现有的 `settings.json` 备份成 `settings.json.bak-<时间戳>`；如果该文件不是合法 JSON，则原样中止不动它。

### 手动配置

如果不想用 `init`，把下面这段加进 `~/.claude/settings.json`（用 `which cc-statusline` 打印的绝对路径，或 `node /绝对路径/cc-statusline/bin/cli.js render`）：

```json
{
  "statusLine": {
    "type": "command",
    "command": "cc-statusline render",
    "padding": 0
  }
}
```

## 配置

| 环境变量 | 取值 | 默认 |
|---|---|---|
| `CC_STATUSLINE_LANG` | `zh` / `en` | 根据 `$LANG` 自动判断 |
| `CLAUDE_CONFIG_DIR` | 路径 | `~/.claude`（`init` 写入位置） |

## 工作原理

```
Claude Code ──stdin JSON──▶ cc-statusline render
                                 │
                 ┌───────────────┴────────────────┐
        （前台，毫秒级）                  （后台，完全脱离）
   解析 rate_limits + 读缓存          node cli.js refresh
   打印状态栏，退出                   └─ ccusage statusline --offline
                                         └─ 原子地重写缓存
```

- **配额 / 重置** —— 每次渲染都从 `rate_limits` 解析（无需联网、无需缓存）。
- **成本 / 速率** —— 从 `ccusage` 缓存读取，缓存由后台异步刷新，慢速冷启动永远不会卡住状态栏。
- 如果没装 `ccusage`，成本/速率段会被省略，配额段照常工作。

## 兼容性说明

- 配额段依赖 Claude Code 的 `rate_limits` stdin 字段（Claude Code 2.1.x、Pro/Max 套餐）。它在一个会话的首个 API 响应之后才出现；在那之前你会看到 `剩余 —` / `— left`。
- 成本/速率段解析 `ccusage statusline` 的文本输出。如果未来某个 `ccusage` 版本改了格式，这两段可能需要更新；配额段不受影响。
- API-key（按量付费）用量没有每周配额，所以 `周` / `wk` 段不会出现。

## 致谢

成本与消耗速率数据来自 ryoppippi 的 [`ccusage`](https://github.com/ryoppippi/ccusage)。本项目只是把它和官方配额数据组合成一行。

## 许可

[MIT](./LICENSE)
