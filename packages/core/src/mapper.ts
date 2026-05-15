import { FeatureMapDocument, FeatureMapping, Requirement, ScanConfig } from './types';
import { loadRequirements } from './requirements';
import { loadFeatureMapFiles } from './featuremap-files';
import { scanCodeAnnotations } from './scanner';

export interface BuildResult {
  document: FeatureMapDocument;
  config: ScanConfig;
}

export async function build(config: ScanConfig): Promise<BuildResult> {
  const [requirements, declared, annotated] = await Promise.all([
    loadRequirements(config),
    loadFeatureMapFiles(config),
    scanCodeAnnotations(config),
  ]);

  const merged = mergeMappings(declared, annotated);
  const requirementIds = new Set(requirements.map((r) => r.id));
  const mappedIds = new Set(merged.map((m) => m.requirementId));

  const unmapped = requirements
    .filter((r) => !mappedIds.has(r.id))
    .map((r) => r.id);

  const orphans = merged
    .filter((m) => !requirementIds.has(m.requirementId))
    .flatMap((m) => m.ranges);

  const document: FeatureMapDocument = {
    version: 1,
    generatedAt: new Date().toISOString(),
    root: config.root,
    requirements,
    mappings: merged,
    unmapped,
    orphans,
  };

  return { document, config };
}

function mergeMappings(
  declared: FeatureMapping[],
  annotated: FeatureMapping[]
): FeatureMapping[] {
  const out = new Map<string, FeatureMapping>();
  for (const m of [...declared, ...annotated]) {
    const existing = out.get(m.requirementId);
    if (!existing) {
      out.set(m.requirementId, { ...m, ranges: [...m.ranges] });
    } else {
      existing.ranges.push(...m.ranges);
      // Prefer 'declared' as authoritative origin when mixed
      if (m.origin === 'declared') existing.origin = 'declared';
    }
  }
  for (const m of out.values()) {
    m.ranges = dedupeRanges(m.ranges);
  }
  return Array.from(out.values()).sort((a, b) =>
    a.requirementId.localeCompare(b.requirementId)
  );
}

function dedupeRanges(ranges: FeatureMapping['ranges']): FeatureMapping['ranges'] {
  const seen = new Set<string>();
  const out: FeatureMapping['ranges'] = [];
  for (const r of ranges) {
    const key = `${r.file}:${r.startLine}-${r.endLine}:${r.symbol || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out.sort((a, b) =>
    a.file === b.file ? a.startLine - b.startLine : a.file.localeCompare(b.file)
  );
}
