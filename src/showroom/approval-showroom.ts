// W9 Z4 · HITL Approval Showroom — N-lane opinions on a workflow approval gate.
// Cf. ROADMAP-showroom-x-task-fabric §4 Z4.

import type { ShowroomLaneCallable } from '../task-orchestrator/surfaces/showroom-surface.js';
import type { ShowroomLaneRole } from '../task-orchestrator/types.js';

export type ApprovalStance = 'pro' | 'con' | 'neutral';

export interface ApprovalLaneInput {
  role: ShowroomLaneRole;
  model: string;
  /** Lane-specific prompt addendum; the base message is prepended automatically. */
  promptAddendum?: string;
}

export interface ApprovalShowroomInput {
  runId: string;
  workflowName: string;
  /** ApprovalNode.approval.message verbatim. */
  approvalMessage: string;
  /** Free-form context the lanes can reason over (prior node outputs, run state). */
  context?: string;
  lanes: ApprovalLaneInput[];
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface ApprovalLaneOpinion {
  role: ShowroomLaneRole;
  model: string;
  stance: ApprovalStance;
  /** 1-line opinion the audit log captures. */
  rationale: string;
  /** Self-reported confidence 0-1 (parsed from lane output; falls back to 0.5). */
  confidence: number;
  modelId?: string;
  /** Raw lane text — kept for audit provenance. */
  raw: string;
}

export interface ApprovalShowroomReport {
  runId: string;
  workflowName: string;
  approvalMessage: string;
  opinions: ApprovalLaneOpinion[];
  /** Aggregated recommendation derived from stance × confidence. */
  recommendation: ApprovalStance;
  /** Weighted vote tally (pro - con). */
  proConDelta: number;
  /** When true, the orchestrator hit the wall-clock budget. */
  timedOut: boolean;
  createdAt: number;
}

export interface ApprovalShowroomDeps {
  laneCallable: ShowroomLaneCallable;
  now?: () => number;
}

const STANCE_TOKENS: Record<ApprovalStance, string[]> = {
  pro: ['pro:', 'approve:', 'yes:', 'support:', 'go:', '찬성:'],
  con: ['con:', 'reject:', 'no:', 'oppose:', 'stop:', '반대:'],
  neutral: ['neutral:', 'abstain:', 'undecided:', '중립:'],
};

function detectStance(text: string): ApprovalStance {
  const lower = text.trim().toLowerCase();
  for (const stance of ['pro', 'con', 'neutral'] as const) {
    for (const tok of STANCE_TOKENS[stance]) {
      if (lower.startsWith(tok)) return stance;
    }
  }
  return 'neutral';
}

function detectConfidence(text: string): number {
  const m = text.match(/confidence\s*[:=]\s*([0-9]*\.?[0-9]+)/i);
  if (!m) return 0.5;
  const n = Number.parseFloat(m[1]!);
  if (!Number.isFinite(n)) return 0.5;
  if (n > 1) return Math.min(n / 100, 1);
  if (n < 0) return 0;
  return n;
}

function firstNonEmptyLine(text: string): string {
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (t.length > 0) return t.slice(0, 256);
  }
  return text.slice(0, 256);
}

function buildLanePrompt(input: ApprovalShowroomInput, lane: ApprovalLaneInput): string {
  const ctx = input.context ? `\n\nContext:\n${input.context}` : '';
  const addendum = lane.promptAddendum ? `\n\n${lane.promptAddendum}` : '';
  return [
    'You are reviewing a workflow approval gate.',
    'Output exactly: `<stance>: <one-line opinion>` then `confidence: <0-1>`',
    'Allowed stances: pro · con · neutral',
    '',
    `Workflow: ${input.workflowName}`,
    `Run id : ${input.runId}`,
    `Approval message:\n${input.approvalMessage}${ctx}${addendum}`,
  ].join('\n');
}

function parseOpinion(text: string, lane: ApprovalLaneInput, modelId?: string): ApprovalLaneOpinion {
  const stance = detectStance(text);
  const confidence = detectConfidence(text);
  const rationale = firstNonEmptyLine(text);
  return {
    role: lane.role,
    model: lane.model,
    stance,
    confidence,
    rationale,
    ...(modelId ? { modelId } : {}),
    raw: text,
  };
}

function aggregate(opinions: ApprovalLaneOpinion[]): { recommendation: ApprovalStance; proConDelta: number } {
  let pro = 0;
  let con = 0;
  for (const o of opinions) {
    if (o.stance === 'pro') pro += o.confidence;
    else if (o.stance === 'con') con += o.confidence;
  }
  const delta = pro - con;
  if (Math.abs(delta) < 0.2) return { recommendation: 'neutral', proConDelta: delta };
  return { recommendation: delta > 0 ? 'pro' : 'con', proConDelta: delta };
}

export async function runApprovalShowroom(
  input: ApprovalShowroomInput,
  deps: ApprovalShowroomDeps,
): Promise<ApprovalShowroomReport> {
  const now = deps.now ?? Date.now;
  const timeoutMs = input.timeoutMs ?? 10_000;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);

  const settled = await Promise.allSettled(
    input.lanes.map(async (lane) => {
      const out = await deps.laneCallable({
        role: lane.role,
        model: lane.model,
        prompt: buildLanePrompt(input, lane),
        signal: input.signal ?? controller.signal,
      });
      return parseOpinion(out.text, lane, out.modelId);
    }),
  );
  clearTimeout(timer);

  const opinions: ApprovalLaneOpinion[] = [];
  for (const r of settled) {
    if (r.status === 'fulfilled') opinions.push(r.value);
  }
  const { recommendation, proConDelta } = aggregate(opinions);

  return {
    runId: input.runId,
    workflowName: input.workflowName,
    approvalMessage: input.approvalMessage,
    opinions,
    recommendation,
    proConDelta,
    timedOut,
    createdAt: now(),
  };
}

export interface ApprovalShowroomAuditWriter {
  /** Best-effort audit log persist. Caller decides storage (KGS · file). */
  write(report: ApprovalShowroomReport): Promise<void>;
}
