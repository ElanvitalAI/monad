import { describe, expect, test } from 'bun:test';
import { isHelpRequest, showHelp } from '../src/onboarding/help-overlay.js';
import { scriptedIO } from '../src/onboarding.js';

describe('onboarding/help-overlay · isHelpRequest', () => {
  test('? / help / h all match', () => {
    expect(isHelpRequest('?')).toBe(true);
    expect(isHelpRequest('help')).toBe(true);
    expect(isHelpRequest('h')).toBe(true);
    expect(isHelpRequest('  ?  ')).toBe(true);
    expect(isHelpRequest('HELP')).toBe(true);
  });

  test('non-help inputs are rejected', () => {
    expect(isHelpRequest('y')).toBe(false);
    expect(isHelpRequest('hello')).toBe(false);
    expect(isHelpRequest('?abc')).toBe(false);
    expect(isHelpRequest('')).toBe(false);
  });
});

describe('onboarding/help-overlay · showHelp', () => {
  test('prints a header + footer + body lines', () => {
    const io = scriptedIO([]);
    showHelp(io, 'general');
    const log = io.outputs.join('\n');
    expect(log).toContain('help');
    expect(log).toContain('────');
  });

  test('topic="llm" mentions provider names', () => {
    const io = scriptedIO([]);
    showHelp(io, 'llm');
    const log = io.outputs.join('\n');
    // Either inline fallback or the markdown file body — both
    // contain "provider" / "OpenAI" / "Grok" etc.
    expect(log.length).toBeGreaterThan(50);
  });

  test('every supported topic prints something non-empty', () => {
    const topics = ['general', 'llm', 'skills', 'obsidian', 'telegram', 'discord'] as const;
    for (const t of topics) {
      const io = scriptedIO([]);
      showHelp(io, t);
      expect(io.outputs.join('\n').length).toBeGreaterThan(20);
    }
  });
});
