// ── 1차 게이트 — 저비용 전량 severity 분류 (적응형 투자 A1) ─────────────────
//
// signal pool 의 미분류 신호를 전량(무비용·결정론 규칙 우선) S0~S4 로 분류한다. critical(S3+)만
// 2차 게이트(A2·저비용 codex luna)로 에스컬레이트. 전량이라 무비용이 원칙(로컬 gemma seam 선택).
//
// ★ 모나드 자율설계 교정 반영:
//   · SNS/커뮤니티 단일 출처는 상한 S1 — 곧바로 매매신호로 취급 금지(독립 출처 확인 전).
//   · 심각도 ≠ 긴급도(별 축) · 다중 출처/공시/보유종목 영향 → 상향 · 만료(TTL) 신호 강등.
//
// 설계: 내부 문서 `DESIGN-adaptive-investment-autopilot-2026-07-11` §3·§12.4.

import type { Signal, Severity } from './signal-pool.js';
import { SignalPool } from './signal-pool.js';
import { debug } from '../debug/log.js';

export interface Gate1Result { severity: Severity; reason: string; }

/**
 * 커뮤니티/SNS 급증 승격 임계 — 같은 서사(dedupGroup)에 이 수 이상 신호가 몰리면 S3 승격.
 * "평시 대비 급증한 집중 버즈는 그 자체가 신호"(대표 지시·2026-07-15). 단일출처 캡 철학 유지:
 * 소수는 여전히 S1/S2, 다수 독립 출처의 집중 급증만 critical 로 올려 2차 판정에 회부.
 * 튜닝 축(노이즈 vs 커버리지): 낮추면 더 많은 버즈가 actionable, 높이면 최상위 급증만.
 */
export const COMMUNITY_SURGE_DEDUP = 30;

/** focus/보유 심볼 매칭(inFocus 동형·gate1 자기완결·의존 최소화). */
function matchFocus(symbol: string, list: string[]): boolean {
  const norm = (s: string) => s.replace(/\.(KO|KS|KQ|US)$/i, '').toUpperCase().trim();
  const n = norm(symbol);
  return list.some(s => norm(s) === n);
}

/** 결정론 규칙 분류 — 무비용·전량. 보수적(단일 출처 상한·중복 참고). deps 로 dedup 수 주입(테스트). */
export function classifySeverityRules(
  s: Signal,
  ctx: { dedupCount?: number; now?: number; communitySurgeDedup?: number; focusAssets?: string[] } = {},
): Gate1Result {
  const now = ctx.now ?? Date.now();
  const raw = `${s.raw} ${s.proposedAction ?? ''}`.toLowerCase();
  const dedup = ctx.dedupCount ?? 1;   // 같은 서사 신호 수(다중=신뢰↑)
  const surge = ctx.communitySurgeDedup ?? COMMUNITY_SURGE_DEDUP;
  const focus = ctx.focusAssets ?? [];
  const isFocus = !!s.asset && matchFocus(s.asset, focus);

  // 만료 신호 → S0(강등).
  if (s.ttlMs != null && now - Date.parse(s.collectedAt) > s.ttlMs) {
    return { severity: 'S0', reason: 'TTL 만료 — 배치 강등' };
  }
  // ★ 커뮤니티/SNS 는 키워드보다 우선해 상한(모나드 교정: 단일출처 잡담을 규제/급락 등
  //   단어만으로 매매신호 취급 금지). 급증(dedup≥surge)=집중 버즈 → S3(2차 판정 회부·P4).
  //   다중 독립 출처면 S2(저비용 확인)·단일이면 S1.
  if (s.source === 'community' || s.source === 'sns') {
    // ★ L1(대표 2026-07-15): focus/보유 티커의 반복 하락 버즈 급증(집계 신호) → 보호신호 후보 S3.
    //   detectBearishFloods 가 합성한 집계만 이 dedupGroup 을 씀(proposedAction=protection·방향 고정).
    if (s.dedupGroup?.startsWith('bearish-flood:')) {
      return { severity: 'S3', reason: '반복 하락 버즈 급증(focus) — 보호신호 후보·2차 심층 판정 회부' };
    }
    if (dedup >= surge) {
      return { severity: 'S3', reason: `커뮤니티 급증 서사(dedup ${dedup}≥${surge}) — 집중 버즈·2차 심층 판정 회부` };
    }
    return dedup >= 2
      ? { severity: 'S2', reason: '다중 커뮤니티/SNS 서사 — 저비용 확인 대상' }
      : { severity: 'S1', reason: '단일 커뮤니티/SNS — 상한 S1(독립 출처 확인 전 배치)' };
  }
  // ── 이하 신뢰 소스(news/disclosure/market/regime)에만 상향 적용 ──
  // ★ L4(대표 2026-07-15): 1h 모멘텀 watch 신호는 보유/focus 만 S4(즉시 심층). 무포지션·비focus
  //   저유동성(예: 0193W0 워런트) 급변은 gate2 회부 제외(watch S2) — 반복 오탐(FP 60%)의 주범 컷.
  const isMomentumWatch = s.source === 'market'
    && (/momentum/.test(String(s.proposedAction ?? '').toLowerCase()) || s.raw.startsWith('price-move'));
  if (isMomentumWatch) {
    const held = /\[held\]/.test(s.raw);
    return (held || isFocus)
      ? { severity: 'S4', reason: '보유/focus 자산 1h 급변(급락·급등) — 즉시 검토' }
      : { severity: 'S2', reason: '무포지션·비focus 1h 움직임 — 관망(gate2 회부 제외)' };
  }
  // 보호-긴급(운영 사건) — 거래정지/급락/급등 + 보유종목: S4(즉시 검토). 급등도 포함(대표
  //   2026-07-15: 1h 급락뿐 아니라 급등도 알림 — 무포지션 움직임 신호 escalate).
  if (s.asset && /거래정지|halt|급락|급등|circuit|서킷|폭락|급변|체결거부|반대매매/.test(raw)) {
    return { severity: 'S4', reason: '보유 자산 운영/급변(급락·급등) 이벤트 — 즉시 검토' };
  }
  // 공시/규제/실적 쇼크: S3(중대·2차 심층).
  if (s.source === 'disclosure' || /공시|규제|제재|실적쇼크|어닝|earnings|guidance|8-k|잠정실적/.test(raw)) {
    return { severity: 'S3', reason: '공시/규제/실적 — 국면·포지션 영향 심층 필요' };
  }
  // 다중 독립 출처 또는 시장/국면 신호: S2.
  if (dedup >= 2 || s.source === 'market' || s.source === 'regime') {
    return { severity: 'S2', reason: dedup >= 2 ? '다중 독립 출처 — 저비용 확인 대상' : '시장/국면 신호' };
  }
  // 나머지 뉴스/기타: S1.
  return { severity: 'S1', reason: '일반 신호 — 배치 다이제스트' };
}

