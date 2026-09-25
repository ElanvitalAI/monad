import { expect, spyOn, test } from 'bun:test';
import { debug } from '../src/debug/log.js';
import { runAdPipeline } from '../src/ad-pipeline/run.js';
import { GRAPH_SPECS } from '../src/self-implement/graph-templates.js';

type DebugEvent = { category: string; event: string; data?: Record<string, unknown> };

function recordDebugEvents(): { events: DebugEvent[]; restore: () => void } {
  const events: DebugEvent[] = [];
  const spy = spyOn(debug, 'log').mockImplementation(((category: string, event: string, data?: Record<string, unknown>) => {
    events.push({ category, event, data });
  }) as never);
  return { events, restore: () => spy.mockRestore() };
}

function frontDeps(approve: (gate: string) => boolean) {
  return {
    approve: (gate: string) => approve(gate),
    stage: () => {},
    onGrounding: () => {},
    frontStage: { survey: { category: 'skincare' }, selection: 'candidate-1' },
    collectSurvey: { collect: () => [{ id: 'candidate-1', label: 'lightweight', reason: 'summer demand', evidence: [{ source: 'https://example.test/trend', detail: 'demand' }] }] },
    generateConcept: { generate: () => ({ candidates: [{ hook: 'h1', angle: 'a1' }, { hook: 'h2', angle: 'a2' }], categoryForbiddenExpressions: [], tone: 'calm' }) },
  };
}

test('runAdPipeline records graph-declared survey candidate and select transitions from the enclosing front flow', async () => {
  const { events, restore } = recordDebugEvents();
  try {
    const result = await runAdPipeline({ kind: 'text', brief: 'campaign' }, frontDeps(() => true));
    const entries = events.filter((event) => event.category === 'ad-pipeline.graph' && event.event === 'pipeline-node-entry');

    expect(result.status).toBe('gates-approved');
    expect(entries.find((entry) => entry.data?.from === 'survey')?.data).toMatchObject({
      from: 'survey', outcome: 'candidate', node: 'select', nodeDeclarationStatus: 'declared', adRunId: expect.any(String),
    });
    expect(entries.find((entry) => entry.data?.from === 'select')?.data).toMatchObject({
      from: 'select', node: 'concept', nodeDeclarationStatus: 'declared', adRunId: expect.any(String),
    });
  } finally {
    restore();
  }
});

test('runAdPipeline distinguishes empty survey results from unknown survey measurement failures', async () => {
  const empty = recordDebugEvents();
  try {
    const result = await runAdPipeline({ kind: 'text', brief: 'campaign' }, {
      ...frontDeps(() => true),
      collectSurvey: { collect: () => [] },
    });
    expect(result.status).toBe('blocked');
    expect(empty.events.find((event) => event.data?.from === 'survey')?.data).toMatchObject({ from: 'survey', outcome: 'empty', node: 'survey', nodeDeclarationStatus: 'declared' });
  } finally {
    empty.restore();
  }

  const unknown = recordDebugEvents();
  try {
    const result = await runAdPipeline({ kind: 'text', brief: 'campaign' }, {
      ...frontDeps(() => true),
      collectSurvey: { collect: () => { throw new Error('collector unavailable'); } },
    });
    expect(result.status).toBe('blocked');
    expect(unknown.events.find((event) => event.data?.from === 'survey')?.data).toMatchObject({ from: 'survey', outcome: 'unknown', node: 'survey', nodeDeclarationStatus: 'declared' });
  } finally {
    unknown.restore();
  }
});

test('runAdPipeline records the CONCEPT_OK pass entry with a distinct ad run identity while preserving approval', async () => {
  const { events, restore } = recordDebugEvents();
  try {
    const result = await runAdPipeline({ kind: 'text', brief: 'campaign' }, frontDeps(() => true));
    const entry = events.find((event) => event.category === 'ad-pipeline.graph' && event.event === 'pipeline-node-entry' && event.data?.gate === 'CONCEPT_OK');

    expect(result.status).toBe('gates-approved');
    expect(entry?.data).toMatchObject({
      graphId: 'ad-loop',
      node: 'brief',
      nodeDeclarationStatus: 'declared',
      gate: 'CONCEPT_OK',
      outcome: 'pass',
      adRunId: expect.any(String),
    });
    expect(entry?.data).not.toHaveProperty('runId');
    expect(entry?.data).not.toHaveProperty('attemptOrdinal');
  } finally {
    restore();
  }
});

