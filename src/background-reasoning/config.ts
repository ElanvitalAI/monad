// Y2 background-reasoning config loader · `~/.monad/background-reasoning/budget.yaml`.
// Cf. ROADMAP-background-reasoning-patcher-thinker-2026-05-12.md §5.4 + §6 Y2.
// Hierarchy: yaml file > env > default. Absent/malformed → defaults.

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

export interface BackgroundReasoningConfig {
  /** Monthly cloud spend ceiling (USD). 0 disables cloud fallback. */
  monthlyCloudMaxUsd: number;
  /** Warn ratio over the monthly cap (0.0-1.0). */
  warnThreshold: number;
  /** Patcher allowed to spill to cloud when local saturated. */
  patcherCloudAllowed: boolean;
  /** Thinker allowed to spill to cloud. */
  thinkerCloudAllowed: boolean;
  /** Bypass budget when caller flags emergency. */
  emergencyCloudAlways: boolean;
  /** CPU load ratio (0-1) above which user counts as "active". */
  userActiveCpuThreshold: number;
  /** Max concurrent local LLM slots (Patcher + Thinker = 2). */
  maxLocalSlots: number;
}

export const DEFAULT_BACKGROUND_REASONING_CONFIG: BackgroundReasoningConfig = {
  monthlyCloudMaxUsd: 30,
  warnThreshold: 0.8,
  patcherCloudAllowed: false,
  thinkerCloudAllowed: true,
  emergencyCloudAlways: true,
  userActiveCpuThreshold: 0.7,
  maxLocalSlots: 2,
};

export function defaultConfigPath(): string {
  return join(homedir(), '.monad', 'background-reasoning', 'budget.yaml');
}

function pickNumber(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function pickBool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

function pickPercent(v: unknown, fallback: number): number {
  if (typeof v === 'string' && v.endsWith('%')) {
    const n = Number.parseFloat(v.slice(0, -1));
    if (Number.isFinite(n)) return n / 100;
  }
  if (typeof v === 'number' && Number.isFinite(v)) return v > 1 ? v / 100 : v;
  return fallback;
}

export interface LoadOpts {
  path?: string;
  env?: NodeJS.ProcessEnv;
}

export function loadBackgroundReasoningConfig(opts: LoadOpts = {}): BackgroundReasoningConfig {
  const cfg = { ...DEFAULT_BACKGROUND_REASONING_CONFIG };
  const env = opts.env ?? process.env;

  const file = opts.path ?? defaultConfigPath();
  if (existsSync(file)) {
    try {
      const raw = parseYaml(readFileSync(file, 'utf-8')) as Record<string, unknown> | null;
      const b = (raw?.budget as Record<string, unknown> | undefined) ?? {};
      cfg.monthlyCloudMaxUsd = pickNumber(b.monthly_cloud_max_usd, cfg.monthlyCloudMaxUsd);
      cfg.warnThreshold = pickPercent(b.warn_threshold, cfg.warnThreshold);
      cfg.patcherCloudAllowed = pickBool(b.patcher_cloud_allowed, cfg.patcherCloudAllowed);
      cfg.thinkerCloudAllowed = pickBool(b.thinker_cloud_allowed, cfg.thinkerCloudAllowed);
      cfg.emergencyCloudAlways = pickBool(b.emergency_cloud_always, cfg.emergencyCloudAlways);
      cfg.userActiveCpuThreshold = pickNumber(b.user_active_cpu_threshold, cfg.userActiveCpuThreshold);
      cfg.maxLocalSlots = pickNumber(b.max_local_slots, cfg.maxLocalSlots);
    } catch {
      // malformed → silent default per file-load contract
    }
  }

  if (env.MONAD_BG_MONTHLY_CLOUD_MAX_USD) {
    cfg.monthlyCloudMaxUsd = pickNumber(Number(env.MONAD_BG_MONTHLY_CLOUD_MAX_USD), cfg.monthlyCloudMaxUsd);
  }
  if (env.MONAD_BG_PATCHER_CLOUD_ALLOWED) {
    cfg.patcherCloudAllowed = env.MONAD_BG_PATCHER_CLOUD_ALLOWED === 'true';
  }
  if (env.MONAD_BG_THINKER_CLOUD_ALLOWED) {
    cfg.thinkerCloudAllowed = env.MONAD_BG_THINKER_CLOUD_ALLOWED === 'true';
  }

  return cfg;
}
