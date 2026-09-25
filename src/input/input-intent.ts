import type { InputSourceRef } from './input-source-kind.js';

export interface InputIntentFocusTransition {
  nextFocus?: string | null;
  nextPendingInputEntryMode?: string | null;
  nextLastWorkingDirPane?: string | null;
  reason?: string | null;
}

export interface SubmitTurnIntent {
  kind: 'submit-turn';
  source: InputSourceRef;
  text: string;
  route: 'plain' | 'sticky-acp' | 'daemon-prompt' | 'daemon-session';
  /** Session captured when the input was submitted, for lifecycle-log correlation. */
  sessionId?: string;
  backend?: string;
}

export interface DictateIntoBufferIntent {
  kind: 'dictate-into-buffer';
  source: InputSourceRef;
  text: string;
  target: 'live-chat-main' | 'queue-chat-main';
  transition?: InputIntentFocusTransition | null;
}

export interface AnswerClarifyIntent {
  kind: 'answer-clarify';
  source: InputSourceRef;
  answer: string;
  intakeId?: string;
  questionId?: string;
}

export interface ControlTurnIntent {
  kind: 'control-turn';
  source: InputSourceRef;
  command:
    | 'slash-command'
    | 'intake-capture'
    | 'intake-apply'
    | 'intake-propose'
    | 'intake-archive'
    | 'intake-backlog'
    | 'intake-schedule';
  commandText?: string;
  intakeId?: string;
  text?: string;
  mode?: 'review' | 'apply-now' | 'backlog-only' | 'schedule-followup';
  scheduleText?: string;
}

export type InputIntent =
  | SubmitTurnIntent
  | DictateIntoBufferIntent
  | AnswerClarifyIntent
  | ControlTurnIntent;
