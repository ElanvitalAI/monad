// 반사-기각(reflect-reject) — RFC-selfdev-judgment-context-substrate Facet C.
//
import { statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { citedReviewSymbols } from '../agent-substrate/review-finding-key.js';
import { isAskPathLocatorToken } from './goal-author.js';
import { dispatchAstGrep, hasAstGrep, type AstGrepResult } from '../skills/tools/ast-grep.js';

// 리뷰가 낸 must-fix 를 무조건 재주입하면 false-positive(등가계약 밖·scope creep·stale-diff
// 아티팩트)가 rework 라운드를 소진하고 끝없이 이어진다. 재주입 前 각 must-fix 를 **등가계약
// 컨텍스트(goal + diff)** 대비 반사해 ACCEPT(계약 내 실버그) / REJECT(계약 밖) 로 가른다.
//
// 안전 불변식(RFC §6): (1) **보수 default-ACCEPT** — 불확실·파싱실패·안전/보안 관련은 accept
// (실버그 놓침 > 오기각). (2) 판정은 **코더와 분리된** judge LLM(자기 봐주기 방지). (3) 모든
// reject 는 근거와 함께 관측·감사 가능. 즉 reflect 는 "확실히 계약 밖"인 것만 조심스레 걷어낸다.

export interface ReflectResult {
  accepted: string[];
  rejected: { item: string; reason: string }[];
}

/** 자식이 골의 명시적 보존 계약을 근거로 must-fix를 감독에게 회부하는 문법. */
export interface MustFixFinding {
  id: string;
  item: string;
}

export type MustFixRefutationKind = 'preservation-contract' | 'requested-criterion' | 'invariant-candidate' | 'must-fix-conflict' | 'missing-cited-path' | 'found-cited-path';

export interface MustFixRefutation {
  findingId: string;
  finding: string;
  quote: string;
  kind: MustFixRefutationKind;
  reason: string;
  /** `must-fix-conflict`일 때만, 정렬된 두 번째 현재 finding. */
  conflictingFindingId?: string;
  conflictingFinding?: string;
}

/** REFUTE 후보가 엄격한 문법 또는 인용 자격에서 탈락한 단계. 원문·토큰은 관측으로 내보내지 않는다. */
export type MustFixRefutationRejection = {
  stage: 'prefix' | 'json-quote' | 'em-dash' | 'reason' | 'finding-id' | 'eligible-goal-line' | 'eligible-cited-path' | 'conflict-finding-id' | 'conflict-order';
  findingId?: string;
};

/** must-fix 문면만으로 라운드 재정렬과 무관한 ID를 만든다. */
export function stableMustFixId(item: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < item.length; i++) {
    hash ^= item.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `MF-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function snapshotMustFixFindings(mustFix: readonly string[]): MustFixFinding[] {
  return mustFix.map((item) => ({ id: stableMustFixId(item), item }));
}

/** REFUTE가 인용할 수 있는 goal 원문 줄과 각 줄의 회부 종류. SCOPE BOUNDARY 밖의 결정 줄은 허용하지 않는다. */
export function eligibleRefutationGoalLines(goal: string, options?: { allowInvariantCandidates?: boolean }): Map<string, MustFixRefutationKind> {
  const eligible = new Map<string, MustFixRefutationKind>();
  let inScopeBoundary = false;
  for (const line of goal.split(/\r?\n/)) {
    if (/^##\s+/.test(line)) inScopeBoundary = /^##\s+SCOPE BOUNDARY\s*$/.test(line);
    if (line.startsWith('- Checkable requested criterion:')) eligible.set(line, 'requested-criterion');
    else if (line.startsWith('- Checkable preservation criterion:')
      || (inScopeBoundary && (/^- (?:⭐|⛔|⏸️) 결정 \d+:/.test(line) || line.startsWith('- Boundary decision:')))) eligible.set(line, 'preservation-contract');
    else if (options?.allowInvariantCandidates && line.startsWith('- Invariant candidate:')) eligible.set(line, 'invariant-candidate');
  }
  return eligible;
}

/** 자식과 검사기가 공유하는 REFUTE 인용 자격 문면. */
export const REFUTATION_QUOTE_GRAMMAR = '인용은 골의 `- Checkable preservation criterion:` 줄, `- Checkable requested criterion:` 줄 또는 `## SCOPE BOUNDARY` 안의 `- Boundary decision:`/`- ⭐ 결정 N:`/`- ⛔ 결정 N:`/`- ⏸️ 결정 N:` 줄 전체여야 한다.';

export function refutationQuoteGrammar(options?: { allowInvariantCandidates?: boolean }): string {
  return options?.allowInvariantCandidates
    ? '인용은 골의 `- Checkable preservation criterion:` 줄, `- Checkable requested criterion:` 줄, `- Invariant candidate:` 줄 또는 `## SCOPE BOUNDARY` 안의 `- Boundary decision:`/`- ⭐ 결정 N:`/`- ⛔ 결정 N:`/`- ⏸️ 결정 N:` 줄 전체여야 한다.'
    : REFUTATION_QUOTE_GRAMMAR;
}

/** 자식이 반론 여부를 검토했지만 회부할 항목이 없음을 알리는 레거시 최종 요약 한 줄. */
export const MUST_FIX_REFUTATION_ACKNOWLEDGEMENT = 'REFUTE: NONE';
export const MUST_FIX_REFUTATION_ACKNOWLEDGEMENT_WITH_REASON = 'REFUTE: NONE — <reason>';
/** 골 줄이 아닌, 같은 라운드 기계 관측의 missing cited path를 인용하는 고정 REFUTE 토큰. */
export const MISSING_CITED_PATH_REFUTATION_QUOTE = 'MISSING-CITED-PATH';
/** 골 줄이 아닌, 같은 라운드 기계 관측의 found cited symbol을 인용하는 고정 REFUTE 토큰. */
export const FOUND_CITED_PATH_REFUTATION_QUOTE = 'FOUND-CITED-PATH';

export interface MustFixRefutationAcknowledgement {
  acknowledged: boolean;
  /** 유일한 이유 포함 무반론 선언일 때만 보존한다. */
  reason?: string;
}

/** 무반론 선언과 완성된 REFUTE 제출을 한 번 해석해 검토 여부와 무반론 사유를 반환한다. */
export function parseMustFixRefutationAcknowledgement(text: string): MustFixRefutationAcknowledgement {
  let submitted = false;
  const noneReasons: string[] = [];
  let legacyNone = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === MUST_FIX_REFUTATION_ACKNOWLEDGEMENT) {
      legacyNone = true;
      continue;
    }
    const noneMatch = /^REFUTE:\s*NONE\s+—\s+(.+)$/.exec(line);
    if (noneMatch) {
      const reason = noneMatch[1]!.trim();
      if (reason) noneReasons.push(reason);
      continue;
    }
    if (/^REFUTE\s+\[MF-[0-9a-f]{8}\](?:\s+CONFLICT\s+\[MF-[0-9a-f]{8}\])?\s+"(?:\\.|[^"\\])*"\s+—\s+.+$/.test(line)) submitted = true;
  }
  const acknowledged = submitted || legacyNone || noneReasons.length > 0;
  return {
    acknowledged,
    ...(!submitted && !legacyNone && noneReasons.length === 1 ? { reason: noneReasons[0]! } : {}),
  };
}

