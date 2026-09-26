// ── self-harness 공유 맥락 계약 (순수·W1 Context Capsule · 2026-07-23) ─────────────
//
// planner/executor/reviewer 가 목표·범위·완료 증거를 같은 짧은 계약으로 소비한다.
// grounding 은 사실 배경일 뿐 files/reusables 같은 실존 파일 주장으로 승격하지 않는다.

// provenance = grounding 사실의 출처 종류. 'pty'(F2·2026-07-25·[[PLAN §11-4]]) — 상류 PTY 잡(다른
// self-dev/agent 잡)의 산출 capsule 을 하류 잡이 grounding 으로 소비(컨텍스트 교환 척추·라이브 라우팅 없이 컴포지션).
export type HarnessGroundingProvenance = 'code' | 'skill' | 'memory' | 'doc' | 'pty';

export interface HarnessGroundingRef {
  ref: string;
  provenance: HarnessGroundingProvenance;
}

/** self-dev job 전체가 공유하는 불변 목표 완료 계약. */
export interface HarnessContextCapsule {
  objective: string;
  target: string;
  inScope: readonly string[];
  outOfScope: readonly string[];
  successCriteria: readonly string[];
  evidenceRequired: readonly string[];
  riskBoundaries: readonly string[];
  groundingRefs: readonly HarnessGroundingRef[];
  createdAt: string;
}

export type HarnessContextCapsuleInput = HarnessContextCapsule;

const GROUNDING_PROVENANCES = new Set<HarnessGroundingProvenance>(['code', 'skill', 'memory', 'doc', 'pty']);

/**
 * 입력을 복사해 stage 간 공유하는 capsule을 만든다. 시간/IO를 생성하지 않으므로 같은 input은 같은
 * capsule을 낳는다. provenance는 타입뿐 아니라 runtime에서도 좁혀, 기억/문서 출처가 흐려지지 않게 한다.
 */
export function buildHarnessContextCapsule(input: HarnessContextCapsuleInput): HarnessContextCapsule {
  for (const groundingRef of input.groundingRefs) {
    if (!GROUNDING_PROVENANCES.has(groundingRef.provenance)) {
      throw new Error(`Unknown harness grounding provenance: ${groundingRef.provenance}`);
    }
  }

  return {
    objective: input.objective,
    target: input.target,
    inScope: [...input.inScope],
    outOfScope: [...input.outOfScope],
    successCriteria: [...input.successCriteria],
    evidenceRequired: [...input.evidenceRequired],
    riskBoundaries: [...input.riskBoundaries],
    groundingRefs: input.groundingRefs.map(({ ref, provenance }) => ({ ref, provenance })),
    createdAt: input.createdAt,
  };
}

/** opt-in 무인 리뷰루프 라벨 SSoT — L3 폴러(pr-review-watch DEFAULT_WATCH_LABEL)와 공유. */
export const AUTO_REVIEW_LABEL = 'auto-review';

/** G8 자동부착 모드(config autoReview.mode). */
export type AutoReviewMode = 'off' | 'opt-in' | 'auto';

/**
 * G8 자동부착 확대(§2b) — config 모드 + 명시 플래그(--auto-review) → 라벨 부착을 **시도**할지.
 * 실제 부착은 여기서 true 라도 assessAutonomyEligibility(작업 위험도 자기판단·orchestrator)를 또 통과해야 함.
 * - 'off': kill switch — 플래그도 무시(전면 금지).
 * - 'opt-in'(기본): 사람이 --auto-review 준 경우만.
 * - 'auto': 플래그 없어도 자동 시도(저위험만 부착 — eligibility 게이트가 위험 거부). G10 안전봉투 그물 전제.
 */
export function resolveAutoReview(mode: AutoReviewMode, flag: boolean): boolean {
  if (mode === 'off') return false;
  if (mode === 'auto') return true;
  return flag;
}

// ── G8 자기판단 — 이 작업을 무인 리뷰루프(auto-review)에 태워도 되나 (2026-07-23) ────
//
// ROADMAP-elanous-is-all §2b(무인레벨 심화 삼각). capsule(riskBoundaries·evidence·scope)+리뷰 신호로
// "무인 완결(rework→심판→머지) 안전한 작업인가"를 시스템이 스스로 판정한다. capsule 의 첫 실소비처.
// 원칙: **fail-safe** — 판단 불확실/위험 신호 있으면 부적합(사람 첫 리뷰). 명백 저위험만 통과.
// 이 판정은 opt-in 플래그(--auto-review)의 **거부권**으로 작동(G8 1차: 자동 부착 아님·blast radius=사람 옵트인).

