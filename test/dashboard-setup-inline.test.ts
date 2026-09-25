import { describe, expect, test } from 'bun:test';
import {
  applyDashboardDiscordSetup,
  applyDashboardProviderSetup,
  DASHBOARD_PROVIDER_SETUP_OPTIONS,
  findProviderSetupOption,
  parseDiscordAllowedUsers,
} from '../src/dashboard/setup-inline.js';
import { buildUserConfig } from '../src/user-config.js';

describe('dashboard setup inline helpers', () => {
  test('provider setup updates active provider and preserves a rotation entry', () => {
    const cfg = buildUserConfig('/tmp/monad-dashboard-setup-inline-provider.json');
    const option = findProviderSetupOption('anthropic');
    expect(option).not.toBeNull();
    const next = applyDashboardProviderSetup(cfg, option!, 'sk-ant-1234567890123456');
    expect(next.llm.provider).toBe('anthropic');
    expect(next.llm.apiKey).toBe('sk-ant-1234567890123456');
    expect(next.llm.model).toBeUndefined();
    expect(next.llm.baseUrl).toBeUndefined();
    expect(next.llm.rotation).toEqual([
      expect.objectContaining({
        provider: 'anthropic',
        apiKey: 'sk-ant-1234567890123456',
        label: 'Anthropic',
      }),
    ]);
  });

  test('discord allowlist parser accepts mention wrappers and whitespace', () => {
    expect(parseDiscordAllowedUsers(' <@123456789012345678>, 234567890123456789 \n nope ')).toEqual([
      '123456789012345678',
      '234567890123456789',
    ]);
  });

  test('provider catalog covers all 10 LLMProviderName values', () => {
    const providers = DASHBOARD_PROVIDER_SETUP_OPTIONS.map(o => o.provider).sort();
    expect(providers).toEqual([
      'anthropic', 'auto', 'gemini', 'glm', 'grok', 'kimi',
      'local', 'openai', 'openai-codex', 'qwen',
    ]);
  });

  test('each provider option declares a valid flow branch', () => {
    const validFlows = new Set(['apiKey', 'codex', 'local', 'auto']);
    for (const opt of DASHBOARD_PROVIDER_SETUP_OPTIONS) {
      expect(validFlows.has(opt.flow)).toBe(true);
      expect(opt.label).toBeTruthy();
      expect(opt.description).toBeTruthy();
    }
  });

  test('apiKey-flow providers all have a non-empty apiKeyLabel', () => {
    for (const opt of DASHBOARD_PROVIDER_SETUP_OPTIONS) {
      if (opt.flow === 'apiKey') {
        expect(opt.apiKeyLabel.length).toBeGreaterThan(0);
      }
    }
  });

  test('discord setup persists token, allowlist, and home channel', () => {
    const cfg = buildUserConfig('/tmp/monad-dashboard-setup-inline-discord.json');
    const next = applyDashboardDiscordSetup(cfg, {
      token: 'discord-token-value',
      allowedUsers: ['123456789012345678'],
      homeChannel: '234567890123456789',
    });
    expect(next.discord).toEqual({
      enabled: true,
      botToken: 'discord-token-value',
      allowedUsers: ['123456789012345678'],
      homeChannel: '234567890123456789',
    });
  });
});
