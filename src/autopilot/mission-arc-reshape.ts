import { tierModel } from '../llm/model-defaults.js';
import { createTask } from '../task-orchestrator/types.js';
import { TaskStore } from '../task-orchestrator/store.js';
import type { MissionArc } from '../task-orchestrator/mission.js';
import { gradePhaseCompletability } from './mission-phase-granularity.js';

export type ReshapeAction = 'no-reshape' | 're-decompose-arc' | 'merge-phases' | 'carve-arc' | 'maturity-split';

export interface ArcReshapeInput {
  missionId: string;
  goal: string;
  arcs: readonly MissionArc[];
  state: { phases?: unknown; failures?: unknown; workingMemory?: unknown };
  driftedArcId?: string;
  landedTitles: string[];
  failurePatterns: string[];
  concerns: Record<string, string[]>;
}

export interface RawArcReshape { action?: string; reason?: string; arcId?: string; phaseIds?: string[]; targetConcepts?: string[]; name?: string }
export interface ArcReshapeDecision { action: ReshapeAction; reason: string; arcId?: string; phaseIds: string[]; targetConcepts: string[]; name?: string }
export type ArcReshapeResolve = (input: ArcReshapeInput) => Promise<RawArcReshape>;

const actions = new Set<ReshapeAction>(['no-reshape', 're-decompose-arc', 'merge-phases', 'carve-arc', 'maturity-split']);
const phasesOf = (state: ArcReshapeInput['state']): Array<{ id: string; title: string; status: string; prompt?: string; acceptance?: string[] }> =>
  Array.isArray(state.phases) ? state.phases.filter((p): p is { id: string; title: string; status: string; prompt?: string; acceptance?: string[] } => !!p && typeof p === 'object' && typeof (p as { id?: unknown }).id === 'string') : [];

/** Build the complete, I/O-free context used by the conservative reshape brain. */
export function buildArcReshapeInput(missionId: string, goal: string, arcs: readonly MissionArc[], state: ArcReshapeInput['state'], driftedArcId?: string): ArcReshapeInput {
  const phases = phasesOf(state);
  const landedTitles = phases.filter((p) => p.status === 'done').map((p) => p.title);
  const failurePatterns = phases.filter((p) => p.status === 'failed').map((p) => `${p.title}: failed`);
  // ★ P3(통합 sizing 2026-07-22) — concern 을 SSOT gradePhaseCompletability 로 통일(reshape targetConcepts
  //   가 분해·split 과 동일한 concern 축을 공유). `.concerns` 는 동일한 detectConcerns 라 무회귀. reshape 의
  //   +custom(아크 누적 문맥·splitCount)은 arcs 가 이미 실어나름(PLAN §1 per-site custom).
  const concerns = Object.fromEntries(phases.map((p) => [p.id, gradePhaseCompletability({ id: p.id, title: p.title, prompt: p.prompt ?? '', acceptance: p.acceptance ?? [] }).concerns]));
  return { missionId, goal, arcs, state, ...(driftedArcId ? { driftedArcId } : {}), landedTitles, failurePatterns, concerns };
}

export function arcReshapePrompt(input: ArcReshapeInput): string {
  const arc = input.driftedArcId ? input.arcs.find((a) => a.arcId === input.driftedArcId) : undefined;
  return [
    '너는 미션 조율자다. 국소 재분할 반복이 실패했다. 개념(concern) 단위로 이 아크(+이웃)를 한 번에 크게 재성형하라.',
    '확실할 때만 실행하고 done/running 페이즈는 절대 건드리지 마라. 애매하면 no-reshape.',
    `미션 골: ${input.goal.slice(0, 500)}`,
    `드리프트 아크: ${arc ? `${arc.arcId} ${arc.name} (${arc.intent})` : '없음'}`,
    `완료: ${input.landedTitles.join(' | ') || '없음'}`,
    `실패: ${input.failurePatterns.join(' | ') || '없음'}`,
    `concerns: ${JSON.stringify(input.concerns)}`,
    'action: no-reshape | re-decompose-arc | merge-phases | carve-arc | maturity-split.',
    're-decompose-arc는 targetConcepts의 각 항목이 한 concern이어야 한다. JSON만 출력:',
    '{"action":"...","reason":"...","arcId":"...","phaseIds":["..."],"targetConcepts":["..."],"name":"..."}',
  ].join('\n');
}

