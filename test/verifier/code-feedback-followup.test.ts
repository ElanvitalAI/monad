// Arc G follow-up — debounce · test heuristic · background-on-timeout.
//
// Covers the 3 features layered on top of the Arc G code-feedback
// builtin. Spawn behaviour is still flaky across environments, so
// these specs test the surrounding logic with seams + fixtures instead
// of relying on `bunx tsc` actually running fast enough to observe.
//
// PLAN: 내부 문서 `PLAN-harness-arc-g-follow-up` §8

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';

import {
  codeFeedbackBuiltin,
  __resetCodeFeedbackStateForTests,
  __seedInFlightForTests,
  __inspectCodeFeedbackStateForTests,
} from '../../src/verifier/builtins/code-feedback.js';
import { deriveTestPaths } from '../../src/verifier/builtins/test-heuristic.js';
import type { VerifierContext } from '../../src/verifier/types.js';

const ctx: VerifierContext = { toolId: 'edit', surface: 'skill' };

const ENV_KEYS = [
  'HARNESS_CODE_FEEDBACK_ENABLED',
  'HARNESS_TSC_BASELINE',
  'HARNESS_CODE_FEEDBACK_TSC_TIMEOUT_MS',
  'HARNESS_CODE_FEEDBACK_DEBOUNCE_MS',
  'HARNESS_CODE_FEEDBACK_TEST_ENABLED',
  'HARNESS_CODE_FEEDBACK_TEST_TIMEOUT_MS',
  'HARNESS_CODE_FEEDBACK_BG_ENABLED',
  'HARNESS_CODE_FEEDBACK_BG_MAX_MS',
] as const;

let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = {};
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  __resetCodeFeedbackStateForTests();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  __resetCodeFeedbackStateForTests();
});

// ─── default-disabled safety net ─────────────────────────────────

describe('code-feedback follow-up · default-disabled', () => {
  test('every new env var unset → pass-through ok', async () => {
    // Parent gate off — even with all follow-up envs configured,
    // nothing runs. Matches Arc G "default disabled" invariant.
    process.env['HARNESS_CODE_FEEDBACK_DEBOUNCE_MS'] = '5000';
    process.env['HARNESS_CODE_FEEDBACK_TEST_ENABLED'] = '1';
    process.env['HARNESS_CODE_FEEDBACK_BG_ENABLED'] = '1';
    const r = await codeFeedbackBuiltin({}, {}, { kind: 'code-feedback' }, ctx);
    expect(r.ok).toBe(true);
    expect(r.issues).toHaveLength(0);
  });
});

// ─── derive test paths (pure) ────────────────────────────────────

