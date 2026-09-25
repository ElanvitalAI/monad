// AXON P4 — ACP ↔ HITL adapter tests.
//
// Inject synthetic ConfirmChannels into the adapter and assert the
// permission/question approver shapes match the AcpAgent contract.

import { describe, it, expect } from 'bun:test';
import {
  createAcpPermissionApproverFromHitl,
  createAcpQuestionApproverFromHitl,
} from '../../src/hitl/hitl-acp-adapter.js';
import type { ConfirmChannel, ConfirmRequest } from '../../src/hitl/confirm.js';
import type {
  AcpPermissionApprovalRequest,
  AcpQuestionRequest,
} from '../../src/acp/client.js';

function instantChannel(name: string, answer: boolean | null): ConfirmChannel {
  return {
    name,
    async request(_req: ConfirmRequest) { return answer; },
    cancel() { /* noop */ },
  };
}

function recordingChannel(name: string, answer: boolean | null) {
  const seen: ConfirmRequest[] = [];
  const ch: ConfirmChannel = {
    name,
    async request(req) { seen.push(req); return answer; },
    cancel() { /* noop */ },
  };
  return { channel: ch, seen };
}

const sampleApproval: AcpPermissionApprovalRequest = {
  backendId: 'claude',
  sessionId: 'sess-1',
  title: 'delete src/foo.ts',
  kind: 'fs.write',
  options: [
    { optionId: 'o1', kind: 'allow_once', name: 'Allow once' },
    { optionId: 'o2', kind: 'reject_once', name: 'Reject' },
  ],
};

const sampleQuestion: AcpQuestionRequest = {
  backendId: 'claude',
  sessionId: 'sess-2',
  questions: [
    {
      id: 'q1',
      header: 'Scope',
      question: 'Which scope should I rewrite?',
      options: [
        { label: 'src only', description: 'safer' },
        { label: 'src+tests', description: 'full' },
      ],
    },
  ],
};

describe('createAcpPermissionApproverFromHitl', () => {
  it('returns true when a channel answers true', async () => {
    const approve = createAcpPermissionApproverFromHitl({
      channels: [instantChannel('fake-yes', true)],
    });
    expect(await approve(sampleApproval)).toBe(true);
  });

  it('returns false when every channel answers false', async () => {
    const approve = createAcpPermissionApproverFromHitl({
      channels: [instantChannel('fake-no', false)],
    });
    expect(await approve(sampleApproval)).toBe(false);
  });

  it('returns false when channels opt out (null) and onTimeout defaults to false', async () => {
    const approve = createAcpPermissionApproverFromHitl({
      channels: [instantChannel('ghost', null)],
    });
    expect(await approve(sampleApproval)).toBe(false);
  });

  it('respects a custom onTimeout fallback', async () => {
    const approve = createAcpPermissionApproverFromHitl({
      channels: [instantChannel('ghost', null)],
      onTimeout: () => true,
    });
    expect(await approve(sampleApproval)).toBe(true);
  });

  it('respects delivery filter by channel name', async () => {
    // Only the delivery-matched channel should be consulted — the
    // rest drop out before the race.
    const mapMatch = recordingChannel('telegram', true);
    const mapMiss = recordingChannel('discord', false);
    const approve = createAcpPermissionApproverFromHitl({
      channels: [mapMatch.channel, mapMiss.channel],
      delivery: 'telegram',
    });
    expect(await approve(sampleApproval)).toBe(true);
    expect(mapMatch.seen).toHaveLength(1);
    expect(mapMiss.seen).toHaveLength(0);
  });

  it('carries permission request metadata into the confirm prompt', async () => {
    const rec = recordingChannel('fake', true);
    const approve = createAcpPermissionApproverFromHitl({
      channels: [rec.channel],
    });
    await approve(sampleApproval);
    const req = rec.seen[0]!;
    expect(req.prompt).toContain('claude');
    expect(req.prompt).toContain('delete src/foo.ts');
    expect(req.detail).toContain('sess-1');
    expect(req.detail).toContain('fs.write');
  });
});

