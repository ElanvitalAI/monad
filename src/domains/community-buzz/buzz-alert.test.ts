// 버즈 알림 단위테스트 — 후보/중복제거/포맷(인메모리).
import { describe, test, expect } from 'bun:test';
import { openBuzzDb } from './store.js';
import { alertCandidates, recentAlertedTitles, markAlerted, filterNewAlerts, formatBuzzAlert, type AlertCandidate } from './buzz-alert.js';

function seedPost(db: ReturnType<typeof openBuzzDb>, o: { id: string; title: string; imp?: number; spam?: number; alerted?: number }): void {
  db.prepare(`INSERT INTO buzz_posts(id, ts, fetch_ts, forum, title, importance, spam, alerted, velocity) VALUES (?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'fmkorea', ?, ?, ?, ?, 0)`)
    .run(o.id, o.title, o.imp ?? null, o.spam ?? 0, o.alerted ?? 0);
}

describe('alertCandidates — 중요만·非spam·미알림', () => {
  test('floor 이상·spam/알림완료 제외', () => {
    const db = openBuzzDb(':memory:');
    seedPost(db, { id: 'a', title: '삼성 감산 발표', imp: 9 });
    seedPost(db, { id: 'b', title: '잡담', imp: 3 });           // floor 미달
    seedPost(db, { id: 'c', title: '광고', imp: 9, spam: 1 });  // spam
    seedPost(db, { id: 'd', title: '이미 알림', imp: 9, alerted: 1 });
    const c = alertCandidates(db, { minImportance: 8 });
    expect(c.map(x => x.id)).toEqual(['a']);
  });
});

describe('filterNewAlerts — 유사중복 억제', () => {
  const cands: AlertCandidate[] = [
    { id: 'a', title: '삼성전자 감산 공식 발표', tickers: '005930.KO', importance: 9, sentiment: 0.5, reason: 'r', category: '국내주식', url: 'u1' },
    { id: 'b', title: '삼성전자 감산 발표 공식', tickers: '005930.KO', importance: 8, sentiment: 0.5, reason: 'r', category: '국내주식', url: 'u2' },
    { id: 'c', title: '엔비디아 실적 서프라이즈', tickers: 'NVDA', importance: 9, sentiment: 0.8, reason: 'r', category: '해외주식', url: 'u3' },
  ];
  test('후보 상호 유사중복 제거', () => {
    const kept = filterNewAlerts(cands, []);
    expect(kept.map(k => k.id)).toEqual(['a', 'c']); // b는 a와 유사
  });
  test('최근 알림과 유사하면 제외', () => {
    const kept = filterNewAlerts(cands, ['삼성전자 감산 발표 공식화']);
    expect(kept.map(k => k.id)).toEqual(['c']); // 삼성 둘 다 최근알림과 유사
  });
});

describe('markAlerted / recentAlertedTitles', () => {
  test('마킹 후 후보에서 빠지고 최근목록에 들어감', () => {
    const db = openBuzzDb(':memory:');
    seedPost(db, { id: 'a', title: '삼성 감산', imp: 9 });
    markAlerted(db, ['a']);
    expect(alertCandidates(db, { minImportance: 8 }).length).toBe(0);
    expect(recentAlertedTitles(db)).toContain('삼성 감산');
  });
});

describe('formatBuzzAlert', () => {
  test('중요도·티커·이유·링크 포함·빈배열 null', () => {
    expect(formatBuzzAlert([])).toBeNull();
    const t = formatBuzzAlert([{ id: 'a', title: '삼성 감산', tickers: '005930.KO', importance: 9, sentiment: 0.6, reason: '공급조절', category: '국내주식', url: 'https://x' }])!;
    expect(t).toContain('중요도 9');
    expect(t).toContain('005930.KO');
    expect(t).toContain('공급조절');
    expect(t).toContain('📈');
  });
});
