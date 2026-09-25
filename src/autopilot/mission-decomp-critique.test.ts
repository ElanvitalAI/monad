import { describe, it, expect } from 'bun:test';
import {
  parsePhaseCritique, critiquePhase, critiquePhaseDecomposition, formatCritiqueForHitl,
  checkReuseExistence, shouldDeescalateDownstreamDep,
  type DecompCritiquePhase,
} from './mission-decomp-critique.js';
import type { ReuseExistence } from './reuse-existence-explorer.js';

function phase(p: Partial<DecompCritiquePhase>): DecompCritiquePhase {
  return { id: 'task:x', title: 't', prompt: 'p', acceptance: [], ...p };
}
const noGround = async () => ({ context: '', grounded: true, confidence: 'high' });
/** 실존 검증 seam — 지정 심볼은 exists, 나머지는 absent(fs 미접촉·결정론). */
const existsFor = (present: readonly string[]) => (boundaries: readonly string[]): ReuseExistence[] =>
  boundaries.map((b) => present.includes(b)
    ? { boundary: b, status: 'exists' as const, locations: [`src/${b}.ts`], matchedToken: b }
    : { boundary: b, status: 'absent' as const, locations: [] });

describe('parsePhaseCritique (순수)', () => {
  it('over_scope + concerns + critical 인식', () => {
    const c = parsePhaseCritique('{"verdict":"over_scope","severity":"critical","concerns":["계산","품질검증"],"reason":"혼재","suggestion":"split"}', 'p1', '국면계산');
    expect(c.verdict).toBe('over_scope');
    expect(c.severity).toBe('critical');
    expect(c.concerns).toEqual(['계산', '품질검증']);
  });

  it('under_specified 는 needsClarification 보존', () => {
    const c = parsePhaseCritique('{"verdict":"under_specified","severity":"critical","needsClarification":"단위 결손 처리?"}', 'p2', '품질');
    expect(c.verdict).toBe('under_specified');
    expect(c.needsClarification).toBe('단위 결손 처리?');
  });

  it('ok 는 항상 minor·파싱 실패는 보수적 ok', () => {
    expect(parsePhaseCritique('{"verdict":"ok","severity":"critical"}', 'p', 't').severity).toBe('minor');
    expect(parsePhaseCritique('그냥 텍스트', 'p', 't').verdict).toBe('ok');
    expect(parsePhaseCritique('{"verdict":"weird"}', 'p', 't').verdict).toBe('ok');
  });

  it('★ 무근거 critical → minor 강등(오탐필터3·2026-07-19 dogfood) — verdict 유지', () => {
    // reason/concerns/suggestion/needsClarification 전부 빈 critical = 실체 없는 노이즈(6분 coevolve 유발).
    const c = parsePhaseCritique('{"verdict":"under_specified","severity":"critical"}', 'p', 't');
    expect(c.verdict).toBe('under_specified'); // verdict 유지(무회귀)
    expect(c.severity).toBe('minor');           // severity 강등(coevolve 미트리거)
  });

  it('근거 있는 critical 은 유지(강등 안 함)', () => {
    expect(parsePhaseCritique('{"verdict":"under_specified","severity":"critical","reason":"입력 도메인 미정"}', 'p', 't').severity).toBe('critical');
    expect(parsePhaseCritique('{"verdict":"over_scope","severity":"critical","concerns":["A","B"]}', 'p', 't').severity).toBe('critical');
  });
});

describe('critiquePhase (judge 주입·fail-soft)', () => {
  it('judge 주입 over_scope → 비평 반환', async () => {
    const c = await critiquePhase(phase({ title: '복수 지표 국면과 관측 품질을 계산하라' }), ['다른 페이즈'], {
      ground: noGround,
      judge: async () => '{"verdict":"over_scope","severity":"critical","concerns":["국면 계산","관측 품질검증"],"reason":"2관심사 혼재","suggestion":"계산/품질 분리"}',
    });
    expect(c.verdict).toBe('over_scope');
    expect(c.concerns).toContain('관측 품질검증');
  });

  it('judge 오류 → fail-soft ok', async () => {
    const c = await critiquePhase(phase({}), [], { ground: noGround, judge: async () => { throw new Error('llm down'); } });
    expect(c.verdict).toBe('ok');
  });

  it('judge 미주입(test) → 보수적 ok', async () => {
    const c = await critiquePhase(phase({}), [], { ground: noGround });
    expect(c.verdict).toBe('ok');
  });
});

