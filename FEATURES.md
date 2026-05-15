# Feature Maps — Features

This file is auto-discovered by `fmap scan`.

## FMAP-001 — Scan source code and produce a feature map

The CLI walks the project, parses requirement files, declared feature
maps, and optional inline annotations, and writes a unified
`feature-map.json` plus a Source Map v3 sidecar (`.map`).

## FMAP-002 — DevTools-compatible source map output

The generated `.map` file is a valid Source Map v3 document with an
`x_featureMap` extension. DevTools and other source-map consumers ignore
unknown `x_` keys, so it can ride alongside standard build artifacts.

## FMAP-003 — Coverage report

The CLI computes mapped/unmapped/orphan totals and renders them as text,
JSON, or markdown. CI can fail the build under a coverage threshold via
`--fail-under`.

## FMAP-004 — VSCode extension

The extension watches `.featuremap/feature-map.json`, draws gutter icons
and hovers next to mapped lines, lists all requirements in a tree view,
and surfaces orphan references as warnings.

## FMAP-005 — Claude Code hook for session recording

A Stop hook captures each agent turn into a JSONL transcript; a
SessionEnd hook ingests Claude Code's full transcript file as a backup.

## FMAP-006 — Conversation summarization into requirements

`fmap-summarize` distills a recorded session into a markdown
requirements file plus a paired feature map YAML, ready to be committed
alongside the change.

## FMAP-007 — Pre-commit hook keeps map in sync with code

An optional git pre-commit hook regenerates the feature map and stages
it so the artifact never drifts from the source.
