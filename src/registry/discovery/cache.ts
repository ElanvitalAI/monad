// 발견 스냅숏의 «읽기» 한 벌 — 러너(쓰기·소스 fetch)에서 떼어 냈다(2026-09-23).
//
// 왜 떼었나: 카탈로그 로더(`../loader.ts`)가 스냅숏을 접으려면 이것을 읽어야 하는데, 러너는 모든
// 소스를 import 하고 그중 `grok-crawl` 이 `config.js`·`grok/agent-search` 를 끌고 온다 — 로더가
// 러너를 import 하면 카탈로그 로드마다 그 무게와 순환 위험을 진다. 여기는 fs·경로·타입만 쓴다.

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { getElanousConfigDir } from '../../elanous-config-dir.js';
import type { DiscoveredModel, DiscoverySourceId } from './types.js';

export interface DiscoverySnapshot {
  version: number;
  generatedAt: string;
  /** Per-source health (ok / error). */
  sources: Array<{
    id: DiscoverySourceId;
    ok: boolean;
    durationMs: number;
    modelCount: number;
    error?: string;
  }>;
  /** Flattened list of every discovered model (by provider). */
  models: DiscoveredModel[];
}

export function defaultDiscoveryCachePath(): string {
  // Same priority chain as the catalog / live-store helpers — see
  // src/elanous-config-dir.ts for the central resolver.
  const central = getElanousConfigDir();
  if (central === join(homedir(), '.elanous')) {
    const testHome = process.env.ELANOUS_TEST_HOME?.trim();
    if (testHome) return join(testHome, '.elanous', 'discovery-snapshot.json');
  }
  return join(central, 'discovery-snapshot.json');
}

/** Read the most recent persisted snapshot. Returns null when no
 *  cache file exists or the file is unreadable / corrupted. */
export function readDiscoveryCache(opts: { cachePath?: string } = {}): DiscoverySnapshot | null {
  const path = opts.cachePath ?? defaultDiscoveryCachePath();
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, 'utf-8');
    const json = JSON.parse(raw) as DiscoverySnapshot;
    if (json && typeof json === 'object' && Array.isArray(json.models)) return json;
  } catch { /* corrupted — treat as cold cache */ }
  return null;
}
