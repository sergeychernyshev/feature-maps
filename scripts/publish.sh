#!/usr/bin/env bash
# Publish all three packages:
#   - @feature-maps/core       → npm
#   - @feature-maps/hooks      → npm (depends on core, so publish core first)
#   - feature-maps-vscode      → VS Code Marketplace via vsce
#
# Usage:
#   scripts/publish.sh                 # publish all three
#   scripts/publish.sh --dry-run       # show what would happen, change nothing
#   scripts/publish.sh --skip-vscode   # skip the VS Code extension
#   scripts/publish.sh --tag next      # npm dist-tag for the two npm packages
#
# Requirements:
#   - npm login (for @feature-maps scope, with publish rights)
#   - vsce installed and `vsce login feature-maps` done (unless --skip-vscode)
#     (script falls back to `npx @vscode/vsce` if vsce is not on PATH)

set -euo pipefail

DRY_RUN=0
SKIP_VSCODE=0
NPM_TAG="latest"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --skip-vscode) SKIP_VSCODE=1 ;;
    --tag) NPM_TAG="${2:?--tag needs a value}"; shift ;;
    -h|--help)
      cat <<'EOF'
Publish all three packages:
  - @feature-maps/core   → npm
  - @feature-maps/hooks  → npm (after core; hooks pins core at exact version)
  - feature-maps-vscode  → VS Code Marketplace via vsce

Usage:
  scripts/publish.sh                 publish all three
  scripts/publish.sh --dry-run       show what would happen, change nothing
  scripts/publish.sh --skip-vscode   skip the VS Code extension
  scripts/publish.sh --tag next      npm dist-tag for the two npm packages
EOF
      exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
  shift
done

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

run() {
  echo "+ $*"
  if [[ $DRY_RUN -eq 0 ]]; then
    "$@"
  fi
}

pkg_version() {
  node -p "require('$1/package.json').version"
}

# Refuse to publish from a dirty tree — too easy to ship local debug edits.
if [[ -n "$(git status --porcelain)" ]]; then
  echo "error: working tree has uncommitted changes. Commit or stash first." >&2
  git status --short >&2
  exit 1
fi

CORE_VERSION="$(pkg_version packages/core)"
HOOKS_VERSION="$(pkg_version packages/hooks)"
VSCODE_VERSION="$(pkg_version packages/vscode-extension)"

# hooks depends on core at an exact version — make sure they match so the
# freshly published hooks install resolves the freshly published core.
HOOKS_CORE_DEP="$(node -p "require('./packages/hooks/package.json').dependencies['@feature-maps/core']")"
if [[ "$HOOKS_CORE_DEP" != "$CORE_VERSION" ]]; then
  echo "error: hooks depends on @feature-maps/core@$HOOKS_CORE_DEP but core is $CORE_VERSION" >&2
  exit 1
fi

echo "publishing:"
echo "  @feature-maps/core   $CORE_VERSION   → npm (tag: $NPM_TAG)"
echo "  @feature-maps/hooks  $HOOKS_VERSION  → npm (tag: $NPM_TAG)"
if [[ $SKIP_VSCODE -eq 0 ]]; then
  echo "  feature-maps-vscode  $VSCODE_VERSION → VS Code Marketplace"
fi
[[ $DRY_RUN -eq 1 ]] && echo "(dry run — no changes will be made)"
echo

run npm ci
run npm run build --workspaces --if-present

# 1. core
run npm publish --workspace @feature-maps/core --access public --tag "$NPM_TAG"

# 2. hooks (after core, since it depends on the just-published version)
run npm publish --workspace @feature-maps/hooks --access public --tag "$NPM_TAG"

# 3. vscode extension
if [[ $SKIP_VSCODE -eq 0 ]]; then
  if command -v vsce >/dev/null 2>&1; then
    VSCE=(vsce)
  else
    VSCE=(npx --yes @vscode/vsce)
  fi
  if [[ $DRY_RUN -eq 1 ]]; then
    echo "+ (cd packages/vscode-extension && ${VSCE[*]} package)"
  else
    ( cd packages/vscode-extension && "${VSCE[@]}" publish )
  fi
fi

echo
echo "done."
