import type { InputSourceRef } from '../../input/input-source-kind.js';
import type {
  AnswerClarifyIntent,
  ControlTurnIntent,
} from '../../input/input-intent.js';
import { ingestVoiceTranscript, renderVoiceIntakeSummary } from './voice.js';
import {
  answerIntakeQuestion,
  applyIntakeSession,
  archiveIntakeSession,
  decideIntakeSession,
  proposeIntakeSession,
  scheduleIntakeSession,
} from '../actions.js';
import { buildIntakeClarifyPrompt, buildIntakeNextActions } from '../presenter.js';
import { getIntakeStore } from '../runtime.js';
import type { IntakeStore } from '../store.js';
import type { RawIntakeRecord } from '../types.js';

type SpokenIntakeMode = 'review' | 'apply-now' | 'backlog-only' | 'schedule-followup';

export interface SpokenVoiceIntakeContext {
  transcript: string;
  receivedAt?: string;
  inputSource?: InputSourceRef;
  actor?: RawIntakeRecord['actor'];
  channelContext?: RawIntakeRecord['channelContext'];
  store?: IntakeStore;
  now?: () => Date;
  createIntakeId?: () => string;
}

interface ParsedSpokenIntake {
  action: 'capture';
  mode: SpokenIntakeMode;
  body: string;
  scheduleText?: string;
}

interface ParsedSpokenAnswer {
  action: 'answer';
  intakeId?: string;
  answer: string;
}

interface ParsedSpokenSessionCommand {
  action: 'session-command';
  command: 'apply' | 'propose' | 'archive' | 'backlog' | 'schedule';
  intakeId?: string;
  scheduleText?: string;
}

type SpokenVoiceInputIntent =
  | AnswerClarifyIntent
  | ControlTurnIntent;

function defaultIntakeId(now: Date): string {
  return `intake-${now.toISOString().replace(/[:.]/g, '-').toLowerCase()}`;
}

function normalizeDurationText(raw: string): string | null {
  const compact = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  const short = compact.match(/^(\d+)\s*(s|m|h|d|w)$/i);
  if (short) return `${short[1]}${short[2].toLowerCase()}`;
  const long = compact.match(/^(\d+)\s*(second|seconds|minute|minutes|hour|hours|day|days|week|weeks)$/i);
  if (!long) return null;
  const unit = long[2].toLowerCase();
  const mapped = unit.startsWith('second')
    ? 's'
    : unit.startsWith('minute')
      ? 'm'
      : unit.startsWith('hour')
        ? 'h'
        : unit.startsWith('day')
          ? 'd'
          : 'w';
  return `${long[1]}${mapped}`;
}

function parseSpokenSchedule(rest: string): ParsedSpokenIntake | null {
  const when = rest.match(/^when\s+(.+?)(?:\s+--\s+|:\s+)(.+)$/i);
  if (when) {
    const scheduleText = when[1]!.trim();
    const body = when[2]!.trim();
    if (!scheduleText || !body) return null;
    return { action: 'capture', mode: 'schedule-followup', scheduleText, body };
  }
  const schedule = rest.match(/^schedule\s+(.+?)(?:\s+--\s+|:\s+)(.+)$/i);
  if (schedule) {
    const scheduleText = schedule[1]!.trim();
    const body = schedule[2]!.trim();
    if (!scheduleText || !body) return null;
    return { action: 'capture', mode: 'schedule-followup', scheduleText, body };
  }
  const inDuration = rest.match(/^in\s+(\d+\s*(?:s|m|h|d|w|second|seconds|minute|minutes|hour|hours|day|days|week|weeks))\s+(.+)$/i);
  if (inDuration) {
    const scheduleText = normalizeDurationText(inDuration[1]!);
    const body = inDuration[2]!.trim();
    if (scheduleText && body) {
      return { action: 'capture', mode: 'schedule-followup', scheduleText, body };
    }
  }
  const afterDuration = rest.match(/^after\s+(\d+\s*(?:s|m|h|d|w|second|seconds|minute|minutes|hour|hours|day|days|week|weeks))\s+(.+)$/i);
  if (afterDuration) {
    const scheduleText = normalizeDurationText(afterDuration[1]!);
    const body = afterDuration[2]!.trim();
    if (scheduleText && body) {
      return { action: 'capture', mode: 'schedule-followup', scheduleText, body };
    }
  }
  const remindMe = rest.match(/^remind me in\s+(\d+\s*(?:s|m|h|d|w|second|seconds|minute|minutes|hour|hours|day|days|week|weeks))\s+to\s+(.+)$/i);
  if (remindMe) {
    const scheduleText = normalizeDurationText(remindMe[1]!);
    const body = remindMe[2]!.trim();
    if (scheduleText && body) {
      return { action: 'capture', mode: 'schedule-followup', scheduleText, body };
    }
  }
  return null;
}

