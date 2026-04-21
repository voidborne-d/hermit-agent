# TOOLS.md — Local Notes

_Record technical configs, API keys, tool settings, and operational notes here._

## Telegram

- Reached via the `telegram@claude-plugins-official` plugin (bot + MCP subprocess).
- Primary chat_id: `{{USER_TG_ID}}`
- Bot token lives in `{{STATE_DIR}}/.env` (plugin reads it) and in `.claude/settings.local.json` `env.TELEGRAM_BOT_TOKEN` (hooks and status scripts read it).

## Skills

- **restart** — restart this Claude Code session via tmux respawn. Keeps the Telegram channel alive.
- **cron** — create/list/delete session-scoped scheduled tasks. CronCreate is session-only in the current harness — tasks die on session restart. For durable tasks use macOS system crontab or `HEARTBEAT.md`. All cron tasks should read `SOUL/IDENTITY/USER/AGENTS/TOOLS/MEMORY.md` and today's daily memory before executing, and report back via Telegram after.
- **brave-search** _(optional; requires API key)_ — web / news / image / video search via Brave Search API.
- **browser-automation** _(optional)_ — self-managed Chrome + Playwright CDP; explore with `mcp__playwright-browser__*`, record to `scripts/browser/<verb>-<target>.js`, replay via `scripts/browser-lock.sh run <script>`.
- **provision-agent** — spawn a new sibling Hermit agent via `npx create-hermit-agent`.

### Cron defaults

- All cron tasks should report back via Telegram (chat_id `{{USER_TG_ID}}`) when done — what ran, result, any errors.
- Keep reports concise.
- Create bootstrap prompts that always begin with reading workspace markdown files, so each task fires with full identity/context.

## Browser (if using browser-automation)

- Self-managed Chrome instance, no OpenClaw dependency.
- Profile: `browser/user-data/`
- Runtime config: `browser/chrome.json` (CDP port, PID)
- CDP port range: 19900–19999 (auto-assigned).
- Start: `./scripts/chrome-launcher.sh start`
- Explore (default): `mcp__playwright-browser__*` — snapshot/act with ref-based interactions, stealth-init.js injected automatically.
- Automated replay: `./scripts/browser-lock.sh run scripts/browser/<script>.js`

## APIs

<!-- AGENT-SPECIFIC-START -->

### Brave Search API _(optional)_

If `env.BRAVE_API_KEY` is set in `.claude/settings.local.json`, the `brave-search` skill is usable.

- Base URL: `https://api.search.brave.com/res/v1`
- Auth: `X-Subscription-Token` header
- Key: _(set during init or add later — see `.claude/settings.local.json`)_

_(Add repos, APIs, resources, or services this agent uses regularly below.)_

<!-- AGENT-SPECIFIC-END -->
