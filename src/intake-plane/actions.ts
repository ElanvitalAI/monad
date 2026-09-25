import { captureAndDraftIntakeRecord } from './capture.js';
import {
  applyClarifyAnswerToDraft,
  buildDecisionFromIntent,
} from './clarify.js';
import type { IntakeStore } from './store.js';
import {
  applyIntakeProposalToTox,
  createScheduledTaskFromIntakeSession,
  proposeIntakeSessionToTox,
} from './tox-adapter.js';
import type { IntakeSession, RawIntakeRecord } from './types.js';

export interface ReplayIntakeResult {
  sourceId: string;
  session: IntakeSession;
}

export function replayIntakeSession(
  store: IntakeStore,
  sourceId: string,
  now: Date,
  intakeId: string,
): ReplayIntakeResult {
  const source = store.getSession(sourceId);
  if (!source) throw new Error(`Intake session not found: ${sourceId}`);
  const raw: RawIntakeRecord = {
    ...source.raw,
    intakeId,
    receivedAt: now.toISOString(),
    attachments: source.raw.attachments.map((attachment) => ({ ...attachment })),
    ...(source.raw.actor ? { actor: { ...source.raw.actor } } : {}),
    ...(source.raw.channelContext ? { channelContext: { ...source.raw.channelContext } } : {}),
  };
  const session = captureAndDraftIntakeRecord(store, raw, {
    normalizedDetailSource: `intake-replay:${sourceId}`,
  });
  return { sourceId, session };
}

export interface ApplyIntakeResult {
  output: string;
  session: IntakeSession;
  taskIds?: string[];
  taskId?: string;
}

export interface ProposeIntakeResult {
  output: string;
  session: IntakeSession;
  applyToken?: string;
}

export async function proposeIntakeSession(
  store: IntakeStore,
  intakeId: string,
): Promise<ProposeIntakeResult> {
  let session = store.getSession(intakeId);
  if (!session) throw new Error(`Intake session not found: ${intakeId}`);
  if (!session.draft) {
    return { output: `intake ${intakeId} has no draft yet`, session };
  }
  if (session.decision?.mode === 'schedule-followup') {
    return { output: `intake ${intakeId} is marked for scheduled follow-up`, session };
  }
  if (session.decision?.mode === 'backlog-only' || session.decision?.mode === 'discard') {
    return { output: `intake ${intakeId} is marked ${session.decision.mode}`, session };
  }
  const proposed = await proposeIntakeSessionToTox(session);
  if (proposed.applyToken) {
    store.saveProposal(
      intakeId,
      proposed.proposal,
      { applyToken: proposed.applyToken, nextState: 'proposed' },
    );
    session = store.getSession(intakeId)!;
  }
  return {
    output: proposed.output,
    session,
    applyToken: proposed.applyToken,
  };
}

export async function applyIntakeSession(
  store: IntakeStore,
  intakeId: string,
  force = false,
): Promise<ApplyIntakeResult> {
  let session = store.getSession(intakeId);
  if (!session) throw new Error(`Intake session not found: ${intakeId}`);
  if (session.decision?.mode === 'schedule-followup') {
    const scheduleText = String(session.decision.clarifiedAnswers.scheduleText ?? '').trim();
    if (!scheduleText) {
      return { output: `intake ${intakeId} has no scheduleText`, session };
    }
    const created = await createScheduledTaskFromIntakeSession(session, scheduleText);
    if (created.taskId) {
      session = store.setState(intakeId, 'scheduled', { taskId: created.taskId, scheduleText });
    }
    return { output: created.output, session, taskId: created.taskId };
  }
  if (session.decision?.mode === 'backlog-only') {
    return { output: `intake ${intakeId} is marked backlog-only`, session };
  }
  if (session.decision?.mode === 'review-later') {
    return { output: `intake ${intakeId} is marked review-later`, session };
  }
  if (session.decision?.mode === 'discard') {
    return { output: `intake ${intakeId} is marked discard`, session };
  }
  if (!session.applyToken) {
    if (!session.draft) {
      return { output: `intake ${intakeId} has no draft or stored proposal token`, session };
    }
    if (session.draft.openQuestions.length > 0) {
      return { output: `intake ${intakeId} still has open questions`, session };
    }
    const proposed = await proposeIntakeSession(store, intakeId);
    if (!proposed.applyToken) {
      return { output: proposed.output, session: proposed.session };
    }
    session = proposed.session;
  }
  if (!session.applyToken) {
    return { output: `intake ${intakeId} has no stored proposal token`, session };
  }
  const applied = await applyIntakeProposalToTox(session.applyToken, force);
  if (applied.taskIds && applied.taskIds.length > 0) {
    session = store.setState(intakeId, 'applied', { taskIds: applied.taskIds });
  } else {
    session = store.getSession(intakeId)!;
  }
  return {
    output: applied.output,
    session,
    taskIds: applied.taskIds,
  };
}

