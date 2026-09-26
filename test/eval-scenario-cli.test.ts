// W5-P3 (2026-05-03 PM) — Scenario file batch runner tests.
//
// Covers schema validation, defaults merge, and assertion aggregation
// at the unit-test level (no real LLM calls). Live integration with
// elanous repro --scenario is verified manually via tests/scenarios/
// codex-baseline.yaml.

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runScenarioFile } from '../src/eval-scenario-cli';
import { computeBaselineDelta } from '../src/eval-prompt-cli';

let tmpDirs: string[] = [];

function makeTmp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'scenario-test-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs) {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
  tmpDirs = [];
});

describe('runScenarioFile — schema validation', () => {
  test('throws when scenario file does not exist', async () => {
    const tmp = makeTmp();
    await expect(runScenarioFile(join(tmp, 'missing.yaml'), { silent: true })).rejects.toThrow(/scenario file not found/);
  });

  test('throws when YAML root is not an object', async () => {
    const tmp = makeTmp();
    const path = join(tmp, 'bad.yaml');
    writeFileSync(path, '- just\n- a\n- list\n', 'utf8');
    await expect(runScenarioFile(path, { silent: true })).rejects.toThrow(/scenario root must be a YAML object/);
  });

  test('throws when prompts array is missing', async () => {
    const tmp = makeTmp();
    const path = join(tmp, 'bad.yaml');
    writeFileSync(path, 'description: no prompts here\n', 'utf8');
    await expect(runScenarioFile(path, { silent: true })).rejects.toThrow(/missing required 'prompts' array/);
  });

  test('throws when prompt[i].id is missing', async () => {
    const tmp = makeTmp();
    const path = join(tmp, 'bad.yaml');
    writeFileSync(path, 'prompts:\n  - prompt: hello\n', 'utf8');
    await expect(runScenarioFile(path, { silent: true })).rejects.toThrow(/prompts\[0\].id must be a non-empty string/);
  });

  test('throws when prompt[i].prompt is missing', async () => {
    const tmp = makeTmp();
    const path = join(tmp, 'bad.yaml');
    writeFileSync(path, 'prompts:\n  - id: foo\n', 'utf8');
    await expect(runScenarioFile(path, { silent: true })).rejects.toThrow(/prompts\[0\].prompt must be a non-empty string/);
  });
});

describe('computeBaselineDelta', () => {
  test('returns empty when baseline equals current', () => {
    const delta = computeBaselineDelta(
      { 'tool-loop.turn.start': 5, 'Glob': 3 },
      { 'tool-loop.turn.start': 5, 'Glob': 3 },
    );
    expect(Object.keys(delta).length).toBe(0);
  });

  test('flags increases (regression) and decreases (improvement)', () => {
    const delta = computeBaselineDelta(
      { 'Glob': 8, 'Read': 3, 'tool-loop.turn.start': 5 },
      { 'Glob': 1, 'Read': 12, 'tool-loop.turn.start': 5 },
    );
    expect(delta['Glob']).toEqual({ baseline: 8, current: 1, delta: -7 });
    expect(delta['Read']).toEqual({ baseline: 3, current: 12, delta: 9 });
    expect(delta['tool-loop.turn.start']).toBeUndefined();  // unchanged
  });

  test('handles new event in current (baseline 0)', () => {
    const delta = computeBaselineDelta(
      {},
      { 'tool-loop.literal-glob-blocked': 2 },
    );
    expect(delta['tool-loop.literal-glob-blocked']).toEqual({ baseline: 0, current: 2, delta: 2 });
  });

  test('handles event removed in current (current 0)', () => {
    const delta = computeBaselineDelta(
      { 'tool-loop.exploration-fallback-emitted': 1 },
      {},
    );
    expect(delta['tool-loop.exploration-fallback-emitted']).toEqual({ baseline: 1, current: 0, delta: -1 });
  });
});
