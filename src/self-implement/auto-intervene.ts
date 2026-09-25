// ── S4 P3 — 결정론 자동 개입 판정 (순수) ──────────────────────────────────────────
import { realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import type { ControlDecision } from '../autopilot/pty-control-loop.js';

//
// [[DESIGN-s4-react-l2-observes-l3-2026-07-26]] §8 P3. P2b 는 brain 결정을 **관측만** 했다
// (`brain.suggestion { applied:false }`). P3 는 그중 **한 축만** 실제로 적용한다.
//
// ⚠️ **왜 종료 축뿐인가**(실측 제약 · 설계 §5c) — 자식은 one-shot 이다:
//   `chat --tools --goal-loop --new <prompt as argv>` — 프롬프트가 argv 로 들어가고 **stdin 을 읽는
//   주체가 없다**. 그래서 brain 의 `input` 제안을 PTY 에 써도 아무도 읽지 않는다. `input` 자동 적용은
//   **소비 채널**(제어면 mailbox · P6)이 선결이다. 부모가 채널 없이 지금 할 수 있는 유일한 개입은
//   **자기 대기를 끊는 것**이다.
//
// ⭐ **결정론 확증 없이는 멈추지 않는다.** LLM 이 `done` 이라 해도 화면이 실제로 멈춰 있다는
//   객관 신호(stall 사다리)가 함께 서야 한다. 판단 하나로 자식을 끊으면 진행 중인 작업을 죽인다.

/** stall 사다리 인덱스 — `capture/frame-observation.ts` STALL_RUNGS_MS 와 같은 축.
 *  0=15s · 1=60s · 2=5min. **-1 = stall 없음**(화면이 방금 바뀌었다 = 진행 중). */
export const NO_STALL = -1;

/** Self-implement uses the control brain's exact action vocabulary. */
export type BrainSuggestionAction = ControlDecision['action'];

/** 자동 종료의 완료 정보량에 쓰는 폐쇄형 결정론 분류. 그 밖의 화면 상태는 호출 경계에서 `unknown`으로 수렴한다. */
export type DeterministicCompletionState = 'done' | 'working' | 'unknown';

export interface BrainSuggestionNoveltyInput {
  /** 결정론 화면 분류가 이 tick 에 이미 알고 있는 완료 상태. */
  readonly state: DeterministicCompletionState;
  /** brain 이 제안한 행동. */
  readonly action: BrainSuggestionAction;
}

/**
 * brain 제안이 결정론 화면 분류에 더하는 **완료 정보량**.
 *
 * `done`만 완료 결론이므로 `working`/`unknown`에서의 done만 새 정보다. `state=done`의 done은
 * 화면 분류기가 이미 낸 결론을 반복할 뿐이다. `wait`와 `input`은 완료 결론을 주장하지 않으므로
 * 이 축에서는 항상 false다. 이는 정확도 평결이 아니다: true는 독립적인 완료 주장일 뿐, 옳거나
 * 지금 부모 대기를 끊어도 안전하다는 뜻이 아니다.
 */
export function hasNovelCompletionSignal(i: BrainSuggestionNoveltyInput): boolean {
  return i.action === 'done' && i.state !== 'done';
}

export interface AutoStopInput {
  /** brain 이 낸 결정의 행동. */
  readonly action: BrainSuggestionAction;
  /** 결정론 화면 분류의 완료 상태. `done`이면 brain done은 정보 추가가 없어 개입하지 않는다. */
  readonly state: DeterministicCompletionState;
  /** 이 tick 의 stall 사다리 단. 없으면 `NO_STALL`(-1). */
  readonly stallRung: number;
  /** 자식이 아직 살아 있나. 죽었으면 기존 경로가 이미 루프를 끊으므로 개입이 아니다. */
  readonly childAlive: boolean;
  /** 설정 로더가 늘 켬으로 싣는다(설정 졸업 1-a · 2026-09-24 · 파일의 `enabled` 는 폐기 키). 시험은 주입한다. */
  readonly enabled: boolean;
  /** 확증에 필요한 최소 stall 단(`…autoStop.minRung`) — 기본 2(5분). */
  readonly minRung: number;
}

export type AutoStopVerdict =
  | { stop: true; why: string; shadowed: false; wouldStop: true; evidenceWhy: string }
  | { stop: false; why: string; shadowed: boolean; wouldStop: boolean; evidenceWhy: string };

export interface ScreenStallSilenceInput {
  /** 이 tick의 화면 무변화 사다리 단. 없으면 `NO_STALL`(-1). */
  readonly stallRung: number;
  /** 마지막 PTY 출력 이후 지난 poll tick 수. */
  readonly silentFor: number;
  /** soft timeout이 요구하는 출력 무활동 유예 tick 수. */
  readonly activityGrace: number;
  /** 자식이 아직 살아 있나. */
  readonly childAlive: boolean;
  /** 화면이 이미 완료를 선언했나. */
  readonly completionDeclared: boolean;
  /** 설정 로더가 늘 켬으로 싣는다(설정 졸업 1-a · 2026-09-24 · 파일의 `enabled` 는 폐기 키). 시험은 주입한다. */
  readonly enabled: boolean;
  /** 확증에 필요한 최소 stall 단(`…screenStallTermination.minRung`) — 기본 2(5분). */
  readonly minRung: number;
}

/**
 * Discriminated on `terminate` so consumers keep narrowing on the gated execution flag, exactly as
 * `AutoStopVerdict`/`AutoAssistVerdict` do. The gate-independent evidence fields ride on both
 * branches without collapsing the union. `terminate`/`why` keep their existing mutable contract;
 * only the evidence fields are added.
 */
export type ScreenStallSilenceVerdict =
  | { terminate: true; why: string; evidenceSatisfied: boolean; evidenceWhy: string }
  | { terminate: false; why: string; evidenceSatisfied: boolean; evidenceWhy: string };

/**
 * Rendered screen stall and output silence are independent axes: termination requires both.
 * A negative configured minimum cannot remove the requirement that stall confirmation exists.
 */
export function decideScreenStallSilenceTermination(i: ScreenStallSilenceInput): ScreenStallSilenceVerdict {
  let evidenceSatisfied = false;
  let evidenceWhy: string;
  if (!Number.isFinite(i.stallRung) || !Number.isFinite(i.minRung)) {
    evidenceWhy = 'stall-rung-or-min-not-finite';
  } else if (i.stallRung < 0) {
    evidenceWhy = 'no-stall-confirmation';
  } else {
    const min = Math.max(0, i.minRung);
    if (i.stallRung < min) {
      evidenceWhy = `stall-rung-${i.stallRung}-below-min-${min}`;
    } else if (!Number.isFinite(i.silentFor) && i.silentFor !== Number.POSITIVE_INFINITY) {
      evidenceWhy = 'activity-silence-not-finite';
    } else if (!Number.isFinite(i.activityGrace) || i.activityGrace < 0) {
      evidenceWhy = 'activity-grace-invalid';
    } else if (i.silentFor < i.activityGrace) {
      evidenceWhy = `output-recent-silent-for-${i.silentFor}-below-grace-${i.activityGrace}`;
    } else if (!i.childAlive) {
      evidenceWhy = 'child-not-alive';
    } else if (i.completionDeclared) {
      evidenceWhy = 'completion-already-declared';
    } else {
      evidenceSatisfied = true;
      evidenceWhy = `screen-stall-rung-${i.stallRung}-and-output-silence-${i.silentFor}`;
    }
  }
  if (i.enabled && evidenceSatisfied) {
    return { terminate: true, why: evidenceWhy, evidenceSatisfied, evidenceWhy };
  }
  return { terminate: false, why: i.enabled ? evidenceWhy : 'disabled', evidenceSatisfied, evidenceWhy };
}

/** Named caller-declared routes through which a child can receive a supervisor input. */
export type AutoAssistReachability = Readonly<Record<string, boolean>>;

interface AutoAssistCommonInput {
  readonly action: BrainSuggestionAction;
  readonly stallRung: number;
  readonly minRung: number;
  readonly childAlive: boolean;
  readonly ownership: 'owned' | 'lost' | 'unknown';
  readonly enabled: boolean;
}

interface AutoAssistDirectReachabilityInput {
  /** The child can consume input immediately through its PTY stdin.
   * 자식이 PTY stdin을 통해 즉시 입력을 소비할 수 있는지 나타낸다.
   */
  readonly canReceiveInput: boolean;
  /** The current round has a wired arbiter callback that can enqueue this input for the next prompt.
   * 현재 라운드가 다음 프롬프트를 위해 입력을 큐에 넣을 감독 콜백을 연결했는지 나타낸다.
   */
  readonly canQueueSupervisorInput: boolean;
  /** Additional currently wired delivery routes, keyed by their observation names. */
  readonly reachability?: AutoAssistReachability;
}

interface AutoAssistNamedReachabilityInput {
  /** Every currently wired delivery route, keyed by its observation name. */
  readonly reachability: AutoAssistReachability;
  /** The child can consume input immediately through its PTY stdin.
   * 자식이 PTY stdin을 통해 즉시 입력을 소비할 수 있는지 나타낸다.
   */
  readonly canReceiveInput?: boolean;
  /** The current round can enqueue this input for the next prompt.
   * 현재 라운드가 다음 프롬프트를 위해 입력을 큐에 넣을 수 있는지 나타낸다.
   */
  readonly canQueueSupervisorInput?: boolean;
}

/** Inputs for the assist decision. Reachability is caller-declared, never inferred from PTY writability. */
export type AutoAssistInput = AutoAssistCommonInput &
  (AutoAssistDirectReachabilityInput | AutoAssistNamedReachabilityInput);

export type AutoAssistVerdict =
  | { assist: true; why: string; shadowed: false; wouldAssist: true; evidenceWhy: string }
  | { assist: false; why: string; shadowed: boolean; wouldAssist: boolean; evidenceWhy: string };

/**
 * Whether an input suggestion is eligible for delivery by an existing input-capable caller.
 *
 * Ordered refusals preserve the first unmet precondition in observations: enablement, action,
 * liveness, ownership, then any currently declared delivery route, followed by the same
 * deterministic stall evidence used by automatic termination. This gate authorizes no write;
 * the existing arbiter remains the delivery authority.
 */
export function decideAutoAssist(i: AutoAssistInput): AutoAssistVerdict {
  let wouldAssist = false;
  let evidenceWhy: string;
  // ⛔ 레거시 두 축은 **명시로 주어졌을 때만** 경로가 된다. `?? false` 로 깔면 named 형태의
  //   호출자에게도 「닫힌 경로」 둘이 생겨 거부 사유(`child-cannot-receive-input:<경로들>`)에
  //   ***존재하지 않는 이름 둘이 섞인다*** — 판정은 안 바뀌지만 관측이 거짓을 낸다.
  const reachability: AutoAssistReachability = {
    ...(i.canReceiveInput === undefined ? {} : { 'pty-stdin': i.canReceiveInput }),
    ...(i.canQueueSupervisorInput === undefined ? {} : { 'supervisor-queue': i.canQueueSupervisorInput }),
    ...(i.reachability ?? {}),
  };
  if (i.action !== 'input') evidenceWhy = `action-${i.action}`;
  else if (!i.childAlive) evidenceWhy = 'child-not-alive';
  else if (i.ownership !== 'owned') evidenceWhy = `ownership-${i.ownership}`;
  else if (!Object.values(reachability).some(Boolean)) {
    const closedRoutes = Object.entries(reachability)
      .filter(([, reachable]) => !reachable)
      .map(([route]) => route)
      .join(',');
    evidenceWhy = closedRoutes ? `child-cannot-receive-input:${closedRoutes}` : 'child-cannot-receive-input';
  } else if (!Number.isFinite(i.stallRung) || !Number.isFinite(i.minRung)) {
    evidenceWhy = 'stall-rung-or-min-not-finite';
  } else if (i.stallRung < 0) evidenceWhy = 'no-stall-confirmation';
  else {
    const min = Math.max(0, i.minRung);
    if (i.stallRung < min) evidenceWhy = `stall-rung-${i.stallRung}-below-min-${min}`;
    else {
      wouldAssist = true;
      evidenceWhy = `input-with-stall-rung-${i.stallRung}`;
    }
  }
  if (i.enabled && wouldAssist) {
    return { assist: true, why: evidenceWhy, shadowed: false, wouldAssist, evidenceWhy };
  }
  const why = evidenceWhy.startsWith('child-cannot-receive-input:')
    ? 'child-cannot-receive-input'
    : evidenceWhy;
  return { assist: false, why: i.enabled ? why : 'disabled', shadowed: !i.enabled, wouldAssist, evidenceWhy };
}

export type BoundaryApprovalRequestKind = 'rejected' | 'command-start' | 'command-start-cap-reached';

export interface BoundaryApprovalInput {
  /** Closed provenance for every boundary decision record. */
  readonly requestKind: BoundaryApprovalRequestKind;
  readonly boundary: string;
  readonly cwd: string;
  readonly targetKnown?: boolean;
  /** 원장 레코드의 쓰기 대상(정규화된 절대 경로). 거부 레코드에서 `targetKnown:true` 면 그 대상이 경계 밖이라 막힌 것이다. */
  readonly target?: string;
  readonly commandFirstToken?: string;
  /** Exact shell syntax token from the write-target parser, or `none` when no shell token decided the rejection. */
  readonly decidingToken?: string;
  /** Producer observation only: an allowlisted interpreter received inline code; source is never transported or analyzed. */
  readonly inlineCode?: boolean;
  readonly commandAction?: string;
  /** Raw command text for metacharacter observation only. Absence is unknown, not empty. */
  readonly command?: string;
  /**
   * Anonymized metacharacter observation transported from the command chokepoint.
   * Presence (including empty string) wins over recomputing from `command`.
   * Absence keeps the unknown sentinel.
   * Only the empty string or unique characters from the canonical metacharacter
   * set are accepted; any other string is treated as absent (unknown).
   */
  readonly observedRawShellMetacharacters?: string;
}

export interface BoundaryApprovalRequest extends BoundaryApprovalInput {
  readonly requestId: string;
}

/** Validates and narrows an append-only mailbox record before the pure approval decision sees it. */
export function parseBoundaryApprovalRequest(value: unknown): BoundaryApprovalRequest | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const prototype = Object.getPrototypeOf(value) as object | null;
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.requestId !== 'string' || !record.requestId) return undefined;
  if (typeof record.boundary !== 'string' || !record.boundary) return undefined;
  if (typeof record.cwd !== 'string' || !record.cwd) return undefined;
  if (typeof record.targetKnown !== 'boolean') return undefined;
  const requestKind = record.requestType === undefined
    ? 'rejected'
    : record.requestType === 'command-start' || record.requestType === 'command-start-cap-reached'
      ? record.requestType
      : undefined;
  if (!requestKind) return undefined;
  if (record.target !== undefined && typeof record.target !== 'string') return undefined;
  if (record.commandFirstToken !== undefined && typeof record.commandFirstToken !== 'string') return undefined;
  if (record.decidingToken !== undefined && typeof record.decidingToken !== 'string') return undefined;
  if (record.inlineCode !== undefined && typeof record.inlineCode !== 'boolean') return undefined;
  if (record.commandAction !== undefined && typeof record.commandAction !== 'string') return undefined;
  if (record.observedRawShellMetacharacters !== undefined && typeof record.observedRawShellMetacharacters !== 'string') return undefined;
  const observedRawShellMetacharacters = typeof record.observedRawShellMetacharacters === 'string'
    && isCanonicalRawShellMetacharacterObservation(record.observedRawShellMetacharacters)
    ? record.observedRawShellMetacharacters
    : undefined;
  return {
    requestId: record.requestId,
    requestKind,
    boundary: record.boundary,
    cwd: record.cwd,
    targetKnown: record.targetKnown,
    ...(typeof record.target === 'string' && record.target ? { target: record.target } : {}),
    ...(record.commandFirstToken === undefined ? {} : { commandFirstToken: record.commandFirstToken }),
    ...(record.decidingToken === undefined ? {} : { decidingToken: record.decidingToken }),
    ...(record.inlineCode === undefined ? {} : { inlineCode: record.inlineCode }),
    ...(typeof record.commandAction === 'string' && record.commandAction ? { commandAction: record.commandAction } : {}),
    ...(typeof record.command === 'string' ? { command: record.command } : {}),
    ...(observedRawShellMetacharacters === undefined ? {} : { observedRawShellMetacharacters }),
  };
}

