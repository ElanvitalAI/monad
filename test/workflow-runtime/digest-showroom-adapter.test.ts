// W9b Z7 · D7 MorningDigest → 4-pane showroom adapter.

import { describe, expect, test } from 'bun:test';
import {
  buildAllPrompts,
  MORNING_LANES,
  runMorningShowroom,
  type MorningShowroomInput,
} from '../../src/workflow-runtime/digest-showroom-adapter';
import { composeMorningDigest } from '../../src/dispatch/morning-digest';
import type { ShowroomLaneCallable } from '../../src/task-orchestrator/surfaces/showroom-surface';

function makeDigest(): MorningShowroomInput {
  const digest = composeMorningDigest({
    date: '2026-05-12',
    windowStart: '2026-05-11T22:00:00Z',
    windowEnd:   '2026-05-12T08:00:00Z',
    runs: [
      { taskId: 't-1', taskTitle: 'PR review automation', outcome: 'completed', startedAt: 0, endedAt: 60_000 },
      { taskId: 't-2', taskTitle: 'SVG renderer build',    outcome: 'completed', startedAt: 0, endedAt: 90_000 },
      { taskId: 't-3', taskTitle: 'auto-publish gate',     outcome: 'awaiting-approval', startedAt: 0 },
      { taskId: 't-4', taskTitle: 'memory leak repro',     outcome: 'failed', startedAt: 0, errorSummary: 'no logs' },
      { taskId: 't-5', taskTitle: 'cron tidy',             outcome: 'retrying', startedAt: 0, errorSummary: 'rate-limited' },
    ],
    upcoming: [
      { taskTitle: 'Excalidraw integration', expectedSlot: '10:00' },
      { taskTitle: 'OKR snapshot',           expectedSlot: '16:00' },
    ],
  });
  return {
    digest,
    backlogRecommendations: [
      { taskTitle: 'big-diff PR review hardening', estimateMinutes: 60, reason: 'follow-up to yesterday' },
      { taskTitle: 'Mermaid bridge',                estimateMinutes: 30 },
    ],
  };
}

function laneRecorder(answersByLane: Record<string, string>): {
  callable: ShowroomLaneCallable;
  calls: Array<{ role: string; model: string; prompt: string }>;
} {
  const calls: Array<{ role: string; model: string; prompt: string }> = [];
  return {
    calls,
    callable: async (input) => {
      calls.push({ role: input.role, model: input.model, prompt: input.prompt });
      // Lane label is encoded in the prompt header — pull it back out.
      const m = input.prompt.match(/the "(\w+)" lane/);
      const label = m?.[1] ?? input.role;
      return { text: answersByLane[label] ?? `${label}-out`, modelId: input.model };
    },
  };
}

describe('buildAllPrompts · 4 panes', () => {
  test('yesterday pane lists completed task titles', () => {
    const prompts = buildAllPrompts(makeDigest());
    expect(prompts.yesterday).toContain('PR review automation');
    expect(prompts.yesterday).toContain('SVG renderer build');
    expect(prompts.yesterday).toContain('Retrying overnight (1)');
  });

  test('today pane lists upcoming with slots', () => {
    const prompts = buildAllPrompts(makeDigest());
    expect(prompts.today).toContain('Excalidraw integration');
    expect(prompts.today).toContain('OKR snapshot');
    expect(prompts.today).toContain('Upcoming / scheduled (2)');
  });

  test('blockers pane shows HITL + failed sections', () => {
    const prompts = buildAllPrompts(makeDigest());
    expect(prompts.blockers).toContain('HITL pending (1)');
    expect(prompts.blockers).toContain('Failed runs (1)');
    expect(prompts.blockers).toContain('memory leak repro');
  });

  test('blockers pane falls back to "Nothing blocked" when both sections empty', () => {
    const digest = composeMorningDigest({
      date: '2026-05-12', windowStart: 's', windowEnd: 'e',
      runs: [{ taskId: 't-1', taskTitle: 'x', outcome: 'completed', startedAt: 0, endedAt: 100 }],
    });
    const prompts = buildAllPrompts({ digest });
    expect(prompts.blockers).toContain('Nothing blocked this morning.');
  });

  test('opportunities pane formats reason + estimate', () => {
    const prompts = buildAllPrompts(makeDigest());
    expect(prompts.opportunities).toContain('big-diff PR review hardening (~60m) — follow-up to yesterday');
    expect(prompts.opportunities).toContain('Mermaid bridge (~30m)');
  });

  test('opportunities pane falls back to "no recommendations" when empty', () => {
    const digest = composeMorningDigest({
      date: '2026-05-12', windowStart: 's', windowEnd: 'e', runs: [],
    });
    const prompts = buildAllPrompts({ digest });
    expect(prompts.opportunities).toContain('no recommendations surfaced');
  });
});

