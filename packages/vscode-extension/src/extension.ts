import * as fs from 'fs';
import * as path from 'path';
import * as cp from 'child_process';
import * as vscode from 'vscode';

interface FeatureMapDoc {
  version: number;
  generatedAt: string;
  root: string;
  requirements: Array<{
    id: string;
    title: string;
    description?: string;
    source: string;
    line: number;
    status?: string;
  }>;
  mappings: Array<{
    requirementId: string;
    origin: 'declared' | 'annotation';
    ranges: Array<{
      file: string;
      startLine: number;
      endLine: number;
      symbol?: string;
      note?: string;
    }>;
  }>;
  unmapped: string[];
}

let current: FeatureMapDoc | null = null;
let decorationType: vscode.TextEditorDecorationType;
let diagnostics: vscode.DiagnosticCollection;
let statusItem: vscode.StatusBarItem;
let treeProvider: RequirementsTreeProvider;

export function activate(context: vscode.ExtensionContext) {
  decorationType = vscode.window.createTextEditorDecorationType({
    gutterIconPath: makeGutterIcon(context),
    gutterIconSize: 'contain',
    overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.infoForeground'),
    overviewRulerLane: vscode.OverviewRulerLane.Right,
  });
  diagnostics = vscode.languages.createDiagnosticCollection('featureMaps');
  statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusItem.command = 'featureMaps.showCoverage';
  context.subscriptions.push(decorationType, diagnostics, statusItem);

  treeProvider = new RequirementsTreeProvider();
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('featureMapsRequirements', treeProvider)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('featureMaps.refresh', () => loadAndApply()),
    vscode.commands.registerCommand('featureMaps.scan', () => runScan()),
    vscode.commands.registerCommand('featureMaps.showCoverage', () => showCoverage()),
    vscode.commands.registerCommand('featureMaps.openRequirement', (id: string) =>
      openRequirement(id)
    ),
    vscode.languages.registerHoverProvider({ scheme: 'file' }, { provideHover }),
    vscode.languages.registerCodeLensProvider({ scheme: 'file' }, new MapLensProvider()),
    vscode.window.onDidChangeActiveTextEditor(() => applyDecorations()),
    vscode.workspace.onDidSaveTextDocument(async (doc) => {
      const cfg = vscode.workspace.getConfiguration('featureMaps');
      if (cfg.get<boolean>('autoScan')) {
        await runScan();
      }
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('featureMaps')) loadAndApply();
    })
  );

  // Watch the map file and reload when it changes.
  const ws = vscode.workspace.workspaceFolders?.[0];
  if (ws) {
    const cfg = vscode.workspace.getConfiguration('featureMaps');
    const rel = cfg.get<string>('mapPath') || '.featuremap/feature-map.json';
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(ws, rel)
    );
    watcher.onDidChange(() => loadAndApply());
    watcher.onDidCreate(() => loadAndApply());
    context.subscriptions.push(watcher);
  }

  loadAndApply();
}

export function deactivate() {
  current = null;
}

function workspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function mapFilePath(): string | undefined {
  const root = workspaceRoot();
  if (!root) return undefined;
  const cfg = vscode.workspace.getConfiguration('featureMaps');
  return path.join(root, cfg.get<string>('mapPath') || '.featuremap/feature-map.json');
}

function loadAndApply() {
  const file = mapFilePath();
  if (!file || !fs.existsSync(file)) {
    statusItem.hide();
    current = null;
    treeProvider.refresh();
    return;
  }
  try {
    current = JSON.parse(fs.readFileSync(file, 'utf8')) as FeatureMapDoc;
  } catch (err) {
    vscode.window.showErrorMessage(`Feature Maps: failed to load ${file}`);
    return;
  }
  statusItem.text = `$(checklist) ${current.mappings.length}/${current.requirements.length} mapped`;
  statusItem.tooltip = `Feature Map coverage — click for full report`;
  statusItem.show();
  treeProvider.refresh();
  applyDecorations();
  applyDiagnostics();
}