export interface AnswerIntakeResult {
  output: string;
  session: IntakeSession;
}

export function answerIntakeQuestion(
  store: IntakeStore,
  intakeId: string,
  questionId: string,
  answer: string,
): AnswerIntakeResult {
  const session = store.getSession(intakeId);
  if (!session) throw new Error(`Intake session not found: ${intakeId}`);
  if (!session.draft) throw new Error(`Intake session has no draft: ${intakeId}`);
  const updated = applyClarifyAnswerToDraft(session.draft, questionId, answer);
  if (!updated) throw new Error(`Clarify question not found: ${questionId}`);
  const clarifiedAnswers = {
    ...(session.decision?.clarifiedAnswers ?? {}),
    [questionId]: answer,
  };
  const decision = buildDecisionFromIntent(
    intakeId,
    updated.draft,
    clarifiedAnswers,
    updated.intent,
    session.decision?.mode,
  );
  store.saveDecision(intakeId, decision);
  const next = store.saveDraft(
    intakeId,
    updated.draft,
    { nextState: updated.draft.openQuestions.length > 0 ? 'clarifying' : 'review-ready' },
  );
  return {
    output: `intake ${intakeId} resolved ${questionId} as ${updated.intent}`,
    session: next,
  };
}

export interface DecideIntakeResult {
  output: string;
  session: IntakeSession;
}

export function decideIntakeSession(
  store: IntakeStore,
  intakeId: string,
  mode: 'apply-now' | 'review-later' | 'backlog-only' | 'discard',
): DecideIntakeResult {
  const session = store.getSession(intakeId);
  if (!session) throw new Error(`Intake session not found: ${intakeId}`);
  if (!session.draft) throw new Error(`Intake session has no draft: ${intakeId}`);
  const next = store.saveDecision(intakeId, {
    intakeId,
    mode,
    approvedItemIds: mode === 'backlog-only' || mode === 'discard'
      ? []
      : session.draft.items.map((item) => item.id),
    deferredItemIds: mode === 'backlog-only' || mode === 'review-later'
      ? session.draft.items.map((item) => item.id)
      : [],
    clarifiedAnswers: { ...(session.decision?.clarifiedAnswers ?? {}) },
  });
  return {
    output: `intake ${intakeId} -> ${mode}`,
    session: next,
  };
}

export interface ScheduleIntakeResult {
  output: string;
  session: IntakeSession;
}

export function scheduleIntakeSession(
  store: IntakeStore,
  intakeId: string,
  scheduleText: string,
): ScheduleIntakeResult {
  const session = store.getSession(intakeId);
  if (!session) throw new Error(`Intake session not found: ${intakeId}`);
  const next = store.saveDecision(intakeId, {
    intakeId,
    mode: 'schedule-followup',
    approvedItemIds: session.draft?.items.map((item) => item.id) ?? [],
    deferredItemIds: [],
    clarifiedAnswers: { scheduleText },
  });
  return {
    output: `intake ${intakeId} scheduled as "${scheduleText}"`,
    session: next,
  };
}

export interface ArchiveIntakeResult {
  output: string;
  session: IntakeSession;
}

export function archiveIntakeSession(
  store: IntakeStore,
  intakeId: string,
): ArchiveIntakeResult {
  const session = store.archive(intakeId);
  return {
    output: `intake ${intakeId} archived`,
    session,
  };
}
