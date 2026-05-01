// Smoke test: copy template into /tmp/hermit-smoke-out/ with dummy placeholders
// and sanity-check a few known substitutions.

import { existsSync, rmSync, readFileSync, readdirSync, mkdirSync, writeFileSync, chmodSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = resolve(__dirname, '..', 'template');
const TARGET = '/tmp/hermit-smoke-out';

const TEXT_EXTS = new Set(['.md', '.json', '.js', '.ts', '.sh', '.bash', '.zsh', '.plist', '.toml', '.yml', '.yaml', '.tmpl', '.gitkeep', '.gitignore']);
function isTextFile(path) {
  if (path.endsWith('.gitignore') || path.endsWith('.gitkeep')) return true;
  const i = path.lastIndexOf('.');
  if (i < 0) return true;
  return TEXT_EXTS.has(path.slice(i));
}
function substitute(content, vars) {
  return content.replace(/\{\{(\w+)\}\}/g, (m, key) => (key in vars ? vars[key] : m));
}
function walkCopy(srcDir, destDir, vars) {
  if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = join(srcDir, entry.name);
    let destName = entry.name;
    if (destName.endsWith('.tmpl')) destName = destName.slice(0, -5);
    const destPath = join(destDir, destName);
    if (entry.isDirectory()) walkCopy(srcPath, destPath, vars);
    else if (entry.isFile()) {
      if (isTextFile(srcPath)) {
        writeFileSync(destPath, substitute(readFileSync(srcPath, 'utf8'), vars));
      } else {
        writeFileSync(destPath, readFileSync(srcPath));
      }
      try { chmodSync(destPath, statSync(srcPath).mode); } catch {}
    }
  }
}

if (existsSync(TARGET)) rmSync(TARGET, { recursive: true, force: true });

const vars = {
  AGENT_NAME:         'smoke-test',
  AGENT_DISPLAY_NAME: 'Smoke Test',
  PERSONA:            'automated smoke-test agent',
  USER_NAME:          'Tester',
  USER_TG_ID:         '9999999',
  TG_BOT_TOKEN:       '<<DUMMY_TOKEN>>',
  BRAVE_API_KEY:      '',
  AGENT_DIR:          TARGET,
  STATE_DIR:          '/tmp/hermit-smoke-state',
  CLAUDE_BIN:         '/usr/local/bin/claude',
};

walkCopy(TEMPLATE_DIR, TARGET, vars);

