// ── PFC-S2 generalization: Conductor types ──
//
// Conductor = Layer B 내부 "WHAT to do" decision layer. Intake (자연어
// business 요구사항) 를 받아 5 goalKind 중 하나로 분류 + routing.
//
// See 내부 문서 `PFC-CONDUCTOR-FIRST-DOGFOOD` for kind definitions and
// keyword table · 내부 문서 `PLAN-session-pfc-s2-autonomous-loop` for the
// full design rationale.

export const GOAL_KINDS = [
  'research',
  'coding',
  'analysis',
  'monitoring',
  'refactor',
] as const;

export type GoalKind = (typeof GOAL_KINDS)[number];

export interface Intake {
  raw: string;
  channel?: 'chat' | 'telegram' | 'scheduler' | 'webhook' | 'cli';
  requestedAt?: number;
  requester?: string;
  attachments?: readonly string[];
  priorityHint?: 'urgent' | 'normal' | 'whenever';
}

export interface ClassifyInput {
  intake: Intake;
  force_kind?: GoalKind;           // operator override
  llmFallback?: (intake: Intake) => Promise<LLMClassifyResult | null>;
  // Test seam — deterministic hits map; real impl uses HEURISTIC_TABLE.
  heuristicTable?: HeuristicTable;
}

export interface LLMClassifyResult {
  kind: GoalKind | 'ambiguous';
  confidence: number;
  reason?: string;
}

export interface ClassifyResult {
  kind: GoalKind;
  confidence: number;
  classifier: 'heuristic' | 'llm' | 'user-override' | 'fallback';
  keywordHits: Record<GoalKind, number>;
  scores: Record<GoalKind, number>;
  reason?: string;
  notices?: string[];
}

// ── Heuristic table shape ──────────────────────────────────────────────

export interface KeywordEntry {
  /** Regex source — compiled with case-insensitive flag. */
  pattern: string;
  weight: 3 | 1;   // 3 = 강한 키워드, 1 = 약한 키워드
}

export type HeuristicTable = Record<GoalKind, readonly KeywordEntry[]>;

// ── Routing ────────────────────────────────────────────────────────────

export type AdapterStatus = 'routed' | 'stub' | 'unavailable' | 'proposed';

/**
 * Ready-to-run tool call proposal — adapter returns this so the caller
 * (EnterAutoMode · ClassifyGoal · CLI) can invoke the side-effecting
 * tool. Adapter itself stays pure.
 */
export interface ProposedToolCall {
  tool: string;                      // 'TaskDecompose' · 'scheduler_create' · 'skill' · ...
  input: Record<string, unknown>;
  rationale?: string;
}

export interface AdapterResult {
  kind: GoalKind;
  status: AdapterStatus;
  adapter: string;             // e.g. 'research' · 'coding-stub' · 'coding-task-decompose'
  proposed?: ProposedToolCall; // required when status === 'proposed'
  pendingTracks?: readonly ('TOX-2' | 'AXON-P1' | 'Scheduler-A' | 'workflow-runtime' | 'Skill')[];
  hint?: string;
  extra?: Record<string, unknown>;
}

/**
 * Proposers inject "how to translate a RoutingContext into a concrete
 * tool call". Caller owns invocation — adapter only *proposes*.
 * Returning null signals "no proposal possible" → adapter falls back
 * to stub behavior.
 */
export interface AdapterProposers {
  proposeTaskDecompose?: (
    ctx: RoutingContext,
  ) => Promise<ProposedToolCall | null>;
  proposeScheduledJob?: (
    ctx: RoutingContext,
  ) => Promise<ProposedToolCall | null>;
  proposeSkillInvocation?: (
    ctx: RoutingContext,
  ) => Promise<ProposedToolCall | null>;
}

export interface RoutingContext {
  goalSlug: string;
  intake: Intake;
  classify: ClassifyResult;
  proposers?: AdapterProposers;
}

export type Adapter = (ctx: RoutingContext) => Promise<AdapterResult>;

export interface RouterDeps {
  adapters?: Partial<Record<GoalKind, Adapter>>;
  proposers?: AdapterProposers;
}
