import * as fs from 'fs';
import * as path from 'path';
import { DEFAULT_CONFIG, ScanConfig } from './types';

export function loadConfig(root: string): ScanConfig {
  const configPath = path.join(root, '.featuremaprc.json');
  let userConfig: Partial<ScanConfig> = {};
  if (fs.existsSync(configPath)) {
    try {
      userConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (err) {
      console.warn(`Failed to parse ${configPath}: ${(err as Error).message}`);
    }
  }
  return {
    root,
    ...DEFAULT_CONFIG,
    ...userConfig,
  };
}
