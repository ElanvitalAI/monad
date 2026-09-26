// W9c U5 · Patcher daemon user-config — `~/.elanous/background-reasoning/patcher.yaml`.
// Cf. PLAN-user-intent-logging-2026-05-12.md §7.3 U5 + `feedback_user_config_over_env`.
//
// The Patcher pipeline is opt-in. The user enables it by setting
// `enabled: true` in `~/.elanous/background-reasoning/patcher.yaml`, and
// the daemon boot reads this file via `loadPatcherConfig()`. Tests
// pass a `source` so the config is fully injectable without filesystem
// access.

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface PatcherConfig {
  enabled: boolean;
  /** ms between tick attempts. Default 60_000 (1 min). The trigger
   *  module gates whether each tick fires. */
  tickIntervalMs: number;
  /** Maximum cards / vectors processed per tick before yielding. */
  perTickLimit: number;
  /** When true, the daemon also runs the embedding pipeline (cost
   *  near-zero for local embeddings). Disable to skip vector_embedding
   *  population. */
  embeddingsEnabled: boolean;
}

export const DEFAULT_PATCHER_CONFIG: PatcherConfig = {
  enabled: false,
  tickIntervalMs: 60_000,
  perTickLimit: 200,
  embeddingsEnabled: true,
};

export interface PatcherConfigSource {
  /** Return the YAML text or null when the file is absent. Production
   *  reads `~/.elanous/background-reasoning/patcher.yaml`. */
  read(): string | null;
}

export function defaultPatcherConfigPath(): string {
  return join(homedir(), '.elanous', 'background-reasoning', 'patcher.yaml');
}

export function fileSystemPatcherConfigSource(path?: string): PatcherConfigSource {
  const target = path ?? defaultPatcherConfigPath();
  return {
    read() {
      try { return readFileSync(target, 'utf8'); }
      catch { return null; }
    },
  };
}

/** Parse a YAML/JSON-ish config payload. Falls back to defaults on any
 *  malformed input — the daemon never crashes because of a bad config. */
export function loadPatcherConfig(source: PatcherConfigSource): PatcherConfig {
  const raw = source.read();
  if (!raw) return { ...DEFAULT_PATCHER_CONFIG };
  const parsed = parsePatcherConfig(raw);
  return { ...DEFAULT_PATCHER_CONFIG, ...parsed };
}

/** Exported pure parser so tests / migration tooling can verify a
 *  payload without filesystem IO. */
export function parsePatcherConfig(raw: string): Partial<PatcherConfig> {
  const out: Partial<PatcherConfig> = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const m = trimmed.match(/^([a-zA-Z_]+):\s*(.+)$/);
    if (!m) continue;
    const key = m[1]!;
    const value = m[2]!.trim();
    switch (key) {
      case 'enabled':           out.enabled = isTruthy(value); break;
      case 'tickIntervalMs':    out.tickIntervalMs = parsePositive(value, DEFAULT_PATCHER_CONFIG.tickIntervalMs); break;
      case 'perTickLimit':      out.perTickLimit = parsePositive(value, DEFAULT_PATCHER_CONFIG.perTickLimit); break;
      case 'embeddingsEnabled': out.embeddingsEnabled = isTruthy(value); break;
    }
  }
  return out;
}

function isTruthy(value: string): boolean {
  const v = value.toLowerCase().replace(/['"]/g, '').trim();
  return v === 'true' || v === 'yes' || v === '1';
}

function parsePositive(value: string, fallback: number): number {
  const n = Number.parseInt(value.replace(/['"_]/g, ''), 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}
