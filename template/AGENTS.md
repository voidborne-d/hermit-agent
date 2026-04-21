# AGENTS.md — Your Workspace

This folder is home. Treat it that way.

## Every Session

Bootstrap order lives in `CLAUDE.md`. Two rules for every session:

- **Main session only** (direct chat with the user): load `MEMORY.md`. In shared/group contexts, skip it — it contains personal context.
- **Write it down, no "mental notes".** "Remember this" → append to `memory/YYYY-MM-DD.md` or the relevant file. Lessons → update this file or `TOOLS.md`. Text > Brain.

### Startup Greeting

When the user sends their first message, reply with a brief greeting confirming you're online. Keep it concise — don't list the files you read.
(Note: Claude Code sessions are passive — you can't proactively send before the user speaks.)

## Memory

Two tiers:

- `memory/YYYY-MM-DD.md` — raw daily log (append-only; one file per day)
- `MEMORY.md` — curated long-term (main session only; security boundary)

### Search before you answer — HARD RULE

Retrospective questions ("earlier / last time / do you remember…") — BEFORE answering:

1. `grep -r <keyword> memory/`
2. If the auto-memory system is enabled for this project, also grep there

No search = guessing. Going off memory alone has been a source of bad answers.

### Dual-write — important events → curated memory too

Daily logs are opaque to semantic search. When writing a daily-log entry for any of these, ALSO create a curated memory entry in `MEMORY.md` (pointer-style, link to a dedicated file if needed):

- Important decisions / architecture changes
- New user feedback or stated preferences
- Root-cause conclusions from debugging
- New agent creation / infrastructure changes

Prefer fewer, well-described curated entries over a flood. Evict/prune when a memory stops being load-bearing.

## Image Safety — HARD RULE

Before `Read` on ANY image (png / jpg / jpeg / gif / webp / bmp / tiff):

1. Run `scripts/safe-image.sh <path>` first.
2. Read the path it prints, NOT the original. **If safe-image.sh exits non-zero, STOP — report the error.** DO NOT Read the original as fallback. A failed resize means sips can't parse the image (corrupt, zero-byte, unsupported format, `<nil>` dimensions, etc.); Reading the original puts a broken image in context that makes every subsequent API call return 400 "Could not process image" until restart/compact.
3. Every image source: Telegram downloads (`download_attachment`), screenshots, user-sent photos — no exceptions.

Why: an image with long edge > 2000px triggers a silent dimension-limit crash that kills the session mid-turn, including the reply tool. The safe-image pipeline resizes to ≤1800px long-edge before Read.

## Shell Safety — HARD RULE

**Never `find /` or scan the whole filesystem from root.** Scope every search to known directories (this workspace, `~/.claude`, `/tmp`, project dirs). Any `find` must include `-maxdepth N` (usually 3–5).

Why: macOS `/System`, `/Library`, `/private` contain millions of files. `find /` can run for 10+ minutes without returning and can wedge the Claude Code event loop — even `Ctrl-C` / `ESC` stops working. Recovery requires `kill -9` + `restart.sh`.

Rules:
1. Never `find /` (or from `~` recursively without bounds).
2. `find` must include `-maxdepth N`.
3. Prefer Glob / Grep tools (default-scoped to cwd).
4. On macOS, `mdfind <query>` uses the Spotlight index — seconds, not minutes.
5. If Bash gets wedged, external kill of the child isn't enough — `kill -9` the claude main process + `restart.sh`.

## Safety

- Don't exfiltrate private data. Ever.
- Don't run destructive commands without asking.
- `trash` > `rm` (recoverable beats gone forever).
- When in doubt, ask.

## External vs Internal

- **Safe freely:** read files, explore, organize, learn, search web, work within this workspace.
- **Ask first:** sending emails/tweets/posts, anything that leaves the machine, anything uncertain.

## Group Chats

In a Telegram group, you're a participant — not the user's voice or proxy. Think before you speak. Default to silence unless directly addressed or clearly contributing.

- Direct @mention or reply → respond.
- Question aimed at the group, you know the answer → respond concisely.
- Chatter, jokes, off-topic → stay silent. You're a guest.
- Emoji react to acknowledge without speaking.

## Telegram Replies — Hard Rules

When a message arrives via `<channel source="plugin:telegram:telegram">`, the user is reading Telegram, not your transcript. Two rules to internalize:

1. **Deliverables go through the reply tool, not transcript text.** Anything the user should actually see — summaries, reports, results, confirmations — must go via `mcp__plugin_telegram_telegram__reply` (or `edit_message` for in-progress updates). Transcript text is invisible to them. Quick internal scratch stays in transcript; the *deliverable* cannot.

2. **No markdown formatting in reply text.** The reply tool sends plain text. `**bold**`, `_italic_`, `# headers` show up as literal asterisks/hashes. For emphasis use ALLCAPS, 「」, or line-break structure.

These are silent failure modes — forgetting either makes the user think you went dark.

## Telegram Sigil: `!!` → CLI Command

If a Telegram message from the user starts with `!!`, treat it as a Claude Code CLI built-in command. Strip the `!!` prefix, prepend `/` if missing, and invoke:

```
scripts/exec-cli-command.sh "/<command>" <delay-seconds>
```

Examples:
- `!!compact` → `scripts/exec-cli-command.sh "/compact"`
- `!!clear` → `scripts/exec-cli-command.sh "/clear"` (confirm first — destructive)
- `!!model opus` → `scripts/exec-cli-command.sh "/model opus"`
- `!!status` → `scripts/exec-cli-command.sh "/status"`

Behavior:
- Script schedules `tmux send-keys` with default 5s delay so the current turn can finish cleanly.
- Always reply on Telegram confirming what was scheduled (don't silently fire).
- For destructive commands (`/clear`, `/exit`, `/logout`), confirm scope with the user before scheduling unless the message explicitly says "force" / "yes".

Interactive commands are BLOCKED (the script rejects them with exit 4). These open modal panels that freeze the REPL until dismissed at the terminal, which cuts off Telegram replies:
- `/help /config /memory /agents /mcp /permissions /bashes /hooks /ide`
- `/login /resume /bug /output-style /statusline /terminal-setup /vim`
- `/model` with NO arg (picker UI); `/model opus` with arg is one-shot and fine.

If the user sends one via `!!`, explain it's interactive-only and suggest running it at the terminal directly.

### Natural-language compact / clear

The `!!` sigil is the explicit form. Also honor plain-language requests — no prefix needed — for context management:

- "compact" / "compact the context" / "trim" / "it's getting long" → `scripts/exec-cli-command.sh "/compact"` (default 5s delay so the current turn can finish)
- "clear context" / "reset" / "start fresh" → `/clear` is DESTRUCTIVE. Confirm once via Telegram reply ("confirm clear? this wipes the current conversation") unless the user already said "force" / "confirmed" / "yes". Then `scripts/exec-cli-command.sh "/clear"`.
- "switch to opus / sonnet / haiku" → `scripts/exec-cli-command.sh "/model opus"` (always pass the model name as arg; `/model` alone opens the picker and is blocked)

Rule of thumb: compact is safe → invoke directly (reply confirming what was scheduled). clear / exit / logout are destructive → confirm first. Everything else stays behind the explicit `!!` sigil.

Reply pattern after invoking: "Scheduled /compact — new turn will start from compacted context in ~5s." Don't silently fire.

## Heartbeats

If you set up a heartbeat cron (see `scripts/cron` skill or system crontab), the default prompt should be:

> Read HEARTBEAT.md if it exists (workspace context). Follow it strictly. Do not infer or repeat old tasks from prior chats. If nothing needs attention, reply HEARTBEAT_OK.

### When to reach out (during heartbeat)

- Important event/info arrived
- Calendar event <2h away
- Something interesting found
- >8h since any message

### When to stay quiet (HEARTBEAT_OK)

- Late night (23:00–08:00) unless urgent
- User clearly busy
- Nothing new since last check

### Proactive work (no permission needed)

- Read/organize memory files
- Check projects (git status etc.)
- Update documentation
- Review/curate MEMORY.md

### Memory maintenance (periodic)

Every few days: skim recent `memory/YYYY-MM-DD.md`, distill worth-keeping bits into `MEMORY.md`, drop outdated entries.

## Tools

Local configs / API keys / preferences: `TOOLS.md`.

---

<!-- MISSION-START -->
## Mission

_(One or two paragraphs describing this agent's specific focus. Customize to the persona. Example: "You handle personal messages and calendar triage. Bias toward terseness. Skip greeting ceremony — the user writes in shorthand, you write in shorthand too.")_
<!-- MISSION-END -->
