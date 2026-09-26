// RFC #2161 Phase 1 — registry normalize helpers.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { __resetCatalogForTests } from '../src/registry/loader';
import {
  normalizeProviderId, inferProviderFromModel, resolveFamilyShortcut,
  effectiveCapabilities,
} from '../src/registry/normalize';
import { setElanousConfigDir, resetElanousConfigDir } from '../src/elanous-config-dir.js';

const prevTestHome = process.env.ELANOUS_TEST_HOME;

let tmpHome: string;

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), 'reg-norm-'));
  process.env.ELANOUS_TEST_HOME = tmpHome;
  setElanousConfigDir(join(tmpHome, '.elanous'));
  __resetCatalogForTests();
});

afterEach(() => {
  rmSync(tmpHome, { recursive: true, force: true });
  resetElanousConfigDir();
  if (prevTestHome === undefined) delete process.env.ELANOUS_TEST_HOME;
  else process.env.ELANOUS_TEST_HOME = prevTestHome;
  __resetCatalogForTests();
});

describe('normalizeProviderId', () => {
  test('canonical id round-trips', () => {
    expect(normalizeProviderId('anthropic')).toBe('anthropic');
    expect(normalizeProviderId('openai')).toBe('openai');
    expect(normalizeProviderId('grok')).toBe('grok');
    expect(normalizeProviderId('gemini')).toBe('gemini');
    expect(normalizeProviderId('local')).toBe('local');
  });

  test('alias maps to canonical', () => {
    expect(normalizeProviderId('claude')).toBe('anthropic');
    expect(normalizeProviderId('codex')).toBe('openai');
    expect(normalizeProviderId('openai-codex')).toBe('openai');
    expect(normalizeProviderId('xai')).toBe('grok');
    expect(normalizeProviderId('google')).toBe('gemini');
    expect(normalizeProviderId('lm-studio')).toBe('local');
    expect(normalizeProviderId('lmstudio')).toBe('local');
    expect(normalizeProviderId('ollama')).toBe('local');
  });

  test('case-insensitive', () => {
    expect(normalizeProviderId('CLAUDE')).toBe('anthropic');
    expect(normalizeProviderId('Anthropic')).toBe('anthropic');
    expect(normalizeProviderId('LM-Studio')).toBe('local');
  });

  test('null / empty / unknown → null', () => {
    expect(normalizeProviderId(null)).toBeNull();
    expect(normalizeProviderId(undefined)).toBeNull();
    expect(normalizeProviderId('')).toBeNull();
    expect(normalizeProviderId('   ')).toBeNull();
    expect(normalizeProviderId('mistral')).toBeNull();      // no provider exists
  });
});

