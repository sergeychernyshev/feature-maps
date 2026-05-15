/**
 * Release: for each package, detect changes since its last per-package git tag,
 * bump versions, commit, and tag. Does NOT publish — run scripts/publish.ts
 * afterward.
 *
 * Tag format: `<pkg-name>@<version>` (e.g. `@feature-maps/core@0.2.0`).
 *
 * Coupling: @feature-maps/hooks pins @feature-maps/core at an exact version.
 * If core bumps, hooks is auto-bumped too and its dep is rewritten.
 */
import {
  PACKAGE_DIRS,
  type PackageDir,
  type PackageInfo,
  type BumpKind,
  bumpSemver,
  ensureCleanTree,
  git,
  gitDirHasChangesSinceTag,
  gitLatestTagForPackage,
  gitTagExists,
  loadPackage,
  run,
  writePackageDep,
  writePackageVersion,
} from './lib.ts';

interface Args {
  bump: BumpKind;
  dryRun: boolean;
  noPush: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { bump: 'patch', dryRun: false, noPush: false };
  for (const a of argv) {
    switch (a) {
      case '--patch': args.bump = 'patch'; break;
      case '--minor': args.bump = 'minor'; break;
      case '--major': args.bump = 'major'; break;
      case '--dry-run': args.dryRun = true; break;
      case '--no-push': args.noPush = true; break;
      case '-h':
      case '--help':
        process.stdout.write(`Release: bump versions for packages that changed since their last tag.

Usage:
  npm run release -- [--patch|--minor|--major] [--dry-run] [--no-push]

  --patch (default), --minor, --major   bump kind
  --dry-run                              print the plan, change nothing
  --no-push                              commit and tag locally only

Notes:
  - "Changed" = git diff <last-tag> -- packages/<dir> is non-empty.
  - First release of a package (no prior tag): tag current version, no bump.
  - If @feature-maps/core bumps, @feature-maps/hooks bumps too and its
    pinned dep on @feature-maps/core is rewritten.
`);
        process.exit(0);
      default:
        process.stderr.write(`unknown arg: ${a}\n`);
        process.exit(2);
    }
  }
  return args;
}

interface PlanEntry {
  dir: PackageDir;
  info: PackageInfo;
  oldVersion: string;
  newVersion: string;
  changed: boolean;
  reason: string;
}

function buildPlan(bump: BumpKind): PlanEntry[] {
  const plan: PlanEntry[] = [];
  for (const dir of PACKAGE_DIRS) {
    const info = loadPackage(dir);
    const tag = gitLatestTagForPackage(info.name);
    if (tag === null) {
      plan.push({
        dir, info,
        oldVersion: info.version,
        newVersion: info.version,
        changed: true,
        reason: 'no prior tag — first release',
      });
    } else if (gitDirHasChangesSinceTag(tag, dir)) {
      plan.push({
        dir, info,
        oldVersion: info.version,
        newVersion: bumpSemver(info.version, bump),
        changed: true,
        reason: `changes since ${tag}`,
      });
    } else {
      plan.push({
        dir, info,
        oldVersion: info.version,
        newVersion: info.version,
        changed: false,
        reason: `unchanged since ${tag}`,
      });
    }
  }

  // Coupling: if core bumps, hooks must bump too (it pins core exactly).
  const core = plan.find((p) => p.dir === 'core')!;
  const hooks = plan.find((p) => p.dir === 'hooks')!;
  if (
    core.changed &&
    core.oldVersion !== core.newVersion &&
    !hooks.changed
  ) {
    hooks.changed = true;
    hooks.newVersion = bumpSemver(hooks.oldVersion, bump);
    hooks.reason = `core bumped (${core.oldVersion} → ${core.newVersion}); hooks pins core`;
  }

  return plan;
}

function printPlan(plan: PlanEntry[], bump: BumpKind): boolean {
  process.stdout.write(`Release plan (${bump} bump):\n`);
  let any = false;
  for (const e of plan) {
    if (e.changed) {
      if (e.oldVersion === e.newVersion) {
        process.stdout.write(
          `  ${e.info.name}: tag ${e.newVersion} (no bump — ${e.reason})\n`,
        );
      } else {
        process.stdout.write(
          `  ${e.info.name}: ${e.oldVersion} → ${e.newVersion}  (${e.reason})\n`,
        );
      }
      any = true;
    } else {
      process.stdout.write(
        `  ${e.info.name}: ${e.oldVersion}  (skipping — ${e.reason})\n`,
      );
    }
  }
  return any;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  ensureCleanTree(args.dryRun);

  const plan = buildPlan(args.bump);
  const any = printPlan(plan, args.bump);

  if (!any) {
    process.stdout.write('\nNothing to release.\n');
    return;
  }
  if (args.dryRun) {
    process.stdout.write('\n(dry run — no files written, no commit, no tags)\n');
    return;
  }

  // Apply version bumps.
  const tagsToCreate: string[] = [];
  for (const e of plan) {
    if (!e.changed) continue;
    if (e.oldVersion !== e.newVersion) {
      writePackageVersion(e.info, e.newVersion);
    }
    tagsToCreate.push(`${e.info.name}@${e.newVersion}`);
  }

  // Sync hooks's pinned dep on core if core's version changed.
  const core = plan.find((p) => p.dir === 'core')!;
  if (core.changed && core.oldVersion !== core.newVersion) {
    const hooksInfo = loadPackage('hooks');
    writePackageDep(hooksInfo, '@feature-maps/core', core.newVersion);
  }

  // Refresh the lockfile to match new workspace versions (only if any pkg
  // file actually changed on disk).
  const changedPkgJson = git(['status', '--porcelain', '--', 'packages/*/package.json']);
  if (changedPkgJson) {
    run('npm', [
      'install',
      '--package-lock-only',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
    ]);
  }

  // Commit if anything's on disk.
  const dirtyAfter = git(['status', '--porcelain']);
  if (dirtyAfter) {
    run('git', ['add', 'packages', 'package-lock.json']);
    const subject = `release: ${tagsToCreate.join(', ')}`;
    const body = plan
      .filter((e) => e.changed && e.oldVersion !== e.newVersion)
      .map((e) => `- ${e.info.name}: ${e.oldVersion} → ${e.newVersion} (${e.reason})`)
      .join('\n');
    const msgArgs = body ? ['commit', '-m', subject, '-m', body] : ['commit', '-m', subject];
    run('git', msgArgs);
  }

  // Tags on HEAD.
  for (const tag of tagsToCreate) {
    if (gitTagExists(tag)) {
      process.stderr.write(`tag already exists: ${tag} (skipping)\n`);
    } else {
      run('git', ['tag', '-a', tag, '-m', tag]);
    }
  }

  if (!args.noPush) {
    run('git', ['push']);
    run('git', ['push', '--tags']);
  } else {
    process.stdout.write('\nLocal only. Push with: git push && git push --tags\n');
  }

  process.stdout.write('\nReleased:\n');
  for (const tag of tagsToCreate) process.stdout.write(`  ${tag}\n`);
  process.stdout.write('\nNow publish with: npm run publish-all\n');
}

main();
