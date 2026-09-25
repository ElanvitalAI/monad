import { describe, expect, test } from 'bun:test';

import {
  buildIntakeClarifyPrompt,
  buildIntakeNextActions,
  buildIntakePresentationLines,
} from '../src/intake-plane/presenter.js';
import { createIntakeStore } from '../src/intake-plane/store.js';
import { createTextChannelIntakeRecord } from '../src/intake-plane/adapters/text.js';
import { createVoiceIntakeRecord } from '../src/intake-plane/adapters/voice.js';
import { captureAndDraftIntakeRecord } from '../src/intake-plane/capture.js';

describe('buildIntakeNextActions', () => {
  test('returns answer action for clarifying text-channel intake', () => {
    const store = createIntakeStore({ archiveDir: null });
    const session = captureAndDraftIntakeRecord(store, createTextChannelIntakeRecord({
      intakeId: 'intake-q',
      source: 'telegram',
      text: '====',
      receivedAt: '2026-04-30T12:00:00.000Z',
    }));
    const actions = buildIntakeNextActions(session, 'telegram');
    expect(actions).toHaveLength(1);
    expect(actions[0]?.kind).toBe('answer');
    expect(actions[0]?.command).toContain('/intake answer');
  });

  test('preserves every presentation prefix kind for review-ready intake', () => {
    const store = createIntakeStore({ archiveDir: null });
    const session = captureAndDraftIntakeRecord(store, createVoiceIntakeRecord({
      intakeId: 'intake-ready',
      transcript: 'compare two repos',
      receivedAt: '2026-04-30T12:00:00.000Z',
    }));
    const expectedPrefixes = {
      slash: '/intake',
      telegram: '/intake',
      discord: '!intake',
      voice: 'intake',
      http: null,
    } as const;

    for (const [prefixKind, expectedPrefix] of Object.entries(expectedPrefixes)) {
      const actions = buildIntakeNextActions(session, prefixKind as keyof typeof expectedPrefixes);
      expect(actions.map((action) => action.kind)).toEqual([
        'decide-apply-now',
        'decide-backlog-only',
        'propose',
      ]);
      expect(actions[0]?.command).toBe(
        expectedPrefix ? `${expectedPrefix} decide apply-now intake-ready` : null,
      );
    }
  });

  test('builds shared presentation lines for clarifying sessions', () => {
    const store = createIntakeStore({ archiveDir: null });
    const session = captureAndDraftIntakeRecord(store, createTextChannelIntakeRecord({
      intakeId: 'intake-lines',
      source: 'telegram',
      text: '====',
      receivedAt: '2026-04-30T12:00:00.000Z',
    }));
    const lines = buildIntakePresentationLines(session, 'telegram');
    expect(lines).toContain('questions:');
    expect(lines.some((line) => line.includes('q-empty:'))).toBe(true);
    expect(buildIntakeClarifyPrompt(session)).toContain('backlog');
  });
});
