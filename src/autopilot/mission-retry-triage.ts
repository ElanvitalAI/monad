// ── 적응형 재시도 triage — 2번째 실패부터 관찰->동적 예산/전략(대표 2026-07-13) ──────
//
// 근본(대표 지시): 조사/구현 페이즈가 1·2번 시도에 실패할 때, 3번째를 "단순 예산 스케일
// 상향(고정 계단)"으로 반복하면 규율 실패(장황->산출물 미저장)는 예산이 클수록 오히려
// 악화된다(P2 실측: 128k->512k 4배에도 반복 실패). 근본적 갈림길 앞에서 실패 상황을
// 관찰해 "무엇이 바뀌어야 하는가"를 확실히 분류해야 한다.
//
// 갈림길(6종):
//   retry-discipline — 능력 OK·산출물 미저장(장황) : 예산 동일 + "저장 우선" 규율 주입(자동)
//   retry-budget     — 진짜 예산 부족(부분 저장·서술 적음) : 예산 상향(자동)
//   split            — 재시도에도 미해소·과대 의심 : 단일책임 분할(HITL)
//   revise           — 전제 부재/차단 : 골 범위 축소(HITL)
//   skip             — 후속 진행에 비필수 : 건너뛰기(HITL)
//   escalate         — 시스템 결함 의심 : 사람 판단(HITL)
//
// 결정론 휴리스틱(P2를 단독으로 해결·fail-soft fallback) + LLM 정련(갈림길 전문가) 2겹.
// 결정 신호의 핵심 = 필수 산출물의 디스크 존재(checkArtifactExistence) — 규율 실패 vs
// 진짜 부족을 텍스트 정규식이 절대 못 가르는 것을 결정론으로 가른다. 순수·DI(classify).

import type { ArtifactState } from './mission-artifact-discipline.js';

/** triage 가 고를 수 있는 근본 경로. retry-* 는 자동 실행, 나머지는 HITL 카드(대표 결정). */
export type RetryPath = 'retry-discipline' | 'retry-budget' | 'split' | 'revise' | 'skip' | 'escalate';

const RETRY_PATHS: readonly RetryPath[] = ['retry-discipline', 'retry-budget'] as const;
export function isRetryPath(p: RetryPath): boolean { return RETRY_PATHS.includes(p); }

/** 한 시도의 증거 — triage 가 관찰하는 사실. 예산·판정·서술량·산출물 존재. */
export interface RetryAttemptEvidence {
  attempt: number;              // 1-indexed
  budget: number;               // 그 시도의 maxTokens
  failReason: string;           // classifyFailure reason(budget/transient/blocked/unknown)
  verdictMissing: boolean;      // VERDICT 토큰 자체가 없었나
  textLength: number;           // 최종 응답 길이(장황함 프록시)
  textTail: string;             // 최종 응답 꼬리(진단 근거)
  artifacts: ArtifactState[];   // 시도 후 필수 산출물 디스크 존재/크기
}

/** triage 입력 — 페이즈 정체 + 누적 시도 증거 + 이전 triage 결정(루프 방지) + 다음 기계 예산. */
export interface RetryTriageInput {
  phaseTitle: string;
  goal?: string;
  acceptance?: string;
  requiredArtifacts: string[];
  attempts: RetryAttemptEvidence[];   // 지금까지 전체(누적)
  priorDecisions: RetryPath[];        // 이전 triage 가 고른 경로들
  nextBudgetDefault: number;          // 기계 계단상 다음 예산(retry 배수 적용 대상)
}

/** triage 결정 — 경로 + 다음 예산 + 주입 지시 + 근거. isRetry 면 자동, 아니면 HITL. */
export interface RetryTriageDecision {
  path: RetryPath;
  nextBudget: number;           // 실제 다음 시도 예산(retry 경로만 의미)
  injectInstructions: string[]; // 다음 시도 프롬프트에 주입할 지시
  rationale: string;
  isRetry: boolean;
  source: 'llm' | 'heuristic';
}

// 장황 판정 임계 — 최종 응답이 이보다 길고 산출물이 하나도 없으면 규율 실패로 본다.
const VERBOSE_TEXT_THRESHOLD = 1500;
// 재시도 총 한도 — 이만큼 retry 했는데도 미해소면 갈림길(분할/사람)로 전환.
const MAX_RETRIES = 2;

