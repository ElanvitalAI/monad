import { describe, expect, test } from 'bun:test';

import { wireDashboardTurnTypeaheadEcho } from '../src/dashboard/turn-typeahead-echo.js';

const queuedSubmission = (nextInitial: string) => ({ nextInitial, injectEnter: true });

describe('dashboard queued turn echo', () => {
  test('renders the queued submission that the drain handed to the next turn', () => {
    expect(wireDashboardTurnTypeaheadEcho(queuedSubmission('summarize the incident')))
      .toBe('  ⏎ 대기했던 요청을 보냈습니다 · "summarize the incident"');
  });

  test('suppresses a direct input handoff that did not inject Enter', () => {
    expect(wireDashboardTurnTypeaheadEcho({ nextInitial: 'typed directly', injectEnter: false })).toBeNull();
  });

  test('suppresses interrupted restoration because it does not inject Enter', () => {
    expect(wireDashboardTurnTypeaheadEcho({ nextInitial: 'restored queue\ndraft', injectEnter: false })).toBeNull();
  });

  test('suppresses auxiliary drain output without a submitted value', () => {
    expect(wireDashboardTurnTypeaheadEcho({ nextInitial: undefined, injectEnter: false })).toBeNull();
  });

  test('normalizes LF, CRLF, and CR queued submissions into one log line', () => {
    const line = wireDashboardTurnTypeaheadEcho(queuedSubmission('first\nsecond\r\nthird\rfourth'));

    expect(line).toBe('  ⏎ 대기했던 요청을 보냈습니다 · "first second third fourth"');
    expect(line).not.toMatch(/[\r\n]/);
  });

  test('marks long multiline queued submissions as truncated after normalization', () => {
    const line = wireDashboardTurnTypeaheadEcho(queuedSubmission(`${'x'.repeat(79)}\r\nsecond`));

    expect(line).toBe(`  ⏎ 대기했던 요청을 보냈습니다 · "${'x'.repeat(79)} …" (잘림)`);
    expect(line).not.toMatch(/[\r\n]/);
  });
});