/** 무인 부적합 신호 — 사람 첫 리뷰가 필요한 작업 성격(외부영향·설계결정·파괴·보안). objective/riskBoundaries/scope 스캔. */
const AUTONOMY_RISK_PATTERNS: ReadonlyArray<{ re: RegExp; reason: string }> = [
  { re: /\b(deploy|release|rollout|prod(uction)?)\b|배포|운영\s*(반영|적용)|롤아웃/i, reason: '외부 배포/운영 반영' },
  { re: /\b(place[-\s]?order|live[-\s]?order|trade|payment|transfer|wire)\b|실주문|매수|매도|송금|결제|출금/i, reason: '실주문/금전 거래' },
  { re: /\b(migration|rewrite|re-?architect(ure)?|breaking\s*change|schema\s*change)\b|마이그레이션|재작성|재설계|아키텍처\s*변경|스키마\s*변경/i, reason: '설계/아키텍처 분기' },
  { re: /\b(drop\s*(table|database)|rm\s*-rf|force\s*push|destroy|purge)\b|전면\s*삭제|파괴적/i, reason: '파괴적 작업' },
  { re: /\b(credential|secret|api[-\s]?key|private[-\s]?key|password)\b|비밀키|인증정보|자격증명/i, reason: '보안/인증 정보' },
];

export interface AutonomyAssessmentInput {
  /** feature/goal 텍스트(objective). */
  objective: string;
  /** goal 문서에서 verbatimOriginalAsk로 추출한 사람의 ask. */
  originalAsk?: string;
  /** 추출 시점에 검증된 originalAsk의 objective 내 범위. 제공되면 문자열 재검색 대신 이것을 검증해 쓴다. */
  originalAskRange?: { start: number; end: number };
  /** target/base(레포내부 vs 외부). */
  target?: string;
  /** capsule 이 있으면 전달 — 위험경계·범위밖을 위험 스캔 대상에 포함. */
  riskBoundaries?: readonly string[];
  outOfScope?: readonly string[];
  /** 객관 증거 요구(tsc/test) — 비면 무인 심판 근거 약함. self-implement=gate(tsc/test) 항상 있음. */
  evidenceRequired?: readonly string[];
  /** 내부 리뷰 verdict — 'fail'(must-fix)이면 사람 판단 필요. */
  reviewVerdict?: string;
}

export type AutonomyRiskField = 'objective' | 'target' | 'riskBoundaries' | 'outOfScope';

export type AutonomyRiskSuppressionReason = 'explicit-negation' | 'outside-original-ask';

export interface AutonomyRiskHit {
  /** 매치된 위험 패턴의 사람이 읽을 수 있는 분류. */
  reason: string;
  /** 실제로 매치된 목표 텍스트. */
  match: string;
  /** 매치가 있던 문장 원문. */
  sentence: string;
  /** 매치가 나온 assessment 입력 필드. */
  field: AutonomyRiskField;
  /** 억제된 경우에만, 차단하지 않은 근거. */
  suppressionReason?: AutonomyRiskSuppressionReason;
}

export interface AutonomyEligibility {
  /** 무인 리뷰루프에 태워도 되나. */
  eligible: boolean;
  /** 부적합 사유(관측·PR 코멘트용). eligible=true 면 빈 배열. */
  reasons: string[];
  /** 부정 문맥이 아니어서 자율성을 막은 위험 패턴 일치. */
  riskHits: AutonomyRiskHit[];
  /** 명시적 범위 경계의 부정으로 억제한 위험 패턴 일치. */
  suppressedRiskHits: AutonomyRiskHit[];
}

const SENTENCE_BOUNDARY = /(?<=[.!?。！？]|\n)/;
const AMBIGUITY_MARKER = /\b(?:but|however|except|unless)\b|(?:하지만|그러나|단,?|대신)/i;
const ENGLISH_NEGATION = /\b(?:(?:do|must)\s+not|never)\b/gi;
// Conservative clause boundaries that END a leading negation's scope: subordinate-clause markers,
// the coordinating conjunction "and", and punctuation (comma/semicolon). A hit that sits in a
// separate clause after one of these is NOT governed by the negation, so it stays a risk signal
// ("Do not update docs; deploy to production" — the deploy clause is independent). "or" is left
// out on purpose: it coordinates alternatives of the same negated action ("do not copy or
// rewrite"), where the trailing verb IS under the negation.
const ENGLISH_SCOPE_BREAK = /[;,]|\b(?:before|after|while|when|and)\b/i;
const ENGLISH_NOT_A = /\b(?:is\s+)?not\s+(?:a\s+|an\s+|the\s+)?$/i;
const KOREAN_TARGET_NEGATION = /^\s*(?:을|를|은|는|이|가)?\s*(?:절대\s*)?(?:금지|하지\s*말\s*것|지\s*말\s*것|하지\s*않(?:는다|습니다|다|음)|않(?:는다|습니다|다|음)|아니다)(?=\s*(?:하고|이며|이거나|또는|,|[.!?。！？]|$))/;

