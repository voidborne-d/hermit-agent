---
name: migrate-openclaw
description: Migrate an existing OpenClaw agent (remote VPS, `~/.openclaw/workspace/<name>/`, OpenClaw cron, Discord+Telegram) into a local hermit-agent sibling. Use when the user says "migrate openclaw", "迁移 openclaw", "把 <name> 从 openclaw 搬下来", or provides an SSH host + remote path and asks to bring an agent local.
user_invocable: true
---

# Migrate OpenClaw Agent → Local Hermit

Turn an OpenClaw agent (runtime on a remote VPS, workspace at `~/.openclaw/workspace/<name>/`, OpenClaw cron, Discord + Telegram) into a local hermit-agent sibling at `~/claudeclaw/<name>/`, with LaunchAgent plists and Telegram only.

Based on the 2026-04-22 `d` migration. The gotchas below are real — not hypothetical.

## Before you start — collect from the user

1. **Agent name** — drives directory name, LaunchAgent label prefix (`com.hermit-agent.<name>.cron-*`), secrets dir (`~/.claude/channels/<name>-secrets/`).
2. **SSH host** — e.g. `ubuntu@1.2.3.4`. Verify `ssh <host> 'echo ok'` works first.
3. **Remote workspace path** — usually `~/.openclaw/workspace/<name>/`, but confirm.
4. **Channels** — hermit-agent is Telegram-only. Discord, Slack, etc. WILL be dropped. Flag this up front.
5. **Bot token choice** — RECOMMEND a fresh Telegram bot so the OpenClaw agent can keep running until the local one is verified. Reusing the old token means only one instance can poll the bot at a time.

Do not start copying until these are confirmed.

## Step 1 — dry-run inventory (don't copy yet)

```bash
ssh <host> 'ls ~/.openclaw/workspace/<name>/ && du -sh ~/.openclaw/workspace/<name>/*'
ssh <host> 'ls ~/.openclaw/.credentials/<name>/ 2>/dev/null'
ssh <host> 'ls ~/.config/moltbook/ 2>/dev/null'
ssh <host> 'crontab -l 2>/dev/null | grep -i <name>'
```

Classify what's there and present to the user:

- **Keep** — persona markdown (`SOUL.md`, `IDENTITY.md`, etc.), `memory/`, `articles/`, `research/`, `images/`, `moltbook/` cache, `agent-lang/`, `<name>-doctrine/`, original skills, contrib project clones.
- **Drop** — SEO-farm skills, OpenClaw self-management skills (keepalive, self-restart), third-party upstream clones (can be 4 GB+), Discord/Slack code paths.
- **Transform** — OpenClaw cron entries → LaunchAgent plists (Step 5). Credentials dir → `~/.claude/channels/<name>-secrets/`.

Get the user's OK on drops before Step 2.

## Step 2 — rsync the keep list (selective, NOT `-az` on the whole workspace)

```bash
TARGET=~/claudeclaw/<name>
mkdir -p "$TARGET"

rsync -azv --progress <host>:~/.openclaw/workspace/<name>/{persona,memory,articles,research,images,moltbook,agent-lang,*.md} "$TARGET/"
```

Copy skills selectively — list what's on the remote, pull only the ones kept:

```bash
ssh <host> 'ls ~/.openclaw/workspace/<name>/skills/'
# then:
rsync -azv <host>:~/.openclaw/workspace/<name>/skills/{skill1,skill2,...} "$TARGET/skills/"
```

Never `rsync -az` the whole workspace — third-party clones eat disk and obscure review.

## Step 3 — rewrite absolute paths

Any file referencing `/workspace/…`, `~/.openclaw/…`, or `~/.config/moltbook/…` needs rewriting. Find first, then sed with backups:

```bash
cd "$TARGET"
grep -rln -E '~/\.openclaw|/workspace/|~/\.config/moltbook' . | head
# Review the list. Then:
find . -type f \( -name '*.md' -o -name '*.json' -o -name '*.sh' -o -name '*.py' \) -exec \
  sed -i.bak -E "s|~/\.openclaw/\.credentials/<name>|~/.claude/channels/<name>-secrets|g; \
                 s|~/\.config/moltbook|~/.claude/channels/<name>-secrets/moltbook|g; \
                 s|/workspace/<name>/|./|g" {} \;
# Spot-check diffs, then remove .bak files:
find . -name '*.bak' -delete
```

Present a handful of diffs to the user before deleting backups.

## Step 4 — move credentials

```bash
DEST=~/.claude/channels/<name>-secrets
mkdir -p "$DEST"
rsync -azv <host>:~/.openclaw/.credentials/<name>/ "$DEST/"
chmod 600 "$DEST"/*
```