// Assertions
const checks = [
  ['settings.json has substituted AGENT_DIR',
    readFileSync(join(TARGET, '.claude/settings.json'), 'utf8').includes(`"Write(${TARGET}/**)"`)],
  ['settings.local.json exists (no .tmpl)',
    existsSync(join(TARGET, '.claude/settings.local.json'))],
  ['settings.local.json has substituted TG_BOT_TOKEN',
    readFileSync(join(TARGET, '.claude/settings.local.json'), 'utf8').includes('<<DUMMY_TOKEN>>')],
  ['settings.local.json has substituted CHAT_ID',
    readFileSync(join(TARGET, '.claude/settings.local.json'), 'utf8').includes('"TELEGRAM_CHAT_ID": "9999999"')],
  ['CLAUDE.md has substituted AGENT_DIR',
    readFileSync(join(TARGET, 'CLAUDE.md'), 'utf8').includes(TARGET)],
  ['IDENTITY.md has substituted display name',
    readFileSync(join(TARGET, 'IDENTITY.md'), 'utf8').includes('Smoke Test')],
  ['TOOLS.md has substituted USER_TG_ID',
    readFileSync(join(TARGET, 'TOOLS.md'), 'utf8').includes('9999999')],
  ['restart.sh has substituted CLAUDE_BIN',
    readFileSync(join(TARGET, 'restart.sh'), 'utf8').includes('/usr/local/bin/claude')],
  ['start.sh exists and is executable',
    (() => { try { return (statSync(join(TARGET, 'start.sh')).mode & 0o111) !== 0; } catch { return false; } })()],
  ['safe-image.sh is executable',
    (() => { try { return (statSync(join(TARGET, 'scripts/safe-image.sh')).mode & 0o111) !== 0; } catch { return false; } })()],
  ['tg-reply-check.sh exists and is executable',
    (() => { try { return (statSync(join(TARGET, '.claude/hooks/tg-reply-check.sh')).mode & 0o111) !== 0; } catch { return false; } })()],
  ['browser/utils/human-like.js present',
    existsSync(join(TARGET, 'scripts/browser/utils/human-like.js'))],
  ['launchd plist substituted',
    readFileSync(join(TARGET, 'launchd/status-reporter.plist'), 'utf8').includes(`com.hermit-agent.smoke-test.status-reporter`)],
  ['no stray {{ placeholder in CLAUDE.md',
    !readFileSync(join(TARGET, 'CLAUDE.md'), 'utf8').includes('{{')],
  ['no stray {{ in IDENTITY.md',
    !readFileSync(join(TARGET, 'IDENTITY.md'), 'utf8').includes('{{')],
  ['no stray {{ in TOOLS.md',
    !readFileSync(join(TARGET, 'TOOLS.md'), 'utf8').includes('{{')],
  ['skills/provision-agent/SKILL.md present',
    existsSync(join(TARGET, '.claude/skills/provision-agent/SKILL.md'))],
  ['skills/add-telegram-user/SKILL.md present',
    existsSync(join(TARGET, '.claude/skills/add-telegram-user/SKILL.md'))],
  ['add-telegram-user frontmatter has owner-only description',
    readFileSync(join(TARGET, '.claude/skills/add-telegram-user/SKILL.md'), 'utf8').includes('Owner-only')],
  ['FIRST_RUN.md present with substituted AGENT_DIR',
    existsSync(join(TARGET, 'FIRST_RUN.md')) &&
    readFileSync(join(TARGET, 'FIRST_RUN.md'), 'utf8').includes(TARGET)],
  ['cron-example plist substituted AGENT_DIR + AGENT_NAME',
    existsSync(join(TARGET, 'launchd/cron-example.plist')) &&
    readFileSync(join(TARGET, 'launchd/cron-example.plist'), 'utf8').includes(`com.hermit-agent.smoke-test.`) &&
    readFileSync(join(TARGET, 'launchd/cron-example.plist'), 'utf8').includes(TARGET)],
  ['AGENTS.md has FIRST_RUN orientation rule',
    readFileSync(join(TARGET, 'AGENTS.md'), 'utf8').includes('If `FIRST_RUN.md` exists')],
  ['hook-tg-strip-markdown.sh exists and is executable',
    (() => { try { return (statSync(join(TARGET, 'scripts/hook-tg-strip-markdown.sh')).mode & 0o111) !== 0; } catch { return false; } })()],
  ['launchd-sync.sh exists and is executable',
    (() => { try { return (statSync(join(TARGET, 'scripts/launchd-sync.sh')).mode & 0o111) !== 0; } catch { return false; } })()],
  ['launchd-sync.sh takes agent-dir arg and has LOADED/RELOAD verbs',
    (() => {
      const s = readFileSync(join(TARGET, 'scripts/launchd-sync.sh'), 'utf8');
      return s.includes('Usage:') && s.includes('LOADED') && s.includes('RELOAD') && s.includes('launchctl load');
    })()],
  ['migrate-openclaw skill present and user-invocable',
    (() => {
      const p = join(TARGET, '.claude/skills/migrate-openclaw/SKILL.md');
      if (!existsSync(p)) return false;
      const s = readFileSync(p, 'utf8');
      return s.includes('user_invocable: true')
        && s.includes('launchd-sync.sh')
        && s.includes('~/.openclaw/')
        && s.includes('com.hermit-agent.');
    })()],
  ['with-timeout.sh exists and is executable',
    (() => { try { return (statSync(join(TARGET, 'scripts/with-timeout.sh')).mode & 0o111) !== 0; } catch { return false; } })()],
  ['with-timeout.sh has watchdog + timeout-124 semantics',
    (() => {
      const s = readFileSync(join(TARGET, 'scripts/with-timeout.sh'), 'utf8');
      return s.includes('kill -TERM') && s.includes('kill -KILL') && s.includes('exit 124');
    })()],
  ['AGENTS.md carries Token Safety section',
    (() => {
      const s = readFileSync(join(TARGET, 'AGENTS.md'), 'utf8');
      return s.includes('## Token Safety') && s.includes('Never grep or find the filesystem for tokens') && s.includes('Never echo / print / log a token');
    })()],
  ['AGENTS.md carries Cron Safety section referring to with-timeout.sh',
    (() => {
      const s = readFileSync(join(TARGET, 'AGENTS.md'), 'utf8');
      return s.includes('## Cron Safety') && s.includes('with-timeout.sh 1200') && s.includes('Stay strictly on-prompt');
    })()],
  ['AGENTS.md Shell Safety bans find on ~/Library and wide pipes',
    (() => {
      const s = readFileSync(join(TARGET, 'AGENTS.md'), 'utf8');
      return s.includes('Never `find /Users/<you>`') && s.includes('find | xargs grep') && s.includes('-maxdepth 3');
    })()],
  ['AGENTS.md Shell Safety also bans wide Glob/Grep tool patterns',
    (() => {
      const s = readFileSync(join(TARGET, 'AGENTS.md'), 'utf8');
      return s.includes('Glob tool') && s.includes('Grep tool')
        && s.includes('ripgrep')
        && s.includes('Three documented incidents')
        && s.includes('`/Users/<you>/**`');
    })()],
  ['hook-context-report.sh hardened: 50MB cap + with-timeout wrapping',
    (() => {
      const s = readFileSync(join(TARGET, 'scripts/hook-context-report.sh'), 'utf8');
      return s.includes('MAX_TRANSCRIPT_BYTES') && s.includes('50 * 1024 * 1024')
        && s.includes('with-timeout.sh') && s.includes('"$WITH_TIMEOUT" 3');
    })()],
  ['AGENTS.md has CLI Commands via Natural Language (no !! sigil, includes restart)',
    (() => {
      const s = readFileSync(join(TARGET, 'AGENTS.md'), 'utf8');
      return s.includes('## CLI Commands via Natural Language')
        && s.includes('exec-cli-command.sh')
        && s.includes('"重启" / "restart"')
        && s.includes('./restart.sh $(cat agent.pid)')
        && !s.includes('Telegram Sigil')
        && !s.includes('`!!compact`')
        && !s.includes('`!!clear`');
    })()],
  ['FIRST_RUN.md uses natural-language examples (no !!)',
    (() => {
      const s = readFileSync(join(TARGET, 'FIRST_RUN.md'), 'utf8');
      return s.includes('压缩上下文') && s.includes('重启') && !s.includes('!!compact');
    })()],
  ['cron-example plist wraps real work in with-timeout.sh',
    (() => {
      const s = readFileSync(join(TARGET, 'launchd/cron-example.plist'), 'utf8');
      return s.includes('./scripts/with-timeout.sh 1200');
    })()],
  ['AGENTS.md carries MCP Registry Safety section',
    (() => {
      const s = readFileSync(join(TARGET, 'AGENTS.md'), 'utf8');
      return s.includes('## MCP Registry Safety')
        && s.includes('claude mcp add')
        && s.includes('invalidates EVERY deferred MCP tool schema')
        && s.includes('./restart.sh')
        && s.includes('NOT a substitute');
    })()],
  ['settings.local.json wires markdown-strip hook for telegram reply+edit',
    (() => {
      const s = JSON.parse(readFileSync(join(TARGET, '.claude/settings.local.json'), 'utf8'));
      const pre = s.hooks?.PreToolUse || [];
      const match = pre.find(e => e.matcher && e.matcher.includes('mcp__plugin_telegram_telegram__reply') && e.matcher.includes('mcp__plugin_telegram_telegram__edit_message'));
      return !!match && match.hooks?.some(h => h.command?.includes('hook-tg-strip-markdown.sh'));
    })()],
  ['pre-read-image.sh exists and is executable',
    (() => { try { return (statSync(join(TARGET, 'scripts/hooks/pre-read-image.sh')).mode & 0o111) !== 0; } catch { return false; } })()],
  ['pre-read-image.sh blocks oversized images via exit 2 + sips dims',
    (() => {
      const s = readFileSync(join(TARGET, 'scripts/hooks/pre-read-image.sh'), 'utf8');
      return s.includes('DIM_LIMIT=2000')
        && s.includes("tool_name = \"Read\"".replace(/"/g,'"')) || s.includes('tool_name" = "Read"')
        || (s.includes('tool_name') && s.includes('Read') && s.includes('exit 2') && s.includes('sips -g pixelWidth') && s.includes('safe-image.sh'));
    })()],
  ['settings.local.json wires Read matcher to pre-read-image.sh',
    (() => {
      const s = JSON.parse(readFileSync(join(TARGET, '.claude/settings.local.json'), 'utf8'));
      const pre = s.hooks?.PreToolUse || [];
      const match = pre.find(e => e.matcher === 'Read');
      return !!match && match.hooks?.some(h => h.command?.includes('pre-read-image.sh'));
    })()],
  ['AGENTS.md Image Safety describes layered defense with hook as Layer 1',
    (() => {
      const s = readFileSync(join(TARGET, 'AGENTS.md'), 'utf8');
      return s.includes('## Image Safety')
        && s.includes('Layer 1 — mechanical')
        && s.includes('pre-read-image.sh')
        && s.includes('fail-closed');
    })()],
  ['multi-agent-status-report.sh has pane_state_check self-heal',
    (() => {
      const s = readFileSync(join(TARGET, 'scripts/multi-agent-status-report.sh'), 'utf8');
      return s.includes('pane_state_check()')
        && s.includes('tmux has-session')
        && s.includes('tmux capture-pane')
        && s.includes('healed_')
        && s.includes('Stop hook likely missed');
    })()],
  ['AGENTS.md MCP Registry Safety has cron -p Bot API exception',
    (() => {
      const s = readFileSync(join(TARGET, 'AGENTS.md'), 'utf8');
      return s.includes('Cron -p exception')
        && s.includes("by design don't run plugin sync")
        && s.includes('is **permitted**');
    })()],
  ['multi-agent-status-report.sh has stuck-escalation tier (🆘 CRITICAL)',
    (() => {
      const s = readFileSync(join(TARGET, 'scripts/multi-agent-status-report.sh'), 'utf8');
      return s.includes('stuck_counts')
        && s.includes('prev_stuck_counts_json')
        && s.includes('🆘')
        && s.includes('CRITICAL stuck')
        && s.includes('consider restart');
    })()],
  ['claude-quota-probe.sh exists and is executable',
    (() => {
      const p = join(TARGET, 'scripts/claude-quota-probe.sh');
      try {
        const stat = statSync(p);
        return stat.isFile() && (stat.mode & 0o111) !== 0;
      } catch { return false; }
    })()],
  ['multi-agent-status-report.sh has claude code usage section',
    (() => {
      const s = readFileSync(join(TARGET, 'scripts/multi-agent-status-report.sh'), 'utf8');
      return s.includes('claude code')
        && s.includes('claude-quota-probe.sh')
        && s.includes('ccusage')
        && s.includes('usage_lines');
    })()],
  // launchd default PATH is /usr/bin:/bin:/usr/sbin:/sbin and the Claude Code
  // installer puts the binary at ~/.local/bin/claude, so both scripts need to
  // prepend that explicitly or the probe silently fails (issue caught on a
  // fresh hermit install at v0.1.26).
  ['multi-agent-status-report.sh PATH includes ~/.local/bin',
    (() => {
      const s = readFileSync(join(TARGET, 'scripts/multi-agent-status-report.sh'), 'utf8');
      return /export PATH=\$HOME\/\.local\/bin:/.test(s);
    })()],
  ['claude-quota-probe.sh PATH includes ~/.local/bin',
    (() => {
      const s = readFileSync(join(TARGET, 'scripts/claude-quota-probe.sh'), 'utf8');
      return /export PATH=\$HOME\/\.local\/bin:/.test(s);
    })()],
  ['provision-clone skill exists with npx flow',
    (() => {
      const p = join(TARGET, '.claude/skills/provision-clone/SKILL.md');
      if (!existsSync(p)) return false;
      const s = readFileSync(p, 'utf8');
      return s.includes('npx create-hermit-agent --clone-of')
        && s.includes('doppel')
        && s.includes('symlink');
    })()],
  ['provision-agent skill names master/worker roles',
    (() => {
      const s = readFileSync(join(TARGET, '.claude/skills/provision-agent/SKILL.md'), 'utf8');
      return s.includes('master') && s.includes('worker');
    })()],
  ['provision-clone skill names master/worker roles',
    (() => {
      const s = readFileSync(join(TARGET, '.claude/skills/provision-clone/SKILL.md'), 'utf8');
      return s.includes('Doppels are always') && s.includes('workers');
    })()],

  // ---- Linux platform support: systemd-user templates + sync script ----
  ['systemd/cron-example.service substituted (AGENT_NAME, AGENT_DIR, no stray {{)',
    (() => {
      const p = join(TARGET, 'systemd/cron-example.service');
      if (!existsSync(p)) return false;
      const s = readFileSync(p, 'utf8');
      return s.includes(`smoke-test`) && s.includes(TARGET) && !s.includes('{{');
    })()],
  ['systemd/cron-example.timer references prefixed service unit',
    (() => {
      const p = join(TARGET, 'systemd/cron-example.timer');
      if (!existsSync(p)) return false;
      return readFileSync(p, 'utf8').includes('Unit=hermit-smoke-test-cron-example.service');
    })()],
  ['systemd/status-reporter.service runs multi-agent-status-report.sh',
    (() => {
      const p = join(TARGET, 'systemd/status-reporter.service');
      if (!existsSync(p)) return false;
      const s = readFileSync(p, 'utf8');
      return s.includes('multi-agent-status-report.sh') && s.includes(TARGET);
    })()],
  ['systemd/status-reporter.timer fires every 10min, prefixed service ref',
    (() => {
      const p = join(TARGET, 'systemd/status-reporter.timer');
      if (!existsSync(p)) return false;
      const s = readFileSync(p, 'utf8');
      return s.includes('OnUnitActiveSec=10min') && s.includes('Unit=hermit-smoke-test-status-reporter.service');
    })()],
  ['scripts/systemd-sync.sh exists, is executable, has INSTALL/UPDATE verbs',
    (() => {
      const p = join(TARGET, 'scripts/systemd-sync.sh');
      try {
        if ((statSync(p).mode & 0o111) === 0) return false;
      } catch { return false; }
      const s = readFileSync(p, 'utf8');
      return s.includes('INSTALL') && s.includes('UPDATE') && s.includes('systemctl --user daemon-reload') && s.includes('enable --now');
    })()],
  ['scripts/systemd-sync.sh warns if lingering not enabled',
    (() => {
      const s = readFileSync(join(TARGET, 'scripts/systemd-sync.sh'), 'utf8');
      return s.includes('loginctl enable-linger') && s.includes('Linger=yes');
    })()],
];

let pass = 0, fail = 0;
for (const [label, result] of checks) {
  if (result) { console.log('✓', label); pass++; }
  else { console.log('✗', label); fail++; }
}
console.log('');
console.log(`Result: ${pass}/${pass+fail} passed`);
if (fail > 0) process.exit(1);
