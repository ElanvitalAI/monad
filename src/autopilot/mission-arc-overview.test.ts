import { describe, it, expect } from 'bun:test';
import { formatArcOverview, formatArcCompact } from './mission-notify.js';
import type { MissionArc } from '../task-orchestrator/mission.js';

function arc(id: string, name: string, deps: string[], phases: number, over?: boolean): MissionArc {
  return {
    arcId: id, name, intent: `${name} 서브골`,
    phaseIds: Array.from({ length: phases }, (_, i) => `${id}-p${i}`),
    dependsOnArcs: deps, acceptance: [], status: 'pending',
    ...(over ? { preflightVerdict: { verdict: 'over_scope' as const, reason: 'r', action: 'narrow' as const } } : {}),
  };
}

describe('A2.5 아크 구조 개요 (formatArcOverview)', () => {
  it('flat(단일/암묵1아크)은 빈 문자열', () => {
    expect(formatArcOverview(undefined)).toBe('');
    expect(formatArcOverview([arc('a', '아크', [], 3)])).toBe('');
  });

  it('다중 아크는 이름·페이즈수·선행 노출', () => {
    const s = formatArcOverview([
      arc('a1', '관측 계약', [], 3),
      arc('a2', '게이팅', ['a1'], 2),
      arc('a3', '집행', ['a2'], 2),
    ]);
    expect(s).toContain('아크 3개로 구조화');
    expect(s).toContain('1. 관측 계약 — 3페이즈');
    expect(s).toContain('2. 게이팅 — 2페이즈 (선행: 관측 계약)');
    expect(s).toContain('3. 집행 — 2페이즈 (선행: 게이팅)');
  });

  it('preflight 허상/과대 아크는 경고 플래그', () => {
    const s = formatArcOverview([arc('a1', '핵심', [], 2), arc('a2', '허상후보', ['a1'], 2, true)]);
    expect(s).toContain('⚠️over_scope');
  });

  it('G2/B1 — 아크별 예산 + 총 예산 노출(estimatedCost 있을 때)', () => {
    const a1 = { ...arc('a1', '관측', [], 3), estimatedCost: 3.6 };
    const a2 = { ...arc('a2', '집행', ['a1'], 2), estimatedCost: 2.4 };
    const s = formatArcOverview([a1, a2]);
    expect(s).toContain('~$3.60');
    expect(s).toContain('~$2.40');
    expect(s).toContain('총 예산 ~$6.00');
  });

  it('예산 미산정이면 예산 줄 생략(하위호환)', () => {
    const s = formatArcOverview([arc('a1', '관측', [], 2), arc('a2', '집행', ['a1'], 2)]);
    expect(s).not.toContain('총 예산');
  });
});

describe('갭3 카드용 컴팩트 아크 개요 (formatArcCompact·2026-07-19)', () => {
  it('flat(단일/암묵1아크)은 빈 문자열', () => {
    expect(formatArcCompact(undefined)).toBe('');
    expect(formatArcCompact([arc('a', '아크', [], 3)])).toBe('');
  });

  it('다중 아크는 아크별 페이즈를 한눈에(①이름·Np)', () => {
    const s = formatArcCompact([
      arc('a1', '기반·수집', [], 3),
      arc('a2', '요약·전달', ['a1'], 2),
      arc('a3', '저장·검증', ['a2'], 2),
    ]);
    expect(s).toContain('아크 3개');
    expect(s).toContain('① 기반·수집 · 3p');
    expect(s).toContain('② 요약·전달 · 2p');
    expect(s).toContain('③ 저장·검증 · 2p');
    // 컴팩트 — 예산/선행 상세는 넣지 않는다(그건 formatArcOverview 소관).
    expect(s).not.toContain('선행');
    expect(s).not.toContain('총 예산');
  });

  it('preflight 허상/과대 아크는 경고 플래그', () => {
    const s = formatArcCompact([arc('a1', '핵심', [], 2), arc('a2', '허상후보', ['a1'], 2, true)]);
    expect(s).toContain('⚠️over_scope');
  });

  it('phaseTitles 주면 아크 아래 상세 페이즈 제목 중첩(대표 2026-07-19)', () => {
    const arcs = [arc('a1', '기반·수집', [], 2), arc('a2', '저장·검증', ['a1'], 1)];
    // arc() 는 phaseIds 를 `${id}-p${i}` 로 만든다 → a1-p0,a1-p1,a2-p0
    const titles = new Map<string, string>([
      ['a1-p0', '재사용 지점 조사'],
      ['a1-p1', 'ContentDocument 계약'],
      ['a2-p0', 'Obsidian 저장 구현'],
    ]);
    const s = formatArcCompact(arcs, titles);
    expect(s).toContain('① 기반·수집 · 2p');
    expect(s).toContain('• 재사용 지점 조사');
    expect(s).toContain('• ContentDocument 계약');
    expect(s).toContain('② 저장·검증 · 1p');
    expect(s).toContain('• Obsidian 저장 구현');
  });

  it('phaseTitles 없으면 종전대로 카운트만(하위호환)', () => {
    const s = formatArcCompact([arc('a1', '기반', [], 2), arc('a2', '검증', ['a1'], 1)]);
    expect(s).toContain('① 기반 · 2p');
    expect(s).not.toContain('•');
  });
});
