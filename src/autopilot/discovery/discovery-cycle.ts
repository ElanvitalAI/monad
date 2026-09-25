// ── Self-Evolution · 발굴→제안 오케스트레이터 (2026-07-09) ─────────────────
//
// SE1(발굴) + SE2(제안)를 잇는 글루. 내부 미구현 로드맵(1순위) + 외부 참조 repo 흡수
// 후보(2순위)를 발굴 → 큰 기능 단위 플랜 초안 → 승인 큐 적재. 대표 승인 후 SE4 러너.
//
// 순수 조합 + 주입(scan/rank/draft/queue) — 실 fs/db 는 스크립트가 주입.

import type { UnimplementedPlan } from './roadmap-scan.js';
import type { AbsorptionCandidate } from './ref-dig.js';
import type { ProposalSeed } from '../proposal/draft-plan.js';
import { seedFromPreexistingRed, type PreexistingRedCandidate } from './preexisting-red-scan.js';

/** 미구현 로드맵 → 제안 seed(내부·1순위). */
export function seedFromUnimplemented(p: UnimplementedPlan): ProposalSeed {
  return {
    slug: p.topic,
    title: `[부활] ${p.topic} (미구현 로드맵 재우선순위)`,
    source: 'internal-roadmap',
    rationale: `내부 미구현 로드맵(${p.filename}) — 미완 ${p.openBoxes}개·완료율 ${Math.round(p.completionRatio * 100)}%. 우선순위 재산정 점수 ${p.priorityScore}(${p.reasons.join(' · ')}).`,
    evidence: [p.path, `미완 체크박스 ${p.openBoxes}개`],
    tier: p.openBoxes > 15 ? 'heavy' : 'light',
  };
}

/** 외부 흡수 후보 → 제안 seed(외부·2순위). */
export function seedFromAbsorption(c: AbsorptionCandidate): ProposalSeed {
  return {
    slug: `absorb-${c.repoKey}-${c.area.replace(/[^a-z0-9]+/gi, '-')}`.toLowerCase(),
    title: `[흡수] ${c.repoKey}/${c.area} (${c.commits} 커밋)`,
    source: 'external-repo',
    rationale: `참조 repo ${c.repoKey} ${c.area} 영역 활동(커밋 ${c.commits}·파일 ${c.files}·관심점수 ${c.score}). monad에 이식할 가치 검토.`,
    evidence: [`${c.repoKey}:${c.area}`, ...c.whatChanged.slice(0, 3)],
    tier: c.commits > 10 ? 'heavy' : 'light',
    scopeSketch: c.whatChanged.slice(0, 4).map(m => `검토·이식: ${m.slice(0, 70)}`),
  };
}

export interface CycleInput {
  unimplemented: UnimplementedPlan[];
  absorption: AbsorptionCandidate[];
  /** gate.baseline preexisting 빨강 후보(3순위). 생략·빈 목록이면 기존 두 입력원만. */
  preexistingRed?: PreexistingRedCandidate[];
  /** 이번 사이클에 제안할 최대 건수(내부/외부/빨강 각). 홍수 방지. */
  internalCap?: number;
  externalCap?: number;
  preexistingRedCap?: number;
}

export interface CyclePlan { seed: ProposalSeed; rank: number }

/** 발굴 결과 → 제안 seed 목록(내부 먼저 랭킹·cap). 실제 draft/queue 는 호출측. */
export function planProposals(input: CycleInput): CyclePlan[] {
  const internalCap = input.internalCap ?? 3;
  const externalCap = input.externalCap ?? 2;
  const preexistingRedCap = input.preexistingRedCap ?? 2;
  const out: CyclePlan[] = [];
  let rank = 1;
  for (const p of input.unimplemented.slice(0, internalCap)) out.push({ seed: seedFromUnimplemented(p), rank: rank++ });
  for (const c of input.absorption.slice(0, externalCap)) out.push({ seed: seedFromAbsorption(c), rank: rank++ });
  for (const r of (input.preexistingRed ?? []).slice(0, preexistingRedCap)) out.push({ seed: seedFromPreexistingRed(r), rank: rank++ });
  return out;
}
