// TUI 부활 후속 — Esc·Esc → /rewind 제스처 판정 회귀 고정 (codex backtrack 동형).

import { describe, expect, test } from 'bun:test';
import { resolveEscEscRewind, ESC_ESC_WINDOW_MS } from '../src/chat/esc-esc-rewind.js';

describe('resolveEscEscRewind', () => {
  test('빈 버퍼 첫 Esc → prime (기본 동작 통과)', () => {
    const d = resolveEscEscRewind({ bufferText: '', nowMs: 1000, primedAtMs: 0 });
    expect(d.action).toBe('prime');
    expect(d.nextPrimedAt).toBe(1000);
  });

  test('창 안 둘째 Esc → open + prime 해제', () => {
    const d = resolveEscEscRewind({ bufferText: '', nowMs: 2000, primedAtMs: 1000 });
    expect(d.action).toBe('open');
    expect(d.nextPrimedAt).toBe(0);
  });

  test('창 밖 둘째 Esc → 재-prime (stale prime 자연 소멸)', () => {
    const d = resolveEscEscRewind({
      bufferText: '',
      nowMs: 1000 + ESC_ESC_WINDOW_MS + 1,
      primedAtMs: 1000,
    });
    expect(d.action).toBe('prime');
    expect(d.nextPrimedAt).toBe(1000 + ESC_ESC_WINDOW_MS + 1);
  });

  test('버퍼 비어있지 않으면 절대 prime/open 안 함 — Esc 기존 의미(클리어) 보존 + prime 해제', () => {
    const d1 = resolveEscEscRewind({ bufferText: '작성 중', nowMs: 1000, primedAtMs: 0 });
    expect(d1.action).toBe('pass');
    const d2 = resolveEscEscRewind({ bufferText: '작성 중', nowMs: 2000, primedAtMs: 1000 });
    expect(d2.action).toBe('pass');
    expect(d2.nextPrimedAt).toBe(0);
  });

  test('공백만 있는 버퍼는 빈 버퍼 취급', () => {
    const d = resolveEscEscRewind({ bufferText: '   ', nowMs: 2000, primedAtMs: 1000 });
    expect(d.action).toBe('open');
  });
});
