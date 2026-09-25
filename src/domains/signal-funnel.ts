// ── 신호 퍼널 리포트 — 파이프라인 통과율 가시화 (관측성 P3·2026-07-15) ──────────
//
// signal pool 의 metricsSnapshot + computeMetrics(rate) + detectGaps 를 사람이 읽는 퍼널로
// 조립한다. "유입→분류→critical 승격→2차 판정→확정→집행" 각 단계 수·통과율을 한 눈에 봐,
// 게이트 튜닝(노이즈 vs 커버리지) 판단을 sqlite 직접조회 없이 상시 가시화한다(대표 지시).
//
// 순수(렌더만)·무네트워크. CLI(`monad signals`)가 pool 조회 후 이 빌더로 출력.

import type { MetricsSnapshot } from './signal-pool.js';
import { computeMetrics, detectGaps, type ResolutionGap } from './signal-metrics.js';

export interface FunnelReport {
  snapshot: MetricsSnapshot;
  metrics: ReturnType<typeof computeMetrics>;
  gaps: ResolutionGap[];
  lines: string[];
}

/**
 * 사람용 보고는 수치 메트릭의 안전한 0과 관측 부재를 구별한다.
 * `src/`의 기존 사람용 상태 표기(`안 본 스토어 수 미측정`, `측정 불가`)를 탐색한
 * 결과, 관측값이 없는 상태를 가리키는 짧은 한국어 표기인 `미측정`을 따른다.
 * 계산 계층은 구조화된 number 계약과 갭 표본 가드를 보존하고, 이 한 렌더 경로만
 * 실제 분모를 안다. nullable 계산값은 모든 소비자를 바꾸고, 비율·분모 복합값은
 * 이 단일 표시 요구에 과도하다. 모든 표시 비율이 이 포매터를 써서 데이터에 따라
 * 무분모 위치가 바뀌어도 0.0%로 오독되지 않는다.
 */
const pct = (r: number, denominator: number): string => denominator > 0 ? `${(r * 100).toFixed(1)}%` : '미측정';

/** metricsSnapshot → 사람이 읽는 퍼널 리포트(라인 배열 + 파생 지표 + 갭). */
export function buildFunnelReport(snapshot: MetricsSnapshot): FunnelReport {
  const m = computeMetrics(snapshot);
  const gaps = detectGaps(m);
  const s = snapshot;
  const sev = s.bySeverity;
  const lines: string[] = [];

  lines.push('신호 파이프라인 퍼널 (누적)');
  lines.push('');
  lines.push(`  유입 ${s.total}`);
  lines.push(`   └ 분류 ${s.classified}  ·  S1 ${sev.S1} / S2 ${sev.S2} / S3 ${sev.S3} / S4 ${sev.S4} / S0 ${sev.S0}`);
  lines.push(`      └ critical 승격(S3+) ${s.criticalRaised}  (전체의 ${pct(m.criticalShare, s.classified)})`);
  lines.push(`         └ 2차 판정 ${s.gate2Judged}  (커버리지 ${pct(m.gate2Coverage, s.criticalRaised)})`);
  lines.push(`            └ 확정 ${s.confirmed}  (확정률 ${pct(m.confirmRate, s.gate2Judged)})  ·  오탐강등 ${s.falsePositive} (${pct(m.falsePositiveRate, s.gate2Judged)})`);
  lines.push(`               └ 집행 paper ${s.execPaper} · refused ${s.execRefused}  (거부율 ${pct(m.execRefuseRate, s.execPaper + s.execRefused)})`);
  lines.push(`                  └ 사후검증 ${s.outcomeVerified} · 방향적중 ${s.outcomeCorrect}  (hit-rate ${pct(m.hitRate, s.outcomeVerified)})`);
  lines.push('');
  lines.push(`  배치 다이제스트 대기 ${s.pendingDigest}`);

  if (gaps.length > 0) {
    lines.push('');
    lines.push(`  ⚠ 갭 ${gaps.length}건:`);
    for (const g of gaps) lines.push(`   · ${g.kind}: ${g.note} → ${g.suggestion}`);
  } else {
    lines.push('');
    lines.push('  갭 없음 (임계 내)');
  }

  return { snapshot: s, metrics: m, gaps, lines };
}
