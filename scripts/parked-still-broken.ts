#!/usr/bin/env bun
/** Read-only auditor: parked items are never resolved, filtered, or changed. */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const DEFAULT_LIMIT = 10;
export type Classification = 'currently-passing' | 'still-failing' | 'missing-goal-document' | 'no-target-test' | 'test-execution-unavailable';
export interface ParkedItem { readonly goalId?: string; readonly runId?: string; }
export interface AuditRow { readonly item: ParkedItem; readonly classification: Classification; readonly testPath?: string; }
export type TestResult = { status: number | null; error?: string };
export type TestRunner = (path: string) => TestResult;
export type ParkedItemsRunner = (args: readonly string[]) => TestResult & { stdout?: string; stderr?: string };

export function parseLimit(args: readonly string[]): number {
  const value = args.find(arg => arg.startsWith('--limit='))?.slice('--limit='.length);
  if (value === undefined) return DEFAULT_LIMIT;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 0) throw new Error('--limit must be a non-negative integer');
  return limit;
}

function hasGoalId(body: string, goalId: string): boolean {
  return [...body.matchAll(/^\s*-?\s*GoalId:\s*(\S+)\s*$/gmu)].some(match => match[1] === goalId);
}

export function findGoalDocument(goalsDir: string, goalId: string | undefined): string | undefined {
  if (!goalId || !existsSync(goalsDir)) return undefined;
  return readdirSync(goalsDir).find(file => file.endsWith('.md') && hasGoalId(readFileSync(join(goalsDir, file), 'utf8'), goalId));
}

export function targetTests(goalBody: string, root: string): string[] {
  const firstLine = goalBody.split(/\r?\n/, 1)[0] ?? '';
  const targets = /^대상 경로:\s*(.+)$/u.exec(firstLine)?.[1]?.split('·').map(path => path.trim()) ?? [];
  return targets.filter(path => path.endsWith('.test.ts') && existsSync(join(root, path)));
}

export function auditParked(items: readonly ParkedItem[], goalsDir: string, root: string, runTest: TestRunner, limit = DEFAULT_LIMIT): AuditRow[] {
  let executed = 0;
  return items.map(item => {
    const document = findGoalDocument(goalsDir, item.goalId);
    if (!document) return { item, classification: 'missing-goal-document' };
    const tests = targetTests(readFileSync(join(goalsDir, document), 'utf8'), root);
    if (!tests.length) return { item, classification: 'no-target-test' };
    if (executed + tests.length > limit) return { item, classification: 'test-execution-unavailable', testPath: tests[0] };
    executed += tests.length;
    const results = tests.map(path => ({ path, result: runTest(path) }));
    const unavailable = results.find(({ result }) => result.status === null || result.error);
    if (unavailable) return { item, classification: 'test-execution-unavailable', testPath: unavailable.path };
    const failing = results.find(({ result }) => result.status !== 0);
    return { item, classification: failing ? 'still-failing' : 'currently-passing', testPath: failing?.path ?? tests[0] };
  });
}

const ROOT = join(import.meta.dir, '..');
export function runTest(path: string): TestResult {
  const result = spawnSync(process.execPath, ['test', path], { cwd: ROOT, encoding: 'utf8' });
  return { status: result.status, ...(result.error ? { error: result.error.message } : {}) };
}

export function parkedItems(elanousArgs: readonly string[] = [], run: ParkedItemsRunner = args => {
  const result = spawnSync(process.execPath, [join(ROOT, 'bin/elanous.mjs'), ...args], { cwd: ROOT, encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, ...(result.error ? { error: result.error.message } : {}) };
}): ParkedItem[] {
  const result = run([...elanousArgs, 'self', 'parked', '--json']);
  if (result.status !== 0) throw new Error(result.stderr || result.error || 'elanous self parked --json unavailable');
  const parsed = JSON.parse(result.stdout ?? '');
  return Array.isArray(parsed) ? parsed : (parsed.items ?? []);
}

export function report(rows: readonly AuditRow[], write: (line: string) => void = console.log): number {
  const counts = Object.fromEntries((['currently-passing', 'still-failing', 'missing-goal-document', 'no-target-test', 'test-execution-unavailable'] as const).map(kind => [kind, rows.filter(row => row.classification === kind).length]));
  write(`parked-still-broken · 지금 통과 ${counts['currently-passing']} · 지금도 실패 ${counts['still-failing']} · 골 문서 없음 ${counts['missing-goal-document']} · 대상 시험 없음 ${counts['no-target-test']} · 시험 실행 불가 ${counts['test-execution-unavailable']}`);
  return 0;
}

export function selfCheck(write: (line: string) => void = console.log): number {
  const root = mkdtempSync(join(tmpdir(), 'parked-self-check-'));
  const goals = join(root, 'goals');
  try {
    mkdirSync(goals, { recursive: true });
    writeFileSync(join(root, 'pass.test.ts'), "import { expect, test } from 'bun:test'; test('passes', () => expect(true).toBe(true));\n");
    writeFileSync(join(root, 'fail.test.ts'), "import { expect, test } from 'bun:test'; test('fails', () => expect(true).toBe(false));\n");
    writeFileSync(join(root, 'source.ts'), '');
    writeFileSync(join(goals, 'pass.md'), '대상 경로: pass.test.ts\n- GoalId: pass\n');
    writeFileSync(join(goals, 'fail.md'), '대상 경로: fail.test.ts\n- GoalId: fail\n');
    writeFileSync(join(goals, 'none.md'), '대상 경로: source.ts\n- GoalId: none\n');
    const statuses: number[] = [];
    const rows = auditParked([{ goalId: 'pass' }, { goalId: 'fail' }, { goalId: 'missing' }, { goalId: 'none' }, { goalId: 'pass' }], goals, root, path => {
      const result = spawnSync(process.execPath, ['test', join(root, path)], { cwd: root, encoding: 'utf8' });
      if (result.status !== null) statuses.push(result.status);
      return { status: result.status, ...(result.error ? { error: result.error.message } : {}) };
    }, 2);
    const expected: Classification[] = ['currently-passing', 'still-failing', 'missing-goal-document', 'no-target-test', 'test-execution-unavailable'];
    const classificationsPass = rows.map(row => row.classification).every((value, index) => value === expected[index]);
    const executionPass = statuses.length === 2 && statuses[0] === 0 && statuses[1] !== 0;
    report(rows, write);
    write(`실제 Bun 시험 종료 코드 · 통과 ${statuses[0] ?? '없음'} · 실패 ${statuses[1] ?? '없음'}`);
    write(`${classificationsPass && executionPass ? '✅' : '⛔'} 합성 통과·실패·골 문서 없음·대상 시험 없음·실행 불가 갈래 ${classificationsPass && executionPass ? '통과' : '실패'}`);
    return classificationsPass && executionPass ? 0 : 1;
  } finally { rmSync(root, { recursive: true, force: true }); }
}

if (import.meta.main) {
  if (process.argv.includes('--self-check')) process.exit(selfCheck());
  process.exit(report(auditParked(parkedItems(), join(ROOT, 'docs/goals'), ROOT, runTest, parseLimit(process.argv.slice(2)))));
}
