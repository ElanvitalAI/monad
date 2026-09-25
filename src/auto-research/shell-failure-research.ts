// ── T1 (Phase 1) — Shell-failure research ──
//
// Given a settled `ShellResult` from a posture-death event, build a
// research summary the PFC reverse-feedback loop can present to the
// user. Per HANDOFF §4.2 step 3, this layer is the "auto-research
// candidate" generator: heuristic pattern match → optional LLM pass →
// optional git history lookup.
//
// This file lands the heuristic + injection seams. The LLM pass and
// git lookup arrive as injected proposers (`ShellResearchProposers`)
// so the heuristic core stays sync + dep-free + cheap to test.

import type { ShellResult, ShellHandle } from '../shell-runner/types.js';

// ── Failure classification ─────────────────────────────────────────

/**
 * Why a posture-death is interesting (or not). Mirrors the false-
 * positive guard from HANDOFF §4.4: `grep` exiting 1 with no matches
 * is the canonical example we *don't* want to research.
 */
export type ShellFailureClass =
  /** Non-zero exit AND stderr / aggregated stream contains an
   *  identifiable error pattern (Error/Exception/Traceback/FAIL/
   *  AssertionError/SyntaxError/permission denied). */
  | 'error-with-trace'
  /** Non-zero exit but no recognized error pattern — caller owns the
   *  decision whether to investigate (e.g. `grep` no-match). */
  | 'silent-nonzero'
  /** SIGTERM / SIGKILL boundary, command was running normally. */
  | 'killed'
  /** wall-clock timeout. Boundary policy fired SIGTERM. */
  | 'timeout'
  /** Exit 0 — not a failure. Watcher fired because the shell ended;
   *  PFC should not bother the user. */
  | 'success'
  /** Result unavailable (handle gone before result settled) — caller
   *  should fall back to "I noticed shell <id> ended" without details. */
  | 'unknown';

export interface ShellFailureClassification {
  readonly clazz: ShellFailureClass;
  readonly exitCode: number | undefined;
  /** First matched error pattern (when clazz === 'error-with-trace').
   *  Used as the headline candidate. */
  readonly errorMarker: string | null;
  /** Last ~20 lines of the aggregated stream, trimmed. Useful for
   *  the chat-line preview without paging through ShellResult. */
  readonly tail: string;
}

const ERROR_PATTERNS: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: 'AssertionError',  re: /AssertionError(?::|\s)/i },
  { name: 'Traceback',       re: /Traceback \(most recent call last\)/ },
  { name: 'Exception',       re: /\b\w*Exception\b(?::|\s)/i },
  { name: 'Error',           re: /\b\w*Error\b(?::|\s)/i },
  { name: 'panic',           re: /\bpanic:|panicked at/i },
  { name: 'FAILED',          re: /\bFAIL(?:ED)?\b/ },
  { name: 'permission',      re: /permission denied|EACCES/i },
  { name: 'not found',       re: /command not found|No such file or directory/i },
  { name: 'syntax',          re: /SyntaxError|unexpected token/i },
  { name: 'segfault',        re: /Segmentation fault|SIGSEGV/i },
];

const TAIL_LINES = 20;

function tailOfResult(result: ShellResult): string {
  const merged = result.aggregated?.text
    ?? `${result.stdout?.text ?? ''}${result.stderr?.text ?? ''}`;
  if (!merged) return '';
  const lines = merged.split(/\r?\n/);
  // Strip pure-blank trailing lines so the tail has signal.
  while (lines.length > 0 && lines[lines.length - 1]!.trim() === '') {
    lines.pop();
  }
  return lines.slice(-TAIL_LINES).join('\n');
}

export function classifyShellFailure(
  result: ShellResult | null,
): ShellFailureClassification {
  if (!result) {
    return { clazz: 'unknown', exitCode: undefined, errorMarker: null, tail: '' };
  }
  const tail = tailOfResult(result);
  const exitCode = result.exitCode;
  if (result.outcome === 'timeout' || result.timedOut) {
    return { clazz: 'timeout', exitCode, errorMarker: null, tail };
  }
  if (result.interrupted || result.outcome === 'aborted') {
    return { clazz: 'killed', exitCode, errorMarker: null, tail };
  }
  if (exitCode === 0 || exitCode === undefined) {
    return { clazz: 'success', exitCode, errorMarker: null, tail };
  }
  for (const { name, re } of ERROR_PATTERNS) {
    if (re.test(tail)) {
      return { clazz: 'error-with-trace', exitCode, errorMarker: name, tail };
    }
  }
  return { clazz: 'silent-nonzero', exitCode, errorMarker: null, tail };
}

// ── Research candidate generation ─────────────────────────────────