describe('checkReuseExistence (결정론 자기인지·순수)', () => {
  it('지목 심볼 실존 감지 → existsCount·맵', () => {
    const s = checkReuseExistence(
      phase({ prompt: 'proposeWikiClaimsFromHandoff 를 새로 추가하라' }),
      existsFor(['proposeWikiClaimsFromHandoff']),
    );
    expect(s).not.toBeNull();
    expect(s!.existsCount).toBe(1);
    expect(s!.map).toContain('실존');
    expect(s!.existing[0]!.boundary).toBe('proposeWikiClaimsFromHandoff');
  });

  it('코드 식별자 없으면 null(무주입)', () => {
    expect(checkReuseExistence(phase({ prompt: '문서를 정리한다' }), existsFor([]))).toBeNull();
  });
});

describe('critiquePhase — 실존맵 주입 + 관측 파리티(시스템 수리)', () => {
  it('결정론 실존 맵을 critique 프롬프트에 주입한다', async () => {
    let seen = '';
    await critiquePhase(
      phase({ id: 'p1', title: '멱등 primitive', prompt: 'proposeWikiClaimsFromHandoff 를 재구현하라' }), [],
      { ground: noGround, judge: async (p) => { seen = p; return '{"verdict":"ok","severity":"minor"}'; },
        existenceCheck: existsFor(['proposeWikiClaimsFromHandoff']) },
    );
    expect(seen).toContain('결정론 재사용-실존 맵');
    expect(seen).toContain('proposeWikiClaimsFromHandoff');
    expect(seen).toContain('중복');
  });

  it('심볼 이미 실존이면 관측 관문 발화(missionId 있을 때)', async () => {
    const logs: Array<{ cat: string; ev: string }> = [];
    await critiquePhase(
      phase({ id: 'p1', title: '멱등 primitive', prompt: 'proposeWikiClaimsFromHandoff 를 추가하라' }), [],
      { ground: noGround, judge: async () => '{"verdict":"ok","severity":"minor"}',
        existenceCheck: existsFor(['proposeWikiClaimsFromHandoff']),
        missionId: 'm1', observationSinks: { logSink: (cat, ev) => logs.push({ cat, ev }) } },
    );
    expect(logs.some((l) => l.cat === 'mission.selfheal.diagnose')).toBe(true);
  });

  it('missionId 없으면 관측 미발화(로그만)', async () => {
    const logs: string[] = [];
    await critiquePhase(
      phase({ prompt: 'proposeWikiClaimsFromHandoff 를 추가하라' }), [],
      { ground: noGround, judge: async () => '{"verdict":"ok","severity":"minor"}',
        existenceCheck: existsFor(['proposeWikiClaimsFromHandoff']),
        observationSinks: { logSink: (cat) => logs.push(cat) } },
    );
    expect(logs.some((c) => c === 'mission.selfheal.diagnose')).toBe(false);
  });

  it('ungrounded critical 이면 관측 verdict=fail', async () => {
    const events: Array<{ cat: string; ev: string }> = [];
    await critiquePhase(
      phase({ id: 'p1', title: 'X', prompt: 'nonexistentSymbolFoo 를 재사용하라' }), [],
      { ground: noGround, judge: async () => '{"verdict":"ungrounded","severity":"critical","reason":"없는 전제"}',
        existenceCheck: existsFor([]), missionId: 'm1',
        observationSinks: { logSink: (cat, ev) => events.push({ cat, ev }) } },
    );
    expect(events.some((e) => e.cat === 'mission.selfheal.diagnose' && e.ev === 'fail')).toBe(true);
  });
});

describe('critiquePhase — 파이프라인 순서 grounding(B0 클래스c·2026-07-18)', () => {
  it('재사용근거 렌즈가 dependsOn 선행 산출물 소비를 정상으로 안내(배선 페이즈 오탐 방지)', async () => {
    let seen = '';
    await critiquePhase(
      phase({ id: 'wire', title: 'YouTube 경로를 연결하라', prompt: '선행 산출물을 배선' }), [],
      { ground: noGround, judge: async (p) => { seen = p; return '{"verdict":"ok","severity":"minor"}'; } },
      [{ title: 'URL 분류기를 구현하라', acceptance: ['classifyContentUrl 반환'] }],
    );
    expect(seen).toContain('선행 의존(dependsOn)이 정의하는 계약');
    expect(seen).toContain('파이프라인 순서상 빌드 시 dependsOn 선행이 먼저 생성');
    expect(seen).toContain('진짜 외부/미충족 의존');
  });
});

