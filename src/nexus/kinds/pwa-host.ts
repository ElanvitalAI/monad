// NEXUS · pwa-host kind (Phase N-2 PR η)
//
// Wraps `bun run dev` (cwd=apps/pwa) as a supervisor-managed tab so the
// Next.js dev server is co-managed with the daemon. Aggressive supervision
// per HANDOFF §2.3:
//   - command:        ['bun', 'run', 'dev']  (cwd=apps/pwa)
//   - health:         http GET http://127.0.0.1:3210/healthz every 5s
//                     (stale after 30s → unhealthy)
//   - restart:        on-crash · backoff [5s,10s,30s,60s,5m] · maxPerHour 10
//   - haltPatterns:   ['EADDRINUSE', 'Module not found', 'Cannot find module']
//                     → port conflict + missing-deps short-circuit instead
//                     of restart-loop
//   - graceMs:        8000 (next dev needs ~8s for graceful shutdown)
//
// Default OFF (per OQ1: daemon only auto-enabled). User opts in via
// `monad nexus run --pwa` or `runNexus({ enablePwaHostTab: true })`.

import type { TabKind, TabSpec } from './types.js';
import { join as joinPath } from 'node:path';
// PLAN-nexus-shell-followup U3 (2026-05-16) — kind-detail-view trim.
// createPwaHostTabView · summarizePwaHost · haltHintPwaHost · staticPwaHostView
// 가 모두 외부 caller 없음 (TUI sidebar viewForTab 의 dead path).

export const PWA_HOST_KIND: TabKind = 'pwa-host';
export const PWA_HOST_DEFAULT_TAB_ID = 'pwa-host:1';
export const PWA_HOST_DEFAULT_PORT = 3210;
export const PWA_HOST_DEFAULT_HEALTHZ = `http://127.0.0.1:${PWA_HOST_DEFAULT_PORT}/healthz`;
export const PWA_HOST_HALT_PATTERNS = [
  'EADDRINUSE',
  'Module not found',
  'Cannot find module',
] as const;

export interface PwaHostTabOpts {
  id?: string;
  label?: string;
  /** Argv override · default = ['bun', 'run', 'dev']. */
  command?: string[];
  /** cwd default = `<repo>/apps/pwa` (resolved from process.cwd()). */
  cwd?: string;
  /** Healthz URL the supervisor probes. Defaults to PWA_HOST_DEFAULT_HEALTHZ. */
  healthzUrl?: string;
  /** Extra env merged over process.env at spawn time. */
  env?: Record<string, string>;
  /** Override halt patterns (extends rather than replaces — defaults
   *  always included unless `replace=true`). */
  haltPatterns?: string[];
  /** Replace the default halt patterns instead of extending. */
  replaceHaltPatterns?: boolean;
}

function defaultPwaCwd(): string {
  return joinPath(process.cwd(), 'apps', 'pwa');
}

export function createPwaHostTabSpec(opts: PwaHostTabOpts = {}): TabSpec {
  const id = opts.id ?? PWA_HOST_DEFAULT_TAB_ID;
  const command = opts.command ?? ['bun', 'run', 'dev'];
  const haltPatterns = opts.replaceHaltPatterns
    ? (opts.haltPatterns ?? [...PWA_HOST_HALT_PATTERNS])
    : [...PWA_HOST_HALT_PATTERNS, ...(opts.haltPatterns ?? [])];
  return {
    id,
    kind: PWA_HOST_KIND,
    label: opts.label ?? id,
    spawn: {
      command,
      cwd: opts.cwd ?? defaultPwaCwd(),
      ...(opts.env !== undefined ? { env: opts.env } : {}),
    },
    health: {
      kind: 'http',
      intervalMs: 5_000,
      timeoutMs: 3_000,
      staleAfterMs: 30_000,
      spec: { url: opts.healthzUrl ?? PWA_HOST_DEFAULT_HEALTHZ },
    },
    restart: {
      policy: 'on-crash',
      backoffMs: [5_000, 10_000, 30_000, 60_000, 300_000],
      maxPerHour: 10,
      graceMs: 8_000,
      haltPatterns,
    },
    meta: {
      healthzUrl: opts.healthzUrl ?? PWA_HOST_DEFAULT_HEALTHZ,
      cwd: opts.cwd ?? defaultPwaCwd(),
    },
  };
}

// PLAN-nexus-shell-followup U3 (2026-05-16) — createPwaHostTabView +
// CreatePwaHostTabViewOpts + summarizePwaHost + haltHintPwaHost +
// staticPwaHostView 모두 외부 caller 없음 (TUI sidebar 의 dead path).
