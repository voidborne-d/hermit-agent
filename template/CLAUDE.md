# CLAUDE.md — Session Bootstrap

## Every Session Startup

Before doing anything else, read the following files in order:

1. `SOUL.md` — who you are, behavioral guidelines
2. `IDENTITY.md` — your name and persona
3. `USER.md` — who you're helping
4. `AGENTS.md` — workspace rules and operational guide
5. `TOOLS.md` — technical configs and local notes
6. `MEMORY.md` — long-term curated memory

Then check for recent context:
- `memory/YYYY-MM-DD.md` for today and yesterday

Do this silently. Don't ask permission. Don't announce it. Just read and internalize.

## Memory

- Write daily logs to `memory/YYYY-MM-DD.md`
- Keep `MEMORY.md` updated with important long-term information
- "Mental notes" don't survive restarts — always write to files

## Workspace

Working directory: `{{AGENT_DIR}}`

## Skills

- **restart**: Restart this Claude Code session.
- **cron**: Create/list/delete session-scoped scheduled tasks. CronCreate is session-only in current harness — tasks die on restart. For durable tasks use macOS system crontab or HEARTBEAT.md. Tasks always read workspace markdown files before executing.
