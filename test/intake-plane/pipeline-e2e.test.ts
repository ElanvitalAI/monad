// Phase 1 I9 — end-to-end pipeline test.
//
// Spins up the full decompose → enrich → categorize → goal_align →
// multi-spec → register_all chain with stub callables, then asserts
// that the user's dump from RESEARCH §4 lands as
//   - 5 Mission rows (one per ==== group ====)
//   - 15 Task rows wired via missionId reverse pointer
//   - workflows persisted for every workflowEligible task (12 of 15)
//   - skipped tasks (debug · cognitive) still get a Task row, no workflow
//
// All LLM / external callouts are stubbed deterministically — the test
// stays hermetic. The point is to lock the wiring contract, not the
// quality of any single phase's prompt.

import { describe, expect, test } from 'bun:test';

import { decomposeMemo, type DecomposeMemoCallable } from '../../src/intake-plane/decompose.ts';
import { enrichDecomposition, type EnrichPlugins } from '../../src/intake-plane/enrich.ts';
import { categorizeDecomposition, type CategorizeCallable } from '../../src/intake-plane/categorize.ts';
import { alignDecomposition, type AlignCallable } from '../../src/intake-plane/goal-align.ts';
import { synthMultiSpecs, type SingleSynthCallable } from '../../src/intake-plane/multi-spec.ts';
import { registerAll, type SaveWorkflowCallable } from '../../src/intake-plane/register-all.ts';
import { TaskStore } from '../../src/task-orchestrator/store.ts';

// ── RESEARCH §4 dump (compressed reproduction, 15 tasks across 5 missions) ──

const USER_DUMP = `
==== 스크린 레코딩 능력 흡수 ====
- openscreen + open-recorder repo 분석 (github.com/siddharthvaddem/openscreen)
- LLM 의 S3 업로드 능력

==== 하이퍼프레임 + Drop image video 흡수 ====
- 하이퍼프레임 X 링크 (x.com/liu8in/status/2044827628700684463)
- claude drop image video 분석 (youtube.com/watch?v=ZNbgOhxhzXg)

==== 다이어그램 + 영상 생성 강화 ====
- 위젯 surface · Canvas · DrawIO · Excalidraw repo 분석
- SVG · Mermaid · DrawIO 흡수 plan
- kitty 터미널 지원 확인
- IUL · Playground 능력 확인
- LLM 자율 mermaid popup
- 다이어그램 / 영상 플레이어 transition
- BTOP virtual window
- D&D 이미지 캡처

==== Agent 알고리즘 research ====
- ouroboros agent 알고리즘 (github.com/Q00/ouroboros)

==== 기타 사소 디버깅 ====
- MD glow width 안 됨
- 이미지 바로 보기 안 됨
`;

const DECOMPOSE_JSON = JSON.stringify({
  rationale: 'Five intent groups: recording · UI capture · diagram · agent research · debug.',
  missions: [
    {
      id: 'm-1', title: '스크린 레코딩 능력 흡수',
      tasks: [
        { id: 't-1', title: 'openscreen + open-recorder repo 분석', intent: 'plan merge', urls: ['https://github.com/siddharthvaddem/openscreen'], confidence: 'high' },
        { id: 't-2', title: 'LLM 의 S3 업로드 능력', intent: 'wire upload', confidence: 'medium' },
      ],
    },
    {
      id: 'm-2', title: '하이퍼프레임 + drop image video 흡수',
      tasks: [
        { id: 't-3', title: '하이퍼프레임 X 링크 흡수', intent: 'capture pattern', urls: ['https://x.com/liu8in/status/2044827628700684463'], confidence: 'medium' },
        { id: 't-4', title: 'claude drop image video 분석', intent: 'study UX', urls: ['https://youtube.com/watch?v=ZNbgOhxhzXg'], confidence: 'medium' },
      ],
    },
    {
      id: 'm-3', title: '다이어그램 + 영상 생성 강화',
      tasks: [
        { id: 't-5', title: '위젯 surface repo 분석', intent: 'scout', confidence: 'medium' },
        { id: 't-6', title: '다이어그램 흡수 plan', intent: 'plan', confidence: 'high' },
        { id: 't-7', title: 'kitty 터미널 지원 확인', intent: 'compat', confidence: 'low' },
        { id: 't-8', title: 'IUL · Playground 능력 확인', intent: 'scout', confidence: 'low' },
        { id: 't-9', title: 'LLM 자율 mermaid popup', intent: 'build', confidence: 'high' },
        { id: 't-10', title: '다이어그램 영상 플레이어', intent: 'build', confidence: 'high' },
        { id: 't-11', title: 'BTOP virtual window', intent: 'build', confidence: 'medium' },
        { id: 't-12', title: 'D&D 이미지 캡처', intent: 'build', confidence: 'medium' },
      ],
    },
    {
      id: 'm-4', title: 'Agent 알고리즘 research',
      tasks: [
        { id: 't-13', title: 'ouroboros agent 분석', intent: 'study', urls: ['https://github.com/Q00/ouroboros'], confidence: 'high' },
      ],
    },
    {
      id: 'm-5', title: '기타 사소 디버깅',
      tasks: [
        { id: 't-14', title: 'MD glow width 분석', intent: 'debug', confidence: 'low' },
        { id: 't-15', title: '이미지 바로 보기 분석', intent: 'debug', confidence: 'low' },
      ],
    },
  ],
});

