import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { mapStageToRunStatus, type MappedRunOutcome, type SelfImplementStage } from './run-status-mapping.js';
import { makeRunObserver, observeRunOutcome } from './orchestrator.js';

const selfImplementDir = dirname(fileURLToPath(import.meta.url));

const cases: readonly [SelfImplementStage, MappedRunOutcome][] = [
  ['merged', { runStatus: 'completed' }],
  ['pr-opened', { runStatus: 'completed' }],
  ['gate-failed', { runStatus: 'failed', failureKind: 'gate' }],
  ['review-blocked', { runStatus: 'failed', failureKind: 'review' }],
  ['merge-conflict', { runStatus: 'failed', failureKind: 'merge-conflict' }],
  ['aborted', { runStatus: 'failed', failureKind: 'aborted' }],
  ['timed-out', { runStatus: 'failed', failureKind: 'timed-out' }],
  ['pr-declined', { runStatus: 'cancelled' }],
];

function makeRunObserverCallsWithoutLedgerWriter(path: string, source: string): number {
  const parsed = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  let unwired = 0;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'makeRunObserver' && node.arguments.length < 4) {
      unwired++;
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return unwired;
}

// ⛔⭐ 스캔 범위는 «고정 목록이 아니라 저장소 전수»다 (리뷰 should-fix · 2026-08-06).
//   원판은 이 두 파일만 봤는데 `makeRunObserver` 호출은 다른 테스트 파일에도 있다
//   (test/selfdev-observation-runid.test.ts · test/self-implement-orchestrator.test.ts ·
//    src/self-implement/run-ledger-cli.test.ts — 현재는 셋 다 인자를 «준다»).
//   ⇒ 고정 목록이면 «그 셋에 새 누락이 생겨도» 가드가 못 잡는다. 재발 방지 취지에 안 맞는다.
//   ⭐ 비용은 낮게 둔다 — 먼저 문자열로 «후보»를 좁히고, 그 파일만 AST 로 판정한다.
const repoRoot = join(selfImplementDir, '..', '..');