/** Sentinel when the command string was not obtained. Distinct from an empty observation. */
export const UNKNOWN_OBSERVED_RAW_SHELL_METACHARACTERS = 'unknown';

/**
 * Characters whose presence in the command string is recorded without parsing.
 * This is the same alphabet the child uses to fail closed on shell syntax, scanned
 * as raw code units — quotes and escapes are not interpreted.
 */
const RAW_SHELL_METACHARACTERS = new Set('|;&`$\\()<>{}~\n');

/**
 * Records which shell metacharacters appeared in the command string.
 * Does not classify syntax and does not decide quoting or escaping.
 */
export function observeRawShellMetacharacters(command: unknown): string {
  if (typeof command !== 'string') return UNKNOWN_OBSERVED_RAW_SHELL_METACHARACTERS;
  const seen = new Set<string>();
  let observed = '';
  for (const char of command) {
    if (!RAW_SHELL_METACHARACTERS.has(char) || seen.has(char)) continue;
    seen.add(char);
    observed += char;
  }
  return observed;
}

/** Empty string or unique canonical metacharacters in first-seen order — not a raw command. */
function isCanonicalRawShellMetacharacterObservation(value: string): boolean {
  return observeRawShellMetacharacters(value) === value;
}

type BoundaryApprovalVerdict = {
  requestKind: BoundaryApprovalRequestKind;
  approve: false;
  why: string;
  shadowed: true;
  wouldApprove: boolean;
  evidenceWhy: string;
  commandFirstToken?: string;
  decidingToken?: string;
  inlineCode?: boolean;
  commandAction?: string;
  /** Observed raw metacharacters, or `unknown` when the command string was unavailable. */
  observedRawShellMetacharacters: string;
};

