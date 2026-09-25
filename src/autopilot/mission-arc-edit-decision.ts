// ── 조율자 아크/페이즈 편집 결정 seam (P5b·대표 2026-07-21) ──────────────────
//
// 배경: 구현 중 페이즈가 막혔을 때(budget-exhausted·gate-failed·이미만족), 지금은 rebuild/split(bound)
// 또는 HITL 통지로만 대응한다. 대표 지시 = "구현 중 아크를 원하는 형태로 편집" + "조율자가 판단 주도·
// 히스토리안 맥락·에이전트 활용." 이 모듈 = 조율자가 "이 막힌 페이즈에 어떤 아크/페이즈 편집이 unstuck
// 하는가"를 LLM 으로 판정하는 **순수 브레인**(P4a assessPhaseNecessity 동형). 집행(이미 있는 store 편집
// 함수 호출·mid-run 안전 오케스트레이션)은 P5c 호출부. 판정만·보수적(애매하면 no-edit=현행 유지).
//
// 결정은 **이미 있는 편집 인프라에 매핑**된다(재발명 금지):
//   split-phase   → splitPhaseIntoSubphases (과대 페이즈 국소 재분해)
//   delete-phase  → deletePhaseFromMission  (이미 만족/불필요·obsolete)
//   set-arc-done  → setArcStatusInMission('done') (아크 통합 목표는 충족·leaf 실패 무의미)
//   no-edit       → (편집 없음) 정상 힐 기제 유지

export type ArcEditAction = 'no-edit' | 'split-phase' | 'delete-phase' | 'set-arc-done';

/** 막힌 페이즈 정보 — 조율자 판정 입력. */
export interface StuckPhaseInfo {
  phaseId: string;
  title: string;
  arcId?: string;
  /** failClass(budget-exhausted·gate-failed-critique·already-satisfied 등) — 결정론 지름길 근거. */
  failClass?: string;
  attempts: number;
  summary?: string;
}

/** 판정 맥락 — 히스토리안 공급. goal=의도, landed=이미 랜딩/done, arcSummary=아크 구조 요약. */
export interface ArcEditContext {
  goal: string;
  landed: readonly string[];
  arcSummary?: string;
}

export interface ArcEditDecision {
  action: ArcEditAction;
  phaseId: string;
  reason: string;
  /** set-arc-done 시 대상 arcId. */
  arcId?: string;
}

/** LLM 원시 판정(파싱 전). */
export interface RawArcEdit { action?: string; reason?: string; arcId?: string }

/** LLM 판정 seam(주입형·테스트 스텁). */
export type ArcEditResolve = (phase: StuckPhaseInfo, context: ArcEditContext) => Promise<RawArcEdit>;

const VALID_ACTIONS: ReadonlySet<string> = new Set<ArcEditAction>(['no-edit', 'split-phase', 'delete-phase', 'set-arc-done']);

/**
 * ★ 조율자 아크/페이즈 편집 결정(순수·대표 2026-07-21). 막힌 페이즈+히스토리안 맥락 → 편집 액션.
 * 결정론 지름길(already-satisfied→delete-phase) 후 LLM 판정. **보수적**: LLM 실패·유효하지 않은 액션·
 * set-arc-done 인데 arcId 부재는 전부 no-edit 폴백(잘못된 편집으로 골 손실 방지). resolve 는 seam(테스트).
 */
