import { test, expect, describe } from 'bun:test';
import { assessFreshness, aggregateLiveBuzz, formatBuzzBriefing } from './buzz-briefing.js';

const NOW = Date.parse('2026-07-15T09:00:00.000Z');

describe('assessFreshness', () => {
  test('최근(10분전) → fresh', () => {
    const f = assessFreshness(new Date(NOW - 10 * 60_000).toISOString(), NOW, 30);
    expect(f.stale).toBe(false); expect(f.ageMin).toBe(10);
  });
  test('오래됨(2h전) → stale', () => {
    expect(assessFreshness(new Date(NOW - 120 * 60_000).toISOString(), NOW, 30).stale).toBe(true);
  });
  test('수집 이력 없음 → stale', () => {
    expect(assessFreshness(null, NOW).stale).toBe(true);
  });
});

describe('aggregateLiveBuzz', () => {
  const posts = [
    { title: '삼성전자 가즈아', recommends: 50, url: 'u1' },
    { title: '삼성 실적 발표', recommends: 10, url: 'u2' },
    { title: '하이닉스 신고가', recommends: 30, url: 'u3' },
  ];
  const norm = (t: string) => (t.includes('삼성') ? ['005930'] : t.includes('하이닉스') ? ['000660'] : []);
  test('티커별 집계 + 인기글 정렬', () => {
    const r = aggregateLiveBuzz(posts, norm);
    expect(r.narratives[0]!.narrative).toBe('005930');  // 삼성 2건 최다
    expect(r.narratives[0]!.count).toBe(2);
    expect(r.hotPosts[0]!.recommends).toBe(50);          // 추천 최다 먼저
  });
});

describe('formatBuzzBriefing', () => {
  test('live 모드 헤더 + 매매아님 고지', () => {
    const s = formatBuzzBriefing({
      mode: 'live', freshness: { lastPostIso: null, ageMin: null, stale: true },
      narratives: [{ narrative: '005930', count: 3, sample: '삼성 가즈아' }],
      hotPosts: [{ title: '삼성', recommends: 50, url: 'u' }],
    });
    expect(s).toContain('실시간 그랩');
    expect(s).toContain('005930 · 3건');
    expect(s).toContain('매매 아님');
  });
});