// 2026-08-22 recount: all 4,000 `harness.boundary`/`request-received` records had 3,998 first tokens
// (99.95%). Distribution: bun 3,098 · git 669 · cd 140 · set 25 · rg 20 · python3 20 · node 8 · rm 4 ·
// grep 3 · cp 2 · ls 2 · env 1 · pwd 1 · other 5. Recount from the record store by filtering that
// category/event, extracting `data.commandFirstToken`, dropping missing values, then grouping and counting
// each token (with the five tokens outside the named categories grouped as `other`); the allowlist itself
// remains a human safety decision, not an automatic result of this distribution.
const BOUNDARY_APPROVAL_COMMAND_ALLOWLIST = ['bun', 'node', 'rg', 'git'] as const;

/** Keeps the same five-field shape as AutoAssistVerdict so the next stage can fold both decisions into one record. */
/** 원장의 `target` 은 실경로(`/private/var/…`)로, `boundary` 는 적힌 그대로(`/var/…`) 온다 — 둘 다 존재하는
 *  가장 가까운 조상의 실경로로 맞춰 비교한다(생산자 `canonicalizeForBoundary` 와 같은 규칙 · 그 모듈이 여기를
 *  import 하므로 되가져오지 않는다). */
function canonicalPath(p: string): string {
  let cur = resolve(p);
  const tail: string[] = [];
  for (let i = 0; i < 128; i++) {
    try {
      const real = realpathSync(cur);
      return tail.length ? join(real, ...tail.reverse()) : real;
    } catch {
      const parent = dirname(cur);
      if (parent === cur) break;
      tail.push(basename(cur));
      cur = parent;
    }
  }
  return resolve(p);
}

