import { describe, expect, test } from 'bun:test';
import { buildBenchReport, renderBenchReport, type LogRow } from './bench-report.js';

const R = 'run-1';
const rows: LogRow[] = [
  { category: 'self-dev.orchestrate', event: 'substrate', data: { runId: R, imageCommit: 'abc123', imageFresh: false, benchArms: [{ id: 'claude', provider: 'anthropic', model: 'claude-sonnet-5' }, { id: 'kimi', provider: 'openrouter', model: 'openrouter/moonshotai/kimi-k3' }, { id: 'codex', provider: 'openai-codex', model: 'gpt-6-sol' }] } },
  { category: 'self-implement.pod', event: 'job-applied', data: { runId: R, job: 'si-a', spaceId: 'task-a', armId: 'pod/claude' } },
  { category: 'self-implement.pod', event: 'job-applied', data: { runId: R, job: 'si-b', spaceId: 'task-b' } },            // armId 없는 옛 판 — 롤업 job 으로 잇는다
  { category: 'self-implement.pod', event: 'job-applied', data: { runId: R, job: 'si-c', spaceId: 'task-c' } },            // 호출 0 · armId 없음 → 못 잇는다
  { category: 'self-dev.orchestrate', event: 'job.done', data: { runId: R, taskId: 'task:a', stage: 'pr-opened', prUrl: 'u/1', durationMs: 60_000 } },
  { category: 'self-dev.orchestrate', event: 'job.done', data: { runId: R, taskId: 'task:b', stage: 'pr-opened', durationMs: 30_000 } },
  { category: 'self-dev.orchestrate', event: 'job.done', data: { runId: R, taskId: 'task:c', stage: 'aborted', durationMs: 5_000 } },
  { event: 'llm-usage', data: { runId: R, site: 'pod-rollup:agent-turn', armId: 'pod/claude', job: 'si-a', model: 'claude-sonnet-5', calls: 10, inputTokens: 100, outputTokens: 10, cost: { usd: 1.5, unknownCostCalls: 0 } } },
  { event: 'llm-usage', data: { runId: R, site: 'pod-rollup:agent-turn', armId: 'pod/claude', job: 'si-a', model: 'gpt-6-sol', calls: 4, inputTokens: 900, outputTokens: 9, cost: { usd: 0.5, unknownCostCalls: 0 } } },
  { event: 'llm-usage', data: { runId: R, site: 'pod-rollup:agent-turn', armId: 'pod/kimi', job: 'si-b', model: 'openrouter/moonshotai/kimi-k3', calls: 3, inputTokens: 30, outputTokens: 3, cost: { usd: 0, unknownCostCalls: 3 } } },
  // 다른 판 · pod-rollup 이 아닌 행 — 섞이면 안 된다
  { event: 'llm-usage', data: { runId: 'run-2', site: 'pod-rollup:agent-turn', armId: 'pod/claude', model: 'claude-sonnet-5', calls: 99, inputTokens: 1 } },
  { event: 'llm-usage', data: { runId: R, site: 'agent-turn', armId: 'pod/claude', model: 'claude-sonnet-5', inputTokens: 7 } },
];

describe('bench report (RFC F5)', () => {
  const rep = buildBenchReport(rows, R);
  const by = Object.fromEntries(rep.arms.map((a) => [a.armId, a]));
  test('joins declaration, outcome and pod usage by runId only', () => {
    expect(by['pod/claude']).toMatchObject({ stage: 'pr-opened', prUrl: 'u/1', durationMs: 60_000, calls: 14, inputTokens: 1000, usdKnown: 2 });
    expect(by['pod/kimi']).toMatchObject({ stage: 'pr-opened', calls: 3, unknownCostCalls: 3, leakCalls: 0 });
  });
  test('counts calls that left the declared model (arm = one model)', () => {
    expect(by['pod/claude']!.leakCalls).toBe(4);
    expect(renderBenchReport(rep)).toContain('이 판으로 팔을 비교하지 않는다');
  });
  test('a zero-call arm without armId stays unjoined, not zero-filled', () => {
    expect(rep.unjoinedJobs).toBe(1);
    expect(by['pod/codex']).toMatchObject({ stage: null, calls: 0 });
    expect(renderBenchReport(rep)).toContain('못 이음');
  });
  test('names the image version it measured and warns when it is not HEAD', () => {
    expect(rep.image).toEqual({ commit: 'abc123', fresh: false });
    expect(renderBenchReport(rep)).toContain('HEAD 와 다르다');
  });
});

describe('E4 — 게이트·리뷰 칸 (2026-09-25)', () => {
  const base: LogRow[] = [
    { category: 'self-implement.pod', event: 'job-applied', data: { runId: 'run-e4', job: 'si-x', spaceId: 'task-x', armId: 'pod/x' } },
    { category: 'self-implement.pod', event: 'job-applied', data: { runId: 'run-e4', job: 'si-y', spaceId: 'task-y', armId: 'pod/y' } },
    { category: 'self-dev.orchestrate', event: 'job.done', data: { runId: 'run-e4', taskId: 'task:x', stage: 'merged', gatePassed: true, reviewVerdict: 'warn', reviewMustFixCount: 0 } },
    { category: 'self-dev.orchestrate', event: 'job.done', data: { runId: 'run-e4', taskId: 'task:y', stage: 'aborted' } },   // 칸을 안 실은 판
  ];
  test('job.done 이 실은 게이트·리뷰를 팔에 옮기고, 안 실은 판은 «모름»(null)이다 — 실패로 접지 않는다', () => {
    const r = buildBenchReport(base, 'run-e4');
    const x = r.arms.find((a) => a.armId === 'pod/x')!;
    const y = r.arms.find((a) => a.armId === 'pod/y')!;
    expect([x.gatePassed, x.reviewVerdict, x.reviewMustFixCount]).toEqual([true, 'warn', 0]);
    expect([y.gatePassed, y.reviewVerdict, y.reviewMustFixCount]).toEqual([null, null, null]);
    const text = renderBenchReport(r);
    expect(text).toContain('| 게이트 | 리뷰(must-fix) |');
    expect(text).toContain('| 통과 | warn (0) |');
    expect(text).toContain('| 모름 | 모름 |');
  });
});
