#!/usr/bin/env bash
# Optional git pre-commit hook: regenerate the feature map and stage it
# alongside the commit so the map is never out of sync with the code.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

npx --yes @feature-maps/core fmap scan --quiet --root "$ROOT"
git add ".featuremap" "requirements" 2>/dev/null || true
