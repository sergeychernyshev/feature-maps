import * as fs from 'fs';
import * as path from 'path';
import fg from 'fast-glob';
import matter from 'gray-matter';
import yaml from 'js-yaml';
import { Requirement, ScanConfig } from './types';

const REQ_ID_PATTERN = /\b([A-Z][A-Z0-9]{1,15}-\d{1,6})\b/;

export async function loadRequirements(config: ScanConfig): Promise<Requirement[]> {
  const files = await fg(config.requirementGlobs, {
    cwd: config.root,
    ignore: config.ignoreGlobs,
    absolute: true,
    dot: false,
    onlyFiles: true,
    unique: true,
  });

  const reqs: Requirement[] = [];
  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    const content = fs.readFileSync(file, 'utf8');
    if (ext === '.md' || ext === '.mdx') {
      reqs.push(...parseMarkdownRequirements(file, content, config.root));
    } else if (ext === '.yaml' || ext === '.yml') {
      reqs.push(...parseYamlRequirements(file, content, config.root));
    }
  }

  return dedupeById(reqs);
}

function relPath(root: string, abs: string): string {
  return path.relative(root, abs).split(path.sep).join('/');
}

export function parseMarkdownRequirements(
  file: string,
  content: string,
  root: string
): Requirement[] {
  const parsed = matter(content);
  const reqs: Requirement[] = [];
  const rel = relPath(root, file);

  // Frontmatter requirements
  if (parsed.data && Array.isArray(parsed.data.requirements)) {
    for (const r of parsed.data.requirements) {
      if (r && typeof r === 'object' && r.id) {
        reqs.push({
          id: String(r.id),
          title: String(r.title || r.id),
          description: r.description ? String(r.description) : undefined,
          source: rel,
          line: 1,
          status: r.status,
          tags: r.tags,
          parent: r.parent,
        });
      }
    }
  }

  const lines = parsed.content.split(/\r?\n/);
  let parentStack: { level: number; id: string }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const headerMatch = /^(#{1,6})\s+(.*)$/.exec(line);
    if (headerMatch) {
      const level = headerMatch[1].length;
      const title = headerMatch[2].trim();
      const idMatch = REQ_ID_PATTERN.exec(title);
      if (idMatch) {
        const id = idMatch[1];
        const cleanTitle = title.replace(REQ_ID_PATTERN, '').replace(/^[\s:\-—–]+|[\s:\-—–]+$/g, '');
        // Pop deeper headers
        parentStack = parentStack.filter((p) => p.level < level);
        const parent = parentStack.length ? parentStack[parentStack.length - 1].id : undefined;
        reqs.push({
          id,
          title: cleanTitle || id,
          description: extractSectionBody(lines, i + 1, level),
          source: rel,
          line: i + 1,
          parent,
        });
        parentStack.push({ level, id });
      }
    }
  }

  return reqs;
}

function extractSectionBody(lines: string[], start: number, level: number): string | undefined {
  const out: string[] = [];
  for (let i = start; i < lines.length; i++) {
    const m = /^(#{1,6})\s+/.exec(lines[i]);
    if (m && m[1].length <= level) break;
    out.push(lines[i]);
  }
  const body = out.join('\n').trim();
  return body || undefined;
}

export function parseYamlRequirements(
  file: string,
  content: string,
  root: string
): Requirement[] {
  const rel = relPath(root, file);
  const data = yaml.load(content);
  const reqs: Requirement[] = [];
  const list = Array.isArray(data)
    ? data
    : data && typeof data === 'object' && Array.isArray((data as any).requirements)
      ? (data as any).requirements
      : [];
  for (const r of list) {
    if (r && typeof r === 'object' && (r as any).id) {
      reqs.push({
        id: String((r as any).id),
        title: String((r as any).title || (r as any).id),
        description: (r as any).description,
        source: rel,
        line: 1,
        status: (r as any).status,
        tags: (r as any).tags,
        parent: (r as any).parent,
      });
    }
  }
  return reqs;
}

function dedupeById(reqs: Requirement[]): Requirement[] {
  const seen = new Map<string, Requirement>();
  for (const r of reqs) {
    const existing = seen.get(r.id);
    if (!existing) {
      seen.set(r.id, r);
    } else if (!existing.description && r.description) {
      seen.set(r.id, r);
    }
  }
  return Array.from(seen.values()).sort((a, b) => a.id.localeCompare(b.id));
}