export async function decideArcEdit(
  phase: StuckPhaseInfo,
  context: ArcEditContext,
  resolve: ArcEditResolve,
): Promise<ArcEditDecision> {
  const noEdit = (reason: string): ArcEditDecision => ({ action: 'no-edit', phaseId: phase.phaseId, reason });

  // 결정론 지름길 — 이미 만족(already-satisfied)이면 LLM 없이 delete-phase(obsolete·실행 무의미).
  if (phase.failClass === 'already-satisfied') {
    return { action: 'delete-phase', phaseId: phase.phaseId, reason: '이미 구현/랜딩됨(already-satisfied) — obsolete 페이즈 제거' };
  }

  let raw: RawArcEdit;
  try {
    raw = await resolve(phase, context);
  } catch {
    return noEdit('아크 편집 판정 LLM 실패 — 편집 없음(fail-soft·보수적)');
  }

  if (!raw || !VALID_ACTIONS.has(raw.action ?? '')) return noEdit(`유효하지 않은 판정(${raw?.action ?? '없음'}) — 편집 없음(보수적)`);
  const action = raw.action as ArcEditAction;
  const reason = (raw.reason ?? '').slice(0, 200);

  if (action === 'no-edit') return noEdit(reason || '편집 불필요 — 현행 유지');
  // set-arc-done 은 유효한 arcId(막힌 페이즈의 arc 또는 명시)가 있어야 인정 — 없으면 no-edit(보수적).
  if (action === 'set-arc-done') {
    const arcId = raw.arcId || phase.arcId;
    if (!arcId) return noEdit('set-arc-done 인데 arcId 부재 — 편집 없음(보수적)');
    return { action, phaseId: phase.phaseId, reason, arcId };
  }
  return { action, phaseId: phase.phaseId, reason };
}

/** ★ 조율자 아크 편집 프롬프트(순수·테스트) — 히스토리안 맥락 주입·보수적 편집 지시. JSON only. */
export function arcEditPrompt(phase: StuckPhaseInfo, context: ArcEditContext): string {
  const landedBlock = context.landed.map((l, i) => `  ${i + 1}. ${l}`).join('\n');
  return [
    '너는 미션 조율자다. 구현 중 아래 페이즈가 막혔다(반복 실패). 이미 랜딩/완료된 것(히스토리안) 위에서,',
    '이 막힌 페이즈에 **어떤 아크/페이즈 편집이 unstuck 하는가**를 판정하라. 목적: 재구현 반복 대신 구조 조정.',
    '',
    `미션 골: ${context.goal.slice(0, 300)}`,
    context.arcSummary ? `아크 구조: ${context.arcSummary.slice(0, 400)}` : '',
    '',
    '이미 랜딩/완료(히스토리안):',
    landedBlock || '  (없음)',
    '',
    `막힌 페이즈: id=${phase.phaseId} | ${phase.title}`,
    `  failClass=${phase.failClass ?? '?'} · 시도 ${phase.attempts}회${phase.summary ? ` · ${phase.summary.slice(0, 150)}` : ''}`,
    '',
    '판정(하나):',
    '- no-edit      : 구조 문제 아님 — 정상 재시도로 풀림(편집 불필요).',
    '- split-phase  : 페이즈가 과대/다관심 — 서브페이즈로 국소 재분해.',
    '- delete-phase : 이 페이즈 산출물이 이미 랜딩/완료됨 or 골에 불필요 — 제거(obsolete).',
    '- set-arc-done : 이 페이즈가 속한 아크의 통합 목표는 이미 충족 — leaf 실패 무의미, 아크 done 처리(arcId 명시).',
    '',
    '원칙(중요): **보수적**. 확실할 때만 편집, 애매하면 no-edit. 랜딩된 산출물은 무접촉(편집은 backlog/failed 만).',
    '',
    '출력: 설명 없이 JSON 만. {"action":"no-edit|split-phase|delete-phase|set-arc-done","reason":"한줄","arcId":"(set-arc-done 시)"}',
  ].filter(Boolean).join('\n');
}

// ── 집행(P5c) — 결정 → 이미 있는 store 편집 함수 dispatch. executors 주입(테스트). ──────

export interface ArcEditResult { ok: boolean; action: ArcEditAction; detail?: string; error?: string }

/** 편집 실처리 seam(주입형·테스트 스텁·전부 async) — 이미 있는 store 편집 함수로 배선(재발명 금지). */
export interface ArcEditExecutors {
  splitPhase: (missionId: string, phaseId: string) => Promise<{ ok: boolean; subPhaseCount?: number; error?: string }>;
  deletePhase: (missionId: string, phaseId: string) => Promise<{ ok: boolean; error?: string }>;
  setArcDone: (missionId: string, arcId: string, evidence: string) => Promise<{ ok: boolean; error?: string }>;
}