function isOutsideBoundary(boundary: string, path: string): boolean {
  const rel = relative(boundary, path);
  return rel === '..' || rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(rel);
}

export function decideBoundaryApproval(i: BoundaryApprovalInput): BoundaryApprovalVerdict {
  let wouldApprove = false;
  let evidenceWhy: string;
  // 🩸 2026-09-24: `command-start` 류는 «거부»가 아니라 명령 시작 통지다 — 여기에 허락 후보를 달면 진행 줄이
  //   거부처럼 찍혀 「막힌 명령의 70~87% 는 부모라면 허락」이라는 거짓 분모가 생겼다(🅣 정정 #16815).
  if (i.requestKind !== 'rejected') {
    evidenceWhy = 'not-a-rejection';
  } else if (isOutsideBoundary(i.boundary, i.cwd)) {
    evidenceWhy = 'outside-boundary';
  } else if (!i.commandFirstToken) evidenceWhy = 'command-token-missing';
  else if (i.inlineCode === true) evidenceWhy = 'inline-code-not-approvable';
  else if (!BOUNDARY_APPROVAL_COMMAND_ALLOWLIST.includes(i.commandFirstToken as typeof BOUNDARY_APPROVAL_COMMAND_ALLOWLIST[number])) {
    evidenceWhy = 'command-token-not-allowlisted';
  } else if (i.targetKnown !== true) {
    evidenceWhy = 'target-unknown';
  } else if (!i.target) {
    evidenceWhy = 'target-missing';
  } else if (isOutsideBoundary(canonicalPath(i.boundary), canonicalPath(i.target))) {
    // 거부인데 대상이 «알려졌다» = 그 대상이 경계 밖이라 막힌 것이다 — cwd 가 경계 안이어도 허락하면 밖에 쓴다.
    evidenceWhy = 'target-outside-boundary';
  } else {
    wouldApprove = true;
    evidenceWhy = `boundary-shell-syntax-with-${i.commandFirstToken}`;
  }
  return {
    requestKind: i.requestKind,
    approve: false,
    why: evidenceWhy,
    shadowed: true,
    wouldApprove,
    evidenceWhy,
    ...(i.commandFirstToken ? { commandFirstToken: i.commandFirstToken } : {}),
    ...(i.decidingToken === undefined ? {} : { decidingToken: i.decidingToken }),
    ...(i.inlineCode === undefined ? {} : { inlineCode: i.inlineCode }),
    ...(i.commandAction ? { commandAction: i.commandAction } : {}),
    observedRawShellMetacharacters: typeof i.observedRawShellMetacharacters === 'string'
      && isCanonicalRawShellMetacharacterObservation(i.observedRawShellMetacharacters)
      ? i.observedRawShellMetacharacters
      : observeRawShellMetacharacters(i.command),
  };
}