Moltbook session, GitHub tokens, X/Twitter keys, AgentMail creds, etc. all land here. The repo files reference them by path — Step 3 rewrote those paths, Step 4 puts the files in place.

## Step 5 — generate LaunchAgent plists from the remote crontab

For each remote cron entry (e.g. `0 */5 * * * cd ~/.openclaw/workspace/<name> && ./bin/task moltbook-outreach`):

1. Decide interval in seconds (`*/5` hours → `18000`). For non-interval schedules (weekday 9am, etc.) use `StartCalendarInterval` instead of `StartInterval`.
2. Copy `launchd/cron-example.plist.tmpl` to `$TARGET/launchd/com.hermit-agent.<name>.cron-<task>.plist`.
3. Edit:
   - `Label` → `com.hermit-agent.<name>.cron-<task>`
   - `StartInterval` → seconds
   - `ProgramArguments` → wrap the command. Convention that works well: put prompts in `cron/<task>.md` and run `claude --dangerously-skip-permissions -p "$(cat cron/<task>.md)"`.
   - `WorkingDirectory` → `/Users/<you>/claudeclaw/<name>`
   - `StandardOutPath` / `StandardErrorPath` → `.claude/state/cron-<task>.out|.err`
4. Move the remote cron prompts into `$TARGET/cron/<task>.md`.

## Step 6 — **LOAD the plists** (this is where every migration fails)

Writing plists to `launchd/` does NOT activate them. This step was skipped in the original `d` migration and every cron silently never fired until the user noticed. Don't repeat it.

```bash
./scripts/launchd-sync.sh "$TARGET"
# expect: "Summary: N loaded, 0 errors"
launchctl list | grep com.hermit-agent.<name>
```

Every label must appear. Exit column must be `0` (or `-` for "hasn't fired yet but loaded"). If not, check `.claude/state/cron-<task>.err` and fix before moving on.

## Step 7 — channel wiring

Hermit-agent needs a few things the OpenClaw config didn't have in this shape:

1. **Telegram bot env** in `$TARGET/.claude/settings.local.json`:
   ```json
   "env": {
     "TELEGRAM_BOT_TOKEN": "<new or reused token>",
     "TELEGRAM_STATE_DIR": "/Users/<you>/.claude/channels/telegram-<name>",
     "TELEGRAM_CHAT_ID": "<user's chat id>",
     "BRAVE_API_KEY": ""
   }
   ```
2. **Plugin state dir + `.env`** (plugin subprocess doesn't inherit from settings — it reads its own `.env`):
   ```bash
   mkdir -p ~/.claude/channels/telegram-<name>
   cat > ~/.claude/channels/telegram-<name>/.env <<EOF
   TELEGRAM_BOT_TOKEN=<token>
   TELEGRAM_CHAT_ID=<chat_id>
   EOF
   chmod 600 ~/.claude/channels/telegram-<name>/.env
   ```
3. **Install the Telegram plugin**:
   ```bash
   cd "$TARGET" && claude plugin install -s project claude-plugins-official/telegram
   ```

## Step 8 — smoke test

```bash
cd "$TARGET" && ./start.sh
tmux ls                          # expect claude-<name>
cat agent.pid                    # expect a live PID
tail restart.log                 # "plugin up, channel=plugin:telegram@..."
```

Send a "hi" from Telegram, wait for reply. If silent for 60s: `tmux attach -t claude-<name>`, look for pending "trust this folder" or "allow dangerous mode" dialogs (press Enter to dismiss), check env, check plugin bun subprocess is alive.

## Step 9 — record the migration

In `$TARGET/MEMORY.md` add a "Migration record" section with: date, source host + path, destination, what was dropped, what was transformed, anything left on the remote (e.g. heavy web app not worth pulling).

## Step 10 — tear down OpenClaw side (ASK FIRST)

External action — confirm with user:

- Stop the OpenClaw agent process on the remote.
- Do NOT delete the remote workspace for at least 24–48 h. Keeps rollback cheap.
- Revoking tokens (moltbook session, old Telegram bot if not reused) is the user's call.

## Hard rules

- Confirm scope before each remote read or write. SSH is an external surface.
- Never `ssh … rm -rf`. Any remote destructive op needs explicit user approval.
- Every step that writes to `$HOME/Library/LaunchAgents/` goes through `scripts/launchd-sync.sh` — don't hand-roll the `cp + launchctl load` dance.
- Credentials go to `~/.claude/channels/<name>-secrets/`, mode 600. Never paste them into repo files or Telegram.
- When unsure which skills are original vs third-party clone, ask the user.
