import { test, expect, describe } from 'bun:test';
import { feedBySource } from './morning-synthesis.js';
import type { SignalBoard } from './signal-board.js';

describe('morning-synthesis — feedBySource', () => {
  test('소스별 분리', () => {
    const board: SignalBoard = {
      generatedAt: '2026-07-10T00:00:00Z', regime: null, capstone: null,
      feed: [
        { source: 'buzz', ts: '2026-07-10T00:00:00Z', title: '하이닉스 급부상' },
        { source: 'dig', ts: '2026-07-10T00:00:00Z', title: '디깅' },
        { source: 'signal', ts: '2026-07-10T00:00:00Z', title: '신호' },
        { source: 'reflection', ts: '2026-07-10T00:00:00Z', title: '회고' },
        { source: 'regime', ts: '2026-07-10T00:00:00Z', title: '국면전환' },
        { source: 'buzz', ts: '2026-07-10T00:00:00Z', title: 'MU 급부상' },
      ],
      bySource: {},
    };
    const s = feedBySource(board);
    expect(s.buzz.length).toBe(2);
    expect(s.dig.length).toBe(1);
    expect(s.signal.length).toBe(1);
    expect(s.reflection.length).toBe(1);
  });
});
