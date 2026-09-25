import { describe, expect, test } from 'bun:test';
import type { InterferenceReport, TestRunner } from './detect-test-interference.js';
import {
  MAX_INSPECTED_TEST_FILES,
  parseChangedFiles,
  runTestInterferenceGate,
  selectedTestFiles,
} from './ci-test-interference-gate.js';

const report = (status: InterferenceReport['status'], difference: number | null = null, isolated: InterferenceReport['isolated'] = []): InterferenceReport => ({
  order: [],
  isolated,
  combined: { files: [], fail: null, status: 'unmeasurable' },
  status,
  isolatedFailures: status === 'unmeasurable' ? null : isolated.reduce((total, run) => total + (run.fail ?? 0), 0),
  combinedFailures: status === 'unmeasurable' ? null : difference,
  difference,
});

const forbiddenRunner: TestRunner = async () => {
  throw new Error('real bun test runner must not be called');
};

describe('ci test interference gate', () => {
  test('parses whitespace and comma-separated changed files until another flag', () => {
    expect(parseChangedFiles(['--changed-files', 'a.test.ts,b.ts c.test.ts', '--update', 'ignored.test.ts']))
      .toEqual(['a.test.ts', 'b.ts', 'c.test.ts']);
    expect(selectedTestFiles(['a.test.ts', 'b.ts', 'c.test.tsx'])).toEqual(['a.test.ts', 'c.test.tsx']);
    expect(parseChangedFiles([])).toBeNull();
  });

  test('reports not applicable distinctly for zero or one changed test file without calling a runner', async () => {
    for (const args of [
      ['--changed-files', 'src/app.ts'],
      ['--changed-files', 'scripts/one.test.ts'],
    ]) {
      const lines: string[] = [];
      let calls = 0;
      expect(await runTestInterferenceGate({
        args,
        log: (line) => lines.push(line),
        runner: forbiddenRunner,
        detect: async () => { calls++; return report('no-interference'); },
      })).toBe(0);
      expect(calls).toBe(0);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('해당 없음');
      expect(lines[0]).not.toContain('간섭 없음');
    }
  });

  test('warns about interference and its numeric difference without blocking', async () => {
    const lines: string[] = [];
    let received: string[] = [];
    expect(await runTestInterferenceGate({
      args: ['--changed-files', 'one.test.ts two.test.ts,three.test.ts'],
      log: (line) => lines.push(line),
      runner: forbiddenRunner,
      detect: async (files) => { received = [...files]; return report('interference', 5); },
    })).toBe(0);
    expect(received).toEqual(['one.test.ts', 'two.test.ts', 'three.test.ts']);
    expect(lines).toEqual([expect.stringContaining('간섭 감지 — 차이 5')]);
  });

  test('reports isolated failing files while suppressing passing files in gate output', async () => {
    const lines: string[] = [];
    await runTestInterferenceGate({
      args: ['--changed-files', 'A.test.ts', 'B.test.ts', 'C.test.ts'],
      log: (line) => lines.push(line),
      runner: forbiddenRunner,
      detect: async () => report('no-interference', 0, [
        { files: ['A.test.ts'], fail: 0, status: 'measured' },
        { files: ['B.test.ts'], fail: 3, status: 'measured' },
        { files: ['C.test.ts'], fail: 0, status: 'measured' },
      ]),
    });
    expect(lines[0]).toContain('격리 실패 3');
    expect(lines[0]).toContain('B.test.ts (3 fail)');
    expect(lines[0]).not.toContain('A.test.ts (0 fail)');
    expect(lines[0]).not.toContain('C.test.ts (0 fail)');
  });

  test('reports the shared isolated failure summary remainder in gate output', async () => {
    const lines: string[] = [];
    const isolated = Array.from({ length: MAX_INSPECTED_TEST_FILES + 1 }, (_, index) => ({ files: [`F${index}.test.ts`], fail: 1, status: 'measured' as const }));
    await runTestInterferenceGate({
      args: ['--changed-files', 'one.test.ts', 'two.test.ts'],
      log: (line) => lines.push(line),
      runner: forbiddenRunner,
      detect: async () => report('no-interference', 0, isolated),
    });
    expect(lines[0]).toContain('F7.test.ts (1 fail)');
    expect(lines[0]).not.toContain('F8.test.ts (1 fail)');
    expect(lines[0]).toContain('; 1 more');
  });

  test('discloses the finite inspection cap and omitted test count', async () => {
    const files = Array.from({ length: MAX_INSPECTED_TEST_FILES + 3 }, (_, index) => `test-${index}.test.ts`);
    const lines: string[] = [];
    let received: string[] = [];
    await runTestInterferenceGate({
      args: ['--changed-files', ...files],
      log: (line) => lines.push(line),
      runner: forbiddenRunner,
      detect: async (selected) => { received = [...selected]; return report('no-interference', 0); },
    });
    expect(received).toEqual(files.slice(0, MAX_INSPECTED_TEST_FILES));
    expect(lines[0]).toContain('3개 미검사');
  });

  test('reports a rejected detector as unmeasurable without blocking', async () => {
    const lines: string[] = [];
    expect(await runTestInterferenceGate({
      args: ['--changed-files', 'one.test.ts', 'two.test.ts'],
      log: (line) => lines.push(line),
      runner: forbiddenRunner,
      detect: async () => { throw new Error('detector unavailable'); },
    })).toBe(0);
    expect(lines).toEqual([expect.stringContaining('측정 불가')]);
    expect(lines[0]).toContain('간섭 없음으로 처리하지 않음');
  });

  test('distinguishes unmeasurable from no interference while keeping both non-blocking', async () => {
    const args = ['--changed-files', 'one.test.ts', 'two.test.ts'];
    const unmeasurable: string[] = [];
    const noInterference: string[] = [];
    expect(await runTestInterferenceGate({ args, log: (line) => unmeasurable.push(line), runner: forbiddenRunner, detect: async () => report('unmeasurable') })).toBe(0);
    expect(await runTestInterferenceGate({ args, log: (line) => noInterference.push(line), runner: forbiddenRunner, detect: async () => report('no-interference', 0) })).toBe(0);
    expect(unmeasurable).toEqual(['[test-interference-gate] 경고: 측정 불가 — 간섭 없음으로 처리하지 않음.']);
    expect(noInterference[0]).toContain('간섭 없음');
    expect(noInterference[0]).not.toContain('측정 불가');
  });
});
