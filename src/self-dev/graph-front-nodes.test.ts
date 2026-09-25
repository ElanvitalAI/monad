import { beforeEach, describe, expect, test } from 'bun:test';
import { debug } from '../debug/log.js';
import { FRONT_VISIT_IDLE_TTL_MS, frontVisitRunCountForTesting, observeFrontNodeEntry, resetFrontVisitCountsForTesting } from './graph-front-nodes.js';

function observedFrontEntries(run: () => void): Array<{
  readonly category: string;
  readonly event: string;
  readonly data: Record<string, unknown>;
}> {
  const entries: Array<{ category: string; event: string; data: Record<string, unknown> }> = [];
  const originalLog = debug.log;
  debug.log = ((category: string, event: string, data?: Record<string, unknown>) => {
    if (category === 'self-implement' && event === 'pipeline-node-entry') {
      entries.push({ category, event, data: data ?? {} });
    }
  }) as typeof debug.log;
  try {
    run();
    return entries;
  } finally {
    debug.log = originalLog;
  }
}

function observedFrontEvents(run: () => void): Array<{
  readonly event: string;
  readonly data: Record<string, unknown>;
}> {
  const events: Array<{ event: string; data: Record<string, unknown> }> = [];
  const originalLog = debug.log;
  debug.log = ((category: string, event: string, data?: Record<string, unknown>) => {
    if (category === 'self-implement' && (event === 'pipeline-node-entry' || event === 'graph-visit-budget')) {
      events.push({ event, data: data ?? {} });
    }
  }) as typeof debug.log;
  try {
    run();
    return events;
  } finally {
    debug.log = originalLog;
  }
}

