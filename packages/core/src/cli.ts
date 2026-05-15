#!/usr/bin/env node
import * as fs from 'fs';
import * as path from 'path';
import { Command } from 'commander';
import kleur from 'kleur';
import { loadConfig } from './config';
import { build } from './mapper';
import { writeSourceMap } from './sourcemap';
import {
  computeCoverage,
  renderCoverageMarkdown,
  renderCoverageText,
} from './coverage';

const program = new Command();

program
  .name('fmap')
  .description('Map source code to feature requirements')
  .version('0.1.0');

program
  .command('scan')
  .description('Scan project and write feature map + source map')
  .option('-r, --root <dir>', 'project root', process.cwd())
  .option('-o, --out <dir>', 'output directory', '.featuremap')
  .option('--name <file>', 'output file name', 'feature-map.json')
  .option('--quiet', 'suppress non-essential output', false)
  .action(async (opts) => {
    const root = path.resolve(opts.root);
    const config = loadConfig(root);
    const { document } = await build(config);
    const outDir = path.resolve(root, opts.out);
    const { jsonPath, mapPath } = writeSourceMap(document, outDir, opts.name);
    if (!opts.quiet) {
      console.log(
        kleur.green('✓'),
        `Wrote ${path.relative(root, jsonPath)} (${document.requirements.length} requirements, ${document.mappings.length} mappings)`
      );
      console.log(kleur.green('✓'), `Wrote ${path.relative(root, mapPath)}`);
      const cov = computeCoverage(document);
      console.log(
        kleur.cyan('  Coverage:'),
        `${cov.coveragePct}% (${cov.mapped}/${cov.total})`
      );
      if (cov.orphans) {
        console.log(kleur.yellow('  ⚠'), `${cov.orphans} orphan references`);
      }
    }
  });

program
  .command('coverage')
  .description('Print coverage report')
  .option('-r, --root <dir>', 'project root', process.cwd())
  .option('-f, --format <fmt>', 'text | json | markdown', 'text')
  .option('--fail-under <pct>', 'exit non-zero if coverage below threshold')
  .option('--strict-orphans', 'exit non-zero if orphan references exist', false)
  .action(async (opts) => {
    const root = path.resolve(opts.root);
    const config = loadConfig(root);
    const { document } = await build(config);
    const report = computeCoverage(document);
    if (opts.format === 'json') {
      console.log(JSON.stringify(report, null, 2));
    } else if (opts.format === 'markdown') {
      console.log(renderCoverageMarkdown(report));
    } else {
      console.log(renderCoverageText(report));
    }
    const failUnder = opts.failUnder ? parseFloat(opts.failUnder) : null;
    if (failUnder !== null && report.coveragePct < failUnder) {
      console.error(
        kleur.red(`✗ coverage ${report.coveragePct}% below threshold ${failUnder}%`)
      );
      process.exit(2);
    }
    if (opts.strictOrphans && report.orphans > 0) {
      console.error(kleur.red(`✗ ${report.orphans} orphan references`));
      process.exit(3);
    }
  });

program
  .command('list')
  .description('List requirements and their mappings')
  .option('-r, --root <dir>', 'project root', process.cwd())
  .option('--unmapped', 'list only unmapped requirements', false)
  .action(async (opts) => {
    const root = path.resolve(opts.root);
    const config = loadConfig(root);
    const { document } = await build(config);
    const unmapped = new Set(document.unmapped);
    for (const r of document.requirements) {
      if (opts.unmapped && !unmapped.has(r.id)) continue;
      const mapping = document.mappings.find((m) => m.requirementId === r.id);
      const tag = unmapped.has(r.id)
        ? kleur.yellow('UNMAPPED')
        : kleur.green('MAPPED');
      console.log(`${tag} ${kleur.bold(r.id)}  ${r.title}`);
      console.log(`         ${kleur.gray(`${r.source}:${r.line}`)}`);
      if (mapping) {
        for (const range of mapping.ranges) {
          console.log(
            `         ${kleur.cyan('→')} ${range.file}:${range.startLine}-${range.endLine}`
          );
        }
      }
    }
  });

program
  .command('init')
  .description('Initialize feature-maps in this project')
  .option('-r, --root <dir>', 'project root', process.cwd())
  .action(async (opts) => {
    const root = path.resolve(opts.root);
    const reqDir = path.join(root, 'requirements');
    fs.mkdirSync(reqDir, { recursive: true });
    const sample = path.join(reqDir, 'sample.md');
    if (!fs.existsSync(sample)) {
      fs.writeFileSync(
        sample,
        `# Sample Requirements\n\n## REQ-001 — Example requirement\n\nDescribe what the feature must do.\n`
      );
      console.log(kleur.green('✓'), `Created ${path.relative(root, sample)}`);
    }
    const fmDir = path.join(root, '.featuremap');
    fs.mkdirSync(fmDir, { recursive: true });
    const fmFile = path.join(fmDir, 'project.featuremap.yaml');
    if (!fs.existsSync(fmFile)) {
      fs.writeFileSync(
        fmFile,
        `version: 1\nmappings:\n  - id: REQ-001\n    ranges:\n      - file: src/index.ts\n        lines: 1-10\n        note: Example mapping\n`
      );
      console.log(kleur.green('✓'), `Created ${path.relative(root, fmFile)}`);
    }
    const rcFile = path.join(root, '.featuremaprc.json');
    if (!fs.existsSync(rcFile)) {
      fs.writeFileSync(rcFile, '{}\n');
      console.log(kleur.green('✓'), `Created ${path.relative(root, rcFile)}`);
    }
    console.log(
      kleur.gray('  Run `fmap scan` to generate the feature map and source map.')
    );
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(kleur.red('Error:'), err.message);
  process.exit(1);
});
