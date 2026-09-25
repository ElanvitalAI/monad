import { afterEach, describe, expect, test } from 'bun:test';

import {
  requestConfirmation,
  registerDefaultConfirmChannels,
  getDefaultConfirmChannels,
  createTerminalConfirmChannel,
  createPushcutConfirmChannel,
  createTelegramConfirmChannel,
  createDiscordConfirmChannel,
  FAIL_OPEN_TIMEOUT_MS,
  type ConfirmChannel,
} from '../src/hitl/confirm.js';
import type { PushcutClient } from '../src/pushcut/client.js';

afterEach(() => registerDefaultConfirmChannels([]));

function fakeChannel(
  name: string,
  behavior: 'yes' | 'no' | 'null' | 'throw' | 'delay-yes' | 'delay-no',
  delayMs = 0,
  onCancel?: () => void,
): ConfirmChannel {
  return {
    name,
    async request() {
      if (behavior === 'throw') throw new Error('x');
      if (behavior === 'null') return null;
      if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
      if (behavior === 'yes' || behavior === 'delay-yes') return true;
      return false;
    },
    cancel() { onCancel?.(); },
  };
}

describe('requestConfirmation', () => {
  test('빠른 응답 우선 + timeout 타이머 finally clear (P1 leak 봉합 회귀·큰 timeoutMs 여도 즉시 반환)', async () => {
    // 답이 즉시(0ms) 도착하는데 timeoutMs 는 매우 큼(60s). 타이머를 finally 에서 clear 하지 않으면
    // ref 된 setTimeout 이 이벤트루프를 붙잡아(P1 ROOT 2 증상) 이 스위트의 프로세스 종료가 지연된다.
    // 답이 timeout 보다 우선 반환되는지 + (스위트-레벨) 타이머 정리로 hang 없이 끝나는지 회귀 가드.
    const r = await requestConfirmation({
      prompt: '?',
      channels: [fakeChannel('quick', 'yes', 0)],
      timeoutMs: 60_000,
      onTimeout: () => false,
    });
    expect(r.channel).toBe('quick');
    expect(r.answer).toBe(true);
  });

  test('first channel to respond wins', async () => {
    const r = await requestConfirmation({
      prompt: 'OK?',
      channels: [
        fakeChannel('a', 'delay-yes', 50),
        fakeChannel('b', 'yes', 0),
      ],
    });
    expect(r.answer).toBe(true);
    expect(r.channel).toBe('b');
  });

  test('losers get cancel() called', async () => {
    const cancelled: string[] = [];
    const r = await requestConfirmation({
      prompt: '?',
      channels: [
        fakeChannel('fast', 'yes', 0),
        fakeChannel('slow', 'delay-yes', 200, () => cancelled.push('slow')),
      ],
    });
    expect(r.channel).toBe('fast');
    // Give the cancel pass a microtask tick.
    await new Promise(r => setTimeout(r, 5));
    expect(cancelled).toContain('slow');
  });

  test('throw channel drops out silently', async () => {
    const r = await requestConfirmation({
      prompt: '?',
      channels: [
        fakeChannel('bad', 'throw', 0),
        fakeChannel('good', 'no', 0),
      ],
    });
    expect(r.channel).toBe('good');
    expect(r.answer).toBe(false);
  });

  test('all null / all fail → all-failed with onTimeout answer', async () => {
    const r = await requestConfirmation({
      prompt: '?',
      channels: [
        fakeChannel('a', 'null', 0),
        fakeChannel('b', 'null', 0),
      ],
      onTimeout: () => false,
    });
    expect(r.channel).toBe('all-failed');
    expect(r.answer).toBe(false);
  });

  test('empty channels list → all-failed fallback', async () => {
    const r = await requestConfirmation({ prompt: '?', channels: [] });
    expect(r.channel).toBe('all-failed');
    expect(r.answer).toBe(false);
  });

  test('timeout fires when every channel stalls', async () => {
    const stall: ConfirmChannel = {
      name: 'stall',
      request: () => new Promise(() => {}),   // never resolves
      cancel: () => {},
    };
    const r = await requestConfirmation({
      prompt: '?', channels: [stall], timeoutMs: 30, onTimeout: () => true,
    });
    expect(r.channel).toBe('timeout');
    expect(r.answer).toBe(true);
  });

  test('registerDefaultConfirmChannels is applied when no channels passed', async () => {
    registerDefaultConfirmChannels([fakeChannel('default', 'yes', 0)]);
    const r = await requestConfirmation({ prompt: '?' });
    expect(r.channel).toBe('default');
    expect(getDefaultConfirmChannels().length).toBe(1);
  });
});

