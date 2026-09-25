// PWA `/setup` Phase 1 — ApiKeyField helper tests.
//
// React testing harness 가 PWA 에 없어 (per existing convention in
// `QuickSetupCard.test.tsx`, `NexusClientProvider.test.tsx`) component
// 자체 render 는 export contract 만 검증.  validateApiKey / redactApiKey
// pure helper 두 개는 본 파일에서 깊이 테스트.

import { describe, expect, test } from 'bun:test';

import {
  ApiKeyField,
  redactApiKey,
  validateApiKey,
} from './api-key-field';

describe('ApiKeyField — mount surface', () => {
  test('exports a component', () => {
    expect(typeof ApiKeyField).toBe('function');
  });
});

describe('validateApiKey — default rules', () => {
  test('rejects empty string', () => {
    expect(validateApiKey('').ok).toBe(false);
  });

  test('rejects whitespace-only', () => {
    expect(validateApiKey('   \t  ').ok).toBe(false);
  });

  test('rejects below default minLength (8)', () => {
    expect(validateApiKey('short').ok).toBe(false);
  });

  test('accepts 8+ chars without prefix rule', () => {
    expect(validateApiKey('abcdefgh').ok).toBe(true);
  });

  test('messages are stable for downstream UI', () => {
    expect(validateApiKey('').message).toBe('required');
    expect(validateApiKey('a').message).toContain('at least 8');
  });
});

describe('validateApiKey — prefix rule', () => {
  test('accepts matching prefix', () => {
    expect(
      validateApiKey('sk-ant-test-1234567890', { prefix: 'sk-ant-' }).ok,
    ).toBe(true);
  });

  test('rejects wrong prefix', () => {
    const result = validateApiKey('AIzaSyTestKey1234', { prefix: 'sk-' });
    expect(result.ok).toBe(false);
    expect(result.message).toContain('sk-');
  });

  test('empty prefix string skips the check', () => {
    expect(
      validateApiKey('anykey1234', { prefix: '' }).ok,
    ).toBe(true);
  });
});

describe('validateApiKey — custom minLength', () => {
  test('honors per-provider min length', () => {
    expect(validateApiKey('short1', { minLength: 4 }).ok).toBe(true);
    expect(validateApiKey('shrt', { minLength: 8 }).ok).toBe(false);
  });
});

describe('redactApiKey', () => {
  test('redacts empty as empty', () => {
    expect(redactApiKey('')).toBe('');
    expect(redactApiKey('   ')).toBe('');
  });

  test('full-mask for short keys (<=8 chars)', () => {
    expect(redactApiKey('abc')).toBe('•••');
    expect(redactApiKey('12345678')).toBe('••••••••');
  });

  test('first4…last4 for longer keys', () => {
    expect(redactApiKey('sk-ant-1234567890-XYZ')).toBe('sk-a…-XYZ');
    expect(redactApiKey('AIzaSyTestKey12345')).toBe('AIza…2345');
  });

  test('trims before redacting', () => {
    expect(redactApiKey('  sk-test-1234567890  ')).toBe('sk-t…7890');
  });
});
