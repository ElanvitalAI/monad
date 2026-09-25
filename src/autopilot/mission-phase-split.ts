// ── 페이즈 국소 재분해(phase split) — 대표 지시 2026-07-12 ─────────────────
//
// "승인된 골 분해로 되돌아가는 UX" — 자율 구현이 한 번의 실행 예산(terra 150→300→
// 1000 + opus 4.8 폴백)으로도 완주 못 한 "너무 큰" 페이즈를, 사람이 버튼 한 번으로
// 더 작은 단일책임 서브페이즈로 쪼갠다(줌인). dogfood 실측: memory-lifecycle KGS
// 페이즈가 4파일(sqlite-store 마이그레이션·pack 왕복·write 배선·조회)에 걸쳐 매 시도
// 배선을 못 끝내고 비평 FAIL. 페이즈 설계 원칙(단일책임·완주가능 크기)에 위배된 큰 arc.
//
// 흐름: 실패 페이즈 알림의 [✂️ 분할] → LLM 재분해(TaskGenerator.decompose·작게) →
//   서브페이즈 선형 체인 생성(원본 dependsOn 승계) → 원본을 dependsOn 하던 페이즈를
//   서브 tail 로 재배선 → 원본 제거 → run-mission 재spawn(순회 재개). executor 는
//   존재하는 dep 만 게이팅하므로 원본 제거가 안전(고아 dep 무시).

import { TaskStore } from '../task-orchestrator/store.js';
import { createTask, TASK_DEFAULTS } from '../task-orchestrator/types.js';
import type { DecomposeCallable } from '../task-orchestrator/generator.js';
import { defaultDecomposeCallable, defaultSpawnRunMission } from './mission-engine.js';
import { replaceArcPhase } from './mission-arc.js';
import { detectArcSizeDrift, buildArcDriftRecommendation } from './mission-arc-drift.js';
import { computePhaseBudget, computeSplitAllowance, phaseBudgetFromConfig } from './mission-phase-budget.js';
import { debug } from '../debug/log.js';

export interface SplitPhaseResult {
  ok: boolean;
  subPhaseCount: number;
  subTaskIds: string[];
  /** 생성된 서브페이즈 제목들(대표 지시 2026-07-12) — 분할 완료 알림에 "어떻게 4개로 쪼갰나" 열거용. */
  subTitles: string[];
  /** ★ true = 페이즈 예산(arcCount×perArc) 도달·초과로 split 차단(PLAN-anti-infinite-phase-split Device 1).
   *  조율자(Device 3)가 reshape(merge/carve)/HITL 로 처리해야 한다 — 무한 팽창의 하드 차단점. */
  capHit?: boolean;
  error?: string;
}

/** 실패한(너무 큰) 페이즈를 단일책임 서브페이즈로 국소 재분해(대표 지시 2026-07-12).
 *  callable/store/spawnRun 주입(테스트). 실행은 재spawn 이 담당(승인된 미션이라 자율 재개). */
