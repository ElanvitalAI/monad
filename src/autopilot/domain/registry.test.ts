// DomainPack 레지스트리·타입 단위테스트 — 순수(무네트워크). D0.
import { describe, test, expect, beforeEach } from 'bun:test';
import { DOMAINS, isDomain, type DomainPack } from './types.js';
import {
  registerDomain, getDomainPack, listRegisteredDomains, resetDomainRegistryForTest,
} from './registry.js';
import { GENERAL_PACK } from './general-pack.js';

beforeEach(() => resetDomainRegistryForTest());

describe('Domain 타입', () => {
  test('DOMAINS = 기본 3축 + general', () => {
    expect([...DOMAINS]).toEqual(['coding', 'investment', 'business', 'general']);
  });
  test('isDomain 가드', () => {
    expect(isDomain('coding')).toBe(true);
    expect(isDomain('investment')).toBe(true);
    expect(isDomain('legal')).toBe(false);
    expect(isDomain(null)).toBe(false);
    expect(isDomain(42)).toBe(false);
  });
});

describe('레지스트리 폴백 — 항상 유효 팩', () => {
  test('기본 3축 + general 모두 등록(빌트인)', () => {
    expect(new Set(listRegisteredDomains())).toEqual(new Set(['general', 'coding', 'investment', 'business']));
  });
  test('부정 도메인 → general 폴백', () => {
    expect(getDomainPack('legal').domain).toBe('general');
    expect(getDomainPack(null).domain).toBe('general');
    expect(getDomainPack(undefined).domain).toBe('general');
  });
  test('general 은 기본 등록되어 있다(reset 후에도)', () => {
    expect(listRegisteredDomains()).toContain('general');
    expect(getDomainPack('general')).toBe(GENERAL_PACK);
  });
});

describe('registerDomain — 새 분야 1개 추가', () => {
  const fakeInvestment: DomainPack = {
    domain: 'investment',
    label: '투자',
    decompose: {
      goalKind: 'ops',
      objectivePreamble: (g) => `다음 투자 목표를 관측→리서치→판단→집행으로 분해한다: "${g}"`,
    },
    research: {
      assessNeed: async () => ({ needed: true, reason: '시장데이터 필요' }),
      invoke: async () => ({ ok: true, output: 'omni-market stub' }),
    },
  };

  test('등록 후 조회', () => {
    registerDomain(fakeInvestment);
    const p = getDomainPack('investment');
    expect(p.domain).toBe('investment');
    expect(p.decompose.goalKind).toBe('ops');
    expect(p.decompose.objectivePreamble('삼성 매수')).toContain('투자 목표');
    expect(listRegisteredDomains()).toEqual(expect.arrayContaining(['general', 'investment']));
  });

  test('같은 도메인 재등록 = 덮어씀(멱등)', () => {
    registerDomain(fakeInvestment);
    registerDomain({ ...fakeInvestment, label: '투자v2' });
    expect(getDomainPack('investment').label).toBe('투자v2');
    expect(listRegisteredDomains().filter((d) => d === 'investment')).toHaveLength(1);
  });
});

describe('coding 팩 — 빌트인 기본 등록(D2)', () => {
  test('coding 은 reset 후에도 기본 등록', () => {
    expect(listRegisteredDomains()).toContain('coding');
    const p = getDomainPack('coding');
    expect(p.domain).toBe('coding');
    expect(p.decompose.goalKind).toBe('coding');
    // 회귀0 — 기존 mission-engine 프리앰블 문자열 그대로.
    expect(p.decompose.objectivePreamble('X 구현')).toBe('elanous 에 다음 미션을 구현한다: "X 구현"');
  });
});

describe('investment 팩 — 빌트인 기본 등록(D3)', () => {
  test('investment 등록 + 투자 성격 분해', () => {
    expect(listRegisteredDomains()).toContain('investment');
    const p = getDomainPack('investment');
    expect(p.domain).toBe('investment');
    // 코딩 nudge 회피(ops).
    expect(p.decompose.goalKind).toBe('ops');
    expect(p.decompose.objectivePreamble('삼성 매수')).toContain('투자 목표');
    // 관측·리서치 강제 + mandate 게이트(§3.6).
    expect(p.decompose.phaseShapeHint).toContain('관측');
    expect(p.decompose.phaseShapeHint).toContain('리서치');
    expect(p.decompose.phaseShapeHint).toContain('mandate');
    expect(p.decompose.phaseShapeHint).toContain('직행하지');
  });
  test('investment research 는 관측 필수(needed=true)', async () => {
    const need = await getDomainPack('investment').research.assessNeed('삼성 매매');
    expect(need.needed).toBe(true);
  });
});

describe('business 팩 — 빌트인 기본 등록(D4·지식노동)', () => {
  test('business 등록 + 지식업무 분해', () => {
    const p = getDomainPack('business');
    expect(p.domain).toBe('business');
    expect(p.decompose.goalKind).toBe('business');   // 코딩 nudge 회피
    expect(p.decompose.objectivePreamble('시장 리포트')).toContain('지식 업무');
    // 수집→분석→작성→검토 + 근거/출처(§3.7).
    expect(p.decompose.phaseShapeHint).toContain('조사');
    expect(p.decompose.phaseShapeHint).toContain('출처');
    // safetyGate 없음(부작용 없는 read/write doc).
    expect(p.safetyGate).toBeUndefined();
  });
});

describe('general 팩 — 보수 기본값', () => {
  test('research 는 외부조사 강제 안 함(needed=false)', async () => {
    const need = await GENERAL_PACK.research.assessNeed('아무 골');
    expect(need.needed).toBe(false);
    const inv = await GENERAL_PACK.research.invoke('아무 골');
    expect(inv.ok).toBe(false);
  });
  test('decompose 는 중립 어투', () => {
    expect(GENERAL_PACK.decompose.goalKind).toBe('general');
    expect(GENERAL_PACK.decompose.objectivePreamble('X')).toContain('달성한다');
  });
});
