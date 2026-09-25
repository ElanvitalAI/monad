// Phase 1 I0 — intake-plane ↔ TOX wire smoke.
//
// Goal: pin the contract that an intake session (TOX proposal draft)
// flowing through `proposeIntakeSessionToTox` + `applyIntakeProposalToTox`
// actually lands real Task rows in the TaskGraph. The LLM call is
// stubbed via the `decompose` injection slot of `wireToxForDashboard`,
// so this test stays hermetic.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { wireToxForDashboard, type ToxBootHandle } from '../../src/task-orchestrator/boot.ts';
import { resetToxRuntimeDepsForTest } from '../../src/task-orchestrator/runtime-deps.ts';
import {
  applyIntakeProposalToTox,
  buildToxProposalDraftFromSession,
  proposeIntakeSessionToTox,
} from '../../src/intake-plane/tox-adapter.ts';
import type { IntakeSession } from '../../src/intake-plane/types.ts';

const PROPOSAL_JSON = JSON.stringify({
  rationale: 'Two-step plan: research the topic, then write a memo.',
  tasks: [
    {
      index: 0,
      title: 'Skim 3 references on topic',
      description: 'Quick literature pass to anchor the memo.',
      surface: { kind: 'llm-direct', prompt: 'Skim references on topic X' },
    },
    {
      index: 1,
      title: 'Draft a 1-page memo',
      description: 'Synthesize findings into a short memo.',
      surface: { kind: 'llm-direct', prompt: 'Draft a 1-page memo on topic X' },
      dependsOn: [0],
    },
  ],
});

function makeSession(intakeId: string, rawText: string): IntakeSession {
  return {
    intakeId,
    raw: {
      intakeId,
      source: 'tui-scratch',
      rawText,
      attachments: [],
      receivedAt: '2026-05-12T08:00:00.000Z',
    },
    state: 'review-ready',
    createdAt: '2026-05-12T08:00:00.000Z',
    updatedAt: '2026-05-12T08:00:00.000Z',
    draft: {
      intakeId,
      title: 'Research + memo bundle',
      summary: 'User wants a quick lit pass + a 1-page write-up.',
      items: [
        {
          id: 'item-1',
          kind: 'research',
          text: rawText,
          links: [],
          needsClarification: false,
          proposedAction: 'task-create',
        },
      ],
      openQuestions: [],
      suggestedMode: 'task-creation',
      confidence: 0.9,
    },
  };
}

let handle: ToxBootHandle | undefined;

beforeEach(() => {
  resetToxRuntimeDepsForTest();
  handle = wireToxForDashboard({
    decompose: async () => ({ text: PROPOSAL_JSON, costUsd: 0, tokenUsage: { input: 10, output: 20 } }),
    startFeedbackLoop: false,
    startRetryPolicy: false,
  });
});

afterEach(() => {
  handle?.dispose();
  handle = undefined;
  resetToxRuntimeDepsForTest();
});

describe('intake-plane ↔ TOX wire (Phase 1 I0)', () => {
  test('proposal draft preserves the session intake id + raw text', () => {
    const session = makeSession('intake-wire-1', 'Research X then write memo');
    const draft = buildToxProposalDraftFromSession(session);
    expect(draft.intakeId).toBe('intake-wire-1');
    expect(draft.objective).toContain('Title: Research + memo bundle');
    expect(draft.objective).toContain('Items:');
    expect(draft.contextNotes.some((line) => line.startsWith('source='))).toBe(true);
  });

  test('propose → apply flow lands tasks into the TaskGraph', async () => {
    const session = makeSession('intake-wire-2', 'Research X then write memo');
    const proposed = await proposeIntakeSessionToTox(session);
    expect(proposed.applyToken).toBeTruthy();
    expect(proposed.output).toContain('TaskDecompose');
    expect(handle!.graph.listAll().length).toBe(0);

    const applied = await applyIntakeProposalToTox(proposed.applyToken!, true);
    expect(applied.taskIds).toBeDefined();
    expect(applied.taskIds!.length).toBe(2);
    const tasks = handle!.graph.listAll();
    expect(tasks.length).toBe(2);
    expect(tasks.map((t) => t.title)).toContain('Skim 3 references on topic');
    expect(tasks.map((t) => t.title)).toContain('Draft a 1-page memo');
  });

  test('apply with an unknown token returns a not-found message', async () => {
    const res = await applyIntakeProposalToTox('tx-doesnotexist', true);
    expect(res.output).toContain("not found or expired");
    expect(res.taskIds).toBeUndefined();
  });
});
