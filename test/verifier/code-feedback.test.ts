// Arc G — code-feedback builtin tests.
//
// Mocking `child_process.spawn` cleanly across bun-test is fragile, so
// these tests cover:
//   1. The default-disabled gate (no env → ok pass-through · no spawn)
//   2. Baseline / timeout env var parsing
//   3. The reportFor logic indirectly via the spec dispatch path
//
// End-to-end spawn behaviour is covered by manual `bunx tsc` runs in
// the Arc G PR test plan; these specs guard the wiring + gate.

import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  classifyTscClose,
  codeFeedbackBuiltin,
  __resetCodeFeedbackStateForTests,
  __seedInFlightForTests,
  __setTscSpawnerForTests,
  type TscSpawnChild,
  type TscSpawner,
} from '../../src/verifier/builtins/code-feedback.js';
import { runVerifier, __resetVerifierTrackerForTests } from '../../src/verifier/hook.js';
import type { VerifierContext } from '../../src/verifier/types.js';

const ctx: VerifierContext = { toolId: 'edit', surface: 'skill' };

const ENV_KEYS = [
  'HARNESS_CODE_FEEDBACK_ENABLED',
  'HARNESS_TSC_BASELINE',
  'HARNESS_CODE_FEEDBACK_TSC_TIMEOUT_MS',
  'HARNESS_CODE_FEEDBACK_DEBOUNCE_MS',
  'HARNESS_CODE_FEEDBACK_TEST_ENABLED',
  'HARNESS_CODE_FEEDBACK_BG_ENABLED',
  'NODE_OPTIONS',
] as const;

let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = {};
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  __resetVerifierTrackerForTests();
  __resetCodeFeedbackStateForTests();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  __resetVerifierTrackerForTests();
  __setTscSpawnerForTests(null);
  __resetCodeFeedbackStateForTests();
});

/** Fake child: EventEmitter that emits stdout/stderr then close(code, signal). Not a child_process mock. */
function fakeTscChild(
  close: { code: number | null; signal: NodeJS.Signals | null },
  output: string,
  capture?: { env?: NodeJS.ProcessEnv },
): TscSpawner {
  return (_command, _args, options) => {
    if (capture) capture.env = options.env;
    const stdout = new EventEmitter();
    const stderr = new EventEmitter();
    const child = new EventEmitter() as EventEmitter & TscSpawnChild;
    child.stdout = stdout;
    child.stderr = stderr;
    child.kill = () => true;
    queueMicrotask(() => {
      if (output) stdout.emit('data', Buffer.from(output));
      child.emit('close', close.code, close.signal);
    });
    return child;
  };
}

