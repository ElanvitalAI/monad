// ── 분해 분석 리포트 (#4498 3report · ANS 축B · 2026-07-17) ────────────────────
//
// 미션이 "왜 이렇게 분해했는지"를 설명하는 결정론 Markdown 리포트 + 워킹메모리 각인 다이제스트.
// 순수(데이터 → 텍스트). 사용자 표시/첨부(UX)는 여기서 안 한다(3B·대표 UX 통합안 소관) — 이 모듈은
// 리포트 "생성 + 미션 자기 각인"(재분해가 이전 판단을 능동회상)까지만. 제1원칙 자기인지.
//
// 참조: PLAN-mission-decompose-quality-arc-coherence-2026-07-17 §3report · 축B 각인.

import type { MissionArc } from '../task-orchestrator/mission.js';

export interface DecompReportInput {
  goal: string;
  arcs: readonly MissionArc[];
  /** 페이즈 id → title (아크 내 페이즈명 렌더용). */
  phaseTitles: Readonly<Record<string, string>>;
  /** 대표 확정 아크 수(있으면 근거로 명시). */
  arcHint?: number;
  /** C 되먹임 이력(있으면). rounds=자동 정련 횟수·residualCritical=잔여 치명. */
  critique?: { rounds: number; residualCritical: number };
}

function arcNameById(arcs: readonly MissionArc[]): Map<string, string> {
  return new Map(arcs.map((a) => [a.arcId, a.name]));
}

/** ★ 분해 분석 리포트(Markdown) — 아크 구조·의도·선행·통합 acceptance·되먹임 이력. 순수·결정론. */
export function buildDecompositionReport(input: DecompReportInput): string {
  const { goal, arcs, phaseTitles } = input;
  const nameOf = arcNameById(arcs);
  const totalPhases = new Set(arcs.flatMap((a) => a.phaseIds)).size;
  const lines: string[] = [];

  lines.push(`# 분해 분석 — ${goal.replace(/\s+/g, ' ').trim().slice(0, 120)}`);
  lines.push('');
  const head = [`아크 ${arcs.length}개`, `페이즈 ${totalPhases}개`];
  if (input.arcHint) head.push(`arcHint ${input.arcHint}`);
  lines.push(`> ${head.join(' · ')}`);
  lines.push('');

  lines.push('## 아크 구조');
  arcs.forEach((a, i) => {
    lines.push('');
    lines.push(`### A${i + 1} · ${a.name}`);
    if (a.intent) lines.push(`- 의도: ${a.intent}`);
    const titles = a.phaseIds.map((id) => phaseTitles[id] ?? id);
    lines.push(`- 페이즈 (${a.phaseIds.length}): ${titles.join(' · ') || '(없음)'}`);
    const deps = a.dependsOnArcs.map((d) => nameOf.get(d) ?? d);
    lines.push(`- 선행 아크: ${deps.length ? deps.join(', ') : '—'}`);
    lines.push(`- 통합 acceptance: ${a.acceptance.length ? a.acceptance.join(' · ') : '(없음·페이즈 로컬만)'}`);
    if (a.preflightVerdict && a.preflightVerdict.verdict !== 'founded') {
      lines.push(`- ⚠️ preflight: ${a.preflightVerdict.verdict}${a.preflightVerdict.action ? `→${a.preflightVerdict.action}` : ''}`);
    }
  });

  if (input.critique) {
    lines.push('');
    lines.push('## 되먹임 이력 (C)');
    lines.push(`- 자동 정련 ${input.critique.rounds}회 · 잔여 치명 ${input.critique.residualCritical}건`);
  }

  lines.push('');
  lines.push('## 판단 근거');
  lines.push('- 아크 경계 = 이질 deliverable 분리. 페이즈 로컬 검증이 놓치는 통합 정합(dead-code·미배선)을 아크 통합 acceptance 로 검증.');
  if (input.arcHint) lines.push(`- arcHint ${input.arcHint} = 대표 확정 아크 수 존중(결정론 파생 폴백 포함).`);
  lines.push('- 아크는 순차 배리어(dependsOn)로 실행 — 선행 아크 완주 후 다음 진입.');

  return lines.join('\n');
}

/** ★ 워킹메모리 각인용 1-2줄 다이제스트(축B) — 재분해가 이전 분해 판단을 능동회상. 순수. */
export function decompositionReportDigest(input: DecompReportInput): string {
  const totalPhases = new Set(input.arcs.flatMap((a) => a.phaseIds)).size;
  const chain = input.arcs.map((a) => a.name).join('→');
  const warn = input.arcs.filter((a) => a.preflightVerdict && a.preflightVerdict.verdict !== 'founded').length;
  const parts = [
    `분해: 아크 ${input.arcs.length}개(${chain})`,
    `페이즈 ${totalPhases}개`,
  ];
  if (input.arcHint) parts.push(`arcHint ${input.arcHint}`);
  if (input.critique) parts.push(`정련 ${input.critique.rounds}회·잔여치명 ${input.critique.residualCritical}`);
  if (warn) parts.push(`⚠️preflight 경고 ${warn}`);
  return parts.join(' · ');
}