function englishNegationScope(sentence: string): { start: number; end: number } | undefined {
  let latest: RegExpExecArray | undefined;
  for (const marker of sentence.matchAll(ENGLISH_NEGATION)) latest = marker;
  if (!latest || latest.index === undefined) return undefined;
  const start = latest.index + latest[0].length;
  const scopeCandidate = sentence.slice(start);
  const beforeSemicolon = scopeCandidate.slice(0, scopeCandidate.indexOf(';') === -1 ? undefined : scopeCandidate.indexOf(';'));
  const boundaries = [...scopeCandidate.matchAll(new RegExp(ENGLISH_SCOPE_BREAK.source, `${ENGLISH_SCOPE_BREAK.flags}g`))];
  const boundary = beforeSemicolon.includes(', or ')
    ? boundaries.find((candidate) => candidate[0] !== ',')
    : boundaries[0];
  return { start, end: boundary?.index === undefined ? sentence.length : start + boundary.index };
}

/** Only suppress a hit when an explicit negation governs its clause. Ambiguity stays risky. */
function isExplicitlyNegated(sentence: string, match: RegExpExecArray): boolean {
  if (match.index === undefined || AMBIGUITY_MARKER.test(sentence)) return false;
  const before = sentence.slice(0, match.index);
  const after = sentence.slice(match.index + match[0].length);

  // "not a migration" attaches only to the following hit.
  if (ENGLISH_NOT_A.test(before)) return true;

  // A leading negation governs its verb, object, and prepositional phrase up to a subordinate clause.
  // This suppresses both hits in "Do not deploy to production", but not deployment after "before".
  const englishScope = englishNegationScope(sentence);
  if (englishScope && match.index >= englishScope.start && match.index < englishScope.end) return true;

  // Korean negation is accepted only when directly attached to this hit (possibly through a particle).
  // Includes natural forms such as "배포하지 말 것", "배포하지 않는다", and "배포하지 않음".
  return KOREAN_TARGET_NEGATION.test(after);
}

function allMatches(pattern: RegExp, text: string): RegExpExecArray[] {
  return [...text.matchAll(new RegExp(pattern.source, `${pattern.flags.replace('g', '')}g`))];
}

function riskMatches(text: string, field: AutonomyRiskField): { riskHits: AutonomyRiskHit[]; suppressedRiskHits: AutonomyRiskHit[] } {
  const riskHits: AutonomyRiskHit[] = [];
  const suppressedRiskHits: AutonomyRiskHit[] = [];
  for (const sentence of text.split(SENTENCE_BOUNDARY)) {
    const normalized = sentence.trim();
    if (!normalized) continue;
    for (const pattern of AUTONOMY_RISK_PATTERNS) {
      for (const match of allMatches(pattern.re, normalized)) {
        const hit = { reason: pattern.reason, match: match[0], sentence: normalized, field };
        let suppressed = false;
        try {
          suppressed = isExplicitlyNegated(normalized, match);
        } catch {
          suppressed = false;
        }
        if (suppressed) suppressedRiskHits.push({ ...hit, suppressionReason: 'explicit-negation' });
        else riskHits.push(hit);
      }
    }
  }
  return { riskHits, suppressedRiskHits };
}