async function runScan() {
  const root = workspaceRoot();
  if (!root) return;
  const term =
    vscode.window.terminals.find((t) => t.name === 'Feature Maps') ||
    vscode.window.createTerminal({ name: 'Feature Maps', cwd: root });
  term.show(true);
  term.sendText('npx --yes @feature-maps/core fmap scan');
}

function applyDecorations() {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !current) return;
  const cfg = vscode.workspace.getConfiguration('featureMaps');
  if (!cfg.get<boolean>('showGutter')) {
    editor.setDecorations(decorationType, []);
    return;
  }
  const root = workspaceRoot();
  if (!root) return;
  const rel = path.relative(root, editor.document.uri.fsPath).split(path.sep).join('/');

  const decorations: vscode.DecorationOptions[] = [];
  for (const m of current.mappings) {
    for (const r of m.ranges) {
      if (r.file !== rel) continue;
      const line = Math.max(0, r.startLine - 1);
      const req = current.requirements.find((x) => x.id === m.requirementId);
      const md = new vscode.MarkdownString(
        `**${m.requirementId}** ${req ? req.title : ''}\n\n${req?.description || ''}`
      );
      md.isTrusted = true;
      decorations.push({
        range: new vscode.Range(line, 0, Math.max(line, r.endLine - 1), 0),
        hoverMessage: md,
      });
    }
  }
  editor.setDecorations(decorationType, decorations);
}

function applyDiagnostics() {
  diagnostics.clear();
  if (!current) return;
  const root = workspaceRoot();
  if (!root) return;
  const reqIds = new Set(current.requirements.map((r) => r.id));
  const byFile = new Map<string, vscode.Diagnostic[]>();
  for (const m of current.mappings) {
    if (reqIds.has(m.requirementId)) continue;
    for (const r of m.ranges) {
      const uri = vscode.Uri.file(path.join(root, r.file));
      const diag = new vscode.Diagnostic(
        new vscode.Range(r.startLine - 1, 0, r.startLine - 1, 0),
        `Orphan requirement reference: ${m.requirementId} is not defined in any requirements file`,
        vscode.DiagnosticSeverity.Warning
      );
      diag.source = 'feature-maps';
      const arr = byFile.get(uri.fsPath) || [];
      arr.push(diag);
      byFile.set(uri.fsPath, arr);
    }
  }
  for (const [file, arr] of byFile) {
    diagnostics.set(vscode.Uri.file(file), arr);
  }
}

const provideHover: vscode.HoverProvider['provideHover'] = (doc, pos) => {
  if (!current) return;
  const root = workspaceRoot();
  if (!root) return;
  const rel = path.relative(root, doc.uri.fsPath).split(path.sep).join('/');
  const matches: string[] = [];
  for (const m of current.mappings) {
    for (const r of m.ranges) {
      if (r.file !== rel) continue;
      if (pos.line + 1 < r.startLine || pos.line + 1 > r.endLine) continue;
      const req = current.requirements.find((x) => x.id === m.requirementId);
      const title = req?.title || '';
      const status = req?.status ? ` _(${req.status})_` : '';
      const link = `[${m.requirementId}](command:featureMaps.openRequirement?${encodeURIComponent(JSON.stringify(m.requirementId))})`;
      matches.push(`${link} ${title}${status}`);
    }
  }
  if (!matches.length) return;
  const md = new vscode.MarkdownString(matches.join('  \n'));
  md.isTrusted = true;
  return new vscode.Hover(md);
};

class MapLensProvider implements vscode.CodeLensProvider {
  private emitter = new vscode.EventEmitter<void>();
  onDidChangeCodeLenses = this.emitter.event;

  provideCodeLenses(doc: vscode.TextDocument): vscode.CodeLens[] {
    if (!current) return [];
    const root = workspaceRoot();
    if (!root) return [];
    const rel = path.relative(root, doc.uri.fsPath).split(path.sep).join('/');
    const lenses: vscode.CodeLens[] = [];
    for (const m of current.mappings) {
      for (const r of m.ranges) {
        if (r.file !== rel) continue;
        const req = current.requirements.find((x) => x.id === m.requirementId);
        const range = new vscode.Range(r.startLine - 1, 0, r.startLine - 1, 0);
        lenses.push(
          new vscode.CodeLens(range, {
            title: `📋 ${m.requirementId}${req ? ': ' + req.title : ''}`,
            command: 'featureMaps.openRequirement',
            arguments: [m.requirementId],
          })
        );
      }
    }
    return lenses;
  }
}

