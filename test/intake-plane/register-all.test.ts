// Phase 1 I8 — intake.register_all unit tests.

import { describe, expect, test } from 'bun:test';

import {
  registerAll,
  type RegisterAllInput,
  type SaveWorkflowCallable,
} from '../../src/intake-plane/register-all.ts';
import { TaskStore } from '../../src/task-orchestrator/store.ts';
import type { EnrichedDecomposition } from '../../src/intake-plane/enrich.ts';
import type { CategorizeResult } from '../../src/intake-plane/categorize.ts';
import type { GoalAlignResult } from '../../src/intake-plane/goal-align.ts';
import type { MultiSynthResult } from '../../src/intake-plane/multi-spec.ts';

function makeStore(): TaskStore {
  return new TaskStore({ path: ':memory:', noWal: true });
}

function makeDecomposition(): EnrichedDecomposition {
  return {
    rationale: 'r',
    fallback: false,
    missions: [
      {
        id: 'm-1',
        title: 'Diagram',
        intent: 'overhaul diagram stack',
        tasks: [
          {
            id: 't-1',
            title: 'Audit excalidraw',
            intent: 'spec the embed plan',
            refs: [],
            invariants: [],
            decisionSignals: [],
            confidence: 'high',
            context: { enrichments: [] },
          },
          {
            id: 't-2',
            title: 'Wire mermaid popup',
            intent: 'one click preview',
            refs: [],
            invariants: [],
            decisionSignals: [],
            confidence: 'medium',
            context: { enrichments: [] },
          },
        ],
      },
      {
        id: 'm-2',
        title: 'Debug',
        tasks: [
          {
            id: 't-3',
            title: 'Investigate glow width',
            intent: 'find regression',
            refs: [],
            invariants: [],
            decisionSignals: [],
            confidence: 'low',
            context: { enrichments: [] },
          },
        ],
      },
    ],
  };
}

function makeCategorize(): CategorizeResult {
  return {
    fallback: false,
    categorizations: {
      'm-1/t-1': { taskKey: 'm-1/t-1', category: 'research-and-plan', workflowEligible: true, confidence: 'high' },
      'm-1/t-2': { taskKey: 'm-1/t-2', category: 'dev-feature', workflowEligible: true, confidence: 'medium' },
      'm-2/t-3': { taskKey: 'm-2/t-3', category: 'debug', workflowEligible: false, confidence: 'high' },
    },
  };
}

function makeAlign(): GoalAlignResult {
  return {
    fallback: false,
    alignments: {
      'm-1/t-1': { taskKey: 'm-1/t-1', priority: 'medium', source: 'heuristic' },
      'm-1/t-2': { taskKey: 'm-1/t-2', priority: 'high', source: 'heuristic' },
      'm-2/t-3': { taskKey: 'm-2/t-3', priority: 'low', source: 'heuristic' },
    },
    dependencies: [{ from: 'm-1/t-1', to: 'm-1/t-2', soft: true }],
  };
}

function makeSynth(opts?: { skeleton?: boolean }): MultiSynthResult {
  if (opts?.skeleton) {
    return {
      counts: { ok: 0, skeleton: 2, failed: 0, skipped: 1 },
      perTask: {
        'm-1/t-1': {
          ok: true,
          taskKey: 'm-1/t-1',
          yaml: 'name: skel-1',
          workflowName: 'skel-1',
          triggerSummary: 'manual',
          skeleton: true,
          reason: 'LLM timeout',
        },
        'm-1/t-2': {
          ok: true,
          taskKey: 'm-1/t-2',
          yaml: 'name: skel-2',
          workflowName: 'skel-2',
          triggerSummary: 'manual',
          skeleton: true,
          reason: 'LLM timeout',
        },
      },
    };
  }
  return {
    counts: { ok: 2, skeleton: 0, failed: 0, skipped: 1 },
    perTask: {
      'm-1/t-1': {
        ok: true,
        taskKey: 'm-1/t-1',
        yaml: 'name: wf-1\nnodes: []\n',
        workflowName: 'wf-1',
        triggerSummary: 'manual',
        skeleton: false,
      },
      'm-1/t-2': {
        ok: true,
        taskKey: 'm-1/t-2',
        yaml: 'name: wf-2\nnodes: []\n',
        workflowName: 'wf-2',
        triggerSummary: 'manual',
        skeleton: false,
      },
    },
  };
}

