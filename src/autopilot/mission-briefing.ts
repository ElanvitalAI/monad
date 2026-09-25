// ── 미션 최종 브리핑 (PLAN-mission-pre-arming-briefing-2026-07-15) ─────────────
//
// 실집행(arming) 직전, 미션의 전 생애를 종합해 사람이 최종 승인을 판단하게 한다:
//   ① 골 진화 대비(최초/중간/최종) ② 여정(편집·분할·결정·외부개입) ③ 실제 산출물 grounded 점검
//   (로직·리소스·PR·claim vs 현실 drift) ④ 정착 상태 ⑤ 실집행 승인 대상.
// 순수 합성(readers 주입) — 전 소스가 이미 존재하므로 종합만 한다. 카드/문서/기록은 배선측.

import type { MissionArc } from '../task-orchestrator/mission.js';
import type { MissionHistoryEvent } from './mission-history.js';
import type { RouteDecision } from '../llm/route-decision.js';

export interface GoalGeneration { generation: number; goal: string; phaseCount: number; reason?: string }
export interface BriefingPhase { title: string; status: string; prUrl?: string; isImpl: boolean }
/** drift 심각도(B7) — blocking=완주/arming 차단(미머지·미완) · benign=해결됨(타 PR 로 랜딩·정보). */
export type DriftSeverity = 'blocking' | 'benign';
export interface DeliverableDrift { phase: string; issue: string; severity: DriftSeverity; perceived?: string }
/** ③ grounded 관측 1건(B2) — reconcile 가 현실(PR merge·main deliverable)에서 self-derive 한 결과. */
export interface GroundedPhase { phaseTitle: string; drift: boolean; note: string; recordedPr: number | null; perceived: string }

export interface MissionBriefing {
  missionId: string;
  currentGoal: string;
  // ① 골 진화(원초→중간→현재)
  goalEvolution: GoalGeneration[];
  // ② 여정
  journey: { splits: number; edits: number; decisions: number; drifts: number; externalInterventions: number; notable: string[] };
  // ③ 산출물 grounded 점검. groundedChecked=reconcile(현실 관측)로 확정했나(B2). false=title 휴리스틱만.
  //    blockingDrifts=완주/arming 차단(미머지·미완) 개수(B7·benign=타 PR 랜딩 제외).
  deliverables: { logicPhases: string[]; prUrls: string[]; resourceCount: number; driftWarnings: DeliverableDrift[]; blockingDrifts: number; groundedChecked: boolean };
  // ④ 정착
  settlement: { arcs: Array<{ name: string; status: string; phaseCount: number }>; phasesDone: number; phasesTotal: number; missionStatus: string };
  //   분해 계획 — 전 페이즈(제목·상태). deliverables(완료 산출물)와 달리 "무엇을 빌드할지"를 담아
  //   갓 분해된(미빌드) 미션의 승인 UX 에서 계획이 보이게 한다(대표 2026-07-16 · phasesDone<total 갭).
  plan: Array<{ title: string; status: string }>;
  // ⑤ 실집행 승인 대상
  pendingArming?: { phaseId: string; title: string };
  /** Optional R0 evidence.  A future execution recorder supplies this; the
   * briefing remains read-only when no decision has been persisted. */
  routeDecision?: RouteDecision;
}

export interface BriefingReaders {
  revisions?: () => { currentGoal?: string; history: Array<{ generation: number; goal?: string; reason: string; phases: readonly { title: string; status: string }[] }> } | null;
  history?: () => MissionHistoryEvent[];
  mission?: () => { arcs?: readonly MissionArc[]; status: string } | null;
  phases?: () => BriefingPhase[];
  resourceCount?: () => number;
  /** ③ grounded 관측(B2) — reconcile 로 현실(PR merge·main deliverable) 대조. 없으면 title 휴리스틱 폴백. */
  grounded?: () => GroundedPhase[];
  routeDecision?: () => RouteDecision | null;
}

const IMPL_RE = /구현|배선|정규화|판정|게시|변환|산출|중재|라우팅|검증|추가|생성/;

