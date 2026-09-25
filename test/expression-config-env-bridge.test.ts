import { describe, expect, test } from 'bun:test';
import { buildEnvOverrides } from '../src/expression/config/env-bridge.js';

describe('expression/config/env-bridge', () => {
  test('empty env produces empty overrides', () => {
    expect(buildEnvOverrides({ env: {} })).toEqual({});
  });

  test('MONAD_LLM_* env vars build the llm partial', () => {
    const out = buildEnvOverrides({
      env: {
        MONAD_LLM_PROVIDER: 'openai',
        MONAD_LLM_API_KEY: 'sk-foo',
        MONAD_LLM_MODEL: 'gpt-4o',
        MONAD_LLM_BASE_URL: 'https://api.openai.com/v1',
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

  test('MONAD_OBSIDIAN_VAULT also maps when OBSIDIAN_VAULT is unset', () => {
    expect(buildEnvOverrides({ env: { MONAD_OBSIDIAN_VAULT: '/v' } })).toEqual({
      obsidian: { vault: '/v' },
    });
  });

  test('MONAD_TELEGRAM_ENABLED toggles boolean', () => {
    expect(buildEnvOverrides({ env: { MONAD_TELEGRAM_ENABLED: '1' } })).toEqual({
      telegram: { enabled: true },
    });
    expect(buildEnvOverrides({ env: { MONAD_TELEGRAM_ENABLED: '0' } })).toEqual({
      telegram: { enabled: false },
    });
  });

  test('MONAD_DISCORD_BOT_TOKEN populates discord.botToken', () => {
    expect(
      buildEnvOverrides({ env: { MONAD_DISCORD_BOT_TOKEN: 'MTI...' } }),
    ).toEqual({ discord: { botToken: 'MTI...' } });
  });

  test('mixed env vars produce all sections', () => {
    const out = buildEnvOverrides({
      env: {
        MONAD_LLM_PROVIDER: 'grok',
        MONAD_TELEGRAM_BOT_TOKEN: '12:abc',
        OBSIDIAN_VAULT: '/v',
      },
    });
    expect(Object.keys(out).sort()).toEqual(['llm', 'obsidian', 'telegram']);
  });
});