describe('observeFrontNodeEntry', () => {
  // 모듈 수준 계수는 시험 사이에 남는다 — 매 시험 비운다(runId 가 겹쳐도 간섭하지 않게).
  beforeEach(() => resetFrontVisitCountsForTesting());

  test('keeps the shared event and preserved payload fields while recording required provenance', () => {
    const entries = observedFrontEntries(() => {
      observeFrontNodeEntry('author', {
        provenance: 'authoring-start', runId: 'run-declared', goalType: 'implement', round: 3,
      });
      observeFrontNodeEntry('not-declared' as never, {
        provenance: 'authoring-plan', runId: 'run-undeclared', goalType: 'implement',
      });
    });

    expect(entries).toHaveLength(2);
    expect(entries.map(({ event }) => event)).toEqual(['pipeline-node-entry', 'pipeline-node-entry']);
    expect(entries[0].data).toMatchObject({
      graphId: 'self-implement',
      node: 'author',
      nodeDeclarationStatus: 'declared',
      runId: 'run-declared',
      round: 3,
      phase: 'front',
      graphTemplatesSource: expect.any(String),
      provenance: 'authoring-start',
    });
    expect(entries[1].data).toMatchObject({
      graphId: 'self-implement',
      node: 'not-declared',
      nodeDeclarationStatus: 'undeclared',
      runId: 'run-undeclared',
      phase: 'front',
      graphTemplatesSource: expect.any(String),
      provenance: 'authoring-plan',
    });
  });

  test('records mutually distinct provenance for the three decompose entry causes', () => {
    const entries = observedFrontEntries(() => {
      observeFrontNodeEntry('decompose', { provenance: 'authoring-decomposition-start', runId: 'run-author' });
      observeFrontNodeEntry('decompose', { provenance: 'supervisor-promotion-attempt', runId: 'run-supervisor' });
      observeFrontNodeEntry('decompose', { provenance: 'supervisor-pre-promotion-decision', runId: 'run-supervisor' });
    });

    expect(entries.map(({ event }) => event)).toEqual([
      'pipeline-node-entry',
      'pipeline-node-entry',
      'pipeline-node-entry',
    ]);
    expect(entries.map(({ data }) => data.provenance)).toEqual([
      'authoring-decomposition-start',
      'supervisor-promotion-attempt',
      'supervisor-pre-promotion-decision',
    ]);
    expect(entries.slice(1).map(({ data }) => data.runId)).toEqual(['run-supervisor', 'run-supervisor']);
    expect(new Set(entries.map(({ data }) => data.provenance)).size).toBe(3);
  });

  test('implement 이외와 미확정 골은 default-loop 정체성을 보존한다', () => {
    const entries = observedFrontEntries(() => {
      observeFrontNodeEntry('author', { provenance: 'authoring-start', runId: 'run-research', goalType: 'research' });
      observeFrontNodeEntry('plan', { provenance: 'authoring-plan', runId: 'run-unknown' });
    });

    expect(entries.map(({ data }) => data)).toEqual([
      expect.objectContaining({ graphId: 'default-loop', node: 'author', runId: 'run-research', goalType: 'research' }),
      expect.objectContaining({ graphId: 'default-loop', node: 'plan', runId: 'run-unknown' }),
    ]);
  });

  test('requires provenance at compile time', () => {
    // @ts-expect-error provenance is a required call-site contract
    observeFrontNodeEntry('decompose', { runId: 'legacy-call-shape' });
  });

  test('관측 소비자가 실패해도 저작 흐름을 중단하지 않는다', () => {
    const originalLog = debug.log;
    debug.log = (() => { throw new Error('observation failed'); }) as typeof debug.log;
    try {
      expect(() => observeFrontNodeEntry('author', { provenance: 'authoring-start' })).not.toThrow();
    } finally {
      debug.log = originalLog;
    }
  });

  test('같은 runId 로 author 를 세 번 진입하면 방문 예산 판독이 graph-visit-budget 로 남는다', () => {
    const events = observedFrontEvents(() => {
      for (let i = 0; i < 3; i += 1) {
        observeFrontNodeEntry('author', { provenance: 'authoring-start', runId: 'run-budget-author', round: i });
      }
    });

    const nodeEntries = events.filter(({ event }) => event === 'pipeline-node-entry');
    expect(nodeEntries).toHaveLength(3);
    const budgets = events.filter(({ event }) => event === 'graph-visit-budget');
    expect(budgets).toHaveLength(3);
    expect(budgets[0].data).toMatchObject({
      node: 'author', visits: 1, maxVisits: 2, exceeded: false,
      runId: 'run-budget-author', round: 0, phase: 'front',
    });
    expect(budgets[2].data).toMatchObject({
      node: 'author', visits: 3, maxVisits: 2, exceeded: true,
      runId: 'run-budget-author', round: 2, phase: 'front',
    });
    expect(budgets.map(({ data }) => data.exceeded)).toEqual([false, false, true]);
  });

  test('runId 없는 진입은 graph-visit-budget 을 내지 않고 두 runId 의 방문 수는 섞이지 않는다', () => {
    const events = observedFrontEvents(() => {
      observeFrontNodeEntry('plan', { provenance: 'authoring-plan' }); // runId 없음
      observeFrontNodeEntry('plan', { provenance: 'authoring-plan', runId: 'run-alt-1' });
      observeFrontNodeEntry('plan', { provenance: 'authoring-plan', runId: 'run-alt-2' });
      observeFrontNodeEntry('plan', { provenance: 'authoring-plan', runId: 'run-alt-1' });
    });

    const nodeEntries = events.filter(({ event }) => event === 'pipeline-node-entry');
    expect(nodeEntries).toHaveLength(4);
    const budgets = events.filter(({ event }) => event === 'graph-visit-budget');
    expect(budgets).toHaveLength(3); // runId 없는 진입은 판독을 내지 않는다
    expect(budgets.map(({ data }) => [data.runId, data.visits] as const)).toEqual([
      ['run-alt-1', 1],
      ['run-alt-2', 1],
      ['run-alt-1', 2],
    ]);
  });

  test('다른 runId 65개 이상을 거친 뒤 재진입해도 같은 runId 의 방문 수는 이어서 센다', () => {
    const events = observedFrontEvents(() => {
      // 첫 runId 진입(visited 1).
      observeFrontNodeEntry('author', { provenance: 'authoring-start', runId: 'run-first' });
      // 그 사이 다른 runId 65개 이상을 진입시킨다.
      for (let i = 0; i < 65; i += 1) {
        observeFrontNodeEntry('author', { provenance: 'authoring-start', runId: `run-other-${i}` });
      }
      // 첫 runId 재진입 — 계수는 1 로 재시작하지 «않고» 2 가 되어야 한다(런별 정확한 계수).
      observeFrontNodeEntry('author', { provenance: 'authoring-start', runId: 'run-first' });
    });

    const budgets = events.filter(({ event }) => event === 'graph-visit-budget');
    const firstRunReadings = budgets.filter(({ data }) => data.runId === 'run-first');
    expect(firstRunReadings).toHaveLength(2);
    expect(firstRunReadings[0].data).toMatchObject({ node: 'author', visits: 1, maxVisits: 2, exceeded: false });
    // visits=2 · maxVisits=2 → exceeded=false (exceeded 는 visits «>» maxVisits — 셋째 진입이 3 이 되어야 true).
    expect(firstRunReadings[1].data).toMatchObject({ node: 'author', visits: 2, maxVisits: 2, exceeded: false });
    expect(budgets).toHaveLength(67);
  });

  test('같은 runId 안에서 노드별 계수는 섞이지 않고 decompose 는 선언 예산 12 를 읽는다', () => {
    const events = observedFrontEvents(() => {
      observeFrontNodeEntry('author', { provenance: 'authoring-start', runId: 'run-mixed' });
      observeFrontNodeEntry('plan', { provenance: 'authoring-plan', runId: 'run-mixed' });
      observeFrontNodeEntry('author', { provenance: 'authoring-start', runId: 'run-mixed' });
      for (let i = 0; i < 13; i += 1) {
        observeFrontNodeEntry('decompose', { provenance: 'authoring-decomposition-start', runId: 'run-mixed' });
      }
    });
    const budgets = events.filter(({ event }) => event === 'graph-visit-budget').map(({ data }) => data);
    expect(budgets.slice(0, 3).map((d) => [d.node, d.visits, d.maxVisits])).toEqual([
      ['author', 1, 2], ['plan', 1, 2], ['author', 2, 2],
    ]);
    const decompose = budgets.filter((d) => d.node === 'decompose');
    expect(decompose).toHaveLength(13);
    expect(decompose[11]).toMatchObject({ visits: 12, maxVisits: 12, exceeded: false });
    expect(decompose[12]).toMatchObject({ visits: 13, maxVisits: 12, exceeded: true });
  });

  test('진행 중인 런은 다른 런이 아무리 많이 지나가도 버리지 않고, 유휴 시간이 지난 런만 버린다', () => {
    let now = 1_000_000;
    resetFrontVisitCountsForTesting(() => now);
    const events = observedFrontEvents(() => {
      observeFrontNodeEntry('author', { provenance: 'authoring-start', runId: 'run-active' });
      observeFrontNodeEntry('author', { provenance: 'authoring-start', runId: 'run-idle' });
      for (let i = 0; i < 5000; i += 1) {
        observeFrontNodeEntry('author', { provenance: 'authoring-start', runId: `run-other-${i}` });
      }
      // 5000 런이 지나간 뒤에도 같은 런은 이어서 센다(개수로 버리지 않는다).
      observeFrontNodeEntry('author', { provenance: 'authoring-start', runId: 'run-active' });
      // 유휴 시간이 지나면 — run-active 는 그 사이 한 번 더 밟혀 살아 있고, run-idle 은 버려진다.
      now += FRONT_VISIT_IDLE_TTL_MS / 2;
      observeFrontNodeEntry('author', { provenance: 'authoring-start', runId: 'run-active' });
      now += FRONT_VISIT_IDLE_TTL_MS / 2 + 1;
      observeFrontNodeEntry('author', { provenance: 'authoring-start', runId: 'run-active' });
      observeFrontNodeEntry('author', { provenance: 'authoring-start', runId: 'run-idle' });
    });
    const budgets = events.filter(({ event }) => event === 'graph-visit-budget').map(({ data }) => data);
    expect(budgets.filter((d) => d.runId === 'run-active').map((d) => d.visits)).toEqual([1, 2, 3, 4]);
    // ⚠️ 6시간 넘게 아무 진입이 없던 런은 «진행 중»이 아니다 — 새 런처럼 1 부터 센다.
    expect(budgets.filter((d) => d.runId === 'run-idle').map((d) => d.visits)).toEqual([1, 1]);
    // 유휴 런 5001 개(run-other-* ⊕ 옛 run-idle)가 정리됐다 — 남은 것은 run-active 와 다시 들어온 run-idle 뿐.
    expect(frontVisitRunCountForTesting()).toBe(2);
  });

  test('런이 몇 개뿐이어도 유휴 시간이 지난 런은 정리된다(크기 임계 없음)', () => {
    let now = 5_000_000;
    resetFrontVisitCountsForTesting(() => now);
    observedFrontEvents(() => {
      observeFrontNodeEntry('author', { provenance: 'authoring-start', runId: 'run-a' });
      observeFrontNodeEntry('author', { provenance: 'authoring-start', runId: 'run-b' });
      expect(frontVisitRunCountForTesting()).toBe(2);
      now += FRONT_VISIT_IDLE_TTL_MS + 1;
      observeFrontNodeEntry('author', { provenance: 'authoring-start', runId: 'run-c' });
    });
    // run-a·run-b 는 6시간 넘게 멈췄다 — 정리되고 run-c 만 남는다.
    expect(frontVisitRunCountForTesting()).toBe(1);
  });

  test('pipeline-node-entry 로그가 던져도 계수는 이어지고 판독은 남는다', () => {
    const budgets: Array<Record<string, unknown>> = [];
    const originalLog = debug.log;
    debug.log = ((category: string, event: string, data?: Record<string, unknown>) => {
      if (event === 'pipeline-node-entry') throw new Error('log sink down');
      if (category === 'self-implement' && event === 'graph-visit-budget') budgets.push(data ?? {});
    }) as typeof debug.log;
    try {
      expect(() => observeFrontNodeEntry('plan', { provenance: 'authoring-plan', runId: 'run-log-fail' })).not.toThrow();
      expect(() => observeFrontNodeEntry('plan', { provenance: 'authoring-plan', runId: 'run-log-fail' })).not.toThrow();
    } finally {
      debug.log = originalLog;
    }
    expect(budgets.map((d) => d.visits)).toEqual([1, 2]);
  });

  test('graph-visit-budget 로그가 던져도 계수는 이어지고 pipeline-node-entry 는 남는다', () => {
    const entries: Array<Record<string, unknown>> = [];
    let budgetCalls = 0;
    const originalLog = debug.log;
    debug.log = ((category: string, event: string, data?: Record<string, unknown>) => {
      if (event === 'graph-visit-budget') {
        budgetCalls += 1;
        if (budgetCalls === 1) throw new Error('budget sink down');
        entries.push({ event, ...(data ?? {}) });
        return;
      }
      if (category === 'self-implement' && event === 'pipeline-node-entry') entries.push({ event, ...(data ?? {}) });
    }) as typeof debug.log;
    try {
      expect(() => observeFrontNodeEntry('plan', { provenance: 'authoring-plan', runId: 'run-budget-fail' })).not.toThrow();
      expect(() => observeFrontNodeEntry('plan', { provenance: 'authoring-plan', runId: 'run-budget-fail' })).not.toThrow();
    } finally {
      debug.log = originalLog;
    }
    expect(entries.filter((e) => e.event === 'pipeline-node-entry')).toHaveLength(2);
    // 첫 판독 로그가 던졌어도 계수는 올라갔다 — 둘째 판독은 visits=2.
    expect(entries.filter((e) => e.event === 'graph-visit-budget').map((e) => e.visits)).toEqual([2]);
  });
});
