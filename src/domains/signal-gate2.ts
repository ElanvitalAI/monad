// ── 2차 게이트 — 저비용 codex(luna) 심층 판단 (적응형 투자 A2) ──────────────
//
// 1차가 critical(S3+)로 올린 소수만 활성 provider의 저비용 budget tier로 심층 판단.
// §3.6 렌즈: 진짜 위협인가·블러핑인가·국면 영향·연관 섹터(자율 판단)·
// 블러핑이어도 시장 출렁일지·권고(관망/알림/조정). 전량 아닌 critical만이라 저비용 유지.
//
// 설계: 내부 문서 `DESIGN-adaptive-investment-autopilot-2026-07-11` §4·§12.1.

import type { Signal } from './signal-pool.js';
import { SignalPool } from './signal-pool.js';
import type { MarketPosture } from './market-posture.js';
import { debug } from '../debug/log.js';
import { budgetModel } from '../llm/model-defaults.js';

/** 2차 게이트 모델(대표 확정) — env 오버라이드 가능. */
const GATE2_MODEL = () => process.env.ELANOUS_GATE2_MODEL || budgetModel();
const GATE2_EFFORT = () => (process.env.ELANOUS_GATE2_EFFORT || 'low') as
  'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface Gate2Verdict {
  /** 여전히 critical(진짜)인가 — false=오탐(배치 강등). */
  confirmed: boolean;
  /** 권고 — watch(관망)·alert(즉시 알림)·adjust(포지션 조정 검토). */
  recommendation: 'watch' | 'alert' | 'adjust';
  relatedSectors: string[];
  reason: string;
}

/** Posture는 notification/review urgency에만 쓰며 판정·집행 경계를 바꾸지 않는다. */
export type Gate2AlertPriority = 'routine' | 'elevated' | 'urgent';

export interface Gate2Context {
  posture: MarketPosture | null;
  alertPriority: Gate2AlertPriority;
}

/** DEFCON 숫자가 작을수록 위기 단계이므로 검토·알림 우선순위만 높인다. */
export function gate2AlertPriority(posture: MarketPosture | null | undefined): Gate2AlertPriority {
  if (!posture || posture.defcon >= 4) return 'routine';
  if (posture.defcon === 3) return 'elevated';
  return 'urgent';
}

function posturePromptContext(posture: MarketPosture | null | undefined): string[] {
  if (!posture) {
    return [
      '- market posture: unavailable (do not infer a direction from its absence)',
      '- review/alert priority: routine',
    ];
  }
  return [
    `- DEFCON: ${posture.defcon} (cadence/alertness only)`,
    `- provenance: calculatedBy=${posture.provenance.calculatedBy}; sources=${posture.provenance.sources.join(',') || '(none)'}`,
    `- freshness: ${posture.freshness.status}; observedAt=${posture.freshness.observedAt}; ageMs=${posture.freshness.ageMs}`,
    `- review/alert priority: ${gate2AlertPriority(posture)}`,
    '- DEFCON must not force either direction, confirm/reject result, recommendation, position action, new-buy freeze, or any order.',
  ];
}

/** Build the deep-review prompt; posture is read-only context rather than a decision rule. */
export function buildGate2Prompt(s: Signal, posture: MarketPosture | null = null): string {
  return [
    'You are the 2nd-tier gate of an adaptive investment autopilot. A cheap 1st-tier gate flagged this',
    'signal as potentially critical. Judge deeply but CONCISELY (cost-conscious). Korean market context',
    '(focus: 삼성전자 005930·KODEX레버리지 122630·KORU) + global macro.',
    '', 'Read-only market posture context:',
    ...posturePromptContext(posture),
    '', `Signal:`,
    `- source: ${s.source} (trust ${s.trust})`,
    s.asset ? `- asset: ${s.asset}` : '- asset: (none)',
    `- origin: ${s.origin}`,
    `- text: ${s.raw.slice(0, 500)}`,
    '', 'Assess:',
    '1) REAL threat/opportunity vs noise/bluffing? Even if bluffing, will the market swing anyway?',
    '2) Impact on current market regime + which RELATED sectors are affected (decide yourself).',
    '3) Recommendation: watch(just monitor) / alert(notify now, off-schedule) / adjust(review position).',
    '   Note: "critical" does NOT mean "trade now" — immediate action may be verification or risk-limiting.',
    '', 'Respond with ONE JSON object, no fences:',
    '{"confirmed": <bool: still genuinely critical>, "recommendation": "watch|alert|adjust",',
    ' "relatedSectors": ["<sector>", ...], "reason": "<one concise line>"}',
  ].join('\n');
}

