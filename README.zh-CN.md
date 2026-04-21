<div align="center">

<img src="assets/logo.svg" width="200" alt="Hermit Agent logo"/>

# Hermit Agent · 寄居蟹 Agent

**寄居在 Claude Code 上的 Telegram agent。借壳安家,带你自己的身体。**

[English](README.md) · [中文](README.zh-CN.md)

</div>

---

Hermit Agent 是一个跑在 `tmux` 里的长 session Claude Code 实例,接上你的 Telegram bot,靠一组 markdown 文件维持跨重启的身份和记忆。寄居蟹是 agent,Claude Code 是壳,你的文件是身体。

## 快速开始

前置依赖(macOS): [Claude Code](https://docs.claude.com/claude-code)、Node 18+、`brew install tmux jq`、`curl -fsSL https://bun.sh/install | bash`。

一条命令起 hub agent:

```bash
npx create-hermit-agent
```

不传名字也行,默认叫 `asst`。CLI 会问你要 Telegram bot token([@BotFather](https://t.me/BotFather))和你的 user ID([@userinfobot](https://t.me/userinfobot)),然后 scaffold、project scope 注册 telegram plugin、把 bot token 写到 `~/.claude/channels/telegram-<name>/.env`。

然后:

```bash
cd asst && ./start.sh
```

给 bot 发第一条消息,hub 会主动引导——怎么创建更多 agent、`!!` 命令 sigil、怎么改 persona。

> **问:Claude Code 没预装 telegram plugin 有影响吗?**  
> 没有。CLI 每次 create 都跑 `claude plugin install -s project`。首次从 marketplace 下到共享缓存 `~/.claude/plugins/cache/`,之后新 agent 只做 per-project 注册。你这边完全不用预装。

## 多 agent:hub 分发 siblings

`npx create-hermit-agent` 只跑**一次**。以后的 agent 都通过 Telegram 告诉 hub:

> "帮我新建一个叫 `github-bot` 的 hermit,token `123:ABC…`,用来处理 GitHub 通知。"

Hub 的 `provision-agent` skill 会在 `../github-bot/` 生成新 agent、装 plugin、起它自己的 tmux session,回你新 bot 的 `@handle`。

## 有哪些能力

- **Memory & Persona** — `SOUL · IDENTITY · USER · AGENTS · TOOLS · MEMORY.md` + `memory/YYYY-MM-DD.md`。重启之后还知道自己是谁。
- **Telegram 互动** — reply / react / edit / 下载附件。`!!compact`、`!!model opus`、`!!status` 注入 CLI 命令。群聊礼仪内置。Stop hook 在 DM 没回复时阻止 turn 结束。
- **Lifecycle** — `./start.sh` / `./restart.sh`(tmux 基础,plugin-alive 检查 + 自动重试)。Context 跨 100k/200k/…/950k tier 告警。Tool-activity 第 1 + 5 次推心跳。
- **Automation** — skills:`restart`、`cron`、`brave-search`、`browser-automation`、`provision-agent`。自管 Chrome + Playwright CDP(探索 → 录制 → `browser-lock.sh` 回放)。
- **Safety** — 图片 Read 前必走 `safe-image.sh`。禁止 `find /`。Token 在仓库外 mode-600 `.env`。可选 LaunchAgent 汇报全 agent 状态。

## 架构

```
┌──────────────────── 你的 Mac ──────────────────────┐        ┌── Telegram ──┐
│   tmux session  claude-<agent>                      │        │  Bot API     │
│   ┌───────────────────────────────────────────┐    │        │  long-poll   │
│   │  claude CLI  (借来的壳)                   │    │        │              │
│   │  ┌──────────┐  ┌─────────────────────┐   │    │        │              │
│   │  │ Persona  │  │ Skills + Hooks      │   │    │◄──────►│  @yourbot    │
│   │  │ *.md     │  │ restart · cron ·    │   │    │        │              │
│   │  │ memory/  │  │ provision · browser │   │    │        │              │
│   │  └──────────┘  └─────────────────────┘   │    │        │              │
│   │        Telegram 插件 (bun server.ts)      │    │        │              │
│   └──────────────┬───────────────────────────┘    │        │              │
│                  │                                  │        │              │
│  ~/.claude/channels/telegram-<agent>/ (.env)        │        │              │
└─────────────────────────────────────────────────────┘        └──────────────┘
```

高清 SVG:[assets/arch.svg](assets/arch.svg)

## 定制

在生成的 agent 目录里改:

- **`IDENTITY.md`** — 名字、vibe、mission。
- **`USER.md`** — 你是谁。
- **`AGENTS.md`** — 找 `<!-- MISSION-START -->` 填。
- **`TOOLS.md`** — 找 `<!-- AGENT-SPECIFIC-START -->` 填 repo 链接、API key、领域知识。

想改核心气质才碰 `SOUL.md`。

## 定时任务

三层。按"任务要活多久"选。

| 层 | 存活? | 适合 |
|---|---|---|
| `cron` skill(`CronCreate`) | ❌ session-only | 一次性提醒、探针 |
| `HEARTBEAT.md` | ✅ 下次醒 | 要上下文的懒检查 |
| LaunchAgent / `crontab` | ✅ OS 级 | 监控、漏不得的任务 |

### 1. Session-scope — `cron` skill

告诉 agent:

> "每 30 分钟扫一下 `memory/today.md`,标记 urgent 的条目。"

Skill 产生 `CronCreate` 调用,bootstrap prompt 先读 persona 文件,执行任务,记到当天 daily memory,再通过 Telegram 汇报。`durable: true` 在当前 harness 是空操作——任务重启就死。

### 2. HEARTBEAT.md

需要 Claude 推理又要跨重启的检查:用 LaunchAgent 每 N 分钟往 tmux pane 注入 `"Heartbeat check."`。Agent 每次心跳读 `HEARTBEAT.md` 决定做什么。"做啥"在 markdown 里(agent 可改),"啥时候"在 OS 层(稳)。

### 3. LaunchAgent plist(持久)

macOS 的 `crontab -e` 可能因为没授 Full Disk Access 悄悄卡住。用 LaunchAgent 绕开。模板带 `launchd/cron-example.plist.tmpl`:

```bash
AGENT=$(basename "$PWD")
cp launchd/cron-example.plist.tmpl \
   ~/Library/LaunchAgents/com.hermit-agent.${AGENT}.<TASK>.plist
# 改 Label、ProgramArguments、StartInterval
launchctl load ~/Library/LaunchAgents/com.hermit-agent.${AGENT}.<TASK>.plist
```

确认在跑:`launchctl list | grep hermit-agent`。卸载:`launchctl unload <path>`。

### 从 cron 给 Telegram 发消息

持久任务可以复用 hub 的凭据:

```bash
token=$(jq -r '.env.TELEGRAM_BOT_TOKEN' .claude/settings.local.json)
chat_id=$(jq -r '.env.TELEGRAM_CHAT_ID' .claude/settings.local.json)
curl -sS -X POST "https://api.telegram.org/bot${token}/sendMessage" \
  -d "chat_id=${chat_id}" --data-urlencode "text=task fired"
```

`scripts/multi-agent-status-report.sh` 就是现成的例子。

## Hub 状态汇报(可选)

一台 Mac 只在一个 hermit 上装这个——就是 hub。它的 LaunchAgent 每 10 分钟 push 全 agent 状态 digest(🟢 idle · 🟨 running · 🟥 stuck · ⚫ down):

```bash
cp launchd/status-reporter.plist.tmpl \
   ~/Library/LaunchAgents/com.hermit-agent.<agent>.status-reporter.plist
launchctl load ~/Library/LaunchAgents/com.hermit-agent.<agent>.status-reporter.plist
```

## 踩坑排查

| 问题 | 解决 |
|---|---|
| Agent 不回复 | `tmux attach -t claude-<name>` 看。查 `restart.log` 和 `claude-agent.log`。|
| Plugin subprocess 没起来 | `./restart.sh` 会自动重试一次。还不行检查 `~/.claude/channels/telegram-<name>/.env` 是不是 mode 600 且有 token。|
| 图片尺寸把 session 搞挂 | 所有 Read image 必先走 `scripts/safe-image.sh`。没过就重启 + compact。|
| `claude plugin install failed` | 确认 `claude` 在 PATH 上且已登录(`claude login`)。|
| Context 爆 | Telegram 发 `!!compact`,或在 tmux pane 里 `/compact`。|

## 致谢

Hermit Agent 借鉴三个项目:

- **[Claude Code](https://docs.claude.com/claude-code)** — 承载 agent 的 CLI;本项目字面意义上寄居在它上面。
- **OpenClaw** — 自管浏览器 + Chrome profile 模式启发了 `chrome-launcher.sh` + `browser-lock.sh`。
- **Hermas agent** — 更早的个人助手原型;hermit 的自主进化模式和记忆模块设计从这里来。

## License

[MIT](LICENSE).