/** REFUTE 또는 acknowledgement가 있으면 자식이 해당 라운드의 반론 여부를 검토했음을 관측한다. */
export function hasMustFixRefutationAcknowledgement(text: string): boolean {
  return parseMustFixRefutationAcknowledgement(text).acknowledged;
}

/** strict REFUTE 문법을 원본 must-fix 스냅샷에만 대조한다. JSON 디코딩 뒤 goal 원문과 정확히 비교한다. */
export function parseMustFixRefutations(
  text: string,
  goal: string,
  snapshot: readonly MustFixFinding[],
  onRejected?: (rejection: MustFixRefutationRejection) => void,
  options?: { citedPathFacts?: readonly MustFixCitedPathFact[]; round?: number },
): MustFixRefutation[] {
  const eligible = eligibleRefutationGoalLines(goal);
  const eligibleMissingCitedPathFindingIds = eligibleMissingCitedPathFindings(options?.citedPathFacts ?? [], options?.round);
  const eligibleFoundCitedPathFindingIds = eligibleFoundCitedPathFindings(options?.citedPathFacts ?? [], options?.round);
  const findings = new Map(snapshot.map((finding) => [finding.id, finding]));
  const seen = new Set<string>();
  const refutations: MustFixRefutation[] = [];
  const reject = (stage: MustFixRefutationRejection['stage'], findingId?: string) => onRejected?.({ stage, ...(findingId ? { findingId } : {}) });
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!/^REFUTE\s+\[/.test(line)) continue;
    const idMatch = /^REFUTE\s+\[(MF-[0-9a-f]{8})\]/.exec(line);
    if (!idMatch) { reject('prefix'); continue; }
    const findingId = idMatch[1]!;
    const afterId = line.slice(idMatch[0].length);
    if (!/^\s+/.test(afterId)) { reject('prefix', findingId); continue; }
    const conflictMatch = /^\s+CONFLICT\s+\[(MF-[0-9a-f]{8})\]/.exec(afterId);
    const conflictingFindingId = conflictMatch?.[1];
    const afterReferences = conflictMatch ? afterId.slice(conflictMatch[0].length) : afterId;
    if (!/^\s+/.test(afterReferences)) { reject('prefix', findingId); continue; }
    const afterReferencesWhitespace = afterReferences.trimStart();
    const quoteMatch = /^("(?:\\.|[^"\\])*")/.exec(afterReferencesWhitespace);
    if (!quoteMatch) { reject('json-quote', findingId); continue; }
    let quote: unknown;
    try { quote = JSON.parse(quoteMatch[1]!); } catch { reject('json-quote', findingId); continue; }
    const afterQuote = afterReferencesWhitespace.slice(quoteMatch[0].length);
    if (!/^\s+—/.test(afterQuote)) { reject('em-dash', findingId); continue; }
    const afterDash = afterQuote.replace(/^\s+—/, '');
    if (afterDash && !/^\s+/.test(afterDash)) { reject('em-dash', findingId); continue; }
    const reason = afterDash.trim();
    if (!reason) { reject('reason', findingId); continue; }
    const finding = findings.get(findingId);
    if (!finding) { reject('finding-id', findingId); continue; }
    if (typeof quote !== 'string') { reject('eligible-goal-line', findingId); continue; }
    const quoteKind = eligible.get(quote);
    const missingCitedPath = quote === MISSING_CITED_PATH_REFUTATION_QUOTE;
    const foundCitedPath = quote === FOUND_CITED_PATH_REFUTATION_QUOTE;
    if (!quoteKind && !missingCitedPath && !foundCitedPath) { reject('eligible-goal-line', findingId); continue; }
    if (missingCitedPath && !eligibleMissingCitedPathFindingIds.has(findingId)) { reject('eligible-cited-path', findingId); continue; }
    if (foundCitedPath && !eligibleFoundCitedPathFindingIds.has(findingId)) { reject('eligible-cited-path', findingId); continue; }
    if (conflictingFindingId) {
      const conflictingFinding = findings.get(conflictingFindingId);
      if (!conflictingFinding || conflictingFindingId === findingId) { reject('conflict-finding-id', findingId); continue; }
      if (findingId > conflictingFindingId) { reject('conflict-order', findingId); continue; }
      // 충돌의 실질적 양립 가능성은 독립 감독이 판정한다. 이 경로는 현재의 서로 다른 두 finding,
      // 정렬된 쌍, 적격 goal 인용과 비어 있지 않은 근거라는 구조 계약만 검증한다.
      const pair = `${findingId}:${conflictingFindingId}`;
      if (seen.has(pair)) { reject('conflict-finding-id', findingId); continue; }
      seen.add(pair);
      refutations.push({ findingId, finding: finding.item, conflictingFindingId, conflictingFinding: conflictingFinding.item, quote, kind: 'must-fix-conflict', reason });
      continue;
    }
    if (seen.has(findingId)) { reject('finding-id', findingId); continue; }
    seen.add(findingId);
    refutations.push({ findingId, finding: finding.item, quote, kind: missingCitedPath ? 'missing-cited-path' : foundCitedPath ? 'found-cited-path' : quoteKind!, reason });
  }
  return refutations;
}