describe('critiquePhase — 사전정보 dependsOn 상류 계약(B0 축③·2026-07-18)', () => {
  it('upstream 컨텍스트를 프롬프트에 주입(고립 판정 방지 지침 포함)', async () => {
    let seen = '';
    await critiquePhase(
      phase({ id: 'b', title: 'URL 분류기를 구현하라', prompt: '계약을 소비해 구현' }), ['a', 'b'],
      { ground: noGround, judge: async (p) => { seen = p; return '{"verdict":"ok","severity":"minor"}'; } },
      [{ title: '공통 계약을 정의하라', acceptance: ['ContentRef 필드 정의', 'source kind 리터럴'] }],
    );
    expect(seen).toContain('선행 의존(dependsOn)이 정의하는 계약');
    expect(seen).toContain('공통 계약을 정의하라');
    expect(seen).toContain('고립 판정');
  });

  it('critiquePhaseDecomposition 이 dependsOn 을 상류 페이즈로 resolve', async () => {
    const prompts: string[] = [];
    await critiquePhaseDecomposition(
      [phase({ id: 'a', title: '계약 정의', acceptance: ['필드X 정의'] }),
       phase({ id: 'b', title: '구현', dependsOn: ['a'] })],
      { ground: noGround, judge: async (p) => { prompts.push(p); return '{"verdict":"ok","severity":"minor"}'; }, concurrency: 1 },
    );
    // b 의 프롬프트에 상류 a 의 title·acceptance 가 실려야(사전정보).
    const bPrompt = prompts.find((p) => p.includes('제목: 구현')) ?? '';
    expect(bPrompt).toContain('선행 의존(dependsOn)이 정의하는 계약');
    expect(bPrompt).toContain('계약 정의');
    expect(bPrompt).toContain('필드X 정의');
  });

  it('dependsOn 없으면 upstream 블록 미주입(무회귀)', async () => {
    let seen = '';
    await critiquePhase(
      phase({ id: 'x', title: '독립 페이즈', prompt: 'p' }), [],
      { ground: noGround, judge: async (p) => { seen = p; return '{"verdict":"ok","severity":"minor"}'; } },
    );
    // 렌즈 3 은 "선행 의존…계약" 문구를 참조하지만, 실제 upstream 블록(고유 헤더)은 미주입이어야 한다.
    expect(seen).not.toContain('이 페이즈가 소비하는 값의 출처');
  });
});

describe('critiquePhase — 명세완성 kind rubric(B0 축②·2026-07-18)', () => {
  it('프롬프트에 페이즈 kind 차등 rubric 을 주입한다(설계=항목열거 충분·구현=명세 요구)', async () => {
    let seen = '';
    await critiquePhase(
      phase({ id: 'p1', title: '수명주기를 설계하라', prompt: '스키마를 설계한다' }), [],
      { ground: noGround, judge: async (p) => { seen = p; return '{"verdict":"ok","severity":"minor"}'; } },
    );
    expect(seen).toContain('종류(kind)를 판별');
    expect(seen).toContain('설계 결과를 선요구=부당');
    expect(seen).toContain('구현/검증 페이즈');
  });
});

