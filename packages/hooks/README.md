# @feature-maps/hooks

Claude Code hooks for [feature-maps](https://github.com/sergeychernyshev/feature-maps).
Records assistant sessions and summarizes them into requirement docs +
paired feature maps, so the work an AI agent did becomes a committable,
linkable artifact.

## Install

```bash
npm install --save-dev @feature-maps/hooks
```

Pulls in `@feature-maps/core` automatically (exact-version match).

## Binaries

- `fmap-record` — hook handler. Reads Claude Code's JSON hook payload from
  stdin and appends the turn to `.featuremap/sessions/<session-id>.jsonl`.
  Handles both **Stop** and **SessionEnd** events; for SessionEnd it also
  ingests Claude Code's full transcript so nothing is missed in long sessions.
- `fmap-summarize` — distills a recorded session into:
  - `requirements/session-<id>.md` — markdown requirements doc.
  - `.featuremap/session-<id>.featuremap.yaml` — bindings from the new
    requirement IDs to the files the agent touched.

## Wire it up

The packaged installer writes the right entries to `.claude/settings.json`:

```bash
bash node_modules/@feature-maps/hooks/scripts/install-claude-hooks.sh
```

It registers:

- A **Stop** hook → `fmap-record` (captures each finished assistant turn).
- A **SessionEnd** hook → `fmap-record` (ingests the full transcript) then
  `fmap-summarize --markEnded` then `fmap scan` (regenerates the global map).

The net effect: every Claude Code session leaves behind a `requirements/`
doc and a paired feature map, both regenerated into the global map, all
stageable in one shot.

## Manual use

```bash
fmap-summarize                            # summarize all completed sessions
fmap-summarize <session-id>               # summarize one
fmap-summarize --provider=claude          # force Claude API (needs ANTHROPIC_API_KEY)
fmap-summarize --provider=heuristic       # force local extraction
fmap-summarize --markEnded                # mark session as ended on completion
fmap-summarize --root <dir>               # alternate project root
```

## Configuration

- `ANTHROPIC_API_KEY` — enables Claude-based summarization (defaults on when set).
- `FMAP_MODEL` — override the model (defaults to `claude-sonnet-4-6`).
- Without an API key, a local heuristic summarizer extracts bullets and file
  references. Less polished, still committable.

## Git pre-commit hook

The package also ships a pre-commit hook that regenerates the feature map
on every commit and stages it, so the map never drifts from the code:

```bash
ln -s ../../node_modules/@feature-maps/hooks/scripts/pre-commit.sh .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit
```

## Programmatic API

A small transcript-handling surface is re-exported for tooling that wants
to read or append to sessions without shelling out:

```ts
import {
  appendTurn,
  readTranscript,
  listTranscripts,
  transcriptPath,
  TranscriptTurn,
  SessionTranscript,
} from '@feature-maps/hooks';
```

## License

Apache-2.0 — see [LICENSE](./LICENSE).
