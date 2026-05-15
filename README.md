# feature-maps

A TypeScript toolchain that maps source code to feature requirements and
emits DevTools-compatible source maps so any source-map consumer can
surface the requirement metadata.

## What's in the box

| Package | Purpose |
|---|---|
| `@feature-maps/core` | CLI (`fmap`) — scans the project, builds the feature map, generates a Source Map v3 file, prints a coverage report. |
| `@feature-maps/hooks` | Claude Code Stop/SessionEnd hooks (`fmap-record`) and a summarizer (`fmap-summarize`) that turns recorded conversations into requirement docs + paired feature maps. |
| `feature-maps-vscode` | VSCode extension — gutter icons, hovers, code lenses, requirements tree view, coverage panel, orphan-reference diagnostics. |

## Concepts

- **Requirements** are discovered in `docs/**/*.md`, `requirements/**/*.{md,yaml}`, `AGENTS.md`, and `FEATURES.md`. A requirement is any markdown header containing an ID matching `[A-Z][A-Z0-9]+-\d+` (e.g. `## REQ-101 — Login flow`), or a YAML/frontmatter `requirements:` array.
- **Feature maps** are declarative YAML/JSON files (`*.featuremap.yaml`, `.featuremap/**`) that bind requirement IDs to file ranges. This is the primary mapping mechanism — language-agnostic, no source modification required.
- **Inline annotations** (optional fallback) — comments containing tokens like `@req REQ-101` in any language's native comment syntax. Useful when you want the link to live next to the code.

## CLI

```bash
npm install -g @feature-maps/core

fmap init               # scaffold requirements/ and .featuremap/
fmap scan               # build .featuremap/feature-map.json + .map
fmap coverage           # text report
fmap coverage -f markdown > coverage.md
fmap coverage --fail-under 80  # CI gate
fmap list --unmapped    # what still needs mapping
```

The output:

- `.featuremap/feature-map.json` — full document (requirements + mappings + coverage).
- `.featuremap/feature-map.json.map` — Source Map v3 with `x_featureMap` extension. Standard source-map consumers ignore the unknown `x_` field; tools that know about it can render requirement context inline.

## VSCode extension

Install from the marketplace (or `code --install-extension feature-maps-vscode-0.1.0.vsix` after `vsce package`).

Features:
- Gutter icons + hovers on every line that's mapped to a requirement.
- Code lenses linking to the requirement source file.
- Orphan reference diagnostics (annotations that reference an undefined requirement).
- "Feature Map Requirements" tree view in the Explorer.
- Status bar coverage badge → click to open the coverage panel.

Settings:

```jsonc
{
  "featureMaps.mapPath": ".featuremap/feature-map.json",
  "featureMaps.autoScan": false,
  "featureMaps.showGutter": true
}
```

## Claude Code integration

Two hooks, installed from the root of any project:

```bash
npx @feature-maps/hooks install
```

This writes to `<project>/.claude/settings.json`:

- **Stop hook** → `fmap-record` appends each finished assistant turn to `.featuremap/sessions/<session-id>.jsonl`.
- **SessionEnd hook** → `fmap-record` ingests Claude Code's full transcript (covers anything Stop missed in long sessions), then `fmap-summarize --markEnded` distills the session into:
  - `requirements/session-<id>.md` — markdown requirements doc.
  - `.featuremap/session-<id>.featuremap.yaml` — paired feature map binding the new requirement IDs to the files the agent touched.
  Finally `fmap scan` regenerates the global map so everything is committable in one shot.

Set `ANTHROPIC_API_KEY` to use Claude for summarization (model defaults to `claude-sonnet-4-6`, override with `FMAP_MODEL`). Without a key, a heuristic local summarizer extracts bullets and file references — still committable, just less polished.

## Git pre-commit hook

```bash
npx @feature-maps/hooks install --precommit
```

Regenerates the feature map on every commit and stages it, so the map can never drift from the code. Remove with `npx @feature-maps/hooks uninstall --precommit`.

## Configuration (`.featuremaprc.json`)

```jsonc
{
  "requirementGlobs": ["docs/**/*.md", "requirements/**/*.{md,yaml}", "AGENTS.md", "FEATURES.md"],
  "featureMapGlobs": ["**/*.featuremap.{yaml,yml,json}"],
  "codeGlobs":        ["**/*.{ts,tsx,js,py,go,rs,...}"],
  "ignoreGlobs":      ["**/node_modules/**", "**/dist/**"],
  "annotationTokens": ["@req", "@requirement", "@feature", "@implements"]
}
```

## Source Map v3 extension

```jsonc
{
  "version": 3,
  "file": "feature-map.json",
  "sources": ["src/login.ts", ...],
  "mappings": "...",
  "x_featureMap": {
    "version": 1,
    "generatedAt": "2025-...",
    "requirements": [{"id":"REQ-101","title":"Login flow", ...}],
    "annotations": [
      {"sourceIndex": 0, "startLine": 12, "endLine": 24,
       "requirementIds":["REQ-101"], "origin":"declared"}
    ]
  }
}
```

## Repo layout

```
packages/core/        # @feature-maps/core (CLI + library)
packages/hooks/       # @feature-maps/hooks (Claude Code integration)
packages/vscode-extension/  # feature-maps-vscode
.featuremap/          # generated artifacts + declarative maps
requirements/         # markdown requirements docs
FEATURES.md           # top-level feature catalog
AGENTS.md             # rules for AI agents working in this repo
```