/** 옵션 LLM(gemma) 분류 seam — 미주입 시 규칙만. 규칙보다 정밀하나 여전히 저비용(local). */
export type Gate1Classify = (s: Signal) => Promise<Gate1Result | null>;

export interface RunGate1Result { classified: number; bySeverity: Record<Severity, number>; }

/** pool 의 미분류 신호를 전량 분류·기록. LLM 주입 시 규칙 위에 refine(실패=규칙 유지). */
export async function runGate1(
  pool: SignalPool,
  deps: { classify?: Gate1Classify; limit?: number; now?: number; focusAssets?: string[] } = {},
): Promise<RunGate1Result> {
  const pending = pool.listUnclassified(deps.limit ?? 200);
  const bySeverity: Record<Severity, number> = { S0: 0, S1: 0, S2: 0, S3: 0, S4: 0 };
  let classified = 0;
  for (const s of pending) {
    const dedupCount = s.dedupGroup ? pool.dedupGroupCount(s.dedupGroup) : 1;
    let result = classifySeverityRules(s, {
      dedupCount, ...(deps.focusAssets ? { focusAssets: deps.focusAssets } : {}),
      ...(deps.now ? { now: deps.now } : {}),
    });
    // ★ 급증 승격은 서사당 1대표만(P4·비용가드) — 커뮤니티/sns 가 급증으로 S3 됐는데 같은 서사에
    //   이미 critical 이 있으면 S2 로 되돌린다. 안 하면 급증 서사의 수백 post 가 전부 S3→gate2(LLM
    //   폭발). 대표 1건이 2차 판정을 받고 dedupCount 가 급증 증거로 따라간다.
    //   ※ 하락 급증 집계(bearish-flood:*)는 이미 시간버킷당 1건 멱등이라 캡 예외(방향전환 재escalate).
    if ((s.source === 'community' || s.source === 'sns') && result.severity === 'S3'
        && !s.dedupGroup?.startsWith('bearish-flood:')
        && s.dedupGroup && pool.groupHasCritical(s.dedupGroup)) {
      result = { severity: 'S2', reason: '커뮤니티 급증 서사 — 대표 1건 이미 승격(중복 대표 S2 유지)' };
    }
    if (deps.classify) {
      try {
        const refined = await deps.classify(s);
        if (refined) result = refined;
      } catch { /* fail-soft — 규칙 유지 */ }
    }
    pool.markSeverity(s.eventId, result.severity, result.reason);
    bySeverity[result.severity] += 1;
    classified += 1;
    // ★ 게이팅 사유 관측(대표 지시) — 승격(S2+)만 per-signal 로깅. S0/S1 은 고볼륨(배치 강등)이라
    //   사이클 요약 카운트로 갈음(logs.db 홍수 방지). `monad logs --category signal.gate1` 조회.
    if (result.severity === 'S2' || result.severity === 'S3' || result.severity === 'S4') {
      debug.log('signal.gate1', result.severity, {
        asset: s.asset ?? null,
        source: s.source,
        severity: result.severity,
        reason: result.reason,
        dedup: dedupCount,
        raw: s.raw.slice(0, 160),
        eventId: s.eventId,
      });
    }
  }
  if (classified > 0) debug.log('signal.gate1', 'cycle', { classified, ...bySeverity });
  return { classified, bySeverity };
}
