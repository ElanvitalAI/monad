import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startPwaWatch, type PwaWatchObservation, type PwaWatchObservationArgs } from '../src/cli/pwa-watch.js';

interface CapturedOut {
  log: (s: string) => void;
  error: (s: string) => void;
  logs: string[];
  errors: string[];
}

type CapturedObservation = PwaWatchObservationArgs;

function makeOut(): CapturedOut {
  const logs: string[] = [];
  const errors: string[] = [];
  return {
    log: (s) => logs.push(s),
    error: (s) => errors.push(s),
    logs,
    errors,
  };
}

function makeObserver(): { observations: CapturedObservation[]; observe: PwaWatchObservation } {
  const observations: CapturedObservation[] = [];
  return {
    observations,
    observe: (...args) => observations.push(args),
  };
}

function hasEvent(event: CapturedObservation[0]): (observation: CapturedObservation) => boolean {
  return (observation) => observation[0] === event;
}

function tick(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(predicate: () => boolean, timeoutMs = 500): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('timed out waiting for file watcher');
    await tick(10);
  }
}

describe.serial('startPwaWatch', () => {
  let root = '';
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'pwawatch-'));
    mkdirSync(join(root, 'src'), { recursive: true });
    mkdirSync(join(root, 'public'), { recursive: true });
    writeFileSync(join(root, 'src/page.tsx'), 'init');
    writeFileSync(join(root, 'next.config.ts'), 'export default {};');
    writeFileSync(join(root, 'package.json'), '{}');
  });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  test('logs the monitoring line and records attached and skipped paths on start', () => {
    const out = makeOut();
    const { observations, observe } = makeObserver();
    const handle = startPwaWatch({
      pwaCwd: root,
      debounceMs: 50,
      buildFn: async () => ({ exitCode: 0, durationMs: 10 }),
      out,
      observe,
    });
    expect(out.logs.some((l) => l.includes('watch: monitoring'))).toBe(true);
    expect(observations).toContainEqual(['started', { attachedWatchers: 4, skippedPaths: 4 }]);
    handle.stop();
  });

  test('records fully attached monitoring separately from partial monitoring', () => {
    for (const file of ['next.config.js', 'next.config.mjs', 'postcss.config.mjs', 'tsconfig.json']) {
      writeFileSync(join(root, file), '');
    }
    const { observations, observe } = makeObserver();
    const handle = startPwaWatch({
      pwaCwd: root,
      buildFn: async () => ({ exitCode: 0 }),
      observe,
    });
    expect(observations).toContainEqual(['started', { attachedWatchers: 8, skippedPaths: 0 }]);
    handle.stop();
  });

  test('debounces a burst of writes into a single build call and records change and success duration', async () => {
    const out = makeOut();
    const { observations, observe } = makeObserver();
    let buildCalls = 0;
    const handle = startPwaWatch({
      pwaCwd: root,
      debounceMs: 60,
      buildFn: async () => { buildCalls += 1; return { exitCode: 0, durationMs: 123 }; },
      out,
      observe,
    });
    // Three writes inside the debounce window:
    await tick(20);
    writeFileSync(join(root, 'src/page.tsx'), 'edit-1');
    writeFileSync(join(root, 'src/page.tsx'), 'edit-2');
    writeFileSync(join(root, 'src/page.tsx'), 'edit-3');
    await waitFor(() => observations.some(hasEvent('rebuild-succeeded')));
    handle.stop();
    expect(buildCalls).toBe(1);
    expect(observations.filter(hasEvent('change-detected'))).toHaveLength(1);
    expect(observations).toContainEqual(['rebuild-succeeded', { durationMs: 123 }]);
    expect(out.logs.some((line) => line.includes('rebuild ✓ (0.1s)'))).toBe(true);
  });

  test('measures a numeric success duration while preserving unknown-duration output', async () => {
    const out = makeOut();
    const { observations, observe } = makeObserver();
    const clock = [100, 175];
    const handle = startPwaWatch({
      pwaCwd: root,
      debounceMs: 50,
      buildFn: async () => ({ exitCode: 0 }),
      out,
      observe,
      now: () => clock.shift() ?? 175,
    });
    await tick(20);
    writeFileSync(join(root, 'src/page.tsx'), 'no-duration');
    await waitFor(() => observations.some(hasEvent('rebuild-succeeded')));
    handle.stop();
    expect(observations).toContainEqual(['rebuild-succeeded', { durationMs: 75 }]);
    expect(out.logs).toContain('  watch: rebuild ✓ (?s) — refresh browser to pick up new bundle');
  });

  test('records nonzero build exit code separately while preserving failure output', async () => {
    const out = makeOut();
    const { observations, observe } = makeObserver();
    const handle = startPwaWatch({
      pwaCwd: root,
      debounceMs: 50,
      buildFn: async () => ({ exitCode: 2, durationMs: 5 }),
      out,
      observe,
    });
    await tick(20);
    writeFileSync(join(root, 'src/page.tsx'), 'broken');
    await waitFor(() => observations.some(hasEvent('rebuild-failed')));
    handle.stop();
    expect(observations).toContainEqual(['rebuild-failed', { exitCode: 2 }]);
    expect(observations.some(hasEvent('rebuild-succeeded'))).toBe(false);
    expect(out.errors.some((e) => e.includes('rebuild ✗') && e.includes('exit 2'))).toBe(true);
  });

  test('records rejected builds with their known exit code or explicit null', async () => {
    const out = makeOut();
    const { observations, observe } = makeObserver();
    const handle = startPwaWatch({
      pwaCwd: root,
      debounceMs: 50,
      buildFn: async () => { throw Object.assign(new Error('build process unavailable'), { exitCode: 17 }); },
      out,
      observe,
    });
    await tick(20);
    writeFileSync(join(root, 'src/page.tsx'), 'reject-known-code');
    await waitFor(() => observations.some(hasEvent('rebuild-failed')));
    handle.stop();
    expect(observations).toContainEqual(['rebuild-failed', { exitCode: 17 }]);
    expect(out.errors.some((line) => line.includes('rebuild error — build process unavailable'))).toBe(true);

    const unknown = makeObserver();
    const unknownHandle = startPwaWatch({
      pwaCwd: root,
      debounceMs: 50,
      buildFn: async () => { throw new Error('unknown exit'); },
      observe: unknown.observe,
    });
    await tick(20);
    writeFileSync(join(root, 'src/page.tsx'), 'reject-unknown-code');
    await waitFor(() => unknown.observations.some(hasEvent('rebuild-failed')));
    unknownHandle.stop();
    expect(unknown.observations).toContainEqual(['rebuild-failed', { exitCode: null }]);
  });

  test('records synchronously thrown builds with a null exit code and preserves failure output', async () => {
    const out = makeOut();
    const { observations, observe } = makeObserver();
    const handle = startPwaWatch({
      pwaCwd: root,
      debounceMs: 50,
      buildFn: () => { throw new Error('synchronous build failure'); },
      out,
      observe,
    });
    await tick(20);
    writeFileSync(join(root, 'src/page.tsx'), 'throw-sync');
    await waitFor(() => observations.some(hasEvent('rebuild-failed')));
    handle.stop();
    expect(observations).toContainEqual(['rebuild-failed', { exitCode: null }]);
    expect(out.errors).toContain('  watch: rebuild error — synchronous build failure');
  });

  test('isolates throwing observers from successful rebuilds and watcher cleanup', async () => {
    const out = makeOut();
    const handle = startPwaWatch({
      pwaCwd: root,
      debounceMs: 50,
      buildFn: async () => ({ exitCode: 0, durationMs: 10 }),
      out,
      observe: () => { throw new Error('observer unavailable'); },
    });
    await tick(20);
    writeFileSync(join(root, 'src/page.tsx'), 'observer-throws');
    await waitFor(() => out.logs.some((line) => line.includes('rebuild ✓')));
    expect(out.errors).toHaveLength(0);
    expect(() => handle.stop()).not.toThrow();
  });

  test('rebuilds once at startup when source is newer than the artifact', async () => {
    const { observations, observe } = makeObserver();
    let buildCalls = 0;
    const handle = startPwaWatch({
      pwaCwd: root,
      buildFn: async () => { buildCalls += 1; return { exitCode: 0 }; },
      checkStaleness: () => ({ stale: true, reason: 'source-newer', sourceMtime: 200, outMtime: 100 }),
      observe,
    });
    await waitFor(() => observations.some(hasEvent('rebuild-succeeded')));
    handle.stop();
    expect(buildCalls).toBe(1);
    expect(observations).toContainEqual(['initial-staleness', {
      stale: true, reason: 'source-newer', sourceMtime: 200, outMtime: 100,
    }]);
  });

  test('records missing artifacts separately and does not build when artifacts are fresh', async () => {
    const missing = makeObserver();
    let missingBuildCalls = 0;
    const missingHandle = startPwaWatch({
      pwaCwd: root,
      buildFn: async () => { missingBuildCalls += 1; return { exitCode: 0 }; },
      checkStaleness: () => ({ stale: true, reason: 'out-missing', sourceMtime: 100, outMtime: 0 }),
      observe: missing.observe,
    });
    await waitFor(() => missing.observations.some(hasEvent('rebuild-succeeded')));
    missingHandle.stop();
    expect(missingBuildCalls).toBe(1);
    expect(missing.observations).toContainEqual(['initial-staleness', {
      stale: true, reason: 'out-missing', sourceMtime: 100, outMtime: 0,
    }]);

    const fresh = makeObserver();
    let freshBuildCalls = 0;
    const freshHandle = startPwaWatch({
      pwaCwd: root,
      buildFn: async () => { freshBuildCalls += 1; return { exitCode: 0 }; },
      checkStaleness: () => ({ stale: false, reason: 'fresh', sourceMtime: 100, outMtime: 200 }),
      observe: fresh.observe,
    });
    await waitFor(() => fresh.observations.some(hasEvent('initial-staleness')));
    freshHandle.stop();
    expect(freshBuildCalls).toBe(0);
    expect(fresh.observations).toContainEqual(['initial-staleness', {
      stale: false, reason: 'fresh', sourceMtime: 100, outMtime: 200,
    }]);
  });

  test('isolates startup staleness and rebuild failures while later changes still rebuild', async () => {
    const stalenessFailure = makeObserver();
    let stalenessFailureBuilds = 0;
    const stalenessFailureHandle = startPwaWatch({
      pwaCwd: root,
      debounceMs: 20,
      buildFn: async () => { stalenessFailureBuilds += 1; return { exitCode: 0 }; },
      checkStaleness: () => { throw new Error('stat unavailable'); },
      observe: stalenessFailure.observe,
    });
    await waitFor(() => stalenessFailure.observations.some(hasEvent('initial-staleness-failed')));
    writeFileSync(join(root, 'src/page.tsx'), 'after-staleness-failure');
    await waitFor(() => stalenessFailureBuilds === 1);
    stalenessFailureHandle.stop();
    expect(stalenessFailure.observations).toContainEqual(['initial-staleness-failed', {}]);

    const rebuildFailure = makeObserver();
    let rebuildFailureBuilds = 0;
    const rebuildFailureHandle = startPwaWatch({
      pwaCwd: root,
      debounceMs: 20,
      buildFn: async () => {
        rebuildFailureBuilds += 1;
        return { exitCode: rebuildFailureBuilds === 1 ? 1 : 0 };
      },
      checkStaleness: () => ({ stale: true, reason: 'source-newer', sourceMtime: 200, outMtime: 100 }),
      observe: rebuildFailure.observe,
    });
    await waitFor(() => rebuildFailure.observations.some(hasEvent('rebuild-failed')));
    writeFileSync(join(root, 'src/page.tsx'), 'after-startup-build-failure');
    await waitFor(() => rebuildFailureBuilds === 2);
    rebuildFailureHandle.stop();
    expect(rebuildFailure.observations).toContainEqual(['rebuild-succeeded', { durationMs: expect.any(Number) }]);
  });

  test('stop is idempotent (safe to call twice)', () => {
    const out = makeOut();
    const handle = startPwaWatch({
      pwaCwd: root,
      buildFn: async () => ({ exitCode: 0 }),
      out,
    });
    expect(() => { handle.stop(); handle.stop(); }).not.toThrow();
  });
});
