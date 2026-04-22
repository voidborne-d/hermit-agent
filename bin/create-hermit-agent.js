#!/usr/bin/env node
// create-hermit-agent — scaffold a new Telegram-connected Claude Code agent.
//
// Usage:
//   npx create-hermit-agent <name>                          Interactive prompts.
//   npx create-hermit-agent <name> --yes \
//     --bot-token <token> --user-id <chat-id> \
//     --persona "<one-line>" [--brave-key <key>]            Non-interactive.
//
// The <name> can be a plain name (placed under CWD) or a path.

import { parseArgs } from 'node:util';
import {
  existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync,
  chmodSync, statSync,
} from 'node:fs';
import { join, resolve, dirname, basename, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir, platform } from 'node:os';
import { spawnSync, execSync } from 'node:child_process';

const prompts = (await import('prompts')).default;

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = resolve(__dirname, '..');
const TEMPLATE_DIR = join(PACKAGE_DIR, 'template');

const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const blue = (s) => `\x1b[34m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

function die(msg) {
  console.error(red('✖ ') + msg);
  process.exit(1);
}

function step(msg) {
  console.log(blue('▸ ') + msg);
}

function ok(msg) {
  console.log(green('✓ ') + msg);
}

function warn(msg) {
  console.log(yellow('⚠ ') + msg);
}

// --- Prerequisite checks ---

function checkPrereqs() {
  if (platform() !== 'darwin') {
    die('Hermit Agent currently supports macOS only. (Linux/Windows support welcome as contributions — see README.)');
  }

  const nodeMajor = parseInt(process.versions.node.split('.')[0], 10);
  if (nodeMajor < 18) {
    die(`Node.js 18+ required. You're on ${process.versions.node}.`);
  }

  const which = (bin) => {
    const r = spawnSync('which', [bin], { encoding: 'utf8' });
    return r.status === 0 ? r.stdout.trim() : null;
  };

  const claude = which('claude');
  if (!claude) {
    die('claude CLI not found on PATH.\n  Install it from https://docs.claude.com/claude-code, then re-run.');
  }

  const tmux = which('tmux');
  if (!tmux) {
    die('tmux not found on PATH.\n  Install with: brew install tmux');
  }

  const bunPath = which('bun') || (existsSync(`${homedir()}/.bun/bin/bun`) ? `${homedir()}/.bun/bin/bun` : null);
  if (!bunPath) {
    warn('bun not found. The Telegram plugin needs bun to run its server subprocess.');
    warn('Install with: curl -fsSL https://bun.sh/install | bash   (then reopen your terminal)');
    warn('Continuing — bun is only needed at agent runtime, not at scaffold time.');
  }

  const jq = which('jq');
  if (!jq) {
    warn('jq not found. Hooks and status scripts use jq. Install with: brew install jq');
  }

  return { claude, tmux, bun: bunPath, jq };
}

// --- Arg parsing ---

function parseCliArgs() {
  let args;
  try {
    args = parseArgs({
      allowPositionals: true,
      strict: true,
      options: {
        'bot-token':  { type: 'string' },
        'user-id':    { type: 'string' },
        'persona':    { type: 'string' },
        'brave-key':  { type: 'string' },
        'yes':        { type: 'boolean', short: 'y', default: false },
        'help':       { type: 'boolean', short: 'h', default: false },
      },
    });
  } catch (e) {
    die(`Invalid arguments: ${e.message}\n  Run: create-hermit-agent --help`);
  }

  if (args.values.help) {
    console.log(`
Usage:  create-hermit-agent <name> [options]

Arguments:
  <name>                Folder name (relative to cwd) or absolute path.

Options:
  --bot-token <token>   Telegram bot token from @BotFather.
  --user-id <chat-id>   Your Telegram user/chat id (from @userinfobot).
  --persona "<line>"    One-line description of what this agent focuses on.
  --brave-key <key>     (Optional) Brave Search API key.
  --yes, -y             Skip interactive prompts (requires the above).
  --help, -h            Show this message.

Examples:
  create-hermit-agent my-agent
  create-hermit-agent my-agent -y --bot-token 123:ABC --user-id 1234567 --persona "triage my github notifications"
`);
    process.exit(0);
  }

  return args;
}

