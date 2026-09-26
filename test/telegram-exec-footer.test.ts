import { describe, test, expect } from 'bun:test';
import { executionFooter, selfToolArgHint } from '../src/telegram-exec-footer';

describe('executionFooter', () => {
  test('self turn → 🧠 elanous · <model>', () => {
    expect(executionFooter({ model: 'gpt-5.6-terra' })).toBe('— 🧠 elanous · gpt-5.6-terra');
  });

  test('self turn with no model → (default)', () => {
    expect(executionFooter({})).toBe('— 🧠 elanous · (default)');
  });

  test('ACP delegate → 🤖 acp-<backend>, canonicalized', () => {
    expect(executionFooter({ delegatedBackend: 'claude' })).toBe('— 🤖 acp-claude');
    expect(executionFooter({ delegatedBackend: 'codex-app-server' })).toBe('— 🤖 acp-codex');
    expect(executionFooter({ delegatedBackend: 'gemini' })).toBe('— 🤖 acp-gemini');
    expect(executionFooter({ delegatedBackend: 'grok' })).toBe('— 🤖 acp-grok');
  });

  test('acp footer shows the backend model when reported (codex)', () => {
    expect(executionFooter({ delegatedBackend: 'codex-app-server', model: 'gpt-5.6-terra' }))
      .toBe('— 🤖 acp-codex · gpt-5.6-terra');
  });

  test('self footer shows model(effort) compactly', () => {
    expect(executionFooter({ model: 'gpt-5.6-terra', effort: 'high' }))
      .toBe('— 🧠 elanous · gpt-5.6-terra(high)');
  });

  test('acp footer shows model(effort) when both known', () => {
    expect(executionFooter({ delegatedBackend: 'codex-app-server', model: 'gpt-5.6-terra', effort: 'high' }))
      .toBe('— 🤖 acp-codex · gpt-5.6-terra(high)');
  });
});

describe('selfToolArgHint (self tool-progress line)', () => {
  test('picks command / file_path and truncates', () => {
    expect(selfToolArgHint({ command: 'bun test' })).toBe(' · bun test');
    expect(selfToolArgHint({ file_path: '/tmp/x.ts' })).toBe(' · /tmp/x.ts');
    expect(selfToolArgHint({ command: 'x'.repeat(80) })).toBe(` · ${'x'.repeat(60)}…`);
  });
  test('empty when no recognizable arg', () => {
    expect(selfToolArgHint({})).toBe('');
    expect(selfToolArgHint(undefined)).toBe('');
    expect(selfToolArgHint('nope')).toBe('');
  });
});