/** 같은 런이 태그 동등으로 계산한 골 증거 충족도. */
export interface ReflectEvidenceFacts {
  requiredEvidence: number;
  coveredEvidence: number;
  missingEvidence: readonly string[];
}

/** 같은 런의 gate-baseline 귀속 요약. unknown의 사유·자식 책임은 판정 가능한 경우에만 싣는다. */
export interface ReflectGateFacts {
  introduced: number;
  preexisting: number;
  unknown: number;
  /** ⏱️ 타임아웃으로 분류된 실패 수(`flaky-timeout`). ⛔ 이 칸이 없으면 타임아웃«뿐»인
   *  실패가 `introduced 0 · preexisting 0 · unknown 0` 으로 보인다(`JDG-T79` ⓐ). */
  timedOut?: number;
  /** 재실행에서 통과해 `introduced`에서 강등된 비타임아웃 실패 수. `introduced`·`timedOut`에 섞지 않는다. */
  flakyRerun?: number;
  /** `introduced` 재실행 상한 때문에 돌리지 않은 대상 수. */
  rerunNotRun?: number;
  /** base에서 통과했는데 head에서 시간 초과해 `introduced`로 귀속된 수. */
  timeoutPassedAtBase?: number;
  /** 타임아웃 귀속이 아닌 같은 실행 내 변동 가능 실패 수. */
  mayVaryNonTimeout?: number;
  /** 실제 재실행 관측을 얻은 실패 이름 수. */
  rerunAttempted?: number;
  /** 실제 재실행 관측 중 하나 이상이 통과한 실패 이름 수. */
  rerunRecovered?: number;
  unknownReason?: string;
  baselineBudgetMs?: number;
  baselineFileCount?: number;
  childResponsibility?: 'none';
}

/** Stable must-fix identity에 연결된 반복 관측. occurrence와 observedRounds는 상류의 집계를 보존한다. */
export interface MustFixRecurrenceHistory {
  findingId: string;
  occurrence: number;
  observedRounds: readonly number[];
}

/**
 * 인용 경로의 실재 — ⛔ «네 값»이고 넷이 다른 뜻이다.
 *
 * `exists`     실재한다
 * `missing`    ***경로 의도가 문면에 드러났는데*** 없다  ⇒ 「없는 경로를 요구했다」의 증거다
 * `unknown`    확인하지 못했다(대상 트리 밖·읽기 실패) ⇒ ⛔ 「없다」로 쓰지 마라
 * `ambiguous`  🆕 문면만으로는 경로인지 심볼·산문인지 못 가르고 실재하지 않는다
 *              ⇒ 🔑 ***`Makefile`(허구일 수 있다)과 `buildRequest`(함수다)와
 *                `search all files under src/fixtures`(산문이다)를 문면으로는 못 가른다.***
 *                그래서 관측에는 남기고 ***판정에는 쓰지 않는다*** — `missing` 에 섞으면 거짓 빨강이 된다.
 */