test('runAdPipeline records declared graph destinations for all five approved gates', async () => {
  const { events, restore } = recordDebugEvents();
  try {
    const result = await runAdPipeline({ kind: 'text', brief: 'campaign' }, frontDeps(() => true));
    const entries = events.filter((event) => event.category === 'ad-pipeline.graph' && event.event === 'pipeline-node-entry' && typeof event.data?.gate === 'string');
    const expected = [
      ['CONCEPT_OK', 'brief'],
      ['BRIEF_OK', 'shoot'],
      ['MASTER_PICK', 'assemble'],
      ['PACK_OK', 'qc'],
      ['VIDEO_OK', 'deliver'],
    ];

    expect(result.status).toBe('gates-approved');
    expect(entries).toHaveLength(expected.length);
    for (const [gate, node] of expected) {
      expect(entries.find((entry) => entry.data?.gate === gate)?.data).toMatchObject({
        gate,
        node,
        nodeDeclarationStatus: 'declared',
        outcome: 'pass',
        adRunId: expect.any(String),
      });
    }
    expect(entries.some((entry) => entry.data?.nodeDeclarationStatus === 'undeclared')).toBe(false);
  } finally {
    restore();
  }
});

test('runAdPipeline reports an unmapped gate as measurement failure without a node-entry event', async () => {
  const spec = GRAPH_SPECS['ad-loop'];
  const briefEdge = spec?.edges.find((edge) => edge.on === 'BRIEF_OK');
  if (briefEdge === undefined) throw new Error('BRIEF_OK transition is required for this regression test');
  const originalMap = briefEdge.map;
  (briefEdge as { map?: Record<string, string> }).map = undefined;
  const { events, restore } = recordDebugEvents();
  try {
    const result = await runAdPipeline({ kind: 'text', brief: 'campaign' }, frontDeps((gate) => gate !== 'MASTER_PICK'));
    const failures = events.filter((event) => event.category === 'ad-pipeline.graph' && event.event === 'pipeline-node-entry-measurement-failed');
    const entries = events.filter((event) => event.category === 'ad-pipeline.graph' && event.event === 'pipeline-node-entry');

    expect(result).toMatchObject({ status: 'rejected', stoppedGate: 'MASTER_PICK' });
    expect(failures.find((event) => event.data?.gate === 'BRIEF_OK')?.data).toMatchObject({
      gate: 'BRIEF_OK',
      outcome: 'pass',
      reason: expect.any(String),
    });
    expect(entries.some((event) => event.data?.gate === 'BRIEF_OK')).toBe(false);
  } finally {
    (briefEdge as { map?: typeof originalMap }).map = originalMap;
    restore();
  }
});

test('runAdPipeline remains approved when graph observation throws', async () => {
  const originalLog = debug.log;
  const spy = spyOn(debug, 'log').mockImplementation(((category: string, event: string, data?: Record<string, unknown>) => {
    if (category === 'ad-pipeline.graph' && event === 'pipeline-node-entry') throw new Error('observation unavailable');
    originalLog.call(debug, category, event, data);
  }) as never);
  try {
    const result = await runAdPipeline({ kind: 'text', brief: 'campaign' }, frontDeps(() => true));

    expect(result.status).toBe('gates-approved');
  } finally {
    spy.mockRestore();
  }
});

test('runAdPipeline records the CONCEPT_OK fail entry while preserving rejection', async () => {
  const { events, restore } = recordDebugEvents();
  try {
    const result = await runAdPipeline({ kind: 'text', brief: 'campaign' }, frontDeps((gate) => gate !== 'CONCEPT_OK'));
    const entry = events.find((event) => event.category === 'ad-pipeline.graph' && event.event === 'pipeline-node-entry' && event.data?.gate === 'CONCEPT_OK');

    expect(result).toMatchObject({ status: 'rejected', stoppedGate: 'CONCEPT_OK' });
    expect(entry?.data).toMatchObject({
      graphId: 'ad-loop',
      node: 'survey',
      nodeDeclarationStatus: 'declared',
      gate: 'CONCEPT_OK',
      outcome: 'fail',
      adRunId: expect.any(String),
    });
    expect(entry?.data).not.toHaveProperty('runId');
    expect(entry?.data).not.toHaveProperty('attemptOrdinal');
  } finally {
    restore();
  }
});
