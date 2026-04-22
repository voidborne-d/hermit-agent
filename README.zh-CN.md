<div align="center">

<img src="assets/logo.svg" width="200" alt="Hermit Agent logo"/>

# Hermit Agent · 寄居蟹 Agent

**macOS 原生的 Telegram 助手框架。一条命令开箱 Claude Code agent——自带人设、长期记忆、Telegram I/O、定时任务、浏览器自动化。**

[English](README.md) · [中文](README.zh-CN.md)

[![npm](https://img.shields.io/npm/v/create-hermit-agent?style=flat-square)](https://www.npmjs.com/package/create-hermit-agent)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)](LICENSE)
[![Node 18+](https://img.shields.io/badge/node-18%2B-green?style=flat-square)](https://nodejs.org)
[![macOS](https://img.shields.io/badge/platform-macOS-blue?style=flat-square)](https://www.apple.com/macos/)
[![Claude Code](https://img.shields.io/badge/Claude_Code-required-orange?style=flat-square)](https://docs.claude.com/claude-code)

</div>

---

## 三大基础

Hermit Agent 融合了三个项目的经验，仓库里没有一行是凭空写的。

| 借鉴自 | 带来了什么 |
|---|---|
| **[Claude Code](https://docs.claude.com/claude-code)** | 运行时。每个 agent 字面意义上就跑在 `claude --dangerously-skip-permissions` 里。Plugin、MCP、Tool、Hook 全部原生。 |
| **OpenClaw** | 自管浏览器模式。塑形了 `scripts/chrome-launcher.sh`、`scripts/browser-lock.sh`，每个 agent 一个独立 Chrome profile 配 CDP 复用，外加 stealth 包装的 Playwright 套路。 |
| **Hermas Agent** | 自主进化模式和记忆模块设计。`SOUL.md` + `MEMORY.md` + 每日 `memory/YYYY-MM-DD.md` 日志 + 做梦式知识固化，全都继承自它。 |

Claude Code 提供壳，Hermit 提供身体。

---

## 30 秒上手

```bash
# 前置：Claude Code 已装并登录，Node 18+，brew install tmux jq，bun 已装
npx create-hermit-agent
cd asst && ./start.sh
```

打开 Telegram，DM 你刚在 @BotFather 注册的 bot。第一条 DM 会触发自我介绍——之后 agent 就不再骚扰你了。

> **你：** 下午 3 点提醒我给妈妈打电话  
> **asst：** 已安排，3 点 ping 你。

---

## 功能一览

| 能力 | 细节 |
|---|---|
| **人设** | 每次启动都会读 `SOUL / IDENTITY / USER / AGENTS / TOOLS / MEMORY.md`。改文件即改 agent。 |
| **长期记忆** | 每日日志写到 `memory/YYYY-MM-DD.md`，长期策展在 `MEMORY.md`，重启跨越不丢。 |
| **Telegram I/O** | 走 `@claude-plugins-official/telegram` 原生 reply / react / edit / 下载附件。群聊礼仪内置。`!!` 前缀把消息路由到 Claude Code 命令（`!!compact`、`!!model`、`!!status`）。 |
| **Lifecycle** | `start.sh` + `restart.sh` 把 agent 包在命名的 `tmux` session 里。Context 跨 100k / 200k / … / 950k 阈值、以及工具调用密集时主动 push 告警。 |
| **定时任务** | 三层——session-only 的 `cron` skill、跨重启的 `HEARTBEAT.md`、OS 持久的 `launchd` plist。 |
| **浏览器** | 独立 Chrome profile + CDP + Playwright + stealth-init 反检测。 |
| **多 Agent** | `provision-agent` skill 在 `../<name>/` 生成 sibling 并给它独立 bot token。可选每 10 分钟状态 digest 的 LaunchAgent。 |
| **安全** | 图片 Read 前强制过 `safe-image.sh` 缩图（长边 ≤ 1800px）。Token 存在 mode 600 的 repo 外文件。Stop hook 阻止“收到 DM 没回就结束 turn”。PreToolUse hook 把 agent 出站 Telegram reply 里的 markdown 语法洗掉，避免 `**粗体**` / `# 标题` 直接作为字面量字符到用户对话框里。 |

---

## 架构

```
┌────────────── 你的 Mac ──────────────┐       ┌─ Telegram ─┐
│                                       │       │            │
│  tmux session   claude-asst           │       │  Bot API   │
│  ┌───────────────────────────────┐   │       │            │
│  │  claude  （借来的壳）          │   │       │            │
│  │  ┌────────┐  ┌───────────────┐ │   │       │            │
│  │  │Persona │  │ Skills + Hooks│ │   │◄─────►│ @yourbot   │
│  │  │*.md    │  │ restart · cron│ │   │       │            │
│  │  │memory/ │  │ provision ... │ │   │       │            │
│  │  └────────┘  └───────────────┘ │   │       │            │
│  │     Telegram plugin (bun)      │   │       │            │
│  └────────────────────────────────┘   │       │            │
│                                       │       │            │
│  ~/.claude/channels/telegram-asst/    │       │            │
│    （token 存这里，不进 repo）         │       │            │
└───────────────────────────────────────┘       └────────────┘
```

高清 SVG：[assets/arch.svg](assets/arch.svg)。

---

## 安装

前置依赖（macOS）：

- [Claude Code](https://docs.claude.com/claude-code)——已装并登录（`claude login`）
- Node ≥ 18
- `brew install tmux jq`
- `curl -fsSL https://bun.sh/install | bash`

脚手架：

```bash
npx create-hermit-agent
```

CLI 会问你要 Telegram bot token（[@BotFather](https://t.me/BotFather)）和你自己的 Telegram user ID（[@userinfobot](https://t.me/userinfobot)），然后生成 `./asst/`，以 project scope 安装 telegram plugin，把 token 写到 mode 600 的 `~/.claude/channels/telegram-asst/.env`。

启动：

```bash
cd asst && ./start.sh
```

Agent 现在跑在一个叫 `claude-asst` 的 detached tmux session 里。DM 你的 bot 即可。

---

## 第一条消息：asst 会自我介绍

第一次 DM 时 asst 会主动发一段简短引导——怎么跟它聊、有哪些 `!!` 命令、怎么开更多 agent——然后自己删掉 `FIRST_RUN.md`，以后不再骚扰你。

---

## 开更多 agent

**不要再跑一次 `npx create-hermit-agent`**。直接告诉 asst：

> 帮我新建一个叫 `github-bot` 的 agent，token `123:ABC…`，用来处理 GitHub 通知。

asst 的 `provision-agent` skill 会在 `../github-bot/` 生成 sibling、装它自己的 plugin、在 `claude-github-bot` tmux session 里启动，最后把新 bot 的 `@handle` 回给你。

Agent 之间完全独立：独立 bot token、独立记忆、独立目录。

---

## 自定义

在 agent 目录里改这几个：

| 文件 | 写什么 |
|---|---|
| `IDENTITY.md` | 名字、vibe、一句话使命 |
| `USER.md` | 你自己（pronouns、时区、备注） |
| `AGENTS.md` | `<!-- MISSION-START -->` 块——这个 agent 的具体任务 |
| `TOOLS.md` | `<!-- AGENT-SPECIFIC-START -->` 块——API key、repo 链接、领域知识 |

`SOUL.md` 是核心气质——除非真想换人格否则别碰。

---

## 定时任务

直接告诉 agent 要什么：

> 每 30 分钟扫一下 `memory/today.md`，标记 urgent 的条目。

asst 的 `cron` skill 会处理。需要跨重启的任务，丢个 plist 进 `~/Library/LaunchAgents/`——参考 `launchd/cron-example.plist.tmpl`。

---

## 多 agent 状态汇报

CLI 在这台 Mac 上首次运行时会自动装一个 `launchd` coordinator。每 10 分钟 push 一次本机所有 hermit 的状态 digest 到 coordinator 的 Telegram：🟢 idle · 🟨 running · 🟥 stuck · ⚫ down。

- 每台 Mac 只有一个 coordinator。`create-hermit-agent` 发现已存在 `com.hermit-agent.*.status-reporter.plist` 就跳过，后续 hermit 不会各自再装一份。
- 第一个装的 agent（默认 `asst`）就是 coordinator。它的 plist 在 `~/Library/LaunchAgents/com.hermit-agent.asst.status-reporter.plist`。
- 想关：`launchctl unload ~/Library/LaunchAgents/com.hermit-agent.<coordinator>.status-reporter.plist`。
- 想换 coordinator：先 unload 老 plist 再 rm，然后从新 agent 再跑一次 `create-hermit-agent`（或手动 `cp launchd/status-reporter.plist ~/Library/LaunchAgents/com.hermit-agent.<new>.status-reporter.plist && launchctl load ...`）。

---

## 踩坑排查

| 症状 | 处理 |
|---|---|
| Agent 不回复 | `tmux attach -t claude-<name>` 看现场。也查 `restart.log`、`claude-agent.log`。 |
| Plugin subprocess 没起来 | `./restart.sh` 会自动重试一次。还不行就检查 `~/.claude/channels/telegram-<name>/.env` 是不是 mode 600 且有 token。 |
| `exceeds the dimension limit` 图片搞挂 | 所有 image Read 必须先过 `scripts/safe-image.sh`。挂了就重启 + `/compact` 恢复。 |
| `claude plugin install failed` | 确认 `claude` 在 PATH 上且已登录（`claude login`）。 |
| Context 爆 | Telegram 发 `!!compact`，或在 tmux pane 里打 `/compact`。 |
| 新 Mac 上装完 bot 一直没反应 | Claude Code 可能弹了「trust this folder」或「允许 dangerous 模式」TUI 对话框卡在启动。CLI 会自动预先 ack 这两个，但万一失败：`tmux attach -t claude-<name>` 进去回车 dismiss 掉对话框，然后 Ctrl-b d 退出。 |

---

## FAQ

**Claude Code 需不需要预装 telegram plugin？**  
不需要。`create-hermit-agent` 每次创建都会跑 `claude plugin install telegram@claude-plugins-official -s project`。首次从 marketplace 下到共享缓存 `~/.claude/plugins/cache/`，之后新 agent 只做 per-project 注册。你这边零预装。

**Linux / Windows 支持吗？**  
目前只 macOS——`launchctl`、`sips`、`tmux` 都是 macOS 形状的。PR 欢迎。

**多 agent 能共用一个 bot token 吗？**  
不行。Telegram Bot API 给每个 bot 的 update 只发给一个 listener。共用 token 会导致某个 agent 把另一个的消息“劫持”走。每个 agent 必须用 `@BotFather` 单独发的 token。

**Bot token 存在哪？**  
`~/.claude/channels/telegram-<name>/.env`（mode 600，项目外面）。也在 `.claude/settings.local.json` 里（已 gitignore）。

**第一条 DM 会触发 pairing code 吗？**  
不会。CLI 会在 `~/.claude/channels/telegram-<name>/access.json` 里把你的 user ID 预置进 allowlist，所以你自己的 DM 从第一条开始就直通。陌生人摸到 bot `@handle` 发 DM 还是会走 pairing 流程（`dmPolicy: "pairing"`），不会被静默投递进来。

**怎么干净删一个 agent？**

```bash
tmux kill-session -t claude-<name>
rm -rf <agent-folder>
rm -rf ~/.claude/channels/telegram-<name>
```

Bot 不用了顺手去 `@BotFather` revoke 掉。

---

## License

[MIT](LICENSE)。