export async function decideArcReshape(input: ArcReshapeInput, resolve: ArcReshapeResolve): Promise<ArcReshapeDecision> {
  const no = (reason: string): ArcReshapeDecision => ({ action: 'no-reshape', reason, phaseIds: [], targetConcepts: [] });
  try {
    const raw = await resolve(input);
    if (!raw || !actions.has(raw.action as ReshapeAction)) return no('유효하지 않은 reshape 판정 — no-reshape');
    const action = raw.action as ReshapeAction;
    if (action === 'no-reshape') return no(raw.reason ?? 'reshape 불필요');
    const arcId = raw.arcId ?? input.driftedArcId;
    if ((action === 're-decompose-arc' || action === 'carve-arc') && !arcId) return no('대상 arcId 부재 — no-reshape');
    const phaseIds = Array.isArray(raw.phaseIds) ? raw.phaseIds.filter((x): x is string => typeof x === 'string') : [];
    const targetConcepts = Array.isArray(raw.targetConcepts) ? raw.targetConcepts.filter((x): x is string => typeof x === 'string') : [];
    if (action === 're-decompose-arc' && targetConcepts.length < 2) return no('재분해 concern이 2개 미만 — no-reshape');
    return { action, reason: (raw.reason ?? '').slice(0, 200), ...(arcId ? { arcId } : {}), phaseIds, targetConcepts, ...(raw.name ? { name: raw.name.slice(0, 120) } : {}) };
  } catch { return no('reshape 판정 실패 — no-reshape(fail-soft)'); }
}

export interface ArcReshapeExecutors {
  redecomposeArc: (missionId: string, decision: ArcReshapeDecision) => Promise<{ ok: boolean; detail?: string; error?: string }>;
  mergePhases: (missionId: string, decision: ArcReshapeDecision) => Promise<{ ok: boolean; detail?: string; error?: string }>;
  carveArc: (missionId: string, decision: ArcReshapeDecision) => Promise<{ ok: boolean; detail?: string; error?: string }>;
  maturitySplit: (missionId: string) => Promise<{ ok: boolean; detail?: string; error?: string }>;
}
export interface ArcReshapeResult { ok: boolean; action: ReshapeAction; detail?: string; error?: string }

export async function applyArcReshape(missionId: string, decision: ArcReshapeDecision, exec: ArcReshapeExecutors): Promise<ArcReshapeResult> {
  if (decision.action === 'no-reshape') return { ok: false, action: decision.action, error: 'no-reshape' };
  const r = decision.action === 're-decompose-arc' ? await exec.redecomposeArc(missionId, decision)
    : decision.action === 'merge-phases' ? await exec.mergePhases(missionId, decision)
      : decision.action === 'carve-arc' ? await exec.carveArc(missionId, decision)
        : await exec.maturitySplit(missionId);
  return { ok: r.ok, action: decision.action, ...(r.detail ? { detail: r.detail } : {}), ...(r.error ? { error: r.error } : {}) };
}