describe('createAcpQuestionApproverFromHitl', () => {
  it('returns the first option when the user answers yes', async () => {
    const approve = createAcpQuestionApproverFromHitl({
      channels: [instantChannel('fake-yes', true)],
    });
    const out = await approve(sampleQuestion);
    expect(out.cancelled).toBeFalsy();
    expect(out.answers).toEqual({ q1: 'src only' });
  });

  it('returns cancelled when the user answers no', async () => {
    const approve = createAcpQuestionApproverFromHitl({
      channels: [instantChannel('fake-no', false)],
    });
    const out = await approve(sampleQuestion);
    expect(out.cancelled).toBe(true);
    expect(out.answers).toEqual({});
  });

  it('asks each question and aggregates answers', async () => {
    const rec = recordingChannel('fake-yes', true);
    const approve = createAcpQuestionApproverFromHitl({
      channels: [rec.channel],
    });
    const multi: AcpQuestionRequest = {
      ...sampleQuestion,
      questions: [
        sampleQuestion.questions[0]!,
        {
          id: 'q2',
          header: 'Tests',
          question: 'Keep test count?',
          options: [{ label: 'yes', description: '' }, { label: 'relax', description: '' }],
        },
      ],
    };
    const out = await approve(multi);
    expect(rec.seen).toHaveLength(2);
    expect(out.answers).toEqual({ q1: 'src only', q2: 'yes' });
  });

  it('short-circuits the remaining questions when one is cancelled', async () => {
    // First channel answers the first question with "yes", then a
    // different channel answers the second with "no" — second "no"
    // cancels the whole set, and the partial answer is discarded.
    const seq: (boolean | null)[] = [true, false];
    const stateful: ConfirmChannel = {
      name: 'sequential',
      async request() { return seq.shift() ?? null; },
      cancel() { /* noop */ },
    };
    const approve = createAcpQuestionApproverFromHitl({
      channels: [stateful],
    });
    const multi: AcpQuestionRequest = {
      ...sampleQuestion,
      questions: [
        sampleQuestion.questions[0]!,
        {
          id: 'q2',
          header: 'Tests',
          question: 'Keep test count?',
          options: [{ label: 'yes', description: '' }, { label: 'relax', description: '' }],
        },
      ],
    };
    const out = await approve(multi);
    expect(out.cancelled).toBe(true);
    expect(out.answers).toEqual({});
  });
});

// ─── Follow-up #9 · HITL direct-wire BG signal ──────────────────────

