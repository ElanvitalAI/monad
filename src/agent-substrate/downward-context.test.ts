// 공용 하향 컨텍스트(C6 승격) — 제네릭 조립기(구조적 입력) 검증.
import { test, expect, describe } from 'bun:test';
import { formatDownwardContext } from './downward-context.js';
import type { ProgressLedger } from './progress-ledger.js';

const ledger = (o: Partial<ProgressLedger> = {}): ProgressLedger => ({
  satisfied: false, progressBeingMade: true, inLoop: false, stalled: false, stallCount: 0,
  recommendation: 'continue', rationale: '진행 중', ...o,
});

describe('downward-context — formatDownwardContext(순수)', () => {
  test('정보 없으면 blockText 무주입', () => {
    const r = formatDownwardContext({ phases: [], failures: [], currentPhaseId: 'x' });
    expect(r.blockText).toBe('');
    expect(r.totalPhases).toBe(0);
  });
  test('진행률·내 위치·권장·실패 요약', () => {
    const r = formatDownwardContext({
      phases: [{ id: 'p1', status: 'done' }, { id: 'p2', status: 'running' }, { id: 'p3', status: 'pending' }],
      failures: [{ title: 'F1' }],
      progress: ledger({ recommendation: 'replan', rationale: 'stall' }),
      currentPhaseId: 'p2',
    });
    expect(r.donePhases).toBe(1);
    expect(r.totalPhases).toBe(3);
    expect(r.failureCount).toBe(1);
    expect(r.recommendation).toBe('replan');
    expect(r.blockText).toContain('1/3 페이즈 done');
    expect(r.blockText).toContain('이 페이즈=2번째');
    expect(r.blockText).toContain('권장: replan');
    expect(r.blockText).toContain('실패 페이즈(1)');
  });
  test('progress만 있고 phases 없으면 상태줄만', () => {
    const r = formatDownwardContext({ phases: [], failures: [], progress: ledger(), currentPhaseId: 'x' });
    expect(r.blockText).toContain('전진 중');
    expect(r.blockText).not.toContain('페이즈 done');
  });
});
