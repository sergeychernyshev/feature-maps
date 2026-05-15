import * as fs from 'fs';
import * as path from 'path';

export interface TranscriptTurn {
  ts: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  meta?: Record<string, unknown>;
}

export interface SessionTranscript {
  sessionId: string;
  startedAt: string;
  cwd: string;
  turns: TranscriptTurn[];
  files: { path: string; action: 'created' | 'modified' | 'deleted' }[];
}

export function transcriptDir(root: string): string {
  return path.join(root, '.featuremap', 'sessions');
}

export function transcriptPath(root: string, sessionId: string): string {
  return path.join(transcriptDir(root), `${sessionId}.jsonl`);
}

export function appendTurn(
  root: string,
  sessionId: string,
  turn: TranscriptTurn
): void {
  const dir = transcriptDir(root);
  fs.mkdirSync(dir, { recursive: true });
  const file = transcriptPath(root, sessionId);
  fs.appendFileSync(file, JSON.stringify(turn) + '\n');
}

export function readTranscript(file: string): TranscriptTurn[] {
  if (!fs.existsSync(file)) return [];
  const content = fs.readFileSync(file, 'utf8');
  return content
    .split(/\n+/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as TranscriptTurn;
      } catch {
        return null;
      }
    })
    .filter((x): x is TranscriptTurn => x !== null);
}

export function listTranscripts(root: string): string[] {
  const dir = transcriptDir(root);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => path.join(dir, f));
}