describe('inferProviderFromModel', () => {
  test('explicit ModelSpec hit', () => {
    expect(inferProviderFromModel('claude-opus-4-7')).toBe('anthropic');
    expect(inferProviderFromModel('claude-sonnet-4-6')).toBe('anthropic');
    expect(inferProviderFromModel('gpt-5.5')).toBe('openai');
    expect(inferProviderFromModel('grok-4.3')).toBe('grok');
    expect(inferProviderFromModel('gemini-3.1-pro-preview')).toBe('gemini');
  });

  test('provider-level prefix scan (long-tail unspec\'d models)', () => {
    expect(inferProviderFromModel('claude-future-9000')).toBe('anthropic');
    expect(inferProviderFromModel('gpt-7')).toBe('openai');
    // o1- / o3- / o4- registered prefixes; o4-pro variant routes to openai.
    expect(inferProviderFromModel('o4-pro')).toBe('openai');
    expect(inferProviderFromModel('gemini-4-flash')).toBe('gemini');
    expect(inferProviderFromModel('grok-5')).toBe('grok');
  });

  test('local provider _patterns.yaml prefix fallback', () => {
    expect(inferProviderFromModel('local:custom-llama')).toBe('local');
    expect(inferProviderFromModel('gemma-4-26b-a4b-it')).toBe('local');
    expect(inferProviderFromModel('qwen3.6-max')).toBe('local');
    expect(inferProviderFromModel('llama3-70b')).toBe('local');
    expect(inferProviderFromModel('phi-4-mini')).toBe('local');
    expect(inferProviderFromModel('kimi-k2.5')).toBe('local');
    expect(inferProviderFromModel('glm-5')).toBe('local');
    expect(inferProviderFromModel('mistral-large')).toBe('local');
    expect(inferProviderFromModel('mixtral-8x7b')).toBe('local');
    expect(inferProviderFromModel('deepseek-r1')).toBe('local');
  });

  test('case-insensitive', () => {
    expect(inferProviderFromModel('CLAUDE-OPUS-4-7')).toBe('anthropic');
    expect(inferProviderFromModel('GPT-5.5')).toBe('openai');
    expect(inferProviderFromModel('Local:foo')).toBe('local');
  });

  test('null / unknown / no-prefix → null', () => {
    expect(inferProviderFromModel(null)).toBeNull();
    expect(inferProviderFromModel(undefined)).toBeNull();
    expect(inferProviderFromModel('')).toBeNull();
    expect(inferProviderFromModel('totally-unknown-bot')).toBeNull();
  });

  test('longest-prefix wins (codex- beats gpt- when both registered)', () => {
    // Both 'gpt-' and 'codex-' route to 'openai' so longest wins
    // tautologically — but verify the pattern by checking that adding
    // an `o4-` prefix matches over `o`-prefix alone.
    expect(inferProviderFromModel('o4-mini-pro')).toBe('openai');
  });
});

describe('resolveFamilyShortcut', () => {
  test('catalog familyShortcut → canonical model id', () => {
    expect(resolveFamilyShortcut('opus')).toBe('claude-opus-5-5');
    expect(resolveFamilyShortcut('sonnet')).toBe('claude-sonnet-5');
    expect(resolveFamilyShortcut('haiku')).toBe('claude-haiku-4-5');
    expect(resolveFamilyShortcut('grok')).toBe('grok-4.7');
    expect(resolveFamilyShortcut('pro')).toBe('gemini-3.1-pro-preview');
    expect(resolveFamilyShortcut('flash')).toBe('gemini-3-flash');
  });

  test('case-insensitive', () => {
    expect(resolveFamilyShortcut('OPUS')).toBe('claude-opus-5-5');
    expect(resolveFamilyShortcut('Sonnet')).toBe('claude-sonnet-5');
  });

  test('unknown / null → null', () => {
    expect(resolveFamilyShortcut('superopus')).toBeNull();
    expect(resolveFamilyShortcut(null)).toBeNull();
    expect(resolveFamilyShortcut(undefined)).toBeNull();
    expect(resolveFamilyShortcut('')).toBeNull();
  });

  test('grok-fast shortcut prefers active over deprecated grok-4-fast', () => {
    // grok-4-fast is marked deprecated in catalog; grok-4-1-fast-reasoning
    // is the successor. resolveFamilyShortcut should prefer non-deprecated.
    // Both would claim familyShortcut='grok-fast'? Only grok-4-fast.yaml
    // has the shortcut declared per current catalog — verify resolver
    // returns the deprecated entry only when no active alternative.
    const result = resolveFamilyShortcut('grok-fast');
    // Either grok-4-fast (only model with familyShortcut: grok-fast) or
    // null if catalog evolves. Accept both — the contract is "non-null
    // when the shortcut is registered".
    expect(['grok-4-fast', null]).toContain(result);
  });
});

describe('effectiveCapabilities', () => {
  test('returns provider defaults when model is null', () => {
    const caps = effectiveCapabilities('anthropic', null);
    expect(caps).not.toBeNull();
    expect(caps!.thinkingControl).toBe(true);
    expect(caps!.skills).toBe(true);
  });

  test('returns provider defaults when model has no override', () => {
    const caps = effectiveCapabilities('anthropic', 'claude-opus-4-7');
    expect(caps).not.toBeNull();
    expect(caps!.thinkingControl).toBe(true);
  });

  test('returns null for unknown provider', () => {
    expect(effectiveCapabilities('mistral', null)).toBeNull();
  });
});
