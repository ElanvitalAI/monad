// Service Worker Phase 3 — agent-turn-end push trigger tests.

import { afterEach, beforeEach, describe, expect, test, spyOn } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { notifyAgentTurnEnd } from '../src/web-push/notify-turn-end';
import * as senderModule from '../src/web-push/sender';
import {
  addSubscription,
  _setPushSubsPathForTest,
} from '../src/web-push/subscriptions';

const SAMPLE_SUB = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/X',
  keys: { p256dh: 'pub', auth: 'auth' },
};

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'notify-turn-end-'));
  _setPushSubsPathForTest(join(tmpDir, 'push-subs.json'));
});

afterEach(() => {
  _setPushSubsPathForTest(null);
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('notifyAgentTurnEnd', () => {
  test('no-op when zero subscribers — sendPushToAll never called', async () => {
    const spy = spyOn(senderModule, 'sendPushToAll').mockResolvedValue({
      attempted: 0, delivered: 0, removed: 0, errors: [],
    });
    await notifyAgentTurnEnd({ sessionId: 's1', finalText: 'done' });
    expect(spy).not.toHaveBeenCalled();
  });

  test('skips when stopReason is aborted', async () => {
    addSubscription({ subscription: SAMPLE_SUB });
    const spy = spyOn(senderModule, 'sendPushToAll').mockResolvedValue({
      attempted: 1, delivered: 1, removed: 0, errors: [],
    });
    await notifyAgentTurnEnd({
      sessionId: 's1',
      finalText: 'partial output',
      stopReason: 'aborted',
    });
    expect(spy).not.toHaveBeenCalled();
  });

  test('skips when finalText is empty / whitespace', async () => {
    addSubscription({ subscription: SAMPLE_SUB });
    const spy = spyOn(senderModule, 'sendPushToAll').mockResolvedValue({
      attempted: 1, delivered: 1, removed: 0, errors: [],
    });
    await notifyAgentTurnEnd({ sessionId: 's1', finalText: '   \n  ' });
    expect(spy).not.toHaveBeenCalled();
  });

  test('composes payload with sessionId-tagged URL + truncated body', async () => {
    addSubscription({ subscription: SAMPLE_SUB });
    let captured: { title: string; body?: string; url?: string; tag?: string; data?: Record<string, unknown> } | null = null;
    spyOn(senderModule, 'sendPushToAll').mockImplementation(async (payload) => {
      captured = payload;
      return { attempted: 1, delivered: 1, removed: 0, errors: [] };
    });
    const longText = 'A'.repeat(300);
    await notifyAgentTurnEnd({ sessionId: 'sess-42', finalText: longText, stopReason: 'end_turn' });
    expect(captured).not.toBeNull();
    expect(captured!.title).toBe('elanous — agent done');
    expect(captured!.body).toBeDefined();
    expect(captured!.body!.length).toBeLessThanOrEqual(140);
    expect(captured!.body!.endsWith('…')).toBe(true);
    expect(captured!.url).toBe('/app/?session=sess-42');
    expect(captured!.tag).toBe('agent-turn-sess-42');
    expect(captured!.data).toEqual({ kind: 'agent-turn-end', sessionId: 'sess-42' });
  });

  test('encodes sessionId in URL (handles special chars)', async () => {
    addSubscription({ subscription: SAMPLE_SUB });
    let captured: { url?: string } | null = null;
    spyOn(senderModule, 'sendPushToAll').mockImplementation(async (payload) => {
      captured = payload;
      return { attempted: 1, delivered: 1, removed: 0, errors: [] };
    });
    await notifyAgentTurnEnd({ sessionId: 'sess/with space', finalText: 'ok' });
    expect(captured!.url).toBe('/app/?session=sess%2Fwith%20space');
  });

  test('swallows sendPushToAll errors — never throws', async () => {
    addSubscription({ subscription: SAMPLE_SUB });
    spyOn(senderModule, 'sendPushToAll').mockImplementation(async () => {
      throw new Error('VAPID key missing');
    });
    // Must not throw — caller is fire-and-forget.
    let threw = false;
    try {
      await notifyAgentTurnEnd({ sessionId: 's1', finalText: 'ok' });
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });

  test('passes through short text unchanged (no ellipsis)', async () => {
    addSubscription({ subscription: SAMPLE_SUB });
    let captured: { body?: string } | null = null;
    spyOn(senderModule, 'sendPushToAll').mockImplementation(async (payload) => {
      captured = payload;
      return { attempted: 1, delivered: 1, removed: 0, errors: [] };
    });
    await notifyAgentTurnEnd({ sessionId: 's1', finalText: 'short reply' });
    expect(captured!.body).toBe('short reply');
  });

  test('collapses internal whitespace into single spaces in body', async () => {
    addSubscription({ subscription: SAMPLE_SUB });
    let captured: { body?: string } | null = null;
    spyOn(senderModule, 'sendPushToAll').mockImplementation(async (payload) => {
      captured = payload;
      return { attempted: 1, delivered: 1, removed: 0, errors: [] };
    });
    await notifyAgentTurnEnd({
      sessionId: 's1',
      finalText: 'line one\n\n  line\ttwo',
    });
    expect(captured!.body).toBe('line one line two');
  });

  // R3 (BACKLOG-pwa-mobile-readiness #5 · 2026-05-09) —
  test('payload includes 5 inline action buttons (intent-0..intent-N)', async () => {
    addSubscription({ subscription: SAMPLE_SUB });
    let captured: { actions?: Array<{ action: string; title: string }> } | null = null;
    spyOn(senderModule, 'sendPushToAll').mockImplementation(async (payload) => {
      captured = payload;
      return { attempted: 1, delivered: 1, removed: 0, errors: [] };
    });
    await notifyAgentTurnEnd({ sessionId: 's1', finalText: 'done' });
    expect(captured!.actions).toBeDefined();
    expect(captured!.actions!.length).toBeGreaterThan(0);
    // Action ids follow `intent-<idx>` shape so the SW can resolve
    // them back via `INTENT_BUTTON_LABELS[idx]`.
    for (const a of captured!.actions!) {
      expect(a.action).toMatch(/^intent-\d+$/);
      expect(typeof a.title).toBe('string');
      expect(a.title.length).toBeGreaterThan(0);
    }
  });
});
