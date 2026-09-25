// W9b Z10 · Next-action source — Phase 0.5 entry into the larger
// intent-prediction backend (~1500 LOC iOS Companion ROADMAP target).
// Cf. ROADMAP-showroom-x-task-fabric-2026-05-12.md §4 Z10.
//
// The Z10 fluent showroom needs a "what could happen next" feed that is
// (a) deterministic for tests, (b) injectable so a real backend can swap
// in later, and (c) light enough that a daemon tick does not block on it.
// `createStubNextActionSource` covers the first two by ranking from a
// declared rule set; the real source (LLM-judged · KGS-aware) lives in a
// future PR but consumes the same `NextActionSource` interface.

import type { TaskSurfaceKind } from '../task-orchestrator/types.js';

/** One predicted follow-up action. `score` is `0..1`. `surfaceHint`
 *  tells the showroom hook which TaskSurface kind the candidate would
 *  spawn into when the user clicks; null means "let the lane decide". */
export interface NextActionCandidate {
  /** Free-form action label — the showroom lane sees this verbatim. */
  kind: string;
  score: number;
  rationale?: string;
  surfaceHint?: TaskSurfaceKind | null;
}

/** Context the source uses to score candidates. Mirrors what the
 *  task-done lifecycle hook already has — no new instrumentation. */
export interface NextActionContext {
  /** Finished task/phase id — mission-aware source 가 실 상태를 역추적하는 키(2026-07-15). */
  refId: string;
  /** Task / run kind that just finished (e.g. `'task'`, `'workflow-run'`). */
  refKind: string;
  /** Surface kind the finished task ran on. `null` when unknown. */
  finishedSurface: TaskSurfaceKind | null;
  /** `'ok'` or `'failed'`. Drives the closer lane in the showroom. */
  outcome: 'ok' | 'failed';
  /** Optional 1-paragraph retro summary (Z5 RetroCard.summary).
   *  Empty string when retro is OFF — the stub does not require it. */
  retroSummary: string;
  /** Free-form labels emitted by the caller (skill names · workflow
   *  step ids · mission tags). Used by rule predicates. */
  tags: string[];
}

export interface NextActionSource {
  /** Return up to `limit` ranked candidates, highest score first.
   *  Implementations must not throw — they return `[]` on internal
   *  error so the hook can degrade gracefully. */
  top(input: NextActionContext, limit: number): Promise<NextActionCandidate[]>;
}

/** Rule shape for the stub. `predicate` returns the score (`0..1`)
 *  or `0` to skip the rule. Rules are evaluated in declaration order;
 *  the source sorts the produced candidates by score before truncating. */
export interface StubNextActionRule {
  kind: string;
  predicate: (ctx: NextActionContext) => number;
  rationale?: string;
  surfaceHint?: TaskSurfaceKind | null;
}

const DEFAULT_RULES: StubNextActionRule[] = [
  {
    kind: 'continue-similar-task',
    predicate: (c) => (c.outcome === 'ok' ? 0.7 : 0),
    rationale: 'previous run succeeded — replay similar shape',
    surfaceHint: null,
  },
  {
    kind: 'retry-with-fix',
    predicate: (c) => (c.outcome === 'failed' ? 0.85 : 0),
    rationale: 'failure surfaces a fix-and-retry candidate',
    surfaceHint: null,
  },
  {
    kind: 'open-retro-showroom',
    predicate: (c) => (c.retroSummary.length > 0 ? 0.55 : 0),
    rationale: 'retro is available — surface it for deeper review',
    surfaceHint: 'showroom',
  },
  {
    kind: 'archive-and-close',
    predicate: (c) => (c.outcome === 'ok' ? 0.4 : 0.15),
    rationale: 'one-click closure when nothing else fits',
    surfaceHint: null,
  },
  {
    kind: 'spawn-followup-task',
    predicate: (c) => (c.tags.length > 0 ? 0.6 : 0.35),
    rationale: 'tags suggest a related task is worth queueing',
    surfaceHint: null,
  },
  {
    kind: 'schedule-recurring',
    predicate: (c) => (c.tags.includes('routine') ? 0.75 : 0),
    rationale: 'routine tag — propose a cron surface',
    surfaceHint: 'cron',
  },
];

export interface StubNextActionSourceOpts {
  /** Override / extend the default rule set. When omitted, the built-in
   *  rules (continue / retry / retro / archive / followup / cron) apply. */
  rules?: StubNextActionRule[];
}