function makeInput(extra?: Partial<RegisterAllInput>): RegisterAllInput {
  return {
    intakeId: 'in-1',
    rawText: '==== Diagram ====\n- mermaid popup',
    decomposition: makeDecomposition(),
    categorize: makeCategorize(),
    align: makeAlign(),
    synth: makeSynth(),
    ...extra,
  };
}

describe('registerAll', () => {
  test('creates Mission rows with source.intake + raw excerpt', async () => {
    const store = makeStore();
    const result = await registerAll(makeInput(), { store });
    expect(result.missions.length).toBe(2);
    expect(result.missionIds.length).toBe(2);
    const m = store.getMission(result.missionIds[0]!)!;
    expect(m.source.kind).toBe('intake');
    expect(m.source.intakeId).toBe('in-1');
    expect(m.source.raw).toContain('mermaid popup');
    store.close();
  });

  test('creates Task rows with missionId + priority threaded through', async () => {
    const store = makeStore();
    const result = await registerAll(makeInput(), { store });
    expect(result.tasks.length).toBe(3);
    const byKey = new Map(result.tasks.map((t) => [t.taskKey, t.taskId]));
    const t2 = store.getTask(byKey.get('m-1/t-2')!)!;
    expect(t2.missionId).toBe(result.missions.find((m) => m.missionKey === 'm-1')!.missionId);
    expect(t2.priority).toBe('high');
    store.close();
  });

  test('records dependency edges as task.dependsOn', async () => {
    const store = makeStore();
    const result = await registerAll(makeInput(), { store });
    const byKey = new Map(result.tasks.map((t) => [t.taskKey, t.taskId]));
    const t2 = store.getTask(byKey.get('m-1/t-2')!)!;
    expect(t2.dependsOn).toContain(byKey.get('m-1/t-1')!);
  });

  test('updates each Mission row with its taskIds', async () => {
    const store = makeStore();
    const result = await registerAll(makeInput(), { store });
    const m1Id = result.missions.find((m) => m.missionKey === 'm-1')!.missionId;
    const m1 = store.getMission(m1Id)!;
    expect(m1.taskIds.length).toBe(2);
  });

  test('listTasksForMission returns the rows attached via mission_id', async () => {
    const store = makeStore();
    const result = await registerAll(makeInput(), { store });
    const m1Id = result.missions.find((m) => m.missionKey === 'm-1')!.missionId;
    const rows = store.listTasksForMission(m1Id);
    expect(rows.length).toBe(2);
    expect(rows.every((t) => t.missionId === m1Id)).toBe(true);
  });

  test('saveWorkflow callable receives every eligible task', async () => {
    const store = makeStore();
    const calls: Array<{ name: string; skeleton: boolean; taskKey: string }> = [];
    const saveWorkflow: SaveWorkflowCallable = async (args) => {
      calls.push({ name: args.name, skeleton: args.skeleton, taskKey: args.taskKey });
      return { ok: true, path: `/wf/${args.name}.yaml` };
    };
    const result = await registerAll(makeInput(), { store, saveWorkflow });
    expect(calls.length).toBe(2);
    expect(calls.map((c) => c.taskKey).sort()).toEqual(['m-1/t-1', 'm-1/t-2']);
    expect(result.workflows.length).toBe(2);
    expect(result.workflows.every((w) => !w.skeleton)).toBe(true);
  });

  test('flags skeleton workflows in the result + the save call', async () => {
    const store = makeStore();
    const calls: Array<{ skeleton: boolean }> = [];
    const saveWorkflow: SaveWorkflowCallable = async (args) => {
      calls.push({ skeleton: args.skeleton });
      return { ok: true, path: '/wf/x.yaml' };
    };
    const result = await registerAll(makeInput({ synth: makeSynth({ skeleton: true }) }), {
      store,
      saveWorkflow,
    });
    expect(result.workflows.every((w) => w.skeleton)).toBe(true);
    expect(calls.every((c) => c.skeleton)).toBe(true);
  });

  test('captures workflow save errors without aborting the batch', async () => {
    const store = makeStore();
    let nth = 0;
    const saveWorkflow: SaveWorkflowCallable = async () => {
      nth += 1;
      if (nth === 1) return { ok: false, error: 'disk full' };
      return { ok: true, path: '/wf/x.yaml' };
    };
    const result = await registerAll(makeInput(), { store, saveWorkflow });
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]!.scope).toBe('workflow');
    expect(result.workflows.length).toBe(1);
  });

  test('manual source kind when intakeId omitted', async () => {
    const store = makeStore();
    const result = await registerAll(
      { ...makeInput(), intakeId: undefined },
      { store },
    );
    const m = store.getMission(result.missionIds[0]!)!;
    expect(m.source.kind).toBe('manual');
    expect(m.source.intakeId).toBeUndefined();
  });

  test('notes carry fallback warning when decomposition.fallback=true', async () => {
    const store = makeStore();
    const dec = { ...makeDecomposition(), fallback: true };
    const result = await registerAll(makeInput({ decomposition: dec }), { store });
    const m = store.getMission(result.missionIds[0]!)!;
    expect(m.notes.some((n) => n.includes('fallback decomposition'))).toBe(true);
  });

  test('no workflow saver wired → tasks still land but workflows empty', async () => {
    const store = makeStore();
    const result = await registerAll(makeInput(), { store });
    expect(result.tasks.length).toBe(3);
    expect(result.workflows.length).toBe(0);
    expect(result.errors.length).toBe(0);
  });
});

