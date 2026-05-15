# @feature-maps/core

Core CLI and library for [feature-maps](https://github.com/sergeychernyshev/feature-maps) —
maps source code to feature requirements and emits a DevTools-compatible
Source Map v3 file with an `x_featureMap` extension.

## Install

```bash
npm install -g @feature-maps/core
# or, as a project dev dep:
npm install --save-dev @feature-maps/core
```

Provides two equivalent binaries: `fmap` (short) and `feature-maps`.

## CLI

```bash
fmap init                      # scaffold requirements/ and .featuremap/
fmap scan                      # build .featuremap/feature-map.json + .map
fmap coverage                  # text coverage report
fmap coverage -f markdown      # markdown table
fmap coverage -f json          # machine-readable
fmap coverage --fail-under 80  # exit non-zero if coverage < 80%
fmap coverage --strict-orphans # exit non-zero if any annotation points at a missing requirement
fmap list                      # list all requirements and where they're mapped
fmap list --unmapped           # only requirements with no mappings
```

Common options on every command:

- `-r, --root <dir>` — project root (default: `cwd`).
- `-o, --out <dir>` — output directory for `scan` (default: `.featuremap`).
- `--name <file>` — output filename for `scan` (default: `feature-map.json`).
- `--quiet` — suppress non-essential output.

## How requirements and mappings are discovered

- **Requirements** — markdown headers with an ID matching `[A-Z][A-Z0-9]+-\d+`
  (e.g. `## REQ-101 — Login flow`), or YAML/frontmatter `requirements:` arrays.
  Searched in `docs/**/*.md`, `requirements/**/*.{md,yaml}`, `AGENTS.md`, and
  `FEATURES.md` by default.
- **Feature maps** — declarative YAML/JSON (`*.featuremap.yaml`, `.featuremap/**`)
  binding requirement IDs to file ranges. No source modification required.
- **Inline annotations** (optional fallback) — comments like `@req REQ-101` in
  the source file's native comment syntax.

Override the globs in `.featuremaprc.json` at the project root.

## Declarative feature map example

A `.featuremap.yaml` file binds requirement IDs to file ranges without
touching the source:

```yaml
# .featuremap/auth.featuremap.yaml
version: 1
mappings:
  - requirement: REQ-101
    files:
      - path: src/login.ts
        ranges: [[12, 48]]
      - path: src/session.ts
        ranges: [[1, 9], [22, 22]]
  - requirement: REQ-102
    files:
      - path: src/login.ts
        ranges: [[50, 78]]
```

- `ranges` are inclusive `[startLine, endLine]` pairs (1-indexed).
- Multiple files per requirement, multiple ranges per file.
- A single requirement can be split across many feature-map files; they're
  merged at scan time.

## Output

`fmap scan` writes two files:

- `.featuremap/feature-map.json` — full document (requirements + mappings + coverage).
- `.featuremap/feature-map.json.map` — [Source Map v3](https://sourcemaps.info/spec.html)
  with an `x_featureMap` extension. Standard source-map consumers ignore the
  unknown `x_` field; tools that know about it surface requirement context inline.

## Programmatic API

```ts
import {
  loadConfig,
  loadRequirements,
  scanSources,
  loadFeatureMapFiles,
  buildFeatureMap,
  buildSourceMap,
  computeCoverage,
} from '@feature-maps/core';

const config = await loadConfig(process.cwd());
const requirements = await loadRequirements(config);
const annotations = await scanSources(config);
const declared = await loadFeatureMapFiles(config);
const featureMap = buildFeatureMap({ requirements, annotations, declared });
const sourceMap = buildSourceMap(featureMap);
const coverage = computeCoverage(featureMap);
```

Re-exports the full surface from `types`, `config`, `requirements`, `scanner`,
`featuremap-files`, `mapper`, `sourcemap`, and `coverage`.

## License

Apache-2.0 — see [LICENSE](./LICENSE).
