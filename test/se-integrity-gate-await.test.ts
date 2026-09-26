import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GateResult } from '../src/autopilot/build/integrity-gate.js';
import { summarizeGate } from '../scripts/se-backend-bench.js';
import { summarizeTuneGate } from '../scripts/se-elanous-self-tune.js';

const passingGate: GateResult = {
  passed: true,
  steps: [{ name: 'test', ok: true, skipped: false, summary: 'pass' }],
  log: '',
};
const failingGate: GateResult = {
  passed: false,
  steps: [{ name: 'test', ok: false, skipped: false, summary: 'expected failure summary' }],
  log: '',
};

describe('SE benchmark and tune integrity-gate consumption', () => {
  it.each([
    ['se-backend-bench.ts', "const gate = await runIntegrityGate(plan.worktreePath, { steps: ['test'], testArgs: ['src/task-orchestrator/'] });"],
    ['se-elanous-self-tune.ts', "const gate = await runIntegrityGate(plan.worktreePath, { steps: ['test'], testArgs: gateArgs });"],
  ])('%s awaits the gate before consuming its result', (file, awaitedCall) => {
    expect(readFileSync(join(import.meta.dir, '..', 'scripts', file), 'utf8')).toContain(awaitedCall);
  });

  it.each(['se-backend-bench.ts', 'se-elanous-self-tune.ts'])('%s keeps main private and retains its local CLI entry point', (file) => {
    const source = readFileSync(join(import.meta.dir, '..', 'scripts', file), 'utf8');
    expect(source).toContain('async function main(): Promise<void>');
    expect(source).not.toContain('export async function main');
    expect(source).toContain('if (import.meta.main) await main();');
  });

  it('backend bench reports distinct pass and failure summaries without throwing', () => {
    expect(summarizeGate(passingGate)).toEqual({ gatePass: true, note: '게이트 PASS' });
    expect(summarizeGate(failingGate)).toEqual({ gatePass: false, note: '게이트 FAIL: expected failure summary' });
  });

  it('elanous tune reports distinct pass and failure results without throwing', () => {
    expect(summarizeTuneGate(passingGate, 1)).toEqual({ gatePass: true, realImpl: true, note: 'PASS+impl' });
    expect(summarizeTuneGate(failingGate, 1)).toEqual({ gatePass: false, realImpl: false, note: 'FAIL: expected failure summary' });
  });

  it('elanous tune preserves the zero-change false-positive distinction', () => {
    expect(summarizeTuneGate(passingGate, 0)).toEqual({ gatePass: true, realImpl: false, note: 'PASS(변경0=FP)' });
  });
});
