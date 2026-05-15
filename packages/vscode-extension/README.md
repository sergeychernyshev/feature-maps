# Feature Maps for VS Code

VS Code extension for [feature-maps](https://github.com/sergeychernyshev/feature-maps).
Surfaces requirement metadata directly in the editor — gutter icons, hovers,
code lenses, an Explorer tree view, a coverage badge, and diagnostics for
references that point at requirements that no longer exist.

## Install

From the VS Code Marketplace, or sideload a `.vsix`:

```bash
vsce package
code --install-extension feature-maps-vscode-<version>.vsix
```

The extension expects a feature map file in the workspace (default location
`.featuremap/feature-map.json`). Generate it with `fmap scan` from the
[`@feature-maps/core`](https://www.npmjs.com/package/@feature-maps/core)
CLI.

## Features

- **Gutter icons + hovers** on every line that maps to a requirement; hover
  shows the requirement ID, title, and a link to its source doc.
- **Code lenses** on mapped ranges, linking to the requirement source file.
- **"Feature Map Requirements" tree view** in the Explorer, grouped by
  source doc and filterable to unmapped items.
- **Status-bar coverage badge** — click to open the full coverage panel.
- **Diagnostics for orphan references** — flags inline annotations (`@req`,
  `@implements`, …) that point at requirement IDs that don't exist.

## Commands

| Command | Action |
|---|---|
| `Feature Maps: Refresh` | Reload the feature map from disk. |
| `Feature Maps: Scan project` | Run `fmap scan` and refresh. |
| `Feature Maps: Show coverage report` | Open the coverage panel. |
| `Feature Maps: Open requirement` | Quick-pick requirements; jump to source. |

All commands are also available via the Command Palette (`Cmd/Ctrl+Shift+P`).

## Coverage panel

The coverage panel (status-bar click or `Feature Maps: Show coverage report`)
shows:

- **Overall coverage** — percentage of requirements with at least one mapping.
- **Per-requirement status** — mapped (file count), unmapped, or orphan
  references — sortable and filterable.
- **Top files by requirement density** — useful for spotting code that's
  under-documented or doing too many jobs.

Click any row to jump to the requirement's source markdown.

## Settings

```jsonc
{
  // Path (relative to workspace root) of the generated feature map JSON.
  "featureMaps.mapPath": ".featuremap/feature-map.json",

  // Run `fmap scan` automatically when files are saved.
  "featureMaps.autoScan": false,

  // Show gutter icons next to lines mapped to a requirement.
  "featureMaps.showGutter": true
}
```

## Requirements

- VS Code ≥ 1.85.
- `fmap` CLI on PATH if you use `Feature Maps: Scan project` or
  `featureMaps.autoScan` (`npm install -g @feature-maps/core`).

## License

Apache-2.0 — see [LICENSE](./LICENSE).