export type CitedPathExistence = 'exists' | 'missing' | 'unknown' | 'ambiguous';

/** A cited review symbol that deterministically resolved to a repository-relative path candidate. */
export type CitedSymbolSearchResult = 'found' | 'not-found-within-observed-scope';

export type CitedSymbolSearchEvidence = { file: string; line: number; text: string };

export interface MustFixCitedPathFact {
  /** Review round that produced this fact. Facts without it are legacy/unknown and cannot qualify an escalation. */
  round?: number;
  findingId: string;
  path: string;
  existence: CitedPathExistence;
  /** A symbol probe never claims repository-wide absence. */
  symbolSearch?: {
    result: CitedSymbolSearchResult;
    observedScope: string[];
    tool: 'ast-grep';
    maxResults: number;
    /** Observed matches within maxResults. When matchCountIsLowerBound, this count is a lower bound. */
    matchCount?: number;
    /**
     * True when the probe hit maxResults, so matchCount may undercount.
     * False when the probe finished under the cap (exact within observed scope).
     * Omitted is unknown — never treat omit as false in rendered output.
     */
    matchCountIsLowerBound?: boolean;
    /** One match keeps the historical object shape; several matches keep every entry inside the cap. */
    evidence?: CitedSymbolSearchEvidence | readonly CitedSymbolSearchEvidence[];
  };
}

/**
 * 기계 관측만으로 missing-cited-path 회부를 열어 주는 finding ID 집합.
 * 생산자가 기록한 round와 현재 round가 정확히 일치하는 `missing` 사실만 사용한다.
 * 라운드가 없거나 legacy fact에 round가 없으면 관측 범위를 확정할 수 없어 회부하지 않는다.
 */
export function eligibleMissingCitedPathFindings(
  facts: readonly MustFixCitedPathFact[],
  round?: number,
): Set<string> {
  if (round === undefined) return new Set();
  return new Set(facts
    .filter((fact) => fact.existence === 'missing' && fact.round === round)
    .map(({ findingId }) => findingId));
}

/**
 * 기계 관측만으로 found-cited-path 회부를 열어 주는 finding ID 집합.
 * 생산자가 기록한 round와 현재 round가 정확히 일치하고 symbolSearch.result가 `found`인 사실만 사용한다.
 * 라운드가 없거나 symbolSearch가 없거나 found가 아니면 회부하지 않는다.
 *
 * 여러 자리 `found`도 회부 자격을 유지한다. 심볼이 두 자리에 있어도 «있다»는 관측은 참이고,
 * 이 판의 목적은 수와 한정을 «말하게» 하는 것이지 기각 자격을 거두는 것이 아니다.
 * (어느 자리를 고칠지는 한정 문면이 판정자에게 넘긴다.)
 */
export function eligibleFoundCitedPathFindings(
  facts: readonly MustFixCitedPathFact[],
  round?: number,
): Set<string> {
  if (round === undefined) return new Set();
  return new Set(facts
    .filter((fact) => fact.symbolSearch?.result === 'found' && fact.round === round)
    .map(({ findingId }) => findingId));
}

export interface ObserveMustFixCitedPathsOptions {
  /** Review round that produced all returned facts. Omitting it preserves legacy observation but excludes those facts from escalation eligibility. */
  round?: number;
  /** The isolated target worktree used to resolve all cited paths. */
  cwd: string;
  /** Injectable filesystem probe: throws become `unknown`, never `missing`. */
  exists?: (path: string) => boolean;
  /** Injectable ast-grep availability probe. Errors become an empty observed scope. */
  hasAstGrep?: () => boolean;
  /** Injectable structural symbol search. Errors become an empty observed scope. */
  dispatchAstGrep?: (args: Record<string, unknown>, opts: { cwd?: string }) => Promise<AstGrepResult>;
}

/**
 * 인용 심볼의 «모양» — ⛔ 세 값이고 셋이 «다른 뜻»이다.
 *
 * 🚨 왜 `boolean` 이 아닌가(2026-08-19 · 무인 리뷰가 3라운드 반복 지적한 자리):
 *   `Dockerfile`·`Makefile` 처럼 ***구분자도 확장자도 없는 유효 경로***가 있다. 그것을 이름으로
 *   하드코딩하면 목록이 영영 늙고(그 우회가 `UNCONVERGEABLE` 을 냈다), 넣지 않으면 놓친다.
 * ⭐ 그런데 ***문면만으로는 `buildRequest` 와 `Dockerfile` 을 가를 수 없다*** — 둘 다 그냥 낱말이다.
 *   ⇒ 🔑 그러므로 「경로인가」를 문면에 묻지 않고 ***파일시스템에 묻는다***:
 *     `bare` 는 «실재할 때만» 경로로 인정하고, 없으면 ***「경로가 아니었다」*** 로 조용히 흘린다.
 *     ⛔ 그것을 `missing` 으로 부르면 ***함수 이름마다 「없는 경로를 요구했다」가 뜬다***(거짓 빨강).
 */
