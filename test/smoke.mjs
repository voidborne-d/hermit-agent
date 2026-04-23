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
  ['cron-example plist wraps real work in with-timeout.sh',
    (() => {
      const s = readFileSync(join(TARGET, 'launchd/cron-example.plist'), 'utf8');
      return s.includes('./scripts/with-timeout.sh 1200');
    })()],
  ['settings.local.json wires markdown-strip hook for telegram reply+edit',
    (() => {
      const s = JSON.parse(readFileSync(join(TARGET, '.claude/settings.local.json'), 'utf8'));
      const pre = s.hooks?.PreToolUse || [];
      const match = pre.find(e => e.matcher && e.matcher.includes('mcp__plugin_telegram_telegram__reply') && e.matcher.includes('mcp__plugin_telegram_telegram__edit_message'));
      return !!match && match.hooks?.some(h => h.command?.includes('hook-tg-strip-markdown.sh'));
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
