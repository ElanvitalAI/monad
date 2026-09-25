// ── 미션 셀프힐 맥락 파악 (RFC 자기인지 3박자·P2 · 2026-07-14) ────────────────
//
// 문제(RFC §2b): 셀프힐 판단(triage/heal)이 "그 순간의 summary/regex" 만 본다. 3박자에 이미
// 쌓인 관측(이 페이즈가 과거 몇 번 교착했는지·no-op 였는지)을 안 본다. 그래서 같은 페이즈가
// 매 미션 재실행마다 같은 교착을 반복해도 시스템은 "처음"인 양 다시 시도한다.
//
// 설계(RFC §3.2): 판단 직전, 3박자(logs.db·ops_events·working-memory)에서 셀프힐 이력을
// 조립하고 순수 요약(반복 교착 카운트 등)을 산출한다. P1 관문이 채운 logs.db 를 소스로 —
// 즉 P1(관측) 위에 P2(맥락)가 선다. 반복 교착 카운트는 P3(자율 revise 결선)의 근거가 된다.
//
// 전부 READ-ONLY·fail-soft. 순수 요약(summarizeSelfHealHistory)은 단위테스트로 회귀 가드.

import { getDefaultLogStore } from '../mss/logging/log-store.js';
import { openOpsEventsDb, queryOpsEvents, type OpsEventRow } from '../domains/ops-log.js';
import { readWorkingMemory } from './mission-working-memory.js';
import type { SelfHealStage, SelfHealVerdict } from './mission-observation.js';

/** logs.db 에서 복원한 셀프힐 이력 1건(category `mission.selfheal.<stage>` · event=verdict). */
export interface SelfHealHistoryEntry {
  stage: SelfHealStage | string;
  verdict: SelfHealVerdict | string;
  ts: string;
  rationale?: string;
  missing?: string;
}

/** 순수 요약 — 이력에서 계산한 파생 신호(프롬프트 주입·자율 판단 근거). */
export interface SelfHealHistorySummary {
  total: number;
  byStage: Record<string, number>;
  noopCount: number; // no-op verdict 횟수(구현자가 변경 0)
  deadlockCount: number; // 교착 감지 횟수
  recoverFailCount: number; // 리커버리 실패 횟수
  passCount: number; // 수렴/충족 횟수
  /** 이 페이즈가 과거에 이미 교착으로 판정된 적 있는가 — P3 자율 revise 트리거의 핵심 신호. */
  repeatDeadlock: boolean;
  /** 가장 최근 verdict 들(최신순·최대 5). */
  recentVerdicts: string[];
}

/** 판단 직전 조립되는 3박자 맥락. */
export interface SelfHealContext {
  missionId: string;
  phaseId: string;
  phaseTitle: string;
  history: SelfHealHistoryEntry[];
  summary: SelfHealHistorySummary;
  transitions: OpsEventRow[];
  reusables: string[];
  decisions: string[];
  /** ★ 운영자/에이전트 결정(provenance='decision'·RFC-mission-decision-injection·Layer 2) — 미션을 다스리는
   *  전제(re-ground·defer·boundary). triage 가 거스르지 않게 프롬프트에 부각. 일반 decisions 와 구분. */
  governingDecisions: string[];
}

/** 테스트/커스텀 주입용 reader seam — 미주입 시 실 3박자 조회(fail-soft empty). */
export interface SelfHealContextReaders {
  logsReader?: (phaseId: string) => SelfHealHistoryEntry[];
  opsReader?: (phaseId: string) => OpsEventRow[];
  wmReader?: (missionId: string) => { reusables: string[]; decisions: string[]; governingDecisions?: string[] };
}

/** category `mission.selfheal.deadlock` → stage `deadlock`. 아니면 원본 반환. */
function stageFromCategory(category: string): string {
  const m = /^mission\.selfheal\.(.+)$/.exec(category);
  return m ? m[1]! : category;
}

/** logs.db row(JSON data 문자열) → 이력 엔트리. 깨진 data 는 rationale/missing 없이 복원. */
function rowToHistoryEntry(row: { category: string; event: string; ts: string; data: string | null }): SelfHealHistoryEntry {
  let rationale: string | undefined;
  let missing: string | undefined;
  if (row.data) {
    try {
      const d = JSON.parse(row.data) as Record<string, unknown>;
      if (typeof d.rationale === 'string') rationale = d.rationale;
      if (typeof d.missing === 'string') missing = d.missing;
    } catch { /* 깨진 data — 무시 */ }
  }
  return { stage: stageFromCategory(row.category), verdict: row.event, ts: row.ts, ...(rationale ? { rationale } : {}), ...(missing ? { missing } : {}) };
}

/** 순수 요약 — 이력 배열에서 파생 신호를 계산(부작용 없음·단위테스트 대상). */
export function summarizeSelfHealHistory(history: readonly SelfHealHistoryEntry[]): SelfHealHistorySummary {
  const byStage: Record<string, number> = {};
  let noopCount = 0;
  let deadlockCount = 0;
  let recoverFailCount = 0;
  let passCount = 0;
  for (const h of history) {
    byStage[h.stage] = (byStage[h.stage] ?? 0) + 1;
    if (h.verdict === 'no-op') noopCount++;
    if (h.stage === 'deadlock') deadlockCount++;
    if (h.stage === 'recover' && h.verdict === 'fail') recoverFailCount++;
    if (h.verdict === 'pass' || h.verdict === 'converge') passCount++;
  }
  // 최신순 정렬(ts 내림차순) 후 verdict 상위 5.
  const recentVerdicts = [...history]
    .sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0))
    .slice(0, 5)
    .map((h) => `${h.stage}:${h.verdict}`);
  return { total: history.length, byStage, noopCount, deadlockCount, recoverFailCount, passCount, repeatDeadlock: deadlockCount > 0, recentVerdicts };
}