/**
 * 부모의 대기를 끊을까 — **네 조건이 전부 서야** 한다.
 *
 * 순서는 값싼 것부터(관측 사유가 가장 구체적인 것으로 남게):
 *   ① 노브 · ② 행동이 `done` · ③ **정보 추가량**(결정론 상태가 아직 done 아님) ·
 *   ④ **결정론 확증**(실재하는 stall 이 문턱 이상) · ⑤ 자식 생존.
 *
 * ⚠️ **`stallRung >= 0` 을 따로 요구한다** — `minRung` 은 config 라 음수가 들어올 수 있고, 그러면
 *    `stallRung(-1) >= minRung(-1)` 이 참이 되어 **stall 이 없는데도** 멈춘다. 그건 이 모듈이 막으려는
 *    바로 그것(LLM 단독 판단)이다. 확증의 **존재**는 config 로 끌 수 없어야 한다.
 */
export function decideAutoStop(i: AutoStopInput): AutoStopVerdict {
  let wouldStop = false;
  let evidenceWhy: string;
  if (i.action !== 'done') evidenceWhy = `action-${i.action}`;
  else if (!hasNovelCompletionSignal(i)) evidenceWhy = 'deterministic-state-already-done';
  else if (!Number.isFinite(i.stallRung) || !Number.isFinite(i.minRung)) {
    evidenceWhy = 'stall-rung-or-min-not-finite';
  } else if (i.stallRung < 0) {
    evidenceWhy = 'no-stall-confirmation';
  } else {
    const min = Math.max(0, i.minRung);
    if (i.stallRung < min) evidenceWhy = `stall-rung-${i.stallRung}-below-min-${min}`;
    else if (!i.childAlive) evidenceWhy = 'child-not-alive';
    else {
      wouldStop = true;
      evidenceWhy = `done-with-stall-rung-${i.stallRung}`;
    }
  }
  if (i.enabled && wouldStop) {
    return { stop: true, why: evidenceWhy, shadowed: false, wouldStop, evidenceWhy };
  }
  return { stop: false, why: i.enabled ? evidenceWhy : 'disabled', shadowed: !i.enabled, wouldStop, evidenceWhy };
}
