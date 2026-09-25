// community_buzz 스토어 velocity 단위테스트 — 인메모리 DB.
import { describe, test, expect } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openBuzzDb, upsertPosts, pruneOldBuzz, sessionHalflifeMin } from './store.js';
import type { FmkoreaPost } from './parse-fmkorea.js';

function post(postId: string, views: number, title = 't', postedAt: string | null = '2026-07-09T22:00:00Z'): FmkoreaPost {
  return { postId, category: '국내주식', title, author: 'a', timeLabel: '22:53', postedAt, views, recommends: 0, url: `https://www.fmkorea.com/${postId}` };
}

describe('openBuzzDb', () => {
  test('temporary database handle sets busy_timeout to 2000ms', () => {
    const dir = mkdtempSync(join(tmpdir(), 'buzz-store-test-'));
    const db = openBuzzDb(join(dir, 'community_buzz.db'));
    const timeout = db.prepare('PRAGMA busy_timeout').get() as { timeout: number };
    expect(timeout.timeout).toBe(2000);
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('upsertPosts — 적재 + velocity', () => {
  test('신규는 inserted·velocity 0', () => {
    const db = openBuzzDb(':memory:');
    const r = upsertPosts(db, { forum: 'fmkorea', lane: 'firehose', posts: [post('1', 10), post('2', 5)], nowIso: '2026-07-09T22:00:00Z' });
    expect(r.inserted).toBe(2);
    expect(r.updated).toBe(0);
    expect(r.hot.length).toBe(0);
  });

  test('두번째 폴에서 조회 증가분이 velocity·hot 랭킹', () => {
    const db = openBuzzDb(':memory:');
    upsertPosts(db, { forum: 'fmkorea', lane: 'firehose', posts: [post('1', 10), post('2', 5)], nowIso: '2026-07-09T22:00:00Z' });
    const r = upsertPosts(db, { forum: 'fmkorea', lane: 'firehose', posts: [post('1', 60, '달아오름'), post('2', 7)], nowIso: '2026-07-09T22:05:00Z' });
    expect(r.updated).toBe(2);
    expect(r.hot[0]!.id).toBe('fmkorea:1');   // +50 이 최상위
    expect(r.hot[0]!.velocity).toBe(50);
    expect(r.hot[1]!.velocity).toBe(2);
  });

  test('같은 velocity면 신선한 글이 buzzScore 상위(대표 지시: freshness=중요도 인자)', () => {
    const db = openBuzzDb(':memory:');
    // 둘 다 조회 10 → 다음 폴 60(velocity 50). 하나는 방금(22:03), 하나는 3시간 전(19:05).
    upsertPosts(db, { forum: 'fmkorea', lane: 'firehose', posts: [
      post('fresh', 10, 'f', '2026-07-09T13:03:00Z'), post('stale', 10, 's', '2026-07-09T10:05:00Z'),
    ], nowIso: '2026-07-09T13:05:00Z' });
    const r = upsertPosts(db, { forum: 'fmkorea', lane: 'firehose', posts: [
      post('fresh', 60, 'f', '2026-07-09T13:03:00Z'), post('stale', 60, 's', '2026-07-09T10:05:00Z'),
    ], nowIso: '2026-07-09T13:07:00Z' });
    expect(r.hot[0]!.id).toBe('fmkorea:fresh');
    expect(r.hot[0]!.velocity).toBe(r.hot[1]!.velocity); // velocity 동일
    expect(r.hot[0]!.buzzScore).toBeGreaterThan(r.hot[1]!.buzzScore); // 신선도로 역전
    expect(r.hot[0]!.freshness).toBeGreaterThan(r.hot[1]!.freshness);
  });

  test('조회 감소/동일은 velocity 0(hot 제외)', () => {
    const db = openBuzzDb(':memory:');
    upsertPosts(db, { forum: 'fmkorea', lane: 'firehose', posts: [post('1', 100)], nowIso: '2026-07-09T22:00:00Z' });
    const r = upsertPosts(db, { forum: 'fmkorea', lane: 'firehose', posts: [post('1', 100)], nowIso: '2026-07-09T22:05:00Z' });
    expect(r.hot.length).toBe(0);
  });

  test('스냅샷 시계열 누적', () => {
    const db = openBuzzDb(':memory:');
    upsertPosts(db, { forum: 'fmkorea', lane: 'firehose', posts: [post('1', 10)], nowIso: '2026-07-09T22:00:00Z' });
    upsertPosts(db, { forum: 'fmkorea', lane: 'firehose', posts: [post('1', 30)], nowIso: '2026-07-09T22:05:00Z' });
    const snaps = db.prepare('SELECT COUNT(*) c FROM buzz_snapshots WHERE post_id=?').get('fmkorea:1') as { c: number };
    expect(snaps.c).toBe(2);
  });
});

describe('normalize 배선 — 적재 시 티커/긍부정 태깅', () => {
  test('normalize 콜백이 tickers·sentiment 컬럼에 적재', () => {
    const db = openBuzzDb(':memory:');
    upsertPosts(db, {
      forum: 'fmkorea', lane: 'firehose', posts: [post('n1', 5, '하닉 떡상')], nowIso: '2026-07-09T13:00:00Z',
      normalize: (title) => title.includes('하닉') ? { tickers: ['000660.KO'], sentiment: 0.9 } : { tickers: [], sentiment: null },
    });
    const r = db.prepare('SELECT tickers, sentiment FROM buzz_posts WHERE id=?').get('fmkorea:n1') as { tickers: string; sentiment: number };
    expect(r.tickers).toBe('000660.KO');
    expect(r.sentiment).toBe(0.9);
  });
});

describe('② 가속(Δvelocity)', () => {
  test('velocity 증가=양수 가속·감소=음수 가속 저장', () => {
    const db = openBuzzDb(':memory:');
    upsertPosts(db, { forum: 'fmkorea', lane: 'firehose', posts: [post('1', 10)], nowIso: '2026-07-09T22:00:00Z' });
    upsertPosts(db, { forum: 'fmkorea', lane: 'firehose', posts: [post('1', 60)], nowIso: '2026-07-09T22:05:00Z' }); // vel 50·accel 50
    let r = db.prepare('SELECT velocity, accel FROM buzz_posts WHERE id=?').get('fmkorea:1') as { velocity: number; accel: number };
    expect(r.velocity).toBe(50); expect(r.accel).toBe(50);
    upsertPosts(db, { forum: 'fmkorea', lane: 'firehose', posts: [post('1', 90)], nowIso: '2026-07-09T22:10:00Z' }); // vel 30·accel -20
    r = db.prepare('SELECT velocity, accel FROM buzz_posts WHERE id=?').get('fmkorea:1') as { velocity: number; accel: number };
    expect(r.velocity).toBe(30); expect(r.accel).toBe(-20);
  });
});

describe('② 세션인지 반감기', () => {
  test('장중(평일 KR장) 빠른 20분·주말 느린 120분', () => {
    expect(sessionHalflifeMin(Date.parse('2026-07-10T01:00:00Z'))).toBe(20);  // 금 10am KST=KR장
    expect(sessionHalflifeMin(Date.parse('2026-07-11T03:00:00Z'))).toBe(120); // 토 정오 KST=휴장
  });
});

describe('pruneOldBuzz', () => {
  test('오래된 raw 글 삭제(중요글 보존)', () => {
    const db = openBuzzDb(':memory:');
    upsertPosts(db, { forum: 'fmkorea', lane: 'firehose', posts: [post('old', 5)], nowIso: '2026-07-09T22:00:00Z' });
    db.run(`UPDATE buzz_posts SET fetch_ts='2020-01-01T00:00:00Z' WHERE id='fmkorea:old'`);
    upsertPosts(db, { forum: 'fmkorea', lane: 'firehose', posts: [post('keep', 5)], nowIso: '2020-01-01T00:00:00Z' });
    db.run(`UPDATE buzz_posts SET fetch_ts='2020-01-01T00:00:00Z', alerted=1 WHERE id='fmkorea:keep'`);
    const deleted = pruneOldBuzz(db, 48);
    expect(deleted).toBe(1); // old 만 삭제, keep(alerted)은 보존
    expect(db.prepare(`SELECT COUNT(*) c FROM buzz_posts`).get()).toEqual({ c: 1 });
  });
});
