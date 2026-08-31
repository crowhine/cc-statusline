# cc-statusline

[English](./README.md) | **简体中文**

一个 [Claude Code](https://claude.com/claude-code) 状态栏，把你的**官方订阅配额**（上下文窗口 + 5 小时 + 每周）画成真彩色**渐变进度条**，再加上**开销**：本会话的 token 用量，以及计费块的成本与消耗速率，上方还有一行**上下文信息**（项目目录、git 分支、模型、推理强度、输出风格）。

<img alt="cc-statusline 彩色示例" src="https://raw.githubusercontent.com/crowhine/cc-statusline/main/assets/statusline.png?v=2" width="880">

<sub>纯文本（无色）：</sub>

```
📁 acme/webapp 🌿 main | 🤖 Opus ⚡︎high | 🎨 explanatory
🧠 ctx ██░░░░░ 32% | 5H ██░░░░░ 34% (4h35m→14:30) | 7D █████░░ 65% (Wed) | 🪙 12.4M 💰 $9.60 🔥 $15.30/hr
```

上下文行按 `[路径 分支] | [模型 effort] | [风格]` 分组，effort 前带一个橙色小 `⚡` 闪电。第二行采用逐指标的 Catppuccin 渐变（移植自 [AwesomeJun/CC-statusline](https://github.com/AwesomeJun/CC-statusline)）：**ctx** 粉→红、**5H** 薰衣草→蓝、**7D** 黄→橙——扫一眼颜色就知道各配额吃紧程度。

- **上下文行** —— 路径（末 2 层）、git 分支、模型、推理强度、输出风格，按 `[路径 分支] | [模型 effort] | [风格]` 分组，均从 stdin JSON 读取；对应字段缺失时自动省略（如非 git 目录不显示分支）。
- **🧠 ctx / 5H / 7D** —— 渐变进度条，显示**已用百分比**。`5H` 同时给出重置倒计时**与重置钟点**（`4h35m→14:30`），`7D` 附带重置星期（`Wed`/`周三`）。需要真彩色（24-bit）终端。
- `5H` 的钟点值得多占几格：状态栏只在 Claude Code 触发重绘时才更新，上次重绘过了五分钟，倒计时就错五分钟，而 `14:30` 一直成立。有官方 `resets_at` 时钟点由该时刻直接格式化，否则按 ccusage 的 `(Xh Ym left)` 反推。
- **5H / 7D** 进度条直接来自 Claude Code 官方 `rate_limits` 数据（`used_percentage`）—— 不是估算。
- **🪙 本会话 token** —— **这个窗口**累计消耗的全部 token（含输入、输出与缓存），由它自己的 transcript 累加而来，**每个窗口显示各自的数**。不是上下文窗口——那个看 🧠 ctx。详见[本会话 token 用量](#本会话-token-用量)。
- **💰 计费块成本 / 🔥 消耗速率** 来自 [`ccusage`](https://github.com/ryoppippi/ccusage)（可选），描述的是**全机计费块**，所以在每个窗口里读数相同。`rate_limits` 到达前，`5H`/`7D` 显示空条 + `(loading..)`。

---

## 为什么再造一个状态栏？

大多数用量状态栏只显示花了多少钱。这个工具额外给出真正能告诉你“离限流还有多远”的两个数字：

1. **真实配额百分比** —— Claude Code 2.1+ 会在 stdin 传入 `rate_limits.five_hour` 和 `rate_limits.seven_day`（含 `used_percentage` 与 `resets_at`）。我们直接读取，所以百分比是精确值，不是猜测。
2. **核心零依赖** —— 配额百分比、重置倒计时、加载状态都不需要任何外部工具。成本和速率是建立在 `ccusage` 之上的*可选*增强。
3. **即时渲染** —— `ccusage` 冷启动约 12 秒，所以我们绝不在前台同步调用它。前台从缓存毫秒级渲染；一个完全脱离的后台进程负责刷新该缓存供下次渲染使用。

## 隐私

全部在本地读取。工具只读取 Claude Code 通过 stdin 传入的 JSON，以及（可选的）本地 `ccusage` 缓存。**不会向任何地方上传数据。**

唯一会离开本机的情形是 `ccusage` 内置价目表里没有你正在用的模型：此时后台刷新会向 `ccusage` 请求在线价目，它会下载一份公开价目表。该请求不携带任何用量数据——设 `CC_STATUSLINE_NO_ONLINE_PRICING=1` 可完全关闭。详见[新模型上成本显示 $0.00](#新模型上成本显示-000)。

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
| `CC_STATUSLINE_NO_SESSION_TOKENS` | 设为 `1` 关闭 | 开启 |
| `CC_STATUSLINE_NO_ONLINE_PRICING` | 设为 `1` 关闭 | 开启 |

## 工作原理

```
Claude Code ──stdin JSON──▶ cc-statusline render
                                 │
                 ┌───────────────┴────────────────┐
        （前台，毫秒级）                  （后台，完全脱离）
   解析 rate_limits + 读缓存          node cli.js refresh
   打印状态栏，退出                   ├─ ccusage statusline --offline
                                      │  └─ 原子地重写会话缓存
                                      └─ 累加本会话 transcript
                                         └─ 按会话隔离的 token 缓存
```

- **配额 / 重置** —— 每次渲染都从 `rate_limits` 解析（无需联网、无需缓存）。
- **成本 / 速率** —— 从 `ccusage` 缓存读取，缓存由后台异步刷新，慢速冷启动永远不会卡住状态栏。
- **本会话 token** —— 由本会话 transcript 累加，写入按会话隔离的缓存，详见[本会话 token 用量](#本会话-token-用量)。
- 如果没装 `ccusage`，成本/速率/token 段会被省略，配额段照常工作。

### 本会话 token 用量

🪙 统计**这个窗口**累计消耗的每一个 token —— 输入、输出、缓存都算。缓存命中多的会话里这个数会远高于凭上下文窗口的直觉估计，因为缓存读取每一轮都会重新计费。想看上下文窗口本身，请看 🧠 ctx。

注意 🪙 和 💰/🔥 的口径是**故意不同**的：token 数是**每窗口**的，而成本与速率来自 `ccusage`、描述的是**全机计费块**。一个计费块覆盖它那 5 小时里开着的所有窗口；一个会话则是你让某个窗口活了多久，往往横跨好几个计费块。

该数字由本会话自己的 transcript（stdin 里的 `transcript_path`）累加而来，实测典型文件约 0.04 秒、最大的一个（18 MB）约 0.10 秒。`ccusage blocks --active` 本是更顺手的数据源，但它要遍历**磁盘上所有** transcript——实测约 40 CPU-秒、贵一千倍——而且得到的是一个在每个窗口里读数都一样的全机数字。设 `CC_STATUSLINE_NO_SESSION_TOKENS=1` 可去掉该段。

累加有一个坑，如果你要和其他工具对数值就得知道：一条 assistant 消息若产生多个 content block，transcript 会写成多行，**每行都重复同一份 message 级 usage**。这里按 `message.id` 去重；直接累加行数会虚高——在开发时用的那份 transcript 上是 2.16 倍。

如果刷新链路坏掉，该段会在 30 分钟后消失，而不是冻结在一个早已停止更新的数字上。

### 新模型上成本显示 $0.00

`ccusage --offline` 用的是它发版时打包进去的价目表，因此比它更晚上市的模型没有对应条目，所有成本都会读成 `$0.00`——而且是静默的：`ccusage` 只在 `daily` / `monthly` 下发这个警告，`statusline` 子命令下不发。

后台刷新识别到这个特征（今天没有任何花费，但会话明明在跑）时，会用在线价目表重试一次，并把结果记住 6 小时，所以稳定状态下每次刷新仍然只调用一次 `ccusage`。等 `ccusage` 升级补上该模型后，它会自己回到离线价目表。

设 `CC_STATUSLINE_NO_ONLINE_PRICING=1` 可关闭这次重试，让刷新严格保持离线，代价是在 `ccusage` 补上价目之前一直显示 `$0.00`。

## 兼容性说明

- 配额段依赖 Claude Code 的 `rate_limits` stdin 字段（Claude Code 2.1.x、Pro/Max 套餐）。它在一个会话的首个 API 响应之后才出现；在那之前 `5H`/`7D` 显示空条 + `(loading..)`。
- 成本/速率段解析 `ccusage statusline` 的文本输出。如果未来某个 `ccusage` 版本改了格式，这两段可能需要更新；配额段不受影响。
- API-key（按量付费）用量不会有 `rate_limits`，所以 `5H`/`7D` 会一直停在 `(loading..)` 空条状态——没有订阅配额可显示。

## 致谢

成本与消耗速率数据来自 ryoppippi 的 [`ccusage`](https://github.com/ryoppippi/ccusage)。真彩色渐变进度条移植自 [AwesomeJun/CC-statusline](https://github.com/AwesomeJun/CC-statusline)。本项目把它们和官方配额数据组合成紧凑的两行。

## 许可

[MIT](./LICENSE)
