#!/usr/bin/env node
/**
 * Claude Code hook: append the current turn to a session transcript.
 *
 * Reads the hook payload from stdin (Claude Code's hook contract:
 * https://docs.claude.com/en/docs/claude-code/hooks). Works for Stop and
 * SessionEnd events.
 */
import * as fs from 'fs';
import * as path from 'path';
import { appendTurn, transcriptPath } from './transcript';

interface ClaudeHookPayload {
  hook_event_name?: string;
  session_id?: string;
  cwd?: string;
  transcript_path?: string;
  // Stop hook payload may include the latest assistant message; SessionEnd
  // gives us the path to the full transcript instead.
  message?: { role: string; content: string | unknown };
  reason?: string;
}

async function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    if (process.stdin.isTTY) {
      resolve('');
      return;
    }
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('end', () => resolve(data));
  });
}

function flatten(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((c: any) => {
        if (typeof c === 'string') return c;
        if (c && typeof c.text === 'string') return c.text;
        if (c && c.type === 'tool_use') return `[tool ${c.name || ''}]`;
        if (c && c.type === 'tool_result') return `[tool result]`;
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

async function main() {
  const raw = await readStdin();
  if (!raw.trim()) {
    return;
  }
  let payload: ClaudeHookPayload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return;
  }

  const root = payload.cwd || process.cwd();
  const sessionId = payload.session_id || `unknown-${Date.now()}`;
  const event = payload.hook_event_name || 'unknown';

  // For Stop hook: append the latest assistant message.
  if (event === 'Stop' && payload.message) {
    appendTurn(root, sessionId, {
      ts: new Date().toISOString(),
      role: (payload.message.role as 'assistant' | 'user') || 'assistant',
      content: flatten(payload.message.content),
      meta: { event },
    });
  }

  // For SessionEnd: ingest the full transcript file Claude Code wrote.
  if (event === 'SessionEnd' && payload.transcript_path) {
    ingestFullTranscript(root, sessionId, payload.transcript_path, payload.reason);
    // Mark the session as ended so summarize knows it's complete.
    const marker = path.join(
      path.dirname(transcriptPath(root, sessionId)),
      `${sessionId}.ended`
    );
    fs.mkdirSync(path.dirname(marker), { recursive: true });
    fs.writeFileSync(marker, payload.reason || 'ended');
  }
}

function ingestFullTranscript(
  root: string,
  sessionId: string,
  srcPath: string,
  reason?: string
) {
  if (!fs.existsSync(srcPath)) return;
  const lines = fs.readFileSync(srcPath, 'utf8').split(/\n+/).filter(Boolean);
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      const role = obj.role || (obj.type === 'user' ? 'user' : 'assistant');
      const content = flatten(obj.content || obj.message?.content);
      if (!content) continue;
      appendTurn(root, sessionId, {
        ts: obj.timestamp || new Date().toISOString(),
        role,
        content,
        meta: { source: 'sessionEnd', reason },
      });
    } catch {
      // ignore malformed lines
    }
  }
}

main().catch((err) => {
  process.stderr.write(`fmap-record: ${err.message}\n`);
  process.exit(0); // never block the agent
});
