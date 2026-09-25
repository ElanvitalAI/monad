// PWA file watcher — runtime auto-rebuild for `monad nexus run` static
// mode. Lives inside the nexus daemon process so the watcher survives
// shell close and is reaped when the daemon shuts down.

import { watch, type FSWatcher } from 'node:fs';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { debug } from '../debug/log.js';
import { checkPwaStaleness, type StalenessVerdict } from './pwa-staleness.js';

const SOURCE_DIRS = ['src', 'public'] as const;
const SOURCE_FILES = [
  'next.config.ts',
  'next.config.js',
  'next.config.mjs',
  'package.json',
  'postcss.config.mjs',
  'tsconfig.json',
] as const;

export type PwaWatchObservationArgs =
  | [event: 'started', data: { attachedWatchers: number; skippedPaths: number }]
  | [event: 'initial-staleness', data: StalenessVerdict]
  | [event: 'initial-staleness-failed', data: Record<never, never>]
  | [event: 'change-detected', data: Record<never, never>]
  | [event: 'rebuild-succeeded', data: { durationMs: number }]
  | [event: 'rebuild-failed', data: { exitCode: number | null }];

/** Event-specific lifecycle observation contract for PWA file watching. */
export type PwaWatchObservation = (...args: PwaWatchObservationArgs) => void;

export interface PwaWatchOpts {
  /** apps/pwa directory. Watcher attaches to children, not this root. */
  pwaCwd: string;
  /** Debounce window (ms). Many editors emit several events per save —
   * this collapses the burst into one build. Default 1500ms. */
  debounceMs?: number;
  /** Called when a file changes and the debounce window fires. */
  buildFn?: () => Promise<{ exitCode: number; durationMs?: number }>;
  /** Clock used when a successful build result omits its duration. */
  now?: () => number;
  /** Startup source-versus-artifact comparison. Injectable for deterministic tests. */
  checkStaleness?: (pwaCwd: string) => StalenessVerdict;
  /** Human-readable log sink. Default = console. */
  out?: { log: (s: string) => void; error: (s: string) => void };
  /** Structured observability sink. Its failures never affect watching or rebuilding. */
  observe?: PwaWatchObservation;
}

export interface PwaWatchHandle {
  /** Stop all watchers + clear any pending debounce. Idempotent. */
  stop: () => void;
}

function extractExitCode(error: unknown): number | null {
  if (typeof error !== 'object' || error === null || !('exitCode' in error)) return null;
  const { exitCode } = error as { exitCode?: unknown };
  return typeof exitCode === 'number' && Number.isFinite(exitCode) ? exitCode : null;
}

/** Start watching apps/pwa source for changes. Returns a handle the
 * caller closes on daemon shutdown. Never throws — file watchers that
 * fail to attach (e.g., dir missing) are silently skipped so partial
 * trees still get partial coverage. */
export function startPwaWatch(opts: PwaWatchOpts): PwaWatchHandle {
  const debounceMs = opts.debounceMs ?? 1500;
  const out = opts.out ?? console;
  const now = opts.now ?? Date.now;
  const checkStaleness = opts.checkStaleness ?? checkPwaStaleness;
  const observe: PwaWatchObservation = opts.observe ?? ((event, data) => debug.log('pwa.watch', event, data));
  const safelyObserve: PwaWatchObservation = (...args): void => {
    try { observe(...args); } catch { /* observability must not alter watcher lifecycle */ }
  };
  const watchers: FSWatcher[] = [];
  let skippedPaths = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let building = false;
  let pendingAfterBuild = false;
  let stopped = false;

  const buildFn = opts.buildFn ?? (async () => {
    const { runPwaBuild } = await import('./pwa-build.js');
    return runPwaBuild({ cwd: opts.pwaCwd, out });
  });

  const trigger = (): void => {
    if (stopped) return;
    if (building) {
      pendingAfterBuild = true;
      return;
    }
    building = true;
    out.log('  watch: change detected — rebuilding apps/pwa...');
    safelyObserve('change-detected', {});
    const startedAt = now();
    void Promise.resolve()
      .then(buildFn)
      .then((result) => {
        const measuredDurationMs = typeof result.durationMs === 'number' && Number.isFinite(result.durationMs)
          ? result.durationMs
          : Math.max(0, now() - startedAt);
        const consoleSecs = typeof result.durationMs === 'number' && Number.isFinite(result.durationMs)
          ? `${(result.durationMs / 1000).toFixed(1)}s`
          : '?s';
        if (result.exitCode === 0) {
          out.log(`  watch: rebuild ✓ (${consoleSecs}) — refresh browser to pick up new bundle`);
          safelyObserve('rebuild-succeeded', { durationMs: measuredDurationMs });
        } else {
          out.error(`  watch: rebuild ✗ (exit ${result.exitCode}) — previous bundle still served`);
          safelyObserve('rebuild-failed', { exitCode: result.exitCode });
        }
      })
      .catch((error: unknown) => {
        out.error(`  watch: rebuild error — ${error instanceof Error ? error.message : String(error)}`);
        safelyObserve('rebuild-failed', { exitCode: extractExitCode(error) });
      })
      .finally(() => {
        building = false;
        if (pendingAfterBuild) {
          pendingAfterBuild = false;
          schedule();
        }
      });
  };

  const schedule = (): void => {
    if (stopped) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      trigger();
    }, debounceMs);
  };

  const onEvent = (eventType: string, _filename: string | null): void => {
    if (stopped) return;
    if (eventType === 'change' || eventType === 'rename') schedule();
  };

  for (const directory of SOURCE_DIRS) {
    const path = join(opts.pwaCwd, directory);
    if (!existsSync(path)) {
      skippedPaths += 1;
      continue;
    }
    try {
      watchers.push(watch(path, { recursive: true }, onEvent));
    } catch (error) {
      skippedPaths += 1;
      out.error(`  watch: could not attach to ${path} — ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  for (const file of SOURCE_FILES) {
    const path = join(opts.pwaCwd, file);
    if (!existsSync(path)) {
      skippedPaths += 1;
      continue;
    }
    try {
      watchers.push(watch(path, onEvent));
    } catch {
      skippedPaths += 1;
    }
  }

  out.log(`  watch: monitoring apps/pwa/{${SOURCE_DIRS.join(',')}} + ${SOURCE_FILES.length} config files (debounce ${debounceMs}ms)`);
  safelyObserve('started', { attachedWatchers: watchers.length, skippedPaths });

  void Promise.resolve()
    .then(() => checkStaleness(opts.pwaCwd))
    .then((verdict) => {
      safelyObserve('initial-staleness', verdict);
      if (verdict.stale) trigger();
    })
    .catch(() => {
      safelyObserve('initial-staleness-failed', {});
    });

  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
      for (const watcher of watchers) {
        try { watcher.close(); } catch { /* already closed */ }
      }
    },
  };
}
