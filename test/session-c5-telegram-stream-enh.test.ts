// C5-enh (2026-07-16) — 텔레그램 스트리밍 강화 순수 모듈. typing governor(anti-footgun) ·
// forum fair-queue(라운드로빈) · scroll-jump rotation 판정.

import { describe, test, expect } from 'bun:test';
import {
  createTypingGovernor, createGroupFairQueue, shouldRotate,
} from '../src/session/streaming/telegram-stream-enh.js';

function micro(): Promise<void> { return new Promise((r) => setTimeout(r, 0)); }

describe('createTypingGovernor', () => {
  test('minGap 내 재-ping 은 스킵', async () => {
    let t = 0; const sent: string[] = [];
    const g = createTypingGovernor({ sendChatAction: async (c) => { sent.push(String(c)); } }, { minGapMs: 4000 });
    g.ping(1); await micro();
    g.ping(1); await micro();  // 같은 시각 → 스킵
    expect(sent).toEqual(['1']);
  });

  test('anti-footgun — 401/Forbidden 즉시 영구 suspend', async () => {
    const g = createTypingGovernor({
      sendChatAction: async () => { throw { statusCode: 403, description: 'Forbidden: bot was blocked' }; },
    });
    g.ping(1); await micro();
    expect(g.isSuspended()).toBe(true);
    // suspend 후엔 no-op.
    let called = false;
    const g2 = createTypingGovernor({ sendChatAction: async () => { called = true; }, isForbidden: () => true });
    g2.ping(1); await micro();
    g2.ping(2); await micro();
    expect(called).toBe(true); // 첫 ping 만
  });

  test('연속 실패 N 후 suspend', async () => {
    let t = 0;
    const g = createTypingGovernor(
      { sendChatAction: async () => { throw new Error('flaky'); }, isForbidden: () => false, now: () => t },
      { maxConsecutiveFailures: 3, minGapMs: 1000 },
    );
    for (let i = 0; i < 3; i++) { g.ping(1); await micro(); t += 1000; }
    expect(g.isSuspended()).toBe(true);
  });
});

describe('createGroupFairQueue', () => {
  test('단일 thread — 항상 서빙(비-forum 무영향)', () => {
    const q = createGroupFairQueue();
    q.enqueue(1, 'a');
    expect(q.isTurn(1, 'a')).toBe(true);
  });

  test('다중 thread — 라운드로빈(served 후 뒤로)', () => {
    const q = createGroupFairQueue();
    q.enqueue(1, 'a'); q.enqueue(1, 'b');
    expect(q.isTurn(1, 'a')).toBe(true);
    expect(q.isTurn(1, 'b')).toBe(false);
    q.served(1, 'a');
    expect(q.isTurn(1, 'b')).toBe(true);
    expect(q.isTurn(1, 'a')).toBe(false);
    q.served(1, 'b');
    expect(q.isTurn(1, 'a')).toBe(true); // 순환
  });

  test('remove — 종료 thread 슬롯 반납(다음 thread 서빙)', () => {
    const q = createGroupFairQueue();
    q.enqueue(1, 'a'); q.enqueue(1, 'b');
    q.remove(1, 'a');
    expect(q.isTurn(1, 'b')).toBe(true);
  });

  test('chat 격리 — 다른 chatId 큐 독립', () => {
    const q = createGroupFairQueue();
    q.enqueue(1, 'a'); q.enqueue(1, 'b');
    q.enqueue(2, 'x');
    expect(q.isTurn(2, 'x')).toBe(true); // chat 2 는 단일
    expect(q.isTurn(1, 'b')).toBe(false); // chat 1 은 a 가 앞
  });
});

describe('shouldRotate', () => {
  test('minEdits·dwell·gap 전부 충족 시 true', () => {
    const base = { edits: 10, createdAt: 0, lastRotateAt: Number.NEGATIVE_INFINITY };
    expect(shouldRotate(base, 10_000)).toBe(true);
  });
  test('편집 부족 → false', () => {
    expect(shouldRotate({ edits: 3, createdAt: 0, lastRotateAt: -Infinity }, 10_000)).toBe(false);
  });
  test('dwell 부족(빠른 턴 flash 방지) → false', () => {
    expect(shouldRotate({ edits: 10, createdAt: 0, lastRotateAt: -Infinity }, 1000, { minDwellMs: 4000 })).toBe(false);
  });
  test('직전 rotate 직후(gap 부족) → false', () => {
    expect(shouldRotate({ edits: 10, createdAt: 0, lastRotateAt: 9000 }, 10_000, { minGapMs: 6000 })).toBe(false);
  });
});
