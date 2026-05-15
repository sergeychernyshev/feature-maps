/**
 * Tests for the `@feature-maps/hooks` CLI.
 *
 * Most tests run the compiled `dist/cli.js` directly against a freshly
 * `mkdtemp`-ed scratch directory — no network, no install.
 *
 * The `e2e: pre-commit hook fires…` test exercises the full chain: it
 * `npm pack`s both @feature-maps/core and @feature-maps/hooks, installs the
 * tarballs into a temp project, runs `install --precommit`, and then makes
 * a real git commit to confirm the hook regenerates the feature map and
 * stages it. Set FMAP_SKIP_E2E=1 to skip just that test.
 */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { spawnSync, type SpawnSyncOptions } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const CORE_DIR = path.join(REPO_ROOT, 'packages', 'core');
const HOOKS_DIR = path.join(REPO_ROOT, 'packages', 'hooks');
const CLI_BIN = path.join(HOOKS_DIR, 'dist', 'cli.js');

function mkTmp(label: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `fmap-${label}-`));
}

function rmRf(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

function runCli(
  args: string[],
  opts: SpawnSyncOptions = {},
): { status: number; stdout: string; stderr: string } {
  const r = spawnSync('node', [CLI_BIN, ...args], {
    encoding: 'utf8',
    ...opts,
  });
  return {
    status: r.status ?? -1,
    stdout: String(r.stdout ?? ''),
    stderr: String(r.stderr ?? ''),
  };
}

function readSettings(root: string): {
  hooks?: Record<string, Array<{ matcher?: string; hooks: Array<{ type: string; command: string }> }>>;
} {
  return JSON.parse(
    fs.readFileSync(path.join(root, '.claude', 'settings.json'), 'utf8'),
  );
}

test('install writes Stop and SessionEnd hooks into .claude/settings.json', () => {
  const tmp = mkTmp('install');
  try {
    const r = runCli(['install', '--root', tmp]);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    const settings = readSettings(tmp);
    assert.ok(settings.hooks?.Stop, 'Stop hook missing');
    assert.ok(settings.hooks?.SessionEnd, 'SessionEnd hook missing');
    const stop = settings.hooks.Stop[0].hooks[0].command;
    assert.match(stop, /-p @feature-maps\/hooks fmap-record/);
    const end = settings.hooks.SessionEnd[0].hooks[0].command;
    assert.match(end, /-p @feature-maps\/hooks fmap-record/);
    assert.match(end, /-p @feature-maps\/hooks fmap-summarize --markEnded/);
    assert.match(end, /-p @feature-maps\/core fmap scan/);
  } finally {
    rmRf(tmp);
  }
});

test('install is idempotent', () => {
  const tmp = mkTmp('idem');
  try {
    runCli(['install', '--root', tmp]);
    const before = fs.readFileSync(path.join(tmp, '.claude', 'settings.json'), 'utf8');
    const r = runCli(['install', '--root', tmp]);
    assert.equal(r.status, 0);
    const after = fs.readFileSync(path.join(tmp, '.claude', 'settings.json'), 'utf8');
    assert.equal(before, after, 'rerun should not change settings');
    assert.match(r.stdout, /already present/);
  } finally {
    rmRf(tmp);
  }
});

test('install --precommit writes a node-based pre-commit hook', () => {
  const tmp = mkTmp('pc-write');
  try {
    spawnSync('git', ['init', '-q'], { cwd: tmp });
    const r = runCli(['install', '--precommit', '--root', tmp]);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    const hookPath = path.join(tmp, '.git', 'hooks', 'pre-commit');
    assert.ok(fs.existsSync(hookPath), 'pre-commit should exist');
    const content = fs.readFileSync(hookPath, 'utf8');
    assert.match(content, /^#!\/usr\/bin\/env node/);
    assert.match(content, /\/\/ feature-maps-pre-commit/);
    assert.match(content, /@feature-maps\/hooks/);
    assert.match(content, /pre-commit/);
    const mode = fs.statSync(hookPath).mode;
    assert.ok((mode & 0o111) !== 0, 'pre-commit should be executable');
  } finally {
    rmRf(tmp);
  }
});

test('install --precommit backs up an existing third-party pre-commit', () => {
  const tmp = mkTmp('pc-bak');
  try {
    spawnSync('git', ['init', '-q'], { cwd: tmp });
    const hookPath = path.join(tmp, '.git', 'hooks', 'pre-commit');
    fs.writeFileSync(hookPath, '#!/usr/bin/env bash\necho previous-hook\n');
    fs.chmodSync(hookPath, 0o755);
    const r = runCli(['install', '--precommit', '--root', tmp]);
    assert.equal(r.status, 0);
    const bak = hookPath + '.bak';
    assert.ok(fs.existsSync(bak), 'existing hook should be backed up');
    assert.match(fs.readFileSync(bak, 'utf8'), /echo previous-hook/);
  } finally {
    rmRf(tmp);
  }
});

test('install --precommit warns and skips when not a git repo', () => {
  const tmp = mkTmp('pc-nogit');
  try {
    const r = runCli(['install', '--precommit', '--root', tmp]);
    // install of claude hooks still succeeds; the precommit step warns.
    assert.equal(r.status, 0);
    assert.match(r.stderr, /not a git repo/);
    assert.ok(
      !fs.existsSync(path.join(tmp, '.git', 'hooks', 'pre-commit')),
      'no pre-commit should be created',
    );
  } finally {
    rmRf(tmp);
  }
});

test('uninstall removes the hooks install added', () => {
  const tmp = mkTmp('uninstall');
  try {
    spawnSync('git', ['init', '-q'], { cwd: tmp });
    runCli(['install', '--precommit', '--root', tmp]);
    const r = runCli(['uninstall', '--precommit', '--root', tmp]);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    const settings = readSettings(tmp);
    assert.equal(settings.hooks?.Stop, undefined);
    assert.equal(settings.hooks?.SessionEnd, undefined);
    assert.ok(!fs.existsSync(path.join(tmp, '.git', 'hooks', 'pre-commit')));
  } finally {
    rmRf(tmp);
  }
});

test('uninstall --precommit restores the .bak backup', () => {
  const tmp = mkTmp('uninstall-bak');
  try {
    spawnSync('git', ['init', '-q'], { cwd: tmp });
    const hookPath = path.join(tmp, '.git', 'hooks', 'pre-commit');
    fs.writeFileSync(hookPath, '#!/usr/bin/env bash\necho previous-hook\n');
    fs.chmodSync(hookPath, 0o755);
    runCli(['install', '--precommit', '--root', tmp]);
    runCli(['uninstall', '--precommit', '--root', tmp]);
    assert.ok(fs.existsSync(hookPath), 'pre-commit should exist after restore');
    assert.match(fs.readFileSync(hookPath, 'utf8'), /echo previous-hook/);
  } finally {
    rmRf(tmp);
  }
});

test('uninstall leaves unrelated third-party pre-commit alone', () => {
  const tmp = mkTmp('uninstall-other');
  try {
    spawnSync('git', ['init', '-q'], { cwd: tmp });
    const hookPath = path.join(tmp, '.git', 'hooks', 'pre-commit');
    fs.writeFileSync(hookPath, '#!/usr/bin/env bash\necho third-party\n');
    fs.chmodSync(hookPath, 0o755);
    const r = runCli(['uninstall', '--precommit', '--root', tmp]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /not installed by feature-maps/);
    assert.match(fs.readFileSync(hookPath, 'utf8'), /echo third-party/);
  } finally {
    rmRf(tmp);
  }
});

// ----------------------------------------------------------------------------
// End-to-end: actually fire the hook via `git commit`.
//
// Slow (~10s) because it `npm pack`s both packages and `npm install`s them
// into a temp project so `npx @feature-maps/hooks pre-commit` resolves
// locally. Set FMAP_SKIP_E2E=1 to skip.
// ----------------------------------------------------------------------------

test('e2e: pre-commit hook fires on git commit and stages feature map', { skip: process.env.FMAP_SKIP_E2E === '1' ? 'FMAP_SKIP_E2E=1' : undefined }, () => {
  const packDir = mkTmp('packs');
  const project = mkTmp('e2e');
  try {
    // Pack both packages.
    const pack = (cwd: string): string => {
      const r = spawnSync('npm', ['pack', '--silent', '--pack-destination', packDir], {
        cwd,
        encoding: 'utf8',
      });
      assert.equal(r.status, 0, `npm pack failed in ${cwd}: ${r.stderr}`);
      const tarballName = r.stdout.trim().split('\n').pop()!;
      return path.join(packDir, tarballName);
    };
    const coreTarball = pack(CORE_DIR);
    const hooksTarball = pack(HOOKS_DIR);

    // Set up the temp project.
    spawnSync('git', ['init', '-q'], { cwd: project });
    spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: project });
    spawnSync('git', ['config', 'user.name', 'Test'], { cwd: project });
    spawnSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: project });
    fs.writeFileSync(
      path.join(project, 'package.json'),
      JSON.stringify(
        { name: 'fmap-e2e-fixture', version: '0.0.0', private: true },
        null,
        2,
      ),
    );

    const install = spawnSync(
      'npm',
      [
        'install',
        '--no-audit',
        '--no-fund',
        '--no-save',
        hooksTarball,
        coreTarball,
      ],
      { cwd: project, encoding: 'utf8' },
    );
    assert.equal(install.status, 0, `npm install failed: ${install.stderr}`);

    // Install hooks via the local CLI (so we don't depend on what's on npm).
    const installRes = runCli(['install', '--precommit', '--root', project]);
    assert.equal(installRes.status, 0, installRes.stderr);

    // Fixture: a requirement doc + a file with an inline annotation.
    fs.writeFileSync(
      path.join(project, 'AGENTS.md'),
      '# Agents\n\n## REQ-1 — Test requirement\nSomething.\n',
    );
    fs.writeFileSync(
      path.join(project, 'index.js'),
      '// @req REQ-1\nconsole.log("hi");\n',
    );

    // Stage and commit — pre-commit hook should fire here.
    spawnSync('git', ['add', 'AGENTS.md', 'index.js'], { cwd: project });
    const commit = spawnSync('git', ['commit', '-m', 'fixture'], {
      cwd: project,
      encoding: 'utf8',
    });
    assert.equal(
      commit.status,
      0,
      `git commit failed.\nstdout:\n${commit.stdout}\nstderr:\n${commit.stderr}`,
    );

    // Verify the hook produced a feature map.
    const mapPath = path.join(project, '.featuremap', 'feature-map.json');
    assert.ok(fs.existsSync(mapPath), 'feature-map.json should be generated');

    // Verify it was actually staged into the commit (the whole point of the hook).
    const log = spawnSync(
      'git',
      ['log', '-1', '--name-only', '--pretty=format:'],
      { cwd: project, encoding: 'utf8' },
    );
    assert.match(
      log.stdout,
      /\.featuremap\/feature-map\.json/,
      'feature-map.json should be in the commit',
    );
  } finally {
    rmRf(packDir);
    rmRf(project);
  }
});