export function parseGate2Response(raw: string): Gate2Verdict | null {
  try {
    const m = raw.replace(/```(?:json)?/g, '').match(/\{[\s\S]*\}/);
    if (!m) return null;
    const j = JSON.parse(m[0]) as Record<string, unknown>;
    const rec = j.recommendation;
    const recommendation = rec === 'alert' || rec === 'adjust' ? rec : 'watch';
    return {
      confirmed: j.confirmed === true,
      recommendation,
      relatedSectors: Array.isArray(j.relatedSectors) ? j.relatedSectors.filter((x): x is string => typeof x === 'string') : [],
      reason: typeof j.reason === 'string' ? j.reason : '',
    };
  } catch { return null; }
}

/** 판정 seam — 주입 없으면 luna 호출. Context is observational and cannot execute. */
export type Gate2Classify = (s: Signal, context: Gate2Context) => Promise<Gate2Verdict | null>;

async function lunaClassify(s: Signal, context: Gate2Context): Promise<Gate2Verdict | null> {
  const { streamLLM, resolveDefaultProvider } = await import('../llm.js');
  const model = GATE2_MODEL();
  const provider = resolveDefaultProvider(model);
  let full = '';
  await streamLLM([{ role: 'user', content: buildGate2Prompt(s, context.posture) }], (_d, all) => { full = all; },
    { model, reasoningEffort: GATE2_EFFORT(), ...(provider ? { provider } : {}) });
  return parseGate2Response(full);
}

export interface RunGate2Result { judged: number; confirmed: number; falsePositive: number; }

/**
 * critical(S3+) 미판정 신호를 2차 심층 판단·기록. posture는 read-only prompt/priority
 * context일 뿐 Gate2Verdict, SignalPool HITL 경계, 주문 실행 및 신규매수 동결을 바꾸지 않는다.
 */
export async function runGate2(
  pool: SignalPool,
  deps: { classify?: Gate2Classify; limit?: number; now?: () => string; posture?: MarketPosture | null } = {},
): Promise<RunGate2Result> {
  const now = deps.now ?? (() => new Date().toISOString());
  const classify = deps.classify ?? lunaClassify;
  const context: Gate2Context = {
    posture: deps.posture ?? null,
    alertPriority: gate2AlertPriority(deps.posture),
  };
  const targets = pool.listForGate2(deps.limit ?? 50);
  let confirmed = 0; let falsePositive = 0;
  for (const s of targets) {
    let v: Gate2Verdict | null = null;
    try { v = await classify(s, context); } catch { v = null; }
    // fail-soft — 판정 실패는 보수적으로 미확정(watch)·재시도 여지 위해 기록만.
    const verdict = v ?? { confirmed: false, recommendation: 'watch' as const, relatedSectors: [], reason: '2차 판정 실패(fail-soft·watch)' };
    pool.markGate2(s.eventId, {
      confirmed: verdict.confirmed,
      recommendation: verdict.recommendation,
      reason: `${verdict.reason}${verdict.relatedSectors.length ? ` · 연관: ${verdict.relatedSectors.join(',')}` : ''}`,
      at: now(),
    });
    // ★ 게이팅 사유 관측(대표 지시·2차 특히) — 판정 근거를 logs.db 3계층 척추에 남겨
    //   `elanous logs --category signal.gate2` 로 조회 가능. 안 남기면 sqlite 직접조회만 = 관측 안 한 것.
    //   sink 는 엔트리 스크립트가 등록(standalone-log-sink)·데몬은 상속. 미등록이면 no-op(fail-open).
    debug.log('signal.gate2', verdict.confirmed ? 'confirmed' : 'downgraded', {
      asset: s.asset ?? null,
      source: s.source,
      severity: s.severity ?? null,
      confirmed: verdict.confirmed,
      recommendation: verdict.recommendation,
      relatedSectors: verdict.relatedSectors,
      reason: verdict.reason,
      alertPriority: context.alertPriority,
      defcon: context.posture?.defcon ?? null,
      postureFreshness: context.posture?.freshness.status ?? 'UNAVAILABLE',
      postureProvenance: context.posture?.provenance ?? null,
      raw: s.raw.slice(0, 160),
      eventId: s.eventId,
    });
    if (verdict.confirmed) confirmed += 1; else falsePositive += 1;
  }
  debug.log('signal.gate2', 'cycle', {
    judged: targets.length, confirmed, falsePositive,
    alertPriority: context.alertPriority,
    defcon: context.posture?.defcon ?? null,
  });
  return { judged: targets.length, confirmed, falsePositive };
}