function testFilesMentioningMakeRunObserver(): string[] {
  const out = execFileSync(
    'rg',
    ['--files-with-matches', '--glob', '**/*.test.ts', '--no-ignore', 'makeRunObserver', '.'],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  return out.split('\n').map(line => line.trim()).filter(Boolean).map(rel => join(repoRoot, rel));
}

describe('makeRunObserver test ledger-writer ratchet', () => {
  test('every test call in the repository injects an in-memory ledger writer', () => {
    const files = testFilesMentioningMakeRunObserver();
    // ⛔ 후보가 0이면 「위반 0」이 아니라 «자가 안 돈 것»이다 — 부재와 미지를 가른다.
    expect(files.length).toBeGreaterThan(0);
    const unwired = files.reduce(
      (count, path) => count + makeRunObserverCallsWithoutLedgerWriter(path, readFileSync(path, 'utf8')),
      0,
    );
    expect(unwired).toBe(0);
  });
});

describe('mapStageToRunStatus', () => {
  test.each(cases)('%s maps to the RFC run outcome', (stage, expected) => {
    expect(mapStageToRunStatus(stage)).toEqual(expected);
  });

  test('does not leave failureKind on completed or cancelled outcomes', () => {
    expect(mapStageToRunStatus('merged')).not.toHaveProperty('failureKind');
    expect(mapStageToRunStatus('pr-opened')).not.toHaveProperty('failureKind');
    expect(mapStageToRunStatus('pr-declined')).not.toHaveProperty('failureKind');
  });

  test('keeps distinct failure kinds for the same failed run status', () => {
    expect(mapStageToRunStatus('gate-failed')).toEqual({ runStatus: 'failed', failureKind: 'gate' });
    expect(mapStageToRunStatus('review-blocked')).toEqual({ runStatus: 'failed', failureKind: 'review' });
    expect(mapStageToRunStatus('timed-out')).toEqual({ runStatus: 'failed', failureKind: 'timed-out' });
  });

  test('returns null for an unknown stage without throwing', () => {
    expect(mapStageToRunStatus('future-stage')).toBeNull();
  });

  test('isolates each mapped outcome from caller mutation', () => {
    const first = mapStageToRunStatus('gate-failed');
    if (!first) throw new Error('expected known stage to map');

    first.runStatus = 'cancelled';
    first.failureKind = 'aborted';

    expect(mapStageToRunStatus('gate-failed')).toEqual({ runStatus: 'failed', failureKind: 'gate' });
  });

  test('adds an authored goal ID to each observation without changing run ID', () => {
    const calls: Array<{ event: string; data: Record<string, unknown> }> = [];
    const ledgerEntries: Array<{ event: string }> = [];
    const observe = makeRunObserver('run-one', '4a92772c23611b64', (_category, event, data) => {
      calls.push({ event, data: data as Record<string, unknown> });
    }, (entry) => ledgerEntries.push(entry));

    observe('start', { feature: 'goal' });
    observe('done', { feature: 'goal' });

    expect(calls).toEqual([
      { event: 'start', data: { feature: 'goal', runId: 'run-one', goalId: '4a92772c23611b64' } },
      { event: 'done', data: { feature: 'goal', runId: 'run-one', goalId: '4a92772c23611b64' } },
    ]);
    expect(ledgerEntries).toEqual([
      expect.objectContaining({ event: 'start', runId: 'run-one', goalId: '4a92772c23611b64', data: { feature: 'goal', runId: 'run-one', goalId: '4a92772c23611b64' } }),
      expect.objectContaining({ event: 'done', runId: 'run-one', goalId: '4a92772c23611b64', data: { feature: 'goal', runId: 'run-one', goalId: '4a92772c23611b64' } }),
    ]);
  });

  test('omits goal ID when the launch has no authored goal document', () => {
    const calls: Array<{ event: string; data: Record<string, unknown> }> = [];
    const ledgerEntries: Array<{ event: string }> = [];
    const observe = makeRunObserver('run-text', undefined, (_category, event, data) => {
      calls.push({ event, data: data as Record<string, unknown> });
    }, (entry) => ledgerEntries.push(entry));

    observe('start', { feature: 'text launch' });

    expect(calls).toEqual([
      { event: 'start', data: { feature: 'text launch', runId: 'run-text' } },
    ]);
    expect(ledgerEntries).toEqual([
      expect.objectContaining({ event: 'start', runId: 'run-text', data: { feature: 'text launch', runId: 'run-text' } }),
    ]);
  });

  test('carries a merge reason on the terminal run-status only when present', () => {
    const calls: Array<{ event: string; data: Record<string, unknown> }> = [];
    const ledgerEntries: Array<{ event: string }> = [];
    const observe = makeRunObserver('merge-reason-test', (_category, event, data) => {
      calls.push({ event, data: data as Record<string, unknown> });
    }, undefined, (entry) => ledgerEntries.push(entry));

    observeRunOutcome(observe, { stage: 'pr-opened', node: 'open-pr', outcome: undefined, worktreePath: undefined, review: undefined, completionDisposition: undefined, supervisorVerdict: undefined, mergeApprovalReceived: undefined, abandonedClassification: undefined, mergeReason: 'no-auto-flag' });
    observeRunOutcome(observe, { stage: 'pr-opened', node: 'open-pr', outcome: undefined, worktreePath: undefined, review: undefined, completionDisposition: undefined, supervisorVerdict: undefined, mergeApprovalReceived: undefined, abandonedClassification: undefined, mergeReason: undefined });

    const statuses = calls.filter((call) => call.event === 'run-status');
    expect(statuses[0]?.data).toMatchObject({ mergeReason: 'no-auto-flag' });
    expect(statuses[1]?.data).not.toHaveProperty('mergeReason');
    expect(ledgerEntries.filter((entry) => entry.event === 'run-status')).toEqual([
      expect.objectContaining({ runId: 'merge-reason-test', data: expect.objectContaining({ mergeReason: 'no-auto-flag' }) }),
      expect.objectContaining({ runId: 'merge-reason-test', data: expect.not.objectContaining({ mergeReason: expect.anything() }) }),
    ]);
  });

  test('observes the legacy stage with its structured run outcome', () => {
    const calls: Array<{ event: string; data: unknown; level?: string }> = [];
    const ledgerEntries: Array<{ event: string }> = [];
    const observe = makeRunObserver('run-status-test', (_category, event, data, opt) => {
      calls.push({ event, data, level: opt?.level });
    }, undefined, (entry) => ledgerEntries.push(entry));

    observeRunOutcome(observe, { stage: 'merge-conflict', node: 'main-sync', outcome: undefined, worktreePath: undefined, review: undefined, completionDisposition: undefined, supervisorVerdict: undefined, mergeApprovalReceived: undefined, abandonedClassification: undefined, mergeReason: undefined });

    expect(calls).toEqual([
      {
        event: 'pipeline-shape-shadow',
        data: {
          stage: 'merge-conflict',
          node: 'main-sync',
          nodes: ['main-sync'],
          ambiguous: false,
          declared: true,
          runId: 'run-status-test',
        },
        level: undefined,
      },
      {
        event: 'run-status',
        data: {
          stage: 'merge-conflict',
          node: 'main-sync',
          runStatus: 'failed',
          failureKind: 'merge-conflict',
          runId: 'run-status-test',
        },
        level: 'warn',
      },
    ]);
    expect(ledgerEntries).toContainEqual(expect.objectContaining({
      event: 'run-status',
      runId: 'run-status-test',
      data: expect.objectContaining({ runStatus: 'failed', failureKind: 'merge-conflict' }),
    }));
  });
});