function deduplicateRiskHits(hits: readonly AutonomyRiskHit[]): AutonomyRiskHit[] {
  const seen = new Set<string>();
  return hits.filter((hit) => {
    const key = JSON.stringify([hit.field, hit.reason, hit.match, hit.sentence]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Returns a verified supplied range, or the original ask's one unambiguous legacy occurrence. */
function resolveOriginalAskRange(
  objective: string,
  originalAsk: string | undefined,
  suppliedRange: { start: number; end: number } | undefined,
): { start: number; end: number } | undefined {
  if (suppliedRange !== undefined) {
    const { start, end } = suppliedRange;
    if (!originalAsk || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > objective.length) return undefined;
    return objective.slice(start, end) === originalAsk ? { start, end } : undefined;
  }
  if (!originalAsk) return undefined;
  const first = objective.indexOf(originalAsk);
  if (first < 0 || objective.indexOf(originalAsk, first + originalAsk.length) !== -1) return undefined;
  return { start: first, end: first + originalAsk.length };
}

/** 무인 완결(auto-review) 적격 자기판단. fail-safe: 위험 신호 하나라도 있으면 부적합. */
export function assessAutonomyEligibility(input: AutonomyAssessmentInput): AutonomyEligibility {
  const reasons: string[] = [];
  // 1) 내부 리뷰가 must-fix 를 냈으면 부적합(사람 판단).
  if (input.reviewVerdict === 'fail') reasons.push('내부 리뷰 verdict=fail(must-fix) — 사람 판단 필요');
  // 2) 위험 경계를 필드별로 스캔해 출처를 보존하고, 같은 필드 안의 동일 히트만 제거한다.
  const askRange = resolveOriginalAskRange(input.objective, input.originalAsk, input.originalAskRange);
  const objectiveText = askRange === undefined
    ? input.objective
    : input.objective.slice(askRange.start, askRange.end);
  const fieldTexts: ReadonlyArray<readonly [AutonomyRiskField, readonly string[]]> = [
    ['objective', [objectiveText]],
    ['target', input.target === undefined ? [] : [input.target]],
    ['riskBoundaries', input.riskBoundaries ?? []],
    ['outOfScope', input.outOfScope ?? []],
  ];
  const allRiskHits: AutonomyRiskHit[] = [];
  const allSuppressedRiskHits: AutonomyRiskHit[] = [];
  if (askRange !== undefined) {
    const outsideOriginalAskSegments = [
      input.objective.slice(0, askRange.start),
      input.objective.slice(askRange.end),
    ];
    for (const segment of outsideOriginalAskSegments) {
      const { riskHits, suppressedRiskHits } = riskMatches(segment, 'objective');
      allSuppressedRiskHits.push(
        ...riskHits.map((hit) => ({ ...hit, suppressionReason: 'outside-original-ask' as const })),
        ...suppressedRiskHits.map((hit) => ({ ...hit, suppressionReason: 'outside-original-ask' as const })),
      );
    }
  }
  for (const [field, texts] of fieldTexts) {
    for (const text of texts) {
      const { riskHits, suppressedRiskHits } = riskMatches(text, field);
      allRiskHits.push(...riskHits);
      allSuppressedRiskHits.push(...suppressedRiskHits);
    }
  }
  const riskHits = deduplicateRiskHits(allRiskHits);
  const suppressedRiskHits = deduplicateRiskHits(allSuppressedRiskHits);
  const reasonKeys = new Set<string>();
  for (const hit of riskHits) {
    const reason = `위험 신호: ${hit.reason}`;
    if (!reasonKeys.has(reason)) {
      reasonKeys.add(reason);
      reasons.push(reason);
    }
  }
  // 3) 객관 증거 요구가 명시적으로 비면 심판 근거 약함(문서-only 류). 미지정(undefined)은 판정 보류(통과).
  if (input.evidenceRequired && input.evidenceRequired.length === 0) reasons.push('객관 증거(tsc/test) 없음 — 무인 심판 근거 약함');
  return { eligible: reasons.length === 0, reasons, riskHits, suppressedRiskHits };
}

/** G8 auto-review 라벨 해석 SSOT (G9 P1·2026-07-25) — `autoReview` 플래그 2단 게이트(플래그 AND
 *  assessAutonomyEligibility)를 한 곳에 모아 harness-seams(deploy)·self-implement orchestrator 의
 *  **verbatim 중복을 제거**한다. 로깅 채널(observe vs debug.log)은 surface-specific 이라 호출측이
 *  `declineReasons` 로 처리 — 이 헬퍼는 순수(라벨 계산만). eligible 이면 `labels`, 부적합이면
 *  `declineReasons`(둘 다 없으면 autoReview=false). */
export function resolveAutoReviewLabels(
  autoReview: boolean,
  assessment: AutonomyAssessmentInput,
): { labels?: string[]; declineReasons?: string[]; eligibility?: AutonomyEligibility } {
  if (!autoReview) return {};
  const eligibility = assessAutonomyEligibility(assessment);
  if (eligibility.eligible) return { labels: [AUTO_REVIEW_LABEL], eligibility };
  return { declineReasons: eligibility.reasons, eligibility };
}