/** 규율 실패 재시도에 주입할 강한 지시 — 이전 시도가 왜 실패했는지 명시하고 저장 우선을 강제. */
function disciplineInstructions(paths: string[]): string[] {
  const list = paths.join(', ');
  return [
    `이전 시도는 서술만 길고 필수 산출물(${list})을 저장하지 않아 실패했다.`,
    '이번엔 조사 착수 즉시 그 파일에 최소 스키마 뼈대를 먼저 저장하고, 각 항목을 append 하라.',
    '분석 서술은 항목당 1-2문장으로 극도로 제한하라 — 저장 전에 긴 산문을 쓰지 마라.',
    'VERDICT PASS 전에 그 파일을 읽어 저장을 확인하고 경로를 인용하라.',
  ];
}

function heavy(path: RetryPath, rationale: string, nextBudget: number): RetryTriageDecision {
  return { path, nextBudget, injectInstructions: [], rationale, isRetry: false, source: 'heuristic' };
}
function retry(path: RetryPath, nextBudget: number, inject: string[], rationale: string): RetryTriageDecision {
  return { path, nextBudget, injectInstructions: inject, rationale, isRetry: true, source: 'heuristic' };
}

/** 결정론 갈림길 분류 — LLM 없이도 P2(장황->미저장)를 확실히 가른다. LLM 정련의 baseline·fallback.
 *  핵심 신호 = 필수 산출물 디스크 존재. 순수함수. */
export function heuristicTriage(input: RetryTriageInput): RetryTriageDecision {
  const latest = input.attempts[input.attempts.length - 1];
  const def = input.nextBudgetDefault;
  if (!latest) return retry('retry-budget', def, [], '증거 없음 — 기계 계단 유지');

  const req = input.requiredArtifacts;
  const missingAll = req.length > 0 && latest.artifacts.every((a) => !a.exists);
  const anySaved = latest.artifacts.some((a) => a.exists && a.sizeBytes > 0);
  const retriesSoFar = input.priorDecisions.filter(isRetryPath).length;
  const triedDiscipline = input.priorDecisions.includes('retry-discipline');

  // 전제 부재/차단 — 예산으로 못 푼다. 골 범위 축소(사람).
  if (latest.failReason === 'blocked') return heavy('revise', '전제 부재/차단 — 골 범위 축소 또는 사람 개입 필요', def);
  // 재시도 한도 소진 — 더 반복은 헛수고. 과대 의심 분할(사람 검토).
  if (retriesSoFar >= MAX_RETRIES) return heavy('split', `재시도 ${retriesSoFar}회에도 미해소 — 단일책임으로 분할(사람 검토)`, def);

  if (missingAll) {
    if (latest.textLength >= VERBOSE_TEXT_THRESHOLD) {
      // 장황한 서술 + 산출물 0 = 규율 실패. 예산 올리면 역효과 — 동일 유지 + 저장 우선 주입.
      if (triedDiscipline) return heavy('split', '저장 우선 규율 주입에도 산출물 미저장 — 페이즈 과대 의심(분할·사람 검토)', def);
      return retry('retry-discipline', latest.budget, disciplineInstructions(req),
        '장황한 서술로 예산 소진·산출물 미저장 — 예산 동일 유지 + 저장 우선 규율 주입');
    }
    // 서술도 적음 = 정말 일찍 소진. 예산 상향.
    return retry('retry-budget', def, [], '산출물 미저장 + 서술 적음 — 진짜 예산 부족 추정, 예산 상향');
  }
  // 부분 저장됐으나 미충족 — 예산 상향해 완성.
  return retry('retry-budget', def, [], anySaved ? '부분 저장·미완 — 예산 상향해 완성' : '미확정 실패 — 예산 상향 재시도');
}

const VALID_PATHS = new Set<RetryPath>(['retry-discipline', 'retry-budget', 'split', 'revise', 'skip', 'escalate']);

/** LLM triage 응답 파서 — PATH/BUDGET/INSTRUCT/WHY 라인 추출. 파싱 실패·무효 경로는 fallback 반환.
 *  순수함수. budgetMultiplier 는 [0.5, 8] 클램프. holdBudget=직전 실패 시도의 예산 — retry-discipline
 *  은 예산을 절대 올리지 않는다(규율 실패는 예산 클수록 서술만 늘어 악화·대표 통찰). */
