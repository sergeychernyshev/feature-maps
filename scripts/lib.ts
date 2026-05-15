import { execFileSync, spawnSync, type SpawnSyncOptions } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

export interface PackageInfo {
  dir: string;          // "core" | "hooks" | "vscode-extension"
  name: string;         // "@feature-maps/core" etc.
  version: string;
  jsonPath: string;     // absolute path to package.json
}

// Listed in publish/dep order: core before hooks (hooks depends on core).
export const PACKAGE_DIRS = ['core', 'hooks', 'vscode-extension'] as const;
export type PackageDir = (typeof PACKAGE_DIRS)[number];

export function loadPackage(dir: PackageDir): PackageInfo {
  const jsonPath = path.join(REPO_ROOT, 'packages', dir, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as {
    name: string;
    version: string;
  };
  return { dir, name: pkg.name, version: pkg.version, jsonPath };
}

export function writePackageVersion(info: PackageInfo, version: string): void {
  const raw = fs.readFileSync(info.jsonPath, 'utf8');
  const json = JSON.parse(raw) as Record<string, unknown>;
  json.version = version;
  fs.writeFileSync(info.jsonPath, JSON.stringify(json, null, 2) + '\n');
}

export function writePackageDep(
  info: PackageInfo,
  dep: string,
  version: string,
): void {
  const raw = fs.readFileSync(info.jsonPath, 'utf8');
  const json = JSON.parse(raw) as {
    dependencies?: Record<string, string>;
  };
  if (!json.dependencies || json.dependencies[dep] === undefined) {
    throw new Error(`no such dep ${dep} in ${info.jsonPath}`);
  }
  json.dependencies[dep] = version;
  fs.writeFileSync(info.jsonPath, JSON.stringify(json, null, 2) + '\n');
}

export type BumpKind = 'patch' | 'minor' | 'major';

export function bumpSemver(version: string, kind: BumpKind): string {
  const parts = version.split('.').map((n) => Number(n));
  if (parts.length !== 3 || parts.some(Number.isNaN)) {
    throw new Error(`bad version: ${version}`);
  }
  const [maj, min, pat] = parts;
  switch (kind) {
    case 'major': return `${maj + 1}.0.0`;
    case 'minor': return `${maj}.${min + 1}.0`;
    case 'patch': return `${maj}.${min}.${pat + 1}`;
  }
}

// --- git --------------------------------------------------------------------

export function git(args: string[]): string {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
}

export function gitWorkingTreeDirty(): string {
  return git(['status', '--porcelain']);
}

export function gitLatestTagForPackage(name: string): string | null {
  // Tag names can contain `@`; git is fine with this.
  const out = git(['tag', '--list', `${name}@*`, '--sort=-v:refname']);
  if (!out) return null;
  return out.split('\n')[0];
}

export function gitDirHasChangesSinceTag(tag: string, dir: PackageDir): boolean {
  // `git diff --quiet` exits 0 if no diff, 1 if diff. We can't use git() because
  // a non-zero exit would throw. Use spawnSync and inspect status.
  const r = spawnSync('git', ['diff', '--quiet', tag, '--', `packages/${dir}`], {
    cwd: REPO_ROOT,
    stdio: 'ignore',
  });
  if (r.status === 0) return false;
  if (r.status === 1) return true;
  throw new Error(`git diff failed for ${dir} since ${tag} (status ${r.status})`);
}

export function gitTagExists(tag: string): boolean {
  const r = spawnSync('git', ['rev-parse', '-q', '--verify', `refs/tags/${tag}`], {
    cwd: REPO_ROOT,
    stdio: 'ignore',
  });
  return r.status === 0;
}

// --- generic runner ---------------------------------------------------------

export function run(
  cmd: string,
  args: string[],
  opts: SpawnSyncOptions = {},
): void {
  process.stderr.write(`+ ${cmd} ${args.join(' ')}\n`);
  const r = spawnSync(cmd, args, {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    ...opts,
  });
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} failed (status ${r.status})`);
  }
}

export function printDry(cmd: string, args: string[]): void {
  process.stderr.write(`+ ${cmd} ${args.join(' ')}   (dry run)\n`);
}

// --- working-tree guard -----------------------------------------------------

export function ensureCleanTree(dryRun: boolean): void {
  const dirty = gitWorkingTreeDirty();
  if (!dirty) return;
  if (dryRun) {
    process.stderr.write(
      `warning: working tree has uncommitted changes (continuing because --dry-run):\n`,
    );
    process.stderr.write(dirty + '\n\n');
    return;
  }
  process.stderr.write(
    `error: working tree has uncommitted changes. Commit or stash first.\n`,
  );
  process.stderr.write(dirty + '\n');
  process.exit(1);
}
