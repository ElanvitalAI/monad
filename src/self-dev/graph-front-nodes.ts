import { debug } from '../debug/log.js';
import { frontObservationTemplate, visitBudgetOfVisits, type VisitBudgetReading } from '../self-implement/graph-authority.js';
import { GRAPH_TEMPLATES_SOURCE, graphIdentityOf, pipelineNodeEntryPayload, type GraphTemplate } from '../self-implement/graph-templates.js';

/** ⭐ RFC §5 «5단계» — 전반부(저작·플랜·분해) 노드를 그래프 관측에 «잇는다».
 *
 *  🩸 계기(2026-09-08): `default-loop.yaml` 이 `author → plan → decompose` 를 «선언»했는데
 *    원장 표본이 **0** 이었다 — `self-dev` 에 `pipeline-node-entry` 가 «한 건도» 없다(실측).
 *    ⇒ 「선언했다」와 「돈다」가 갈린 자리가 «전반부 전체»였다.
 *
 *  ⛔⭐ 이것은 «관측»이지 «제어»가 아니다 — 흐름을 바꾸지 않는다.
 *    전반부를 그래프가 «몰게» 하는 것은 다음 판이고, 그 전에 ***돌고 있는 것을 볼 수 있어야 한다***.
 *  ⛔ 실패는 fail-soft — 관측이 저작을 죽이지 않는다. */
/** ⭐ 런타임 «값»으로 둔다 — 타입만 있으면 시험이 「YAML 이 이 셋만 더했나」를 «못 센다».
 *  🩸 2026-09-10: 이 상수가 없어서 YAML(11노드)과 코드 상수(8노드)의 갈림을 무는 자가
 *     「정확히 같다」로만 쓰여 있었고, 그래서 의도된 확장이 main 을 «빨갛게» 만들었다. */
export const FRONT_NODE_IDS = ['author', 'plan', 'decompose'] as const;
export type FrontNodeId = typeof FRONT_NODE_IDS[number];

export type FrontNodeEntryProvenance =
  | 'authoring-start'
  | 'authoring-plan'
  | 'authoring-decomposition-start'
  | 'supervisor-promotion-attempt'
  | 'supervisor-pre-promotion-decision';

/** 런별 전반부 노드 방문 계수 — runId → (node → 진입 횟수) ⊕ 마지막 진입 시각.
 *  ⛔ 방문 배열·기록 전체를 보관하지 않는다 — «노드→정수 카운트» 만 둔다(매 진입 O(1)·배열 없음).
 *  ⛔ «개수»로 버리지 않는다 — 개수 상한은 진행 중인 런도 밀어내 같은 런의 계수를 1 로 되돌린다.
 *  ✅ «유휴 시간»으로만 버린다: 마지막 진입 뒤 `FRONT_VISIT_IDLE_TTL_MS` 가 지난 런. 런 종료 신호가
 *     이 모듈에 없어서, 이것이 오래 도는 프로세스(TUI·데몬)의 누수를 막는 자리다. 한 런의 전반부
 *     (author·plan·decompose)는 분 단위로 이어지므로 6시간 멈춘 런은 «진행 중»이 아니다.
 *     보관 크기는 「그 시간 안에 전반부를 밟은 런 수」로 묶인다. */
export const FRONT_VISIT_IDLE_TTL_MS = 6 * 60 * 60 * 1000;
/** 정리 훑기는 «가끔»만 한다 — 직전 훑기 뒤 1분이 안 됐으면 건너뛴다(크기와 무관 · 소수 런도 정리된다).
 *  ⇒ 훑기 비용 O(n) 은 «분당 한 번»으로 상각되고, 나머지 진입은 O(1) 이다. */
const FRONT_VISIT_PRUNE_INTERVAL_MS = 60 * 1000;
let lastFrontVisitPruneMs = Number.NEGATIVE_INFINITY;
const frontNodeVisitCounts = new Map<string, { byNode: Map<string, number>; lastSeenMs: number }>();
let frontVisitNow: () => number = () => Date.now();

/** 시험 전용 — 보관 중인 런 수. */
export function frontVisitRunCountForTesting(): number {
  return frontNodeVisitCounts.size;
}

/** 시험 전용 — 모듈 상태를 비우고 시계를 되돌린다(시험 사이 간섭 방지). */
export function resetFrontVisitCountsForTesting(now?: () => number): void {
  frontNodeVisitCounts.clear();
  frontVisitNow = now ?? (() => Date.now());
  lastFrontVisitPruneMs = Number.NEGATIVE_INFINITY;
}

