// ── Phase A1 · dig 분석 산출물 독립 품질 판정 (builder != checker · 2026-07-08) ──
//
// dig 자율 루프의 종료조건이 "ANALYSIS.md ≥300자"(길이 게이트)뿐이면 writer 가
// 300자만 채우고 self-declare done 할 수 있다(준 자기채점). 이 모듈은 산출물의
// "품질"을 writer 와 분리해 판정하는 순수 함수 — 독립 checker 스크립트
// (scripts/dig-analysis-checker.ts)가 goalRoot 에서 호출해 exit 0/1 로 종료조건에
// 반영한다(§5-④ writer/checker 분리 · terminationPresetWithChecker).
//
// ★ 결정론(LLM 아님) — 값싼 게이트. codex 의 "과도한 자동 auto-review revert"
//   교훈대로 LLM 재검토가 아니라 구조·차원 커버리지만 확인한다.
// ★ 기본 OFF(config finance.dig.autoGoal.independentChecker) — 루프 점화 시
//   대표가 함께 켠다. dig-goal-armer 에서만 배선(전역 analysis preset 불변).
//
// 근거: 내부 문서 `PLAN-loop-engineering-finance-reconnect-2026-07-08` §4 Phase A1.

export interface DigQualityResult {
  /** 전 필수 기준 통과. */
  pass: boolean;
  /** 통과 기준 수(0~3). */
  score: number;
  /** 실패 사유(빈 배열=전부 통과). */
  reasons: string[];
}

/** dig 골 프롬프트가 요구하는 분석 차원 — 국면판단·영향경로·매매함의·확신도. */
const DIMENSION_KEYWORDS: Array<{ name: string; rx: RegExp }> = [
  { name: '국면판단', rx: /국면|regime|판단|전망/i },
  { name: '영향경로', rx: /영향|경로|파급|밸류체인|채널|transmission/i },
  { name: '매매함의', rx: /매매|함의|관찰|포지션|watch|리스크|시사/i },
  { name: '확신도', rx: /확신|신뢰|confidence|불확실|가정/i },
];

const MIN_CHARS = 300;
const MIN_NONEMPTY_LINES = 3;
const MIN_DIMENSIONS = 2;

/**
 * dig 분석 산출물 품질 판정(길이 게이트 초과). 필수 3기준:
 *  1) length: 본문 ≥ 300자(공백 제거 기준)
 *  2) structure: 비어있지 않은 줄 ≥ 3 (한 덩어리 dump 방지)
 *  3) coverage: 요구 분석 차원(국면/영향/매매/확신) 중 ≥ 2개 언급
 * 세 기준 모두 충족해야 pass. writer 가 아닌 독립 checker 가 호출.
 */
export function assessDigAnalysis(text: string): DigQualityResult {
  const body = (text ?? '').trim();
  const compact = body.replace(/\s+/g, '');
  const nonEmptyLines = body.split('\n').filter((l) => l.trim().length > 0).length;
  const dimensions = DIMENSION_KEYWORDS.filter((d) => d.rx.test(body));

  const reasons: string[] = [];
  const lengthOk = compact.length >= MIN_CHARS;
  if (!lengthOk) reasons.push(`length ${compact.length}<${MIN_CHARS}`);
  const structureOk = nonEmptyLines >= MIN_NONEMPTY_LINES;
  if (!structureOk) reasons.push(`structure ${nonEmptyLines}줄<${MIN_NONEMPTY_LINES}`);
  const coverageOk = dimensions.length >= MIN_DIMENSIONS;
  if (!coverageOk) reasons.push(`coverage ${dimensions.length}차원<${MIN_DIMENSIONS} (${dimensions.map((d) => d.name).join('·') || '없음'})`);

  const score = [lengthOk, structureOk, coverageOk].filter(Boolean).length;
  return { pass: lengthOk && structureOk && coverageOk, score, reasons };
}