/** 구조화 브리핑 종합 — 순수·readers 주입(테스트/실 소스). */
export function buildMissionBriefing(
  missionId: string,
  opts: { pendingArming?: { phaseId: string; title: string }; readers?: BriefingReaders } = {},
): MissionBriefing {
  const r = opts.readers ?? {};
  const rev = r.revisions?.() ?? null;
  const hist = r.history?.() ?? [];
  const m = r.mission?.() ?? null;
  const phases = r.phases?.() ?? [];
  const routeDecision = r.routeDecision?.() ?? undefined;

  // ① 골 진화 — 세대 스냅샷(원초 gen 0 → 중간) + 현재 골. rerun/rebuild 는 골 불변인데도 세대를
  //   올려 동일 스냅샷이 연달아 쌓인다(a6230f=11세대 대부분 동일 골) → 골+페이즈수가 같은 연속
  //   중복은 접어 "의미 있는 구조 전이"만 남긴다(원초→구조 변화→정착 대비가 선명해진다·keep-first).
  const goalEvolution: GoalGeneration[] = [];
  for (const g of rev?.history ?? []) {
    if (!g.goal) continue;
    const prev = goalEvolution[goalEvolution.length - 1];
    if (prev && prev.goal === g.goal && prev.phaseCount === g.phases.length) continue; // no-op 세대 접기
    goalEvolution.push({ generation: g.generation, goal: g.goal, phaseCount: g.phases.length, reason: g.reason });
  }
  const currentGoal = rev?.currentGoal ?? goalEvolution[goalEvolution.length - 1]?.goal ?? '';
  const currentEntry: GoalGeneration = { generation: (rev?.history?.[rev.history.length - 1]?.generation ?? -1) + 1, goal: currentGoal, phaseCount: phases.length, reason: 'current' };
  const lastKept = goalEvolution[goalEvolution.length - 1];
  // 정착이 마지막 스냅샷과 같은 형상이면 별도 줄 대신 그 줄을 'current'로 승격(중복 방지).
  if (lastKept && lastKept.goal === currentEntry.goal && lastKept.phaseCount === currentEntry.phaseCount) lastKept.reason = 'current';
  else goalEvolution.push(currentEntry);

  // ② 여정 — 히스토리 kind 롤업 + 주목 이벤트(결정/drift).
  const journey = {
    splits: hist.filter((e) => e.kind === 'split').length,
    edits: hist.filter((e) => e.kind === 'edit').length,
    decisions: hist.filter((e) => e.kind === 'decision').length,
    drifts: hist.filter((e) => e.kind === 'drift').length,
    externalInterventions: hist.filter((e) => e.kind === 'decision' && /telegram|operator|external/i.test(e.summary)).length,
    notable: hist.filter((e) => e.kind === 'decision' || e.kind === 'drift').slice(-6).map((e) => `${e.op}: ${e.summary.slice(0, 80)}`),
  };

  // ③ 산출물 grounded 점검 — impl 페이즈의 PR 실존, done 인데 산출 없으면 drift 경고.
  const implPhases = phases.filter((p) => p.isImpl || IMPL_RE.test(p.title));
  const prUrls = [...new Set(phases.map((p) => p.prUrl).filter((u): u is string => !!u))];
  // grounded reader 있으면 reconcile(현실 관측·B2)로 drift 확정 — 기록 PR 이 실제 merge 됐나·deliverable
  //   이 main 에 있나까지 대조(claim vs 현실). 없으면 title 휴리스틱(done impl 인데 PR 없음)으로 폴백.
  const grounded = r.grounded?.() ?? null;
  // 심각도 분류(B7) — pending(미머지 open)·incomplete(PR닫힘+deliverable 없음)=blocking(완주 차단),
  //   landed-elsewhere(타 PR 로 랜딩)=benign(해결·정보). 휴리스틱 폴백(grounded 없음)은 보수적 blocking.
  const driftWarnings: DeliverableDrift[] = grounded
    ? grounded.filter((g) => g.drift).map((g): DeliverableDrift => ({
        phase: g.phaseTitle, issue: g.note, perceived: g.perceived,
        severity: (g.perceived === 'pending' || g.perceived === 'incomplete') ? 'blocking' : 'benign',
      }))
    : phases
      .filter((p) => p.status === 'done' && (p.isImpl || IMPL_RE.test(p.title)) && !p.prUrl && !/SKIPPED|skip|건너/i.test(p.title))
      .map((p): DeliverableDrift => ({ phase: p.title, issue: 'done 인데 PR/산출물 확인 안 됨(grounded 미확정)', severity: 'blocking' }));
  const deliverables = {
    logicPhases: implPhases.filter((p) => p.status === 'done').map((p) => p.title),
    prUrls,
    resourceCount: r.resourceCount?.() ?? 0,
    driftWarnings,
    blockingDrifts: driftWarnings.filter((d) => d.severity === 'blocking').length,
    groundedChecked: !!grounded,
  };

  // ④ 정착
  const arcs = (m?.arcs ?? []).map((a) => ({ name: a.name, status: a.status, phaseCount: a.phaseIds.length }));
  const settlement = {
    arcs,
    phasesDone: phases.filter((p) => p.status === 'done').length,
    phasesTotal: phases.length,
    missionStatus: m?.status ?? 'unknown',
  };

  // 분해 계획 — 전 페이즈(제목·상태). 미빌드 미션의 "무엇을 빌드할지"를 승인 UX 에 노출.
  const plan = phases.map((p) => ({ title: p.title, status: p.status }));

  return {
    missionId, currentGoal, goalEvolution, journey, deliverables, settlement, plan,
    ...(routeDecision ? { routeDecision } : {}),
    ...(opts.pendingArming ? { pendingArming: opts.pendingArming } : {}),
  };
}

