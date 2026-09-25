// L3 역량 발굴(discovery) seam — 질의 강화·단일 seam·커뮤니티 보강·graceful 회귀 가드 (#7-5).
import { describe, it, expect } from 'bun:test';
import { discoverCapability, buildDiscoveryQuery } from './discover-capability.js';
import type { WebSearchResult } from '../web-search/index.js';

const mkResult = (hits: Array<{ url: string; title: string; snippet: string; score?: number }>): WebSearchResult => ({
  hits, providerName: 'tavily', durationMs: 1,
});

describe('buildDiscoveryQuery (능력 지향 질의·순수)', () => {
  it('계층별 도구 종류로 질의를 강화("정보"가 아니라 "능력")', () => {
    expect(buildDiscoveryQuery('PDF 파싱 안 됨', 'pkg')).toContain('library or package');
    expect(buildDiscoveryQuery('X 크롤 필요', 'mcp')).toContain('MCP server');
    expect(buildDiscoveryQuery('요약 능력', 'skill')).toContain('tool or agent skill');
    expect(buildDiscoveryQuery('리뷰 전문가', 'subagent')).toContain('specialized agent');
    expect(buildDiscoveryQuery('무언가', undefined)).toContain('tool, library, or MCP');
  });
  it('gap 포함 + 300자 상한', () => {
    const q = buildDiscoveryQuery('x'.repeat(400), 'pkg');
    expect(q.length).toBeLessThanOrEqual(300);
  });
});

describe('discoverCapability (단일 seam·DI)', () => {
  it('search seam(단일 registry 통과)으로 후보 반환', async () => {
    let sawQuery = '';
    const cands = await discoverCapability('PDF 파싱 라이브러리 필요', { layer: 'pkg', community: false }, {
      search: async (q) => { sawQuery = q; return mkResult([{ url: 'https://npmjs.com/pdf-parse', title: 'pdf-parse', snippet: 'parse pdf', score: 0.9 }]); },
    });
    expect(sawQuery).toContain('library or package');   // 질의 강화 통과
    expect(cands.length).toBe(1);
    expect(cands[0]!.source).toBe('tavily');            // provider 명 전파
    expect(cands[0]!.title).toBe('pdf-parse');
  });

  it('⭐community(Grok x_search) 보강 후보를 grok-x 소스로 추가', async () => {
    const cands = await discoverCapability('최신 X 크롤 툴', { layer: 'skill', community: true }, {
      search: async () => mkResult([]),
      communitySearch: async () => 'X 실무자들은 xyz-scraper 를 추천',
    });
    const comm = cands.find(c => c.source === 'grok-x');
    expect(comm).toBeDefined();
    expect(comm!.snippet).toContain('xyz-scraper');
  });

  it('community=false 면 커뮤니티 seam 미호출', async () => {
    let called = false;
    await discoverCapability('gap', { community: false }, {
      search: async () => mkResult([]),
      communitySearch: async () => { called = true; return 'x'; },
    });
    expect(called).toBe(false);
  });

  it('graceful — search seam throw 해도 never-throw(커뮤니티는 계속)', async () => {
    const cands = await discoverCapability('gap', { community: true }, {
      search: async () => { throw new Error('WebSearchUnavailable'); },
      communitySearch: async () => '커뮤니티 폴백 힌트',
    });
    // search 실패해도 예외 전파 안 함 + 커뮤니티 후보는 살아있음.
    expect(cands.some(c => c.source === 'grok-x')).toBe(true);
  });

  it('graceful — 둘 다 실패해도 빈 배열(미션 킬러 아님)', async () => {
    const cands = await discoverCapability('gap', {}, {
      search: async () => { throw new Error('down'); },
      communitySearch: async () => { throw new Error('down'); },
    });
    expect(cands).toEqual([]);
  });

  it('limit 상한(≤20) 적용', async () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ url: `u${i}`, title: `t${i}`, snippet: 's' }));
    const cands = await discoverCapability('gap', { limit: 100, community: false }, {
      search: async (_q, limit) => { expect(limit).toBeLessThanOrEqual(20); return mkResult(many); },
    });
    expect(cands.length).toBeLessThanOrEqual(20);
  });

  it('⚠️ community 포함해도 총 반환 개수 ≤ limit(리뷰 must-fix·off-by-one)', async () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ url: `u${i}`, title: `t${i}`, snippet: 's' }));
    const cands = await discoverCapability('gap', { limit: 8, community: true }, {
      search: async (_q, webLimit) => { expect(webLimit).toBe(7); return mkResult(many); }, // web 슬롯 1 예약
      communitySearch: async () => '커뮤니티 힌트',
    });
    expect(cands.length).toBe(8);                          // 7 web + 1 community = limit(초과 없음)
    expect(cands.filter(c => c.source === 'grok-x').length).toBe(1); // 커뮤니티 후보 보존
  });
});