// FU-I7d (2026-05-12) — includeTaskKeys whitelist filter.
describe('registerAll · FU-I7d includeTaskKeys', () => {
  test('undefined filter → behaves like pre-FU default (all tasks committed)', async () => {
    const store = makeStore();
    const result = await registerAll(makeInput(), { store });
    expect(result.tasks.length).toBe(3);
    expect(result.missions.length).toBe(2);
    expect(result.skippedTaskKeys).toEqual([]);
    expect(result.skippedMissionKeys).toEqual([]);
    store.close();
  });

  test('empty array filter → behaves like undefined (degrades to no-op)', async () => {
    const store = makeStore();
    const result = await registerAll(makeInput({ includeTaskKeys: [] }), { store });
    expect(result.tasks.length).toBe(3);
    expect(result.skippedTaskKeys).toEqual([]);
    expect(result.skippedMissionKeys).toEqual([]);
    store.close();
  });

  test('partial whitelist → only the listed task keys land', async () => {
    const store = makeStore();
    const result = await registerAll(
      makeInput({ includeTaskKeys: ['m-1/t-2'] }),
      { store },
    );
    expect(result.tasks.map((t) => t.taskKey)).toEqual(['m-1/t-2']);
    // m-1 mission still created (one of its tasks survived the filter).
    expect(result.missions.map((m) => m.missionKey).sort()).toEqual(['m-1']);
    // m-2 had its only task filtered out → mission skipped entirely.
    expect(result.skippedMissionKeys).toContain('m-2');
    // Per-task skip surface for the UI:
    expect(result.skippedTaskKeys.sort()).toEqual(['m-1/t-1', 'm-2/t-3']);
    store.close();
  });

  test('dependency edge skipped when prerequisite filtered out', async () => {
    // align edge: m-1/t-1 → m-1/t-2. If m-1/t-1 is filtered, t-2 must
    // land but without that dependency wired (the prereq never ran).
    const store = makeStore();
    const result = await registerAll(
      makeInput({ includeTaskKeys: ['m-1/t-2'] }),
      { store },
    );
    const t2Id = result.tasks.find((t) => t.taskKey === 'm-1/t-2')!.taskId;
    const t2 = store.getTask(t2Id)!;
    expect(t2.dependsOn).toEqual([]);
    store.close();
  });

  test('workflow save skips filtered-out tasks', async () => {
    const store = makeStore();
    const calls: string[] = [];
    const saveWorkflow: SaveWorkflowCallable = async (args) => {
      calls.push(args.taskKey);
      return { ok: true, path: `/wf/${args.name}.yaml` };
    };
    const result = await registerAll(
      makeInput({ includeTaskKeys: ['m-1/t-1'] }),
      { store, saveWorkflow },
    );
    expect(calls).toEqual(['m-1/t-1']);
    expect(result.workflows.map((w) => w.taskKey)).toEqual(['m-1/t-1']);
    store.close();
  });

  test('full whitelist matches no-filter behaviour exactly', async () => {
    const storeA = makeStore();
    const a = await registerAll(makeInput(), { store: storeA });
    storeA.close();
    const storeB = makeStore();
    const b = await registerAll(
      makeInput({ includeTaskKeys: ['m-1/t-1', 'm-1/t-2', 'm-2/t-3'] }),
      { store: storeB },
    );
    storeB.close();
    expect(b.tasks.map((t) => t.taskKey).sort()).toEqual(a.tasks.map((t) => t.taskKey).sort());
    expect(b.missions.map((m) => m.missionKey).sort()).toEqual(a.missions.map((m) => m.missionKey).sort());
    expect(b.skippedTaskKeys).toEqual([]);
    expect(b.skippedMissionKeys).toEqual([]);
  });
});