// --- Telegram ---

async function validateBotToken(token) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const body = await res.json();
    return body.ok ? body.result : null;
  } catch (e) {
    return null;
  }
}

// --- Interactive prompts ---

async function collectAnswers(values, positional) {
  const nameArg = positional || values['_name'];
  let name;
  if (nameArg) {
    name = nameArg;
  } else if (values.yes) {
    // Default the first-install name to `asst` for non-interactive mode.
    name = 'asst';
  } else {
    const { input } = await prompts({
      type: 'text',
      name: 'input',
      message: 'Agent name (folder)',
      initial: 'asst',
      validate: (v) => {
        if (!v) return 'Required';
        if (!/^[a-z0-9][a-z0-9_-]*$/.test(basename(v))) return 'Use lowercase letters, digits, - or _ (must start alphanumeric)';
        return true;
      },
    });
    if (!input) process.exit(1);
    name = input;
  }

  const targetDir = resolve(process.cwd(), name);
  if (existsSync(targetDir)) {
    die(`Directory already exists: ${targetDir}\n  Choose a different name or delete it first.`);
  }
  if (existsSync(dirname(targetDir)) === false) {
    die(`Parent directory does not exist: ${dirname(targetDir)}`);
  }

  let botToken = values['bot-token'];
  if (!botToken) {
    if (values.yes) die('--bot-token required with --yes');
    const r = await prompts({
      type: 'password',
      name: 'token',
      message: 'Telegram bot token (from @BotFather)',
      validate: (v) => (v && /^[0-9]+:[A-Za-z0-9_-]{30,}$/.test(v.trim())) ? true : 'Looks malformed — expected 123456789:ABCdef…',
    });
    if (!r.token) process.exit(1);
    botToken = r.token.trim();
  }
  botToken = botToken.trim();

  step('Verifying bot token against Telegram…');
  const bot = await validateBotToken(botToken);
  if (!bot) {
    die('Telegram rejected the token (bot not found or network error). Check it and try again.');
  }
  ok(`Bot verified: @${bot.username} (${bot.first_name})`);

  let userId = values['user-id'];
  if (!userId) {
    if (values.yes) die('--user-id required with --yes');
    const r = await prompts({
      type: 'text',
      name: 'userId',
      message: 'Your Telegram user ID (message @userinfobot on Telegram to find it)',
      validate: (v) => (v && /^-?[0-9]+$/.test(v.trim())) ? true : 'Expected a numeric ID (e.g. 123456789)',
    });
    if (!r.userId) process.exit(1);
    userId = r.userId.trim();
  }
  userId = String(userId).trim();

  let persona = values.persona;
  if (!persona) {
    if (values.yes) persona = 'personal assistant';
    else {
      const r = await prompts({
        type: 'text',
        name: 'persona',
        message: 'Persona — one line, what does this agent focus on?',
        initial: 'personal assistant',
      });
      persona = (r.persona || 'personal assistant').trim();
    }
  }

  let braveKey = values['brave-key'];
  if (!braveKey && !values.yes) {
    const r = await prompts({
      type: 'text',
      name: 'braveKey',
      message: 'Brave Search API key (optional — leave blank to skip)',
      initial: '',
    });
    braveKey = (r.braveKey || '').trim();
  }
  braveKey = braveKey || '';

  const agentName = basename(targetDir);
  const displayName = agentName.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const stateDir = join(homedir(), '.claude', 'channels', `telegram-${agentName}`);

  return {
    agentName,
    displayName,
    persona,
    userName: bot.first_name || agentName,
    userTgId: userId,
    botToken,
    braveKey,
    targetDir,
    stateDir,
    botUsername: bot.username,
  };
}

// --- Template copy ---

// Textual files we substitute placeholders in. Binary files (images, etc.)
// are copied byte-for-byte. The list is whitelist-based to avoid mangling data.
const TEXT_EXTS = new Set([
  '.md', '.json', '.js', '.ts', '.sh', '.bash', '.zsh', '.plist',
  '.toml', '.yml', '.yaml', '.tmpl', '.gitkeep', '.gitignore',
]);