export function createStubNextActionSource(
  opts: StubNextActionSourceOpts = {},
): NextActionSource {
  const rules = opts.rules ?? DEFAULT_RULES;
  return {
    async top(input, limit) {
      if (limit <= 0) return [];
      const candidates: NextActionCandidate[] = [];
      for (const rule of rules) {
        const score = clamp01(rule.predicate(input));
        if (score <= 0) continue;
        candidates.push({
          kind: rule.kind,
          score,
          ...(rule.rationale ? { rationale: rule.rationale } : {}),
          surfaceHint: rule.surfaceHint ?? null,
        });
      }
      candidates.sort((a, b) => b.score - a.score);
      return candidates.slice(0, limit);
    },
  };
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

// ── mission-fabric-aware source (2026-07-15) ─────────────────────────────────
//
// 제네릭 stub(continue-similar 등)을 대체 — 종료된 **미션 페이즈**의 실 상태를 역추적해 대표가 실제
// 쓰는 autopilot 액션(rebuild·split·revise·skip·escalate·check·recritique·review-pr)을 후보로 낸다.
// 페이즈 상태는 lookupPhase(주입·데몬이 TaskStore 로 구현)로. 미션 페이즈 아니면 후보 0(칩 안 뜸).

/** 페이즈 액션 판정에 필요한 최소 상태(데몬이 TaskStore 에서 역추적해 주입). */
export interface PhaseActionState {
  /** subagent 페이즈 + 미션 소속(goalSlug). false 면 mission-fabric 액션 대상 아님. */
  isMissionPhase: boolean;
  /** 페이즈 status(done/failed/...). */
  status: string;
  /** [SE-PR] 노트 존재 — 산출 PR 있음. */
  hasPr: boolean;
  /** 소속 미션이 completed 인가. */
  missionCompleted: boolean;
  /** 자동 비평 지적([CRITIQUE:FAIL/WARN]) 존재 — recritique 대상. */
  hasCritique: boolean;
}

export interface MissionNextActionDeps {
  /** refId(phaseId) → 페이즈 상태. null=미조회/비미션(후보 0). */
  lookupPhase: (refId: string) => PhaseActionState | null;
}

/** mission-fabric 액션 후보 kind — 전부 dispatchAutopilotMissions({action,id,phase}) 로 실행 가능
 *  (PWA 1-클릭 dispatch 정합). PWA 칩 클릭 = 이 액션이 실제로 실행됨. */
export const MISSION_ACTION_KINDS = [
  'rebuild', 'split', 'revise', 'skip', 'escalate', 'check',
] as const;
export type MissionActionKind = (typeof MISSION_ACTION_KINDS)[number];

/**
 * mission-fabric-aware next-action source — 종료 페이즈 상태 → 실제 autopilot 액션 후보(결정론·순수+주입).
 * failed → rebuild/split/revise/skip/escalate · done+PR → review-pr/check(+recritique) · done → recritique.
 * 미션 페이즈 아니면 []( 칩 없음). 내부 오류는 [](hook graceful).
 */
export function createMissionNextActionSource(deps: MissionNextActionDeps): NextActionSource {
  return {
    async top(input, limit) {
      if (limit <= 0) return [];
      let st: PhaseActionState | null = null;
      try { st = deps.lookupPhase(input.refId); } catch { return []; }
      if (!st || !st.isMissionPhase) return [];
      const out: NextActionCandidate[] = [];
      const failed = st.status === 'failed' || input.outcome === 'failed';
      if (failed) {
        out.push(
          { kind: 'rebuild', score: 0.85, rationale: '이 페이즈부터 SE 격리 재구현', surfaceHint: null },
          { kind: 'split', score: 0.70, rationale: '과대 페이즈를 단일책임 서브페이즈로 분할', surfaceHint: null },
          { kind: 'revise', score: 0.55, rationale: '골 범위를 정정·재분해', surfaceHint: null },
          { kind: 'skip', score: 0.40, rationale: '이 기능 제외하고 나머지 진행', surfaceHint: null },
          { kind: 'escalate', score: 0.30, rationale: '시스템 결함 의심 — R3 룩백·수리 미션', surfaceHint: null },
        );
      } else {
        // done — 산출 PR 있으면 사람 확인(check)·비평 지적 있으면 재구현(rebuild=recritique 포함).
        if (st.hasCritique) out.push({ kind: 'rebuild', score: 0.60, rationale: '자동 비평 지적 재반영(개선 재구현)', surfaceHint: null });
        if (st.hasPr) out.push({ kind: 'check', score: 0.50, rationale: '결과 확인 후 done 승인(사람 검증)', surfaceHint: null });
      }
      return out.sort((a, b) => b.score - a.score).slice(0, limit);
    },
  };
}