describe('registerAll · FU8 follow-up #1 · KGS Mission cross-link', () => {
  test('writes a mission:<id> card for every committed Mission', async () => {
    const store = makeStore();
    const written: Array<{ id: string; missionId: string | undefined; relatedIds: readonly string[] | undefined }> = [];
    const result = await registerAll(makeInput(), {
      store,
      saveWorkflow: async ({ name }) => ({ ok: true, path: `/abs/${name}.yaml` }),
      kgsMissionWriter: {
        writeCard: (card) => {
          written.push({
            id: card.id,
            missionId: card.missionId,
            relatedIds: card.relatedIds,
          });
        },
      },
    });
    expect(written.length).toBe(result.missions.length);
    for (const m of result.missions) {
      // TOX Mission ids are already minted as `mission:<hex>` —
      // `mintMissionCardId` is idempotent on the prefix so the card
      // id equals the missionId verbatim (NOT `mission:mission:...`).
      const matching = written.find((w) => w.id === m.missionId);
      expect(matching).toBeDefined();
      expect(matching!.missionId).toBe(m.missionId);
    }
    // The diagram mission spawned 2 workflows — its card should
    // carry both paths as relatedIds.
    const diagramMission = result.missions.find((m) => m.missionKey === 'm-1');
    expect(diagramMission).toBeDefined();
    const diagramCard = written.find((w) => w.id === diagramMission!.missionId);
    expect(diagramCard).toBeDefined();
    expect(diagramCard!.relatedIds).toBeDefined();
    expect((diagramCard!.relatedIds ?? []).length).toBe(2);
    store.close();
  });

  test('omitting kgsMissionWriter keeps the pre-PR behaviour (back-compat)', async () => {
    const store = makeStore();
    const result = await registerAll(makeInput(), { store });
    // Mission rows still created.
    expect(result.missions.length).toBe(2);
    // No errors related to KGS writes (the writer was never invoked).
    expect(result.errors.filter((e) => e.error.includes('kgs'))).toEqual([]);
    store.close();
  });

  test('best-effort: a throwing kgsMissionWriter records an error but does not block', async () => {
    const store = makeStore();
    const result = await registerAll(makeInput(), {
      store,
      kgsMissionWriter: {
        writeCard: () => { throw new Error('kgs disk full'); },
      },
    });
    // Mission rows still landed in TOX despite the KGS write failure.
    expect(result.missions.length).toBe(2);
    // Errors carry the failure detail per mission.
    const kgsErrors = result.errors.filter((e) => e.scope === 'mission' && e.error.includes('kgs'));
    expect(kgsErrors.length).toBe(2);
    expect(kgsErrors[0]!.error).toContain('kgs disk full');
    store.close();
  });
});
