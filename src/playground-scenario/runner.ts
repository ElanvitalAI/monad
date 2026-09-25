// F-B1 — Scenario runner.
//
// Pure-logic driver that feeds a `Scenario` into a
// `PlaygroundHarness`, collecting step results and producing a
// `ScenarioResult`. No TUI / IO dependencies — harness
// implementations handle that; the runner only orchestrates.
//
// Design notes:
//   • Execution stops at the first failing step. Remaining steps
//     land as `skipped`. This matches the "find the first
//     regression" diagnostic goal — cascading failures are noise.
//   • Errors (uncaught exceptions inside harness calls) are
//     recorded distinctly from assertion failures: `status:
//     'error'` vs `status: 'fail'`. F-B2's UI can surface these
//     differently (red banner vs inline diff).
//   • Every step is timed — regressions that only slow things
//     down are still visible in `stepResults[i].durationMs`.

import type {
  ClickStep,
  ContextKeyStep,
  DismissStep,
  ExpectStep,
  ExpectTarget,
  KeyStep,
  PlaygroundHarness,
  Scenario,
  ScenarioResult,
  ScenarioStep,
  StepResult,
  StepStatus,
  ThemeStep,
  WaitStep,
} from './types.js';

export async function runScenario(
  scenario: Scenario,
  harness: PlaygroundHarness,
): Promise<ScenarioResult> {
  const start = now();
  const stepResults: StepResult[] = [];

  // Setup — theme, initial mounts, context-key presets. Setup
  // errors abort the scenario before any step runs; the caller
  // still gets a useful ScenarioResult with the failing setup
  // captured as the first stepResult.
  try {
    applySetup(scenario, harness);
  } catch (err) {
    stepResults.push({
      step: { action: 'wait', ms: 0 },
      status: 'error',
      message: `setup failed: ${stringifyErr(err)}`,
      durationMs: now() - start,
    });
    return {
      scenario,
      status: 'error',
      stepResults,
      durationMs: now() - start,
    };
  }

  let stoppedEarly = false;
  for (let i = 0; i < scenario.steps.length; i++) {
    const step = scenario.steps[i]!;
    if (stoppedEarly) {
      stepResults.push({
        step, status: 'skipped',
        durationMs: 0,
      });
      continue;
    }
    const result = await runStep(step, harness);
    stepResults.push(result);
    if (result.status === 'fail' || result.status === 'error') {
      stoppedEarly = true;
    }
  }

  const status = deriveScenarioStatus(stepResults);
  return {
    scenario,
    status,
    stepResults,
    durationMs: now() - start,
  };
}

// ── setup ────────────────────────────────────────────────────────

function applySetup(scenario: Scenario, harness: PlaygroundHarness): void {
  const setup = scenario.setup;
  if (!setup) return;
  if (setup.theme) harness.setTheme(setup.theme);
  if (setup.mount) {
    for (const spec of setup.mount) harness.mount(spec);
  }
  if (setup.contextKeys) {
    for (const [key, value] of Object.entries(setup.contextKeys)) {
      harness.setContextKey(key as keyof typeof setup.contextKeys, value);
    }
  }
}

// ── step dispatch ───────────────────────────────────────────────

async function runStep(step: ScenarioStep, harness: PlaygroundHarness): Promise<StepResult> {
  const start = now();
  try {
    switch (step.action) {
      case 'click':
        return wrap(step, start, () => runClick(step, harness));
      case 'key':
        return wrap(step, start, () => runKey(step, harness));
      case 'theme':
        return wrap(step, start, () => runTheme(step, harness));
      case 'set-context-key':
        return wrap(step, start, () => runContextKey(step, harness));
      case 'dismiss':
        return wrap(step, start, () => runDismiss(step, harness));
      case 'wait':
        return wrap(step, start, () => runWait(step, harness));
      case 'expect':
        return runExpect(step, harness, start);
    }
  } catch (err) {
    return {
      step, status: 'error',
      message: stringifyErr(err),
      durationMs: now() - start,
    };
  }
}

