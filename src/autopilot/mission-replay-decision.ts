// ── 조율자 리플레이/되감기 결정 seam (P5d·대표 2026-07-21) ──────────────────────
//
// 대표 지시: "리플레이가 자유로운 조율 에이전트의 능력이기도 하다." 되감기 인프라(exec-rewind → 재개 커서
// → run-mission 소비)는 완비됐으나, "언제·어디로 되감을지"를 조율자가 자율 판정하는 고리가 없었다(사람/CLI
// 전용). 이 모듈 = 그 판정 **순수 브레인**(P5b decideArcEdit 동형). 되감기의 본질 = **downstream 실패가
// upstream 실수(설계·계약)를 드러낼 때, 그 upstream 페이즈로 되감아 바로잡고 다시 구현**.
//
// ⚠️ 집행(exec-rewind 커서 write) 배선은 무한 되감기 루프 리스크가 있어 opt-in 후속(loop 가드 필수). 이
// 모듈은 판정만·매우 보수적(애매하면 no-rewind=현행 유지). rewind 는 명확한 upstream 귀인이 있을 때만.

export type ReplayAction = 'no-rewind' | 'rewind-to';

/** 되감기 후보 upstream 페이즈(현재 막힌 페이즈보다 앞·done). */
export interface RewindCandidate {
  phaseId: string;
  title: string;
  /** 실행 순서 인덱스(현재 막힌 페이즈보다 작아야 upstream). */
  index: number;
}

export interface ReplayDecisionInput {
  /** 현재 막힌(반복 실패) 페이즈. */
  stuckPhaseId: string;
  stuckTitle: string;
  stuckIndex: number;
  /** 이 페이즈가 세대 걸쳐 반복 실패한 횟수(되감기 정당성 — 1회 실패로 되감지 않는다). */
  recurrence: number;
  /** 되감기 후보(upstream done 페이즈). */
  candidates: readonly RewindCandidate[];
}

export interface ReplayContext {
  goal: string;
  /** 왜 막혔나 요약(설계 결함 귀인 근거). */
  failureSummary?: string;
}

export interface ReplayDecision {
  action: ReplayAction;
  targetPhaseId?: string;
  reason: string;
}

export interface RawReplayDecision { action?: string; targetPhaseId?: string; reason?: string }

export type ReplayResolve = (input: ReplayDecisionInput, context: ReplayContext) => Promise<RawReplayDecision>;

/** 되감기 정당성 최소 반복 — 이 미만이면 되감지 않는다(1~2회 실패는 재시도로 처리·프리매처 되감기 방지). */
export const MIN_RECURRENCE_FOR_REWIND = 3;

/**
 * ★ 리플레이/되감기 결정(순수·대표 2026-07-21). **매우 보수적**: (1) 반복 < 임계면 no-rewind (2) 후보 없으면
 * no-rewind (3) LLM 실패·유효하지 않은 액션·target 이 upstream done 후보 아님 → no-rewind. rewind 는 명확한
 * upstream 귀인이 있을 때만(잘못된 되감기 = 진행분 폐기·무한루프 리스크). resolve 는 seam(테스트).
 */
export async function decideReplayRewind(
  input: ReplayDecisionInput,
  context: ReplayContext,
  resolve: ReplayResolve,
): Promise<ReplayDecision> {
  const noRewind = (reason: string): ReplayDecision => ({ action: 'no-rewind', reason });

  // 1) 반복 부족 → 되감기 정당성 없음(재시도로 처리).
  if (input.recurrence < MIN_RECURRENCE_FOR_REWIND) {
    return noRewind(`반복 ${input.recurrence}회 < 임계 ${MIN_RECURRENCE_FOR_REWIND} — 되감기 보류(재시도 우선)`);
  }
  // 2) upstream 후보 없음 → 되감을 곳 없음.
  const upstream = input.candidates.filter((c) => c.index < input.stuckIndex);
  if (upstream.length === 0) return noRewind('upstream done 후보 없음 — 되감기 불가');

  let raw: RawReplayDecision;
  try {
    raw = await resolve(input, context);
  } catch {
    return noRewind('되감기 판정 LLM 실패 — 현행 유지(fail-soft·보수적)');
  }

  if (raw.action !== 'rewind-to') return noRewind((raw.reason ?? '').slice(0, 200) || '되감기 불필요 — 현행 유지');
  // target 은 반드시 upstream done 후보여야(잘못된 되감기·진행분 폐기 방지).
  const target = upstream.find((c) => c.phaseId === raw.targetPhaseId);
  if (!target) return noRewind(`되감기 target(${raw.targetPhaseId ?? '없음'})이 upstream 후보 아님 — 현행 유지(보수적)`);
  return { action: 'rewind-to', targetPhaseId: target.phaseId, reason: (raw.reason ?? '').slice(0, 200) };
}

