// ── §5-③ Phase A: ContinuationDriver ──

import { describe, expect, test } from 'bun:test';
import {
  ContinuationDriver,
  type ContinuationDriverDeps,
} from '../../src/dispatch/continuation-driver';

/** Fake result carrying a controllable tool-result hash. */
interface FakeTurn { hash: string; }

function makeDeps(over: Partial<ContinuationDriverDeps<FakeTurn>> = {}): {
  deps: ContinuationDriverDeps<FakeTurn>;
  prompts: string[];
  andons: string[];
} {
  const prompts: string[] = [];
  const andons: string[] = [];
  const deps: ContinuationDriverDeps<FakeTurn> = {
    isActive: () => true,
    buildPrompt: () => { const p = `prompt ${prompts.length}`; prompts.push(p); return p; },
    runTurn: async (_p) => ({ hash: 'h0' }),
    isTerminated: () => false,
    hashToolResults: (r) => r.hash,
    onAndon: (reason) => { andons.push(reason); },
    ...over,
  };
  return { deps, prompts, andons };
}

describe('ContinuationDriver', () => {
  test('inactive goal → no turn fired', async () => {
    const { deps, prompts } = makeDeps({ isActive: () => false });
    const d = new ContinuationDriver(deps);
    const r = await d.step();
    expect(r.outcome).toBe('inactive');
    expect(d.turnCount).toBe(0);
    expect(prompts).toHaveLength(0);
  });

  test('active + not terminated + progress → continued, re-steppable', async () => {
    let n = 0;
    const { deps, prompts } = makeDeps({ runTurn: async () => ({ hash: `h${n++}` }) });
    const d = new ContinuationDriver(deps);
    expect((await d.step()).outcome).toBe('continued');
    expect((await d.step()).outcome).toBe('continued');
    expect(d.turnCount).toBe(2);
    expect(prompts).toHaveLength(2); // completion-audit prompt built each turn
  });

  test('termination satisfied → complete and latches halted', async () => {
    const { deps } = makeDeps({ isTerminated: () => true });
    const d = new ContinuationDriver(deps);
    const r = await d.step();
    expect(r.outcome).toBe('complete');
    expect(d.isHalted).toBe(true);
    // further steps are inert
    expect((await d.step()).outcome).toBe('inactive');
    expect(d.turnCount).toBe(1);
  });

  test('no-progress streak reaches threshold → andon + halt', async () => {
    const { deps, andons } = makeDeps({
      runTurn: async () => ({ hash: 'STUCK' }), // identical every turn
      noProgressAndonThreshold: 3,
    });
    const d = new ContinuationDriver(deps);
    // turn1 sets baseline (streak 0); turns 2,3,4 identical → streak 1,2,3
    expect((await d.step()).outcome).toBe('continued');
    expect((await d.step()).outcome).toBe('continued');
    expect((await d.step()).outcome).toBe('continued');
    const r = await d.step();
    expect(r.outcome).toBe('andon-no-progress');
    expect(d.isHalted).toBe(true);
    expect(andons).toHaveLength(1);
    expect(andons[0]).toMatch(/no progress/i);
  });

  test('progress resets the no-progress streak', async () => {
    const seq = ['a', 'a', 'b', 'a']; // change at index 2 resets streak
    let i = 0;
    const { deps, andons } = makeDeps({
      runTurn: async () => ({ hash: seq[i++] ?? 'z' }),
      noProgressAndonThreshold: 2,
    });
    const d = new ContinuationDriver(deps);
    for (let k = 0; k < seq.length; k++) {
      const r = await d.step();
      expect(r.outcome).toBe('continued'); // never reaches andon — streak resets at 'b'
    }
    expect(andons).toHaveLength(0);
  });

  test('max turns cap → max_turns and halt', async () => {
    let n = 0;
    const { deps } = makeDeps({
      runTurn: async () => ({ hash: `h${n++}` }), // always progressing
      maxTurns: 3,
    });
    const d = new ContinuationDriver(deps);
    expect((await d.step()).outcome).toBe('continued');
    expect((await d.step()).outcome).toBe('continued');
    expect((await d.step()).outcome).toBe('continued');
    const r = await d.step();
    expect(r.outcome).toBe('max_turns');
    expect(d.turnCount).toBe(3);
    expect(d.isHalted).toBe(true);
  });

  test('budget exhausted → stops with budget outcome, no turn run', async () => {
    const { deps, prompts } = makeDeps({ budgetExhausted: () => true });
    const d = new ContinuationDriver(deps);
    const r = await d.step();
    expect(r.outcome).toBe('budget');
    expect(d.isHalted).toBe(true);
    expect(d.turnCount).toBe(0);   // stopped BEFORE spending a turn
    expect(prompts).toHaveLength(0);
  });

  test('budget check runs before each turn; recordUsage accrues per turn', async () => {
    let exhausted = false;
    const usage: number[] = [];
    let n = 0;
    const { deps } = makeDeps({
      runTurn: async () => ({ hash: `h${n++}` }),
      budgetExhausted: () => exhausted,
      recordUsage: () => { usage.push(1); if (usage.length >= 2) exhausted = true; },
    });
    const d = new ContinuationDriver(deps);
    expect((await d.step()).outcome).toBe('continued'); // turn 1 → records usage (1)
    expect((await d.step()).outcome).toBe('continued'); // turn 2 → records usage (2) → exhausted
    expect((await d.step()).outcome).toBe('budget');    // budget tripped → stop
    expect(usage).toHaveLength(2);
    expect(d.turnCount).toBe(2);
  });

  test.each([
    ['complete', { isTerminated: () => true }],
    ['max_turns', { maxTurns: 0 }],
    ['budget', { budgetExhausted: () => true }],
  ] as const)('terminal %s invokes onHalt exactly once', async (_outcome, overrides) => {
    const halts: string[] = [];
    const { deps } = makeDeps({ ...overrides, onHalt: (outcome) => { halts.push(outcome); } });
    const d = new ContinuationDriver(deps);
    await d.step();
    await d.step();
    expect(halts).toEqual([_outcome]);
  });

  test('andon invokes onHalt exactly once; inactive and continued do not', async () => {
    const halts: string[] = [];
    const { deps } = makeDeps({
      runTurn: async () => ({ hash: 'stuck' }),
      noProgressAndonThreshold: 1,
      onHalt: (outcome) => { halts.push(outcome); },
    });
    const d = new ContinuationDriver(deps);
    expect((await d.step()).outcome).toBe('continued');
    expect(halts).toEqual([]);
    expect((await d.step()).outcome).toBe('andon-no-progress');
    expect((await d.step()).outcome).toBe('inactive');
    expect(halts).toEqual(['andon-no-progress']);
  });

  test('onStep observability fires every step', async () => {
    const steps: string[] = [];
    let n = 0;
    const { deps } = makeDeps({
      runTurn: async () => ({ hash: `h${n++}` }),
      onStep: (info) => { steps.push(info.outcome); },
    });
    const d = new ContinuationDriver(deps);
    await d.step();
    await d.step();
    expect(steps).toEqual(['continued', 'continued']);
  });
});