export interface ShellFailureResearchCandidate {
  /** Short user-facing label. */
  readonly label: string;
  /** Optional suggested fix snippet — when present, the orchestrator
   *  may render an `[Apply]` action. */
  readonly suggestion?: string;
  /** Provenance — which proposer produced the candidate. Useful for
   *  the chat-line ("via git log" vs "heuristic"). */
  readonly source: 'heuristic' | 'llm' | 'git-log' | 'codebase-grep';
  /** Free-form reasoning shown under "[Show diff]". */
  readonly rationale?: string;
}

export interface ShellFailureResearchResult {
  readonly classification: ShellFailureClassification;
  readonly candidates: readonly ShellFailureResearchCandidate[];
  /** Total wall-clock the proposers consumed. Reported in the chat
   *  line so users can see the "3 초 내 첫 후보" target from §4.5. */
  readonly elapsedMs: number;
}

export interface ShellFailureResearchInput {
  readonly handle: ShellHandle | null;
  readonly result: ShellResult | null;
  /** What was the user's last visible request — when known, used by
   *  proposers as additional context. */
  readonly recentUserPrompt?: string;
}

/**
 * Async proposer — when injected, runs alongside heuristic candidates
 * and gets a budget. Throwing rejects gracefully; the orchestrator
 * still surfaces the heuristic candidates.
 */
export type ShellFailureProposer = (
  input: ShellFailureResearchInput & { classification: ShellFailureClassification },
) => Promise<readonly ShellFailureResearchCandidate[]>;

export interface ShellFailureResearchDeps {
  /** LLM-backed candidate generator (optional). */
  llmProposer?: ShellFailureProposer;
  /** `git log -S<token>` grep over recent history (optional). */
  gitLogProposer?: ShellFailureProposer;
  /** Codebase grep for the same error marker (optional). */
  codebaseProposer?: ShellFailureProposer;
  /** Per-proposer budget in ms. Default 3000. The orchestrator's
   *  "first candidate < 3s" target (§4.5) translates to this. */
  budgetMs?: number;
  /** Test seam — defaults to performance.now() when available. */
  now?: () => number;
}

const DEFAULT_BUDGET_MS = 3000;

function nowFn(deps: ShellFailureResearchDeps): () => number {
  if (deps.now) return deps.now;
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return () => performance.now();
  }
  return () => Date.now();
}

function withBudget<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(null);
    }, ms);
    p.then((value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    }, () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(null);
    });
  });
}

function buildHeuristicCandidate(
  classification: ShellFailureClassification,
): ShellFailureResearchCandidate | null {
  switch (classification.clazz) {
    case 'error-with-trace':
      return {
        label: `${classification.errorMarker ?? 'Error'} 발견 — 마지막 ${TAIL_LINES} 줄 확인`,
        source: 'heuristic',
        rationale: classification.tail,
      };
    case 'timeout':
      return {
        label: 'Timeout — 명령이 boundary 안에 끝나지 않음',
        source: 'heuristic',
        rationale: classification.tail || 'no output before SIGTERM.',
      };
    case 'killed':
      return {
        label: 'Killed — interrupt / abort 신호 감지',
        source: 'heuristic',
        rationale: classification.tail,
      };
    case 'silent-nonzero':
      return {
        label: `Exit ${classification.exitCode} (조용한 실패)`,
        source: 'heuristic',
        rationale: classification.tail || 'stream produced no recognizable error.',
      };
    case 'success':
    case 'unknown':
      return null;
  }
}

export async function researchShellFailure(
  input: ShellFailureResearchInput,
  deps: ShellFailureResearchDeps = {},
): Promise<ShellFailureResearchResult> {
  const startedAt = nowFn(deps)();
  const classification = classifyShellFailure(input.result);

  const heuristic = buildHeuristicCandidate(classification);
  const candidates: ShellFailureResearchCandidate[] = heuristic ? [heuristic] : [];

  if (classification.clazz === 'success' || classification.clazz === 'unknown') {
    return {
      classification,
      candidates,
      elapsedMs: nowFn(deps)() - startedAt,
    };
  }

  const budget = deps.budgetMs ?? DEFAULT_BUDGET_MS;
  const proposers = [deps.llmProposer, deps.gitLogProposer, deps.codebaseProposer]
    .filter((p): p is ShellFailureProposer => Boolean(p));

  if (proposers.length > 0) {
    const proposed = await Promise.all(
      proposers.map((p) => withBudget(p({ ...input, classification }), budget)),
    );
    for (const list of proposed) {
      if (!list) continue;
      for (const c of list) candidates.push(c);
    }
  }

  return {
    classification,
    candidates,
    elapsedMs: nowFn(deps)() - startedAt,
  };
}
