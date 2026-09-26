// ── SE(구현) 페이즈 적응형 재시도 triage — 갈림길 고도화(대표 2026-07-14) ──────────
//
// walker(조사) triage(mission-retry-triage.ts)의 SE 판(構). SE 는 격리 worktree 에서 코드를
// 만들고 게이트(무결성 테스트+비평)를 통과해야 하며, 재시도는 계단(terra 150 -> opus 400 ->
// opus 1000턴)으로 모델·예산을 올린다. 기존엔 split-vs-계속을 브리틀한 정규식(isStructuralFailure
// 2회)으로만 갈랐다. 이를 LLM 이 게이트 출력·비평 근거·구조 신호를 관찰해 근본 갈림길을 확실히
// 분류하도록 고도화한다(walker 와 동일 철학).
//
// SE 갈림길(5종):
//   retry-escalate — 게이트 실패(수정 가능) : 다음 계단(모델/예산 상향)으로 재시도(자동)
//   split          — 구조적 실패 반복(dead-code/범위밖/no-op)·과대 : 단일책임 분할(HITL)
//   revise         — 환경 제약(gh 인증/네트워크/의존 부재) : 골 범위 축소(HITL)
//   skip           — 후속 진행에 비필수 : 건너뛰기(HITL)
//   escalate       — 보안 경계/시스템 결함 의심 : 사람 판단(HITL)
//
// 결정론 휴리스틱(기존 SE 로직 미러+강화·fail-soft fallback) + LLM 정련 2겹. 순수·DI(classify).

/** SE triage 갈림길. retry-escalate 만 자동(다음 계단), 나머지는 중단->HITL(대표 결정). */
export type SERetryPath = 'retry-escalate' | 'split' | 'revise' | 'skip' | 'escalate';

export function seIsRetryPath(p: SERetryPath): boolean { return p === 'retry-escalate'; }

/** 한 SE 시도의 증거 — 게이트 결과·비평·구조 신호. triage 가 관찰하는 사실. */
export interface SEAttemptEvidence {
  attempt: number;               // 1-indexed
  backend: string;               // 'elanous-self:gpt-5.6-terra' | '...opus-4-8'
  maxTurns: number;
  gateStatus: string;            // built/gate-failed/pr-failed/no-change/error/core-violation
  gateText: string;              // r.next(게이트 사유)
  critiqueFindings: string[];    // 비평 findings(dead-code/no-op 등 구체 근거)
  structural: boolean;           // isStructuralFailure 신호(배선/범위/분해 문제)
}

/** SE triage 입력 — 페이즈 정체 + 누적 시도 + 이전 결정 + 계단 잔여(escalate 가능 여부). */
export interface SERetryTriageInput {
  phaseTitle: string;
  goal?: string;
  attempts: SEAttemptEvidence[];
  priorDecisions: SERetryPath[];
  hasMoreRungs: boolean;         // 다음 계단이 남았나(false=terra->opus 소진)
  nextRungLabel?: string;        // 다음 계단 표시(예: 'opus 4.8 1000턴')
}

/** SE triage 결정 — 경로 + 다음 시도 주입 가이드 + 근거. isRetry 면 자동, 아니면 HITL. */
export interface SERetryTriageDecision {
  path: SERetryPath;
  injectGuidance: string[];      // 다음 시도 PLAN 에 주입할 가이드(비평 반영 등)
  rationale: string;
  isRetry: boolean;
  source: 'llm' | 'heuristic';
}

// 보안 경계 — 문서 명령 실행/프롬프트 인젝션 의심. 자율 진행 금지.
const SECURITY_RE = /prompt.?injection|프롬프트.*인젝션|권한.?없는.?데이터|untrusted|보안.?경계/i;
// 환경 제약 — elanous 가 못 고치는 근본(gh 인증/네트워크/의존 부재). 골정정 또는 사람.
const MISSING_CAP_RE = /gh (인증|auth)|인증.*(없|부재|실패)|네트워크.*(없|부재|불가|실패)|의존.*(설치|부재)|dependency.*(missing|없)|권한.*없/i;

function heavy(path: SERetryPath, rationale: string): SERetryTriageDecision {
  return { path, injectGuidance: [], rationale, isRetry: false, source: 'heuristic' };
}
function retry(guidance: string[], rationale: string): SERetryTriageDecision {
  return { path: 'retry-escalate', injectGuidance: guidance, rationale, isRetry: true, source: 'heuristic' };
}

