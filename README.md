<div align="center">

<img src="assets/logo.svg" width="200" alt="Hermit Agent logo"/>

# Hermit Agent

**A Telegram-connected Claude Code agent. Borrow the shell, bring your own body.**

[English](README.md) · [中文](README.zh-CN.md)

</div>

---

Hermit Agent is a long-lived Claude Code session in a `tmux` pane, wired to a Telegram bot, with a small set of markdown files that give it a persistent identity and memory across restarts. The agent is the hermit crab. Claude Code is the shell. Your files are the body.

## Quickstart

Prereqs (macOS): [Claude Code](https://docs.claude.com/claude-code), Node 18+, `brew install tmux jq`, `curl -fsSL https://bun.sh/install | bash`.

One command bootstraps your hub agent:

```bash
npx create-hermit-agent
```

No `npx create-hermit-agent <name>` is also fine — the default name is `asst`. The CLI will ask for a Telegram bot token (from [@BotFather](https://t.me/BotFather)) and your user ID (from [@userinfobot](https://t.me/userinfobot)), then scaffold, register the telegram plugin at project scope, and write the bot token to `~/.claude/channels/telegram-<name>/.env`.

Then:

```bash
cd asst && ./start.sh
```

DM your bot. On the first message the hub orients you — how to create more agents, the `!!` command sigil, how to customize the persona.

> **Q: Do I need to pre-install the telegram plugin in Claude Code?**  
> No. The CLI runs `claude plugin install -s project` for every new agent. First install downloads to the shared `~/.claude/plugins/cache/`; subsequent agents register against that cache per-project. Zero plugin setup on your side.

## Multi-agent: hub spawns siblings

Run `npx create-hermit-agent` **once**. Every other agent you want, just tell the hub:

> "Create a hermit called `github-bot` with token `123:ABC...`. Purpose: triage my GitHub notifications."

The hub's `provision-agent` skill scaffolds the sibling at `../github-bot/`, installs the plugin, starts it in its own tmux session, replies with the new bot's `@handle`.

## What's in the box

- **Memory & persona** — `SOUL · IDENTITY · USER · AGENTS · TOOLS · MEMORY.md` + `memory/YYYY-MM-DD.md`. Restart and the agent still knows who it is.
- **Telegram** — reply/react/edit/download. `!!compact`, `!!model opus`, `!!status` inject CLI commands. Group-chat etiquette built in. A Stop hook blocks turn-end if a DM arrived but no reply went out.
- **Lifecycle** — `./start.sh` / `./restart.sh` (tmux-based, plugin-alive check + retry). Context-tier alerts at 100k/200k/…/950k. Tool-activity heartbeat every 1st + 5th call.
- **Automation** — skills: `restart`, `cron`, `brave-search`, `browser-automation`, `provision-agent`. Self-managed Chrome + Playwright CDP (explore → record → replay via `browser-lock.sh`).
- **Safety** — mandatory `safe-image.sh` before any image Read. Hard rule against `find /`. Tokens live outside the repo in mode-600 `.env`. Opt-in multi-agent status digest via LaunchAgent.

## Architecture

```
┌──────────────────── Your Mac ──────────────────────┐        ┌── Telegram ──┐
│   tmux session  claude-<agent>                      │        │  Bot API     │
│   ┌───────────────────────────────────────────┐    │        │  long-poll   │
│   │  claude CLI  (the borrowed shell)          │    │        │              │
│   │  ┌──────────┐  ┌─────────────────────┐   │    │        │              │
│   │  │ Persona  │  │ Skills + Hooks      │   │    │◄──────►│  @yourbot    │
│   │  │ *.md     │  │ restart · cron ·    │   │    │        │              │
│   │  │ memory/  │  │ provision · browser │   │    │        │              │
│   │  └──────────┘  └─────────────────────┘   │    │        │              │
│   │        Telegram plugin (bun server.ts)    │    │        │              │
│   └──────────────┬───────────────────────────┘    │        │              │
│                  │                                  │        │              │
│  ~/.claude/channels/telegram-<agent>/ (.env)        │        │              │
└─────────────────────────────────────────────────────┘        └──────────────┘
```

Higher-res SVG: [assets/arch.svg](assets/arch.svg).

## Customizing

Edit in the generated agent directory:

- **`IDENTITY.md`** — name, vibe, mission.
- **`USER.md`** — who you are.
- **`AGENTS.md`** — find `<!-- MISSION-START -->` and fill in.
- **`TOOLS.md`** — find `<!-- AGENT-SPECIFIC-START -->` for repo links, API keys, domain notes.

Don't edit `SOUL.md` unless you want a different disposition.

## Scheduled tasks

Three layers. Pick by how long the task must survive.

| Layer | Survives restart? | Use for |
|---|---|---|
| `cron` skill (`CronCreate`) | ❌ session-only | one-shot reminders, probes |
| `HEARTBEAT.md` | ✅ next wake | lazy checks needing session context |
| LaunchAgent / `crontab` | ✅ OS-level | monitoring, anything must-not-miss |

### 1. Session-scope — the `cron` skill

Tell the agent:

> "Every 30 minutes, glance at `memory/today.md` and flag anything urgent."

It produces a `CronCreate` call with a bootstrap prompt that reads your persona files first, runs the task, logs to today's daily memory, and replies via Telegram. `durable: true` is a no-op in the current harness — tasks die on restart.

### 2. HEARTBEAT.md

For checks that need Claude's reasoning AND must survive restarts, wire a LaunchAgent that injects `"Heartbeat check."` into your tmux pane every N minutes. On each heartbeat the agent reads `HEARTBEAT.md` to decide what to do. What-to-do lives in markdown (agent can edit); when-to-fire lives in OS.

### 3. LaunchAgent plist (durable)

macOS's `crontab -e` can hang silently waiting for a Full Disk Access prompt. Use a LaunchAgent instead. The template ships `launchd/cron-example.plist.tmpl`:

```bash
AGENT=$(basename "$PWD")
cp launchd/cron-example.plist.tmpl \
   ~/Library/LaunchAgents/com.hermit-agent.${AGENT}.<TASK>.plist
# edit Label, ProgramArguments, StartInterval
launchctl load ~/Library/LaunchAgents/com.hermit-agent.${AGENT}.<TASK>.plist
```

Verify: `launchctl list | grep hermit-agent`. Unload: `launchctl unload <path>`.

### Ping Telegram from cron

Any durable task can reuse the hub's credentials:

```bash
token=$(jq -r '.env.TELEGRAM_BOT_TOKEN' .claude/settings.local.json)
chat_id=$(jq -r '.env.TELEGRAM_CHAT_ID' .claude/settings.local.json)
curl -sS -X POST "https://api.telegram.org/bot${token}/sendMessage" \
  -d "chat_id=${chat_id}" --data-urlencode "text=task fired"
```

`scripts/multi-agent-status-report.sh` is a working example.

## Hub status digest (optional)

One hermit per Mac can be designated the hub. Install its LaunchAgent to push a digest of all sibling agents every 10 min (🟢 idle · 🟨 running · 🟥 stuck · ⚫ down):

```bash
cp launchd/status-reporter.plist.tmpl \
   ~/Library/LaunchAgents/com.hermit-agent.<agent>.status-reporter.plist
launchctl load ~/Library/LaunchAgents/com.hermit-agent.<agent>.status-reporter.plist
```

## Troubleshooting

| Problem | Fix |
|---|---|
| Agent doesn't reply | `tmux attach -t claude-<name>`; check `restart.log` and `claude-agent.log`. |
| Plugin subprocess missing | `./restart.sh` retries once. If still failing, verify `~/.claude/channels/telegram-<name>/.env` is mode 600 with the token. |
| Image dimension crash | Every Read on an image must go through `scripts/safe-image.sh` first. Restart + compact if missed. |
| `claude plugin install failed` | Ensure `claude` is on PATH and logged in (`claude login`). |
| Context bloat | Telegram: `!!compact`. Or type `/compact` in the tmux pane. |

## Credits

Hermit Agent draws from three projects:

- **[Claude Code](https://docs.claude.com/claude-code)** — the CLI that hosts the agent; this project is literally a hermit crab on top of it.
- **OpenClaw** — the self-managed browser + Chrome profile pattern informed `chrome-launcher.sh` + `browser-lock.sh`.
- **Hermas agent** — earlier personal-assistant prototype; hermit's autonomous-evolution pattern and memory module design came from here.

## License

[MIT](LICENSE).