type CitedPathShape = 'explicit' | 'bare' | 'none';

function citedPathShape(symbol: string): CitedPathShape {
  if (!symbol || /[\r\n\t]/.test(symbol)) return 'none';
  // 공백을 품으면 산문(문장·마크업·셸 조각)이다. 빗금·확장자가 있어도
  // «경로 의도»로 단정하지 않는다 — 한 낱말과 같이 실재가 답한다.
  if (symbol.includes(' ')) return 'bare';
  // 위치 한정자(`file.ts:line` 또는 `ref:path`)는 공유 저작 규칙상 파일 경로가 아니다.
  if (isAskPathLocatorToken(symbol)) return 'bare';
  // 구분자·상대표기·확장자 중 하나라도 있으면 «경로 의도»가 문면에 드러났다.
  if (isAbsolute(symbol)
    || /^(?:\.{1,2}[\\/])/.test(symbol)
    || /[\\/]/.test(symbol)
    || /^[^\\/]+\.[A-Za-z0-9]+$/.test(symbol)) return 'explicit';
  // 그 밖의 한 낱말 — 경로인지 심볼인지 «모른다». 실재가 그것을 답한다.
  if (/^[A-Za-z0-9._-]+$/.test(symbol)) return 'bare';
  return 'none';
}

function defaultPathExists(path: string): boolean {
  statSync(path);
  return true;
}

function toCitedSymbolEvidence(match: { file: string; line: number; text: string }): CitedSymbolSearchEvidence {
  return { file: match.file, line: match.line, text: match.text };
}

function asCitedSymbolEvidenceList(
  evidence: CitedSymbolSearchEvidence | readonly CitedSymbolSearchEvidence[] | undefined,
): readonly CitedSymbolSearchEvidence[] {
  if (!evidence) return [];
  return 'file' in evidence ? [evidence] : evidence;
}

async function observeCitedSymbol(
  symbol: string,
  cwd: string,
  options: ObserveMustFixCitedPathsOptions,
): Promise<NonNullable<MustFixCitedPathFact['symbolSearch']>> {
  // max_results stays 20 — the query already fetched up to the cap; keeping every
  // match inside that cap does not widen ast-grep (cost unchanged).
  const maxResults = 20;
  const observedScope: string[] = [];
  const unseen = (): NonNullable<MustFixCitedPathFact['symbolSearch']> => ({
    result: 'not-found-within-observed-scope', observedScope, tool: 'ast-grep', maxResults, matchCount: 0,
  });
  try {
    if (!(options.hasAstGrep ?? hasAstGrep)()) return unseen();
    const result = await (options.dispatchAstGrep ?? dispatchAstGrep)({
      pattern: symbol,
      lang: 'typescript',
      path: 'src',
      output_mode: 'json',
      max_results: maxResults,
    }, { cwd });
    observedScope.push('src/**/*.ts via ast-grep typescript identifier pattern');
    const matches = result.matches.slice(0, maxResults);
    const matchCount = matches.length;
    if (matchCount === 0) {
      return { result: 'not-found-within-observed-scope', observedScope, tool: 'ast-grep', maxResults, matchCount: 0 };
    }
    // Cap-hit is a lower bound even when the search layer left truncated=false
    // (exactly maxResults matches). truncated remains an independent signal.
    const matchCountIsLowerBound = result.truncated || matchCount === maxResults;
    return {
      result: 'found',
      observedScope,
      tool: 'ast-grep',
      maxResults,
      matchCount,
      matchCountIsLowerBound,
      evidence: matchCount === 1
        ? toCitedSymbolEvidence(matches[0]!)
        : matches.map(toCitedSymbolEvidence),
    };
  } catch {
    return unseen();
  }
}

/**
 * Reuses the shared cited-symbol extractor, then evaluates every normalized file-path symbol.
 * A path outside the target worktree or a failed probe is `unknown`; neither may be treated as missing.
 */
