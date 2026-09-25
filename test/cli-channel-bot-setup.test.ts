import { describe, expect, test } from 'bun:test';

import type { WizardIO } from '../src/onboarding.js';
import {
  runChannelBotSetup,
  type ChannelBotSetupPlatform,
} from '../src/cli/channel-bot-setup.js';

function makeIo(answers: string[], logs: string[] = []): WizardIO {
  let idx = 0;
  return {
    ask: async () => answers[idx++] ?? '',
    askSecret: async () => answers[idx++] ?? '',
    print: (text) => { logs.push(text); },
    close: () => {},
  };
}

describe('Q.4 · runChannelBotSetup', () => {
  test('telegram happy path saves secret + switch', async () => {
    const secrets: Array<{ id: string; value: string }> = [];
    const switches: Array<{ id: string; value: string }> = [];
    const result = await runChannelBotSetup({
      platform: 'telegram',
      io: makeIo(['12345:ABCDEFGHIJKLMNOPQRSTUV']),
      setSecretFn: async (id, value) => { secrets.push({ id, value }); },
      saveSwitchFn: (id, value) => { switches.push({ id, value }); },
      out: { log: () => {}, error: () => {} },
    });
    expect(result.exitCode).toBe(0);
    expect(secrets).toEqual([{ id: 'telegram-bot-1', value: '12345:ABCDEFGHIJKLMNOPQRSTUV' }]);
    expect(switches).toEqual([{ id: 'tabs.telegram:1.tokenRef', value: 'ref:secret:telegram-bot-1' }]);
  });

  test('discord happy path saves secret + switch', async () => {
    const secrets: Array<{ id: string; value: string }> = [];
    const switches: Array<{ id: string; value: string }> = [];
    const result = await runChannelBotSetup({
      platform: 'discord',
      io: makeIo(['discord.token.value.without.whitespace']),
      setSecretFn: async (id, value) => { secrets.push({ id, value }); },
      saveSwitchFn: (id, value) => { switches.push({ id, value }); },
      out: { log: () => {}, error: () => {} },
    });
    expect(result.exitCode).toBe(0);
    expect(secrets).toEqual([{ id: 'discord-bot-1', value: 'discord.token.value.without.whitespace' }]);
    expect(switches).toEqual([{ id: 'tabs.discord:1.tokenRef', value: 'ref:secret:discord-bot-1' }]);
  });

  test('telegram invalid token → exit 1', async () => {
    const errors: string[] = [];
    const result = await runChannelBotSetup({
      platform: 'telegram',
      io: makeIo(['bad', 'stillbad', 'nope']),
      setSecretFn: async () => { throw new Error('should not save'); },
      saveSwitchFn: () => { throw new Error('should not save'); },
      out: { log: () => {}, error: (text) => { errors.push(text); } },
    });
    expect(result.exitCode).toBe(1);
    expect(errors.join('\n')).toContain('Token doesn\'t match');
  });

  test('discord invalid token → exit 1', async () => {
    const errors: string[] = [];
    const result = await runChannelBotSetup({
      platform: 'discord',
      io: makeIo(['short', 'tiny', 'bad']),
      out: { log: () => {}, error: (text) => { errors.push(text); } },
    });
    expect(result.exitCode).toBe(1);
    expect(errors.join('\n')).toContain('look right');
  });

  test('secret backend failure → exit 1', async () => {
    const errors: string[] = [];
    const result = await runChannelBotSetup({
      platform: 'telegram',
      io: makeIo(['12345:ABCDEFGHIJKLMNOPQRSTUV']),
      setSecretFn: async () => { throw new Error('backend down'); },
      out: { log: () => {}, error: (text) => { errors.push(text); } },
    });
    expect(result.exitCode).toBe(1);
    expect(errors.join('\n')).toContain('backend down');
  });

  test.each([
    ['telegram', 'Telegram bot setup'],
    ['discord', 'Discord bot setup'],
  ] as Array<[ChannelBotSetupPlatform, string]>)('%s banner rendered', async (platform, title) => {
    const logs: string[] = [];
    await runChannelBotSetup({
      platform,
      io: makeIo([platform === 'telegram' ? '12345:ABCDEFGHIJKLMNOPQRSTUV' : 'discord.token.value.without.whitespace'], logs),
      setSecretFn: async () => {},
      saveSwitchFn: () => {},
      out: { log: () => {}, error: () => {} },
    });
    expect(logs.join('\n')).toContain(title);
  });
});
