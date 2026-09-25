// ── M1 (Phase 2 Bundle 4 hero) — m1-handoff-orchestrator tests ──

import { describe, expect, test } from 'bun:test';
import {
  createM1HandoffOrchestrator,
  type M1ChannelAddress,
  type M1Session,
} from '../../src/voice/m1-handoff-orchestrator';
import type {
  VoiceOrchestrator,
  VoiceOrchestrationResult,
} from '../../src/voice/voice-orchestrator';

function fakeVoiceOrchestrator(
  result: VoiceOrchestrationResult,
): VoiceOrchestrator {
  return {
    run: async () => result,
  };
}

interface FakeStore {
  store: Map<string, M1Session>;
  create(s: M1Session): Promise<void>;
  update(id: string, patch: Partial<M1Session>): Promise<void>;
  get(id: string): Promise<M1Session | null>;
  list(): Promise<readonly M1Session[]>;
}

function fakeStore(): FakeStore {
  const store = new Map<string, M1Session>();
  return {
    store,
    create: async (s) => { store.set(s.id, s); },
    update: async (id, patch) => {
      const cur = store.get(id);
      if (cur) store.set(id, { ...cur, ...patch });
    },
    get: async (id) => store.get(id) ?? null,
    list: async () => Array.from(store.values()),
  };
}

const TG: M1ChannelAddress = { kind: 'telegram', id: 'chat-123' };
const TUI: M1ChannelAddress = { kind: 'tui', id: 'tui-1' };

describe('createM1HandoffOrchestrator — start', () => {
  test('happy path: V2 spoken → session updated with subagentId + outcome', async () => {
    const store = fakeStore();
    const spoken: Array<{ ch: M1ChannelAddress; s: string }> = [];
    const m1 = createM1HandoffOrchestrator({
      voiceOrchestrator: fakeVoiceOrchestrator({
        outcome: 'spoken',
        subagentId: 'sa-7',
        utterance: 'coding 작업 완료했습니다. PR opened',
        goal: { kind: 'coding', transcript: 't' },
        subagentSummary: 'PR opened',
      }),
      sessionStore: store,
      channelSpeak: async (ch, s) => { spoken.push({ ch, s }); },
      newSessionId: () => 'sess-1',
      now: () => '2026-05-02T00:00:00.000Z',
    });
    const out = await m1.start({ transcript: 'fix the build', originChannel: TG });
    expect(out.id).toBe('sess-1');
    expect(out.subagentId).toBe('sa-7');
    expect(out.finalOutcome).toBe('spoken');
    expect(out.originChannel).toEqual(TG);
    expect(out.activeChannel).toEqual(TG);
    // No handoff happened, so M1 doesn't double-speak.
    expect(spoken).toHaveLength(0);
  });

  test('failure outcome propagates to session', async () => {
    const m1 = createM1HandoffOrchestrator({
      voiceOrchestrator: fakeVoiceOrchestrator({
        outcome: 'subagent-failed',
        subagentId: 'sa-1',
        utterance: 'failed',
        subagentSummary: 'merge conflict',
      }),
      sessionStore: fakeStore(),
      channelSpeak: async () => {},
      newSessionId: () => 's1',
    });
    const out = await m1.start({ transcript: 't', originChannel: TG });
    expect(out.finalOutcome).toBe('subagent-failed');
    expect(out.subagentId).toBe('sa-1');
  });

  test('classify-failed → finalOutcome propagated, subagentId null', async () => {
    const m1 = createM1HandoffOrchestrator({
      voiceOrchestrator: fakeVoiceOrchestrator({
        outcome: 'classify-failed',
        utterance: 'no idea',
      }),
      sessionStore: fakeStore(),
      channelSpeak: async () => {},
      newSessionId: () => 's1',
    });
    const out = await m1.start({ transcript: 't', originChannel: TG });
    expect(out.finalOutcome).toBe('classify-failed');
    expect(out.subagentId).toBeNull();
  });
});