describe('critiquePhase — ungrounded 결정론 오탐필터(2026-07-18·정확도·무회귀)', () => {
  it('재사용 페이즈 + 실존 + ungrounded critical → severity minor(verdict 유지)', async () => {
    // 재사용동사(조사)·신설동사 없음·지목 실존(1/1) → 빌드차단 허상 근거 약함 → critical 다운그레이드.
    const c = await critiquePhase(
      phase({ id: 'p1', title: '재사용 지점', prompt: 'runFooCycle 의 재사용 지점을 조사하라' }), [],
      { ground: noGround, judge: async () => '{"verdict":"ungrounded","severity":"critical","reason":"LLM 흔들림"}',
        existenceCheck: existsFor(['runFooCycle']) },
    );
    expect(c.verdict).toBe('ungrounded');   // verdict 는 절대 안 바뀜(무회귀).
    expect(c.severity).toBe('minor');       // severity 만 de-escalate.
    expect(c.reason).toContain('결정론 오탐필터');
  });

  it('실존 심볼 재구현 지적 → note-and-pass(minor·대표 2026-07-19) — 구현 시 재사용 정정', async () => {
    const c = await critiquePhase(
      phase({ id: 'p2', title: '배선', prompt: 'runFooCycle 을 확장하고 새 헬퍼를 구현하라' }), [],
      { ground: noGround, judge: async () => '{"verdict":"ungrounded","severity":"critical","reason":"미충족 의존 전제"}',
        existenceCheck: existsFor(['runFooCycle']) },
    );
    expect(c.verdict).toBe('ungrounded');   // verdict 유지(사실 기록·무회귀)
    expect(c.severity).toBe('minor');       // 실존(runFooCycle) 있어 재사용으로 구현 시 정정 → 완화(pass)
    expect(c.reason).toContain('실존 재사용');
  });

  it('non-ungrounded verdict 는 필터 미적용(호출가드) — over_scope 그대로', async () => {
    const c = await critiquePhase(
      phase({ id: 'p3', title: 'X', prompt: 'runFooCycle 을 조사하라' }), [],
      { ground: noGround, judge: async () => '{"verdict":"over_scope","severity":"critical","reason":"과대"}',
        existenceCheck: existsFor(['runFooCycle']) },
    );
    expect(c.verdict).toBe('over_scope');
    expect(c.severity).toBe('critical');    // ungrounded 아니면 손 안 댐.
  });
});

describe('critiquePhaseDecomposition + formatCritiqueForHitl', () => {
  it('critical 있으면 hasCritical + HITL 카드 생성', async () => {
    let call = 0;
    const r = await critiquePhaseDecomposition(
      [phase({ id: 'a', title: '계산+품질' }), phase({ id: 'b', title: '조사' })],
      {
        ground: noGround,
        judge: async () => (call++ === 0
          ? '{"verdict":"over_scope","severity":"critical","concerns":["계산","품질"],"reason":"혼재","suggestion":"분리"}'
          : '{"verdict":"ok","severity":"minor"}'),
      },
    );
    expect(r.hasCritical).toBe(true);
    const card = formatCritiqueForHitl(r);
    expect(card).toContain('분해 비평');
    expect(card).toContain('과대(관심사 혼재)');
    expect(card).toContain('계산 + 품질');
  });

  it('전부 ok 면 hasCritical=false·카드 빈 문자열', async () => {
    const r = await critiquePhaseDecomposition([phase({}), phase({ id: 'b' })], {
      ground: noGround, judge: async () => '{"verdict":"ok","severity":"minor"}',
    });
    expect(r.hasCritical).toBe(false);
    expect(formatCritiqueForHitl(r)).toBe('');
  });
});

describe('critiquePhaseDecomposition — 병렬 비평(worker pool·대표 2026-07-18)', () => {
  function slowJudge(track: { active: number; max: number }): (p: string) => Promise<string> {
    return async () => {
      track.active++; track.max = Math.max(track.max, track.active);
      await new Promise((r) => setTimeout(r, 8));
      track.active--;
      return '{"verdict":"ok","severity":"minor","concerns":[],"reason":"","suggestion":""}';
    };
  }
  const phases10 = Array.from({ length: 10 }, (_, i) => phase({ id: `task:p${i}`, title: `T${i}` }));

  it('순서 보존 + 실제 병렬 + 동시성 캡(concurrency=3)', async () => {
    const track = { active: 0, max: 0 };
    const r = await critiquePhaseDecomposition(phases10, {
      judge: slowJudge(track), ground: noGround, existenceCheck: () => [], concurrency: 3,
    });
    expect(r.critiques).toHaveLength(10);
    expect(r.critiques.map((c) => c.phaseId)).toEqual(phases10.map((p) => p.id)); // ★ 순서 보존
    expect(track.max).toBeLessThanOrEqual(3);   // ★ 동시성 캡
    expect(track.max).toBeGreaterThan(1);       // ★ 실제 병렬(순차 아님)
  });

  it('concurrency=1 → 순차(동시 1개)', async () => {
    const track = { active: 0, max: 0 };
    await critiquePhaseDecomposition(phases10, {
      judge: slowJudge(track), ground: noGround, existenceCheck: () => [], concurrency: 1,
    });
    expect(track.max).toBe(1);
  });

  it('한 페이즈 실패해도 나머지 완주(fail-soft·독립)', async () => {
    let n = 0;
    const judge = async (): Promise<string> => { if (n++ === 2) throw new Error('sol 오류'); return '{"verdict":"ok","severity":"minor"}'; };
    const r = await critiquePhaseDecomposition(phases10, { judge, ground: noGround, existenceCheck: () => [], concurrency: 4 });
    expect(r.critiques).toHaveLength(10); // 실패 페이즈도 okFallback 으로 채워짐
  });
});

