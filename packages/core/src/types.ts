export interface Requirement {
  id: string;
  title: string;
  description?: string;
  source: string;
  line: number;
  status?: 'planned' | 'in-progress' | 'implemented' | 'deprecated';
  tags?: string[];
  parent?: string;
}

export interface CodeRange {
  file: string;
  startLine: number;
  endLine: number;
  startColumn?: number;
  endColumn?: number;
  symbol?: string;
  note?: string;
}

export interface FeatureMapping {
  requirementId: string;
  ranges: CodeRange[];
  origin: 'declared' | 'annotation';
}

export interface FeatureMapDocument {
  version: 1;
  generatedAt: string;
  root: string;
  requirements: Requirement[];
  mappings: FeatureMapping[];
  unmapped: string[];
  orphans: CodeRange[];
}

export interface ScanConfig {
  root: string;
  requirementGlobs: string[];
  codeGlobs: string[];
  ignoreGlobs: string[];
  featureMapGlobs: string[];
  annotationTokens: string[];
}

export const DEFAULT_CONFIG: Omit<ScanConfig, 'root'> = {
  requirementGlobs: [
    'docs/**/*.md',
    'docs/**/*.mdx',
    'requirements/**/*.md',
    'requirements/**/*.yaml',
    'requirements/**/*.yml',
    'AGENTS.md',
    'FEATURES.md',
    '**/AGENTS.md',
    '**/FEATURES.md',
  ],
  featureMapGlobs: [
    '**/*.featuremap.yaml',
    '**/*.featuremap.yml',
    '**/*.featuremap.json',
    '.featuremap/**/*.yaml',
    '.featuremap/**/*.yml',
  ],
  codeGlobs: [
    '**/*.{ts,tsx,js,jsx,mjs,cjs}',
    '**/*.{py,rb,go,rs,java,kt,swift,c,cc,cpp,h,hpp,cs,php,scala}',
    '**/*.{vue,svelte,astro}',
  ],
  ignoreGlobs: [
    '**/node_modules/**',
    '**/dist/**',
    '**/build/**',
    '**/.git/**',
    '**/coverage/**',
    '**/*.featuremap.*',
    '**/.featuremap/**',
  ],
  annotationTokens: ['@req', '@requirement', '@feature', '@implements'],
};