function isTextFile(path) {
  if (path.endsWith('.gitignore') || path.endsWith('.gitkeep')) return true;
  const i = path.lastIndexOf('.');
  if (i < 0) return true; // shell scripts with no extension
  const ext = path.slice(i);
  return TEXT_EXTS.has(ext);
}

function substitute(content, vars) {
  return content.replace(/\{\{(\w+)\}\}/g, (m, key) => {
    if (key in vars) return vars[key];
    return m; // leave unknown placeholders untouched
  });
}

function walkCopy(srcDir, destDir, vars) {
  if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = join(srcDir, entry.name);
    let destName = entry.name;
    // Strip `.tmpl` suffix so settings.local.json.tmpl → settings.local.json
    if (destName.endsWith('.tmpl')) destName = destName.slice(0, -5);

    const destPath = join(destDir, destName);
    if (entry.isDirectory()) {
      walkCopy(srcPath, destPath, vars);
    } else if (entry.isFile()) {
      if (isTextFile(srcPath)) {
        const raw = readFileSync(srcPath, 'utf8');
        writeFileSync(destPath, substitute(raw, vars));
      } else {
        // Binary: copy as-is
        writeFileSync(destPath, readFileSync(srcPath));
      }
      // Preserve executable bit for scripts
      try {
        const mode = statSync(srcPath).mode;
        chmodSync(destPath, mode);
      } catch {}
    }
  }
}

function makeExecutable(filePath) {
  try { chmodSync(filePath, 0o755); } catch {}
}

// --- Plugin install ---

function installTelegramPlugin(claudeBin, targetDir) {
  step('Installing telegram plugin at project scope…');
  const r = spawnSync(claudeBin, ['plugin', 'install', 'telegram@claude-plugins-official', '-s', 'project'], {
    cwd: targetDir,
    stdio: 'inherit',
  });
  if (r.status !== 0) {
    die(`claude plugin install failed with exit code ${r.status}. Inspect the output above and re-run.`);
  }
  ok('Telegram plugin registered.');
}

// --- State dir + .env ---

function writeStateDir(stateDir, botToken, userId) {
  step(`Writing state dir: ${stateDir}`);
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });

  const envPath = join(stateDir, '.env');
  writeFileSync(envPath, `TELEGRAM_BOT_TOKEN=${botToken}\n`, { mode: 0o600 });
  chmodSync(envPath, 0o600);
  ok(`.env written at ${envPath} (mode 600)`);

  // Pre-populate access.json so the user's own DMs are allowed from message 1.
  // Without this, the plugin defaults to pairing mode and the first DM replies
  // with a 6-char code that the user would have to approve inside the claude
  // REPL with /telegram:access pair <code> — painful first-run UX.
  // dmPolicy stays "pairing" so strangers who find the bot's @handle still get
  // the pairing flow rather than silent delivery.
  const accessPath = join(stateDir, 'access.json');
  const access = {
    dmPolicy: 'pairing',
    allowFrom: [String(userId)],
    groups: {},
    pending: {},
  };
  writeFileSync(accessPath, JSON.stringify(access, null, 2) + '\n', { mode: 0o600 });
  chmodSync(accessPath, 0o600);
  ok(`access.json written (user ${userId} pre-allowed, no pairing step needed)`);
}

// --- npm install for playwright ---

function npmInstall(targetDir) {
  step('Running npm install (for playwright browser-automation)…');
  const r = spawnSync('npm', ['install', '--no-audit', '--no-fund', '--silent'], {
    cwd: targetDir,
    stdio: 'inherit',
  });
  if (r.status !== 0) {
    warn(`npm install exited ${r.status}. Browser automation may not work until you re-run 'npm install' in ${targetDir}.`);
  } else {
    ok('npm install complete.');
  }
}

// --- Make all .sh executable ---

