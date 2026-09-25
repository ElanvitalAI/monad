// Reddit 파서 단위테스트 — RSS(Atom) + OAuth 리스팅(무네트워크·인라인 픽스처).
import { describe, test, expect } from 'bun:test';
import { parseRedditRss, parseRedditListing } from './parse-reddit.js';

const RSS = `<?xml version="1.0"?><feed>
<entry><author><name>/u/trader_joe</name></author><category term="wallstreetbets" label="r/wallstreetbets"/>
<title>$NVDA earnings blowout, tendies incoming</title><id>t3_abc123</id>
<link href="https://www.reddit.com/r/wallstreetbets/comments/abc123/nvda/"/>
<published>2026-07-09T13:30:00+00:00</published></entry>
<entry><author><name>/u/AutoModerator</name></author><category term="wallstreetbets" label="r/wallstreetbets"/>
<title>Daily Discussion Thread</title><id>t3_zzz999</id>
<link href="https://www.reddit.com/x"/><published>2026-07-09T09:00:00+00:00</published></entry>
<entry><author><name>/u/bear_gang</name></author><category term="stocks" label="r/stocks"/>
<title>Is $TSLA overvalued? &amp; more</title><id>t3_def456</id>
<link href="https://www.reddit.com/r/stocks/comments/def456/tsla/"/>
<published>2026-07-09T14:00:00+00:00</published></entry>
</feed>`;

describe('parseRedditRss — Atom', () => {
  const posts = parseRedditRss(RSS);
  test('AutoModerator 제외·2건', () => {
    expect(posts.length).toBe(2);
    expect(posts.every(p => p.author !== 'AutoModerator')).toBe(true);
  });
  test('필드·엔티티 디코드·t3_ 제거', () => {
    const p = posts[0]!;
    expect(p.postId).toBe('abc123');
    expect(p.author).toBe('trader_joe');
    expect(p.category).toBe('wallstreetbets');
    expect(p.title).toContain('$NVDA');
    expect(p.postedAt).toBe('2026-07-09T13:30:00+00:00');
    expect(p.recommends).toBe(0); // RSS는 ups 없음
    expect(p.views).toBeNull();
  });
  test('HTML 엔티티 디코드', () => {
    expect(posts.find(p => p.postId === 'def456')!.title).toBe('Is $TSLA overvalued? & more');
  });
});

describe('parseRedditListing — OAuth 구조화', () => {
  const json = { data: { children: [
    { data: { id: 'p1', subreddit: 'wallstreetbets', title: 'GME to the moon', author: 'ape1', ups: 4200, num_comments: 815, created_utc: 1783000000, permalink: '/r/wallstreetbets/comments/p1/gme/' } },
    { data: { id: 'p2', subreddit: 'stocks', title: 'Daily', author: 'AutoModerator', ups: 10, num_comments: 3, created_utc: 1783000100, stickied: true } },
    { data: { id: 'p3', subreddit: 'stocks', title: 'MU thesis', author: 'analyst', ups: 120, num_comments: 44, created_utc: 1783000200, permalink: '/r/stocks/comments/p3/mu/' } },
  ] } };
  const posts = parseRedditListing(json);
  test('stickied/AutoModerator 제외·2건', () => {
    expect(posts.length).toBe(2);
  });
  test('ups→recommends·num_comments·created_utc→ISO', () => {
    const p = posts[0]!;
    expect(p.postId).toBe('p1');
    expect(p.recommends).toBe(4200); // velocity 소스
    expect(p.comments).toBe(815);
    expect(p.postedAt).toBe(new Date(1783000000 * 1000).toISOString());
    expect(p.url).toBe('https://www.reddit.com/r/wallstreetbets/comments/p1/gme/');
  });
});
