#!/usr/bin/env node
/**
 * `@feature-maps/hooks` CLI. Installed as the `hooks` bin so that
 *   `npx @feature-maps/hooks <subcommand>`
 * resolves (npx maps the unscoped package name to a like-named bin).
 *
 * Subcommands:
 *   install     Write Stop + SessionEnd hooks into .claude/settings.json.
 *   uninstall   Remove them.
 *   pre-commit  Body of the git pre-commit hook installed by --precommit.
 *               Runs `fmap scan` and stages the resulting files.
 *
 * Flags:
 *   --root <dir>   Project root (default: cwd).
 *   --precommit    Also install/uninstall a git pre-commit hook.
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

// `npx -p <pkg> <bin>` is required because the unscoped package name
// (`hooks`, `core`) doesn't match the bin names we want to run, and
// `@feature-maps/hooks` now has a default `hooks` bin that would otherwise
// swallow these invocations.
const STOP_CMD = 'npx --yes -p @feature-maps/hooks fmap-record';
const SESSION_END_CMD =
  'npx --yes -p @feature-maps/hooks fmap-record' +
  ' && npx --yes -p @feature-maps/hooks fmap-summarize --markEnded' +
  ' && npx --yes -p @feature-maps/core fmap scan';

const PRECOMMIT_MARKER = '// feature-maps-pre-commit';
// Body of the installed .git/hooks/pre-commit. Uses an async IIFE + dynamic
// import() so it works whether the host project is CJS or ESM (nearest
// package.json `"type"` doesn't matter). The actual logic lives in the
// `pre-commit` subcommand of this CLI — the on-disk hook just dispatches.
const PRECOMMIT_CONTENT = `#!/usr/bin/env node
${PRECOMMIT_MARKER}
(async () => {
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync('npx', ['--yes', '@feature-maps/hooks', 'pre-commit'], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
})();
`;

interface ClaudeHookEntry {
  matcher?: string;
  hooks: Array<{ type: string; command: string }>;
}
interface ClaudeSettings {
  hooks?: Record<string, ClaudeHookEntry[]>;
  [k: string]: unknown;
}

interface ParsedArgs {
  cmd: 'install' | 'uninstall' | 'pre-commit';
  root: string;
  precommit: boolean;
}

function usage(): void {
  process.stdout.write(`@feature-maps/hooks — install Claude Code integration

Usage:
  npx @feature-maps/hooks install    [--root <dir>] [--precommit]
  npx @feature-maps/hooks uninstall  [--root <dir>] [--precommit]
  npx @feature-maps/hooks pre-commit [--root <dir>]
  npx @feature-maps/hooks --help

install
  Writes Stop + SessionEnd hooks into <root>/.claude/settings.json so every
  Claude Code session is recorded and summarized into requirements/ and
  .featuremap/. Idempotent — re-running is a no-op if already installed.

  --precommit   Also writes <root>/.git/hooks/pre-commit (regenerates the
                feature map on every commit). Any existing pre-commit hook
                is backed up to pre-commit.bak.
  --root <d>    Project root (default: cwd).

uninstall
  Removes the hooks installed by 'install'. --precommit also removes the
  pre-commit hook (restoring .bak if one exists).
`);
}

function parseArgs(argv: string[]): ParsedArgs {
  if (argv.length === 0) {
    usage();
    process.exit(0);
  }
  const first = argv[0];
  if (first === '-h' || first === '--help') {
    usage();
    process.exit(0);
  }
  if (first !== 'install' && first !== 'uninstall' && first !== 'pre-commit') {
    process.stderr.write(`unknown command: ${first}\n\n`);
    usage();
    process.exit(2);
  }
  let root = process.cwd();
  let precommit = false;
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--precommit') {
      precommit = true;
    } else if (a === '--root') {
      if (i + 1 >= argv.length) {
        process.stderr.write('--root needs a value\n');
        process.exit(2);
      }
      root = path.resolve(argv[++i]);
    } else if (a === '-h' || a === '--help') {
      usage();
      process.exit(0);
    } else {
      process.stderr.write(`unknown arg: ${a}\n`);
      process.exit(2);
    }
  }
  return { cmd: first, root, precommit };
}

function readSettings(file: string): ClaudeSettings {
  if (!fs.existsSync(file)) return {};
  const raw = fs.readFileSync(file, 'utf8').trim();
  if (!raw) return {};
  return JSON.parse(raw) as ClaudeSettings;
}

function writeSettings(file: string, data: ClaudeSettings): void {
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

function addHook(settings: ClaudeSettings, event: string, command: string): boolean {
  settings.hooks ??= {};
  settings.hooks[event] ??= [];
  const already = settings.hooks[event].some(
    (entry) =>
      Array.isArray(entry.hooks) &&
      entry.hooks.some((h) => h.command === command),
  );
  if (already) return false;
  settings.hooks[event].push({
    matcher: '',
    hooks: [{ type: 'command', command }],
  });
  return true;
}

function removeHook(settings: ClaudeSettings, event: string, command: string): boolean {
  const list = settings.hooks?.[event];
  if (!list) return false;
  let changed = false;
  for (let i = list.length - 1; i >= 0; i--) {
    const entry = list[i];
    const before = entry.hooks.length;
    entry.hooks = entry.hooks.filter((h) => h.command !== command);
    if (entry.hooks.length !== before) changed = true;
    if (entry.hooks.length === 0) list.splice(i, 1);
  }
  if (list.length === 0 && settings.hooks) delete settings.hooks[event];
  return changed;
}

function installClaudeHooks(root: string): void {
  const dir = path.join(root, '.claude');
  const file = path.join(dir, 'settings.json');
  fs.mkdirSync(dir, { recursive: true });
  const settings = readSettings(file);
  const a = addHook(settings, 'Stop', STOP_CMD);
  const b = addHook(settings, 'SessionEnd', SESSION_END_CMD);
  writeSettings(file, settings);
  const rel = path.relative(process.cwd(), file) || file;
  if (a || b) {
    process.stdout.write(`installed feature-maps hooks → ${rel}\n`);
  } else {
    process.stdout.write(`feature-maps hooks already present in ${rel}\n`);
  }
  process.stdout.write('  Stop       → records each agent turn\n');
  process.stdout.write('  SessionEnd → finalizes transcript, summarizes into requirements/, regenerates feature map\n');
}

function uninstallClaudeHooks(root: string): void {
  const file = path.join(root, '.claude', 'settings.json');
  const rel = path.relative(process.cwd(), file) || file;
  if (!fs.existsSync(file)) {
    process.stdout.write(`no ${rel} — nothing to remove\n`);
    return;
  }
  const settings = readSettings(file);
  const a = removeHook(settings, 'Stop', STOP_CMD);
  const b = removeHook(settings, 'SessionEnd', SESSION_END_CMD);
  writeSettings(file, settings);
  if (a || b) {
    process.stdout.write(`removed feature-maps hooks from ${rel}\n`);
  } else {
    process.stdout.write(`no feature-maps hooks found in ${rel}\n`);
  }
}

function installPrecommit(root: string): void {
  if (!fs.existsSync(path.join(root, '.git'))) {
    process.stderr.write('warning: not a git repo — skipping --precommit\n');
    return;
  }
  const dir = path.join(root, '.git', 'hooks');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'pre-commit');
  const rel = path.relative(process.cwd(), file) || file;
  if (fs.existsSync(file)) {
    const existing = fs.readFileSync(file, 'utf8');
    if (existing.includes(PRECOMMIT_MARKER)) {
      process.stdout.write(`pre-commit already installed: ${rel}\n`);
      return;
    }
    const bak = file + '.bak';
    fs.copyFileSync(file, bak);
    process.stdout.write(`backed up existing pre-commit → ${path.relative(process.cwd(), bak) || bak}\n`);
  }
  fs.writeFileSync(file, PRECOMMIT_CONTENT);
  fs.chmodSync(file, 0o755);
  process.stdout.write(`installed ${rel}\n`);
}

function uninstallPrecommit(root: string): void {
  const file = path.join(root, '.git', 'hooks', 'pre-commit');
  const rel = path.relative(process.cwd(), file) || file;
  if (!fs.existsSync(file)) {
    process.stdout.write(`no ${rel} — nothing to remove\n`);
    return;
  }
  const content = fs.readFileSync(file, 'utf8');
  if (!content.includes(PRECOMMIT_MARKER)) {
    process.stdout.write(`${rel} was not installed by feature-maps — leaving alone\n`);
    return;
  }
  fs.unlinkSync(file);
  const bak = file + '.bak';
  if (fs.existsSync(bak)) {
    fs.renameSync(bak, file);
    process.stdout.write(`restored previous pre-commit from .bak\n`);
  } else {
    process.stdout.write(`removed ${rel}\n`);
  }
}

function runPrecommit(root: string): void {
  // Regenerate the feature map and stage the result. Invoked from the
  // installed .git/hooks/pre-commit dispatcher.
  const scan = spawnSync(
    'npx',
    ['--yes', '-p', '@feature-maps/core', 'fmap', 'scan', '--quiet', '--root', root],
    { stdio: 'inherit' },
  );
  if (scan.status !== 0) {
    process.exit(scan.status ?? 1);
  }
  const candidates = ['.featuremap', 'requirements'].filter((p) =>
    fs.existsSync(path.join(root, p)),
  );
  if (candidates.length > 0) {
    spawnSync('git', ['add', ...candidates], { cwd: root, stdio: 'inherit' });
  }
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  switch (args.cmd) {
    case 'install':
      installClaudeHooks(args.root);
      if (args.precommit) installPrecommit(args.root);
      return;
    case 'uninstall':
      uninstallClaudeHooks(args.root);
      if (args.precommit) uninstallPrecommit(args.root);
      return;
    case 'pre-commit':
      runPrecommit(args.root);
      return;
  }
}

main();