function chmodScripts(targetDir) {
  const candidates = [
    'start.sh',
    'restart.sh',
    'scripts/safe-image.sh',
    'scripts/exec-cli-command.sh',
    'scripts/hook-session-state.sh',
    'scripts/hook-tool-activity.sh',
    'scripts/hook-context-report.sh',
    'scripts/hook-tg-strip-markdown.sh',
    'scripts/multi-agent-status-report.sh',
    'scripts/chrome-launcher.sh',
    'scripts/browser-lock.sh',
    'scripts/playwright-mcp-launcher.sh',
    '.claude/hooks/tg-reply-check.sh',
  ];
  for (const rel of candidates) {
    const abs = join(targetDir, rel);
    if (existsSync(abs)) makeExecutable(abs);
  }
}

// --- Main ---

async function main() {
  console.log('');
  console.log(bold('🦀 create-hermit-agent'));
  console.log(dim('Bootstrapping a Telegram-connected Claude Code agent…'));
  console.log('');

  const prereqs = checkPrereqs();

  const cli = parseCliArgs();
  const positional = cli.positionals[0];
  const answers = await collectAnswers(cli.values, positional);

  console.log('');
  console.log(bold('Plan:'));
  console.log(`  Agent       : ${answers.agentName}`);
  console.log(`  Bot         : @${answers.botUsername}`);
  console.log(`  Target dir  : ${answers.targetDir}`);
  console.log(`  State dir   : ${answers.stateDir}`);
  console.log(`  Persona     : ${answers.persona}`);
  console.log(`  Brave key   : ${answers.braveKey ? '(set)' : '(none)'}`);
  console.log('');

  if (!cli.values.yes) {
    const { go } = await prompts({
      type: 'confirm',
      name: 'go',
      message: 'Proceed?',
      initial: true,
    });
    if (!go) {
      console.log(dim('Aborted.'));
      process.exit(0);
    }
  }

  // 1. Copy template
  step('Copying template…');
  const vars = {
    AGENT_NAME:           answers.agentName,
    AGENT_DISPLAY_NAME:   answers.displayName,
    PERSONA:              answers.persona,
    USER_NAME:            answers.userName,
    USER_TG_ID:           answers.userTgId,
    TG_BOT_TOKEN:         answers.botToken,
    BRAVE_API_KEY:        answers.braveKey,
    AGENT_DIR:            answers.targetDir,
    STATE_DIR:            answers.stateDir,
    CLAUDE_BIN:           prereqs.claude,
  };
  walkCopy(TEMPLATE_DIR, answers.targetDir, vars);
  chmodScripts(answers.targetDir);
  ok(`Template copied to ${answers.targetDir}`);

  // 2. Write state dir (.env + access.json)
  writeStateDir(answers.stateDir, answers.botToken, answers.userTgId);

  // 3. Install telegram plugin at project scope
  installTelegramPlugin(prereqs.claude, answers.targetDir);

  // 4. npm install for playwright
  npmInstall(answers.targetDir);

  // 5. Final printout
  const tmuxSession = `claude-${answers.agentName}`;
  console.log('');
  console.log(green(bold('✓ Agent ready.')));
  console.log('');
  console.log(bold('Next steps:'));
  console.log(`  1. Start it:`);
  console.log(`       cd ${relative(process.cwd(), answers.targetDir) || '.'}`);
  console.log(`       ./start.sh`);
  console.log('');
  console.log(`  2. Send any message to your bot on Telegram → @${answers.botUsername}`);
  console.log('');
  console.log(`  3. Attach to the session to watch:`);
  console.log(`       tmux attach -t ${tmuxSession}    ${dim('(detach: Ctrl-b d)')}`);
  console.log('');
  console.log(dim(`Multi-agent status digest (optional, runs on asst only) is off by default. To enable:`));
  console.log(dim(`  cp ${join(answers.targetDir, 'launchd/status-reporter.plist.tmpl')} ~/Library/LaunchAgents/com.hermit-agent.${answers.agentName}.status-reporter.plist`));
  console.log(dim(`  launchctl load ~/Library/LaunchAgents/com.hermit-agent.${answers.agentName}.status-reporter.plist`));
  console.log('');
}

main().catch((e) => {
  console.error(red('Fatal: '), e);
  process.exit(1);
});