function parseSpokenAnswer(rest: string): ParsedSpokenAnswer | { error: string } | null {
  const byIdFirst = rest.match(/^answer\s+(intake-[^\s]+)\s+(.+)$/i);
  if (byIdFirst) {
    const intakeId = byIdFirst[1]!.trim();
    const answer = byIdFirst[2]!.trim();
    if (!answer) return { error: `Say 'intake answer ${intakeId} <answer>'` };
    return { action: 'answer', intakeId, answer };
  }
  const byIdLast = rest.match(/^answer\s+(.+?)\s+for\s+(intake-[^\s]+)$/i);
  if (byIdLast) {
    const answer = byIdLast[1]!.trim();
    const intakeId = byIdLast[2]!.trim();
    if (!answer) return { error: `Say 'intake answer ${intakeId} <answer>'` };
    return { action: 'answer', intakeId, answer };
  }
  if (/^answer\b/i.test(rest)) {
    const answer = rest.replace(/^answer\b/i, '').trim();
    if (!answer) return { error: "Say 'intake answer <answer>' or 'intake answer <intake-id> <answer>'." };
    return { action: 'answer', answer };
  }
  return null;
}

function parseSpokenSessionCommand(rest: string): ParsedSpokenSessionCommand | null {
  if (/\s--\s|:\s/.test(rest)) return null;
  const schedule = rest.match(/^(schedule|when)\s+(.+?)(?:\s+for\s+(intake-[^\s]+))?$/i);
  if (schedule) {
    const scheduleText = schedule[2]!.trim();
    if (!scheduleText) return null;
    return {
      action: 'session-command',
      command: 'schedule',
      scheduleText,
      intakeId: schedule[3]?.trim(),
    };
  }
  const match = rest.match(/^(apply|propose|archive|backlog)(?:\s+(intake-[^\s]+))?$/i);
  if (!match) return null;
  return {
    action: 'session-command',
    command: match[1]!.toLowerCase() as ParsedSpokenSessionCommand['command'],
    intakeId: match[2]?.trim(),
  };
}

function parseSpokenIntakeTranscript(
  transcript: string,
): ParsedSpokenIntake | ParsedSpokenAnswer | ParsedSpokenSessionCommand | { error: string } | null {
  const trimmed = transcript.trim();
  const match = trimmed.match(/^(?:\/|!)?intake\b[\s,:-]*(.*)$/i);
  if (!match) return null;
  const rest = match[1]!.trim();
  if (!rest) {
    return { error: "Say 'intake <note>', 'intake now <note>', or 'intake backlog <note>'." };
  }
  const answer = parseSpokenAnswer(rest);
  if (answer) return answer;
  const sessionCommand = parseSpokenSessionCommand(rest);
  if (sessionCommand) return sessionCommand;
  const scheduled = parseSpokenSchedule(rest);
  if (scheduled) return scheduled;
  const now = rest.match(/^now\s+(.+)$/i);
  if (now) return { action: 'capture', mode: 'apply-now', body: now[1]!.trim() };
  const backlog = rest.match(/^backlog\s+(.+)$/i);
  if (backlog) return { action: 'capture', mode: 'backlog-only', body: backlog[1]!.trim() };
  const later = rest.match(/^later\s+(.+)$/i);
  if (later) return { action: 'capture', mode: 'review', body: later[1]!.trim() };
  return { action: 'capture', mode: 'review', body: rest };
}