function wrap(
  step: ScenarioStep,
  start: number,
  fn: () => void | Promise<void>,
): StepResult | Promise<StepResult> {
  const ret = fn();
  if (ret && typeof (ret as Promise<void>).then === 'function') {
    return (ret as Promise<void>).then(() => ({
      step, status: 'pass' as StepStatus,
      durationMs: now() - start,
    }));
  }
  return { step, status: 'pass', durationMs: now() - start };
}

// ── individual step handlers ────────────────────────────────────

function runClick(step: ClickStep, harness: PlaygroundHarness): void {
  harness.click(step.target, step.button ?? 'left');
}

function runKey(step: KeyStep, harness: PlaygroundHarness): void {
  harness.key(step.event);
}

function runTheme(step: ThemeStep, harness: PlaygroundHarness): void {
  harness.setTheme(step.name);
}

function runContextKey(step: ContextKeyStep, harness: PlaygroundHarness): void {
  harness.setContextKey(step.key, step.value as never);
}

function runDismiss(step: DismissStep, harness: PlaygroundHarness): void {
  harness.dismiss(step.modalId);
}

async function runWait(step: WaitStep, harness: PlaygroundHarness): Promise<void> {
  await harness.waitFor(step.ms);
}

function runExpect(
  step: ExpectStep,
  harness: PlaygroundHarness,
  start: number,
): StepResult {
  const evaluation = evaluateExpect(step.target, harness);
  if (evaluation.ok) {
    return { step, status: 'pass', durationMs: now() - start };
  }
  return {
    step,
    status: 'fail',
    message: step.message ?? evaluation.message,
    actual: evaluation.actual,
    durationMs: now() - start,
  };
}

// ── expect evaluation ───────────────────────────────────────────

interface ExpectEval {
  ok: boolean;
  message: string;
  actual?: unknown;
}

function evaluateExpect(target: ExpectTarget, harness: PlaygroundHarness): ExpectEval {
  switch (target.kind) {
    case 'context-key': {
      const actual = harness.getContextKey(target.key);
      const ok = Object.is(actual, target.value);
      return {
        ok,
        message: `context-key ${String(target.key)} expected=${JSON.stringify(target.value)} actual=${JSON.stringify(actual)}`,
        actual,
      };
    }
    case 'modal-mounted': {
      const stack = harness.getModalStack();
      const ok = stack.includes(target.id);
      return {
        ok,
        message: `modal '${target.id}' not in stack`,
        actual: stack,
      };
    }
    case 'modal-dismissed': {
      const stack = harness.getModalStack();
      const ok = !stack.includes(target.id);
      return {
        ok,
        message: `modal '${target.id}' still mounted`,
        actual: stack,
      };
    }
    case 'modal-stack-length': {
      const stack = harness.getModalStack();
      const ok = stack.length === target.length;
      return {
        ok,
        message: `modal stack length expected=${target.length} actual=${stack.length}`,
        actual: stack.length,
      };
    }
    case 'last-clicked': {
      const actual = harness.getLastClickedComponentId();
      const ok = actual === target.componentId;
      return {
        ok,
        message: `last-clicked expected=${target.componentId} actual=${actual}`,
        actual,
      };
    }
    case 'render-contains': {
      const render = harness.getLastRender();
      const ok = render.includes(target.substring);
      return {
        ok,
        message: `render does not contain "${target.substring}"`,
        actual: render.length > 200 ? render.slice(0, 200) + '…' : render,
      };
    }
    case 'no-unexpected-error':
      // Placeholder — harness maintains its own error log; runner
      // only asks the harness if anything slipped past. F-B2's
      // live harness wires this to the coordinator event bus.
      return { ok: true, message: 'no-op in F-B1' };
  }
}

// ── helpers ──────────────────────────────────────────────────────

function deriveScenarioStatus(results: readonly StepResult[]): 'pass' | 'fail' | 'error' {
  if (results.some(r => r.status === 'error')) return 'error';
  if (results.some(r => r.status === 'fail')) return 'fail';
  return 'pass';
}

function stringifyErr(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try { return JSON.stringify(err); } catch { return String(err); }
}

function now(): number {
  // Bun's performance.now is ns-precision; plain Date.now() is
  // enough for ms-resolution step timings we report.
  return Date.now();
}
