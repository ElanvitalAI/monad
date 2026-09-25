// Self-Evolution SE2 phased-plan 단위테스트 — 순수 렌더 + 주입 decomposer.
import { describe, test, expect } from 'bun:test';
import { extractOpenItems, buildRoadmapObjective, renderPhasedPlanMarkdown, decomposeRoadmapToPlan } from './phased-plan.js';
import type { ProposalSeed } from './draft-plan.js';
import type { DecomposeProposal } from '../../task-orchestrator/generator-schema.js';

const seed: ProposalSeed = {
  slug: 'task-orchestrator', title: '[부활] task-orchestrator', source: 'internal-roadmap',
  rationale: '미완 44개', evidence: ['docs/archive/2026-04/ROADMAP-task-orchestrator.md', '미완 44개'], tier: 'heavy',
};

const roadmap = `# ROADMAP — Task Orchestrator

- [ ] Migration scripts (version bump)
- [x] 이미 됨
- [ ] LLM-review acceptance criteria
- [ ] Self-heal retry with LEARNING
`;

const proposal: DecomposeProposal = {
  rationale: '스파이크 후 스키마·실행을 순차/병렬로 분해.',
  tasks: [
    { index: 0, title: 'Spike: map touchpoints', surface: { kind: 'acx-session', agentBrand: 'claude-code', prompt: 'x' } as any, priority: 'urgent', acceptance: { criteria: ['design doc exists'], checks: [{ kind: 'file-exists', path: 'x' } as any] } },
    { index: 1, title: 'Add migration', surface: { kind: 'acx-session', agentBrand: 'claude-code', prompt: 'y' } as any, dependsOn: [0], acceptance: { criteria: ['bun test passes'] } },
  ],
};

describe('extractOpenItems', () => {
  test('미완 체크박스만 추출(완료 제외)', () => {
    const items = extractOpenItems(roadmap);
    expect(items.length).toBe(3);
    expect(items[0]).toBe('Migration scripts (version bump)');
    expect(items.some(i => i.includes('이미 됨'))).toBe(false);
  });
});

describe('buildRoadmapObjective', () => {
  test('제목·근거·미완 항목 포함', () => {
    const obj = buildRoadmapObjective(seed, roadmap);
    expect(obj).toContain('Task Orchestrator');
    expect(obj).toContain('미완 44개');       // rationale
    expect(obj).toContain('LLM-review acceptance criteria');
    expect(obj).toContain('dependsOn');
  });
});

describe('renderPhasedPlanMarkdown', () => {
  test('페이즈·의존성·acceptance·결정론체크 렌더', () => {
    const md = renderPhasedPlanMarkdown(seed, proposal);
    expect(md).toContain('멀티페이즈');
    expect(md).toContain('[0] Spike: map touchpoints');
    expect(md).toContain('독립·병렬 가능');
    expect(md).toContain('← 의존[0]');
    expect(md).toContain('design doc exists');
    expect(md).toContain('결정론 체크: file-exists');
  });
});

describe('decomposeRoadmapToPlan', () => {
  test('decompose 성공 → markdown', async () => {
    const md = await decomposeRoadmapToPlan(seed, roadmap, 'docs/x.md', async () => proposal);
    expect(md).toContain('[1] Add migration');
  });
  test('decompose null → null(호출측 template fallback)', async () => {
    const md = await decomposeRoadmapToPlan(seed, roadmap, 'docs/x.md', async () => null);
    expect(md).toBeNull();
  });
  test('decompose throw → null(fail-soft)', async () => {
    const md = await decomposeRoadmapToPlan(seed, roadmap, 'docs/x.md', async () => { throw new Error('llm down'); });
    expect(md).toBeNull();
  });
});