describe('deriveTestPaths — path heuristic', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = joinPath(tmpdir(), `mh-cfg-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmp, { recursive: true });
    mkdirSync(joinPath(tmp, 'src', 'foo'), { recursive: true });
    mkdirSync(joinPath(tmp, 'test', 'foo'), { recursive: true });
  });
  afterEach(() => {
    try { rmSync(tmp, { recursive: true, force: true }); } catch { /* noop */ }
  });

  test('src/foo/bar.ts → test/foo/bar.test.ts when it exists', () => {
    writeFileSync(joinPath(tmp, 'test', 'foo', 'bar.test.ts'), 'export {};', 'utf-8');
    const paths = deriveTestPaths('src/foo/bar.ts', tmp);
    expect(paths).toContain(joinPath('test', 'foo', 'bar.test.ts'));
  });

  test('src/foo/bar.ts → test/foo-bar.test.ts dashed fallback', () => {
    writeFileSync(joinPath(tmp, 'test', 'foo-bar.test.ts'), 'export {};', 'utf-8');
    const paths = deriveTestPaths('src/foo/bar.ts', tmp);
    expect(paths).toContain(joinPath('test', 'foo-bar.test.ts'));
  });

  test('src/foo/bar.ts → test/bar.test.ts flat fallback', () => {
    writeFileSync(joinPath(tmp, 'test', 'bar.test.ts'), 'export {};', 'utf-8');
    const paths = deriveTestPaths('src/foo/bar.ts', tmp);
    expect(paths).toContain(joinPath('test', 'bar.test.ts'));
  });

  test('identity: editing a test file → runs itself', () => {
    writeFileSync(joinPath(tmp, 'test', 'foo', 'x.test.ts'), 'export {};', 'utf-8');
    const paths = deriveTestPaths('test/foo/x.test.ts', tmp);
    expect(paths).toEqual([joinPath('test', 'foo', 'x.test.ts')]);
  });

  test('non-src / non-test path → empty', () => {
    expect(deriveTestPaths('docs/foo.md', tmp)).toEqual([]);
    expect(deriveTestPaths('scripts/x.ts', tmp)).toEqual([]);
    expect(deriveTestPaths('', tmp)).toEqual([]);
  });

  test('non-existent candidate excluded even when pattern matches', () => {
    const paths = deriveTestPaths('src/foo/bar.ts', tmp);
    expect(paths).toEqual([]);   // nothing written to disk this time
  });

  test('path outside cwd → empty (no traversal)', () => {
    expect(deriveTestPaths('/etc/passwd', tmp)).toEqual([]);
    expect(deriveTestPaths('../sibling/x.ts', tmp)).toEqual([]);
  });

  test('dedupes overlapping candidates', () => {
    writeFileSync(joinPath(tmp, 'test', 'bar.test.ts'), 'export {};', 'utf-8');
    const paths = deriveTestPaths('src/bar.ts', tmp);
    // Exactly one match — no duplicate entries for the same file.
    expect(paths).toEqual([joinPath('test', 'bar.test.ts')]);
  });

  test('absolute path normalised to cwd-relative', () => {
    writeFileSync(joinPath(tmp, 'test', 'foo', 'bar.test.ts'), 'export {};', 'utf-8');
    const abs = joinPath(tmp, 'src', 'foo', 'bar.ts');
    const paths = deriveTestPaths(abs, tmp);
    expect(paths).toContain(joinPath('test', 'foo', 'bar.test.ts'));
  });
});

// ─── debounce ───────────────────────────────────────────────────

describe('code-feedback follow-up · debounce', () => {
  test('second call inside debounce window emits debounced info + skips spawn', async () => {
    process.env['HARNESS_CODE_FEEDBACK_ENABLED'] = '1';
    process.env['HARNESS_CODE_FEEDBACK_DEBOUNCE_MS'] = '60000';  // effectively "always skip second"
    process.env['HARNESS_CODE_FEEDBACK_BG_ENABLED'] = '0';        // isolate: no bg path interference
    process.env['HARNESS_CODE_FEEDBACK_TSC_TIMEOUT_MS'] = '1';    // first call bails fast via timeout

    // First call: spawns (timeout fires fast → classic tsc-timeout info).
    const first = await codeFeedbackBuiltin(
      { file_path: 'docs/ignored.md' },
      {},
      { kind: 'code-feedback' },
      ctx,
    );
    expect(first.ok).toBe(true);

    // Second call within debounce window must short-circuit.
    const second = await codeFeedbackBuiltin(
      { file_path: 'docs/ignored.md' },
      {},
      { kind: 'code-feedback' },
      ctx,
    );
    expect(second.ok).toBe(true);
    expect(second.issues.map(i => i.code)).toContain('code-feedback.debounced');
  }, 20_000);

  test('DEBOUNCE_MS=0 disables debounce', async () => {
    process.env['HARNESS_CODE_FEEDBACK_ENABLED'] = '1';
    process.env['HARNESS_CODE_FEEDBACK_DEBOUNCE_MS'] = '0';
    process.env['HARNESS_CODE_FEEDBACK_BG_ENABLED'] = '0';
    process.env['HARNESS_CODE_FEEDBACK_TSC_TIMEOUT_MS'] = '1';
    // First and second calls should both produce an info (timeout) — no
    // debounce filter active.
    const a = await codeFeedbackBuiltin({}, {}, { kind: 'code-feedback' }, ctx);
    const b = await codeFeedbackBuiltin({}, {}, { kind: 'code-feedback' }, ctx);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    // Neither should be `debounced`.
    for (const r of [a, b]) {
      for (const issue of r.issues) expect(issue.code).not.toBe('code-feedback.debounced');
    }
  }, 10_000);
});

// ─── background pickup ─────────────────────────────────────────

describe('code-feedback follow-up · background pickup', () => {
  test('seeded inFlight whose promise is settled → its result delivered', async () => {
    process.env['HARNESS_CODE_FEEDBACK_ENABLED'] = '1';
    process.env['HARNESS_TSC_BASELINE'] = '0';    // 0 baseline makes any count a regression
    const cwd = process.cwd();

    __seedInFlightForTests(cwd, {
      startedAt: Date.now() - 10_000,
      // Pretend a background tsc finished with 3 errors — over baseline 0.
      promise: Promise.resolve({
        errorCount: 3,
        sampleErrors: ['src/a.ts: error TS1000: boom'],
        timedOut: false,
      }),
    });

    const r = await codeFeedbackBuiltin({}, {}, { kind: 'code-feedback' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.issues.some(i => i.code === 'code-feedback.tsc-regression')).toBe(true);
    // InFlight entry consumed (deleted after report).
    expect(__inspectCodeFeedbackStateForTests().inFlightKeys).not.toContain(cwd);
  });

  test('seeded inFlight still pending → still-running info issue', async () => {
    process.env['HARNESS_CODE_FEEDBACK_ENABLED'] = '1';
    const cwd = process.cwd();

    // Never-resolving promise models "still running".
    const pending = new Promise<never>(() => { /* forever */ });
    __seedInFlightForTests(cwd, {
      startedAt: Date.now() - 35_000,
      // Cast is safe — builtin only awaits and peeks at settle status.
      promise: pending as unknown as Promise<{
        errorCount: number;
        sampleErrors: string[];
        timedOut: boolean;
      }>,
    });

    const r = await codeFeedbackBuiltin({}, {}, { kind: 'code-feedback' }, ctx);
    expect(r.ok).toBe(true);
    expect(r.issues.some(i => i.code === 'code-feedback.bg-still-running')).toBe(true);
    // Still in flight — not cleared until settle.
    expect(__inspectCodeFeedbackStateForTests().inFlightKeys).toContain(cwd);
  });

  test('bg disabled → timeout reports classic tsc-timeout', async () => {
    process.env['HARNESS_CODE_FEEDBACK_ENABLED'] = '1';
    process.env['HARNESS_CODE_FEEDBACK_BG_ENABLED'] = '0';
    process.env['HARNESS_CODE_FEEDBACK_TSC_TIMEOUT_MS'] = '1';

    const r = await codeFeedbackBuiltin({}, {}, { kind: 'code-feedback' }, ctx);
    expect(r.ok).toBe(true);
    const codes = r.issues.map(i => i.code);
    // Either timeout or spawn-error — both info severity, bg variant
    // not allowed because disabled.
    expect(codes.every(c => c !== 'code-feedback.tsc-detached')).toBe(true);
  }, 10_000);
});

// ─── test seam state hygiene ──────────────────────────────────

describe('code-feedback follow-up · test seam', () => {
  test('__resetCodeFeedbackStateForTests clears both maps', () => {
    __seedInFlightForTests('/tmp/x', {
      startedAt: Date.now(),
      promise: Promise.resolve({ errorCount: 0, sampleErrors: [], timedOut: false }),
    });
    expect(__inspectCodeFeedbackStateForTests().inFlightKeys).toContain('/tmp/x');
    __resetCodeFeedbackStateForTests();
    const state = __inspectCodeFeedbackStateForTests();
    expect(state.inFlightKeys).toEqual([]);
    expect(state.debounceKeys).toEqual([]);
  });
});
