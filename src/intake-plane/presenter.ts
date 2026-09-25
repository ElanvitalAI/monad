import type { IntakeSession } from './types.js';

export type IntakePresentationPrefixKind =
  | 'slash'
  | 'telegram'
  | 'discord'
  | 'voice'
  | 'http';

export interface IntakeNextAction {
  kind:
    | 'answer'
    | 'decide-apply-now'
    | 'decide-backlog-only'
    | 'review'
    | 'propose'
    | 'apply'
    | 'schedule'
    | 'archive';
  label: string;
  intakeId: string;
  questionId?: string | null;
  command?: string | null;
}

export interface IntakePresentationLinesOptions {
  heading?: string;
  itemLimit?: number;
  questionLimit?: number;
  actionLimit?: number;
  includeActions?: boolean;
  trailingOutput?: string | null;
}

function intakePrefix(prefixKind: IntakePresentationPrefixKind): string | null {
  switch (prefixKind) {
    case 'telegram':
      return '/intake';
    case 'discord':
      return '!intake';
    case 'slash':
      return '/intake';
    case 'voice':
      return 'intake';
    default:
      return null;
  }
}

function withCommand(
  prefixKind: IntakePresentationPrefixKind,
  rest: string,
): string | null {
  const prefix = intakePrefix(prefixKind);
  return prefix ? `${prefix} ${rest}` : null;
}

export function buildIntakeNextActions(
  session: IntakeSession,
  prefixKind: IntakePresentationPrefixKind,
): IntakeNextAction[] {
  const intakeId = session.intakeId;
  const question = session.draft?.openQuestions[0];
  if (question) {
    const onlyOneQuestion = (session.draft?.openQuestions.length ?? 0) === 1;
    return [{
      kind: 'answer',
      label: question.question,
      intakeId,
      questionId: question.id,
      command: onlyOneQuestion
        ? prefixKind === 'voice'
          ? withCommand(prefixKind, `answer ${intakeId} <answer...>`)
          : withCommand(prefixKind, 'answer <answer...>')
        : withCommand(prefixKind, `answer ${question.id} <answer...> ${intakeId}`),
    }];
  }

  if (session.decision?.mode === 'backlog-only') {
    return [{
      kind: 'review',
      label: 'Review backlog intake',
      intakeId,
      command: withCommand(prefixKind, `review ${intakeId}`),
    }];
  }

  if (session.state === 'proposed') {
    return [
      {
        kind: 'apply',
        label: 'Apply proposed tasks',
        intakeId,
        command: withCommand(prefixKind, `apply ${intakeId}`),
      },
      {
        kind: 'archive',
        label: 'Archive intake',
        intakeId,
        command: withCommand(prefixKind, `archive ${intakeId}`),
      },
    ];
  }

  if (session.state === 'review-ready') {
    return [
      {
        kind: 'decide-apply-now',
        label: 'Apply now',
        intakeId,
        command: withCommand(prefixKind, `decide apply-now ${intakeId}`),
      },
      {
        kind: 'decide-backlog-only',
        label: 'Keep in backlog',
        intakeId,
        command: withCommand(prefixKind, `decide backlog-only ${intakeId}`),
      },
      {
        kind: 'propose',
        label: 'Generate task proposal',
        intakeId,
        command: withCommand(prefixKind, `propose ${intakeId}`),
      },
    ];
  }

  if (session.state === 'scheduled') {
    return [{
      kind: 'review',
      label: 'Inspect scheduled intake',
      intakeId,
      command: withCommand(prefixKind, `review ${intakeId}`),
    }];
  }

  if (session.state === 'applied') {
    return [{
      kind: 'archive',
      label: 'Archive applied intake',
      intakeId,
      command: withCommand(prefixKind, `archive ${intakeId}`),
    }];
  }

  return [];
}

export function buildIntakeClarifyPrompt(
  session: IntakeSession,
): string | null {
  return session.draft?.openQuestions[0]?.question ?? null;
}

export function buildIntakePresentationLines(
  session: IntakeSession,
  prefixKind: IntakePresentationPrefixKind,
  options: IntakePresentationLinesOptions = {},
): string[] {
  const itemLimit = options.itemLimit ?? 3;
  const questionLimit = options.questionLimit ?? 2;
  const actionLimit = options.actionLimit ?? 3;
  const lines = [
    options.heading ?? `Intake: ${session.intakeId} [${session.state}]`,
  ];
  const draft = session.draft;
  if (draft) {
    lines.push(`title: ${draft.title}`);
    lines.push(`summary: ${draft.summary}`);
    if (draft.items.length > 0) {
      lines.push('items:');
      for (const item of draft.items.slice(0, itemLimit)) {
        lines.push(`- [${item.kind}] ${item.text}`);
      }
      if (draft.items.length > itemLimit) {
        lines.push(`- … ${draft.items.length - itemLimit} more`);
      }
    }
    if (draft.openQuestions.length > 0) {
      lines.push('questions:');
      for (const question of draft.openQuestions.slice(0, questionLimit)) {
        lines.push(`- ${question.id}: ${question.question}`);
      }
    } else if (session.decision?.mode === 'backlog-only') {
      lines.push('mode: backlog-only');
    }
  }
  const nextActions = options.includeActions === false
    ? []
    : buildIntakeNextActions(session, prefixKind);
  if (options.trailingOutput && (
    session.state === 'applied'
    || session.state === 'scheduled'
    || session.decision?.mode === 'backlog-only'
  )) {
    lines.push(options.trailingOutput);
  }
  if (nextActions.length > 0) {
    lines.push('next:');
    for (const action of nextActions.slice(0, actionLimit)) {
      lines.push(`- ${action.command ?? action.label}`);
    }
  } else if (options.trailingOutput) {
    lines.push(options.trailingOutput);
  }
  return lines;
}
