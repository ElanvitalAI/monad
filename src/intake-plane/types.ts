import type { NormalizedAttachment } from '../acp/content-blocks.js';
import type { InputSourceKind, InputSourceRef } from '../input/input-source-kind.js';

export type IntakeSource =
  | 'tui-scratch'
  | 'web-scratch'
  | 'mobile-scratch'
  | 'voice'
  | 'telegram'
  | 'discord'
  | 'api'
  | 'document'
  | 'url';

export const INTAKE_SOURCES: readonly IntakeSource[] = [
  'tui-scratch',
  'web-scratch',
  'mobile-scratch',
  'voice',
  'telegram',
  'discord',
  'api',
  'document',
  'url',
] as const;

export function isIntakeSource(value: unknown): value is IntakeSource {
  return typeof value === 'string' && (INTAKE_SOURCES as readonly string[]).includes(value);
}

export type IntakeState =
  | 'captured'
  | 'normalized'
  | 'drafted'
  | 'clarifying'
  | 'review-ready'
  | 'proposed'
  | 'applied'
  | 'scheduled'
  | 'archived';

export const INTAKE_STATES: readonly IntakeState[] = [
  'captured',
  'normalized',
  'drafted',
  'clarifying',
  'review-ready',
  'proposed',
  'applied',
  'scheduled',
  'archived',
] as const;

export function isIntakeState(value: unknown): value is IntakeState {
  return typeof value === 'string' && (INTAKE_STATES as readonly string[]).includes(value);
}

export interface RawIntakeActor {
  id?: string;
  display?: string;
}

export interface RawIntakeChannelContext {
  chatId?: string;
  guildId?: string;
  threadId?: string;
  deviceId?: string;
}

export interface RawIntakeRecord {
  intakeId: string;
  source: IntakeSource;
  inputSourceKind?: InputSourceKind;
  inputSource?: InputSourceRef;
  rawText: string;
  attachments: NormalizedAttachment[];
  transcriptSource?: 'voice' | 'audio';
  receivedAt: string;
  actor?: RawIntakeActor;
  channelContext?: RawIntakeChannelContext;
}

export type IntakeItemKind =
  | 'research'
  | 'implementation'
  | 'bug'
  | 'capability-absorb'
  | 'comparison'
  | 'polish'
  | 'unknown';

export interface ClarifyQuestion {
  id: string;
  scope: 'bundle' | 'item';
  itemId?: string;
  question: string;
  reason: string;
}

export interface IntakeItemDraft {
  id: string;
  kind: IntakeItemKind;
  text: string;
  links: string[];
  priorityHint?: 'low' | 'medium' | 'high';
  targetSurface?: string;
  needsClarification: boolean;
  proposedAction:
    | 'task-create'
    | 'group-under-parent'
    | 'keep-as-note'
    | 'ask-user';
}

export interface IntakeDraft {
  intakeId: string;
  title: string;
  summary: string;
  items: IntakeItemDraft[];
  openQuestions: ClarifyQuestion[];
  suggestedMode: 'task-creation' | 'backlog-capture' | 'mixed';
  confidence: number;
}

export interface IntakeDecision {
  intakeId: string;
  mode:
    | 'apply-now'
    | 'review-later'
    | 'backlog-only'
    | 'schedule-followup'
    | 'discard';
  approvedItemIds: string[];
  deferredItemIds: string[];
  clarifiedAnswers: Record<string, string | boolean>;
}

export interface ToxProposalDraft {
  intakeId: string;
  objective: string;
  goalSlug?: string;
  preferredSurfaces?: string[];
  budgetUsdRemaining?: number;
  scheduleText?: string;
  contextNotes: string[];
}

export interface IntakeTaskInvariant {
  condition: string;
  verification: string;
  expected: string;
}

export interface IntakeTaskDecisionSignal {
  condition: string;
  observation: string;
  expected: string;
}

/** Research-authored gates. Empty arrays mean a preserved draft that cannot launch. */
export interface IntakeTaskGates {
  invariants: IntakeTaskInvariant[];
  decisionSignals: IntakeTaskDecisionSignal[];
}

const NON_CONCRETE_GATE_TEXT = /^(?:tbd|todo|n\/?a|unknown|placeholder|none|later)$/i;

export function isConcreteIntakeGateText(value: unknown): value is string {
  return typeof value === 'string'
    && value.trim().length > 3
    && !NON_CONCRETE_GATE_TEXT.test(value.trim());
}

