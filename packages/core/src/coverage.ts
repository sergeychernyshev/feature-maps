import { FeatureMapDocument } from './types';

export interface CoverageReport {
  total: number;
  mapped: number;
  unmapped: number;
  orphans: number;
  coveragePct: number;
  byStatus: Record<string, { total: number; mapped: number }>;
  unmappedRequirements: Array<{ id: string; title: string; source: string; line: number }>;
  orphanReferences: Array<{ requirementId: string; file: string; startLine: number }>;
}

export function computeCoverage(doc: FeatureMapDocument): CoverageReport {
  const total = doc.requirements.length;
  const unmappedSet = new Set(doc.unmapped);
  const mapped = total - unmappedSet.size;
  const byStatus: Record<string, { total: number; mapped: number }> = {};
  for (const r of doc.requirements) {
    const key = r.status || 'unspecified';
    if (!byStatus[key]) byStatus[key] = { total: 0, mapped: 0 };
    byStatus[key].total += 1;
    if (!unmappedSet.has(r.id)) byStatus[key].mapped += 1;
  }

  const reqIds = new Set(doc.requirements.map((r) => r.id));
  const orphanRefs: CoverageReport['orphanReferences'] = [];
  for (const m of doc.mappings) {
    if (!reqIds.has(m.requirementId)) {
      for (const r of m.ranges) {
        orphanRefs.push({
          requirementId: m.requirementId,
          file: r.file,
          startLine: r.startLine,
        });
      }
    }
  }

  return {
    total,
    mapped,
    unmapped: unmappedSet.size,
    orphans: orphanRefs.length,
    coveragePct: total === 0 ? 0 : Math.round((mapped / total) * 1000) / 10,
    byStatus,
    unmappedRequirements: doc.requirements
      .filter((r) => unmappedSet.has(r.id))
      .map((r) => ({ id: r.id, title: r.title, source: r.source, line: r.line })),
    orphanReferences: orphanRefs,
  };
}

export function renderCoverageText(report: CoverageReport): string {
  const lines: string[] = [];
  lines.push('Feature Map Coverage');
  lines.push('====================');
  lines.push(`Requirements:    ${report.total}`);
  lines.push(`Mapped:          ${report.mapped}`);
  lines.push(`Unmapped:        ${report.unmapped}`);
  lines.push(`Orphan refs:     ${report.orphans}`);
  lines.push(`Coverage:        ${report.coveragePct}%`);
  lines.push('');
  if (Object.keys(report.byStatus).length) {
    lines.push('By status:');
    for (const [k, v] of Object.entries(report.byStatus)) {
      const pct = v.total === 0 ? 0 : Math.round((v.mapped / v.total) * 1000) / 10;
      lines.push(`  ${k.padEnd(14)} ${v.mapped}/${v.total} (${pct}%)`);
    }
    lines.push('');
  }
  if (report.unmappedRequirements.length) {
    lines.push('Unmapped requirements:');
    for (const r of report.unmappedRequirements) {
      lines.push(`  - ${r.id}  ${r.title}  (${r.source}:${r.line})`);
    }
    lines.push('');
  }
  if (report.orphanReferences.length) {
    lines.push('Orphan references (no requirement defined):');
    for (const o of report.orphanReferences) {
      lines.push(`  - ${o.requirementId}  ${o.file}:${o.startLine}`);
    }
  }
  return lines.join('\n');
}

export function renderCoverageMarkdown(report: CoverageReport): string {
  const lines: string[] = [];
  lines.push('# Feature Map Coverage');
  lines.push('');
  lines.push('| Metric | Count |');
  lines.push('|---|---|');
  lines.push(`| Requirements | ${report.total} |`);
  lines.push(`| Mapped | ${report.mapped} |`);
  lines.push(`| Unmapped | ${report.unmapped} |`);
  lines.push(`| Orphan references | ${report.orphans} |`);
  lines.push(`| Coverage | **${report.coveragePct}%** |`);
  lines.push('');
  if (Object.keys(report.byStatus).length) {
    lines.push('## By status');
    lines.push('');
    lines.push('| Status | Mapped / Total | Coverage |');
    lines.push('|---|---|---|');
    for (const [k, v] of Object.entries(report.byStatus)) {
      const pct = v.total === 0 ? 0 : Math.round((v.mapped / v.total) * 1000) / 10;
      lines.push(`| ${k} | ${v.mapped}/${v.total} | ${pct}% |`);
    }
    lines.push('');
  }
  if (report.unmappedRequirements.length) {
    lines.push('## Unmapped requirements');
    lines.push('');
    for (const r of report.unmappedRequirements) {
      lines.push(`- \`${r.id}\` ${r.title} — \`${r.source}:${r.line}\``);
    }
    lines.push('');
  }
  if (report.orphanReferences.length) {
    lines.push('## Orphan references');
    lines.push('');
    for (const o of report.orphanReferences) {
      lines.push(`- \`${o.requirementId}\` referenced in \`${o.file}:${o.startLine}\``);
    }
  }
  return lines.join('\n');
}