/** 실 3박자 조회 reader(fail-soft) — logs.db(P1 관문이 채운 셀프힐 이력). */
function defaultLogsReader(phaseId: string): SelfHealHistoryEntry[] {
  try {
    const store = getDefaultLogStore();
    if (!store) return [];
    const rows = store.query({ categories: ['mission.selfheal'], grep: phaseId, limit: 100 });
    return rows.map(rowToHistoryEntry);
  } catch { return []; }
}

function defaultOpsReader(phaseId: string): OpsEventRow[] {
  let db;
  try {
    db = openOpsEventsDb();
    return queryOpsEvents(db, { entityType: 'task', entityId: phaseId, limit: 50 });
  } catch { return []; }
  finally { try { db?.close(); } catch { /* noop */ } }
}

function defaultWmReader(missionId: string): { reusables: string[]; decisions: string[]; governingDecisions: string[] } {
  try {
    const entries = readWorkingMemory(missionId);
    // 운영 결정(provenance='decision')·외부 개정(provenance='external')은 미션을 다스리는 전제라
    // 별도 수집(RFC L3). 셀프힐이 이걸 거스르지 않는다 — 외부(claude-code)가 고친 걸 되돌리지 않게.
    const governingDecisions = [...new Set(entries
      .filter((e) => e.provenance === 'decision' || e.provenance === 'external')
      .map((e) => e.provenance === 'external' ? `[외부개정·존중] ${e.summary}` : e.summary)
      .filter(Boolean))];
    return {
      reusables: [...new Set(entries.flatMap((e) => e.reusables))],
      decisions: [...new Set(entries.flatMap((e) => e.decisions))],
      governingDecisions,
    };
  } catch { return { reusables: [], decisions: [], governingDecisions: [] }; }
}

/**
 * 판단 직전 3박자 맥락 조립 — READ-ONLY·fail-soft. P1 관문이 채운 logs.db 를 소스로 하므로
 * 미션 재실행 간에 누적된 교착/no-op 이력을 이 페이즈에서 인지한다(교착의 크로스런 파악).
 */
export function buildSelfHealContext(
  ctx: { missionId: string; phaseId: string; phaseTitle: string },
  readers: SelfHealContextReaders = {},
): SelfHealContext {
  const logsReader = readers.logsReader ?? defaultLogsReader;
  const opsReader = readers.opsReader ?? defaultOpsReader;
  const wmReader = readers.wmReader ?? defaultWmReader;
  const history = logsReader(ctx.phaseId);
  const transitions = opsReader(ctx.phaseId);
  const { reusables, decisions, governingDecisions } = wmReader(ctx.missionId);
  return {
    ...ctx,
    history,
    summary: summarizeSelfHealHistory(history),
    transitions,
    reusables,
    decisions,
    governingDecisions: governingDecisions ?? [],
  };
}

/**
 * 프롬프트 주입용 압축 문자열 — 과거 셀프힐 이력이 있을 때만 non-empty(첫 시도면 '').
 * triage/구현 프롬프트에 실어 "이 페이즈는 과거 N회 시도·M회 no-op·교착 K회" 를 시스템이 알게 한다.
 */
export function formatSelfHealContextForPrompt(context: SelfHealContext): string {
  const s = context.summary;
  const gov = context.governingDecisions ?? [];
  // ★ 운영 결정은 셀프힐 이력이 없어도 부각(미션을 다스리는 전제·Layer 2). 이력만 있으면 종전대로.
  if (s.total === 0 && gov.length === 0) return '';
  const lines: string[] = [];
  // 운영 결정을 최상단에 — triage/구현이 이 결정을 전제로 판단하고 거스르지 않게.
  if (gov.length) {
    lines.push('[미션 운영 결정 · 이 미션을 다스리는 확정 전제 — 거스르지 말고 전제로 판단하라]');
    for (const d of gov.slice(0, 8)) lines.push(`- ${d}`);
    lines.push('↳ re-ground된 기준은 재투쟁하지 말고, defer된 게이트는 지금 강제하지 말며, boundary는 그 경계까지만.');
    if (s.total > 0) lines.push('');
  }
  if (s.total > 0) {
    lines.push(
      '[미션 셀프힐 이력 · 이 페이즈의 과거 시도(재실행 누적) — 같은 실패를 반복하지 마라]',
      `과거 셀프힐 이벤트 ${s.total}건 · no-op ${s.noopCount}회 · 교착 ${s.deadlockCount}회 · 리커버리실패 ${s.recoverFailCount}회 · 충족 ${s.passCount}회.`,
    );
    if (s.repeatDeadlock) {
      lines.push('⚠️ 이 페이즈는 과거에 이미 구현자-검증자 교착으로 판정됐다(리커버리 opus 도 변경 0). 같은 범위로 재시도하면 또 교착이다 — 범위를 좁히거나(정의만·검증 분리) 검증 기준을 재검토하라.');
    }
    if (s.recentVerdicts.length) lines.push(`최근 판정(최신순): ${s.recentVerdicts.join(' → ')}`);
  }
  return lines.join('\n');
}