describe('shouldDeescalateDownstreamDep (E0 하류 의존·good-enough·순수·무회귀)', () => {
  it('ungrounded+critical+dependsOn 상류 있음 → de-escalate(true·구현서 이어짐)', () => {
    expect(shouldDeescalateDownstreamDep('ungrounded', 'critical', 1)).toBe(true);
    expect(shouldDeescalateDownstreamDep('ungrounded', 'critical', 3)).toBe(true);
  });
  it('고아([전무]+dependsOn 없음·upstream 0) → critical 유지(false·진짜 미충족)', () => {
    expect(shouldDeescalateDownstreamDep('ungrounded', 'critical', 0)).toBe(false);
  });
  it('이미 minor → 무변경(false)', () => {
    expect(shouldDeescalateDownstreamDep('ungrounded', 'minor', 2)).toBe(false);
  });
  it('ungrounded 아닌 verdict → 무영향(false·무회귀·다른 verdict 안 건드림)', () => {
    // ★ 확장(대표 2026-07-20) — under_specified(미명세)도 상류 있으면 완화(구현 페이즈가 세부 정의).
    expect(shouldDeescalateDownstreamDep('under_specified', 'critical', 2)).toBe(true);
    expect(shouldDeescalateDownstreamDep('under_specified', 'critical', 0)).toBe(false); // 상류 없으면 유지(고아 미명세)
    expect(shouldDeescalateDownstreamDep('over_scope', 'critical', 2)).toBe(false);
    expect(shouldDeescalateDownstreamDep('ok', 'critical', 2)).toBe(false);
  });
});

import { formatCritiqueSummaryLine } from './mission-decomp-critique.js';
describe('formatCritiqueSummaryLine (카드용 1줄)', () => {
  it('치명 없으면 빈 문자열', () => {
    expect(formatCritiqueSummaryLine({ critiques: [], hasCritical: false })).toBe('');
  });
  it('유형별 개수 1줄 요약', () => {
    const r = {
      critiques: [
        { phaseId: 'a', phaseTitle: 'A', verdict: 'under_specified' as const, severity: 'critical' as const, concerns: [], reason: 'r', suggestion: '' },
        { phaseId: 'b', phaseTitle: 'B', verdict: 'under_specified' as const, severity: 'critical' as const, concerns: [], reason: 'r', suggestion: '' },
        { phaseId: 'c', phaseTitle: 'C', verdict: 'ungrounded' as const, severity: 'critical' as const, concerns: [], reason: 'r', suggestion: '' },
      ],
      hasCritical: true,
    };
    const line = formatCritiqueSummaryLine(r);
    expect(line).toContain('치명 3건');
    expect(line).toContain('미명세 2');
    expect(line).toContain('근거부족 1');
    expect(line).not.toContain('\n'); // 1줄
  });
});

import { shouldDeescalateExistingReuse } from './mission-decomp-critique.js';
describe('shouldDeescalateExistingReuse (실존 재구현 완화·대표 2026-07-19)', () => {
  it('ungrounded critical + 실존 심볼 있음 → 완화(note-and-pass)', () => {
    expect(shouldDeescalateExistingReuse('ungrounded', 'critical', 2)).toBe(true);
  });
  it('실존 0건 → 유지(진짜 고아 가능)', () => {
    expect(shouldDeescalateExistingReuse('ungrounded', 'critical', 0)).toBe(false);
  });
  it('minor·다른 verdict → 무관', () => {
    expect(shouldDeescalateExistingReuse('ungrounded', 'minor', 2)).toBe(false);
    expect(shouldDeescalateExistingReuse('under_specified', 'critical', 2)).toBe(false);
  });
});