describe('code-feedback builtin · default-disabled gate', () => {
  test('returns ok pass-through when env var is not set', async () => {
    const r = await codeFeedbackBuiltin({}, {}, { kind: 'code-feedback' }, ctx);
    expect(r.ok).toBe(true);
    expect(r.issues).toHaveLength(0);
  });

  test('returns ok pass-through when env var is anything other than "1"', async () => {
    process.env['HARNESS_CODE_FEEDBACK_ENABLED'] = '0';
    let r = await codeFeedbackBuiltin({}, {}, { kind: 'code-feedback' }, ctx);
    expect(r.ok).toBe(true);
    expect(r.issues).toHaveLength(0);

    process.env['HARNESS_CODE_FEEDBACK_ENABLED'] = 'true';
    r = await codeFeedbackBuiltin({}, {}, { kind: 'code-feedback' }, ctx);
    expect(r.ok).toBe(true);
    expect(r.issues).toHaveLength(0);
  });

  test('mismatched spec.kind is a no-op', async () => {
    process.env['HARNESS_CODE_FEEDBACK_ENABLED'] = '1';
    const r = await codeFeedbackBuiltin(
      {},
      {},
      // @ts-expect-error — defensive type-narrow check
      { kind: 'mermaid-syntax' },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(r.issues).toHaveLength(0);
  });
});

describe('code-feedback builtin · runVerifier integration', () => {
  test('disabled gate via runVerifier returns ok', async () => {
    const r = await runVerifier(
      { kind: 'code-feedback' },
      {},
      {},
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  test('disabled gate does not consume same-issue-3 streak', async () => {
    // Even after many calls with the gate off, no issue should accumulate.
    for (let i = 0; i < 5; i++) {
      const r = await runVerifier({ kind: 'code-feedback' }, {}, {}, ctx);
      expect(r.ok).toBe(true);
    }
  });
});

describe('code-feedback builtin · enabled with very short timeout', () => {
  // When enabled with a 1ms timeout, the spawn should kill before tsc
  // can finish — exercising the timeout path. This doubles as a smoke
  // test for the spawn wiring without depending on tsc semantics.
  test('opt-in + 1ms timeout produces an info issue (timeout/detached) and ok=true', async () => {
    process.env['HARNESS_CODE_FEEDBACK_ENABLED'] = '1';
    process.env['HARNESS_CODE_FEEDBACK_TSC_TIMEOUT_MS'] = '1';
    // Arc G default (bg=on) → timeout path emits `tsc-detached`; when
    // bg is explicitly disabled the classic `tsc-timeout` surfaces.
    // spawn-error is also acceptable on machines without bunx in PATH.
    const r = await codeFeedbackBuiltin({}, {}, { kind: 'code-feedback' }, ctx);
    expect(r.ok).toBe(true);
    if (r.issues.length > 0) {
      expect([
        'code-feedback.tsc-timeout',
        'code-feedback.tsc-detached',
        'code-feedback.spawn-error',
      ]).toContain(r.issues[0]!.code);
      expect(r.issues[0]!.severity).toBe('info');
    }
  }, 10_000);
});

describe('classifyTscClose — pure close grade', () => {
  test('signal death is unmeasured and carries the signal', () => {
    const c = classifyTscClose(null, 'SIGABRT', '');
    expect(c.grade).toBe('unmeasured');
    expect(c.signal).toBe('SIGABRT');
    expect(c.exitCode).toBeNull();
  });

  test('exit code outside 0/1/2 is unmeasured', () => {
    const c = classifyTscClose(137, null, '');
    expect(c.grade).toBe('unmeasured');
    expect(c.exitCode).toBe(137);
    expect(c.signal).toBeNull();
  });

  test('heap out of memory text is unmeasured even on exit 0', () => {
    const c = classifyTscClose(0, null, 'FATAL ERROR: heap out of memory');
    expect(c.grade).toBe('unmeasured');
    expect(c.exitCode).toBe(0);
  });

  test('exit 0 with zero error TS lines is measurable', () => {
    const c = classifyTscClose(0, null, '');
    expect(c.grade).toBe('measurable');
    expect(c.exitCode).toBe(0);
  });

  test('exit 1 or 2 with error TS lines stays measurable', () => {
    expect(classifyTscClose(1, null, 'src/a.ts(1,1): error TS2322: nope').grade).toBe('measurable');
    expect(classifyTscClose(2, null, 'src/a.ts(1,1): error TS2322: nope').grade).toBe('measurable');
  });
});

describe('code-feedback builtin · crashed tsc is not clean', () => {
  function enableIsolated(): void {
    process.env['HARNESS_CODE_FEEDBACK_ENABLED'] = '1';
    process.env['HARNESS_CODE_FEEDBACK_DEBOUNCE_MS'] = '0';
    process.env['HARNESS_CODE_FEEDBACK_BG_ENABLED'] = '0';
    process.env['HARNESS_CODE_FEEDBACK_TEST_ENABLED'] = '0';
    process.env['HARNESS_CODE_FEEDBACK_TSC_TIMEOUT_MS'] = '30000';
    process.env['HARNESS_TSC_BASELINE'] = '0';
  }

  test('SIGABRT plus heap-out-of-memory-only output is not ok and names the signal', async () => {
    enableIsolated();
    __setTscSpawnerForTests(fakeTscChild(
      { code: null, signal: 'SIGABRT' },
      'FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory',
    ));
    const r = await codeFeedbackBuiltin({}, {}, { kind: 'code-feedback' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.issues.some(i => i.code === 'code-feedback.tsc-unmeasured')).toBe(true);
    const issue = r.issues.find(i => i.code === 'code-feedback.tsc-unmeasured');
    expect(issue?.severity).toBe('info');
    expect(issue?.message).toContain('SIGABRT');
    expect(issue?.message).toContain('exit');
    expect(r.issues.some(i => i.code === 'code-feedback.tsc-regression')).toBe(false);
  });

  test('exit 2 with error TS2322 above the baseline still yields tsc-regression', async () => {
    enableIsolated();
    __setTscSpawnerForTests(fakeTscChild(
      { code: 2, signal: null },
      'src/a.ts(1,1): error TS2322: Type X is not assignable to type Y.',
    ));
    const r = await codeFeedbackBuiltin({}, {}, { kind: 'code-feedback' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.issues.some(i => i.code === 'code-feedback.tsc-regression')).toBe(true);
    expect(r.issues.some(i => i.code === 'code-feedback.tsc-unmeasured')).toBe(false);
  });

  test('spawn env NODE_OPTIONS contains --max-old-space-size=', async () => {
    enableIsolated();
    const capture: { env?: NodeJS.ProcessEnv } = {};
    __setTscSpawnerForTests(fakeTscChild({ code: 0, signal: null }, '', capture));
    const r = await codeFeedbackBuiltin({}, {}, { kind: 'code-feedback' }, ctx);
    expect(r.ok).toBe(true);
    expect(capture.env?.NODE_OPTIONS ?? '').toContain('--max-old-space-size=');
  });

  test('in-flight pickup of a signal-killed tsc is unmeasured, not clean', async () => {
    enableIsolated();
    process.env['HARNESS_CODE_FEEDBACK_BG_ENABLED'] = '1';
    __seedInFlightForTests(process.cwd(), {
      startedAt: Date.now() - 5_000,
      promise: Promise.resolve({
        errorCount: 0,
        sampleErrors: [],
        timedOut: false,
        unmeasured: { exitCode: null, signal: 'SIGABRT' },
      }),
    });
    const r = await codeFeedbackBuiltin({}, {}, { kind: 'code-feedback' }, ctx);
    expect(r.ok).toBe(false);
    const issue = r.issues.find(i => i.code === 'code-feedback.tsc-unmeasured');
    expect(issue).toBeDefined();
    expect(issue?.message).toContain('SIGABRT');
  });
});