// L1 self-dev — fail-OPEN policy (opt-in). When a required approval has
// no responder in a headless autonomous coding context, proceed (true)
// instead of stalling then rejecting. Coding-tools-only by construction;
// the trade path never passes failOpen so money approvals stay closed.
describe('requestConfirmation · failOpen', () => {
  test('failOpen + empty channels → proceeds (answer true)', async () => {
    const r = await requestConfirmation({ prompt: '?', channels: [], failOpen: true });
    expect(r.channel).toBe('all-failed');
    expect(r.answer).toBe(true);   // fail-OPEN, not the default false
  });

  test('failOpen + all channels opt out → proceeds (answer true)', async () => {
    const r = await requestConfirmation({
      prompt: '?',
      channels: [fakeChannel('a', 'null', 0), fakeChannel('b', 'null', 0)],
      failOpen: true,
    });
    expect(r.channel).toBe('all-failed');
    expect(r.answer).toBe(true);
  });

  test('failOpen + stalling channel → timeout proceeds (answer true)', async () => {
    const stall: ConfirmChannel = {
      name: 'stall',
      request: () => new Promise(() => {}),   // never resolves
      cancel: () => {},
    };
    const r = await requestConfirmation({
      prompt: '?', channels: [stall], timeoutMs: 30, failOpen: true,
    });
    expect(r.channel).toBe('timeout');
    expect(r.answer).toBe(true);
  });

  test('regression — WITHOUT failOpen, no responder still rejects (fail-closed)', async () => {
    // Trade/financial HITL relies on this default: an unanswered prompt
    // must NOT auto-approve.
    const r = await requestConfirmation({
      prompt: '?',
      channels: [fakeChannel('a', 'null', 0)],
    });
    expect(r.channel).toBe('all-failed');
    expect(r.answer).toBe(false);
  });

  test('explicit onTimeout wins over failOpen', async () => {
    const r = await requestConfirmation({
      prompt: '?', channels: [], failOpen: true, onTimeout: () => false,
    });
    expect(r.answer).toBe(false);   // explicit onTimeout takes precedence
  });

  test('failOpen shortens the default timeout', () => {
    // Guards the constant used when failOpen is set without an explicit
    // timeoutMs — must be well under the 120s default so the autonomous
    // loop proceeds fast.
    expect(FAIL_OPEN_TIMEOUT_MS).toBeLessThan(120_000);
    expect(FAIL_OPEN_TIMEOUT_MS).toBeGreaterThan(0);
  });
});

describe('terminal channel', () => {
  test('show + awaitAnswer + clear', async () => {
    let shown = false, cleared = false;
    const ch = createTerminalConfirmChannel({
      show: () => { shown = true; },
      clear: () => { cleared = true; },
      awaitAnswer: async () => true,
    });
    const r = await ch.request({ prompt: 'OK?' });
    expect(r).toBe(true);
    expect(shown).toBe(true);
    expect(cleared).toBe(true);
  });
});