export async function observeMustFixCitedPaths(
  mustFix: readonly string[],
  options: ObserveMustFixCitedPathsOptions,
): Promise<MustFixCitedPathFact[]> {
  let root: string;
  try {
    root = resolve(options.cwd);
  } catch {
    return [];
  }
  const seen = new Set<string>();
  const facts: MustFixCitedPathFact[] = [];
  for (const item of mustFix) {
    const findingId = stableMustFixId(item);
    for (const { symbol } of citedReviewSymbols(item)) {
      const path = symbol.trim();
      const shape = citedPathShape(path);
      if (shape === 'none') continue;
      const normalizedPath = path.replace(/\\/g, '/');
      const key = `${findingId}\u0000${normalizedPath}`;
      if (seen.has(key)) continue;
      seen.add(key);
      let existence: CitedPathExistence = 'unknown';
      try {
        const target = resolve(root, normalizedPath);
        const inside = relative(root, target);
        if (inside === '' || (!inside.startsWith(`..${sep}`) && inside !== '..' && !isAbsolute(inside))) {
          try {
            existence = (options.exists ?? defaultPathExists)(target) ? 'exists' : 'missing';
          } catch (error) {
            const code = (error as NodeJS.ErrnoException).code;
            existence = code === 'ENOENT' || code === 'ENOTDIR' ? 'missing' : 'unknown';
          }
        }
      } catch {
        existence = 'unknown';
      }
      // ⛔ `bare` 의 «부재»는 `missing` 이 아니라 `ambiguous` 다 — 문면으로는 경로인지 심볼·산문인지 모른다.
      //   (실재하면 그것이 경로였음을 파일시스템이 답한 것이므로 `exists` 를 그대로 쓴다.)
      const resolved: CitedPathExistence = shape === 'bare' && existence !== 'exists'
        ? 'ambiguous'
        : existence;
      facts.push({
        round: options.round,
        findingId,
        path: normalizedPath,
        existence: resolved,
        // 심볼 검색은 한 낱말 식별자에만 탄다 — 산문 조각을 ast-grep 패턴으로 보내지 않는다.
        ...(shape === 'bare' && !normalizedPath.includes(' ') && !options.exists ? { symbolSearch: await observeCitedSymbol(normalizedPath, root, options) } : {}),
      });
    }
  }
  return facts;
}

export function renderMustFixCitedPathFacts(facts: readonly MustFixCitedPathFact[]): string[] {
  return facts.map(({ findingId, path, existence, symbolSearch }) => {
    const base = `[${findingId}] ${path}: ${existence}`;
    if (!symbolSearch) return base;
    const evidences = asCitedSymbolEvidenceList(symbolSearch.evidence);
    const evidence = evidences.length === 1
      ? `; evidence=${evidences[0]!.file}:${evidences[0]!.line}`
      : evidences.length > 1
        ? `; evidence=${evidences.map((item) => `${item.file}:${item.line}`).join(',')}`
        : '';
    const line = `${base}; symbol-search=${symbolSearch.result}; observed-scope=${JSON.stringify(symbolSearch.observedScope)}; tool=${symbolSearch.tool}; max-results=${symbolSearch.maxResults}${evidence}`;
    const matchCount = symbolSearch.matchCount ?? evidences.length;
    const boundState = symbolSearch.matchCountIsLowerBound === true
      ? 'lower-bound'
      : symbolSearch.matchCountIsLowerBound === false
        ? 'exact'
        : 'unknown';
    if (matchCount > 1) {
      if (boundState === 'unknown') {
        return `${line}; 이 심볼은 여러 자리에 있다 — 어느 자리를 말하는지 이 관측은 모른다`;
      }
      return `${line}; 이 심볼은 ${matchCount} 자리에 있다${boundState === 'lower-bound' ? '(이 수는 하한)' : ''} — 어느 자리를 말하는지 이 관측은 모른다`;
    }
    if (boundState === 'lower-bound' && matchCount === 1) return `${line}; 이 수는 하한`;
    return line;
  });
}

export interface ReflectFacts {
  evidenceFacts?: ReflectEvidenceFacts;
  gateFacts?: ReflectGateFacts;
  refutations?: readonly MustFixRefutation[];
  /** 미제공이면 기존 호출자와 동일한 프롬프트를 유지한다. */
  recurrenceHistory?: readonly MustFixRecurrenceHistory[];
  /** Cited filesystem facts are observational only: they never auto-reject a must-fix. */
  citedPathFacts?: readonly MustFixCitedPathFact[];
}

/** 항목의 stable ID와 정확히 맞는 이력만 렌더링한다. 없거나 불일치하면 명시적으로 비어 있음이다. */
export function renderMustFixRecurrenceHistory(mustFix: readonly string[], recurrenceHistory: readonly MustFixRecurrenceHistory[]): string[] {
  const historyByFindingId = new Map(recurrenceHistory.map((history) => [history.findingId, history]));
  return mustFix.map((item, index) => {
    const findingId = stableMustFixId(item);
    const history = historyByFindingId.get(findingId);
    return history
      ? `${index + 1}. [${findingId}] 반복 이력: occurrence=${history.occurrence}, observedRounds=${JSON.stringify(history.observedRounds)}`
      : `${index + 1}. [${findingId}] 반복 이력: 비어 있음`;
  });
}

/** 기계 사실과 정면으로 어긋나는 must-fix 수. 자동 기각에는 쓰지 않고 관측으로만 남긴다. */
export function countReflectFactConflicts(mustFix: readonly string[], facts: ReflectFacts = {}): number {
  return mustFix.filter((item) => {
    const normalized = item.toLowerCase();
    const claimsMissingEvidence = /증거.*(?:없|누락|부족|부실)|(?:없|누락|부족|부실).*증거/.test(item);
    const claimsChildGateFailure = /(?:gate|게이트|테스트)[\s\S]*(?:fail|실패)|(?:fail|실패)[\s\S]*(?:gate|게이트|테스트)/.test(normalized);
    return (claimsMissingEvidence && facts.evidenceFacts?.requiredEvidence !== 0 && facts.evidenceFacts?.missingEvidence.length === 0)
      || (claimsChildGateFailure && (facts.gateFacts?.introduced === 0 || facts.gateFacts?.childResponsibility === 'none'));
  }).length;
}

