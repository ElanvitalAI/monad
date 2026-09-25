import type { InputSourceRef } from '../../input/input-source-kind.js';
import type { IntakeStore } from '../store.js';
import { buildIntakeClarifyPrompt, buildIntakeNextActions } from '../presenter.js';
import {
  ingestIntakeRecord,
  type IntakeIngestPolicy,
  type IntakeIngestResult,
} from '../service.js';
import type { RawIntakeRecord } from '../types.js';

export interface VoiceIntakeInput {
  intakeId: string;
  transcript: string;
  receivedAt: string;
  inputSource?: InputSourceRef;
  actor?: RawIntakeRecord['actor'];
  channelContext?: RawIntakeRecord['channelContext'];
}

export function createVoiceIntakeRecord(
  input: VoiceIntakeInput,
): RawIntakeRecord {
  return {
    intakeId: input.intakeId,
    source: 'voice',
    inputSourceKind: 'voice',
    inputSource: input.inputSource ?? {
      kind: 'voice',
      transcriptSource: 'voice',
    },
    rawText: input.transcript.trim(),
    attachments: [],
    transcriptSource: 'voice',
    receivedAt: input.receivedAt,
    actor: input.actor,
    channelContext: input.channelContext,
  };
}

export async function ingestVoiceTranscript(
  store: IntakeStore,
  input: VoiceIntakeInput,
  policy: IntakeIngestPolicy = {},
): Promise<IntakeIngestResult> {
  return ingestIntakeRecord(store, createVoiceIntakeRecord(input), policy);
}

export function renderVoiceIntakeSummary(
  result: IntakeIngestResult,
): string {
  const draft = result.session.draft;
  if (!draft) return `Intake ${result.intakeId} captured.`;
  if (draft.openQuestions.length > 0) {
    const followup = buildIntakeNextActions(result.session, 'voice')[0]?.command;
    return [
      `I captured that as intake ${result.intakeId}.`,
      `${draft.items.length} item${draft.items.length === 1 ? '' : 's'} extracted.`,
      `I still need one clarification: ${buildIntakeClarifyPrompt(result.session) ?? draft.openQuestions[0]!.question}`,
      ...(followup ? [`You can say: ${followup}.`] : []),
    ].join(' ');
  }
  if (result.state === 'applied') {
    return [
      `I captured that as intake ${result.intakeId}.`,
      `${draft.items.length} item${draft.items.length === 1 ? '' : 's'} extracted.`,
      'It has already been turned into tasks.',
    ].join(' ');
  }
  if (result.state === 'scheduled') {
    return [
      `I captured that as intake ${result.intakeId}.`,
      `${draft.items.length} item${draft.items.length === 1 ? '' : 's'} extracted.`,
      'It has been scheduled for follow-up.',
    ].join(' ');
  }
  return [
    `I captured that as intake ${result.intakeId}.`,
    `${draft.items.length} item${draft.items.length === 1 ? '' : 's'} extracted.`,
    `It's ready for review.`,
  ].join(' ');
}
