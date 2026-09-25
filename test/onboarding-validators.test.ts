import { describe, expect, test } from 'bun:test';
import {
  askValidated,
  chain,
  validateApiKey,
  validateDiscordToken,
  validateIntList,
  validateNonEmpty,
  validatePath,
  validateTelegramToken,
  validateUrl,
} from '../src/onboarding/validators.js';
import { scriptedIO } from '../src/onboarding.js';

describe('onboarding/validators · validators', () => {
  test('validateNonEmpty', () => {
    expect(validateNonEmpty('Token')('')).toContain('must be at least');
    expect(validateNonEmpty('Token')('a')).toBeNull();
    expect(validateNonEmpty('Token', 5)('abc')).toContain('5');
    expect(validateNonEmpty('Token', 5)('abcdef')).toBeNull();
  });

  test('validateTelegramToken', () => {
    expect(validateTelegramToken()('not-a-token')).toContain('@BotFather');
    expect(validateTelegramToken()('1234567890:AbCdEfGhIjKlMnOpQrStUvWxYz')).toBeNull();
  });

  test('validateDiscordToken', () => {
    expect(validateDiscordToken()('short')).toContain('right');
    expect(validateDiscordToken()('with spaces ' + 'x'.repeat(30))).toContain('right');
    expect(validateDiscordToken()('a'.repeat(50))).toBeNull();
  });

  test('validateUrl', () => {
    expect(validateUrl()('not-a-url')).not.toBeNull();
    expect(validateUrl()('http://localhost')).toContain('https');
    expect(validateUrl({ allowHttp: true })('http://localhost')).toBeNull();
    expect(validateUrl()('https://api.openai.com/v1')).toBeNull();
    expect(validateUrl()('ftp://example.com')).toContain('http');
  });

  test('validatePath — non-existing path passes when not required', () => {
    expect(validatePath()('/nonexistent/path')).toBeNull();
    expect(validatePath({ requireExists: true })('/nonexistent/path')).toContain('does not exist');
  });

  test('validatePath — existing dir', () => {
    expect(validatePath({ requireDir: true })('/tmp')).toBeNull();
  });

  test('validateApiKey', () => {
    expect(validateApiKey('OpenAI')('')).toContain('required');
    expect(validateApiKey('OpenAI')('short')).toContain('too short');
    expect(validateApiKey('OpenAI')('sk-foo bar baz qux')).toContain('whitespace');
    expect(validateApiKey('OpenAI', 5)('sk-abc12')).toBeNull();
  });

  test('validateIntList', () => {
    expect(validateIntList()('')).toBeNull();
    expect(validateIntList()('123,456')).toBeNull();
    expect(validateIntList()('not, numbers')).not.toBeNull();
    expect(validateIntList()('123, abc')).toBeNull(); // at least one valid
  });

  // PR-Δ7 — variants
  test('validatePath { allowEmpty: true } — blank input passes', () => {
    expect(validatePath({ allowEmpty: true })('')).toBeNull();
    expect(validatePath({ allowEmpty: true })('   ')).toBeNull();
    // Without allowEmpty, blank is rejected
    expect(validatePath()('')).toContain('Path required');
  });

  test('validateIntList { allowMentionWrappers } — strips Discord wrappers', () => {
    const v = validateIntList({ allowMentionWrappers: true });
    expect(v('<@123>')).toBeNull();
    expect(v('<@!123>')).toBeNull();
    expect(v('<@123>, <@456>, 789')).toBeNull();
    // Without the option, wrappers are rejected
    expect(validateIntList()('<@123>')).not.toBeNull();
  });

  test('chain stops at first error', async () => {
    const v = chain(validateNonEmpty('X', 3), validateApiKey('X', 5));
    expect(await v('ab')).toContain('at least 3');
    expect(await v('abcd')).toContain('too short');
    expect(await v('abcdefg')).toBeNull();
  });
});

describe('onboarding/validators · askValidated retry loop', () => {
  test('returns immediately on valid answer', async () => {
    const io = scriptedIO(['valid-input-XX']);
    const result = await askValidated(io, 'API: ', validateApiKey('API', 5));
    expect(result).toBe('valid-input-XX');
  });

  test('retries on invalid answer', async () => {
    const io = scriptedIO(['ab', 'longer-key-XXX']);
    const result = await askValidated(io, 'API: ', validateApiKey('API', 5));
    expect(result).toBe('longer-key-XXX');
    // The first ask printed an error message (count includes prompts + error)
    expect(io.outputs.some((o) => o.includes('!'))).toBe(true);
  });

  test('gives up after maxAttempts and returns last value', async () => {
    const io = scriptedIO(['a', 'b', 'c']);
    const result = await askValidated(io, 'X: ', validateApiKey('X', 5), { maxAttempts: 3 });
    expect(result).toBe('c');
    expect(io.outputs.some((o) => o.includes('max attempts'))).toBe(true);
  });

  test('async validator (Promise<string|null>) resolves', async () => {
    const io = scriptedIO(['abc']);
    const result = await askValidated(io, 'X: ', async (v) => {
      await new Promise((r) => setTimeout(r, 1));
      return v.length < 3 ? 'too short' : null;
    });
    expect(result).toBe('abc');
  });
});

// PR-Δ21 (Sprint 16 · 2026-04-30 · F12) — askValidated help routing.
// `?` / `help` / `h` re-prompt without spending an attempt and the
// `lastValue` returned on max-attempts is the last validation-failing
// input, not a literal `?`.
describe('onboarding/validators · askValidated help routing (Δ21)', () => {
  test('?-marker triggers help overlay + re-prompt without attempt cost', async () => {
    const io = scriptedIO(['?', 'valid-input-XX']);
    const result = await askValidated(
      io,
      'API: ',
      validateApiKey('API', 5),
      { topic: 'llm' },
    );
    expect(result).toBe('valid-input-XX');
    // Help body printed (LLM markdown contains "provider").
    expect(io.outputs.some((o) => /help/i.test(o))).toBe(true);
  });

  test('help marker does not consume the attempt budget', async () => {
    // 3 max attempts, 2 help markers, 3 invalid inputs = exhausts budget
    // on the 3rd invalid (last value = 'c'). Help markers re-prompt.
    const io = scriptedIO(['?', 'a', 'help', 'b', 'c']);
    const result = await askValidated(
      io,
      'X: ',
      validateApiKey('X', 5),
      { maxAttempts: 3, topic: 'llm' },
    );
    expect(result).toBe('c');
    expect(io.outputs.some((o) => o.includes('max attempts'))).toBe(true);
  });

  test('opt-in only — no topic = no help routing (`?` treated as input)', async () => {
    const io = scriptedIO(['?']);
    const result = await askValidated(io, 'X: ', () => null);  // accept anything
    expect(result).toBe('?');
    // No help body printed.
    expect(io.outputs.some((o) => /───── help ─────/.test(o))).toBe(false);
  });
});
