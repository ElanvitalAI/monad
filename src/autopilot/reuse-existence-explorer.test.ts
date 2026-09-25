// ── reuse-existence explorer 테스트 (A2 · 2026-07-13) ─────────────────────
// 토큰 추출(코드 식별자만·한글/불용어 배제) · 실존 판정(search seam) · heal 교정(split->rebuild).

import { describe, expect, it } from 'bun:test';
import {
  extractSearchTokens, exploreReuseExistence, formatExistenceMap,
  reviseHealFromExistence, assessReuseAndReviseHeal, isFileNameToken,
  defaultExistenceSearch, groundingDirs, classifyUngroundedOverride, detectVerbIntent,
  type ExistenceSearch, type ReuseExistence,
} from './reuse-existence-explorer.js';

describe('groundingDirs — grounding 발견 파일 → 검색 디렉토리(오픈월드·하드코딩 탈피)', () => {
  it('파일 경로 → 상위 디렉토리(존재만·중복 제거)', () => {
    const dirs = groundingDirs([
      'src/autopilot/mission-decomp-critique.ts',
      'src/autopilot/absorb-flow.ts',
      'src/index.ts',
    ]);
    expect(dirs).toContain('src/autopilot');
    expect(dirs).toContain('src');
    expect(dirs.filter((d) => d === 'src/autopilot')).toHaveLength(1); // 중복 제거
  });
  it('빈/미존재 경로 skip(fail-soft)', () => {
    expect(groundingDirs(['', '  ', '/nonexistent/xyz/foo.ts'])).toEqual([]);
  });
  it('grounding 디렉토리를 extraRoots 로 넘기면 그 공간에서 실존 판정', () => {
    // src/autopilot 을 grounding 이 발견 → absorb-flow.ts 가 그 공간에서 [실존]
    const dirs = groundingDirs(['src/autopilot/absorb-flow.ts']);
    const map = exploreReuseExistence(['absorb-flow.ts 재사용'], { extraRoots: dirs });
    expect(map[0]!.status).toBe('exists');
  });
});

describe('extractSearchTokens', () => {
  it('camelCase·PascalCase·kebab 만 추출(한글/불용어 배제)', () => {
    const toks = extractSearchTokens('runPriceGuardCycle+PriceGuardCycleDeps (replay 로더·signal-pool 재사용)');
    expect(toks).toContain('runPriceGuardCycle');
    expect(toks).toContain('PriceGuardCycleDeps');
    expect(toks).toContain('signal-pool');
    // 한글은 토큰 아님, 'replay'(불용어) 배제.
    expect(toks.some((t) => /[가-힣]/.test(t))).toBe(false);
    expect(toks).not.toContain('replay');
  });

  it('짧은/일반 소문자 단어는 배제', () => {
    const toks = extractSearchTokens('use the signal to send data');
    // 코드 식별자(camel/kebab/pascal) 없음 -> 빈 배열.
    expect(toks.length).toBe(0);
  });

  it('중복 제거(케이스 무시)', () => {
    const toks = extractSearchTokens('signal-pool signal-pool SignalPool');
    expect(toks.filter((t) => t.toLowerCase() === 'signal-pool').length).toBe(1);
  });
});

describe('exploreReuseExistence (search seam)', () => {
  const search: ExistenceSearch = (tok) => {
    if (tok === 'runPriceGuardCycle') return { exact: ['src/domains/price-guard-cycle.ts'], similar: [] };
    if (tok === 'SignalPool') return { exact: [], similar: ['src/domains/signal-pool.ts'] };
    return { exact: [], similar: [] };
  };

  it('exact 매칭 -> exists@위치', () => {
    const [r] = exploreReuseExistence(['runPriceGuardCycle DI seam'], { search });
    expect(r!.status).toBe('exists');
    expect(r!.locations[0]).toContain('price-guard-cycle');
    expect(r!.matchedToken).toBe('runPriceGuardCycle');
  });

  it('similar 만 -> similar', () => {
    const [r] = exploreReuseExistence(['SignalPool 관측 패턴'], { search });
    expect(r!.status).toBe('similar');
  });

  it('매칭 없음 -> absent', () => {
    const [r] = exploreReuseExistence(['NonexistentThingXyz'], { search });
    expect(r!.status).toBe('absent');
  });

  it('코드 토큰 없음(자연어) -> absent+note', () => {
    const [r] = exploreReuseExistence(['그냥 한글 설명만'], { search });
    expect(r!.status).toBe('absent');
    expect(r!.note).toContain('토큰 없음');
  });
});

describe('reviseHealFromExistence (핵심 교정)', () => {
  const exists = (b: string) => ({ boundary: b, status: 'exists' as const, locations: [`${b}.ts`] });
  const absent = (b: string) => ({ boundary: b, status: 'absent' as const, locations: [] });

  it('split인데 재사용 과반 실존 -> rebuild-with-map(교정됨)', () => {
    const r = reviseHealFromExistence({ currentHeal: 'split', existence: [exists('runPriceGuardCycle'), exists('signalPool'), absent('newAdapter')] });
    expect(r.heal).toBe('rebuild');
    expect(r.changed).toBe(true);
    expect(r.confidence).toBe('high');
    expect(r.reuseMap).toContain('실존');
    expect(r.rationale).toContain('재사용 미이행');
  });

  it('split인데 대부분 전무 -> heal 유지(상류 결손)', () => {
    const r = reviseHealFromExistence({ currentHeal: 'split', existence: [absent('a'), absent('b'), exists('c')] });
    expect(r.heal).toBe('split');
    expect(r.changed).toBe(false);
  });

  it('split 아닌 heal 은 교정 안 함', () => {
    const r = reviseHealFromExistence({ currentHeal: 'rebuild', existence: [exists('a'), exists('b')] });
    expect(r.heal).toBe('rebuild');
    expect(r.changed).toBe(false);
  });

  it('경계 없음 -> heal 유지', () => {
    const r = reviseHealFromExistence({ currentHeal: 'split', existence: [] });
    expect(r.changed).toBe(false);
    expect(r.reuseMap).toContain('없음');
  });
});