describe('HITL adapter · BG approval signal wiring', () => {
  // Import lazily inside the block so the base suite doesn't pull in
  // BackgroundManager (keeps the smaller tests cheap).
  const { createBackgroundManager } = require('../../src/acp/background-manager.js') as typeof import('../../src/acp/background-manager.js');

  function armBgRecord(
    mgr: ReturnType<typeof createBackgroundManager>,
    backendId: string,
    backendSessionId: string,
  ) {
    // Use a turn promise that never resolves so the record stays alive
    // during the approver call.
    const turnPromise = new Promise<{ stopReason: any }>(() => {});
    return mgr.start({
      clientSessionId: `acp-cli:${backendId}:${backendSessionId}`,
      backendSessionId,
      backendId,
      cwd: '/tmp',
      initialMessage: 'x',
      turnPromise,
      registerChunk: () => {},
      registerApprovalSignal: () => {},
    });
  }

  function slowChannel(answer: boolean | null, delayMs = 10): ConfirmChannel {
    return {
      name: 'slow',
      async request() {
        await new Promise(r => setTimeout(r, delayMs));
        return answer;
      },
      cancel() {},
    };
  }

  it('permission approver flips matching BG to waiting then back to running', async () => {
    const mgr = createBackgroundManager();
    const record = armBgRecord(mgr, 'claude', 'sess-1');
    expect(record.state).toBe('running');

    const transitions: string[] = [];
    mgr.onStateChange((r) => { transitions.push(r.state); });

    const approve = createAcpPermissionApproverFromHitl({
      channels: [slowChannel(true)],
      backgroundManager: mgr,
    });
    const pending = approve(sampleApproval);
    // Before awaiting, waiting signal should have fired synchronously.
    // Give the microtask a single tick so signal runs.
    await Promise.resolve();
    expect(record.state).toBe('waiting_for_confirmation');
    expect(await pending).toBe(true);
    expect(record.state).toBe('running');
    expect(transitions).toEqual(['waiting_for_confirmation', 'running']);
  });

  it('permission approver: resumed fires even when approver throws', async () => {
    const mgr = createBackgroundManager();
    const record = armBgRecord(mgr, 'claude', 'sess-1');
    const approve = createAcpPermissionApproverFromHitl({
      // No channels · requestConfirmation fails-closed to false · doesn't throw
      // so instead inject a channel that rejects.
      channels: [{
        name: 'boom',
        async request() { throw new Error('channel crashed'); },
        cancel() {},
      }],
      backgroundManager: mgr,
    });
    // approver returns `result.answer === true` · on internal failure
    // it still resolves (confirm.ts catches channel errors). So we
    // verify state was flipped + restored — not the exception path per se.
    await approve(sampleApproval);
    expect(record.state).toBe('running');
  });

  it('question approver keeps BG waiting across all questions in the set', async () => {
    const mgr = createBackgroundManager();
    const record = armBgRecord(mgr, 'claude', 'sess-2');
    // Slow channel so we can peek mid-flight.
    const approve = createAcpQuestionApproverFromHitl({
      channels: [slowChannel(true, 15)],
      backgroundManager: mgr,
    });
    const multi: AcpQuestionRequest = {
      ...sampleQuestion,
      questions: [
        sampleQuestion.questions[0]!,
        {
          id: 'q2',
          header: 'Tests',
          question: 'Keep tests?',
          options: [{ label: 'yes', description: '' }, { label: 'no', description: '' }],
        },
      ],
    };
    const pending = approve(multi);
    await Promise.resolve();
    expect(record.state).toBe('waiting_for_confirmation');
    await pending;
    expect(record.state).toBe('running');
  });

  it('no BG record for this (backendId, sessionId) → signals are no-op', async () => {
    const mgr = createBackgroundManager();
    // Intentionally NO armBgRecord call · any signal should silently miss.
    const approve = createAcpPermissionApproverFromHitl({
      channels: [slowChannel(true)],
      backgroundManager: mgr,
    });
    // Would throw if the signal path was fragile for unknown ids.
    const ok = await approve(sampleApproval);
    expect(ok).toBe(true);
    // No records exist — list stays empty.
    expect(mgr.list()).toEqual([]);
  });

  it('terminal BG record is not perturbed by signals', async () => {
    const mgr = createBackgroundManager();
    let resolveTurn!: (r: { stopReason: any }) => void;
    const turnPromise = new Promise<{ stopReason: any }>((res) => { resolveTurn = res; });
    const record = mgr.start({
      clientSessionId: 'acp-cli:claude:sess-1',
      backendSessionId: 'sess-1',
      backendId: 'claude',
      cwd: '/tmp',
      initialMessage: 'x',
      turnPromise,
      registerChunk: () => {},
      registerApprovalSignal: () => {},
    });
    resolveTurn({ stopReason: 'end_turn' });
    await Promise.resolve();
    await Promise.resolve();
    expect(record.state).toBe('completed');

    // After terminal, signals should be silent.
    mgr.signalApprovalWaiting('claude', 'sess-1');
    expect(record.state).toBe('completed');
    mgr.signalApprovalResumed('claude', 'sess-1');
    expect(record.state).toBe('completed');
  });

  it('backgroundManager opt omitted → adapter behaves unchanged', async () => {
    // No BG manager wired · no references to it; just make sure plain
    // adapter path still returns correct answer.
    const approve = createAcpPermissionApproverFromHitl({
      channels: [instantChannel('yes', true)],
    });
    expect(await approve(sampleApproval)).toBe(true);
  });

  it('signalApprovalResumed on running (never-waited) record is no-op', async () => {
    const mgr = createBackgroundManager();
    const record = armBgRecord(mgr, 'claude', 'sess-3');
    // Flip to waiting then back to running is the idiomatic path;
    // calling resumed while already running must NOT toggle the state.
    const transitions: string[] = [];
    mgr.onStateChange((r) => { transitions.push(r.state); });
    mgr.signalApprovalResumed('claude', 'sess-3');
    expect(record.state).toBe('running');
    expect(transitions).toEqual([]);
  });

  it('signalApprovalWaiting twice is idempotent · single transition', async () => {
    const mgr = createBackgroundManager();
    const record = armBgRecord(mgr, 'claude', 'sess-4');
    const transitions: string[] = [];
    mgr.onStateChange((r, prev) => { transitions.push(`${prev}→${r.state}`); });
    mgr.signalApprovalWaiting('claude', 'sess-4');
    mgr.signalApprovalWaiting('claude', 'sess-4');
    expect(record.state).toBe('waiting_for_confirmation');
    expect(transitions).toEqual(['running→waiting_for_confirmation']);
  });
});