/**
 * ★ 아크 편집 집행(P5c·대표 2026-07-21) — 결정을 이미 있는 편집 인프라로 dispatch. no-edit=무집행.
 * mid-run 안전: 호출부(run-mission)가 실패 페이즈(backlog/failed) 경계에서만 호출하고 편집 후 re-spawn 하는
 * 계약(스냅샷 레이스 방지). 이 함수 자체는 순수 dispatch(executors 주입)라 결정론 테스트.
 */
export async function applyArcEdit(
  missionId: string,
  decision: ArcEditDecision,
  exec: ArcEditExecutors,
): Promise<ArcEditResult> {
  switch (decision.action) {
    case 'no-edit':
      return { ok: true, action: 'no-edit' };
    case 'split-phase': {
      const r = await exec.splitPhase(missionId, decision.phaseId);
      return { ok: r.ok, action: 'split-phase', ...(r.subPhaseCount !== undefined ? { detail: `${r.subPhaseCount} 서브페이즈` } : {}), ...(r.error ? { error: r.error } : {}) };
    }
    case 'delete-phase': {
      const r = await exec.deletePhase(missionId, decision.phaseId);
      return { ok: r.ok, action: 'delete-phase', ...(r.error ? { error: r.error } : {}) };
    }
    case 'set-arc-done': {
      if (!decision.arcId) return { ok: false, action: 'set-arc-done', error: 'arcId 부재' };
      const r = await exec.setArcDone(missionId, decision.arcId, decision.reason);
      return { ok: r.ok, action: 'set-arc-done', ...(r.error ? { error: r.error } : {}) };
    }
  }
}

/** 실 executors — 이미 있는 store 편집 함수 배선(dynamic import·순환의존 회피). */
export function defaultArcEditExecutors(): ArcEditExecutors {
  return {
    splitPhase: async (missionId, phaseId) => {
      const { splitPhaseIntoSubphases } = await import('./mission-phase-split.js');
      const r = await splitPhaseIntoSubphases(missionId, phaseId);
      return { ok: r.ok, subPhaseCount: r.subPhaseCount, ...(r.error ? { error: r.error } : {}) };
    },
    deletePhase: async (missionId, phaseId) => {
      const { deletePhaseFromMission } = await import('./mission-lifecycle.js');
      const r = deletePhaseFromMission(missionId, phaseId);
      return { ok: r.ok, ...(r.error ? { error: r.error } : {}) };
    },
    setArcDone: async (missionId, arcId, evidence) => {
      const { setArcStatusInMission } = await import('./mission-lifecycle.js');
      const r = setArcStatusInMission(missionId, { arcRef: arcId, status: 'done', evidence, actor: 'coordinator' });
      return { ok: r.ok, ...(r.error ? { error: r.error } : {}) };
    },
  };
}

/** 실 LLM 판정 어댑터(streamLLM·luna 경량). JSON 파싱·실패 시 no-edit 유도(빈 action). */
export async function defaultArcEditResolve(phase: StuckPhaseInfo, context: ArcEditContext): Promise<RawArcEdit> {
  const { streamLLM } = await import('../llm.js');
  const { tierModel } = await import('../llm/model-defaults.js');
  const out = await streamLLM(
    [{ role: 'user', content: arcEditPrompt(phase, context) }],
    () => {},
    { model: process.env.MONAD_ARC_EDIT_MODEL || tierModel('budget'), reasoningEffort: 'low' },
  );
  return parseArcEditJson(out);
}

/** LLM 출력 → RawArcEdit(순수·테스트). 코드펜스/설명 제거·JSON 객체 추출. 실패 시 빈 객체(→no-edit). */
export function parseArcEditJson(out: string): RawArcEdit {
  const stripped = out.replace(/^```[\w.-]*\n?/, '').replace(/\n?```\s*$/, '').trim();
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start < 0 || end < start) return {};
  try {
    const o = JSON.parse(stripped.slice(start, end + 1)) as Record<string, unknown>;
    return {
      ...(typeof o.action === 'string' ? { action: o.action } : {}),
      ...(typeof o.reason === 'string' ? { reason: o.reason } : {}),
      ...(typeof o.arcId === 'string' ? { arcId: o.arcId } : {}),
    };
  } catch {
    return {};
  }
}