/** ★ 되감기 판정 프롬프트(순수·테스트) — upstream 귀인 지시·보수적. JSON only. */
export function replayRewindPrompt(input: ReplayDecisionInput, context: ReplayContext): string {
  const upstream = input.candidates.filter((c) => c.index < input.stuckIndex);
  const candBlock = upstream.map((c) => `  - id=${c.phaseId} (순서 ${c.index}) ${c.title}`).join('\n');
  return [
    '너는 미션 조율자다. 아래 페이즈가 세대 걸쳐 반복 실패했다. 되감기(rewind)는 **downstream 실패가 upstream',
    '페이즈의 실수(설계·계약·전제)를 드러낼 때**, 그 upstream 으로 되감아 바로잡고 다시 구현하는 것이다.',
    '',
    `미션 골: ${context.goal.slice(0, 300)}`,
    context.failureSummary ? `실패 요약: ${context.failureSummary.slice(0, 300)}` : '',
    '',
    `막힌 페이즈: id=${input.stuckPhaseId} (순서 ${input.stuckIndex}) ${input.stuckTitle} · 반복 ${input.recurrence}회`,
    '',
    '되감기 후보(upstream done 페이즈):',
    candBlock || '  (없음)',
    '',
    '판정: 이 실패가 특정 upstream 페이즈의 잘못에서 비롯됐다고 **명확히** 판단되면 그 페이즈로 되감고,',
    '아니면(이 페이즈 자체의 문제·불명확) no-rewind. **매우 보수적으로** — 잘못 되감으면 진행분을 폐기한다.',
    '',
    '출력: 설명 없이 JSON 만. {"action":"no-rewind|rewind-to","targetPhaseId":"(rewind-to 시 upstream id)","reason":"한줄"}',
  ].filter(Boolean).join('\n');
}

/** 실 LLM 어댑터(streamLLM·luna). JSON 파싱·실패 시 no-rewind 유도(빈 action). */
export async function defaultReplayResolve(input: ReplayDecisionInput, context: ReplayContext): Promise<RawReplayDecision> {
  const { streamLLM } = await import('../llm.js');
  const { tierModel } = await import('../llm/model-defaults.js');
  const out = await streamLLM(
    [{ role: 'user', content: replayRewindPrompt(input, context) }],
    () => {},
    { model: process.env.ELANOUS_REPLAY_MODEL || tierModel('budget'), reasoningEffort: 'low' },
  );
  return parseReplayJson(out);
}

/** LLM 출력 → RawReplayDecision(순수·테스트). 실패 시 빈 객체(→no-rewind). */
export function parseReplayJson(out: string): RawReplayDecision {
  const stripped = out.replace(/^```[\w.-]*\n?/, '').replace(/\n?```\s*$/, '').trim();
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start < 0 || end < start) return {};
  try {
    const o = JSON.parse(stripped.slice(start, end + 1)) as Record<string, unknown>;
    return {
      ...(typeof o.action === 'string' ? { action: o.action } : {}),
      ...(typeof o.targetPhaseId === 'string' ? { targetPhaseId: o.targetPhaseId } : {}),
      ...(typeof o.reason === 'string' ? { reason: o.reason } : {}),
    };
  } catch {
    return {};
  }
}
