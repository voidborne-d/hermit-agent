# Scheduled tasks

Hermit Agent gives you **three layers** for running periodic work. Pick the layer based on how long the task must survive and what context it needs.

| Layer | Survives restart? | Has session context? | Use when |
|---|---|---|---|
| `cron` skill (`CronCreate`) | ❌ No — dies when the agent session exits | ✅ Yes, full conversation context | One-shot reminders, probes, anything that only matters during the current session |
| `HEARTBEAT.md` | ✅ Yes (on next session wake) | ✅ Yes | Lazy checks, memory maintenance, work that needs the agent to "think" about recent state |
| LaunchAgent plist / `crontab` | ✅ Yes — OS-level | ❌ No — shell command only | Monitoring, log collection, anything the agent must not be able to sleep through |

A common pattern is **both**: a LaunchAgent collects raw data on disk, and a `HEARTBEAT.md` check tells the agent to analyze the freshest entries next time it wakes.

## Layer 1: the `cron` skill

**Description of life:** session-only.

The built-in skill wraps Claude Code's `CronCreate` harness. Tasks fire when the REPL is idle. They don't interrupt an active turn, and they die the moment the agent restarts.

### Create a task

Ask the agent in Telegram:

> "Every 30 minutes, glance at `memory/today.md` and flag anything that looks urgent."

The agent will produce a CronCreate call with a bootstrap prompt that first reads your persona files (`SOUL.md`, `IDENTITY.md`, `USER.md`, `AGENTS.md`, `TOOLS.md`, `MEMORY.md`, today's `memory/`), then performs the task, then logs to today's daily memory, then replies via Telegram.

### List / delete tasks

> "List my scheduled tasks."  
> "Delete task `abc123`."

### Limits

- `durable: true` is silently ignored by the current harness — don't rely on it.
- Tasks are stored in memory, not disk. Restart = gone.
- Offsets: the skill picks minute values like `:07, :23, :43` to dodge traffic spikes at `:00, :30`.

## Layer 2: `HEARTBEAT.md`

**Description of life:** survives session restart; fires on heartbeat poll.

If you wire up a recurring "heartbeat" trigger (via LaunchAgent or system `crontab`) that hits your agent, the agent consults `HEARTBEAT.md` to decide what to do. This is the pattern for **stateful check-ins** that need Claude's reasoning but must also survive restarts.

The stub at `template/HEARTBEAT.md` gives you a starting script. Customize it with the checks you want each heartbeat to run.

Typical wiring:

1. A LaunchAgent (see Layer 3) fires every N minutes.
2. The LaunchAgent's command `tmux send-keys -t claude-<agent> 'Heartbeat check.' Enter` — this injects a prompt into the agent.
3. The agent, on receiving "Heartbeat check.", reads `HEARTBEAT.md` and acts.

This keeps the "what to do" living in a file the agent controls (and can edit), while the "when" is OS-level and reliable.

## Layer 3: LaunchAgent plist (macOS-native)

**Description of life:** survives everything short of the Mac going down.

On macOS the right durable scheduler is a **LaunchAgent plist** under `~/Library/LaunchAgents/`. `crontab` also works, but macOS's `crontab` has a first-run gotcha where `crontab -e` hangs forever waiting for a Full Disk Access prompt that may never appear. LaunchAgent avoids that.

### Starter example

The template ships `launchd/cron-example.plist.tmpl`. Copy, edit, install:

```bash
# Copy with a unique label
AGENT=$(basename "$PWD")          # your agent directory name
cp launchd/cron-example.plist.tmpl \
   ~/Library/LaunchAgents/com.hermit-agent.${AGENT}.<TASK_NAME>.plist

# Edit: set <TASK_NAME>, the ProgramArguments script path, and StartInterval.
$EDITOR ~/Library/LaunchAgents/com.hermit-agent.${AGENT}.<TASK_NAME>.plist

# Load
launchctl load ~/Library/LaunchAgents/com.hermit-agent.${AGENT}.<TASK_NAME>.plist
```

Key fields:

- **`Label`** — unique per task. Convention: `com.hermit-agent.<agent>.<task>`.
- **`ProgramArguments`** — the command to run. First entry is the binary (`/bin/bash`), remaining are arguments.
- **`StartInterval`** — seconds between runs. `600` = every 10 min.
- **`RunAtLoad`** — if `true`, fires once immediately on load. Default `false` waits until first interval.
- **`StandardOutPath` / `StandardErrorPath`** — where stdout/stderr land. Pointing them into `.claude/state/` keeps them out of git.
- **`WorkingDirectory`** — optional but useful if your script uses relative paths.

### Unload / remove

```bash
launchctl unload ~/Library/LaunchAgents/com.hermit-agent.${AGENT}.<TASK_NAME>.plist
rm ~/Library/LaunchAgents/com.hermit-agent.${AGENT}.<TASK_NAME>.plist
```

### Verify it's running

```bash
launchctl list | grep hermit-agent
launchctl print gui/$(id -u)/com.hermit-agent.${AGENT}.<TASK_NAME> | grep -E 'state|runs|last exit'
```

### System `crontab` alternative

If you prefer `crontab -e`:

```bash
# Run every 10 minutes
*/10 * * * * /Users/you/claudeclaw/my-hub/scripts/some-task.sh >> /Users/you/claudeclaw/my-hub/.claude/state/some-task.log 2>&1
```

Two gotchas:
1. On first install, macOS may silently block `crontab -e` until you grant Terminal Full Disk Access in System Settings. If it hangs for more than a few seconds, cancel and use a LaunchAgent instead.
2. Use absolute paths — crontab runs in a minimal environment without your shell aliases or PATH.

## Sending from cron to Telegram

Any durable task that wants to ping you on Telegram can read the same `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` your hooks use:

```bash
token=$(jq -r '.env.TELEGRAM_BOT_TOKEN // empty' "$HUB_DIR/.claude/settings.local.json")
chat_id=$(jq -r '.env.TELEGRAM_CHAT_ID // empty' "$HUB_DIR/.claude/settings.local.json")
curl -sS -m 10 -X POST "https://api.telegram.org/bot${token}/sendMessage" \
  -d "chat_id=${chat_id}" \
  --data-urlencode "text=scheduled task fired: $(date)"
```

The template's `scripts/multi-agent-status-report.sh` is an example of this pattern.

## Rule of thumb

- **Only need it while the session is up** → `cron` skill.
- **Need it when the agent wakes from heartbeat** → `HEARTBEAT.md`.
- **Must run even if the agent is dead** → LaunchAgent (or `crontab` if you must).

When in doubt, use LaunchAgent. Disk is cheap, dropped alerts are expensive.
