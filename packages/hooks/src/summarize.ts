#!/usr/bin/env node
/**
 * Summarize a recorded Claude Code session into:
 *   1) a requirements markdown file under requirements/
 *   2) a featuremap YAML under .featuremap/
 *
 * Two modes:
 *   --provider=claude     Uses ANTHROPIC_API_KEY to call the Claude API.
 *   --provider=heuristic  Pure-local extraction (default fallback) - good
 *                         enough for "commit alongside the code" workflows
 *                         when no API key is configured.
 *
 * Designed to be invoked by a SessionEnd hook *after* fmap-record has
 * captured the transcript, or manually via `fmap-summarize <session-id>`.
 */
import * as fs from 'fs';
import * as path from 'path';
import { listTranscripts, readTranscript, TranscriptTurn } from './transcript';

interface ExtractedRequirement {
  id: string;
  title: string;
  description: string;
  files: string[];
}

interface SummaryOutput {
  sessionId: string;
  requirements: ExtractedRequirement[];
  rationale: string;
}

async function main() {
  const args = process.argv.slice(2);
  const opts = parseArgs(args);
  const root = path.resolve(opts.root || process.cwd());

  const sessionFiles = opts.session
    ? [resolveSessionPath(root, opts.session)]
    : listTranscripts(root).filter((f) => isComplete(f));

  if (!sessionFiles.length) {
    console.error('No completed sessions found to summarize.');
    process.exit(0);
  }

  for (const file of sessionFiles) {
    const turns = readTranscript(file);
    if (!turns.length) continue;
    const sessionId = path.basename(file, '.jsonl');
    const filesTouched = extractFilesTouched(turns);

    const provider = opts.provider || (process.env.ANTHROPIC_API_KEY ? 'claude' : 'heuristic');
    const summary =
      provider === 'claude'
        ? await summarizeWithClaude(sessionId, turns, filesTouched)
        : summarizeHeuristic(sessionId, turns, filesTouched);

    const outFiles = writeRequirements(root, summary);
    const mapFile = writeFeatureMap(root, summary);
    console.log(`Session ${sessionId}:`);
    console.log(`  requirements -> ${path.relative(root, outFiles.mdPath)}`);
    console.log(`  feature map  -> ${path.relative(root, mapFile)}`);
    if (opts.markEnded) {
      const marker = file.replace(/\.jsonl$/, '.ended');
      if (fs.existsSync(marker)) fs.unlinkSync(marker);
    }
  }
}

function parseArgs(args: string[]) {
  const opts: Record<string, string | boolean | undefined> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > -1) opts[a.slice(2, eq)] = a.slice(eq + 1);
      else opts[a.slice(2)] = true;
    } else if (!opts.session) {
      opts.session = a;
    }
  }
  return opts as { root?: string; session?: string; provider?: string; markEnded?: boolean };
}

function resolveSessionPath(root: string, session: string): string {
  if (fs.existsSync(session)) return session;
  return path.join(root, '.featuremap', 'sessions', `${session}.jsonl`);
}

function isComplete(transcriptFile: string): boolean {
  return fs.existsSync(transcriptFile.replace(/\.jsonl$/, '.ended'));
}

function extractFilesTouched(turns: TranscriptTurn[]): string[] {
  const seen = new Set<string>();
  const re = /(?:^|\s|`)([\w./-]+\.(?:ts|tsx|js|jsx|py|rb|go|rs|java|kt|swift|c|cc|cpp|h|hpp|cs|php|vue|svelte|md|yaml|yml|json))(?=\s|`|:|$)/g;
  for (const t of turns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(t.content)) !== null) {
      const f = m[1];
      if (!f.includes('node_modules')) seen.add(f);
    }
  }
  return Array.from(seen);
}

function summarizeHeuristic(
  sessionId: string,
  turns: TranscriptTurn[],
  filesTouched: string[]
): SummaryOutput {
  // Take the first user message as the headline; pull "task / TODO / requirement"
  // bullets from assistant messages.
  const userTurns = turns.filter((t) => t.role === 'user');
  const headline = (userTurns[0]?.content || 'Untitled change').split(/\n/)[0].slice(0, 100);
  const bullets = new Set<string>();
  for (const t of turns) {
    for (const line of t.content.split(/\n/)) {
      const m = /^\s*(?:[-*]\s+|\d+\.\s+)(.+)$/.exec(line);
      if (m && m[1].length < 200) bullets.add(m[1].trim());
    }
  }
  const desc = Array.from(bullets).slice(0, 8).map((b) => `- ${b}`).join('\n');
  const id = `REQ-${shortHash(sessionId)}`;
  return {
    sessionId,
    requirements: [
      {
        id,
        title: headline,
        description: desc || 'Captured from agent session.',
        files: filesTouched,
      },
    ],
    rationale: `Heuristic summary of ${turns.length} turns; ${filesTouched.length} files touched.`,
  };
}