function pruneIdleFrontVisitRuns(nowMs: number): void {
  if (nowMs - lastFrontVisitPruneMs < FRONT_VISIT_PRUNE_INTERVAL_MS) return;
  lastFrontVisitPruneMs = nowMs;
  for (const [runId, entry] of frontNodeVisitCounts) {
    if (nowMs - entry.lastSeenMs > FRONT_VISIT_IDLE_TTL_MS) frontNodeVisitCounts.delete(runId);
  }
}

/** 같은 runId 안의 노드별 진입 수로 `visitBudgetOf` 와 같은 모양의 판독을 만든다. */
function frontNodeVisitCount(template: GraphTemplate, node: string, runId: string): VisitBudgetReading | null {
  const nowMs = frontVisitNow();
  pruneIdleFrontVisitRuns(nowMs);
  let entry = frontNodeVisitCounts.get(runId);
  if (entry === undefined || nowMs - entry.lastSeenMs > FRONT_VISIT_IDLE_TTL_MS) {
    entry = { byNode: new Map<string, number>(), lastSeenMs: nowMs };
    frontNodeVisitCounts.set(runId, entry);
  }
  entry.lastSeenMs = nowMs;
  const visits = (entry.byNode.get(node) ?? 0) + 1;
  entry.byNode.set(node, visits);
  // ⛔ 방문 배열을 만들지 않는다 — 계수를 직접 건넨다(매 진입마다 배열 할당 없이 같은 판독).
  return visitBudgetOfVisits(template, node, visits);
}

/** 전반부 노드 진입을 원장에 남긴다. ⛔ `runSelfImplement` 의 것과 «같은 사건 이름»을 쓴다 —
 *  이름이 갈리면 「한 런이 어디까지 갔나」를 한 질의로 못 묻는다.
 *  ⭐ runId 가 있으면 방문 예산 판독(`graph-visit-budget`)도 남긴다 — 후반부 `visitBudgetOf` 와 같은 모양.
 *  호출부(실행 경로): src/self-dev/ask-launch-flow.ts — author(authoring-start) · plan(authoring-plan) ·
 *    decompose(authoring-decomposition-start) / src/self-dev/dev-cli.ts — decompose 둘(supervisor-*). */
export function observeFrontNodeEntry(node: FrontNodeId, data: {
  readonly provenance: FrontNodeEntryProvenance;
  readonly runId?: string;
  readonly goalId?: string;
  readonly goalType?: string;
  readonly round?: number;
}): void {
  try {
    const template = frontObservationTemplate(data.goalType === 'implement' ? 'implement' : undefined);
    debug.log('self-implement', 'pipeline-node-entry', {
      ...pipelineNodeEntryPayload(template, node),
      node,
      round: data.round ?? 0,
      ...(data.runId === undefined ? {} : { runId: data.runId }),
      ...(data.goalId === undefined ? {} : { goalId: data.goalId }),
      ...(data.goalType === undefined ? {} : { goalType: data.goalType }),
      provenance: data.provenance,
      // ⛔ 「전반부에서 왔다」를 값으로 — 후반부 걸음과 «섞이지» 않게.
      phase: 'front',
      graphTemplatesSource: GRAPH_TEMPLATES_SOURCE,
    });
  } catch { /* 관측은 fail-soft — 저작을 죽이지 않는다 */ }
  // ⛔ 방문 계수는 pipeline-node-entry 와 «별도의 try» 에서 — 어느 하나가 실패해도 다른 관측이 산다.
  if (data.runId === undefined) return; // runId 없는 진입은 판독을 내지 않는다 — 다른 런과 섞인 수를 지어내지 않는다.
  try {
    const template = frontObservationTemplate(data.goalType === 'implement' ? 'implement' : undefined);
    const reading = frontNodeVisitCount(template, node, data.runId);
    if (reading === null) return; // 선언에 없는 노드 — 예산을 지어내지 않는다.
    debug.log('self-implement', 'graph-visit-budget', {
      ...graphIdentityOf(template),
      ...reading,
      node,
      runId: data.runId,
      round: data.round ?? 0,
      // ⛔ 「전반부에서 왔다」를 값으로 — 후반부 판독과 «섞이지» 않게.
      phase: 'front',
      graphTemplatesSource: GRAPH_TEMPLATES_SOURCE,
    });
  } catch { /* 판독 실패는 fail-soft — 예산은 관측이고 저작을 막지 않는다 */ }
}
