// ── 페이즈 예산 cap-hit 조율자 (중앙 제어) — 대표 지시 2026-07-23 ──────────────────
//
// PLAN-anti-infinite-phase-split-2026-07-23 · Device 3. 근본: split 이 예산 cap 에 걸리면(Device 1)
// 지금까지는 그냥 에러였다. 이제 **중앙 조율자**가 cap-hit 을 지능적으로 처리한다:
//   1) reshape(merge-phases/re-decompose-arc)로 과팽창을 **압축**해 여유 확보 시도(죽어있던
//      mission-arc-reshape 의 decision 브레인 + executor 를 여기서 처음 배선 — "executor 미배선" 해소).
//   2) 압축이 여유를 못 만들거나 no-reshape 면 **HITL 표면화**(자동 종결 금지·대표 결정).
// reshape 진동(split↔merge) 방지 = cap-hit 당 1회만 reshape 시도, 결과는 관측(mission.phase.reshape).

import { TaskStore } from '../task-orchestrator/store.js';
import {
  buildArcReshapeInput, decideArcReshape, applyArcReshape,
  defaultArcReshapeExecutors, defaultArcReshapeResolve,
  type ArcReshapeResolve, type ArcReshapeExecutors, type ReshapeAction,
} from './mission-arc-reshape.js';
import { computePhaseBudget, phaseBudgetFromConfig } from './mission-phase-budget.js';
import { debug } from '../debug/log.js';

export interface CapGovernorResult {
  /** reshaped=압축 성공(여유 생김·재개 가능) · hitl=대표 결정 필요 · noop=처리 불가. */
  action: 'reshaped' | 'hitl' | 'noop';
  reshapeAction?: ReshapeAction;
  /** 압축 후 예산 여유가 생겼나(reshaped 의 성공 판정). */
  freedRoom: boolean;
  phaseCount: number;
  budget: number;
  detail: string;
}

export interface CapGovernorDeps {
  store?: TaskStore;
  resolve?: ArcReshapeResolve;         // reshape 판정(LLM) 주입(테스트)
  executors?: ArcReshapeExecutors;     // reshape 집행 주입(테스트)
}

/** 미션의 subagent 페이즈 상태 스냅샷(reshape 입력용). */
function phaseSnapshot(store: TaskStore, missionId: string): Array<{ id: string; title: string; status: string; prompt?: string; acceptance?: string[] }> {
  return store.listTasks({ goalSlug: missionId })
    .filter((t) => t.surface.kind === 'subagent')
    .map((t) => ({
      id: t.id, title: t.title, status: t.status,
      ...(t.surface.kind === 'subagent' ? { prompt: t.surface.prompt } : {}),
      ...(t.acceptance?.criteria ? { acceptance: t.acceptance.criteria } : {}),
    }));
}

/** ★ cap-hit 중앙 처리(Device 3). reshape 압축 시도 → 여유 확보면 reshaped, 아니면 HITL.
 *  split 이 { capHit:true } 를 반환했을 때 조율자(자율 경로·HITL 경로 공용)가 호출한다. */
export async function governPhaseCapHit(missionId: string, driftedArcId: string | undefined, deps: CapGovernorDeps = {}): Promise<CapGovernorResult> {
  const store = deps.store ?? new TaskStore();
  const owns = !deps.store;
  try {
    const mission = store.getMission(missionId);
    const arcs = mission?.autopilot?.arcs ?? [];
    const budget = computePhaseBudget(arcs.length, phaseBudgetFromConfig());
    const before = phaseSnapshot(store, missionId);
    debug.log('mission.phase.reshape', 'cap-governor-start', { missionId, phaseCount: before.length, budget, arcCount: arcs.length, driftedArcId: driftedArcId ?? null });

    if (!mission || arcs.length === 0) {
      // 아크 구조 없음 — reshape 불가(아크 단위 재성형이 전제). HITL.
      debug.log('mission.phase.reshape', 'hitl', { missionId, reason: 'no-arcs', phaseCount: before.length, budget });
      return { action: 'hitl', freedRoom: false, phaseCount: before.length, budget, detail: '아크 구조 없음 — reshape 불가. 대표 결정(descope/redesign) 필요.' };
    }

    // 1) reshape 판정(consolidate 지향) — 죽어있던 브레인 배선.
    const goalText = mission.intent ?? mission.title ?? '';
    const input = buildArcReshapeInput(missionId, goalText, arcs, { phases: before }, driftedArcId);
    const decision = await decideArcReshape(input, deps.resolve ?? defaultArcReshapeResolve);
    debug.log('mission.phase.reshape', 'decision', { missionId, action: decision.action, reason: decision.reason.slice(0, 120) });

    // consolidate 계열(merge/re-decompose)만 여유를 만든다. carve-arc/maturity-split 은 증가 방향 → cap-hit 엔 부적합.
    const consolidating: ReshapeAction[] = ['merge-phases', 're-decompose-arc'];
    if (decision.action === 'no-reshape' || !consolidating.includes(decision.action)) {
      debug.log('mission.phase.reshape', 'hitl', { missionId, reason: `non-consolidating:${decision.action}`, phaseCount: before.length, budget });
      return { action: 'hitl', reshapeAction: decision.action, freedRoom: false, phaseCount: before.length, budget, detail: `조율자 판정=${decision.action}(${decision.reason.slice(0, 100)}) — 압축 아님. 대표 결정 필요.` };
    }

    // 2) reshape 집행 — 죽어있던 executor 배선.
    //   ★ store 정합(#5177 리뷰): 기본 executor 는 각자 TaskStore 를 열고 mutate 후 close(=commit)한다.
    //   applyArcReshape 반환 시점엔 이미 커밋됐으므로, 아래 phaseSnapshot 의 fresh listTasks(별도 연결이라도
    //   SQLite committed-read)가 mutation 을 본다 → after 카운트 정확. 테스트는 store+executors 를 함께 주입해
    //   동일 연결을 쓴다(격리·즉시 반영).
    const applied = await applyArcReshape(missionId, decision, deps.executors ?? defaultArcReshapeExecutors());
    const after = phaseSnapshot(store, missionId);
    const freedRoom = after.length < budget; // 압축 후 여유(budget 미만)면 재개 가능
    debug.log('mission.phase.reshape', 'applied', { missionId, action: decision.action, ok: applied.ok, before: before.length, after: after.length, budget, freedRoom, detail: applied.detail ?? applied.error ?? '' });

    if (applied.ok && freedRoom) {
      return { action: 'reshaped', reshapeAction: decision.action, freedRoom: true, phaseCount: after.length, budget, detail: `압축 성공(${before.length}→${after.length}/${budget}) via ${decision.action}: ${applied.detail ?? ''}` };
    }
    // 집행 실패 또는 여전히 예산 초과 → HITL.
    debug.log('mission.phase.reshape', 'hitl', { missionId, reason: applied.ok ? 'still-over-budget' : 'apply-failed', phaseCount: after.length, budget });
    return { action: 'hitl', reshapeAction: decision.action, freedRoom: false, phaseCount: after.length, budget, detail: applied.ok ? `압축했으나 여전히 예산 초과(${after.length}/${budget}) — 대표 결정 필요.` : `reshape 집행 실패(${applied.error ?? ''}) — 대표 결정 필요.` };
  } catch (e) {
    debug.log('mission.phase.reshape', 'error', { missionId, message: (e as Error).message }, { level: 'error' });
    return { action: 'noop', freedRoom: false, phaseCount: 0, budget: 0, detail: `cap governor 오류: ${(e as Error).message.slice(0, 120)}` };
  } finally {
    if (owns) store.close();
  }
}