export async function splitPhaseIntoSubphases(
  missionId: string,
  phaseId: string,
  deps: {
    store?: TaskStore;
    callable?: DecomposeCallable;
    maxSub?: number;
    now?: () => number;
    spawnRun?: (id: string) => void;
  } = {},
): Promise<SplitPhaseResult> {
  const store = deps.store ?? new TaskStore();
  const owns = !deps.store;
  const now = deps.now ?? Date.now;
  try {
    const phases = store.listTasks({ goalSlug: missionId }).filter((t) => t.surface.kind === 'subagent');
    const target = phases.find((p) => p.id === phaseId);
    if (!target) return { ok: false, subPhaseCount: 0, subTaskIds: [], subTitles: [], error: `페이즈 없음: ${phaseId}` };

    // ★ Device 1 (PLAN-anti-infinite-phase-split 2026-07-23) — 누적 페이즈 예산 cap. 팽창엔진에 상한을
    //   둬 무한 분할(e4f97b 7→20+)을 하드 차단한다. arcCount×perArc(기본 5)가 총 페이즈 상한. split 은
    //   1→N 치환(net +N-1)이라 예산 여유(room)만큼만 서브를 만든다. 여유 없으면 cap-hit → split 안 하고
    //   조율자(Device 3)에게 넘긴다. 관측(mission.phase.budget)은 항상 남긴다(제1원칙·Device 4).
    const arcCount = store.getMission(missionId)?.autopilot?.arcs?.length ?? 0;
    const budgetCfg = phaseBudgetFromConfig();
    const budget = computePhaseBudget(arcCount, budgetCfg);
    const requestedSub = deps.maxSub ?? 4;
    const allowance = computeSplitAllowance(phases.length, budget, requestedSub);
    debug.log('mission.phase.budget', 'split-check', {
      missionId, phaseId, currentCount: phases.length, budget, arcCount,
      room: allowance.room, allowedSub: allowance.allowedSub, capHit: allowance.capHit,
    });
    if (allowance.capHit) {
      debug.log('mission.phase.budget', 'cap-hit', { missionId, phaseId, currentCount: phases.length, budget, arcCount });
      return {
        ok: false, capHit: true, subPhaseCount: 0, subTaskIds: [], subTitles: [],
        error: `페이즈 예산 초과(${phases.length}/${budget}·아크${arcCount}) — split 차단. 조율자 reshape(merge)/HITL 필요.`,
      };
    }

    // ★ P4(통합 sizing 2026-07-22·split→approve 곱셈 제거) — 이미 승인(active)된 미션을 split 하면
    //   서브페이즈는 **승인 범위 내**다. 종전엔 status:'backlog'(=승인대기 신호)로 재생성해 "backlog
    //   subagent 태스크 존재 = 재승인 필요"로 해석하는 소비처가 approve-plan 카드를 재무장 → split×approve
    //   곱셈(라이브 617097). 승인된 미션이면 'blocked'(승인됐으나 dep 대기)로 생성 — executor promote()가
    //   backlog/blocked 를 동일하게 ready 승격하므로 실행 무회귀, 승인 재무장만 차단. planning(미승인)은
    //   종전대로 backlog(정상 승인 흐름 유지).
    const approvedScope = store.getMission(missionId)?.status === 'active';
    const subStatus: 'backlog' | 'blocked' = approvedScope ? 'blocked' : 'backlog';

    // 1) LLM 재분해 — 이 페이즈의 prompt/acceptance 를 objective 로, 단일책임 서브페이즈로.
    const targetPrompt = target.surface.kind === 'subagent' ? target.surface.prompt : target.title;
    const callable = deps.callable ?? await defaultDecomposeCallable();
    const { TaskGenerator } = await import('../task-orchestrator/generator.js');
    const gen = new TaskGenerator({ callable });
    const objective = [
      '아래는 자율 구현이 한 번의 실행 예산으로 완주하지 못한 "너무 큰" 페이즈다. 이를 각각',
      '한 번의 에이전트 실행으로 끝낼 수 있는 단일책임 서브페이즈로 쪼개라(파일/관심사 단위).',
      '',
      '── 원본 페이즈 ──',
      targetPrompt.slice(0, 3000),
      '',
      '★ 분할 원칙(반드시 준수):',
      '- 각 서브페이즈 = 한 파일 또는 한 관심사(예: 스키마 마이그레이션 / pack 왕복 보존 / write 배선 / 조회 경로).',
      '- 각 acceptance 는 criteria 2~4개, 한 번의 에이전트 실행으로 완주 가능한 구체·한정 범위.',
      '- dependsOn 으로 서브페이즈 순서를 표현(대개 순차 — 스키마 먼저, 그 위에 배선).',
      '- 서브페이즈들이 합쳐서 원본 acceptance 를 모두 충족해야 한다(범위 누락·초과 금지).',
      '- 원본이 지목한 파일만 다뤄라(새 병렬 스키마/직렬화기 신설 금지).',
    ].join('\n');
    const result = await gen.decompose({
      objective,
      context: { goalSlug: missionId },
      constraints: { maxTasks: allowance.allowedSub }, // ★ 예산 여유 내로 상한(Device 1) — 절대 초과 팽창 불가
      goalKind: 'coding',
      depth: 0,
    });
    const subs = result.proposal.tasks;
    if (subs.length <= 1) {
      return { ok: false, subPhaseCount: 0, subTaskIds: [], subTitles: [], error: '분할 불가 — 1개 이하로 분해됨(이미 최소 단위이거나 재분해 실패).' };
    }

    // 2) 서브페이즈 선형 체인 생성 — sub[0].dependsOn=원본.dependsOn, sub[i]=[sub[i-1]].
    //    ★ 넘버링 정합(대표 지시 2026-07-12): 서브를 원본의 createdAt 슬롯(C+i)에 넣어 표시 순서
    //    (allPhases 는 createdAt 정렬)가 실행 순서(DAG)와 일치하게 한다. 안 그러면 서브가 "지금"
    //    시각이라 목록 맨 끝으로 가 번호가 꼬인다(실행은 DAG라 정상이나 표시가 혼란). created_at 은
    //    INTEGER 라 소수 삽입 불가 → (3)에서 원본보다 뒤인 페이즈를 N-1 만큼 밀어 자리를 만든다.
    const C = target.createdAt;
    const N = subs.length;
    const subIds: string[] = [];
    const subTitles: string[] = [];
    let prevId: string | null = null;
    for (let i = 0; i < subs.length; i++) {
      const t = subs[i]!;
      const dependsOn = prevId ? [prevId] : [...target.dependsOn];
      const prompt = [
        `[분할 ${i + 1}/${subs.length}] ${t.title}`,
        t.description ?? '',
        t.acceptance?.criteria?.length ? `\n검증(acceptance):\n- ${t.acceptance.criteria.join('\n- ')}` : '',
      ].filter(Boolean).join('\n');
      const created = createTask({
        title: t.title.slice(0, TASK_DEFAULTS.titleMaxLen), // SSOT 한도(80) 참조 — split title 드리프트 throw 근절
        description: prompt.slice(0, 4000),
        surface: { kind: 'subagent', definitionName: 'general-purpose', prompt },
        goalSlug: missionId,
        dependsOn,
        ...(t.acceptance ? { acceptance: t.acceptance } : {}),
        generatedBy: { kind: 'user', actorId: 'autopilot-phase-split' },
        status: subStatus,  // ★ P4 — 승인된 미션이면 'blocked'(승인 재무장 차단), 미승인이면 'backlog'
      }, { allowUncheckedUrgent: true, now: C + i });  // ★ 원본 슬롯 점유(C+i)
      store.saveTask(created);
      subIds.push(created.id);
      subTitles.push(created.title);
      prevId = created.id;
    }
    const lastSub = subIds[subIds.length - 1]!;

    // 3) 자리 확보(원본보다 뒤 페이즈 createdAt += N-1) + dependents 재배선(원본→서브 tail)을
    //    한 패스로. tail 이 끝나면 전 서브 완료(선형 체인)라 마지막만으로 정확·충분. 정렬 결과:
    //    [원본 앞 페이즈…, sub[0..N-1](C..C+N-1), 원본 뒤 페이즈…(≥C+N)] = 실행 순서와 일치.
    for (const x of phases) {
      if (x.id === phaseId) continue;
      const isDep = x.dependsOn.includes(phaseId);
      const newCreatedAt = x.createdAt > C ? x.createdAt + (N - 1) : x.createdAt;
      if (newCreatedAt === x.createdAt && !isDep) continue;
      const dependsOn = isDep
        ? [...new Set(x.dependsOn.filter((d) => d !== phaseId).concat(lastSub))]
        : x.dependsOn;
      store.saveTask({ ...x, createdAt: newCreatedAt, dependsOn, updatedAt: now() });
    }

    // 4) 원본 페이즈 제거 — executor 는 존재하는 dep 만 게이팅(고아 dep 무시)이라 안전.
    store.deleteTask?.(phaseId);

    // 4b) ★ arc-aware(2026-07-14) — 원본이 아크 소속이면 arcs.phaseIds 에서 서브페이즈로 치환.
    //     안 하면 아크가 사라진 원본을 dangling 참조(arc 완성 불가·하류 배리어 영구 블록) + 서브페이즈가
    //     arc-less(아크 통합검증 미발동). 라이브 실증(a6230f arc0). fail-soft — arc 반영 실패가 split 을 막지 않음.
    try {
      const m = store.getMission(missionId);
      const arcs = m?.autopilot?.arcs;
      if (m && arcs?.length) {
        // 원본 페이즈가 속했던 아크 식별 → splitCount 증가(§5 drift 자기감지 소스).
        const hostArcId = arcs.find((a) => a.phaseIds.includes(phaseId))?.arcId;
        const replaced = replaceArcPhase(arcs, phaseId, subIds) ?? arcs;
        const next = replaced.map((a) => (a.arcId === hostArcId ? { ...a, splitCount: (a.splitCount ?? 0) + 1 } : a));
        if (next !== arcs) {
          store.saveMission({ ...m, autopilot: { ...(m.autopilot ?? { origin: 'manual' }), arcs: next }, updatedAt: now() });
          // 관측(mission.arc.split) — 매 split 을 logs.db 에(자기인지 소스).
          const host = next.find((a) => a.arcId === hostArcId);
          debug.log('mission.arc.split', 'phase-split', { missionId, arcId: hostArcId, splitCount: host?.splitCount, subPhases: subIds.length });
          // 셀프힐(§5·§7-D2) — 아크당 split 임계(2) 도달 시 크기 오판 역제안을 관측에 남긴다(HITL·자동 집행 없음).
          for (const sig of detectArcSizeDrift(next)) {
            debug.log('mission.arc.drift', 'over-bundled', { missionId, arcId: sig.arcId, splitCount: sig.splitCount, recommendation: buildArcDriftRecommendation(sig) });
          }
        }
      }
    } catch { /* fail-soft */ }

    // 5) 재spawn — 멀티페이즈 순회 재개(ready 서브 실행). 승인된 미션이라 자율 재개.
    try { (deps.spawnRun ?? defaultSpawnRunMission)(missionId); } catch { /* fail-soft */ }

    return { ok: true, subPhaseCount: subIds.length, subTaskIds: subIds, subTitles };
  } catch (e) {
    return { ok: false, subPhaseCount: 0, subTaskIds: [], subTitles: [], error: e instanceof Error ? e.message.slice(0, 150) : String(e) };
  } finally {
    if (owns) store.close();
  }
}
