import { test, expect, describe } from 'bun:test';
import { SignalPool, type Signal } from './signal-pool.js';
import { formatCommunityBuzzDigest, runCommunityBuzzDigest, type CommunityBuzzNarrative } from './signal-router.js';

const sig = (over: Partial<Signal> = {}): Signal => ({
  eventId: 'e1', source: 'community', observedAt: '2026-07-15T00:00:00Z',
  collectedAt: '2026-07-15T00:00:01Z', origin: 'fmkorea', trust: 1.0, raw: '삼성 좋아보임', ...over,
});

describe('formatCommunityBuzzDigest', () => {
  test('상위 서사·건수·샘플을 담고 매매아님 고지', () => {
    const n: CommunityBuzzNarrative[] = [
      { narrative: '000660.KO', count: 163, lastAt: '2026-07-15T07:00:00Z', sample: '하닉 손절' },
      { narrative: '005930.KO', count: 29, lastAt: '2026-07-15T06:00:00Z', sample: '삼전 매수' },
    ];
    const out = formatCommunityBuzzDigest(n, 8);
    expect(out).toContain('커뮤니티 버즈 요약');
    expect(out).toContain('000660.KO · 163건');
    expect(out).toContain('매매 아님');
  });
});

describe('runCommunityBuzzDigest', () => {
  test('창 내 S2 커뮤니티 서사를 요약(라우팅 상태 불변·read-only)', () => {
    const p = new SignalPool({ path: ':memory:' });
    try {
      // 같은 서사 5건(S2) — 창 안.
      for (let i = 0; i < 5; i += 1) {
        p.ingest(sig({ eventId: `a-${i}`, dedupGroup: '000660.KO', collectedAt: '2026-07-15T06:00:00Z' }));
      }
      // 분류(S2 부여) — dedup 5 → S2.
      for (let i = 0; i < 5; i += 1) p.markSeverity(`a-${i}`, 'S2', 'test');
      let sentText = '';
      const r = runCommunityBuzzDigest(p, {
        now: () => '2026-07-15T08:00:00Z', windowHours: 8,
        send: (text) => { sentText = text; return true; },
      });
      expect(r.count).toBe(1);       // 서사 1개
      expect(r.sent).toBe(true);
      expect(sentText).toContain('000660.KO · 5건');
    } finally { p.close(); }
  });

  test('버즈 없으면 무발송', () => {
    const p = new SignalPool({ path: ':memory:' });
    try {
      const r = runCommunityBuzzDigest(p, { now: () => '2026-07-15T08:00:00Z', send: () => true });
      expect(r.count).toBe(0);
      expect(r.sent).toBe(false);
    } finally { p.close(); }
  });
});
