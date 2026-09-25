// F-B5a — Reactive YAML editor core.
//
// Listens to text changes, debounces, reparses with
// `parseScenarioYaml`, and fires `onScenarioChange` only when the
// scenario or error list actually moved. The UI layer (F-B5b) wires
// a TextArea widget + error panel on top of this controller; the
// controller itself is strictly pure (no terminal I/O, no widgets).
//
// Debounce + diff strategy:
//   • 250ms default — handoff §3.6 recommends starting here and
//     tuning with user feedback.
//   • Shallow-equality check on the parsed scenario + error list
//     before notifying. Prevents remount thrash when whitespace-only
//     edits don't change the semantic scenario.
//   • Immediate-sync escape hatch (`flush()`) for deterministic
//     tests and "save" actions that shouldn't wait for the timer.

import { parseScenarioYaml, type ScenarioParseResult } from './yaml-parser.js';

export interface ReactiveEditorTimer {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

export interface ReactiveEditorOptions {
  /** Debounce window in ms. Default 250. */
  debounceMs?: number;
  /** Injected timer. Tests pass a virtual timer. */
  timer?: ReactiveEditorTimer;
  /** Fired after each debounced parse that produced a different
   *  result than the previous. `prev` is null on the first call. */
  onScenarioChange: (result: ScenarioParseResult, prev: ScenarioParseResult | null) => void;
  /** Initial source (optional). If set, triggers an immediate parse
   *  + `onScenarioChange` with no debounce. */
  initialSource?: string;
}

export class ReactiveScenarioEditor {
  private source: string;
  private lastResult: ScenarioParseResult | null = null;
  private readonly debounceMs: number;
  private readonly timer: ReactiveEditorTimer;
  private readonly onChange: ReactiveEditorOptions['onScenarioChange'];
  private pendingHandle: unknown = null;
  private disposed = false;

  constructor(opts: ReactiveEditorOptions) {
    this.debounceMs = opts.debounceMs ?? 250;
    this.timer = opts.timer ?? defaultTimer();
    this.onChange = opts.onScenarioChange;
    this.source = opts.initialSource ?? '';
    if (opts.initialSource !== undefined) {
      this.parseAndNotify();
    }
  }

  getSource(): string {
    return this.source;
  }

  getLastResult(): ScenarioParseResult | null {
    return this.lastResult;
  }

  /** Replace the current source. Triggers a debounced reparse. */
  setSource(next: string): void {
    if (this.disposed) return;
    if (next === this.source) return;
    this.source = next;
    this.scheduleParse();
  }

  /** Cancel any pending debounce + reparse now. Returns the fresh
   *  result. */
  flush(): ScenarioParseResult {
    if (this.pendingHandle !== null) {
      this.timer.clearTimeout(this.pendingHandle);
      this.pendingHandle = null;
    }
    return this.parseAndNotify();
  }

  dispose(): void {
    this.disposed = true;
    if (this.pendingHandle !== null) {
      this.timer.clearTimeout(this.pendingHandle);
      this.pendingHandle = null;
    }
  }

  private scheduleParse(): void {
    if (this.pendingHandle !== null) {
      this.timer.clearTimeout(this.pendingHandle);
    }
    this.pendingHandle = this.timer.setTimeout(() => {
      this.pendingHandle = null;
      if (this.disposed) return;
      this.parseAndNotify();
    }, this.debounceMs);
  }

  private parseAndNotify(): ScenarioParseResult {
    const result = parseScenarioYaml(this.source);
    const prev = this.lastResult;
    if (prev !== null && resultsEqual(prev, result)) {
      return result;
    }
    this.lastResult = result;
    try { this.onChange(result, prev); } catch { /* listener isolate */ }
    return result;
  }
}

// ── Diff helpers ────────────────────────────────────────────────

function resultsEqual(a: ScenarioParseResult, b: ScenarioParseResult): boolean {
  if (a.errors.length !== b.errors.length) return false;
  if (a.warnings.length !== b.warnings.length) return false;
  if (a.validSteps.length !== b.validSteps.length) return false;
  // Scenario deep equality via JSON. Scenarios are plain-data so
  // stringify is stable given the ordering rules our parser uses.
  if (stableStr(a.scenario) !== stableStr(b.scenario)) return false;
  if (stableStr(a.errors) !== stableStr(b.errors)) return false;
  if (stableStr(a.warnings) !== stableStr(b.warnings)) return false;
  if (stableStr(a.validSteps) !== stableStr(b.validSteps)) return false;
  return true;
}

function stableStr(v: unknown): string {
  try { return JSON.stringify(v); } catch { return ''; }
}

function defaultTimer(): ReactiveEditorTimer {
  return {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  };
}
