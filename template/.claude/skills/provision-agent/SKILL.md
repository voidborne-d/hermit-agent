---
name: provision-agent
description: Spawn a new sibling Hermit agent via `npx create-hermit-agent`. Use when the user asks to "create a new agent", "new bot", "spin up another hermit", etc.
user_invocable: true
---

# Provision a New Hermit Agent

When the user asks for a new agent, spawn a sibling Hermit under `~/claudeclaw/<name>/` using the bootstrap CLI.

## Arguments to collect

Before launching, ask the user (via Telegram reply) for:

1. **Name** — folder name under `~/claudeclaw/` (must not already exist).
2. **Bot token** — a new token from @BotFather on Telegram.
3. **Persona** — one-line description of what this agent should focus on (e.g. "handle GitHub notifications", "research ML papers", "manage my calendar").
4. _(Optional)_ Chat ID — if the user wants the new agent routed to a different chat. Default: the same chat ID as this agent (`env.TELEGRAM_CHAT_ID`).

If the user provides all of these in one message, don't re-ask — proceed.

## Invocation

```bash
npx create-hermit-agent <name> \
  --bot-token <token> \
  --user-id <chat-id> \
  --persona "<one-line>" \
  --yes
```

`--yes` skips the interactive prompts since we already have the values.

The CLI will:
1. Verify prereqs (claude CLI, tmux, bun, node ≥18, macOS).
2. Validate the bot token against Telegram's getMe.
3. Copy the template into `~/claudeclaw/<name>/`.
4. Write `~/.claude/channels/telegram-<name>/.env` with the token.
5. Run `claude plugin install telegram@claude-plugins-official -s project` inside the new agent's directory.
6. `npm install playwright` inside the new agent (for browser-automation).
7. Generate `start.sh` with absolute paths.
8. Print next steps.

Typical wall-clock: ~20–30s.

## After provisioning

Start the new agent in tmux:

```bash
~/claudeclaw/<name>/start.sh
```

Then fetch the bot's @username so the user knows which handle to DM:

```bash
curl -sS -m 8 "https://api.telegram.org/bot<TOKEN>/getMe" | jq -r '.result.username'
```

Reply to the user via Telegram with:
- Agent name + workspace path
- tmux session name (`claude-<name>`)
- Bot @username
- Persona summary
- A note that they can DM the bot directly to trigger the startup greeting.

## What you should NOT do

- **Do not** hand-roll the directory tree. The CLI is the single source of truth — if anything's off, fix the CLI, not the output.
- **Do not** share bot tokens across agents. Each agent needs its own.
- **Do not** pre-populate the new agent's MEMORY.md with facts from your own — the user will want a clean canvas.
- **Do not** `cd` into the new agent and run claude manually. Use `start.sh` so the tmux session is created with the agent name convention.

## Stopping and listing agents

**Stop:**
```bash
tmux kill-session -t "claude-<name>"
```

**List all agents:**
```bash
for d in ~/claudeclaw/*/; do
  name=$(basename "$d")
  if [ -f "$d/agent.pid" ]; then
    pid=$(cat "$d/agent.pid")
    kill -0 "$pid" 2>/dev/null && status="running (PID $pid)" || status="stopped"
  else
    status="no pid file"
  fi
  echo "$name: $status"
done
```

## After creating, the user should:

1. DM the bot to wake it.
2. Customize `IDENTITY.md`, `USER.md`, `AGENTS.md` (MISSION section), `TOOLS.md` (AGENT-SPECIFIC section) for the new persona.
3. Optionally add a `HEARTBEAT.md` if they want periodic check-ins.

Don't do this for them — confirm it's the new agent's job.
