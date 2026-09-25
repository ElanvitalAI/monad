import type { PaneFocus } from '../../workspace-types.js';
import type { DictateIntoBufferIntent } from '../../input/input-intent.js';
import {
  resolveFocusToInputTransition,
  type FocusToInputTransition,
} from './focus-transition.js';

export type DashboardVoiceDictationAction =
  | { kind: 'skip' }
  | { kind: 'insert-live-chat-main'; text: string }
  | {
    kind: 'queue-chat-main';
    text: string;
    transition: FocusToInputTransition | null;
  };

export interface ResolveDashboardVoiceDictationActionOpts {
  text: string;
  workingFocus: PaneFocus;
  chatMainForegroundActive: boolean;
  chatMainPromptLive: boolean;
}

export function resolveDashboardVoiceDictationIntent(
  opts: ResolveDashboardVoiceDictationActionOpts,
): DictateIntoBufferIntent | null {
  const text = opts.text.trim();
  if (!text) return null;

  if (opts.chatMainForegroundActive && opts.chatMainPromptLive) {
    return {
      kind: 'dictate-into-buffer',
      source: {
        kind: 'voice',
        channel: 'dashboard',
        surface: 'dashboard-dictation',
        mode: 'dictation',
        transcriptSource: 'voice',
      },
      text,
      target: 'live-chat-main',
    };
  }

  return {
    kind: 'dictate-into-buffer',
    source: {
      kind: 'voice',
      channel: 'dashboard',
      surface: 'dashboard-dictation',
      mode: 'dictation',
      transcriptSource: 'voice',
    },
    text,
    target: 'queue-chat-main',
    transition: opts.workingFocus === 'input'
      ? null
      : resolveFocusToInputTransition({
        sourcePane: opts.workingFocus,
        rememberPane: true,
        mode: 'plain',
        reason: 'voice-dictation-open-input',
      }),
  };
}

export function resolveDashboardVoiceDictationAction(
  opts: ResolveDashboardVoiceDictationActionOpts,
): DashboardVoiceDictationAction {
  const intent = resolveDashboardVoiceDictationIntent(opts);
  if (!intent) return { kind: 'skip' };
  if (intent.target === 'live-chat-main') {
    return { kind: 'insert-live-chat-main', text: intent.text };
  }
  return {
    kind: 'queue-chat-main',
    text: intent.text,
    transition: (intent.transition ?? null) as FocusToInputTransition | null,
  };
}
