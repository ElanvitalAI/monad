// ── Finance opportunity policy (P5a, 2026-07-05) ───────────────────────
//
// The PFC Layer-2 "OpportunisticLauncher" needs a POLICY that decides which
// market conditions warrant spinning up an autonomous analysis goal. This is
// that policy — the detection half. It reads the already-built signal engines
// (dislocation P3b · sector fusion P3c) and turns the notable ones into
// OpportunitySignal[], each carrying a `suggestedFocus` prompt an autonomous
// goal would run (finance tools + WebSearch) to investigate.
//
// SAFETY (P5c): this module is DETECTION ONLY — it never launches anything.
// Arming (feeding warrantsAnalysis signals into the launcher → a real goal)
// is a separate, config-gated step (finance.autoLoop, default OFF) so the
// policy can be validated disarmed first. Launched goals are ANALYSIS-ONLY
// (read-only finance tools); trade goals stay HITL-gated regardless.

import { computeDislocations } from './dislocation.js';
import { computeSectorFusion } from './sector-fusion.js';

export type OpportunityKind = 'dislocation' | 'sector_divergence';
export type OpportunitySeverity = 'high' | 'medium';

export interface OpportunitySignal {
  kind: OpportunityKind;
  /** asset class ('cash') or sector ('energy'). */
  subject: string;
  severity: OpportunitySeverity;
  /** One-line "why this is notable". */
  headline: string;
  /** The raw numbers behind it. */
  detail: string;
  /** The analysis an autonomous goal should run to resolve it — written as a
   *  self-contained prompt (assumes finance tools + WebSearch are available). */
  suggestedFocus: string;
  /** True when the signal crosses the AUTO-ANALYSIS threshold (high severity).
   *  Only these would feed the launcher when armed; medium = watch-only. */
  warrantsAnalysis: boolean;
}

/** Sector 13F net flow magnitude ($B) that makes a divergence high-severity. */
const SECTOR_HIGH_NETB = 5;
/** …and the floor for it to register as an opportunity at all. */
const SECTOR_MIN_NETB = 3;

const sign = (n: number): string => (n >= 0 ? '+' : '');

/** Evaluate the current market state into ranked opportunity signals.
 *  Read-only, fail-soft (empty engines → []). High-severity first. */
export function evaluateOpportunities(): OpportunitySignal[] {
  const out: OpportunitySignal[] = [];

  // ── Dislocations (P3b): crowd sentiment vs deterministic backbone ──
  for (const d of computeDislocations()) {
    if (d.severity === 'aligned') continue;
    const high = d.severity === 'strong';
    const crowdWord = d.sentiment > d.backbone ? '크라우드가 실측보다 강세' : '크라우드가 실측보다 약세';
    out.push({
      kind: 'dislocation',
      subject: d.asset,
      severity: high ? 'high' : 'medium',
      headline: `${d.asset} 괴리 — ${crowdWord}(gap ${sign(d.gap)}${d.gap})${d.signDisagree ? '·부호 반대' : ''}`,
      detail: `실측 backbone ${sign(d.backbone)}${d.backbone}(${d.backboneDir}) vs X-센티 ${sign(d.sentiment)}${d.sentiment}(${d.sentimentDir})`,
      suggestedFocus:
        `자산군 '${d.asset}'에서 X-크라우드 센티(${sign(d.sentiment)}${d.sentiment})와 결정론 실측 backbone(${sign(d.backbone)}${d.backbone})이 ${d.signDisagree ? '반대 방향으로 ' : ''}괴리(gap ${sign(d.gap)}${d.gap}). ` +
        `finance_dislocation·finance_market_backbone로 현황을 확인하고, WebSearch로 최근 ${d.asset} 관련 촉발 이벤트/뉴스를 찾아 ` +
        `이 괴리가 (a) 국면 전환 초기 신호인지 (b) 크라우드 과민반응인지 판정. 실측이 1급 근거. 매매 지시 금지·관찰과 유의점만.`,
      warrantsAnalysis: high,
    });
  }

  // ── Sector divergence (P3c): price momentum vs institutional 13F flow ──
  for (const s of computeSectorFusion()) {
    if (!s.divergent || Math.abs(s.netB) < SECTOR_MIN_NETB) continue;
    const high = Math.abs(s.netB) >= SECTOR_HIGH_NETB;
    const label = s.label === 'accumulation' ? '축적(가격약+기관매수)' : '분산(가격강+기관매도)';
    out.push({
      kind: 'sector_divergence',
      subject: s.sector,
      severity: high ? 'high' : 'medium',
      headline: `${s.sector} 섹터 ${label} — 가격#${s.rank} vs 기관 ${sign(s.netB)}${s.netB}B`,
      detail: `가격 momentum score ${s.price}(rank ${s.rank}/11) · 기관 13F QoQ ${sign(s.netB)}${s.netB}B`,
      suggestedFocus:
        `'${s.sector}' 섹터에서 가격 momentum(rank ${s.rank}/11, score ${s.price})과 기관 실자금(13F QoQ ${sign(s.netB)}${s.netB}B)이 ${label}로 발산. ` +
        `finance_sector·finance_13f_sectors로 어떤 종목이 흐름을 주도하는지 확인하고, WebSearch로 이 섹터의 최근 촉매(실적·정책·수급)를 조사해 ` +
        `기관이 ${s.label === 'accumulation' ? '낙폭 매집하는' : '고점 분산하는'} 근거가 무엇인지 판정. 13F는 45일 지연·가격이 1급. 매매 지시 금지.`,
      warrantsAnalysis: high,
    });
  }

  const sevRank: Record<OpportunitySeverity, number> = { high: 0, medium: 1 };
  return out.sort((a, b) => sevRank[a.severity] - sevRank[b.severity]);
}

/** Render the opportunity board (all) as a compact markdown summary. */
export function renderOpportunities(signals: OpportunitySignal[]): string {
  if (signals.length === 0) return '  (지금 자율분석 가치의 기회 신호 없음 — 실측·센티·기관 정렬)';
  return signals.map(s => {
    const mark = s.severity === 'high' ? '🔴' : '🟡';
    const arm = s.warrantsAnalysis ? ' ⚙️자율분석 후보' : '';
    return `  ${mark} [${s.kind === 'dislocation' ? '괴리' : '섹터발산'}] ${s.headline}${arm}\n     ${s.detail}`;
  }).join('\n');
}
