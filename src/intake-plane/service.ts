import { captureAndDraftIntakeRecord } from './capture.js';
import { runIntakeCheck, type IntakeCheckFact, type IntakeCheckReport } from './check.js';
import type { IntakeStore } from './store.js';
import {
  applyIntakeProposalToTox,
  createScheduledTaskFromIntakeSession,
  proposeIntakeSessionToTox,
} from './tox-adapter.js';
import type {
  IntakeDecision,
  IntakeSession,
  IntakeState,
  RawIntakeRecord,
} from './types.js';

export interface IntakeIngestPolicy {
  mode?: 'review' | 'apply-now' | 'backlog-only' | 'schedule-followup' | 'check';
  scheduleText?: string;
}

export interface IntakeIngestResult {
  intakeId: string;
  state: IntakeState;
  session: IntakeSession;
  output: string;
  taskIds?: string[];
  taskId?: string;
  /** check 모드만. 태스크를 등록하지 않고 대조 결과만 싣는다. */
  check?: IntakeCheckReport;
}

function buildDecision(
  session: IntakeSession,
  mode: IntakeDecision['mode'],
  clarifiedAnswers: Record<string, string | boolean> = {},
): IntakeDecision {
  const draft = session.draft;
  const allItemIds = draft?.items.map((item) => item.id) ?? [];
  return {
    intakeId: session.intakeId,
    mode,
    approvedItemIds: mode === 'apply-now' || mode === 'schedule-followup' ? allItemIds : [],
    deferredItemIds: mode === 'backlog-only' || mode === 'review-later' ? allItemIds : [],
    clarifiedAnswers,
  };
}

export async function ingestIntakeRecord(
  store: IntakeStore,
  raw: RawIntakeRecord,
  policy: IntakeIngestPolicy = {},
  checkFacts?: readonly IntakeCheckFact[],
): Promise<IntakeIngestResult> {
  if (policy.mode === 'check') {
    const facts = checkFacts && checkFacts.length > 0
      ? checkFacts
      : [{ text: raw.rawText, quote: raw.rawText }];
    const { defaultIntakeCheckDeps } = await import('./check.js');
    const report = runIntakeCheck(facts, defaultIntakeCheckDeps(process.cwd()));
    // 대조는 태스크를 등록하지 않는다. 세션 객체는 응답 모양용이며 store 에 안 남긴다.
    const now = raw.receivedAt;
    const session: IntakeSession = {
      intakeId: raw.intakeId,
      raw,
      state: 'captured',
      createdAt: now,
      updatedAt: now,
    };
    return {
      intakeId: raw.intakeId,
      state: session.state,
      session,
      output: report.items.map((item) => item.line).join('\n'),
      check: report,
    };
  }

  let session = captureAndDraftIntakeRecord(store, raw, {
    normalizedDetailSource: `intake:${raw.source}`,
  });

  if (policy.mode === 'backlog-only') {
    session = store.saveDecision(
      raw.intakeId,
      buildDecision(session, 'backlog-only'),
    );
    return {
      intakeId: raw.intakeId,
      state: session.state,
      session,
      output: `intake ${raw.intakeId} captured as backlog-only`,
    };
  }

  if (policy.mode === 'schedule-followup') {
    const scheduleText = String(policy.scheduleText ?? '').trim();
    if (!scheduleText) {
      return {
        intakeId: raw.intakeId,
        state: session.state,
        session,
        output: `intake ${raw.intakeId} requires scheduleText for schedule-followup`,
      };
    }
    store.saveDecision(
      raw.intakeId,
      buildDecision(session, 'schedule-followup', { scheduleText }),
    );
    session = store.getSession(raw.intakeId)!;
    const created = await createScheduledTaskFromIntakeSession(session, scheduleText);
    if (created.taskId) {
      session = store.setState(raw.intakeId, 'scheduled', {
        taskId: created.taskId,
        scheduleText,
      });
    }
    return {
      intakeId: raw.intakeId,
      state: session.state,
      session,
      output: created.output,
      taskId: created.taskId,
    };
  }

  if (policy.mode === 'apply-now') {
    store.saveDecision(raw.intakeId, buildDecision(session, 'apply-now'));
    session = store.getSession(raw.intakeId)!;
    if (!session.draft || session.draft.openQuestions.length > 0) {
      return {
        intakeId: raw.intakeId,
        state: session.state,
        session,
        output: `intake ${raw.intakeId} needs clarification before apply-now`,
      };
    }
    const proposed = await proposeIntakeSessionToTox(session);
    if (!proposed.applyToken) {
      return {
        intakeId: raw.intakeId,
        state: session.state,
        session,
        output: proposed.output,
      };
    }
    store.saveProposal(raw.intakeId, proposed.proposal, {
      applyToken: proposed.applyToken,
      nextState: 'proposed',
    });
    const applied = await applyIntakeProposalToTox(proposed.applyToken);
    if (applied.taskIds && applied.taskIds.length > 0) {
      session = store.setState(raw.intakeId, 'applied', { taskIds: applied.taskIds });
    } else {
      session = store.getSession(raw.intakeId)!;
    }
    return {
      intakeId: raw.intakeId,
      state: session.state,
      session,
      output: applied.output,
      taskIds: applied.taskIds,
    };
  }

  return {
    intakeId: raw.intakeId,
    state: session.state,
    session,
    output: session.state === 'clarifying'
      ? `intake ${raw.intakeId} captured and waiting for clarification`
      : `intake ${raw.intakeId} captured and ready for review`,
  };
}