export function defaultArcReshapeExecutors(): ArcReshapeExecutors {
  return {
    redecomposeArc: async (missionId, decision) => {
      const store = new TaskStore();
      try {
        const mission = store.getMission(missionId);
        const arc = mission?.autopilot?.arcs?.find((a) => a.arcId === decision.arcId);
        if (!mission || !arc) return { ok: false, error: '미션 또는 아크 없음' };
        const phases = store.listTasks({ goalSlug: missionId }).filter((p) => p.surface.kind === 'subagent');
        const victims = phases.filter((p) => arc.phaseIds.includes(p.id) && (p.status === 'backlog' || p.status === 'failed'));
        if (!victims.length || victims.some((p) => p.notes.some((n) => n.includes('[RESHAPE]')))) return { ok: false, error: '재성형 대상 없음 또는 이미 reshape됨' };
        const { defaultDecomposeCallable } = await import('./mission-engine.js');
        const { TaskGenerator } = await import('../task-orchestrator/generator.js');
        const generator = new TaskGenerator({ callable: await defaultDecomposeCallable() });
        const objective = [`아크 intent: ${arc.intent}`, '각 서브페이즈는 아래 concern 중 정확히 하나만 담당하라.', `concerns: ${decision.targetConcepts.join(' | ')}`, 'done/running 페이즈는 건드리지 말고, backlog/failed 범위만 대체하라.'].join('\n');
        const proposal = await generator.decompose({ objective, context: { goalSlug: missionId }, constraints: { maxTasks: decision.targetConcepts.length }, goalKind: 'coding', depth: 0 });
        if (proposal.proposal.tasks.length < 2) return { ok: false, error: '아크 재분해 결과 부족' };
        const { deletePhaseFromMission } = await import('./mission-lifecycle.js');
        for (const p of victims) { const deleted = deletePhaseFromMission(missionId, p.id, { store }); if (!deleted.ok) return { ok: false, error: deleted.error }; }
        const ids: string[] = []; let previous = victims[0]!.dependsOn;
        for (const [i, task] of proposal.proposal.tasks.entries()) {
          const prompt = `[RESHAPE ${i + 1}/${proposal.proposal.tasks.length}] ${task.title}\n${task.description ?? ''}`;
          const made = createTask({ title: task.title, description: prompt, surface: { kind: 'subagent', definitionName: 'general-purpose', prompt }, goalSlug: missionId, dependsOn: previous, acceptance: task.acceptance, generatedBy: { kind: 'user', actorId: 'autopilot-arc-reshape' }, status: 'backlog' }, { allowUncheckedUrgent: true });
          store.saveTask(made); ids.push(made.id); previous = [made.id];
        }
        const nextArcs = mission.autopilot!.arcs!.map((a) => a.arcId === arc.arcId ? { ...a, phaseIds: ids, splitCount: 0 } : a);
        store.saveMission({ ...mission, autopilot: { ...mission.autopilot!, arcs: nextArcs }, updatedAt: Date.now() });
        return { ok: true, detail: `${ids.length} concern 페이즈·splitCount reset` };
      } finally { store.close(); }
    },
    mergePhases: async (missionId, decision) => {
      const { deletePhaseFromMission } = await import('./mission-lifecycle.js');
      const ids = decision.phaseIds.slice(1); if (!ids.length) return { ok: false, error: '병합할 흡수 페이즈 없음' };
      for (const id of ids) { const r = deletePhaseFromMission(missionId, id); if (!r.ok) return { ok: false, error: r.error }; }
      return { ok: true, detail: `${ids.length} 페이즈 흡수` };
    },
    carveArc: async (missionId, decision) => {
      const { insertArcIntoMission } = await import('./mission-lifecycle.js');
      const r = insertArcIntoMission(missionId, { afterArc: decision.arcId!, name: decision.name ?? 'Reshape carve', phaseHandles: decision.phaseIds });
      return { ok: r.ok, ...(r.ok ? { detail: r.arcName } : { error: r.error }) };
    },
    maturitySplit: async (missionId) => { const store = new TaskStore(); try { const { applyMaturitySplit } = await import('./mission-maturity.js'); const r = applyMaturitySplit(store, missionId); return { ok: r.ok, detail: r.reason }; } finally { store.close(); } },
  };
}

export async function defaultArcReshapeResolve(input: ArcReshapeInput): Promise<RawArcReshape> {
  const { streamLLM } = await import('../llm.js');
  const out = await streamLLM([{ role: 'user', content: arcReshapePrompt(input) }], () => {}, { model: process.env.ELANOUS_ARC_RESHAPE_MODEL || tierModel('best'), reasoningEffort: 'high' });
  const start = out.indexOf('{'); const end = out.lastIndexOf('}');
  if (start < 0 || end < start) return {};
  try { return JSON.parse(out.slice(start, end + 1)) as RawArcReshape; } catch { return {}; }
}
