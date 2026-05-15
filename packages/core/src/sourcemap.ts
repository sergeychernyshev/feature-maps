import * as fs from 'fs';
import * as path from 'path';
import { FeatureMapDocument } from './types';

/**
 * Source Map v3 with x_featureMap extension. Chrome DevTools and other
 * source-map consumers ignore unknown x_ fields, so we can ride alongside
 * the standard mapping format.
 *
 * Each generated "section" corresponds to one source file; the mappings
 * are line-only (no column transforms) and the x_featureMap field carries
 * the requirement metadata that DevTools custom-formatters or extensions
 * can read via `sourceMap.x_featureMap`.
 */
export interface FeatureSourceMap {
  version: 3;
  file: string;
  sources: string[];
  sourcesContent: (string | null)[];
  names: string[];
  mappings: string;
  x_featureMap: {
    version: 1;
    generatedAt: string;
    requirements: Array<{
      id: string;
      title: string;
      status?: string;
      source: string;
      line: number;
    }>;
    annotations: Array<{
      sourceIndex: number;
      startLine: number;
      endLine: number;
      requirementIds: string[];
      origin: 'declared' | 'annotation';
      note?: string;
    }>;
  };
}

export function buildSourceMap(
  doc: FeatureMapDocument,
  outputName = 'feature-map.json'
): FeatureSourceMap {
  const sources: string[] = [];
  const sourceIndex = new Map<string, number>();
  const annotations: FeatureSourceMap['x_featureMap']['annotations'] = [];

  for (const m of doc.mappings) {
    for (const range of m.ranges) {
      let idx = sourceIndex.get(range.file);
      if (idx === undefined) {
        idx = sources.length;
        sourceIndex.set(range.file, idx);
        sources.push(range.file);
      }
      annotations.push({
        sourceIndex: idx,
        startLine: range.startLine,
        endLine: range.endLine,
        requirementIds: [m.requirementId],
        origin: m.origin,
        note: range.note,
      });
    }
  }

  // Encode minimal "identity" mappings — one segment per annotated start
  // line so DevTools shows the marker at the right row.
  const lineSegments = new Map<number, Set<number>>();
  for (const a of annotations) {
    for (let line = a.startLine; line <= a.endLine; line++) {
      let set = lineSegments.get(line);
      if (!set) {
        set = new Set();
        lineSegments.set(line, set);
      }
      set.add(a.sourceIndex);
    }
  }
  const maxLine = Math.max(0, ...Array.from(lineSegments.keys()));
  const groups: string[] = [];
  let prevSrc = 0;
  let prevSrcLine = 0;
  for (let line = 1; line <= maxLine; line++) {
    const set = lineSegments.get(line);
    if (!set) {
      groups.push('');
      continue;
    }
    const segs: string[] = [];
    for (const src of set) {
      const seg = encodeSegment(0, src - prevSrc, line - 1 - prevSrcLine, 0);
      prevSrc = src;
      prevSrcLine = line - 1;
      segs.push(seg);
    }
    groups.push(segs.join(','));
  }

  return {
    version: 3,
    file: outputName,
    sources,
    sourcesContent: sources.map(() => null),
    names: [],
    mappings: groups.join(';'),
    x_featureMap: {
      version: 1,
      generatedAt: doc.generatedAt,
      requirements: doc.requirements.map((r) => ({
        id: r.id,
        title: r.title,
        status: r.status,
        source: r.source,
        line: r.line,
      })),
      annotations,
    },
  };
}

const BASE64_CHARS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function encodeSegment(...nums: number[]): string {
  return nums.map(encodeVlq).join('');
}

function encodeVlq(value: number): string {
  let vlq = value < 0 ? ((-value) << 1) | 1 : value << 1;
  let out = '';
  do {
    let digit = vlq & 0x1f;
    vlq >>>= 5;
    if (vlq > 0) digit |= 0x20;
    out += BASE64_CHARS[digit];
  } while (vlq > 0);
  return out;
}

export function writeSourceMap(
  doc: FeatureMapDocument,
  outDir: string,
  fileName = 'feature-map.json'
): { mapPath: string; jsonPath: string } {
  fs.mkdirSync(outDir, { recursive: true });
  const map = buildSourceMap(doc, fileName);
  const mapPath = path.join(outDir, `${fileName}.map`);
  const jsonPath = path.join(outDir, fileName);
  fs.writeFileSync(mapPath, JSON.stringify(map, null, 2));
  fs.writeFileSync(jsonPath, JSON.stringify(doc, null, 2));
  return { mapPath, jsonPath };
}