/** goal(등가계약)+diff 하에서 must-fix 를 판정하는 judge 프롬프트. 각 항목을 번호로 ACCEPT/REJECT.
 *  REJECT 는 "왜 등가계약 밖인가" 근거 필수. 애매하면 ACCEPT(보수). */
export function buildReflectPrompt(mustFix: string[], goal: string, diff: string, facts: ReflectFacts = {}): string {
  const numbered = mustFix.map((m, i) => `${i + 1}. ${m}`).join('\n');
  const machineFacts = facts.evidenceFacts || facts.gateFacts
    ? [
      '',
      '## 같은 런의 기계 판정 사실',
      ...(facts.evidenceFacts ? [`- evidenceFacts: requiredEvidence=${facts.evidenceFacts.requiredEvidence}, coveredEvidence=${facts.evidenceFacts.coveredEvidence}, missingEvidence=${JSON.stringify(facts.evidenceFacts.missingEvidence)}${facts.evidenceFacts.requiredEvidence === 0 ? ' — 골이 기계 검사 가능한 증거를 요구하지 않았으므로, 이는 모든 증거가 덮였다는 뜻이 아니다.' : ''}`] : []),
      ...(facts.gateFacts ? [`- gateFacts: introduced=${facts.gateFacts.introduced}, preexisting=${facts.gateFacts.preexisting}, unknown=${facts.gateFacts.unknown}${facts.gateFacts.timeoutPassedAtBase !== undefined ? `, timeoutPassedAtBase=${facts.gateFacts.timeoutPassedAtBase}` : ''}${facts.gateFacts.unknownReason ? `, unknownReason=${facts.gateFacts.unknownReason}` : ''}${facts.gateFacts.baselineBudgetMs !== undefined ? `, baselineBudgetMs=${facts.gateFacts.baselineBudgetMs}` : ''}${facts.gateFacts.baselineFileCount !== undefined ? `, baselineFileCount=${facts.gateFacts.baselineFileCount}` : ''}${facts.gateFacts.childResponsibility ? `, child-responsibility=${facts.gateFacts.childResponsibility}` : ''}`] : []),
      ...(facts.gateFacts?.timeoutPassedAtBase !== undefined ? [`- introduced 중 timeoutPassedAtBase ${facts.gateFacts.timeoutPassedAtBase}건은 base에서 통과한 시험의 시간 초과다 — 느려진 회귀로 본다.`] : []),
      '- must-fix가 "증거가 없다"고 주장하는데 missingEvidence가 비어 있거나, 게이트 실패를 자식에게 청구하는데 introduced=0 또는 child-responsibility=none이면 REJECT하고 그 기계 사실을 이유에 적어라. 이는 자동 기각이 아니라 네 최종 판정에 쓰는 사실이다.',
    ]
    : [];
  const recurrenceFacts = facts.recurrenceHistory
    ? [
      '',
      '## must-fix별 반복 이력',
      ...renderMustFixRecurrenceHistory(mustFix, facts.recurrenceHistory),
      '- 반복은 의심의 근거일 뿐 그 자체로 REJECT 사유가 아니다. goal·diff·증거·gate 사실로 독립 판정하라.',
      '- 반복 이력을 근거로 REJECT하면 이유에 occurrence와 observedRounds를 그대로 인용하라.',
    ]
    : [];
  const citedPathFacts = facts.citedPathFacts?.length
    ? [
      '',
      '## 리뷰 인용 경로 관측',
      ...renderMustFixCitedPathFacts(facts.citedPathFacts),
      '- missing은 대상 worktree에서 인용 경로를 찾지 못했다는 기계 관측일 뿐이다. 자동으로 REJECT하지 말고 goal·diff와 함께 독립 판정하라.',
      '- unknown은 확인하지 못한 값이며 missing으로 단정하지 말라.',
      '- symbol-search=not-found-within-observed-scope는 기록된 observed-scope 안의 미발견일 뿐이며, 이 트리에 없다는 판정이 아니다.',
    ]
    : [];
  return [
    '너는 self-dev 파이프라인의 **반사(reflect) 판정자**다. 리뷰어가 낸 must-fix 각각이',
    '**이 작업의 등가계약(sanctioned scope) 안의 진짜 블로커**인지, 아니면 **계약 밖**(요청 범위 초과·',
    'scope creep·과제와 무관·goal 이 명시적으로 제외/금지한 것·diff 절단 아티팩트로 인한 오탐)인지 가른다.',
    '',
    '판정 규율(엄수):',
    '- 기본은 **ACCEPT**(실버그로 간주). **확실히 계약 밖**일 때만 REJECT 한다.',
    '- 애매하거나 판단 근거가 부족하면 ACCEPT. **안전·보안·데이터손실·정확성** 관련이면 무조건 ACCEPT.',
    '- 이 저장소가 모든 변경에 적용하는 규칙은 goal의 허가가 없어도 등가계약 안이다.',
    '- **미사용 public export 금지**는 모든 변경에 적용되는 규칙이므로, exported symbol이 소비되지 않는다는 must-fix는 무조건 ACCEPT한다.',
    '- REJECT 는 반드시 "왜 등가계약 밖인가"를 goal과 저장소 전역 규칙 기준으로 한 문장 근거와 함께.',
    '- 리뷰어를 이기려 하지 말라. 목적은 계약 밖 잡음만 조용히 걷어내 rework 무한을 끊는 것.',
    '',
    '## 등가계약(goal + 저장소 전역 규칙 · sanctioned scope)',
    goal.slice(0, 4000),
    '',
    '## 변경 diff',
    diff.slice(0, 12000),
    ...machineFacts,
    ...recurrenceFacts,
    ...citedPathFacts,
    ...(facts.refutations?.length ? [
      '',
      '## 자식의 REFUTE 회부 (자동 수용 금지)',
      ...facts.refutations.map((refutation) => `[${refutation.findingId}] ${refutation.finding}${refutation.conflictingFindingId ? `\n  충돌 지적: [${refutation.conflictingFindingId}] ${refutation.conflictingFinding}` : ''}\n  종류: ${refutation.kind} · 인용: ${JSON.stringify(refutation.quote)} · 근거: ${refutation.reason}`),
      '각 REFUTE는 자식의 주장일 뿐이다. 인용 문면이 goal의 허용 줄에 실재함은 기계적으로 확인됐지만, 반드시 네가 ACCEPT 또는 REJECT로 독립 판정하라.',
    ] : []),
    '',
    '## 판정 대상 must-fix',
    numbered,
    '',
    '각 번호마다 정확히 한 줄로 출력(다른 텍스트 금지):',
    '`<n>: ACCEPT` 또는 `<n>: REJECT — <계약 밖인 이유>`',
  ].join('\n');
}

