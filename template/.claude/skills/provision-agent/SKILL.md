---
name: provision-agent
description: Spawn a new sibling Hermit agent on behalf of the user. Use when the user asks to "create a new agent", "new bot", "add a hermit", "spin up another", etc. The user never runs `npx` themselves after installing asst — you do it for them.
user_invocable: true
---

# Provision a New Hermit (asst spawns siblings)

Your user runs `npx create-hermit-agent` **once** to bootstrap you — the default agent is called **asst**. Every additional hermit they need, they ask *you* for via Telegram. This skill handles that request end-to-end.

## The flow at a glance

```
  user ──"create an agent called X for purpose Y"──► asst (you)
                                                     │
                                                     ▼
                                            npx create-hermit-agent
                                            (called via Bash, --yes mode)
                                                     │
                                                     ▼
                                            ../<name>/ scaffolded
                                            ../<name>/start.sh → tmux session
                                                     │
                                                     ▼
  user ◄──"ready, DM @<newbot> to wake them"── you
```

New agents land as **siblings** — in the parent directory of your workspace, not inside it. Each gets its own bot token, its own `tmux` session (`claude-<name>`), and its own directory.

## Arguments to collect

Before running anything, you need four things from the user (ask via Telegram reply if any are missing):

1. **Name** — folder-safe name, e.g. `gitasst-bot`, `journal-agent`. Must not already exist next to this workspace.
2. **Bot token** — a new token from [@BotFather](https://t.me/BotFather). The user must have already created a bot; do not try to create one for them.
3. **Persona** — one-line description: what should this agent focus on?
4. **User chat ID** — default to this agent's own `env.TELEGRAM_CHAT_ID` (from `.claude/settings.local.json`). Only ask if the user wants the new agent to route to a different chat.

If the user gives all four in one message, proceed without re-asking. Otherwise ask only for the missing pieces.

## Invocation

Run this via Bash from your own working directory — the `../<name>` path puts the new agent next to yours without needing a `cd`:

```bash
npx create-hermit-agent "../<name>" \
  --bot-token <token> \
  --user-id <chat-id> \
  --persona "<one-line>" \
  --yes
```

`--yes` skips the interactive prompts since you already have the values. Don't `cd ..` — the CLI resolves relative paths against your cwd, and shifting cwd has side effects on subsequent Bash calls in the same turn.

The CLI will:
1. Verify prereqs (claude CLI, tmux, bun, node ≥18, macOS).
2. Validate the bot token against Telegram's `getMe`.
3. Copy the template into `../<name>/`.
4. Write `~/.claude/channels/telegram-<name>/.env` (token) and `access.json` (user pre-allowed so the first DM skips the pairing-code round-trip).
5. Run `claude plugin install telegram@claude-plugins-official -s project`.
6. `npm install` Playwright inside the new agent.
7. Print next steps.

Typical wall-clock: 20–30 seconds.

## Launching the new agent

After `npx create-hermit-agent` exits 0:

```bash
../<name>/start.sh
```

This creates a new tmux session `claude-<name>` and launches the agent inside. It does NOT replace your own tmux session.

Then fetch the new bot's `@username`:

```bash
curl -sS -m 8 "https://api.telegram.org/bot<TOKEN>/getMe" | jq -r '.result.username'
```

## Reply to the user

Send a single Telegram reply with:

- Agent name + sibling path
- Bot `@username`
- Persona summary
- Instruction: "DM @&lt;username&gt; to wake them."

Example:

```
Spun up gitasst-bot at ../gitasst-bot — DM @gitasst_bot_f3a to wake them.
Mission: triage GitHub notifications, flag anything from maintainers of
repos I star.
```

## Hard rules — don't do these

- **Don't bypass the CLI.** `npx create-hermit-agent` is the single source of truth. If scaffolding is broken, fix the CLI; never hand-roll the directory tree.
- **Don't share a bot token across agents.** Each needs a unique one from BotFather. If the user accidentally reuses a token, the second agent will hijack the first's updates.
- **Don't pre-populate the new agent's MEMORY.md with facts from your own.** That's their canvas.
- **Don't `cd` into the new agent and run `claude` manually** — always go through `start.sh` so the `tmux` session gets the right name.
- **Don't create agents nested inside your own workspace** (`./<name>/` instead of `../<name>/`). Siblings are independent — nested would get caught by your permission rules and your git scope.

## Stopping and listing

**Stop an agent:**
```bash
tmux kill-session -t "claude-<name>"
```

**List all sibling agents:**
```bash
for d in ../*/; do
  name=$(basename "$d")
  [ "$d" = "../$(basename "$(pwd)")/" ] && continue
  [ -f "$d/CLAUDE.md" ] || continue
  if [ -f "$d/agent.pid" ]; then
    pid=$(cat "$d/agent.pid")
    kill -0 "$pid" 2>/dev/null && status="running (PID $pid)" || status="stopped"
  else
    status="never started"
  fi
  echo "$name: $status"
done
```

## What the user should do after you reply

They'll DM the new bot to trigger its startup greeting. Over time they may customize `IDENTITY.md`, `USER.md`, the `MISSION` block in `AGENTS.md`, and the `AGENT-SPECIFIC` block in `TOOLS.md` — but that's their call, not yours. Don't customize these files on behalf of a new agent unless the user explicitly asks you to.