const CATEGORIZE_JSON = JSON.stringify({
  categorizations: [
    { key: 'm-1/t-1', category: 'research-and-plan', workflowEligible: true },
    { key: 'm-1/t-2', category: 'dev-feature', workflowEligible: true },
    { key: 'm-2/t-3', category: 'research', workflowEligible: true },
    { key: 'm-2/t-4', category: 'research', workflowEligible: true },
    { key: 'm-3/t-5', category: 'research', workflowEligible: true },
    { key: 'm-3/t-6', category: 'research-and-plan', workflowEligible: true },
    { key: 'm-3/t-7', category: 'cognitive', workflowEligible: false },
    { key: 'm-3/t-8', category: 'research', workflowEligible: true },
    { key: 'm-3/t-9', category: 'dev-feature', workflowEligible: true },
    { key: 'm-3/t-10', category: 'dev-feature', workflowEligible: true },
    { key: 'm-3/t-11', category: 'dev-feature', workflowEligible: true },
    { key: 'm-3/t-12', category: 'dev-feature', workflowEligible: true },
    { key: 'm-4/t-13', category: 'research', workflowEligible: true },
    { key: 'm-5/t-14', category: 'debug', workflowEligible: false },
    { key: 'm-5/t-15', category: 'debug', workflowEligible: false },
  ],
});

