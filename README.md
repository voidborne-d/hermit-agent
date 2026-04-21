<div align="center">

<img src="assets/logo.svg" width="200" alt="Hermit Agent logo"/>

# Hermit Agent

**A Telegram assistant that runs Claude Code on your Mac. Borrow the shell, bring your own body.**

[English](README.md) · [中文](README.zh-CN.md)

</div>

---

## What is this?

An AI assistant you **chat with on Telegram**, powered by **Claude Code running on your Mac**. It has a personality you can edit, remembers what you talk about between restarts, can browse the web, run scheduled tasks, and spin up more assistants when you need them.

The pattern: an AI agent (the hermit crab) lives inside Claude Code (the borrowed shell). The files in its folder are its body — edit them and you edit the agent.

## Install

Prereqs (macOS):

- [Claude Code](https://docs.claude.com/claude-code), installed and logged in
- Node 18+
- `brew install tmux jq`
- `curl -fsSL https://bun.sh/install | bash`

One command:

```bash
npx create-hermit-agent
```

It asks you for a Telegram bot token (get one from [@BotFather](https://t.me/BotFather)) and your Telegram user ID (get it from [@userinfobot](https://t.me/userinfobot)). Then it scaffolds a folder called `asst/` in your current directory, sets up the plugin, and writes your token to a protected file.

Start it:

```bash
cd asst && ./start.sh
```

Now open Telegram, find the bot you created, and send it a message.

## First message: asst introduces itself

Your default agent is called **asst**. The first time you DM it, asst sends you a short orientation: how to talk to it, what commands exist, how to spawn more agents. After that orientation, it deletes its own `FIRST_RUN.md` so it never greets you again.

From that point on, you just talk:

> You: remind me at 3pm to call mom  
> asst: scheduled — I'll ping you at 3pm today.

## Creating more agents

Don't run `npx create-hermit-agent` a second time. Instead, tell **asst**:

> "Create a new agent called `github-bot` with token `123:ABC…`. Purpose: triage my GitHub notifications."

asst scaffolds a sibling agent at `../github-bot/`, installs its plugin, starts it in its own terminal session, and tells you the new bot's `@handle`. DM the new bot to wake it.

Run as many as you want. They're independent — separate bot tokens, separate memory, separate folders.

## What each agent can do

- **Memory & personality.** Every session it reads `SOUL.md / IDENTITY.md / USER.md / AGENTS.md / TOOLS.md / MEMORY.md` to boot up its self. Writes daily logs to `memory/YYYY-MM-DD.md`. Restart and it still knows who it is.
- **Telegram.** First-class reply, reactions, edits, attachment downloads. Group-chat etiquette built in. Prefix any message with `!!` to run a Claude Code command (`!!compact`, `!!model opus`, `!!status`). A guard hook refuses to end a turn if it got a DM but didn't reply.
- **Lifecycle.** `./start.sh` starts the agent in a detached `tmux` pane. `./restart.sh` restarts without dropping Telegram. It pings you when context crosses 100k / 200k / ... / 950k tokens and when it's been running a lot of tools.
- **Automation.** Built-in skills: `restart`, `cron`, `brave-search`, `browser-automation`, `provision-agent` (the "create more agents" one). Browser automation uses a dedicated Chrome profile with Playwright and stealth anti-detection.
- **Safety.** Every image goes through a resize step before being read (a stray 4K screenshot otherwise kills the session). Tokens never touch the repo. Multi-agent status is an opt-in LaunchAgent — off by default.

## How it works

```
┌────────────── Your Mac ──────────────┐       ┌─ Telegram ─┐
│                                       │       │            │
│  tmux session   claude-asst           │       │  Bot API   │
│  ┌───────────────────────────────┐   │       │            │
│  │  claude  (the borrowed shell)  │   │       │            │
│  │  ┌────────┐  ┌───────────────┐ │   │       │            │
│  │  │Persona │  │ Skills + Hooks│ │   │◄─────►│ @yourbot   │
│  │  │*.md    │  │ restart · cron│ │   │       │            │
│  │  │memory/ │  │ provision ... │ │   │       │            │
│  │  └────────┘  └───────────────┘ │   │       │            │
│  │     Telegram plugin (bun)      │   │       │            │
│  └────────────────────────────────┘   │       │            │
│                                       │       │            │
│  ~/.claude/channels/telegram-asst/    │       │            │
│    (bot token lives here, not repo)   │       │            │
└───────────────────────────────────────┘       └────────────┘
```

Higher-res SVG: [assets/arch.svg](assets/arch.svg).

## Customize your agent

Edit these files in your agent folder:

- **`IDENTITY.md`** — name, vibe, one-line purpose.
- **`USER.md`** — who you are (pronouns, timezone, notes).
- **`AGENTS.md`** — find the `<!-- MISSION-START -->` block, fill in what this agent is for.
- **`TOOLS.md`** — find the `<!-- AGENT-SPECIFIC-START -->` block for API keys, repo links, domain notes.

`SOUL.md` holds the agent's baseline disposition. Don't edit unless you want a different personality.

## Scheduled tasks

Three ways to run periodic work, picked by how long it must survive:

| Option | Survives restart? | Use for |
|---|---|---|
| `cron` skill (`CronCreate`) | ❌ session-only | one-shot reminders, probes |
| `HEARTBEAT.md` | ✅ next wake | lazy checks that need the agent to think |
| LaunchAgent plist / `crontab` | ✅ OS-level | monitoring, must-not-miss work |

### Session-only: the `cron` skill

Just tell the agent:

> "Every 30 minutes, glance at `memory/today.md` and flag anything urgent."

It creates a `CronCreate` task that reads your persona files, runs the check, logs to today's memory, and replies via Telegram. The task dies when the agent restarts.

### HEARTBEAT.md

If you want checks that survive restarts AND use Claude's reasoning, wire a LaunchAgent that injects `"Heartbeat check."` into the agent's tmux pane every N minutes. On each heartbeat the agent reads `HEARTBEAT.md` and acts. What-to-do in markdown, when-to-fire in OS.

### LaunchAgent plist (durable)

macOS's `crontab -e` can hang silently on a Full Disk Access prompt. Use a LaunchAgent instead. The template ships an example at `launchd/cron-example.plist.tmpl`:

```bash
AGENT=$(basename "$PWD")
cp launchd/cron-example.plist.tmpl \
   ~/Library/LaunchAgents/com.hermit-agent.${AGENT}.<TASK>.plist
# Edit Label, ProgramArguments, StartInterval.
launchctl load ~/Library/LaunchAgents/com.hermit-agent.${AGENT}.<TASK>.plist
```

Verify: `launchctl list | grep hermit-agent`. Unload: `launchctl unload <path>`.

### Ping Telegram from a cron task

```bash
token=$(jq -r '.env.TELEGRAM_BOT_TOKEN' .claude/settings.local.json)
chat_id=$(jq -r '.env.TELEGRAM_CHAT_ID' .claude/settings.local.json)
curl -sS -X POST "https://api.telegram.org/bot${token}/sendMessage" \
  -d "chat_id=${chat_id}" --data-urlencode "text=task fired"
```

`scripts/multi-agent-status-report.sh` is a working example.

## Optional: multi-agent status digest

If you're running several agents, have asst push a digest of their states (🟢 idle · 🟨 running · 🟥 stuck · ⚫ down) to you every 10 minutes:

```bash
cp launchd/status-reporter.plist.tmpl \
   ~/Library/LaunchAgents/com.hermit-agent.asst.status-reporter.plist
launchctl load ~/Library/LaunchAgents/com.hermit-agent.asst.status-reporter.plist
```

Install on one agent per machine — asst is the natural choice.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Agent doesn't reply | `tmux attach -t claude-<name>` to see what's happening. Also check `restart.log` and `claude-agent.log`. |
| Plugin subprocess missing | `./restart.sh` retries once. If still broken, check `~/.claude/channels/telegram-<name>/.env` is mode 600 and contains the token. |
| "exceeds the dimension limit" (image crash) | Every image Read must go through `scripts/safe-image.sh` first. Restart + `/compact` to recover. |
| `claude plugin install failed` | Make sure `claude` is on PATH and you're logged in (`claude login`). |
| Context bloat | Telegram: `!!compact`. Or `/compact` in the tmux pane. |

## FAQ

**Do I need to pre-install the telegram plugin in Claude Code?**  
No. `create-hermit-agent` runs `claude plugin install -s project` for every new agent. First install downloads the plugin into the shared cache at `~/.claude/plugins/cache/`; subsequent agents reference that cache per-project. Zero plugin setup on your end.

**Does it work on Linux or Windows?**  
Currently macOS only — `launchctl`, `sips`, `tmux` are all macOS-shaped. Linux/Windows support is a welcome contribution.

**Can I run multiple agents with the same bot token?**  
No. Telegram's Bot API gives each bot's updates to exactly one listener. A shared token means one agent hijacks the other's messages. Each agent needs its own `@BotFather`-issued token.

**Where's my bot token stored?**  
In `~/.claude/channels/telegram-<name>/.env` (mode 600, outside the project). It's also echoed into `.claude/settings.local.json`, which is gitignored.

**Can I delete an agent cleanly?**  
Yes: `tmux kill-session -t claude-<name>`, then `rm -rf <agent-folder>` and `rm -rf ~/.claude/channels/telegram-<name>`. Also revoke the bot via `@BotFather` if you're done with it.

## Credits

Hermit Agent draws from three projects:

- **[Claude Code](https://docs.claude.com/claude-code)** — the CLI that hosts each agent. This project is literally a hermit crab on top of it.
- **OpenClaw** — the self-managed-browser / Chrome-profile pattern behind `chrome-launcher.sh` and `browser-lock.sh`.
- **Hermas agent** — earlier personal-assistant prototype. Hermit inherited its autonomous-evolution pattern and memory-module design.

## License

[MIT](LICENSE).
