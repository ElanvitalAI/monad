// 모니터 diff 헤드라인 추출 (2026-07-07 대표 피드백 — "변경 감지만 있고
// 기사가 없다"). 매경 실측 diff 형상 fixture 기반.

import { describe, test, expect } from 'bun:test';
import { extractDiffHeadlines, renderDiffHeadlines } from '../src/domains/monitor-diff.js';

const FIXTURE = [
  '--- previous.md\t',
  '+++ current.md\t',
  '@@ -260,15 +260,15 @@',
  ' 유지되는 라인',
  '+ 96,450,0000.53%\\\\',
  '+ 1,724-1.15%](https://stock.mk.co.kr/)',
  '+[**‘IPO 대어’ 네번째 도전장 … 교보생명, 기업공개 주관사 선정 돌입** \\\\',
  '+풋옵션 분쟁 조력 증권사 물망 이르면 연내 예비심사 청구할듯](https://www.mk.co.kr/news/stock/12091922)',
  '+[![‘IPO 대어’ 이미지](https://wimg.mk.co.kr/svc/desking/1000/A12091922.png)](https://www.mk.co.kr/news/stock/12091922)',
  '+[_5_\\\\ **매경플러스 “투자는 미래 예측 게임 아니다”**](https://www.mk.co.kr/news/stock/12091296)',
  '-[삭제된 기사 제목입니다](https://www.mk.co.kr/news/stock/999)',
].join('\n');

describe('extractDiffHeadlines', () => {
  test('추가(+) 라인의 기사 링크만 — 이미지/티커/삭제 라인 제외, 제목 정제', () => {
    const items = extractDiffHeadlines(FIXTURE);
    expect(items.map(i => i.url)).toEqual([
      'https://www.mk.co.kr/news/stock/12091922',
      'https://www.mk.co.kr/news/stock/12091296',
    ]);
    expect(items[0]!.title).toBe('‘IPO 대어’ 네번째 도전장 … 교보생명, 기업공개 주관사 선정 돌입');
    expect(items[1]!.title).toBe('매경플러스 “투자는 미래 예측 게임 아니다”'); // _5_ 순번·볼드 제거
  });

  test('dedupe(같은 제목) + maxItems 캡', () => {
    const dup = Array.from({ length: 8 }, (_, i) =>
      `+[중복이 아닌 서로 다른 헤드라인 ${i}번째 기사](https://ex.com/${i})`).join('\n')
      + '\n+[중복이 아닌 서로 다른 헤드라인 0번째 기사](https://ex.com/dup)';
    const items = extractDiffHeadlines(dup, 5);
    expect(items.length).toBe(5);
    expect(new Set(items.map(i => i.title)).size).toBe(5);
  });

  test('diff에 기사 링크 없음 → 빈 배열 · 렌더 빈 문자열', () => {
    expect(extractDiffHeadlines('+숫자만 12,345\n+0.53%\\\\')).toEqual([]);
    expect(renderDiffHeadlines([])).toBe('');
  });

  test('렌더 형식 — 제목 + 들여쓴 링크', () => {
    const r = renderDiffHeadlines([{ title: 'T제목입니다긴제목', url: 'https://u.example' }]);
    expect(r).toContain('  - T제목입니다긴제목');
    expect(r).toContain('    https://u.example');
  });
});