describe('Phase 1 I9 — full pipeline e2e', () => {
  test('user dump → 5 missions · 15 tasks · 12 workflows', async () => {
    const decomposeCallable: DecomposeMemoCallable = async () => ({
      text: '```json\n' + DECOMPOSE_JSON + '\n```',
      promptTokens: 800,
      completionTokens: 400,
      costUsd: 0.01,
      modelId: 'stub',
    });

    const enrichPlugins: EnrichPlugins = {
      digestUrl: async ({ url }) => ({ summary: `digest:${url}` }),
      fetchRepo: async ({ slug }) => ({ summary: `repo:${slug}` }),
      crawlKeyword: async ({ keyword }) => ({ summary: `crawl:${keyword}` }),
    };

    const categorizeCallable: CategorizeCallable = async () => ({
      text: '```json\n' + CATEGORIZE_JSON + '\n```',
    });

    const alignCallable: AlignCallable = async () => ({
      text: JSON.stringify({
        alignments: [],
        dependencies: [
          { from: 'm-3/t-5', to: 'm-3/t-6', reason: 'repo 분석 후 흡수 plan' },
          { from: 'm-1/t-1', to: 'm-1/t-2', reason: 'recording 후 S3 wire' },
        ],
      }),
    });

    const synthCallable: SingleSynthCallable = async (input) => ({
      ok: true,
      yaml: `name: ${input.taskKey.replace('/', '-')}\nnodes:\n  - manualTrigger\n`,
      workflowName: input.taskKey.replace('/', '-'),
      triggerSummary: 'manual',
    });

    const savedWorkflows: string[] = [];
    const saveWorkflow: SaveWorkflowCallable = async (args) => {
      savedWorkflows.push(args.taskKey);
      return { ok: true, path: `/wf/${args.name}.yaml` };
    };

    // 1. Decompose
    const decomp = await decomposeMemo(
      { rawText: USER_DUMP, intakeId: 'dogfood-1' },
      { callable: decomposeCallable },
    );
    expect(decomp.missions.length).toBe(5);
    expect(decomp.missions.reduce((s, m) => s + m.tasks.length, 0)).toBe(15);

    // 2. Enrich
    const enriched = await enrichDecomposition(decomp, { plugins: enrichPlugins });
    const t1 = enriched.missions[0]!.tasks[0]!;
    expect(t1.context.enrichments.length).toBe(1);

    // 3. Categorize
    const cat = await categorizeDecomposition(enriched, { callable: categorizeCallable });
    expect(Object.keys(cat.categorizations).length).toBe(15);
    const eligible = Object.values(cat.categorizations).filter((c) => c.workflowEligible).length;
    expect(eligible).toBe(12);

    // 4. Align
    const align = await alignDecomposition(
      { decomposition: enriched, categorize: cat },
      { callable: alignCallable },
    );
    expect(align.dependencies.length).toBe(2);

    // 5. Multi-synth
    const synth = await synthMultiSpecs(enriched, cat, align, { callable: synthCallable });
    expect(synth.counts.ok).toBe(12);
    expect(synth.counts.skipped).toBe(3);

    // 6. Register all
    const store = new TaskStore({ path: ':memory:', noWal: true });
    const out = await registerAll(
      {
        intakeId: 'dogfood-1',
        rawText: USER_DUMP,
        decomposition: enriched,
        categorize: cat,
        align,
        synth,
      },
      { store, saveWorkflow },
    );

    expect(out.missionIds.length).toBe(5);
    expect(out.taskIds.length).toBe(15);
    expect(out.workflows.length).toBe(12);
    expect(out.errors.length).toBe(0);
    expect(savedWorkflows.sort().length).toBe(12);

    // Cross-link sanity: every workflow-eligible task's row has missionId,
    // every dependency edge landed.
    expect(store.countMissions()).toBe(5);
    expect(store.countTasks()).toBe(15);

    const byKey = new Map(out.tasks.map((t) => [t.taskKey, t.taskId]));
    const t6 = store.getTask(byKey.get('m-3/t-6')!)!;
    expect(t6.dependsOn).toContain(byKey.get('m-3/t-5')!);
    const t2 = store.getTask(byKey.get('m-1/t-2')!)!;
    expect(t2.dependsOn).toContain(byKey.get('m-1/t-1')!);

    // Mission cross-link: m-3 has 8 tasks attached.
    const m3 = out.missions.find((m) => m.missionKey === 'm-3')!;
    expect(store.listTasksForMission(m3.missionId).length).toBe(8);

    store.close();
  });

  test('partial failure: synth times out → skeleton fallback still lands', async () => {
    const decomp = await decomposeMemo(
      { rawText: USER_DUMP },
      {
        callable: async () => ({ text: '```json\n' + DECOMPOSE_JSON + '\n```' }),
      },
    );
    const enriched = await enrichDecomposition(decomp, { plugins: {} });
    const cat = await categorizeDecomposition(enriched, {
      callable: async () => ({ text: '```json\n' + CATEGORIZE_JSON + '\n```' }),
    });
    const align = await alignDecomposition({ decomposition: enriched, categorize: cat });
    const synth = await synthMultiSpecs(enriched, cat, align, {
      callable: async () => {
        throw new Error('LLM timeout');
      },
    });
    expect(synth.counts.skeleton).toBe(12);
    expect(synth.counts.ok).toBe(0);

    const store = new TaskStore({ path: ':memory:', noWal: true });
    const out = await registerAll(
      {
        intakeId: 'dogfood-2',
        rawText: USER_DUMP,
        decomposition: enriched,
        categorize: cat,
        align,
        synth,
      },
      { store, saveWorkflow: async (a) => ({ ok: true, path: `/wf/${a.name}.yaml` }) },
    );

    expect(out.workflows.length).toBe(12);
    expect(out.workflows.every((w) => w.skeleton)).toBe(true);
    expect(out.missionIds.length).toBe(5);
    expect(out.taskIds.length).toBe(15);
    store.close();
  });
});