describe('pushcut channel', () => {
  test('returns null when client not configured', async () => {
    const fakeClient = { configured: false, notify: async () => ({ ok: false }), execute: async () => ({ ok: false }) } as unknown as PushcutClient;
    const ch = createPushcutConfirmChannel({ client: fakeClient, notificationName: 'confirm' });
    expect(await ch.request({ prompt: 'x' })).toBeNull();
  });

  test('fires notification but returns null without awaitCallback', async () => {
    const sent: Array<{ name: string; body: unknown }> = [];
    const fakeClient = {
      configured: true,
      notify: async (name: string, body: unknown) => { sent.push({ name, body }); return { ok: true }; },
      execute: async () => ({ ok: true }),
    } as unknown as PushcutClient;
    const ch = createPushcutConfirmChannel({ client: fakeClient, notificationName: 'confirm' });
    const r = await ch.request({ prompt: 'Approve?', yesLabel: '✅', noLabel: '❌' });
    expect(r).toBeNull();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.name).toBe('confirm');
  });

  test('with awaitCallback resolves to its answer', async () => {
    const fakeClient = {
      configured: true,
      notify: async () => ({ ok: true }),
      execute: async () => ({ ok: true }),
    } as unknown as PushcutClient;
    const ch = createPushcutConfirmChannel({
      client: fakeClient,
      notificationName: 'confirm',
      awaitCallback: async () => true,
    });
    expect(await ch.request({ prompt: '?', requestId: 'R1' })).toBe(true);
  });

  // β-1 dismiss polish (2026-05-08) — sibling-channel-wins UX.
  describe('cancel() · sibling channel won the race', () => {
    test('default → fires a follow-up "cancelled" notification', async () => {
      const sent: Array<{ name: string; body: unknown }> = [];
      const fakeClient = {
        configured: true,
        notify: async (name: string, body: unknown) => { sent.push({ name, body }); return { ok: true }; },
        execute: async () => ({ ok: true }),
      } as unknown as PushcutClient;
      const ch = createPushcutConfirmChannel({ client: fakeClient, notificationName: 'confirm' });
      await ch.request({ prompt: 'Approve?', requestId: 'R-cancel-1' });
      expect(sent).toHaveLength(1);
      await ch.cancel();
      expect(sent).toHaveLength(2);
      const followup = sent[1]!.body as { title: string; text?: string };
      expect(followup.title).toBe('✗ cancelled by other device');
      expect(followup.text).toContain('R-cancel-1');
    });

    test('cancelNotificationTitle=null → silent (legacy behavior)', async () => {
      const sent: Array<{ name: string; body: unknown }> = [];
      const fakeClient = {
        configured: true,
        notify: async (name: string, body: unknown) => { sent.push({ name, body }); return { ok: true }; },
        execute: async () => ({ ok: true }),
      } as unknown as PushcutClient;
      const ch = createPushcutConfirmChannel({
        client: fakeClient,
        notificationName: 'confirm',
        cancelNotificationTitle: null,
      });
      await ch.request({ prompt: 'Approve?', requestId: 'R-cancel-2' });
      await ch.cancel();
      expect(sent).toHaveLength(1);  // only the original notification
    });

    test('custom cancelNotificationTitle is forwarded', async () => {
      const sent: Array<{ name: string; body: unknown }> = [];
      const fakeClient = {
        configured: true,
        notify: async (name: string, body: unknown) => { sent.push({ name, body }); return { ok: true }; },
        execute: async () => ({ ok: true }),
      } as unknown as PushcutClient;
      const ch = createPushcutConfirmChannel({
        client: fakeClient,
        notificationName: 'confirm',
        cancelNotificationTitle: 'PWA answered first ✓',
      });
      await ch.request({ prompt: 'Approve?', requestId: 'R-custom' });
      await ch.cancel();
      const body = sent[1]!.body as { title: string };
      expect(body.title).toBe('PWA answered first ✓');
    });

    test('cancel before request is a no-op (no requestId)', async () => {
      const sent: Array<unknown> = [];
      const fakeClient = {
        configured: true,
        notify: async (_n: string, b: unknown) => { sent.push(b); return { ok: true }; },
        execute: async () => ({ ok: true }),
      } as unknown as PushcutClient;
      const ch = createPushcutConfirmChannel({ client: fakeClient, notificationName: 'confirm' });
      await ch.cancel();
      expect(sent).toHaveLength(0);
    });

    test('cancel skipped when client not configured', async () => {
      const sent: Array<unknown> = [];
      const fakeClient = {
        configured: false,
        notify: async (_n: string, b: unknown) => { sent.push(b); return { ok: true }; },
        execute: async () => ({ ok: true }),
      } as unknown as PushcutClient;
      const ch = createPushcutConfirmChannel({ client: fakeClient, notificationName: 'confirm' });
      // request returned null because not configured; cancel still runs
      await ch.request({ prompt: 'x', requestId: 'R-no-config' });
      await ch.cancel();
      expect(sent).toHaveLength(0);
    });

    // Resolution-aware cancel (2026-05-14) — when the race wrapper
    // forwards the winning channel + answer, the follow-up notification
    // surfaces the actual outcome instead of a generic cancel marker,
    // and drops the Pushcut Notification template's default Yes/No
    // actions so a tap on the second notification doesn't re-trigger
    // the iOS Shortcut (which would POST to /v1/hitl/callback/ with an
    // empty input and hit a daemon 404).
    test('resolution.answer=true → "✅ Approved via <winner>" title', async () => {
      const sent: Array<{ body: { title: string; actions?: unknown[] } }> = [];
      const fakeClient = {
        configured: true,
        notify: async (_n: string, b: unknown) => {
          sent.push({ body: b as { title: string; actions?: unknown[] } });
          return { ok: true };
        },
        execute: async () => ({ ok: true }),
      } as unknown as PushcutClient;
      const ch = createPushcutConfirmChannel({ client: fakeClient, notificationName: 'confirm' });
      await ch.request({ prompt: 'Approve?', requestId: 'R-res-yes' });
      await ch.cancel({ winnerChannel: 'pwa', answer: true });
      expect(sent).toHaveLength(2);
      expect(sent[1]!.body.title).toBe('✅ Approved via pwa');
      expect(sent[1]!.body.actions).toEqual([]);
    });

    test('resolution.answer=false → "❌ Rejected via <winner>" title', async () => {
      const sent: Array<{ body: { title: string; actions?: unknown[] } }> = [];
      const fakeClient = {
        configured: true,
        notify: async (_n: string, b: unknown) => {
          sent.push({ body: b as { title: string; actions?: unknown[] } });
          return { ok: true };
        },
        execute: async () => ({ ok: true }),
      } as unknown as PushcutClient;
      const ch = createPushcutConfirmChannel({ client: fakeClient, notificationName: 'confirm' });
      await ch.request({ prompt: 'Approve?', requestId: 'R-res-no' });
      await ch.cancel({ winnerChannel: 'discord', answer: false });
      expect(sent).toHaveLength(2);
      expect(sent[1]!.body.title).toBe('❌ Rejected via discord');
      expect(sent[1]!.body.actions).toEqual([]);
    });

    test('default cancel() (no resolution) also overrides actions: []', async () => {
      // Even legacy call sites (ad-hoc cancel without race context)
      // benefit: the follow-up is informational only · template's
      // Yes/No buttons should not render on the second notification.
      const sent: Array<{ body: { actions?: unknown[] } }> = [];
      const fakeClient = {
        configured: true,
        notify: async (_n: string, b: unknown) => {
          sent.push({ body: b as { actions?: unknown[] } });
          return { ok: true };
        },
        execute: async () => ({ ok: true }),
      } as unknown as PushcutClient;
      const ch = createPushcutConfirmChannel({ client: fakeClient, notificationName: 'confirm' });
      await ch.request({ prompt: 'Approve?', requestId: 'R-noarg' });
      await ch.cancel();
      expect(sent[1]!.body.actions).toEqual([]);
    });
  });
});