export function isConcreteIntakeTaskInvariant(value: unknown): value is IntakeTaskInvariant {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const invariant = value as Record<string, unknown>;
  return isConcreteIntakeGateText(invariant.condition)
    && isConcreteIntakeGateText(invariant.verification)
    && isConcreteIntakeGateText(invariant.expected);
}

export function isConcreteIntakeTaskDecisionSignal(value: unknown): value is IntakeTaskDecisionSignal {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const signal = value as Record<string, unknown>;
  return isConcreteIntakeGateText(signal.condition)
    && isConcreteIntakeGateText(signal.observation)
    && isConcreteIntakeGateText(signal.expected);
}

export interface IntakeSession {
  intakeId: string;
  raw: RawIntakeRecord;
  state: IntakeState;
  draft?: IntakeDraft;
  decision?: IntakeDecision;
  proposal?: ToxProposalDraft;
  applyToken?: string;
  createdAt: string;
  updatedAt: string;
}

export type IntakeEventKind =
  | 'captured'
  | 'state-transition'
  | 'draft-saved'
  | 'decision-saved'
  | 'proposal-saved'
  | 'archived';

export interface IntakeEvent {
  intakeId: string;
  kind: IntakeEventKind;
  createdAt: string;
  state: IntakeState;
  detail?: Record<string, unknown>;
}

const LEGAL_TRANSITIONS: Record<IntakeState, readonly IntakeState[]> = {
  captured: ['normalized', 'drafted', 'clarifying', 'review-ready', 'archived'],
  normalized: ['drafted', 'clarifying', 'review-ready', 'archived'],
  drafted: ['clarifying', 'review-ready', 'proposed', 'scheduled', 'archived'],
  clarifying: ['drafted', 'review-ready', 'proposed', 'scheduled', 'archived'],
  'review-ready': ['drafted', 'clarifying', 'proposed', 'scheduled', 'archived'],
  proposed: ['applied', 'scheduled', 'archived'],
  applied: ['scheduled', 'archived'],
  scheduled: ['applied', 'archived'],
  archived: [],
};

export function canTransitionIntakeState(
  from: IntakeState,
  to: IntakeState,
): boolean {
  if (from === to) return true;
  return LEGAL_TRANSITIONS[from].includes(to);
}

export function cloneNormalizedAttachment(
  attachment: NormalizedAttachment,
): NormalizedAttachment {
  return { ...attachment };
}

export function cloneRawIntakeRecord(record: RawIntakeRecord): RawIntakeRecord {
  return {
    ...record,
    attachments: record.attachments.map(cloneNormalizedAttachment),
    inputSource: record.inputSource ? { ...record.inputSource } : undefined,
    actor: record.actor ? { ...record.actor } : undefined,
    channelContext: record.channelContext ? { ...record.channelContext } : undefined,
  };
}

export function cloneClarifyQuestion(question: ClarifyQuestion): ClarifyQuestion {
  return { ...question };
}

export function cloneIntakeItemDraft(item: IntakeItemDraft): IntakeItemDraft {
  return {
    ...item,
    links: [...item.links],
  };
}

export function cloneIntakeDraft(draft: IntakeDraft): IntakeDraft {
  return {
    ...draft,
    items: draft.items.map(cloneIntakeItemDraft),
    openQuestions: draft.openQuestions.map(cloneClarifyQuestion),
  };
}

export function cloneIntakeDecision(decision: IntakeDecision): IntakeDecision {
  return {
    ...decision,
    approvedItemIds: [...decision.approvedItemIds],
    deferredItemIds: [...decision.deferredItemIds],
    clarifiedAnswers: { ...decision.clarifiedAnswers },
  };
}

export function cloneToxProposalDraft(proposal: ToxProposalDraft): ToxProposalDraft {
  return {
    ...proposal,
    preferredSurfaces: proposal.preferredSurfaces ? [...proposal.preferredSurfaces] : undefined,
    contextNotes: [...proposal.contextNotes],
  };
}

export function cloneIntakeSession(session: IntakeSession): IntakeSession {
  return {
    ...session,
    raw: cloneRawIntakeRecord(session.raw),
    draft: session.draft ? cloneIntakeDraft(session.draft) : undefined,
    decision: session.decision ? cloneIntakeDecision(session.decision) : undefined,
    proposal: session.proposal ? cloneToxProposalDraft(session.proposal) : undefined,
  };
}

export function cloneIntakeEvent(event: IntakeEvent): IntakeEvent {
  return {
    ...event,
    detail: event.detail ? { ...event.detail } : undefined,
  };
}