function defaultSpokenVoiceSource(source?: InputSourceRef): InputSourceRef {
  return source ?? {
    kind: 'voice',
    channel: 'dashboard',
    surface: 'dashboard-voice-chat',
    mode: 'multi-turn',
    transcriptSource: 'voice',
  };
}

export function resolveSpokenVoiceInputIntent(
  transcript: string,
  source?: InputSourceRef,
): SpokenVoiceInputIntent | null {
  const parsed = parseSpokenIntakeTranscript(transcript);
  if (!parsed || 'error' in parsed) return null;
  const canonicalSource = defaultSpokenVoiceSource(source);
  if (parsed.action === 'answer') {
    return {
      kind: 'answer-clarify',
      source: canonicalSource,
      intakeId: parsed.intakeId,
      answer: parsed.answer,
    };
  }
  if (parsed.action === 'session-command') {
    const command = parsed.command === 'apply'
      ? 'intake-apply'
      : parsed.command === 'propose'
        ? 'intake-propose'
        : parsed.command === 'archive'
          ? 'intake-archive'
          : parsed.command === 'backlog'
            ? 'intake-backlog'
            : 'intake-schedule';
    return {
      kind: 'control-turn',
      source: canonicalSource,
      command,
      intakeId: parsed.intakeId,
      scheduleText: parsed.scheduleText,
    };
  }
  return {
    kind: 'control-turn',
    source: canonicalSource,
    command: 'intake-capture',
    text: parsed.body,
    mode: parsed.mode,
    scheduleText: parsed.scheduleText,
  };
}

function renderVoiceAnswerSummary(
  intakeId: string,
  output: string,
  session: ReturnType<IntakeStore['getSession']>,
): string {
  const draft = session?.draft;
  if (!session || !draft) return `I updated intake ${intakeId}. ${output}`;
  const prompt = buildIntakeClarifyPrompt(session);
  if (draft.openQuestions.length > 0 && prompt) {
    const followup = buildIntakeNextActions(session, 'voice')[0]?.command;
    return [
      `I updated intake ${intakeId}.`,
      output,
      `I still need one clarification: ${prompt}`,
      ...(followup ? [`You can say: ${followup}.`] : []),
    ].join(' ');
  }
  if (session.decision?.mode === 'backlog-only') {
    return [
      `I updated intake ${intakeId}.`,
      output,
      'It is now marked for the backlog.',
    ].join(' ');
  }
  return [
    `I updated intake ${intakeId}.`,
    output,
    "It's now ready for review.",
  ].join(' ');
}

function latestActiveIntakeId(store: IntakeStore): string | null {
  const sessions = store.listSessions().slice().reverse();
  return sessions.find((session) => session.state !== 'archived')?.intakeId ?? null;
}

async function applySpokenSessionCommand(
  store: IntakeStore,
  parsed: ParsedSpokenSessionCommand,
): Promise<string> {
  const intakeId = parsed.intakeId ?? latestActiveIntakeId(store);
  if (!intakeId) return "I couldn't find a recent intake to update.";
  switch (parsed.command) {
    case 'apply': {
      const applied = await applyIntakeSession(store, intakeId);
      return `I updated intake ${intakeId}. ${applied.output}`;
    }
    case 'propose': {
      const proposed = await proposeIntakeSession(store, intakeId);
      return `I updated intake ${intakeId}. ${proposed.output}`;
    }
    case 'archive': {
      const archived = archiveIntakeSession(store, intakeId);
      return `I updated intake ${intakeId}. ${archived.output}`;
    }
    case 'backlog': {
      const decided = decideIntakeSession(store, intakeId, 'backlog-only');
      return `I updated intake ${intakeId}. ${decided.output}`;
    }
    case 'schedule': {
      const scheduleText = parsed.scheduleText?.trim();
      if (!scheduleText) return "I couldn't tell when to schedule that intake.";
      const scheduled = scheduleIntakeSession(store, intakeId, scheduleText);
      return `I updated intake ${intakeId}. ${scheduled.output}`;
    }
  }
}

