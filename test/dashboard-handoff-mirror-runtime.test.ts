import { describe, expect, test } from 'bun:test';

import { runDashboardHandoffMirror } from '../src/dashboard/handoff-mirror-runtime.js';

describe('runDashboardHandoffMirror', () => {
  test('appends both user and assistant turns when attached', () => {
    const events: Array<{ role: string; content: string; ts: string }> = [];

    runDashboardHandoffMirror({
      attachedSessionId: 'sess-1',
      userContent: 'hello',
      assistantContent: 'world',
      appendMessage: (_sessionId, msg) => { events.push(msg); },
      now: () => '2026-04-30T00:00:00.000Z',
      onWarning: () => {},
    });

    expect(events).toEqual([
      { role: 'user', content: 'hello', ts: '2026-04-30T00:00:00.000Z' },
      { role: 'assistant', content: 'world', ts: '2026-04-30T00:00:00.000Z' },
    ]);
  });

  test('noops when there is no attached session', () => {
    const warnings: string[] = [];

    runDashboardHandoffMirror({
      attachedSessionId: null,
      userContent: 'hello',
      assistantContent: 'world',
      appendMessage: () => { throw new Error('should not run'); },
      onWarning: (message) => { warnings.push(message); },
    });

    expect(warnings).toEqual([]);
  });

  test('surfaces append failures as warnings', () => {
    const warnings: string[] = [];

    runDashboardHandoffMirror({
      attachedSessionId: 'sess-1',
      userContent: 'hello',
      assistantContent: 'world',
      appendMessage: () => { throw new Error('boom'); },
      onWarning: (message) => { warnings.push(message); },
    });

    expect(warnings).toEqual(['  (handoff mirror: boom)']);
  });
});
