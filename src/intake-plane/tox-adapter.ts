import { dispatchTaskCreate } from '../task-orchestrator/runtimes/create.js';
import { dispatchTaskDecompose, dispatchTaskDecomposeApply } from '../task-orchestrator/runtimes/decompose.js';
import type { IntakeSession, ToxProposalDraft } from './types.js';

export function buildToxProposalDraftFromSession(session: IntakeSession): ToxProposalDraft {
  const draft = session.draft;
  const items = draft?.items ?? [];
  const objectiveLines = [
    draft?.title ? `Title: ${draft.title}` : null,
    draft?.summary ? `Summary: ${draft.summary}` : null,
    items.length > 0
      ? `Items:\n${items.map((item, index) => `${index + 1}. [${item.kind}] ${item.text}`).join('\n')}`
      : `Raw note:\n${session.raw.rawText}`,
  ].filter((line): line is string => !!line);
  return {
    intakeId: session.intakeId,
    objective: objectiveLines.join('\n\n'),
    scheduleText: session.decision?.mode === 'schedule-followup' ? 'follow up later' : undefined,
    contextNotes: [
      `source=${session.raw.source}`,
      ...(draft?.openQuestions.length ? [`openQuestions=${draft.openQuestions.length}`] : []),
    ],
  };
}

export async function proposeIntakeSessionToTox(
  session: IntakeSession,
): Promise<{
  output: string;
  applyToken?: string;
  requiresApproval?: boolean;
  proposal: ToxProposalDraft;
}> {
  const proposal = buildToxProposalDraftFromSession(session);
  const result = await dispatchTaskDecompose({
    objective: proposal.objective,
  });
  return {
    output: result.output,
    applyToken: result.applyToken,
    requiresApproval: result.requiresApproval,
    proposal,
  };
}

export async function applyIntakeProposalToTox(
  applyToken: string,
  force = false,
): Promise<{
  output: string;
  taskIds?: string[];
}> {
  const result = await dispatchTaskDecomposeApply({ applyToken, force });
  return {
    output: result.output,
    taskIds: result.taskIds,
  };
}

export async function createScheduledTaskFromIntakeSession(
  session: IntakeSession,
  scheduleText: string,
): Promise<{
  output: string;
  taskId?: string;
}> {
  const draft = session.draft;
  const prompt = draft
    ? [
        `Title: ${draft.title}`,
        `Summary: ${draft.summary}`,
        'Items:',
        ...draft.items.map((item, index) => `${index + 1}. [${item.kind}] ${item.text}`),
      ].join('\n')
    : session.raw.rawText;
  const title = draft?.title || session.raw.rawText.split('\n')[0]?.trim() || 'scheduled intake';
  const result = await dispatchTaskCreate({
    title: title.slice(0, 80),
    description: draft?.summary ?? '',
    scheduleText,
    surface: {
      kind: 'llm-direct',
      prompt,
    },
  });
  return {
    output: result.output,
    taskId: result.taskId,
  };
}
