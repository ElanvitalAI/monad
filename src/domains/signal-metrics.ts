// ── 해상도 성과 메트릭 — 적응형 투자 오토파일럿 A6 (2026-07-11) ──────────────────
//
// 발굴형 해상도 루프(§12.4)의 "학습루프 출력". supervisor 가 자기 파이프라인의 성과를 **실측**
// 으로 읽어 해상도 갭(오탐 과다·2차 커버리지 부족·심각도 인플레·다이제스트 적체)을 감지한다.
//
// ★ Goodhart 가드(§12.4 대표): 개선을 **자기선언 지표가 아닌 pool 실측 결과**로 판정. 표본이
//   부족하면(minSample) 갭 판정을 보류(노이즈에 반응하지 않음). 사후수익률 융합(paper P&L)은
//   향후 확장 — 현재는 게이트 품질 실측(오탐/커버리지/분포)에 근거.
//
// 갭 → 발굴 미션 씨앗(A6b signal-discovery). 순수 — pool 스냅샷 주입.
//
// 설계: 내부 문서 `DESIGN-adaptive-investment-autopilot-2026-07-11` §12.4·§12.6(A6).

import type { MetricsSnapshot } from './signal-pool.js';

export interface ResolutionMetrics {
  /** 오탐율 = falsePositive / gate2Judged. 높으면 1차가 과민(critical 남발). */
  falsePositiveRate: number;
  /** 2차 커버리지 = gate2Judged / criticalRaised. 낮으면 critical 이 2차에서 밀림. */
  gate2Coverage: number;
  /** 심각도 인플레 = criticalRaised / classified. 높으면 1차가 심각도 과대. */
  criticalShare: number;
  /** 확정율 = confirmed / gate2Judged. */
  confirmRate: number;
  /** 집행 거부율 = execRefused / (execPaper + execRefused). */
  execRefuseRate: number;
  /** ★ 사후 hit-rate = outcomeCorrect / outcomeVerified(B3·Goodhart 실성과). */
  hitRate: number;
  raw: MetricsSnapshot;
}

const rate = (num: number, den: number): number => (den > 0 ? num / den : 0);

export function computeMetrics(s: MetricsSnapshot): ResolutionMetrics {
  return {
    falsePositiveRate: rate(s.falsePositive, s.gate2Judged),
    gate2Coverage: rate(s.gate2Judged, s.criticalRaised),
    criticalShare: rate(s.criticalRaised, s.classified),
    confirmRate: rate(s.confirmed, s.gate2Judged),
    execRefuseRate: rate(s.execRefused, s.execPaper + s.execRefused),
    hitRate: rate(s.outcomeCorrect, s.outcomeVerified),
    raw: s,
  };
}

export type GapKind = 'high-false-positive' | 'low-gate2-coverage' | 'severity-inflation' | 'digest-backlog' | 'low-hit-rate';

export interface ResolutionGap {
  kind: GapKind;
  value: number;
  threshold: number;
  note: string;
  /** 발굴 미션 씨앗 제목(A6b). */
  suggestion: string;
}

export interface GapThresholds {
  falsePositiveRate?: number;   // 기본 0.6
  gate2Coverage?: number;       // 기본 0.5(미만이면 갭)
  criticalShare?: number;       // 기본 0.15
  digestBacklog?: number;       // 기본 50
  hitRate?: number;             // 기본 0.5(미만이면 갭·우연 이하 = 알파 없음)
  /** Goodhart 가드 — 표본(classified) 이 이 미만이면 갭 판정 보류. 기본 30. */
  minSample?: number;
  /** 사후 hit-rate 갭 최소 검증 표본(기본 10). */
  minOutcomes?: number;
}

const pct = (x: number): string => `${(x * 100).toFixed(0)}%`;

/** 실측 메트릭에서 해상도 갭을 감지. 표본 부족 시 빈 배열(Goodhart·노이즈 회피). */
export function detectGaps(m: ResolutionMetrics, thresholds: GapThresholds = {}): ResolutionGap[] {
  const minSample = thresholds.minSample ?? 30;
  if (m.raw.classified < minSample) return [];   // 표본 부족 → 판정 보류

  const fpTh = thresholds.falsePositiveRate ?? 0.6;
  const covTh = thresholds.gate2Coverage ?? 0.5;
  const critTh = thresholds.criticalShare ?? 0.15;
  const digTh = thresholds.digestBacklog ?? 50;
  const gaps: ResolutionGap[] = [];

  // 오탐 과다 — 2차 판정이 충분(표본)할 때만.
  if (m.raw.gate2Judged >= 10 && m.falsePositiveRate > fpTh) {
    gaps.push({
      kind: 'high-false-positive', value: m.falsePositiveRate, threshold: fpTh,
      note: `2차 오탐율 ${pct(m.falsePositiveRate)} > ${pct(fpTh)} — 1차 게이트가 과민(critical 남발)`,
      suggestion: `적응형 투자 1차 게이트 정밀도 개선 조사 — 오탐율 ${pct(m.falsePositiveRate)} 원인 분석 및 규칙/사전 보강`,
    });
  }
  // 2차 커버리지 부족 — critical 이 올라왔는데 2차 판정이 밀림.
  if (m.raw.criticalRaised >= 10 && m.gate2Coverage < covTh) {
    gaps.push({
      kind: 'low-gate2-coverage', value: m.gate2Coverage, threshold: covTh,
      note: `2차 커버리지 ${pct(m.gate2Coverage)} < ${pct(covTh)} — critical 이 2차에서 밀림`,
      suggestion: `적응형 투자 2차 게이트 처리량 조사 — critical ${m.raw.criticalRaised}건 대비 커버리지 ${pct(m.gate2Coverage)} 개선`,
    });
  }
  // 심각도 인플레 — 분류 중 critical 비중 과다.
  if (m.criticalShare > critTh) {
    gaps.push({
      kind: 'severity-inflation', value: m.criticalShare, threshold: critTh,
      note: `critical 비중 ${pct(m.criticalShare)} > ${pct(critTh)} — 1차 심각도 과대`,
      suggestion: `적응형 투자 심각도 분류 캘리브레이션 조사 — critical 비중 ${pct(m.criticalShare)} 정상화`,
    });
  }
  // 다이제스트 적체 — 배치가 소진 안 됨.
  if (m.raw.pendingDigest > digTh) {
    gaps.push({
      kind: 'digest-backlog', value: m.raw.pendingDigest, threshold: digTh,
      note: `다이제스트 미발송 ${m.raw.pendingDigest} > ${digTh} — 배치 소진 지연`,
      suggestion: `적응형 투자 다이제스트 적체 조사 — 미발송 ${m.raw.pendingDigest}건 소진 주기/포맷 점검`,
    });
  }
  // ★ 사후 hit-rate(B3·Goodhart 실성과) — 검증 표본 충분 + 우연(50%) 이하면 알파 없음.
  const minOut = thresholds.minOutcomes ?? 10;
  const hitTh = thresholds.hitRate ?? 0.5;
  if (m.raw.outcomeVerified >= minOut && m.hitRate < hitTh) {
    gaps.push({
      kind: 'low-hit-rate', value: m.hitRate, threshold: hitTh,
      note: `사후 hit-rate ${pct(m.hitRate)} < ${pct(hitTh)}(검증 ${m.raw.outcomeVerified}건) — 방향 정확도 우연 이하(알파 없음)`,
      suggestion: `적응형 투자 신호 방향 정확도 개선 조사 — hit-rate ${pct(m.hitRate)} 원인(게이트/렌즈/사이징) 분석`,
    });
  }
  return gaps;
}