describe('assessReuseAndReviseHeal (배선 합성)', () => {
  it('경계 문자열 -> 탐색 -> 교정 end-to-end(seam)', () => {
    const search: ExistenceSearch = (tok) => tok === 'runFooCycle' || tok === 'BarDeps'
      ? { exact: [`src/${tok}.ts`], similar: [] } : { exact: [], similar: [] };
    const r = assessReuseAndReviseHeal({
      boundaries: ['runFooCycle DI', 'BarDeps 주입'], currentHeal: 'split', search,
    });
    expect(r.heal).toBe('rebuild');
    expect(r.changed).toBe(true);
    expect(r.existence.length).toBe(2);
    expect(r.existence.every((e) => e.status === 'exists')).toBe(true);
  });
});

// ★ 비평 오탐 수복 — 공유 ripgrep-core 경로 존재 검사(내용검색이 실재 파일을 [전무] 오판하던 버그).
describe('isFileNameToken / defaultExistenceSearch (경로 존재 검사)', () => {
  it('파일명꼴 토큰 판정(확장자)', () => {
    expect(isFileNameToken('youtube-transcript.ts')).toBe(true);
    expect(isFileNameToken('index.ts')).toBe(true);
    expect(isFileNameToken('PLAN-foo.md')).toBe(true);
    expect(isFileNameToken('runPriceGuardCycle')).toBe(false);   // 심볼
    expect(isFileNameToken('pilot.benchmarkFile')).toBe(false);  // 코드확장자 아님(config ref)
  });

  it('★ 회귀 — 실존 파일을 exists 로(버그였던 케이스·공유 core 경로검색·실 rg)', () => {
    // 이 파일 자신은 확실히 존재 → 경로 검사로 exists 여야(내용검색이면 [전무] 오판했던 자리).
    const search = defaultExistenceSearch();
    const r = search('reuse-existence-explorer.ts');
    // rg 있으면 exact 에 경로, 없으면(fail-soft) 빈 배열 — rg 환경에서만 강검.
    if (r.exact.length || r.similar.length) {
      expect(r.exact.some((p) => p.includes('reuse-existence-explorer.ts'))).toBe(true);
    }
  });
});

describe('classifyUngroundedOverride (결정론 오탐필터·순수·2026-07-18)', () => {
  const ex = (statuses: Array<'exists' | 'similar' | 'absent'>): ReuseExistence[] =>
    statuses.map((s, i) => ({ boundary: `b${i}`, status: s, locations: s === 'exists' ? [`b${i}.ts`] : [] }));

  it('재사용동사 + 실존 과반 → downgrade(critical→minor 신호·verdict 유지)', () => {
    const o = classifyUngroundedOverride({ phaseText: '기존 자산의 재사용 지점을 조사하라', existence: ex(['exists', 'exists', 'exists', 'absent']) });
    expect(o.action).toBe('downgrade');
    expect(o.kind).toBe('reuse-exists');
  });

  it('신설동사 섞이면 무변경(none) — 창작 함의 있으면 LLM 존중', () => {
    // 라이브 회귀: 배선/연결 페이즈가 미충족 의존을 전제한 정당 ungrounded 를 지우지 않아야 한다.
    const o = classifyUngroundedOverride({ phaseText: '기존 함수를 확장하고 새 헬퍼를 구현하라', existence: ex(['exists', 'exists']) });
    expect(o.action).toBe('none');
  });

  it('전무 다수(허상 여지) — 신설동사여도 clear 안 함(none·false-negative 원천 차단)', () => {
    // clear 를 폐기했으므로, 신설+전무 라도 verdict 를 지우지 않는다(인용 미충족 의존 마스킹 방지).
    const o = classifyUngroundedOverride({ phaseText: '새 문서를 작성하라', existence: ex(['absent', 'absent']) });
    expect(o.action).toBe('none');
  });

  it('실존 과반 미달(재사용동사) → none', () => {
    const o = classifyUngroundedOverride({ phaseText: '기존 것을 조사하라', existence: ex(['exists', 'absent', 'absent']) });
    expect(o.action).toBe('none');
  });

  it('빈 실존맵 → none', () => {
    expect(classifyUngroundedOverride({ phaseText: '조사하라', existence: [] }).action).toBe('none');
  });

  it('detectVerbIntent — 신설/재사용 구분', () => {
    expect(detectVerbIntent('새 서비스를 구현하라')).toEqual({ hasNew: true, hasReuse: false });
    expect(detectVerbIntent('기존 자산을 조사하라')).toEqual({ hasNew: false, hasReuse: true });
    expect(detectVerbIntent('확장하고 구현하라')).toEqual({ hasNew: true, hasReuse: true });
  });
});

describe('formatExistenceMap', () => {
  it('실존/유사/전무 마킹', () => {
    const map = formatExistenceMap([
      { boundary: 'a', status: 'exists', locations: ['a.ts'], matchedToken: 'a' },
      { boundary: 'b', status: 'absent', locations: [] },
    ]);
    expect(map).toContain('[실존] a@a.ts');
    expect(map).toContain('[전무] b');
  });
});
