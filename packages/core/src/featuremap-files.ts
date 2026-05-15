import * as fs from 'fs';
import * as path from 'path';
import fg from 'fast-glob';
import yaml from 'js-yaml';
import { CodeRange, FeatureMapping, ScanConfig } from './types';

export interface RawFeatureMapEntry {
  id: string;
  files?: string[] | string;
  ranges?: Array<{
    file: string;
    lines?: string;
    startLine?: number;
    endLine?: number;
    symbol?: string;
    note?: string;
  }>;
}

export interface RawFeatureMapFile {
  version?: number;
  mappings: RawFeatureMapEntry[];
}

export async function loadFeatureMapFiles(config: ScanConfig): Promise<FeatureMapping[]> {
  const files = await fg(config.featureMapGlobs, {
    cwd: config.root,
    ignore: config.ignoreGlobs.filter((g) => !g.includes('featuremap')),
    absolute: true,
    dot: true,
    onlyFiles: true,
    unique: true,
  });

  const out = new Map<string, FeatureMapping>();
  for (const file of files) {
    const dir = path.dirname(file);
    const ext = path.extname(file).toLowerCase();
    const raw = fs.readFileSync(file, 'utf8');
    let data: any;
    try {
      data = ext === '.json' ? JSON.parse(raw) : yaml.load(raw);
    } catch (err) {
      console.warn(`Skipping ${file}: ${(err as Error).message}`);
      continue;
    }
    if (!data || !Array.isArray(data.mappings)) continue;
    for (const entry of data.mappings as RawFeatureMapEntry[]) {
      const ranges = expandEntry(entry, dir, config.root);
      const key = entry.id;
      const existing = out.get(key);
      if (existing) {
        existing.ranges.push(...ranges);
      } else {
        out.set(key, { requirementId: key, ranges, origin: 'declared' });
      }
    }
  }
  return Array.from(out.values());
}

function expandEntry(entry: RawFeatureMapEntry, dir: string, root: string): CodeRange[] {
  const ranges: CodeRange[] = [];
  const files = Array.isArray(entry.files)
    ? entry.files
    : entry.files
      ? [entry.files]
      : [];
  for (const f of files) {
    ranges.push(...resolveFileRange(f, dir, root));
  }
  if (entry.ranges) {
    for (const r of entry.ranges) {
      const filePath = resolveRelative(r.file, dir, root);
      let startLine = r.startLine ?? 1;
      let endLine = r.endLine ?? startLine;
      if (r.lines) {
        const m = /^(\d+)\s*[-:]\s*(\d+)$/.exec(r.lines.trim());
        if (m) {
          startLine = parseInt(m[1], 10);
          endLine = parseInt(m[2], 10);
        } else if (/^\d+$/.test(r.lines.trim())) {
          startLine = endLine = parseInt(r.lines.trim(), 10);
        }
      }
      ranges.push({
        file: filePath,
        startLine,
        endLine,
        symbol: r.symbol,
        note: r.note,
      });
    }
  }
  return ranges;
}

function resolveFileRange(spec: string, dir: string, root: string): CodeRange[] {
  // Support "src/foo.ts:10-20" or just file path
  const m = /^(.*?):(\d+)(?:[-:](\d+))?$/.exec(spec);
  if (m) {
    const file = resolveRelative(m[1], dir, root);
    const startLine = parseInt(m[2], 10);
    const endLine = m[3] ? parseInt(m[3], 10) : startLine;
    return [{ file, startLine, endLine }];
  }
  const file = resolveRelative(spec, dir, root);
  return [{ file, startLine: 1, endLine: countLinesSafe(path.join(root, file)) }];
}

function resolveRelative(file: string, dir: string, root: string): string {
  // Paths starting with ./ or ../ are relative to the config file's
  // directory; everything else is relative to the project root. This
  // matches how most monorepo tooling treats path lists in configs.
  const isExplicitRelative = file.startsWith('./') || file.startsWith('../');
  const abs = path.isAbsolute(file)
    ? file
    : isExplicitRelative
      ? path.resolve(dir, file)
      : path.resolve(root, file);
  return path.relative(root, abs).split(path.sep).join('/');
}

function countLinesSafe(absPath: string): number {
  try {
    const content = fs.readFileSync(absPath, 'utf8');
    return content.split(/\r?\n/).length;
  } catch {
    return 1;
  }
}