/** judge 출력 파싱 — 항목별 ACCEPT/REJECT. **보수**: 명시적 `REJECT` 라인이 없거나 파싱 실패한 항목은
 *  ACCEPT(실버그 놓침 방지). REJECT 는 근거 텍스트가 있어야 인정(근거 없으면 ACCEPT 로 되돌림). */
export function parseReflectResult(text: string, mustFix: string[]): ReflectResult {
  const rejectReason: (string | undefined)[] = mustFix.map(() => undefined);
  const explicitAccept: boolean[] = mustFix.map(() => false);
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const m = line.match(/^`?\s*(\d+)\s*[:.)-]\s*(ACCEPT|REJECT)\b(.*)$/i);
    if (!m) continue;
    const idx = Number.parseInt(m[1]!, 10) - 1;
    if (idx < 0 || idx >= mustFix.length) continue;
    if (m[2]!.toUpperCase() === 'ACCEPT') { explicitAccept[idx] = true; continue; }
    const reason = m[3]!.replace(/^[\s—:-]+/, '').replace(/`+$/, '').trim();
    if (reason.length >= 4) rejectReason[idx] = reason;   // 근거 없는 REJECT 는 인정 안 함(보수)
  }
  const accepted: string[] = [];
  const rejected: { item: string; reason: string }[] = [];
  mustFix.forEach((item, i) => {
    // 보수: 명시 REJECT(근거O) AND 명시 ACCEPT 없음 일 때만 reject. 모순(둘 다)·미분류는 ACCEPT(실버그 놓침 방지).
    if (rejectReason[i] && !explicitAccept[i]) rejected.push({ item, reason: rejectReason[i]! });
    else accepted.push(item);
  });
  return { accepted, rejected };
}

export interface ReflectDeps {
  /** 코더와 분리된 judge LLM(프롬프트→텍스트). */
  judge: (prompt: string) => Promise<string>;
}

/** must-fix 를 등가계약(goal)+diff 대비 반사해 accepted/rejected 로 가른다. judge 실패·빈 must-fix 는
 *  **전부 ACCEPT**(보수·현행 무회귀). */
export async function reflectMustFix(
  mustFix: string[],
  ctx: { goal: string; diff: string; evidenceFacts?: ReflectEvidenceFacts; gateFacts?: ReflectGateFacts; refutations?: readonly MustFixRefutation[]; recurrenceHistory?: readonly MustFixRecurrenceHistory[]; citedPathFacts?: readonly MustFixCitedPathFact[] },
  deps: ReflectDeps,
): Promise<ReflectResult> {
  if (!mustFix.length) return { accepted: [], rejected: [] };
  try {
    const out = await deps.judge(buildReflectPrompt(mustFix, ctx.goal, ctx.diff, { evidenceFacts: ctx.evidenceFacts, gateFacts: ctx.gateFacts, refutations: ctx.refutations, recurrenceHistory: ctx.recurrenceHistory, citedPathFacts: ctx.citedPathFacts }));
    return parseReflectResult(out, mustFix);
  } catch {
    return { accepted: [...mustFix], rejected: [] }; // fail-safe: 전부 accept(무회귀)
  }
}
