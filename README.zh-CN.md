<div align="center">

<img src="assets/logo.svg" width="200" alt="Hermit Agent logo"/>

# Hermit Agent · 寄居蟹 Agent

**跑在你 Mac 上的 Telegram 助手,底层是 Claude Code。借壳安家,带你自己的身体。**

[English](README.md) · [中文](README.zh-CN.md)

</div>

---

## 这是什么?

一个**跑在你 Mac 上**、**用 Telegram 跟你聊**的 AI 助手,底层是 Claude Code。它有一个你可以自己改的性格、能跨重启记住聊过的事、能上网、能定时干活、也能帮你开更多助手。

比喻:AI agent 是寄居蟹,Claude Code 是借来的壳,agent 目录里的那堆文件是身体——改文件就是改这个 agent。

## 安装

前置依赖(macOS):

- [Claude Code](https://docs.claude.com/claude-code) 已装且已登录
- Node 18+
- `brew install tmux jq`
- `curl -fsSL https://bun.sh/install | bash`

一条命令:

```bash
npx create-hermit-agent
```

CLI 会问你要 Telegram bot token([@BotFather](https://t.me/BotFather))和你的 Telegram user ID([@userinfobot](https://t.me/userinfobot)),然后在当前目录生成一个叫 `asst/` 的文件夹,装好 plugin,把 token 写到 mode 600 的受保护文件里。

启动:

```bash
cd asst && ./start.sh
```

打开 Telegram,找到你刚创的 bot,发消息。

## 第一条消息:asst 会主动自我介绍

默认的 agent 叫 **asst**。第一次 DM 的时候它会主动发一段简短引导:怎么和它聊、有哪些命令、怎么开更多 agent。发完就把自己的 `FIRST_RUN.md` 删了,不会再骚扰你。

之后就是自然聊天:

> 你: 下午 3 点提醒我给妈妈打电话  
> asst: 已安排,3 点 ping 你。

## 开更多 agent

不要再跑第二次 `npx create-hermit-agent`。直接告诉 **asst**:

> "帮我新建一个叫 `github-bot` 的 agent,token `123:ABC…`,用来帮我处理 GitHub 通知。"

asst 会在 `../github-bot/` 生成一个 sibling agent、装 plugin、起它自己的 tmux session,把新 bot 的 `@handle` 告诉你。DM 那个新 bot 就能唤醒。

想开几个开几个,相互独立:独立 bot token、独立记忆、独立文件夹。

## 每个 agent 能做什么

- **记忆和人设。** 每次开 session 自动读 `SOUL.md / IDENTITY.md / USER.md / AGENTS.md / TOOLS.md / MEMORY.md` 把自己"启动"起来。日常日志写到 `memory/YYYY-MM-DD.md`。重启后还知道自己是谁。
- **Telegram 能力。** 原生 reply / react / edit / 下载附件。群聊礼仪内置。`!!compact` / `!!model opus` / `!!status` 直接注入 Claude Code 命令。Stop hook 会在 DM 来了但没回的时候拦住 turn 结束。
- **Lifecycle 管理。** `./start.sh` 在独立 `tmux` 里启动。`./restart.sh` 重启但 Telegram channel 不断。Context 跨 100k / 200k / … / 950k 阈值时 push 告警,工具调用密集时也会 push。
- **自动化。** 内置 skills:`restart`、`cron`、`brave-search`、`browser-automation`、`provision-agent`(就是"开更多 agent"那个)。浏览器自动化走独立 Chrome profile + Playwright + stealth 反检测。
- **安全。** 图片 Read 前强制过缩图(一张 4K 截图就能搞挂 session)。Token 不进 repo。多 agent 状态汇报是可选的 LaunchAgent,默认关。

## 原理

```
┌────────────── 你的 Mac ──────────────┐       ┌─ Telegram ─┐
│                                       │       │            │
│  tmux session   claude-asst           │       │  Bot API   │
│  ┌───────────────────────────────┐   │       │            │
│  │  claude  (借来的壳)            │   │       │            │
│  │  ┌────────┐  ┌───────────────┐ │   │       │            │
│  │  │Persona │  │ Skills + Hooks│ │   │◄─────►│ @yourbot   │
│  │  │*.md    │  │ restart · cron│ │   │       │            │
│  │  │memory/ │  │ provision ... │ │   │       │            │
│  │  └────────┘  └───────────────┘ │   │       │            │
│  │     Telegram plugin (bun)      │   │       │            │
│  └────────────────────────────────┘   │       │            │
│                                       │       │            │
│  ~/.claude/channels/telegram-asst/    │       │            │
│    (bot token 存这里,不进 repo)       │       │            │
└───────────────────────────────────────┘       └────────────┘
```

高清 SVG:[assets/arch.svg](assets/arch.svg)

## 定制你的 agent

在 agent 目录里改:

- **`IDENTITY.md`** — 名字、vibe、一句话使命。
- **`USER.md`** — 你是谁(pronouns、时区、备注)。
- **`AGENTS.md`** — 找 `<!-- MISSION-START -->` 块,写这个 agent 的具体任务。
- **`TOOLS.md`** — 找 `<!-- AGENT-SPECIFIC-START -->` 块,放 API key、repo 链接、领域知识。

`SOUL.md` 是核心气质,除非真想换人格否则别碰。

## 定时任务

三种方式跑周期任务,按"要活多久"选:

| 方案 | 重启后存活? | 适合 |
|---|---|---|
| `cron` skill(`CronCreate`) | ❌ session-only | 一次性提醒、探针 |
| `HEARTBEAT.md` | ✅ 下次醒 | 需要 agent 推理的懒检查 |
| LaunchAgent plist / `crontab` | ✅ OS 级 | 监控、漏不得的任务 |

### Session-only:`cron` skill

直接告诉 agent:

> "每 30 分钟扫一下 `memory/today.md`,标记 urgent 的条目。"

它会创建一个 `CronCreate` 任务,先读你的 persona 文件,再跑检查,日志记进当天 memory,最后通过 Telegram 汇报。任务在 agent 重启时死。

### HEARTBEAT.md

想要跨重启又要 Claude 推理的检查,配一个 LaunchAgent 每 N 分钟往 agent 的 tmux pane 注入 `"Heartbeat check."`。Agent 每次心跳读 `HEARTBEAT.md` 决定做啥。"做啥"在 markdown 里,"啥时候"在 OS 层。

### LaunchAgent plist(真持久)

macOS 的 `crontab -e` 可能因为没授 Full Disk Access 悄悄卡住。直接用 LaunchAgent。模板带 `launchd/cron-example.plist.tmpl`:

```bash
AGENT=$(basename "$PWD")
cp launchd/cron-example.plist.tmpl \
   ~/Library/LaunchAgents/com.hermit-agent.${AGENT}.<TASK>.plist
# 改 Label、ProgramArguments、StartInterval。
launchctl load ~/Library/LaunchAgents/com.hermit-agent.${AGENT}.<TASK>.plist
```

确认在跑:`launchctl list | grep hermit-agent`。卸载:`launchctl unload <path>`。

### 从 cron 任务给 Telegram 发消息

```bash
token=$(jq -r '.env.TELEGRAM_BOT_TOKEN' .claude/settings.local.json)
chat_id=$(jq -r '.env.TELEGRAM_CHAT_ID' .claude/settings.local.json)
curl -sS -X POST "https://api.telegram.org/bot${token}/sendMessage" \
  -d "chat_id=${chat_id}" --data-urlencode "text=任务触发"
```

`scripts/multi-agent-status-report.sh` 是现成的例子。

## 可选:多 agent 状态汇报

多 agent 场景下,让 asst 每 10 分钟 push 全 agent 状态 digest(🟢 idle · 🟨 running · 🟥 stuck · ⚫ down):

```bash
cp launchd/status-reporter.plist.tmpl \
   ~/Library/LaunchAgents/com.hermit-agent.asst.status-reporter.plist
launchctl load ~/Library/LaunchAgents/com.hermit-agent.asst.status-reporter.plist
```

每台 Mac 只在一个 agent 上装——asst 是默认选择。

## 踩坑排查

| 症状 | 处理 |
|---|---|
| Agent 不回复 | `tmux attach -t claude-<name>` 看现场。也查 `restart.log` 和 `claude-agent.log`。|
| Plugin subprocess 没起来 | `./restart.sh` 会自动重试一次。还不行就看 `~/.claude/channels/telegram-<name>/.env` 是不是 mode 600 且有 token。|
| "exceeds the dimension limit"(图片搞挂) | 所有 Read image 必须先过 `scripts/safe-image.sh`。没过就重启 + `/compact`。|
| `claude plugin install failed` | 确认 `claude` 在 PATH 上且已登录(`claude login`)。|
| Context 爆 | Telegram 发 `!!compact`,或在 tmux pane 里打 `/compact`。|

## FAQ

**Claude Code 需不需要预装 telegram plugin?**  
不需要。`create-hermit-agent` 每次 create 都跑 `claude plugin install -s project`。首次从 marketplace 下到共享缓存 `~/.claude/plugins/cache/`,之后新 agent 只做 per-project 注册。你这边零预装。

**Linux / Windows 支持吗?**  
目前只 macOS —— `launchctl`、`sips`、`tmux` 都是 macOS 形状的。Linux/Windows 支持欢迎 PR。

**多 agent 能共用一个 bot token 吗?**  
不行。Telegram Bot API 给每个 bot 的 update 只发给一个 listener。共用 token 会导致某个 agent 把另一个的消息"劫持"走。每个 agent 必须用 `@BotFather` 单独发的 token。

**Bot token 存在哪?**  
`~/.claude/channels/telegram-<name>/.env`(mode 600,项目外面)。同时也在 `.claude/settings.local.json` 里(已 gitignore)。

**怎么干净删一个 agent?**  
`tmux kill-session -t claude-<name>`,然后 `rm -rf <agent-folder>` 和 `rm -rf ~/.claude/channels/telegram-<name>`。如果 bot 不用了,上 `@BotFather` revoke 掉。

## 致谢

Hermit Agent 借鉴自三个项目:

- **[Claude Code](https://docs.claude.com/claude-code)** —— 承载 agent 的 CLI。本项目字面意义上就是寄居在它上面的寄居蟹。
- **OpenClaw** —— 自管浏览器 + Chrome profile 模式启发了 `chrome-launcher.sh` 和 `browser-lock.sh`。
- **Hermas agent** —— 更早的个人助手原型。Hermit 继承了它的自主进化模式和记忆模块设计。

## License

[MIT](LICENSE).