// Race-level — winner does NOT receive cancel(); losers do, with
// the resolution context attached so the channel implementation can
// render a status-aware follow-up.
describe('requestConfirmation · resolution-aware cancel', () => {
  test('winning channel is skipped in cancel pass', async () => {
    const cancelled: string[] = [];
    const winner: ConfirmChannel = {
      name: 'pushcut',
      async request() { return true; },
      cancel() { cancelled.push('pushcut'); },
    };
    const loser: ConfirmChannel = {
      name: 'discord',
      async request() { await new Promise(r => setTimeout(r, 200)); return true; },
      cancel() { cancelled.push('discord'); },
    };
    const r = await requestConfirmation({ prompt: '?', channels: [winner, loser] });
    expect(r.channel).toBe('pushcut');
    await new Promise(r => setTimeout(r, 5));
    expect(cancelled).not.toContain('pushcut');  // winner skipped
    expect(cancelled).toContain('discord');      // loser cancelled
  });

  test('losers receive cancel() with { winnerChannel, answer }', async () => {
    let loserResolution: unknown = 'unset';
    const winner: ConfirmChannel = {
      name: 'pushcut',
      async request() { return false; },
      cancel() { /* will be skipped */ },
    };
    const loser: ConfirmChannel = {
      name: 'discord',
      async request() { await new Promise(r => setTimeout(r, 200)); return true; },
      cancel(resolution) { loserResolution = resolution; },
    };
    await requestConfirmation({ prompt: '?', channels: [winner, loser] });
    await new Promise(r => setTimeout(r, 5));
    expect(loserResolution).toEqual({ winnerChannel: 'pushcut', answer: false });
  });

  test('timeout / all-failed → losers cancel() WITHOUT resolution', async () => {
    let receivedArg: unknown = 'unset';
    const ch: ConfirmChannel = {
      name: 'silent',
      async request() { return null; },
      cancel(resolution) { receivedArg = resolution; },
    };
    await requestConfirmation({
      prompt: '?',
      channels: [ch],
      timeoutMs: 30,
      onTimeout: () => false,
    });
    await new Promise(r => setTimeout(r, 5));
    expect(receivedArg).toBeUndefined();
  });
});

describe('telegram channel + race integration', () => {
  test('races terminal + telegram; first non-null wins', async () => {
    const tgHandle = {
      answer: (async () => { await new Promise(r => setTimeout(r, 60)); return true; })(),
      cancel: () => {},
    };
    const telegram = createTelegramConfirmChannel({
      post: async () => tgHandle,
    });
    const terminal = createTerminalConfirmChannel({
      show: () => {}, clear: () => {},
      awaitAnswer: async () => { await new Promise(r => setTimeout(r, 10)); return false; },
    });
    const r = await requestConfirmation({ prompt: '?', channels: [telegram, terminal] });
    expect(r.channel).toBe('terminal');
    expect(r.answer).toBe(false);
  });

  test('telegram post throws → channel drops out', async () => {
    const telegram = createTelegramConfirmChannel({
      post: async () => { throw new Error('network'); },
    });
    const r = await requestConfirmation({
      prompt: '?',
      channels: [telegram, createTerminalConfirmChannel({
        show: () => {}, clear: () => {}, awaitAnswer: async () => true,
      })],
    });
    expect(r.channel).toBe('terminal');
  });
});

describe('discord channel', () => {
  test('mirrors telegram contract', async () => {
    const ch = createDiscordConfirmChannel({
      post: async () => ({
        answer: Promise.resolve(true),
        cancel: () => {},
      }),
    });
    expect(await ch.request({ prompt: '?' })).toBe(true);
  });
});