/** 골 첫 문장(제목) — 하드 컷 대신 문장 경계로 자른다(잘림 방지). 없으면 전체(길면 …). */
function goalHeadline(goal: string): string {
  const first = (goal.split(/(?<=[.。])\s/)[0] ?? goal).trim();
  return first.length > 140 ? `${first.slice(0, 138).trimEnd()}…` : first;
}

/**
 * 요약 브리핑 텍스트(텔레그램 본문). 단계 인지(stage-aware·대표 2026-07-16 가독성) — 빌드 전
 * 미션은 "무엇을 빌드할지"(아크·분해 계획)를 앞세우고, 전부 0 인 여정/산출물 같은 무의미한
 * 팩트 나열은 접는다. 아크는 이름 전체를 한 줄에 하나씩(종전 8자 슬라이스로 "무·e"처럼 깨지던
 * 것 수복). 골은 문장 경계로 잘라 중간 잘림을 막는다.
 */
export function formatBriefingSummary(b: MissionBriefing): string {
  const dv = b.deliverables;
  const st = b.settlement;
  // 빌드 시작 여부 — planning(전부 0)이면 여정/산출물은 의미 없어 접는다.
  const built = st.phasesDone > 0 || dv.prUrls.length > 0 || dv.logicPhases.length > 0;
  const L: string[] = [];

  L.push(built ? `📋 미션 최종 브리핑 — 실집행 전 점검` : `📋 미션 브리핑 — 승인 대기(빌드 전)`);
  L.push(`🎯 ${goalHeadline(b.currentGoal)}`);

  // 아크 — 이름 전체를 한 줄에 하나씩(대표 지시).
  if (st.arcs.length) {
    L.push(``, `🧩 아크 ${st.arcs.length}개 · ${st.phasesTotal}페이즈`);
    for (const a of st.arcs) {
      const name = a.name.length > 64 ? `${a.name.slice(0, 62)}…` : a.name;
      L.push(`  · ${name} [${a.status}]`);
    }
  }

  // 분해 계획 — 미완 페이즈를 한 줄에 하나씩("무엇을 빌드할지").
  if (st.phasesDone < st.phasesTotal && b.plan.length) {
    L.push(``, `📐 분해 계획 (${st.phasesDone}/${st.phasesTotal})`);
    b.plan.slice(0, 12).forEach((p, i) => {
      const badge = p.status === 'done' ? '✓' : /run|prog|active/i.test(p.status) ? '▸' : `${i}.`;
      L.push(`  ${badge} ${p.title.slice(0, 64)}`);
    });
    if (b.plan.length > 12) L.push(`  … 외 ${b.plan.length - 12}개`);
  }

  // 여정 — 실제 활동이 있을 때만(전부 0 이면 생략).
  const j = b.journey;
  const jp = [
    j.splits && `split ${j.splits}`, j.edits && `편집 ${j.edits}`, j.decisions && `결정 ${j.decisions}`,
    j.externalInterventions && `외부개입 ${j.externalInterventions}`, j.drifts && `drift ${j.drifts}`,
  ].filter(Boolean);
  if (jp.length) L.push(``, `🛤 여정: ${jp.join(' · ')}`);

  // 산출물 — 빌드된 미션만(planning 은 전부 0 이라 생략).
  const benign = dv.driftWarnings.length - dv.blockingDrifts;
  if (built) {
    L.push(``, `📦 산출물: 완료 ${dv.logicPhases.length}페이즈 · PR ${dv.prUrls.length} · 리소스 ${dv.resourceCount}`);
    if (dv.blockingDrifts) L.push(`⛔ 완주 차단: ${dv.blockingDrifts}건 미머지/미완 — 실집행 전 처리 필요(상세는 첨부 리포트)`);
    else if (benign) L.push(`ℹ️ 참고: ${benign}건은 타 PR 로 랜딩됨(해결·완주 지장 없음)`);
    else if (dv.groundedChecked) L.push(`✓ grounded — 완료 산출물 확인됨`);
  }

  // 상태 한 줄 + 진화(세대 여럿일 때만).
  L.push(``, `🔎 ${st.phasesDone}/${st.phasesTotal} done · ${st.missionStatus}${built ? '' : ' · armed=false'}`);
  if (b.goalEvolution.length > 1 && b.goalEvolution[0]) {
    L.push(`↳ 진화: 원초 ${b.goalEvolution[0].phaseCount}페이즈 → ${b.goalEvolution.length}세대 → 정착 ${st.phasesTotal}페이즈`);
  }

  if (b.pendingArming) L.push(``, `🔒 실집행 승인 대상: ${b.pendingArming.title} (실 매매 경로)`);
  if (b.routeDecision) L.push(`🤖 모델: ${b.routeDecision.provider}/${b.routeDecision.model}`);
  if (!built) L.push(``, `승인 시 아크 순차 빌드 시작 · 실집행/파괴/arming 은 별도 HITL`);
  return L.join('\n');
}