describe('runMorningShowroom · 4-lane spawn', () => {
  test('fires 4 lanes sequentially by default with default persona bindings', async () => {
    const lane = laneRecorder({
      yesterday: 'closed 2 tasks',
      today: 'start with Excalidraw',
      blockers: 'unstick memory leak first',
      opportunities: 'pick big-diff hardening',
    });
    const card = await runMorningShowroom(
      makeDigest(),
      { laneCallable: lane.callable, now: () => 5_000 },
    );
    expect(card.kind).toBe('morning-digest-showroom');
    expect(card.date).toBe('2026-05-12');
    expect(card.createdAt).toBe(5_000);
    expect(card.lanes.map((l) => l.lane)).toEqual([...MORNING_LANES]);
    expect(lane.calls.map((c) => c.role)).toEqual(['reflect', 'plan', 'review', 'build']);
    expect(lane.calls.map((c) => c.model)).toEqual(['claude-sonnet', 'gemini-flash', 'claude-sonnet', 'codex']);
  });

  test('parallel mode runs lanes concurrently and preserves output order', async () => {
    const order: string[] = [];
    const callable: ShowroomLaneCallable = async (input) => {
      const m = input.prompt.match(/the "(\w+)" lane/);
      const label = m?.[1] ?? 'unknown';
      // Yield once so concurrent tasks interleave.
      await Promise.resolve();
      order.push(label);
      return { text: label, modelId: input.model };
    };
    const card = await runMorningShowroom(makeDigest(), {
      laneCallable: callable,
      parallel: true,
    });
    expect(card.lanes.map((l) => l.lane)).toEqual([...MORNING_LANES]);
    expect(order.sort()).toEqual([...MORNING_LANES].sort());
  });

  test('persona binding override reaches lane calls', async () => {
    const lane = laneRecorder({});
    await runMorningShowroom(makeDigest(), {
      laneCallable: lane.callable,
      personaBinding: {
        bindings: {
          yesterday:     { role: 'review', model: 'override-y' },
          opportunities: { role: 'plan',   model: 'override-o' },
        },
      },
    });
    expect(lane.calls[0]!.role).toBe('review');
    expect(lane.calls[0]!.model).toBe('override-y');
    expect(lane.calls[3]!.role).toBe('plan');
    expect(lane.calls[3]!.model).toBe('override-o');
  });

  test('lane error degrades to [lane-error: ...] without aborting other lanes', async () => {
    let calls = 0;
    const callable: ShowroomLaneCallable = async (input) => {
      calls++;
      if (calls === 2) throw new Error('flash quota');
      return { text: 'ok', modelId: input.model };
    };
    const card = await runMorningShowroom(makeDigest(), { laneCallable: callable });
    expect(card.lanes.length).toBe(4);
    expect(card.lanes[1]!.text).toContain('[lane-error: flash quota]');
  });

  test('each lane output carries the prompt it ran against', async () => {
    const lane = laneRecorder({});
    const card = await runMorningShowroom(makeDigest(), { laneCallable: lane.callable });
    for (const out of card.lanes) {
      expect(out.prompt.length).toBeGreaterThan(0);
      expect(out.prompt).toContain(`the "${out.lane}" lane`);
    }
  });
});
