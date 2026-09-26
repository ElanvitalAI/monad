import { describe, expect, test } from 'bun:test';
import { buildEnvOverrides } from '../src/expression/config/env-bridge.js';

describe('expression/config/env-bridge', () => {
  test('empty env produces empty overrides', () => {
    expect(buildEnvOverrides({ env: {} })).toEqual({});
  });

  test('ELANOUS_LLM_* env vars build the llm partial', () => {
    const out = buildEnvOverrides({
      env: {
        ELANOUS_LLM_PROVIDER: 'openai',
        ELANOUS_LLM_API_KEY: 'sk-foo',
        ELANOUS_LLM_MODEL: 'gpt-4o',
        ELANOUS_LLM_BASE_URL: 'https://api.openai.com/v1',
      },
    });
    expect(out.llm).toEqual({
      provider: 'openai',
      apiKey: 'sk-foo',
      model: 'gpt-4o',
      baseUrl: 'https://api.openai.com/v1',
    });
  });

  test('OBSIDIAN_VAULT (legacy) maps to obsidian.vault', () => {
    expect(buildEnvOverrides({ env: { OBSIDIAN_VAULT: '/v' } })).toEqual({
      obsidian: { vault: '/v' },
    });
  });

  test('ELANOUS_OBSIDIAN_VAULT also maps when OBSIDIAN_VAULT is unset', () => {
    expect(buildEnvOverrides({ env: { ELANOUS_OBSIDIAN_VAULT: '/v' } })).toEqual({
      obsidian: { vault: '/v' },
    });
  });

  test('ELANOUS_TELEGRAM_ENABLED toggles boolean', () => {
    expect(buildEnvOverrides({ env: { ELANOUS_TELEGRAM_ENABLED: '1' } })).toEqual({
      telegram: { enabled: true },
    });
    expect(buildEnvOverrides({ env: { ELANOUS_TELEGRAM_ENABLED: '0' } })).toEqual({
      telegram: { enabled: false },
    });
  });

  test('ELANOUS_DISCORD_BOT_TOKEN populates discord.botToken', () => {
    expect(
      buildEnvOverrides({ env: { ELANOUS_DISCORD_BOT_TOKEN: 'MTI...' } }),
    ).toEqual({ discord: { botToken: 'MTI...' } });
  });

  test('mixed env vars produce all sections', () => {
    const out = buildEnvOverrides({
      env: {
        ELANOUS_LLM_PROVIDER: 'grok',
        ELANOUS_TELEGRAM_BOT_TOKEN: '12:abc',
        OBSIDIAN_VAULT: '/v',
      },
    });
    expect(Object.keys(out).sort()).toEqual(['llm', 'obsidian', 'telegram']);
  });
});