/** 전체 브리핑 리포트(md·길면 문서 첨부). */
export function formatBriefingReport(b: MissionBriefing): string {
  const L: string[] = [`# 미션 최종 브리핑 — ${b.missionId}`, ``, `## 현재 골`, b.currentGoal, ``];
  L.push(`## ① 골 진화 (최초 → 중간 → 최종)`);
  b.goalEvolution.forEach((g, i) => L.push(`${i + 1}. [gen${g.generation}·${g.reason ?? ''}] (${g.phaseCount}페이즈) ${g.goal.slice(0, 120)}`));
  L.push(``, `## ② 여정`, `- split ${b.journey.splits} · 편집 ${b.journey.edits} · 결정 ${b.journey.decisions}(외부 개입 ${b.journey.externalInterventions}) · drift 감지 ${b.journey.drifts}`);
  if (b.journey.notable.length) { L.push(`- 주요 결정/감지:`); for (const n of b.journey.notable) L.push(`  · ${n}`); }
  L.push(``, `## ③ 실제 산출물 grounded 점검`);
  L.push(`- 로직(구현 완료 페이즈 ${b.deliverables.logicPhases.length}):`); for (const p of b.deliverables.logicPhases) L.push(`  · ${p}`);
  L.push(`- PR ${b.deliverables.prUrls.length}: ${b.deliverables.prUrls.join(' ')}`);
  L.push(`- 리소스(살아있는 크론/태스크): ${b.deliverables.resourceCount}`);
  const blocking = b.deliverables.driftWarnings.filter((d) => d.severity === 'blocking');
  const benignD = b.deliverables.driftWarnings.filter((d) => d.severity === 'benign');
  if (blocking.length) { L.push(`- ⛔ 완주 차단 (미머지/미완·claim vs 현실):`); for (const d of blocking) L.push(`  · ${d.phase} — ${d.issue}`); }
  if (benignD.length) { L.push(`- ℹ️ 해결됨 (타 PR 로 랜딩·완주 지장 없음):`); for (const d of benignD) L.push(`  · ${d.phase} — ${d.issue}`); }
  if (!b.deliverables.driftWarnings.length) L.push(`- ✅ grounded: 완료 페이즈 산출물 확인됨`);
  // 분해 계획(전 페이즈) — 산출물(완료)과 별개로 "무엇을 빌드할지" 전량. 미빌드 승인 검토용(대표 2026-07-16).
  if (b.plan.length) {
    L.push(``, `## ③.5 분해 계획 (${b.settlement.phasesDone}/${b.settlement.phasesTotal} done)`);
    b.plan.forEach((p, i) => L.push(`${i}. [${p.status}] ${p.title}`));
  }
  L.push(``, `## ④ 정착 상태`);
  for (const a of b.settlement.arcs) L.push(`- 아크 "${a.name}" [${a.status}] (${a.phaseCount}페이즈)`);
  L.push(`- 페이즈 ${b.settlement.phasesDone}/${b.settlement.phasesTotal} done · 미션 ${b.settlement.missionStatus}`);
  if (b.pendingArming) L.push(``, `## ⑤ 실집행 승인 대상`, `- ${b.pendingArming.title} (실 매매 집행 경로·arming HITL)`);
  if (b.routeDecision) L.push(``, `## 모델 선택 근거`, `- ${b.routeDecision.provider}/${b.routeDecision.model}${b.routeDecision.effort ? ` · effort ${b.routeDecision.effort}` : ''}`, `- ${b.routeDecision.source}: ${b.routeDecision.rationale}`);
  L.push(``, `---`, `*생성: 미션 최종 브리핑 · 승인/재조치/보류 판단용*`);
  return L.join('\n');
}
