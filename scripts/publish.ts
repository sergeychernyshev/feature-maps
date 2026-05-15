/**
 * Publish all three packages:
 *   @feature-maps/core    → npm
 *   @feature-maps/hooks   → npm (after core; hooks pins core at exact version)
 *   feature-maps-vscode   → VS Code Marketplace via vsce
 *
 * Run scripts/release.ts first if you want versions bumped.
 *
 * Prereqs:
 *   - npm login with publish rights to the @feature-maps scope
 *   - vsce login feature-maps (unless --skip-vscode); falls back to
 *     `npx @vscode/vsce` if `vsce` is not on PATH.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  REPO_ROOT,
  PACKAGE_DIRS,
  ensureCleanTree,
  loadPackage,
  run,
  printDry,
} from './lib.ts';

interface Args {
  dryRun: boolean;
  skipVscode: boolean;
  tag: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { dryRun: false, skipVscode: false, tag: 'latest' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--dry-run': args.dryRun = true; break;
      case '--skip-vscode': args.skipVscode = true; break;
      case '--tag':
        if (i + 1 >= argv.length) {
          process.stderr.write('--tag needs a value\n');
          process.exit(2);
        }
        args.tag = argv[++i];
        break;
      case '-h':
      case '--help':
        process.stdout.write(`Publish all three packages.

Usage:
  npm run publish-all -- [--dry-run] [--skip-vscode] [--tag <dist-tag>]

  --dry-run        print what would happen, change nothing
  --skip-vscode    skip the VS Code Marketplace step
  --tag <name>     npm dist-tag for the two npm packages (default: latest)
`);
        process.exit(0);
      default:
        process.stderr.write(`unknown arg: ${a}\n`);
        process.exit(2);
    }
  }
  return args;
}

function maybeRun(dryRun: boolean, cmd: string, cmdArgs: string[], opts: { cwd?: string } = {}): void {
  if (dryRun) {
    printDry(cmd, cmdArgs);
  } else {
    run(cmd, cmdArgs, opts);
  }
}

function vsceCommand(): { cmd: string; prefix: string[] } {
  const probe = spawnSync('which', ['vsce'], { encoding: 'utf8' });
  if (probe.status === 0 && probe.stdout.trim()) {
    return { cmd: 'vsce', prefix: [] };
  }
  return { cmd: 'npx', prefix: ['--yes', '@vscode/vsce'] };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  ensureCleanTree(args.dryRun);

  const core = loadPackage('core');
  const hooks = loadPackage('hooks');
  const vscode = loadPackage('vscode-extension');

  // Verify hooks's pinned core dep matches the core version we're about to ship,
  // so a fresh install of hooks resolves the just-published core.
  const hooksPkgJson = JSON.parse(
    fs.readFileSync(hooks.jsonPath, 'utf8'),
  ) as { dependencies: Record<string, string> };
  const hooksCoreDep = hooksPkgJson.dependencies['@feature-maps/core'];
  if (hooksCoreDep !== core.version) {
    process.stderr.write(
      `error: hooks pins @feature-maps/core@${hooksCoreDep} but core is ${core.version}\n`,
    );
    process.exit(1);
  }

  process.stdout.write('publishing:\n');
  process.stdout.write(`  ${core.name}   ${core.version}   → npm (tag: ${args.tag})\n`);
  process.stdout.write(`  ${hooks.name}  ${hooks.version}  → npm (tag: ${args.tag})\n`);
  if (!args.skipVscode) {
    process.stdout.write(`  ${vscode.name}  ${vscode.version} → VS Code Marketplace\n`);
  }
  if (args.dryRun) process.stdout.write('(dry run — no changes will be made)\n');
  process.stdout.write('\n');

  // Build everything from a clean install so what's published matches the lock.
  maybeRun(args.dryRun, 'npm', ['ci']);
  maybeRun(args.dryRun, 'npm', ['run', 'build', '--workspaces', '--if-present']);

  // Publish core, then hooks (order matters — hooks pins core).
  for (const pkg of [core, hooks]) {
    maybeRun(args.dryRun, 'npm', [
      'publish',
      '--workspace', pkg.name,
      '--access', 'public',
      '--tag', args.tag,
    ]);
  }

  if (!args.skipVscode) {
    const { cmd, prefix } = vsceCommand();
    const cwd = path.join(REPO_ROOT, 'packages', 'vscode-extension');
    maybeRun(args.dryRun, cmd, [...prefix, 'publish'], { cwd });
  }

  process.stdout.write('\ndone.\n');
}

main();
