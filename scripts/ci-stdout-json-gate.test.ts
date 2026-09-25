import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { countDirectJsonConsoleLogs, runStdoutJsonGate, scan } from './ci-stdout-json-gate.js';

describe('ci-stdout-json-gate', () => {
  // ⛔⭐ 정의역 시험 — 이 자는 저장소 «뿌리»부터 걷는다. `.claude/worktrees/` 에는 «남의 작업 트리»가 산다.
  //   📏 2026-09-22: 가짜 워크트리에 위반 하나를 심으니 고발했다(scanned 65 → 66) ⇒ 남의 부채로 착지가 막힌다.
  test('walks the repository root but never descends into .claude (other agents\' worktrees live there)', () => {
    const root = mkdtempSync(join(tmpdir(), 'stdout-json-gate-domain-'));
    try {
      mkdirSync(join(root, 'src'), { recursive: true });
      mkdirSync(join(root, '.claude', 'worktrees', 'someone-else', 'src'), { recursive: true });
      const violation = 'console.log(JSON.stringify({ ok: true }));\n';
      writeFileSync(join(root, 'src', 'mine.ts'), violation);
      writeFileSync(join(root, '.claude', 'worktrees', 'someone-else', 'src', 'theirs.ts'), violation);

      const counted = scan(root);
      expect([...counted.keys()]).toEqual(['src/mine.ts']);
      expect([...counted.keys()].some(path => path.includes('.claude'))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('counts only direct console.log(JSON.stringify(...)) calls', () => {
    expect(countDirectJsonConsoleLogs([
      'console.log(JSON.stringify({ ok: true }));',
      'console.error(JSON.stringify({ ignored: true }));',
      'process.stdout.write(JSON.stringify({ allowed: true }));',
      'console.log(format(JSON.stringify({ ignored: true })));',
    ].join('\n'))).toBe(1);
  });

  test('allows file-local baseline debt, blocks new files and increases, and names the shared shim', () => {
    const baseline = new Map([['src/debt.ts', 1]]);
    expect(runStdoutJsonGate({ args: [], scan: () => new Map([['src/debt.ts', 1]]), loadBaseline: () => baseline })).toBe(0);

    for (const current of [
      new Map([['src/new.ts', 1]]),
      new Map([['src/debt.ts', 2]]),
    ]) {
      const errors: string[] = [];
      expect(runStdoutJsonGate({ args: [], scan: () => current, loadBaseline: () => baseline, error: message => errors.push(message) })).toBe(1);
      expect(errors.join('\n')).toContain('writeStdoutJson from src/cli/stdout-json.ts');
    }
  });

  test('advises ratcheting down and lets --update snapshot the observed file-local debt', () => {
    const logs: string[] = [];
    expect(runStdoutJsonGate({ args: [], scan: () => new Map(), loadBaseline: () => new Map([['src/debt.ts', 1]]), log: message => logs.push(message) })).toBe(0);
    expect(logs.join('\n')).toContain('--update');

    const current = new Map([['src/debt.ts', 2], ['src/other.ts', 1]]);
    const writes: Map<string, number>[] = [];
    expect(runStdoutJsonGate({ args: ['--update'], scan: () => current, writeBaseline: entries => writes.push(entries) })).toBe(0);
    expect(writes).toEqual([current]);
  });

  test('fails closed for a missing baseline', () => {
    const errors: string[] = [];
    expect(runStdoutJsonGate({ args: [], scan: () => new Map(), loadBaseline: () => new Map(), error: message => errors.push(message) })).toBe(1);
    expect(errors.join('\n')).toContain('baseline이 없거나 비어 있습니다');
  });
});