describe('createM1HandoffOrchestrator — channel handoff', () => {
  test('migrateChannel mid-flight shifts activeChannel', async () => {
    const store = fakeStore();
    let resolveV2: (() => void) | null = null;
    const v2Promise = new Promise<VoiceOrchestrationResult>((resolve) => {
      resolveV2 = () => resolve({
        outcome: 'spoken',
        subagentId: 'sa-1',
        utterance: 'done',
      });
    });

    const m1 = createM1HandoffOrchestrator({
      voiceOrchestrator: { run: () => v2Promise },
      sessionStore: store,
      channelSpeak: async () => {},
      newSessionId: () => 's1',
    });

    // Start — does not await, runs concurrently.
    const startPromise = m1.start({ transcript: 't', originChannel: TG });

    // Migrate before V2 resolves.
    await new Promise((r) => setTimeout(r, 5));
    const migrated = await m1.migrateChannel('s1', TUI);
    expect(migrated).toBe(true);

    resolveV2!();
    const out = await startPromise;
    expect(out.activeChannel).toEqual(TUI);
  });

  test('on handoff, M1 double-speaks final utterance to new channel', async () => {
    const store = fakeStore();
    let resolveV2: (() => void) | null = null;
    const v2Promise = new Promise<VoiceOrchestrationResult>((resolve) => {
      resolveV2 = () => resolve({
        outcome: 'spoken',
        subagentId: 'sa-1',
        utterance: 'final summary',
      });
    });
    const spoken: Array<{ ch: M1ChannelAddress; s: string }> = [];
    const m1 = createM1HandoffOrchestrator({
      voiceOrchestrator: { run: () => v2Promise },
      sessionStore: store,
      channelSpeak: async (ch, s) => { spoken.push({ ch, s }); },
      newSessionId: () => 's1',
    });

    const startP = m1.start({ transcript: 't', originChannel: TG });
    await new Promise((r) => setTimeout(r, 5));
    await m1.migrateChannel('s1', TUI);
    resolveV2!();
    await startP;

    expect(spoken).toHaveLength(1);
    expect(spoken[0]!.ch).toEqual(TUI);
    expect(spoken[0]!.s).toBe('final summary');
  });

  test('migrate non-existent session → false', async () => {
    const m1 = createM1HandoffOrchestrator({
      voiceOrchestrator: fakeVoiceOrchestrator({ outcome: 'spoken' }),
      sessionStore: fakeStore(),
      channelSpeak: async () => {},
    });
    expect(await m1.migrateChannel('gone', TUI)).toBe(false);
  });

  test('migrate completed session → false (already done)', async () => {
    const m1 = createM1HandoffOrchestrator({
      voiceOrchestrator: fakeVoiceOrchestrator({
        outcome: 'spoken',
        subagentId: 'sa-1',
        utterance: 'done',
      }),
      sessionStore: fakeStore(),
      channelSpeak: async () => {},
      newSessionId: () => 's1',
    });
    await m1.start({ transcript: 't', originChannel: TG });
    expect(await m1.migrateChannel('s1', TUI)).toBe(false);
  });
});

describe('createM1HandoffOrchestrator — ETA scheduler', () => {
  test('etaIntervalMs schedules + cancels on completion', async () => {
    let etaCalls = 0;
    let scheduledCancel = false;
    let firedCancel: (() => void) | null = null;

    const m1 = createM1HandoffOrchestrator({
      voiceOrchestrator: fakeVoiceOrchestrator({
        outcome: 'spoken',
        subagentId: 'sa-1',
        utterance: 'done',
      }),
      sessionStore: fakeStore(),
      channelSpeak: async () => { etaCalls += 1; },
      scheduleEta: (_id, _interval, fire) => {
        // Fire once for test verification.
        void fire();
        return () => { scheduledCancel = true; firedCancel = () => {}; };
      },
      newSessionId: () => 's1',
    });

    await m1.start({ transcript: 't', originChannel: TG, etaIntervalMs: 1000 });
    expect(etaCalls).toBeGreaterThan(0);
    expect(scheduledCancel).toBe(true);
    expect(firedCancel).not.toBeNull();
  });

  test('no etaIntervalMs → no scheduler call', async () => {
    let scheduled = false;
    const m1 = createM1HandoffOrchestrator({
      voiceOrchestrator: fakeVoiceOrchestrator({ outcome: 'spoken', utterance: 'd' }),
      sessionStore: fakeStore(),
      channelSpeak: async () => {},
      scheduleEta: () => { scheduled = true; return () => {}; },
      newSessionId: () => 's1',
    });
    await m1.start({ transcript: 't', originChannel: TG });
    expect(scheduled).toBe(false);
  });
});

describe('createM1HandoffOrchestrator — diagnostics', () => {
  test('list reflects sessions', async () => {
    const m1 = createM1HandoffOrchestrator({
      voiceOrchestrator: fakeVoiceOrchestrator({ outcome: 'spoken', utterance: 'd' }),
      sessionStore: fakeStore(),
      channelSpeak: async () => {},
      newSessionId: (() => {
        let n = 0;
        return () => `s-${++n}`;
      })(),
    });
    await m1.start({ transcript: 'a', originChannel: TG });
    await m1.start({ transcript: 'b', originChannel: TUI });
    const all = await m1.list();
    expect(all).toHaveLength(2);
  });

  test('get returns session by id', async () => {
    const m1 = createM1HandoffOrchestrator({
      voiceOrchestrator: fakeVoiceOrchestrator({ outcome: 'spoken', utterance: 'd' }),
      sessionStore: fakeStore(),
      channelSpeak: async () => {},
      newSessionId: () => 's1',
    });
    await m1.start({ transcript: 't', originChannel: TG });
    const s = await m1.get('s1');
    expect(s?.id).toBe('s1');
    expect(await m1.get('nope')).toBeNull();
  });

  test('newSessionId default falls back to crypto-or-random', async () => {
    const m1 = createM1HandoffOrchestrator({
      voiceOrchestrator: fakeVoiceOrchestrator({ outcome: 'spoken', utterance: 'd' }),
      sessionStore: fakeStore(),
      channelSpeak: async () => {},
    });
    const out = await m1.start({ transcript: 't', originChannel: TG });
    expect(out.id).toBeTruthy();
    expect(out.id.length).toBeGreaterThan(0);
  });
});
