import { describe, expect, test } from 'bun:test';

import {
  resolveDashboardVoiceDictationAction,
  resolveDashboardVoiceDictationIntent,
} from '../src/dashboard/input/voice-dictation.js';

describe('dashboard voice dictation action', () => {
  test('skips empty transcripts', () => {
    expect(resolveDashboardVoiceDictationAction({
      text: '   ',
      workingFocus: 'browser',
      chatMainForegroundActive: false,
      chatMainPromptLive: false,
    })).toEqual({ kind: 'skip' });
  });

  test('inserts directly into a live chat-main prompt', () => {
    expect(resolveDashboardVoiceDictationAction({
      text: 'hello world',
      workingFocus: 'input',
      chatMainForegroundActive: true,
      chatMainPromptLive: true,
    })).toEqual({
      kind: 'insert-live-chat-main',
      text: 'hello world',
    });
  });

  test('queues chat-main dictation and opens input from another pane', () => {
    expect(resolveDashboardVoiceDictationAction({
      text: 'hello world',
      workingFocus: 'browser',
      chatMainForegroundActive: false,
      chatMainPromptLive: false,
    })).toEqual({
      kind: 'queue-chat-main',
      text: 'hello world',
      transition: {
        nextFocus: 'input',
        nextPendingInputEntryMode: 'plain',
        nextLastWorkingDirPane: 'browser',
        reason: 'voice-dictation-open-input',
      },
    });
  });

  test('queues chat-main dictation without a focus transition when already in input', () => {
    expect(resolveDashboardVoiceDictationAction({
      text: 'hello world',
      workingFocus: 'input',
      chatMainForegroundActive: false,
      chatMainPromptLive: false,
    })).toEqual({
      kind: 'queue-chat-main',
      text: 'hello world',
      transition: null,
    });
  });

  test('maps voice dictation into dictate-into-buffer intents', () => {
    expect(resolveDashboardVoiceDictationIntent({
      text: 'hello world',
      workingFocus: 'input',
      chatMainForegroundActive: true,
      chatMainPromptLive: true,
    })).toEqual({
      kind: 'dictate-into-buffer',
      source: {
        kind: 'voice',
        channel: 'dashboard',
        surface: 'dashboard-dictation',
        mode: 'dictation',
        transcriptSource: 'voice',
      },
      text: 'hello world',
      target: 'live-chat-main',
    });
  });
});