async function openRequirement(id: string) {
  if (!current) return;
  const req = current.requirements.find((r) => r.id === id);
  const root = workspaceRoot();
  if (!req || !root) return;
  const file = path.join(root, req.source);
  const doc = await vscode.workspace.openTextDocument(file);
  const editor = await vscode.window.showTextDocument(doc);
  const line = Math.max(0, (req.line || 1) - 1);
  editor.revealRange(
    new vscode.Range(line, 0, line, 0),
    vscode.TextEditorRevealType.InCenter
  );
  editor.selection = new vscode.Selection(line, 0, line, 0);
}

function showCoverage() {
  if (!current) {
    vscode.window.showInformationMessage('Feature Maps: no map loaded');
    return;
  }
  const total = current.requirements.length;
  const mapped = total - current.unmapped.length;
  const pct = total === 0 ? 0 : Math.round((mapped / total) * 1000) / 10;
  const panel = vscode.window.createWebviewPanel(
    'featureMapsCoverage',
    'Feature Map Coverage',
    vscode.ViewColumn.Active,
    {}
  );
  const rows = current.requirements
    .map((r) => {
      const isMapped = !current!.unmapped.includes(r.id);
      const tag = isMapped ? '✅' : '❌';
      return `<tr><td>${tag}</td><td><code>${escapeHtml(r.id)}</code></td><td>${escapeHtml(r.title)}</td><td>${escapeHtml(r.status || '')}</td></tr>`;
    })
    .join('');
  panel.webview.html = `<!doctype html>
  <html><head><meta charset="utf-8"><style>
    body { font-family: var(--vscode-font-family); padding: 1rem; }
    table { border-collapse: collapse; width: 100%; }
    th, td { padding: 0.4rem 0.6rem; border-bottom: 1px solid var(--vscode-editorWidget-border); text-align: left; }
    .pct { font-size: 2rem; font-weight: bold; }
  </style></head><body>
    <h1>Feature Map Coverage</h1>
    <p class="pct">${pct}%</p>
    <p>${mapped} of ${total} requirements mapped. ${current.unmapped.length} unmapped.</p>
    <table><thead><tr><th></th><th>ID</th><th>Title</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>
  </body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

class RequirementsTreeProvider implements vscode.TreeDataProvider<TreeItem> {
  private emitter = new vscode.EventEmitter<TreeItem | undefined | void>();
  onDidChangeTreeData = this.emitter.event;
  refresh() {
    this.emitter.fire();
  }
  getTreeItem(e: TreeItem): vscode.TreeItem {
    return e;
  }
  getChildren(): TreeItem[] {
    if (!current) return [];
    return current.requirements.map((r) => {
      const isMapped = !current!.unmapped.includes(r.id);
      const item = new TreeItem(
        `${r.id} — ${r.title}`,
        vscode.TreeItemCollapsibleState.None
      );
      item.description = isMapped ? 'mapped' : 'unmapped';
      item.iconPath = new vscode.ThemeIcon(isMapped ? 'check' : 'circle-outline');
      item.command = {
        command: 'featureMaps.openRequirement',
        title: 'Open',
        arguments: [r.id],
      };
      return item;
    });
  }
}

class TreeItem extends vscode.TreeItem {}

function makeGutterIcon(context: vscode.ExtensionContext): vscode.Uri {
  const file = path.join(context.extensionPath, 'gutter.svg');
  if (!fs.existsSync(file)) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect x="3" y="3" width="10" height="10" rx="2" fill="#3b82f6"/><path d="M5.5 8.5l2 2 3-4" stroke="#fff" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    fs.writeFileSync(file, svg);
  }
  return vscode.Uri.file(file);
}

// --- Reserved for future use: spawn fmap in-process if needed ---
function _spawnFmap(root: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    cp.execFile('npx', ['--yes', '@feature-maps/core', 'fmap', ...args], { cwd: root }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}
