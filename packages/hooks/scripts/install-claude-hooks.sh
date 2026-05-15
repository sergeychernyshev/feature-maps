#!/usr/bin/env bash
# Install feature-maps Stop + SessionEnd hooks into the project's
# .claude/settings.json. Idempotent: re-running just refreshes commands.
set -euo pipefail

ROOT="${1:-$(pwd)}"
SETTINGS_DIR="$ROOT/.claude"
SETTINGS_FILE="$SETTINGS_DIR/settings.json"

mkdir -p "$SETTINGS_DIR"

if [ ! -f "$SETTINGS_FILE" ]; then
  echo '{}' > "$SETTINGS_FILE"
fi

# Use node to merge so we don't depend on jq.
node - "$SETTINGS_FILE" <<'NODE'
const fs = require('fs');
const file = process.argv[2];
const data = JSON.parse(fs.readFileSync(file, 'utf8') || '{}');
data.hooks = data.hooks || {};
const ensure = (event, cmd) => {
  data.hooks[event] = data.hooks[event] || [];
  const has = data.hooks[event].some(h =>
    Array.isArray(h.hooks) && h.hooks.some(x => x.command === cmd)
  );
  if (!has) {
    data.hooks[event].push({ matcher: '', hooks: [{ type: 'command', command: cmd }] });
  }
};
ensure('Stop', 'npx --yes @feature-maps/hooks fmap-record');
ensure('SessionEnd', 'npx --yes @feature-maps/hooks fmap-record && npx --yes @feature-maps/hooks fmap-summarize --markEnded && npx --yes @feature-maps/core fmap scan');
fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
console.log('Updated', file);
NODE

echo "Hooks installed in $SETTINGS_FILE"
echo "  Stop       -> records each agent turn"
echo "  SessionEnd -> finalizes transcript, summarizes into requirements/, regenerates feature map"
