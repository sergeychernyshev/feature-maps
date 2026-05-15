# Agent guidelines

When you implement code in this repo, ensure each change is traceable to
a requirement listed in `FEATURES.md` or under `requirements/`. Either:

1. Add the relevant `id` to a `mappings:` entry in
   `.featuremap/*.featuremap.yaml`, or
2. Drop a `// @req FMAP-XXX` comment near the implementation.

Run `npm run build && node packages/core/dist/cli.js scan` (or
`npm run fmap -- scan`) before committing. The pre-commit hook in
`packages/hooks/scripts/pre-commit.sh` does this automatically when
installed.

## AGENT-001 — Map every change

Every PR must keep `fmap coverage --fail-under 100` green for the
modules it touches. CI enforces this.
