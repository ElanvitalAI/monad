// C5-enh (2026-07-16) — 스트림 컴포지터. 모드별 렌더(off/progress/partial/block) + 상태 누적 +
// 블록 경계. 순수 함수라 시계/타이머 불필요.

import { describe, test, expect } from 'bun:test';
import {
  createCompositorState, applyChunk, composeStream, crossedBlockBoundary, isStreamingMode,
} from '../src/session/streaming/stream-compositor.js';

describe('applyChunk', () => {
  test('delta 누적·reasoning keep-latest·tool call→result 매칭', () => {
    const s = createCompositorState();
    applyChunk(s, { delta: 'Hello' });
    applyChunk(s, { delta: ' world' });
    expect(s.text).toBe('Hello world');
    applyChunk(s, { reasoning: '먼저' });
    applyChunk(s, { reasoning: '다음' });
    expect(s.reasoning).toBe('다음'); // keep-latest(누적 아님)
    applyChunk(s, { tool: { id: 'a', name: 'Bash', phase: 'call' } });
    expect(s.toolLines[0]).toEqual({ id: 'a', name: 'Bash', done: false });
    applyChunk(s, { tool: { id: 'a', name: 'Bash', phase: 'result', ok: true } });
    expect(s.toolLines[0]).toEqual({ id: 'a', name: 'Bash', done: true, ok: true });
  });

  test('중복 call id 는 재push 안 함(idempotent)', () => {
    const s = createCompositorState();
    applyChunk(s, { tool: { id: 'a', name: 'Bash', phase: 'call' } });
    applyChunk(s, { tool: { id: 'a', name: 'Bash', phase: 'call' } });
    expect(s.toolLines.length).toBe(1);
  });
});

describe('composeStream — 모드별 렌더', () => {
  test('off — 항상 null(편집 억제)', () => {
    const s = createCompositorState();
    applyChunk(s, { delta: 'Hello', });
    applyChunk(s, { tool: { id: 'a', name: 'Bash', phase: 'call' } });
    expect(composeStream(s, 'off')).toBeNull();
  });

  test('partial — 답변 본문 + ⚙️ 툴 tail(현 C5b 행동)', () => {
    const s = createCompositorState();
    applyChunk(s, { delta: 'Working' });
    applyChunk(s, { tool: { id: 'a', name: 'Bash', phase: 'call' } });
    expect(composeStream(s, 'partial')).toBe('Working\n\n⚙️ Bash …');
    applyChunk(s, { tool: { id: 'a', name: 'Bash', phase: 'result', ok: false } });
    expect(composeStream(s, 'partial')).toBe('Working\n\n⚙️ Bash ✗');
  });

  test('partial — 빈 상태는 null', () => {
    expect(composeStream(createCompositorState(), 'partial')).toBeNull();
  });

  test('progress — 🧠 추론 헤더 + ⚙️ 툴 + 💬 텍스트 tail(compact)', () => {
    const s = createCompositorState();
    applyChunk(s, { reasoning: '계획 수립' });
    applyChunk(s, { tool: { id: 'a', name: 'Read', phase: 'call' } });
    applyChunk(s, { delta: '답변 본문입니다' });
    const out = composeStream(s, 'progress');
    expect(out).toContain('🧠 계획 수립');
    expect(out).toContain('⚙️ Read …');
    expect(out).toContain('💬 답변 본문입니다');
  });

  test('progress — 긴 텍스트는 tail 로 절단(💬 커멘터리)', () => {
    const s = createCompositorState();
    applyChunk(s, { delta: 'x'.repeat(500) });
    const out = composeStream(s, 'progress', { commentaryChars: 100 })!;
    expect(out.startsWith('💬 …')).toBe(true);
    expect(out.length).toBeLessThan(120);
  });

  test('block — partial 과 동일 렌더(cadence 는 sink 담당)', () => {
    const s = createCompositorState();
    applyChunk(s, { delta: 'A\n\nB' });
    expect(composeStream(s, 'block')).toBe(composeStream(s, 'partial'));
  });
});

describe('crossedBlockBoundary', () => {
  test('빈 줄 추가 = 경계 넘음', () => {
    expect(crossedBlockBoundary('A', 'A\n\nB')).toBe(true);
    expect(crossedBlockBoundary('A\n\nB', 'A\n\nB more')).toBe(false);
    expect(crossedBlockBoundary('A\n\nB', 'A\n\nB\n\nC')).toBe(true);
  });
});

describe('isStreamingMode', () => {
  test('유효 모드만 통과', () => {
    for (const m of ['off', 'progress', 'partial', 'block']) expect(isStreamingMode(m)).toBe(true);
    for (const m of ['x', '', null, 42, undefined]) expect(isStreamingMode(m)).toBe(false);
  });
});