describe('구조 필터 + slug 복원 (대표 피드백 2탄 — Reuters/TrendForce 실사례)', () => {
  test('내비/시세위젯 URL 필터', async () => {
    const { isNavigationUrl } = await import('../src/domains/monitor-diff.js');
    expect(isNavigationUrl('https://www.reuters.com/markets/quote/.N225/')).toBe(true);
    expect(isNavigationUrl('https://www.reuters.com/business/')).toBe(true);
    expect(isNavigationUrl('https://www.reuters.com/business/finance/big-us-banks-explore-fiserv-network-deal-wsj-reports-2026-07-06/')).toBe(false);
    expect(isNavigationUrl('https://www.etnews.com/20260707000014')).toBe(false);
  });

  test('무의미 제목 판별 + slug 복원 (TrendForce "View More")', async () => {
    const { isMeaninglessTitle, titleFromSlug, refineHeadlines } = await import('../src/domains/monitor-diff.js');
    expect(isMeaninglessTitle('View More')).toBe(true);
    expect(isMeaninglessTitle('NegativeN225')).toBe(true);
    expect(isMeaninglessTitle('삼성전자 2분기 매출 171조·영업이익 89조')).toBe(false);
    const url = 'https://www.trendforce.com/news/2026/07/07/news-samsung-sk-hynix-reportedly-reconsider-hybrid-bonding-timeline-16-high-hbm4e-may-be-earliest-adoption/';
    expect(titleFromSlug(url)).toContain('samsung sk hynix');
    // 실사례 파이프: View More + 시세위젯 3건 → 복원 1건만 생존
    const refined = refineHeadlines([
      { title: 'View More', url },
      { title: 'NegativeN225', url: 'https://www.reuters.com/markets/quote/.N225/' },
      { title: 'Brent Crude Oil', url: 'https://www.reuters.com/markets/quote/LCOc1/' },
      { title: 'BusinessCategory', url: 'https://www.reuters.com/business/' },
      { title: 'Big US banks explore Fiserv network deal, WSJ reports', url: 'https://www.reuters.com/business/finance/big-us-banks-explore-fiserv-network-deal-wsj-reports-2026-07-06/' },
    ]);
    expect(refined.length).toBe(2);
    expect(refined[0]!.title).toContain('samsung sk hynix');
    expect(refined[1]!.title).toContain('Fiserv');
  });
});

describe('judgeMonitorHeadlines (LLM 통합 판정)', () => {
  const heads = [
    { title: '삼성전자 2분기 매출 171조·영업이익 89조', url: 'https://e/1' },
    { title: '아임인, Fit하니로 LIPS 2.0 선정…피트니스 마케팅 플랫폼', url: 'https://e/2' },
  ];
  test('중요도·해석·기발송 중복 매핑', async () => {
    const { judgeMonitorHeadlines } = await import('../src/domains/monitor-diff.js');
    const judged = await judgeMonitorHeadlines(heads, [{ text: 'Samsung Q2 surge', reason: '삼성 실적 서프라이즈' }],
      async () => JSON.stringify([
        { i: 1, importance: 9, reason: '삼성 실적 — 반도체 강세', dup: true },
        { i: 2, importance: 2, reason: '개별 홍보성', dup: false },
      ]));
    expect(judged[0]!.dupOfRecent).toBe(true);
    expect(judged[0]!.importance).toBe(9);
    expect(judged[1]!.importance).toBe(2);
    // floor 6 필터를 적용하면 둘 다 접힘 (중복 + 저중요) → 알림 skip 시나리오
    expect(judged.filter(j => !j.dupOfRecent && (j.importance === null || j.importance >= 6)).length).toBe(0);
  });

  test('LLM 전멸 → fail-open (판정불가 태그·구조필터 통과분 유지)', async () => {
    const { judgeMonitorHeadlines } = await import('../src/domains/monitor-diff.js');
    const judged = await judgeMonitorHeadlines(heads, [], async () => null);
    expect(judged.length).toBe(2);
    expect(judged.every(j => j.importance === null && !j.dupOfRecent)).toBe(true);
  });
});

describe('firecrawl-monitor-alert wire (source-level)', () => {
  test('폴러가 필터 파이프 전체를 배선 (구조→판정→floor→기록)', async () => {
    const src = await Bun.file(new URL('../scripts/firecrawl-monitor-alert.ts', import.meta.url)).text();
    expect(src).toMatch(/refineHeadlines\(/);
    expect(src).toMatch(/judgeMonitorHeadlines\(heads, recentSent, llmOnce\)/);
    expect(src).toMatch(/j\.importance >= floor/);
    expect(src).toMatch(/INSERT OR IGNORE INTO signals/); // 크로스 dedup용 기록
  });
});