async function summarizeWithClaude(
  sessionId: string,
  turns: TranscriptTurn[],
  filesTouched: string[]
): Promise<SummaryOutput> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return summarizeHeuristic(sessionId, turns, filesTouched);

  const transcriptText = turns
    .slice(-200)
    .map((t) => `### ${t.role}\n${t.content}`)
    .join('\n\n')
    .slice(0, 80000);

  const system = `You convert agent coding sessions into concise, durable feature requirements.
Produce JSON only, no prose. Schema:
{ "requirements": [ { "id": "REQ-XXX", "title": "...", "description": "...", "files": ["src/..."] } ],
  "rationale": "..." }
- Use stable, descriptive IDs (REQ-<shortname>).
- Each requirement is one user-facing capability or contract that the change introduces or modifies.
- Reference only files that were actually edited.
- Keep titles under 80 chars.`;

  const body = {
    model: process.env.FMAP_MODEL || 'claude-sonnet-4-6',
    max_tokens: 2048,
    system,
    messages: [
      {
        role: 'user',
        content: `Files touched: ${filesTouched.join(', ') || '(unknown)'}\n\nTranscript:\n${transcriptText}`,
      },
    ],
  };

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    process.stderr.write(`Claude API ${res.status}: ${await res.text()}\n`);
    return summarizeHeuristic(sessionId, turns, filesTouched);
  }
  const json: any = await res.json();
  const text = (json.content || [])
    .map((b: any) => b.text || '')
    .join('')
    .trim();
  const jsonStart = text.indexOf('{');
  const jsonEnd = text.lastIndexOf('}');
  if (jsonStart < 0 || jsonEnd <= jsonStart) {
    return summarizeHeuristic(sessionId, turns, filesTouched);
  }
  try {
    const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
    return {
      sessionId,
      requirements: (parsed.requirements || []).map((r: any) => ({
        id: r.id || `REQ-${shortHash(sessionId)}`,
        title: r.title || 'Untitled',
        description: r.description || '',
        files: Array.isArray(r.files) ? r.files : [],
      })),
      rationale: parsed.rationale || '',
    };
  } catch {
    return summarizeHeuristic(sessionId, turns, filesTouched);
  }
}

function writeRequirements(root: string, summary: SummaryOutput): { mdPath: string } {
  const dir = path.join(root, 'requirements');
  fs.mkdirSync(dir, { recursive: true });
  const mdPath = path.join(dir, `session-${summary.sessionId}.md`);
  const lines: string[] = [];
  lines.push(`# Session ${summary.sessionId}`);
  lines.push('');
  if (summary.rationale) {
    lines.push(`> ${summary.rationale}`);
    lines.push('');
  }
  for (const r of summary.requirements) {
    lines.push(`## ${r.id} — ${r.title}`);
    lines.push('');
    if (r.description) {
      lines.push(r.description);
      lines.push('');
    }
    if (r.files.length) {
      lines.push('**Files:**');
      for (const f of r.files) lines.push(`- \`${f}\``);
      lines.push('');
    }
  }
  fs.writeFileSync(mdPath, lines.join('\n'));
  return { mdPath };
}

function writeFeatureMap(root: string, summary: SummaryOutput): string {
  const dir = path.join(root, '.featuremap');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `session-${summary.sessionId}.featuremap.yaml`);
  const lines: string[] = [];
  lines.push('version: 1');
  lines.push('mappings:');
  for (const r of summary.requirements) {
    lines.push(`  - id: ${r.id}`);
    if (r.files.length) {
      lines.push('    files:');
      for (const f of r.files) lines.push(`      - ${f}`);
    } else {
      lines.push('    files: []');
    }
  }
  fs.writeFileSync(file, lines.join('\n') + '\n');
  return file;
}

function shortHash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36).slice(0, 6).toUpperCase();
}

main().catch((err) => {
  process.stderr.write(`fmap-summarize: ${err.message}\n`);
  process.exit(1);
});
