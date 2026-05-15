import * as fs from 'fs';
import * as path from 'path';
import fg from 'fast-glob';
import { CodeRange, FeatureMapping, ScanConfig } from './types';

const REQ_ID_PATTERN = /\b([A-Z][A-Z0-9]{1,15}-\d{1,6})\b/g;

interface RawHit {
  file: string;
  line: number;
  column: number;
  endLine: number;
  ids: string[];
  note?: string;
}

export async function scanCodeAnnotations(config: ScanConfig): Promise<FeatureMapping[]> {
  const files = await fg(config.codeGlobs, {
    cwd: config.root,
    ignore: config.ignoreGlobs,
    absolute: true,
    onlyFiles: true,
    unique: true,
  });

  const tokenAlt = config.annotationTokens.map(escapeRegex).join('|');
  const tokenRegex = new RegExp(`(?:${tokenAlt})\\s+([^\\n*/]*)`, 'g');

  const map = new Map<string, FeatureMapping>();

  for (const file of files) {
    const text = safeRead(file);
    if (!text) continue;
    const rel = path.relative(config.root, file).split(path.sep).join('/');
    const lines = text.split(/\r?\n/);
    const hits = collectHits(lines, tokenRegex, rel);
    for (const hit of hits) {
      for (const id of hit.ids) {
        const range: CodeRange = {
          file: hit.file,
          startLine: hit.line,
          endLine: hit.endLine,
          startColumn: hit.column,
          note: hit.note,
        };
        const existing = map.get(id);
        if (existing) {
          existing.ranges.push(range);
        } else {
          map.set(id, { requirementId: id, ranges: [range], origin: 'annotation' });
        }
      }
    }
  }
  return Array.from(map.values());
}

function collectHits(lines: string[], tokenRegex: RegExp, rel: string): RawHit[] {
  const hits: RawHit[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    tokenRegex.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = tokenRegex.exec(line)) !== null) {
      const tail = m[1] || '';
      const ids = Array.from(tail.matchAll(REQ_ID_PATTERN), (x) => x[1]);
      if (!ids.length) continue;
      const note = tail
        .replace(REQ_ID_PATTERN, '')
        .replace(/[,\s]+$/g, '')
        .replace(/^[,\s]+/g, '')
        .trim();
      const endLine = inferBlockEnd(lines, i);
      hits.push({
        file: rel,
        line: i + 1,
        column: m.index + 1,
        endLine,
        ids,
        note: note || undefined,
      });
    }
  }
  return hits;
}

// Heuristic: end of annotated block is the next blank line, brace-balanced
// scope, or end of contiguous comment+code group. Keep simple — extend later.
function inferBlockEnd(lines: string[], start: number): number {
  // Skip remaining comment lines, then take the next code line and try to
  // find a matching brace if it opens one.
  let i = start;
  while (i < lines.length && isCommentLine(lines[i])) i++;
  if (i >= lines.length) return start + 1;
  const codeStart = i;
  const opens = (lines[codeStart].match(/[{([]/g) || []).length;
  const closes = (lines[codeStart].match(/[})\]]/g) || []).length;
  let depth = opens - closes;
  if (depth <= 0) return codeStart + 1;
  for (let j = codeStart + 1; j < lines.length && j < codeStart + 500; j++) {
    depth += (lines[j].match(/[{([]/g) || []).length;
    depth -= (lines[j].match(/[})\]]/g) || []).length;
    if (depth <= 0) return j + 1;
  }
  return Math.min(codeStart + 50, lines.length);
}

function isCommentLine(line: string): boolean {
  const t = line.trim();
  return (
    t.startsWith('//') ||
    t.startsWith('#') ||
    t.startsWith('*') ||
    t.startsWith('/*') ||
    t.startsWith('--') ||
    t.startsWith(';;')
  );
}

function safeRead(file: string): string | null {
  try {
    const stat = fs.statSync(file);
    if (stat.size > 2 * 1024 * 1024) return null;
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