/** 결정론 SE 갈림길 분류 — 기존 SE 로직(구조적 2회->split·계단소진->split) 미러+강화. LLM baseline·fallback. 순수. */
export function seHeuristicTriage(input: SERetryTriageInput): SERetryTriageDecision {
  const latest = input.attempts[input.attempts.length - 1];
  if (!latest) return retry([], '증거 없음 — 계단 에스컬레이션 유지');
  // 보안/환경제약은 sticky 신호(한 번 발현되면 계속 유효) — 전 시도 텍스트를 훑는다.
  const allText = input.attempts.map((a) => `${a.gateText} ${a.critiqueFindings.join(' ')}`).join(' ');
  const structuralCount = input.attempts.filter((a) => a.structural).length;

  // 보안 경계 — 텍스트 우선(heal 을 근본적으로 바꿈).
  if (SECURITY_RE.test(allText)) return heavy('escalate', '보안 경계(문서명령/인젝션 의심) — 자율 진행 금지·사람 판단 필요');
  // 환경 제약 — 예산/모델로 못 푼다.
  if (MISSING_CAP_RE.test(allText)) return heavy('revise', '환경 제약(gh 인증/네트워크/의존 부재) — 골에서 해당 요구 축소 또는 사람 개입');
  // 구조적 실패 반복 — 배선/범위/분해 문제라 예산·모델 증액 무의미(기존 조기 분할 게이트).
  if (structuralCount >= 2) return heavy('split', `구조적 실패 ${structuralCount}회(dead-code/범위밖/no-op) — 예산·모델 증액 무의미·단일책임 분할`);
  // 계단 소진에도 미완 — 과대 의심.
  if (!input.hasMoreRungs) return heavy('split', '계단(terra->opus) 소진에도 미완 — 과대 페이즈 의심·분할');
  // 그 외 게이트 실패 — 다음 계단으로 에스컬레이션(수정 가능성).
  return retry([], `게이트 실패(수정 가능) — 다음 계단(${input.nextRungLabel ?? '상향'})으로 에스컬레이션`);
}

const VALID_PATHS = new Set<SERetryPath>(['retry-escalate', 'split', 'revise', 'skip', 'escalate']);

/** LLM SE triage 응답 파서 — PATH/GUIDE/WHY 추출. 파싱 실패·무효 경로는 fallback. 순수. */
export function parseSETriageResponse(text: string, fallback: SERetryTriageDecision): SERetryTriageDecision {
  const pathM = text.match(/PATH:\s*([a-z-]+)/i);
  const path = pathM?.[1]?.toLowerCase() as SERetryPath | undefined;
  if (!path || !VALID_PATHS.has(path)) return fallback;
  const guideM = text.match(/GUIDE:\s*(.+)/i);
  const guide = guideM?.[1]?.trim();
  const injectGuidance = guide && !/^none$/i.test(guide) ? [guide] : (path === fallback.path ? fallback.injectGuidance : []);
  const whyM = text.match(/WHY:\s*(.+)/i);
  const rationale = whyM?.[1]?.trim().slice(0, 300) || fallback.rationale;
  return { path, injectGuidance, rationale, isRetry: seIsRetryPath(path), source: 'llm' };
}

/** SE triage 프롬프트 — 게이트/비평/구조 증거 + baseline 을 주고 근본 갈림길을 확정. ASCII+한글만. */
export function buildSETriagePrompt(input: SERetryTriageInput, baseline: SERetryTriageDecision): string {
  const lines: string[] = [];
  lines.push('자율 미션의 구현(SE) 페이즈가 격리 worktree 에서 게이트(무결성 테스트+비평)에 반복 실패하고 있다. 근본 갈림길을 확실히 분류하라.');
  lines.push('핵심 원칙: 모델/예산(계단)을 올리는 것이 답이 아닐 때가 있다. dead-code(미배선)/범위밖/no-op 같은 구조 문제는 예산 증액으로 안 풀리고 분할이 답이다. gh 인증/네트워크/의존 부재는 골정정이 답이다.');
  lines.push('');
  lines.push(`페이즈: ${input.phaseTitle}`);
  if (input.goal) lines.push(`목표: ${input.goal.slice(0, 200)}`);
  lines.push('');
  lines.push('시도 트레일(사실):');
  for (const a of input.attempts) {
    const crit = a.critiqueFindings.length ? ` · 비평[${a.critiqueFindings.slice(0, 3).join(' / ').slice(0, 200)}]` : '';
    lines.push(`- 시도${a.attempt}: ${a.backend.replace(/^elanous-self:/, '')} ${a.maxTurns}턴 -> ${a.gateStatus}${a.structural ? '(구조적)' : ''} · 사유 ${a.gateText.slice(0, 120)}${crit}`);
  }
  lines.push(`다음 계단 남음: ${input.hasMoreRungs ? (input.nextRungLabel ?? '있음') : '없음(소진)'}`);
  if (input.priorDecisions.length) lines.push(`이전 triage 결정: ${input.priorDecisions.join(' -> ')}`);
  lines.push('');
  lines.push(`baseline 추천(결정론): ${baseline.path} — ${baseline.rationale}`);
  lines.push('이 추천을 확인하거나, 증거가 다른 근본을 가리키면 override 하라.');
  lines.push('');
  lines.push('경로 선택지: retry-escalate(다음 계단 모델/예산 상향 재시도) | split(구조적·과대·분할) | revise(환경 제약·범위 축소) | skip(비필수 건너뜀) | escalate(보안/시스템 결함·사람).');
  lines.push('정확히 이 형식으로만 답하라(다른 말 금지):');
  lines.push('PATH: <경로>');
  lines.push('GUIDE: <다음 시도에 주입할 한 줄 가이드(비평 반영 등), 없으면 NONE>');
  lines.push('WHY: <근거 1-2문장>');
  return lines.join('\n');
}

/** 적응형 SE 재시도 triage — classify(LLM) 주입 시 정련, 없거나 실패 시 결정론 휴리스틱. fail-soft. */
export async function seTriageRetry(
  input: SERetryTriageInput,
  deps: { classify?: (prompt: string) => Promise<string> } = {},
): Promise<SERetryTriageDecision> {
  const baseline = seHeuristicTriage(input);
  if (!deps.classify) return baseline;
  try {
    const raw = await deps.classify(buildSETriagePrompt(input, baseline));
    return parseSETriageResponse(raw, baseline);
  } catch {
    return baseline;
  }
}
