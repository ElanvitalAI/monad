import { test, expect, describe } from 'bun:test';
import { assembleDetailMarkdown, uploadMorningReport } from './morning-detail.js';
import type { MorningSources } from './morning-synthesis.js';

function fakeSources(over: Partial<MorningSources> = {}): MorningSources {
  return {
    nowIso: '2026-07-10T00:00:00Z', dateKr: '7월 10일 (금)',
    regime: null, regimeSummary: '🟢위험선호 +0.52', regimeRipple: '',
    macro: '유가 ▲ · 달러 ▼', finviz: 'breadth 301↑/202↓',
    backbone: 'bonds -36.0 down\ncash -11.8 down', rotation: 'equities_kr 68.2 HOLD',
    country: 'kr 68.2 HOLD', sector: 'industrials 69.4 HOLD', movers13f: 'Amazon 7 6.3',
    dislocation: '', semis: null, usPulse: { date: '2026-07-09', report: '반도체 섹터 +1.2%' },
    board: {
      generatedAt: '2026-07-10T00:00:00Z', regime: null, capstone: null,
      feed: [
        { source: 'buzz', ts: '2026-07-10T00:00:00Z', title: '하이닉스 급부상 x120', detail: '120건 언급' },
        { source: 'dig', ts: '2026-07-10T00:00:00Z', title: '🔎 HBM 수요', detail: '상승 지속' },
        { source: 'reflection', ts: '2026-07-10T00:00:00Z', title: '🧠 replay 회고', detail: '국면 유지' },
      ],
      bySource: {},
    },
    ...over,
  };
}

describe('morning-detail — assembleDetailMarkdown', () => {
  test('핵심 섹션 포함', () => {
    const md = assembleDetailMarkdown(fakeSources());
    expect(md).toContain('# 🌅 Conatus 상세 아침 브리핑');
    expect(md).toContain('## 🧭 국면');
    expect(md).toContain('## 🇺🇸 미국장 (2026-07-09 결산)');
    expect(md).toContain('## 💬 커뮤니티 버즈');
    expect(md).toContain('하이닉스 급부상 x120');
    expect(md).toContain('## 🧠 회고·기억 루프');
    // 정량 테이블은 코드펜스로 정렬 보존.
    expect(md).toContain('```\nbonds -36.0 down');
  });
  test('빈 소스는 섹션 스킵(fail-soft)', () => {
    const md = assembleDetailMarkdown(fakeSources({ usPulse: null, finviz: '', macro: '',
      board: { generatedAt: '', regime: null, capstone: null, feed: [], bySource: {} } }));
    expect(md).not.toContain('미국장');
    expect(md).not.toContain('커뮤니티 버즈');
    expect(md).toContain('# 🌅 Conatus 상세 아침 브리핑');   // 헤더는 항상
  });
});

describe('morning-detail — uploadMorningReport', () => {
  test('S3 불가 시 null(fail-soft) 또는 URL 쌍', () => {
    const r = uploadMorningReport('2026-07-10', '# 테스트');
    // 테스트 환경 S3 미구성이면 null. 구성돼 있으면 md/html URL 쌍.
    if (r) { expect(r.mdUrl).toContain('.md'); expect(r.htmlUrl).toContain('.html'); }
    else expect(r).toBeNull();
  });
});
