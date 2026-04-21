<div align="center">

<img src="assets/logo.svg" width="200" alt="Hermit Agent logo"/>

# Hermit Agent · 寄居蟹 Agent

**寄居在 Claude Code 上的 Telegram agent。借壳安家,带你自己的身体。**

**其他语言:** [English](README.md) · [中文](README.zh-CN.md)

</div>

---

Hermit Agent 把个人助手架构包装成一个可分发的工具。装好 Claude Code 之后,一条 `npx` 就能生成一个跑在 Mac 上、通过 Telegram 和你对话的 agent——带持久身份、记忆、skills、lifecycle 管理。

寄居蟹是 agent。Claude Code 是壳。你的文件是身体。

## 快速开始

前置依赖(macOS):

- [Claude Code](https://docs.claude.com/claude-code) 已安装并登录
- Node.js ≥ 18
- `tmux` — `brew install tmux`
- `bun` — `curl -fsSL https://bun.sh/install | bash`
- `jq` — `brew install jq`

引导你的**第一个** agent(hub):

```bash
npx create-hermit-agent my-hub
```

CLI 会问 Telegram bot token([@BotFather](https://t.me/BotFather) 拿)和你的 user ID([@userinfobot](https://t.me/userinfobot) 拿)。然后自动:

1. 把模板拷到 `./my-hub/`
2. project scope 注册 telegram plugin(`claude plugin install -s project`)
3. 写 bot token 到 `~/.claude/channels/telegram-my-hub/.env`(mode 600)
4. `npm install` 装 Playwright(browser-automation skill 会用)

然后:

```bash
cd my-hub
./start.sh
```

在 Telegram 给你的 bot 发消息,agent 就回了。

## 多 agent:让 hub 分发 siblings

装好第一个 hermit 之后,**不要再跑 `npx create-hermit-agent`**。通过 Telegram 告诉你的 hub agent:

> "帮我创建一个叫 `github-bot` 的新 hermit,token 是 `123456:ABC…`,用来处理我的 GitHub 通知。"

Hub 的 `provision-agent` skill 会处理剩下的事——校验 bot token、在同级目录生成新 agent、装 telegram plugin、写 STATE_DIR、起 tmux session、回你新 bot 的 `@username`。

这就是多 agent 的正确玩法:一个 hub,N 个子,全通过对话管理。CLI 只碰一次。

## 它能做什么

等价于作者个人助手用的那套工具链,打包好给任何有 bot token 的人用。

**1. Memory & Persona(记忆和人设)。**
每次开 session,agent 自动读 `SOUL.md`(核心行为)、`IDENTITY.md`(名字 + 身份)、`USER.md`(对话的人)、`AGENTS.md`(工作区规则)、`TOOLS.md`(本地配置)、`MEMORY.md`(长期记忆)。日常日志在 `memory/YYYY-MM-DD.md`。重启之后它还知道自己是谁、你是谁、昨天在干嘛。

**2. Telegram 互动。**
原生 reply / react / edit-message / 附件下载。群聊礼仪内置(除非被 @ 否则沉默)。消息以 `!!` 开头就注入 Claude Code CLI 命令——`!!compact` 压缩上下文,`!!model opus` 切模型,`!!status` 看状态。中文自然语言也 work:"压缩上下文"等同于 `/compact`。`Stop` hook 会在检测到 Telegram DM 但没发 reply 时阻止 turn 结束——静默失败不可能发生。

**3. Lifecycle 管理。**
`./start.sh` 在命名的 `tmux` session 里启动。`./restart.sh` 用 respawn-pane 重启但保持 Telegram channel 不断,会检查 plugin subprocess,如果没起来重试一次。Context 跨越 100k/200k/400k/600k/800k/950k tier 时自动推送 Telegram 告警。Tool-activity 每第 1、5、10、15 次 tool 调用推一次心跳。

**4. Automation 自动化。**
内置 skills:`restart`、`cron`、`brave-search`、`browser-automation`、`provision-agent`(hub 生成新 hermit)。浏览器自动化走自管 Chrome + CDP——`mcp__playwright-browser__*` 探索,录成 `scripts/browser/` 里的回放脚本,`browser-lock.sh` 带锁 + watchdog + stealth 跑。Cron 任务触发前先读工作区 markdown,跑完通过 Telegram 汇报。

**5. Safety 安全。**
所有图片在 `Read` 之前必须过 `scripts/safe-image.sh` 缩到 ≤1800px 长边——超大图会静默 kill 掉 session。禁止 `find /`。Telegram reply 禁用 markdown。Tokens 不进 git(`.claude/settings.local.json` 已 gitignore,`.env` 在仓库外且 mode 600,`access.json` 由 plugin 管)。多 agent 状态数字汇报(可选 LaunchAgent)每 10 分钟扫所有 agent 状态,卡住的 push 提醒。

## 架构

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

## 定制你的 agent

生成的 agent 目录里改这些:

- **`IDENTITY.md`** — 名字、creature(身份描述)、vibe、一句话使命
- **`USER.md`** — 你是谁(pronouns、时区、偏好)
- **`AGENTS.md`** — 往下找 `<!-- MISSION-START -->` 块,写这个 agent 的具体 mission
- **`TOOLS.md`** — `<!-- AGENT-SPECIFIC-START -->` 块里写 repo 链接、API key、领域知识
- **`HEARTBEAT.md`** — 可选的周期性 check-in 脚本(只在你接了 cron 读它时才有用)

除非你打算改 agent 的核心气质,否则不要动 `SOUL.md`。

## Hub 状态数字汇报

跑多个 hermit 时,想让 hub 在某个子 agent 卡住时提醒你,启用模板里带的 LaunchAgent:

```bash
cp launchd/status-reporter.plist.tmpl \
   ~/Library/LaunchAgents/com.hermit-agent.my-hub.status-reporter.plist
launchctl load ~/Library/LaunchAgents/com.hermit-agent.my-hub.status-reporter.plist
```

每 10 分钟扫父目录下所有 siblings,把状态 digest push 到 hub 的 chat:🟢 idle · 🟨 running · 🟥 stuck · ⚫ down。**每台机器只在一个 agent 上装**——就是 hub。

## 踩坑排查

| 问题 | 解决 |
|---|---|
| Agent 不回复 | `tmux attach -t claude-<name>` 看现场。检查 `claude-agent.log` 和 `restart.log`。|
| Plugin subprocess 没起来 | `./restart.sh` 会自动重试一次。还不行就看 `~/.claude/channels/telegram-<name>/.env` 是不是 mode 600 且内容对。|
| 图片尺寸把 session 搞挂了 | 所有 Read image 必须先过 `scripts/safe-image.sh`。没过 hook 的话重启 + compact。|
| "claude plugin install failed" | 确认 `claude` CLI 在 PATH 上且已登录(`claude login`)。|
| Context 爆表 | Telegram 发 `!!compact`,或在 tmux pane 里打 `/compact`。|

## 致谢

Hermit Agent 吸取了三个项目的经验:

- **[Claude Code](https://docs.claude.com/claude-code)** — 承载 agent 的 CLI;本项目字面意义上就是寄居在它上面的寄居蟹。
- **OpenClaw** — 自管浏览器 + Chrome profile 的模式启发了 `chrome-launcher.sh` + `browser-lock.sh`。
- **Hermes agent** — 更早的个人助手原型;SOUL/IDENTITY/USER/AGENTS/TOOLS/MEMORY 的文件组织方式是从它长出来的。

寄居蟹是唯一一个穿着自己没盖的家的生物。

## License

MIT — 见 [LICENSE](LICENSE)。