export async function maybeHandleSpokenVoiceIntake(
  ctx: SpokenVoiceIntakeContext,
): Promise<string | null> {
  const parsed = parseSpokenIntakeTranscript(ctx.transcript);
  if (!parsed) return null;
  if ('error' in parsed) return parsed.error;
  const store = ctx.store ?? getIntakeStore();
  const intent = resolveSpokenVoiceInputIntent(ctx.transcript, ctx.inputSource);
  if (intent?.kind === 'answer-clarify') {
    const intakeId = intent.intakeId ?? (() => {
      const sessions = store.listSessions().slice().reverse();
      const latestClarifying = sessions.find((session) =>
        session.state === 'clarifying' && (session.draft?.openQuestions.length ?? 0) > 0);
      return latestClarifying?.intakeId ?? null;
    })();
    if (!intakeId) return "I couldn't find a recent intake waiting for clarification.";
    const session = store.getSession(intakeId);
    if (!session) return `I couldn't find intake ${intakeId}.`;
    const questionId = session.draft?.openQuestions[0]?.id;
    if (!questionId) return `Intake ${intakeId} has no open clarification questions.`;
    const answered = answerIntakeQuestion(store, intakeId, questionId, intent.answer);
    return renderVoiceAnswerSummary(intakeId, answered.output, answered.session);
  }
  if (intent?.kind === 'control-turn' && intent.command !== 'intake-capture') {
    return applySpokenSessionCommand(store, {
      action: 'session-command',
      command: intent.command === 'intake-apply'
        ? 'apply'
        : intent.command === 'intake-propose'
          ? 'propose'
          : intent.command === 'intake-archive'
            ? 'archive'
            : intent.command === 'intake-backlog'
              ? 'backlog'
              : 'schedule',
      intakeId: intent.intakeId,
      scheduleText: intent.scheduleText,
    });
  }
  if (parsed.action !== 'capture') {
    return null;
  }
  if (!parsed.body.trim()) {
    return "I heard an intake command, but the note was empty.";
  }
  const now = ctx.now?.() ?? new Date();
  const intakeId = ctx.createIntakeId?.() ?? defaultIntakeId(now);
  const result = await ingestVoiceTranscript(
    store,
    {
      intakeId,
      transcript: parsed.body,
      receivedAt: ctx.receivedAt ?? now.toISOString(),
      inputSource: ctx.inputSource,
      actor: ctx.actor,
      channelContext: ctx.channelContext,
    },
    parsed.mode === 'schedule-followup'
      ? { mode: parsed.mode, scheduleText: parsed.scheduleText }
      : { mode: parsed.mode },
  );
  if (parsed.mode === 'apply-now' && result.state !== 'applied') {
    return [
      `I captured that as intake ${result.intakeId}.`,
      result.output,
    ].join(' ');
  }
  if (parsed.mode === 'schedule-followup' && result.state !== 'scheduled') {
    return [
      `I captured that as intake ${result.intakeId}.`,
      result.output,
    ].join(' ');
  }
  if (result.session.decision?.mode === 'backlog-only') {
    return [
      `I captured that as intake ${result.intakeId}.`,
      `${result.session.draft?.items.length ?? 0} item${(result.session.draft?.items.length ?? 0) === 1 ? '' : 's'} extracted.`,
      'It is marked for the backlog.',
    ].join(' ');
  }
  return renderVoiceIntakeSummary(result);
}

export const __intakeVoiceCommandTestUtils = {
  normalizeDurationText,
  parseSpokenIntakeTranscript,
  resolveSpokenVoiceInputIntent,
};
