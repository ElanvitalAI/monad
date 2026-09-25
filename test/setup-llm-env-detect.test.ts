import { describe, expect, test } from 'bun:test';
import {
  AUXILIARY_AI_ENV_VARS,
  detectProviderEnvKeys,
  listEnvDetectedProviders,
  PROVIDER_ENV_SPEC,
  summarizeAuxiliaryAiEnv,
} from '../src/setup/llm-env-detect.js';

describe('detectProviderEnvKeys', () => {
  test('returns one entry per detectable provider, missing when env empty', () => {
    const out = detectProviderEnvKeys({});
    for (const spec of PROVIDER_ENV_SPEC) {
      expect(out[spec.provider]).toBeDefined();
      expect(out[spec.provider].value).toBeUndefined();
      expect(out[spec.provider].source).toBeUndefined();
    }
  });

  test('canonical primary env vars populate value + source', () => {
    const out = detectProviderEnvKeys({
      ANTHROPIC_API_KEY: 'sk-ant-1234567890',
      OPENAI_API_KEY: 'sk-proj-abcdef',
      GEMINI_API_KEY: 'gemini-key-1',
      XAI_API_KEY: 'xai-key-1',
      LOCAL_LLM_URL: 'http://localhost:11434/v1',
    });
    expect(out.anthropic).toMatchObject({ value: 'sk-ant-1234567890', source: 'ANTHROPIC_API_KEY' });
    expect(out.openai).toMatchObject({ value: 'sk-proj-abcdef', source: 'OPENAI_API_KEY' });
    // openai-codex shares OPENAI_API_KEY
    expect(out['openai-codex']).toMatchObject({ value: 'sk-proj-abcdef', source: 'OPENAI_API_KEY' });
    expect(out.gemini).toMatchObject({ value: 'gemini-key-1', source: 'GEMINI_API_KEY' });
    expect(out.grok).toMatchObject({ value: 'xai-key-1', source: 'XAI_API_KEY' });
    expect(out.local).toMatchObject({ value: 'http://localhost:11434/v1', source: 'LOCAL_LLM_URL' });
  });

  test('alias env vars are honored when primary missing', () => {
    const out = detectProviderEnvKeys({
      GROK_API_KEY: 'grok-fallback',
      GOOGLE_API_KEY: 'google-fallback',
    });
    expect(out.grok).toMatchObject({ value: 'grok-fallback', source: 'GROK_API_KEY' });
    expect(out.gemini).toMatchObject({ value: 'google-fallback', source: 'GOOGLE_API_KEY' });
  });

  test('primary env wins over alias when both set', () => {
    const out = detectProviderEnvKeys({
      XAI_API_KEY: 'primary-xai',
      GROK_API_KEY: 'fallback-grok',
      GEMINI_API_KEY: 'primary-gemini',
      GOOGLE_API_KEY: 'fallback-google',
    });
    expect(out.grok.source).toBe('XAI_API_KEY');
    expect(out.grok.value).toBe('primary-xai');
    expect(out.gemini.source).toBe('GEMINI_API_KEY');
    expect(out.gemini.value).toBe('primary-gemini');
  });

  test('whitespace-only env values count as missing', () => {
    const out = detectProviderEnvKeys({
      ANTHROPIC_API_KEY: '   ',
      OPENAI_API_KEY: '\t\n',
    });
    expect(out.anthropic.value).toBeUndefined();
    expect(out.openai.value).toBeUndefined();
  });

  test('env values are trimmed', () => {
    const out = detectProviderEnvKeys({
      ANTHROPIC_API_KEY: '  sk-ant-trimmed  ',
    });
    expect(out.anthropic.value).toBe('sk-ant-trimmed');
  });

  test('model overrides surface separately from API key', () => {
    const out = detectProviderEnvKeys({
      ANTHROPIC_API_KEY: 'sk-ant-1',
      ANTHROPIC_MODEL: 'claude-haiku-4-5-20251001',
      GROK_MODEL: 'grok-4-1-fast',
    });
    expect(out.anthropic.modelOverride).toBe('claude-haiku-4-5-20251001');
    // grok has model override but no API key
    expect(out.grok.value).toBeUndefined();
    expect(out.grok.modelOverride).toBe('grok-4-1-fast');
  });

  test('local provider mirrors LOCAL_LLM_URL into baseUrlOverride', () => {
    const out = detectProviderEnvKeys({
      LOCAL_LLM_URL: 'http://192.168.1.10:1234/v1',
      LOCAL_LLM_MODEL: 'llama3',
    });
    expect(out.local.value).toBe('http://192.168.1.10:1234/v1');
    expect(out.local.baseUrlOverride).toBe('http://192.168.1.10:1234/v1');
    expect(out.local.modelOverride).toBe('llama3');
  });
});

describe('listEnvDetectedProviders', () => {
  test('returns providers in canonical-spec order, skipping missing', () => {
    const detection = detectProviderEnvKeys({
      ANTHROPIC_API_KEY: 'a',
      XAI_API_KEY: 'b',
      LOCAL_LLM_URL: 'c',
    });
    const list = listEnvDetectedProviders(detection);
    // PROVIDER_ENV_SPEC order: grok, openai, openai-codex, anthropic, gemini, local
    expect(list).toEqual(['grok', 'anthropic', 'local']);
  });

  test('empty when nothing detected', () => {
    expect(listEnvDetectedProviders(detectProviderEnvKeys({}))).toEqual([]);
  });
});

describe('summarizeAuxiliaryAiEnv', () => {
  test('returns only the auxiliary vars currently set', () => {
    const found = summarizeAuxiliaryAiEnv({
      FIRECRAWL_API_KEY: 'fc-1',
      ELEVENLABS_API_KEY: 'el-1',
      // not set: SUPADATA_API_KEY, BRAVE_API_KEY, etc.
    });
    expect(found.map(v => v.name).sort()).toEqual(['ELEVENLABS_API_KEY', 'FIRECRAWL_API_KEY']);
    expect(found[0].usedBy).toBeTruthy();
  });

  test('exposes a stable canonical list', () => {
    expect(AUXILIARY_AI_ENV_VARS.length).toBeGreaterThan(0);
    for (const v of AUXILIARY_AI_ENV_VARS) {
      expect(v.name).toMatch(/^[A-Z_]+$/);
      expect(v.usedBy).toBeTruthy();
    }
  });
});