export function parseTriageResponse(text: string, fallback: RetryTriageDecision, nextBudgetDefault: number, holdBudget: number): RetryTriageDecision {
  const pathM = text.match(/PATH:\s*([a-z-]+)/i);
  const path = pathM?.[1]?.toLowerCase() as RetryPath | undefined;
  if (!path || !VALID_PATHS.has(path)) return fallback;

  const budM = text.match(/BUDGET:\s*([0-9.]+)/i);
  const mult = budM ? Math.min(8, Math.max(0.5, Number(budM[1]))) : 1;
  const instM = text.match(/INSTRUCT:\s*(.+)/i);
  const inst = instM?.[1]?.trim();
  const injectInstructions = inst && !/^none$/i.test(inst) ? [inst] : (path === fallback.path ? fallback.injectInstructions : []);
  const whyM = text.match(/WHY:\s*(.+)/i);
  const rationale = whyM?.[1]?.trim().slice(0, 300) || fallback.rationale;

  const isRetry = isRetryPath(path);
  // retry-discipline: 예산 hold(배수는 1 이하만·규율 실패는 증액 금지). retry-budget: 계단상 상향.
  const nextBudget = path === 'retry-discipline'
    ? Math.round(holdBudget * Math.min(mult, 1))
    : isRetry ? Math.round(nextBudgetDefault * mult) : nextBudgetDefault;
  return { path, nextBudget, injectInstructions, rationale, isRetry, source: 'llm' };
}

/** triage 프롬프트 — 증거 패킷 + baseline 휴리스틱을 주고 근본 경로를 확정시킨다. ASCII+한글만. */
export function buildTriagePrompt(input: RetryTriageInput, baseline: RetryTriageDecision): string {
  const lines: string[] = [];
  lines.push('자율 미션 페이즈가 재시도에도 실패하고 있다. 근본적 갈림길에서 다음 시도가 무엇을 바꿔야 하는지 확실히 분류하라.');
  lines.push('핵심 원칙: 예산을 단순히 올리는 것이 답이 아닐 때가 많다. 특히 필수 산출물이 저장 안 됐는데 서술이 길면, 이는 예산 부족이 아니라 "저장 규율 실패"이며 예산을 올리면 오히려 악화된다.');
  lines.push('');
  lines.push(`페이즈: ${input.phaseTitle}`);
  if (input.goal) lines.push(`목표: ${input.goal.slice(0, 200)}`);
  lines.push(`필수 산출물: ${input.requiredArtifacts.length ? input.requiredArtifacts.join(', ') : '(선언 없음)'}`);
  lines.push('');
  lines.push('시도 트레일(사실):');
  for (const a of input.attempts) {
    const arts = a.artifacts.length
      ? a.artifacts.map((x) => `${x.path}=${x.exists ? `존재(${x.sizeBytes}B)` : '없음'}`).join(', ')
      : '(산출물 없음)';
    lines.push(`- 시도${a.attempt}: 예산 ${Math.round(a.budget / 1000)}k · 실패사유 ${a.failReason}${a.verdictMissing ? '(판정누락)' : ''} · 응답길이 ${a.textLength}자 · 산출물[${arts}]`);
  }
  if (input.priorDecisions.length) lines.push(`이전 triage 결정: ${input.priorDecisions.join(' -> ')}`);
  lines.push('');
  lines.push(`baseline 추천(결정론): ${baseline.path} — ${baseline.rationale}`);
  lines.push('이 추천을 확인하거나, 증거가 다른 근본을 가리키면 override 하라.');
  lines.push('');
  lines.push('경로 선택지: retry-discipline(저장 우선 규율 주입·예산 동일) | retry-budget(예산 상향) | split(과대·분할) | revise(전제 부재·범위 축소) | skip(비필수 건너뜀) | escalate(시스템 결함 의심·사람).');
  lines.push('정확히 이 형식으로만 답하라(다른 말 금지):');
  lines.push('PATH: <경로>');
  lines.push('BUDGET: <예산 배수, retry 경로만·예: 1.0=동일 2.0=2배·규율 실패면 1.0 이하>');
  lines.push('INSTRUCT: <다음 시도에 주입할 한 줄 지시, 없으면 NONE>');
  lines.push('WHY: <근거 1-2문장>');
  return lines.join('\n');
}

/** 적응형 재시도 triage — classify(LLM) 주입 시 정련, 없거나 실패 시 결정론 휴리스틱. fail-soft.
 *  어떤 경우에도 유효한 결정을 반환(미션을 막지 않음). */
export async function triageRetry(
  input: RetryTriageInput,
  deps: { classify?: (prompt: string) => Promise<string> } = {},
): Promise<RetryTriageDecision> {
  const baseline = heuristicTriage(input);
  if (!deps.classify) return baseline;
  try {
    const holdBudget = input.attempts[input.attempts.length - 1]?.budget ?? input.nextBudgetDefault;
    const raw = await deps.classify(buildTriagePrompt(input, baseline));
    return parseTriageResponse(raw, baseline, input.nextBudgetDefault, holdBudget);
  } catch {
    return baseline;
  }
}
