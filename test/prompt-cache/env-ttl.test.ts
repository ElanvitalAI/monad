import { afterEach, describe, expect, test } from 'bun:test';
import { getDefaultCacheTTL } from '../../src/config.js';

const ORIGINAL = process.env.ELANOUS_PROMPT_CACHE_TTL;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.ELANOUS_PROMPT_CACHE_TTL;
  else process.env.ELANOUS_PROMPT_CACHE_TTL = ORIGINAL;
});

describe('getDefaultCacheTTL — env parsing', () => {
  test('unset env → 5m', () => {
    delete process.env.ELANOUS_PROMPT_CACHE_TTL;
    expect(getDefaultCacheTTL()).toBe('5m');
  });

  test('empty string → 5m', () => {
    process.env.ELANOUS_PROMPT_CACHE_TTL = '';
    expect(getDefaultCacheTTL()).toBe('5m');
  });

  test('"5m" → 5m', () => {
    process.env.ELANOUS_PROMPT_CACHE_TTL = '5m';
    expect(getDefaultCacheTTL()).toBe('5m');
  });

  test('"1h" → 1h', () => {
    process.env.ELANOUS_PROMPT_CACHE_TTL = '1h';
    expect(getDefaultCacheTTL()).toBe('1h');
  });

  test('"1hour" alias → 1h', () => {
    process.env.ELANOUS_PROMPT_CACHE_TTL = '1hour';
    expect(getDefaultCacheTTL()).toBe('1h');
  });

  test('"3600" seconds → 1h', () => {
    process.env.ELANOUS_PROMPT_CACHE_TTL = '3600';
    expect(getDefaultCacheTTL()).toBe('1h');
  });

  test('uppercase "1H" → 1h', () => {
    process.env.ELANOUS_PROMPT_CACHE_TTL = '1H';
    expect(getDefaultCacheTTL()).toBe('1h');
  });

  test('invalid value "15m" falls back to 5m', () => {
    process.env.ELANOUS_PROMPT_CACHE_TTL = '15m';
    expect(getDefaultCacheTTL()).toBe('5m');
  });

  test('invalid value "forever" falls back to 5m', () => {
    process.env.ELANOUS_PROMPT_CACHE_TTL = 'forever';
    expect(getDefaultCacheTTL()).toBe('5m');
  });

  test('whitespace is trimmed before matching', () => {
    process.env.ELANOUS_PROMPT_CACHE_TTL = '  1h  ';
    expect(getDefaultCacheTTL()).toBe('1h');
  });
});
