<div align="center">

<img src="assets/logo.svg" width="200" alt="Hermit Agent logo"/>

# Hermit Agent · 寄居蟹 Agent

**A Telegram-connected Claude Code agent. Borrow the shell, bring your own body.**

**寄居在 Claude Code 上的 Telegram agent。借壳安家,带你自己的身体。**

[English](#english) · [中文](#中文)

</div>

---

## English

Hermit Agent productizes a personal-assistant stack built around Claude Code, Telegram, and a small set of markdown files that give the agent persistent identity and memory across restarts. Once set up, every message you send your Telegram bot reaches a long-lived Claude Code session running in a `tmux` pane on your Mac — and every response comes back through Telegram.

The agent is the hermit crab. Claude Code is the shell. Your files are the body.

### Quickstart

Prereqs (all on macOS):

- [Claude Code](https://docs.claude.com/claude-code) installed and logged in
- Node.js ≥ 18
- `tmux` — `brew install tmux`
- `bun` — `curl -fsSL https://bun.sh/install | bash`
- `jq` — `brew install jq`

One command:

```bash
npx create-hermit-agent my-agent
```

The CLI will ask for a Telegram bot token (get one from [@BotFather](https://t.me/BotFather)) and your user ID (get it from [@userinfobot](https://t.me/userinfobot)). It then:

1. Copies the template to `./my-agent/`
2. Registers the telegram plugin at project scope (`claude plugin install -s project`)
3. Writes the bot token to `~/.claude/channels/telegram-my-agent/.env` (mode 600)
4. Runs `npm install` for Playwright (used by the browser automation skill)

Then:

```bash
cd my-agent
./start.sh
```

…and DM your bot on Telegram. The agent replies.

### What it gives you

The same toolkit the author's personal assistant (`asst`) uses — packaged so anyone with a bot token can have one.

**1. Memory & Persona.**
The agent boots every session by reading `SOUL.md` (core behavior), `IDENTITY.md` (name + role), `USER.md` (who it's helping), `AGENTS.md` (workspace rules), `TOOLS.md` (local configs), and `MEMORY.md` (curated long-term). Daily logs live in `memory/YYYY-MM-DD.md`. Restart the session and it still knows who it is, who you are, and what yesterday was about.

**2. Telegram interaction.**
First-class reply / react / edit-message / attachment download. Group-chat etiquette built in (stays quiet unless @mentioned). Prefix any message with `!!` to inject a Claude Code CLI command — `!!compact` trims context, `!!model opus` switches model, `!!status` shows status. Natural-language aliases work too: "compact the context" does the same thing. A `Stop` hook blocks turn-end if a Telegram DM arrived but no reply was sent — silent failure is impossible.

**3. Lifecycle management.**
`./start.sh` boots the agent in a named `tmux` session. `./restart.sh` respawns the pane without losing the Telegram channel, with a plugin-alive check that retries once if the `bun` subprocess didn't come up. Context-tier alerts push a Telegram notification every time the session crosses 100k/200k/400k/600k/800k/950k tokens. Tool-activity alerts ping every 1st + 5th tool call so you can see the agent's heartbeat.

**4. Automation.**
Skills include `restart`, `cron`, `brave-search`, `browser-automation`, and `provision-agent` (spawn another hermit via `npx create-hermit-agent`). Browser automation uses a self-managed Chrome instance with CDP — explore with `mcp__playwright-browser__*`, record replayable scripts into `scripts/browser/`, run them via `browser-lock.sh` with mutex + watchdog + stealth-init. Cron tasks read the workspace markdown before executing and report back via Telegram.

**5. Safety.**
Every image goes through `scripts/safe-image.sh` before `Read`, resizing to ≤1800px long-edge — an oversized image otherwise silently kills the session. Hard rules against `find /`. No markdown in Telegram replies. No tokens in git-tracked files (`.claude/settings.local.json` is gitignored, `.env` is mode 600 outside the repo, `access.json` is plugin-owned). Multi-agent status reports (opt-in LaunchAgent) digest every agent's state every 10 min and ping you when anything's stuck.

### Architecture

```
┌──────────────────── Your Mac ──────────────────────┐        ┌── Telegram ──┐
│                                                     │        │              │
│   tmux session  claude-<agent>                      │        │  Bot API     │
│   ┌───────────────────────────────────────────┐    │        │  long-poll   │
│   │  claude CLI  (the borrowed shell)          │    │        │              │
│   │  ┌─────────────┐  ┌────────────────────┐  │    │        │              │
│   │  │ Persona     │  │ Skills             │  │    │        │              │
│   │  │ SOUL.md …   │  │ restart · cron ·   │  │    │        │              │
│   │  │ memory/     │  │ provision-agent ·  │  │    │        │              │
│   │  └─────────────┘  │ browser · brave    │  │    │        │              │
│   │                   └────────────────────┘  │    │◄──────►│  @yourbot    │
│   │  ┌─────────────┐  ┌────────────────────┐  │    │        │              │
│   │  │ Hooks       │  │ Scripts            │  │    │        │              │
│   │  │ state …     │  │ safe-image · exec  │  │    │        │              │
│   │  │ reply-check │  │ chrome · status    │  │    │        │              │
│   │  └─────────────┘  └────────────────────┘  │    │        │              │
│   │              │                             │    │        │              │
│   │       Telegram plugin (bun server.ts)      │    │        │              │
│   └──────────────┬────────────────────────────┘    │        │              │
│                  │                                  │        │              │
│  ~/.claude/channels/telegram-<agent>/ (.env, access)│        │              │
└─────────────────────────────────────────────────────┘        └──────────────┘
```

Higher-res SVG: [assets/arch.svg](assets/arch.svg).

### Customizing your agent

Edit these files in the generated agent directory:

- **`IDENTITY.md`** — name, creature, vibe, one-line mission
- **`USER.md`** — who you are (pronouns, timezone, context)
- **`AGENTS.md`** — scroll to the `<!-- MISSION-START -->` block and describe what this agent focuses on
- **`TOOLS.md`** — the `<!-- AGENT-SPECIFIC-START -->` block is where repo links, API keys, and domain notes go
- **`HEARTBEAT.md`** — opt-in periodic check-in script (only relevant if you wire up a cron that reads it)

Don't touch `SOUL.md` unless you intend to change the agent's core disposition.

### Multi-agent setup

Run `npx create-hermit-agent` as many times as you like — each gets its own bot token, `tmux` session, and directory. If you want a "hub" agent that digests the status of all siblings, enable the LaunchAgent:

```bash
cp launchd/status-reporter.plist.tmpl \
   ~/Library/LaunchAgents/com.hermit-agent.my-agent.status-reporter.plist
launchctl load ~/Library/LaunchAgents/com.hermit-agent.my-agent.status-reporter.plist
```

Every 10 minutes it scans siblings under `../` and pushes a digest to the hub's chat: 🟢 idle · 🟨 running · 🟥 stuck · ⚫ down.

### Troubleshooting

| Problem | Fix |
|---|---|
| Agent doesn't reply | `tmux attach -t claude-<name>` and watch the session. Check `claude-agent.log` and `restart.log`. |
| Plugin subprocess missing | `./restart.sh` retries once automatically. If still failing, verify `~/.claude/channels/telegram-<name>/.env` is mode 600 and contains the token. |
| Image dimension crash | Every Read on an image MUST go through `scripts/safe-image.sh` first. If the hook didn't catch it, restart + compact. |
| "claude plugin install failed" | Ensure `claude` CLI is on PATH and you're logged in (`claude login`). |
| Context bloat | `!!compact` on Telegram, or type `/compact` at the tmux pane. |

### Credits

Hermit Agent draws lessons from three projects:

- **[Claude Code](https://docs.claude.com/claude-code)** — the CLI that hosts the agent; this project is literally a hermit crab on top of it.
- **OpenClaw** — the self-managed browser + Chrome profile pattern informed the `chrome-launcher.sh` + `browser-lock.sh` design.
- **Hermes agent** — earlier personal-assistant prototype; the SOUL/IDENTITY/USER/AGENTS/TOOLS/MEMORY file pattern grew from it.

The hermit crab is the only creature that wears a home it didn't build.

### License

MIT — see [LICENSE](LICENSE).

---

## 中文

Hermit Agent 把个人助手架构包装成一个可分发的工具。装好 Claude Code 之后,一条 `npx` 就能生成一个跑在 Mac 上、通过 Telegram 和你对话的 agent——带持久身份、记忆、skills、lifecycle 管理。

寄居蟹是 agent。Claude Code 是壳。你的文件是身体。

### 快速开始

前置依赖(macOS):

- [Claude Code](https://docs.claude.com/claude-code) 已安装并登录
- Node.js ≥ 18
- `tmux` — `brew install tmux`
- `bun` — `curl -fsSL https://bun.sh/install | bash`
- `jq` — `brew install jq`

一条命令:

```bash
npx create-hermit-agent my-agent
```

CLI 会问 Telegram bot token([@BotFather](https://t.me/BotFather) 拿)和你的 user ID([@userinfobot](https://t.me/userinfobot) 拿)。然后自动:

1. 把模板拷到 `./my-agent/`
2. project scope 注册 telegram plugin(`claude plugin install -s project`)
3. 写 bot token 到 `~/.claude/channels/telegram-my-agent/.env`(mode 600)
4. `npm install` 装 Playwright(browser-automation skill 会用)

然后:

```bash
cd my-agent
./start.sh
```

在 Telegram 给你的 bot 发消息,agent 就回了。

### 它能做什么

等价于作者个人助手(`asst`)用的那套工具链,打包好给任何有 bot token 的人用。

**1. Memory & Persona(记忆和人设)。**
每次开 session,agent 自动读 `SOUL.md`(核心行为)、`IDENTITY.md`(名字 + 身份)、`USER.md`(对话的人)、`AGENTS.md`(工作区规则)、`TOOLS.md`(本地配置)、`MEMORY.md`(长期记忆)。日常日志在 `memory/YYYY-MM-DD.md`。重启之后它还知道自己是谁、你是谁、昨天在干嘛。

**2. Telegram 互动。**
原生 reply / react / edit-message / 附件下载。群聊礼仪内置(除非被 @ 否则沉默)。消息以 `!!` 开头就注入 Claude Code CLI 命令——`!!compact` 压缩上下文,`!!model opus` 切模型,`!!status` 看状态。中文自然语言也 work:"压缩上下文"等同于 `/compact`。`Stop` hook 会在检测到 Telegram DM 但没发 reply 时阻止 turn 结束——静默失败不可能发生。

**3. Lifecycle 管理。**
`./start.sh` 在命名的 `tmux` session 里启动。`./restart.sh` 用 respawn-pane 重启但保持 Telegram channel 不断,会检查 plugin subprocess,如果没起来重试一次。Context 跨越 100k/200k/400k/600k/800k/950k tier 时自动推送 Telegram 告警。Tool-activity 每第 1、5、10、15 次 tool 调用推一次心跳。

**4. Automation 自动化。**
内置 skills:`restart`、`cron`、`brave-search`、`browser-automation`、`provision-agent`(调 `npx create-hermit-agent` 生成新 hermit)。浏览器自动化走自管 Chrome + CDP——`mcp__playwright-browser__*` 探索,录成 `scripts/browser/` 里的回放脚本,`browser-lock.sh` 带锁 + watchdog + stealth 跑。Cron 任务触发前先读工作区 markdown,跑完通过 Telegram 汇报。

**5. Safety 安全。**
所有图片在 `Read` 之前必须过 `scripts/safe-image.sh` 缩到 ≤1800px 长边——超大图会静默 kill 掉 session。禁止 `find /`。Telegram reply 禁用 markdown。Tokens 不进 git(`.claude/settings.local.json` 已 gitignore,`.env` 在仓库外且 mode 600,`access.json` 由 plugin 管)。多 agent 状态数字汇报(可选 LaunchAgent)每 10 分钟扫所有 agent 状态,卡住的 push 提醒。

### 架构

```
┌──────────────────── 你的 Mac ──────────────────────┐        ┌── Telegram ──┐
│                                                     │        │              │
│   tmux session  claude-<agent>                      │        │  Bot API     │
│   ┌───────────────────────────────────────────┐    │        │  long-poll   │
│   │  claude CLI  (借来的壳)                   │    │        │              │
│   │  ┌─────────────┐  ┌────────────────────┐  │    │        │              │
│   │  │ Persona     │  │ Skills             │  │    │        │              │
│   │  │ SOUL.md …   │  │ restart · cron ·   │  │    │        │              │
│   │  │ memory/     │  │ provision-agent ·  │  │    │        │              │
│   │  └─────────────┘  │ browser · brave    │  │    │        │              │
│   │                   └────────────────────┘  │    │◄──────►│  @yourbot    │
│   │  ┌─────────────┐  ┌────────────────────┐  │    │        │              │
│   │  │ Hooks       │  │ Scripts            │  │    │        │              │
│   │  │ state …     │  │ safe-image · exec  │  │    │        │              │
│   │  │ reply-check │  │ chrome · status    │  │    │        │              │
│   │  └─────────────┘  └────────────────────┘  │    │        │              │
│   │              │                             │    │        │              │
│   │       Telegram 插件 (bun server.ts)        │    │        │              │
│   └──────────────┬────────────────────────────┘    │        │              │
│                  │                                  │        │              │
│  ~/.claude/channels/telegram-<agent>/ (.env, access)│        │              │
└─────────────────────────────────────────────────────┘        └──────────────┘
```

高清 SVG:[assets/arch.svg](assets/arch.svg)

### 定制你的 agent

生成的 agent 目录里改这些:

- **`IDENTITY.md`** — 名字、creature(身份描述)、vibe、一句话使命
- **`USER.md`** — 你是谁(pronouns、时区、偏好)
- **`AGENTS.md`** — 往下找 `<!-- MISSION-START -->` 块,写这个 agent 的具体 mission
- **`TOOLS.md`** — `<!-- AGENT-SPECIFIC-START -->` 块里写 repo 链接、API key、领域知识
- **`HEARTBEAT.md`** — 可选的周期性 check-in 脚本(只在你接了 cron 读它时才有用)

除非你打算改 agent 的核心气质,否则不要动 `SOUL.md`。

### 多 agent 方案

`npx create-hermit-agent` 想跑几次跑几次——每个 agent 有独立的 bot token、tmux session、目录。想要一个"hub"agent 统一监控所有 siblings,启用 LaunchAgent:

```bash
cp launchd/status-reporter.plist.tmpl \
   ~/Library/LaunchAgents/com.hermit-agent.my-agent.status-reporter.plist
launchctl load ~/Library/LaunchAgents/com.hermit-agent.my-agent.status-reporter.plist
```

每 10 分钟扫 `../` 下所有 siblings,把状态 digest push 到 hub 的 chat:🟢 idle · 🟨 running · 🟥 stuck · ⚫ down。

### 踩坑排查

| 问题 | 解决 |
|---|---|
| Agent 不回复 | `tmux attach -t claude-<name>` 看现场。检查 `claude-agent.log` 和 `restart.log`。|
| Plugin subprocess 没起来 | `./restart.sh` 会自动重试一次。还不行就看 `~/.claude/channels/telegram-<name>/.env` 是不是 mode 600 且内容对。|
| 图片尺寸把 session 搞挂了 | 所有 Read image 必须先过 `scripts/safe-image.sh`。没过 hook 的话重启 + compact。|
| "claude plugin install failed" | 确认 `claude` CLI 在 PATH 上且已登录(`claude login`)。|
| Context 爆表 | Telegram 发 `!!compact`,或在 tmux pane 里打 `/compact`。|

### 致谢

Hermit Agent 吸取了三个项目的经验:

- **[Claude Code](https://docs.claude.com/claude-code)** — 承载 agent 的 CLI;本项目字面意义上就是寄居在它上面的寄居蟹。
- **OpenClaw** — 自管浏览器 + Chrome profile 的模式启发了 `chrome-launcher.sh` + `browser-lock.sh`。
- **Hermes agent** — 更早的个人助手原型;SOUL/IDENTITY/USER/AGENTS/TOOLS/MEMORY 的文件组织方式是从它长出来的。

寄居蟹是唯一一个穿着自己没盖的家的生物。

### License

MIT — 见 [LICENSE](LICENSE)。
